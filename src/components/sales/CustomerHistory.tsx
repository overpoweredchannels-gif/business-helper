"use client";

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import HistoricalRecords from "@/components/import-export/HistoricalRecords";
import { formatPKR } from "@/lib/tradeos/formatters";
import { formatCalendarDate } from "@/lib/regional/dates";
import { computeCustomerRemainingByTransaction, computeReturnedValueBySalesTransaction } from "@/lib/sales/returns-offset";
import { useRegional } from "@/components/regional/RegionalProvider";

interface Props { organizationId: string | null; customerId?: string | null }
type CustomerRow = { id: string; customer_name: string; shop_name?: string | null; organization_name?: string | null; contact_person?: string | null; phone?: string | null; whatsapp?: string | null; city?: string | null; area?: string | null; address?: string | null; customer_type?: string | null; credit_policy?: string | null; assigned_salesman_id?: string | null; assigned_territory_id?: string | null };
type TransactionRow = { id: string; customer_id: string | null; invoice_number: string; total_amount?: number | null; status?: string | null; sale_date?: string | null; created_at: string; created_by_profile_id?: string | null; payment_type?: string | null };
type SalesItemRow = { sales_transaction_id: string; product_id: string; quantity: number; selling_price: number; discount?: number | null; created_at: string };
type PaymentRow = { customer_id: string | null; amount: number; payment_date?: string | null; created_at: string };
type OrderRow = { id: string; customer_id: string | null; so_number: string; status: string; order_date?: string | null; expected_date?: string | null; created_at: string; created_by_profile_id?: string | null };
type OrderItemRow = { sales_order_id: string; product_id: string };
type ProductRow = { id: string; name: string };
type ProfileRow = { id: string; display_name?: string | null; email?: string | null };
type AllocationRow = { sales_transaction_id: string; amount: number };
type SalesReturnRow = { id: string; customer_id: string | null; sales_transaction_id: string | null; status?: string | null };
type SalesReturnItemRow = { sales_return_id: string; quantity: number; unit_price?: number | null; discount?: number | null };
type Data = { customers: CustomerRow[]; transactions: TransactionRow[]; salesItems: SalesItemRow[]; payments: PaymentRow[]; allocations: AllocationRow[]; orders: OrderRow[]; orderItems: OrderItemRow[]; products: ProductRow[]; profiles: ProfileRow[]; salesReturns: SalesReturnRow[]; salesReturnItems: SalesReturnItemRow[] };
type AssignmentOptions = { employees: Array<{ id: string; full_name: string; designation: string }>; territories: Array<{ id: string; name: string }>; routes: Array<{ id: string; name: string; territory_id: string | null; assigned_salesman_id?: string | null }>; routeStops: Array<{ route_id: string; customer_id: string }> };
const empty: Data = { customers: [], transactions: [], salesItems: [], payments: [], allocations: [], orders: [], orderItems: [], products: [], profiles: [], salesReturns: [], salesReturnItems: [] };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const DATE_LOCALES = { en: "en-PK", es: "es-ES", it: "it-IT", ur: "ur-PK" } as const;

export default function CustomerHistory({ organizationId, customerId }: Props) {
  const { t, language } = useRegional();
  const showDate = (value?: string | null) => {
    if (!value) return "—";
    // Stored calendar dates (sale_date, order_date, expected_date) render
    // through the shared pinned calendar formatter — `new Date(value)`
    // parses them as UTC midnight and shifts the day west of UTC.
    // Timestamp values (the created_at fallback) keep instant rendering.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      try {
        return formatCalendarDate(value, DATE_LOCALES[language]);
      } catch {
        return "—";
      }
    }
    return new Date(value).toLocaleDateString(DATE_LOCALES[language]);
  };
  const [data, setData] = useState<Data>(empty);
  const [selectedId, setSelectedId] = useState(customerId ?? "");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const [assignmentOptions, setAssignmentOptions] = useState<AssignmentOptions | null>(null);
  const [assignmentTerritoryId, setAssignmentTerritoryId] = useState("");
  const [assignmentRouteId, setAssignmentRouteId] = useState("");
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [assignmentSaving, setAssignmentSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    authorizedFetch("/api/customers/history")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error ?? t('history.loadError'));
        if (active) setData(result);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('history.loadError')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    authorizedFetch("/api/customers/assignment-options")
      .then(async (response) => {
        const result = await response.json();
        if (response.ok && result.ok) setAssignmentOptions(result);
      })
      .catch(() => undefined);
  }, [organizationId]);

  const profiles = useMemo(() => new Map(data.profiles.map((row) => [String(row.id), row])), [data.profiles]);
  const products = useMemo(() => new Map(data.products.map((row) => [String(row.id), row])), [data.products]);
  const transactionsById = useMemo(() => new Map(data.transactions.map((row) => [String(row.id), row])), [data.transactions]);
  // Confirmed sales returns linked to an invoice offset that invoice's
  // outstanding balance — shared with the receivables engine in page.tsx
  // via src/lib/sales/returns-offset.ts (single source of truth): a return
  // line's value is quantity × unit price − discount, floored at 0 per
  // return. Cancelled returns and unlinked returns offset nothing.
  const returnedByTransaction = useMemo(
    () =>
      new Map(
        Object.entries(
          computeReturnedValueBySalesTransaction(data.salesReturns, data.salesReturnItems)
        )
      ),
    [data.salesReturns, data.salesReturnItems]
  );
  // Per-invoice remaining with RECEIVABLES-ENGINE semantics (M1 decision
  // 3): returns offset first, then explicit allocations, then the
  // customer's unallocated payments applied FIFO across open credit
  // invoices — the shared computation in src/lib/sales/returns-offset.ts,
  // the same one page.tsx's receivables engine runs. History previously
  // counted only explicit allocations and overstated what customers owed
  // (production: REHAN PSO History Rs 265,850 vs Receivables Rs 0).
  // Computed over ALL of a customer's documents (not the date-filtered
  // view) so a date window can never corrupt the FIFO order.
  const remainingByTransaction = useMemo(
    () =>
      computeCustomerRemainingByTransaction({
        transactions: data.transactions.map((row) => ({
          id: String(row.id),
          customerId: row.customer_id ? String(row.customer_id) : null,
          invoiceTotal: num(row.total_amount),
          paymentType: row.payment_type,
          status: row.status,
          sortDate: String(row.sale_date ?? row.created_at ?? "").slice(0, 10),
          createdAt: String(row.created_at ?? ""),
        })),
        payments: data.payments.map((row) => ({
          customerId: row.customer_id ? String(row.customer_id) : null,
          amount: num(row.amount),
        })),
        allocations: data.allocations.map((row) => ({
          salesTransactionId: String(row.sales_transaction_id),
          amount: num(row.amount),
        })),
        returnedValueByTransaction: Object.fromEntries(returnedByTransaction),
      }),
    [data.transactions, data.payments, data.allocations, returnedByTransaction]
  );
  const matchingCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.customers;
    const ids = new Set<string>();
    for (const row of data.customers) {
      if ([row.customer_name, row.shop_name, row.organization_name, row.contact_person, row.phone, row.whatsapp, row.city, row.area]
        .some((value) => String(value ?? "").toLowerCase().includes(term))) ids.add(String(row.id));
    }
    for (const row of [...data.transactions, ...data.orders]) {
      const profile = profiles.get(String(row.created_by_profile_id));
      const documentNumber = "invoice_number" in row ? row.invoice_number : row.so_number;
      if ([documentNumber, profile?.display_name, profile?.email]
        .some((value) => String(value ?? "").toLowerCase().includes(term))) ids.add(String(row.customer_id));
    }
    return data.customers.filter((row) => ids.has(String(row.id)));
  }, [data.customers, data.orders, data.transactions, profiles, search]);
  const customer = data.customers.find((row) => String(row.id) === String(selectedId));

  useEffect(() => {
    if (!customer) return;
    const routeId = assignmentOptions?.routeStops.find((stop) => String(stop.customer_id) === String(customer.id))?.route_id ?? "";
    setAssignmentTerritoryId(customer.assigned_territory_id ?? "");
    setAssignmentRouteId(routeId);
    setAssignmentEmployeeId(customer.assigned_salesman_id ?? "");
    setAssignmentMessage(null);
  }, [assignmentOptions, customer]);

  const history = useMemo(() => {
    const within = (value: string) => { const day = value.slice(0, 10); return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo); };
    const transactions = data.transactions.filter((row) => String(row.customer_id) === String(selectedId) && !["cancelled", "void"].includes(String(row.status)) && within(row.sale_date ?? row.created_at));
    const txIds = new Set(transactions.map((row) => String(row.id)));
    const salesItems = data.salesItems.filter((row) => txIds.has(String(row.sales_transaction_id)));
    const payments = data.payments.filter((row) => String(row.customer_id) === String(selectedId) && within(row.payment_date ?? row.created_at));
    const orders = data.orders.filter((row) => String(row.customer_id) === String(selectedId) && within(row.order_date ?? row.created_at));
    const orderIds = new Set(orders.map((row) => String(row.id)));
    const orderItems = data.orderItems.filter((row) => orderIds.has(String(row.sales_order_id)));
    return { transactions, salesItems, payments, orders, orderItems };
  }, [data, dateFrom, dateTo, selectedId]);

  const summary = useMemo(() => {
    const totalSales = history.transactions.reduce((sum, row) => sum + num(row.total_amount), 0);
    const totalPaid = history.transactions.reduce((sum, row) => sum + (remainingByTransaction[String(row.id)]?.allocatedAmount ?? 0), 0);
    const unpaidInvoices = history.transactions.filter((row) => (remainingByTransaction[String(row.id)]?.remaining ?? 0) > 0.005).length;
    const pendingOrders = history.orders.filter((row) => ["draft", "pending_approval", "confirmed"].includes(String(row.status)));
    const productStats = new Map<string, { qty: number; revenue: number; price: number; date: string }>();
    const sortedItems = [...history.salesItems].sort((a, b) => String(transactionsById.get(String(b.sales_transaction_id))?.sale_date ?? b.created_at).localeCompare(String(transactionsById.get(String(a.sales_transaction_id))?.sale_date ?? a.created_at)));
    for (const item of sortedItems) {
      const id = String(item.product_id); const current = productStats.get(id) ?? { qty: 0, revenue: 0, price: num(item.selling_price), date: "" };
      current.qty += num(item.quantity); current.revenue += num(item.quantity) * num(item.selling_price) - num(item.discount);
      if (!current.date) { const tx = transactionsById.get(String(item.sales_transaction_id)); current.date = tx?.sale_date ?? tx?.created_at ?? item.created_at; current.price = num(item.selling_price); }
      productStats.set(id, current);
    }
    const monthly = new Map<string, number>();
    for (const tx of history.transactions) { const month = String(tx.sale_date ?? tx.created_at).slice(0, 7); monthly.set(month, (monthly.get(month) ?? 0) + num(tx.total_amount)); }
    return { totalSales, totalPaid, outstanding: history.transactions.reduce((sum, row) => sum + (remainingByTransaction[String(row.id)]?.remaining ?? 0), 0), unpaidInvoices, pendingOrders,
      topProducts: [...productStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue), monthly: [...monthly.entries()].sort((a, b) => b[0].localeCompare(a[0])) };
  }, [remainingByTransaction, history, transactionsById]);

  const customerOverview = useMemo(() => matchingCustomers.map((row) => {
    const invoices = data.transactions.filter((transaction) => String(transaction.customer_id) === String(row.id) && !["cancelled", "void"].includes(String(transaction.status)));
    const totalSales = invoices.reduce((sum, invoice) => sum + num(invoice.total_amount), 0);
    const outstanding = invoices.reduce((sum, invoice) => sum + (remainingByTransaction[String(invoice.id)]?.remaining ?? 0), 0);
    const unpaid = invoices.filter((invoice) => (remainingByTransaction[String(invoice.id)]?.remaining ?? 0) > 0.005).length;
    return { row, invoiceCount: invoices.length, totalSales, outstanding, unpaid };
  }), [remainingByTransaction, data.transactions, matchingCustomers]);

  const saveIndividualAssignment = async () => {
    if (!customer) return;
    setAssignmentSaving(true); setAssignmentMessage(null);
    try {
      const response = await authorizedFetch(`/api/customers/${customer.id}/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ territory_id: assignmentTerritoryId || null, route_id: assignmentRouteId || null, salesman_id: assignmentEmployeeId || null }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? t('history.assignmentSaveError'));
      setData((current) => ({ ...current, customers: current.customers.map((row) => row.id === customer.id ? { ...row, assigned_territory_id: result.territory_id, assigned_salesman_id: result.salesman_id } : row) }));
      setAssignmentMessage(t('history.assignmentSaved'));
    } catch (reason) { setAssignmentMessage(reason instanceof Error ? reason.message : t('history.assignmentSaveError')); }
    finally { setAssignmentSaving(false); }
  };

  const assignCompleteRoute = async () => {
    if (!assignmentEmployeeId || !assignmentRouteId) { setAssignmentMessage(t('history.selectEmployeeRouteFirst')); return; }
    setAssignmentSaving(true); setAssignmentMessage(null);
    try {
      const response = await authorizedFetch(`/api/identity/employees/${assignmentEmployeeId}/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ territory_id: assignmentTerritoryId || null, route_id: assignmentRouteId, assignment_scope: "route_all", customer_ids: [] }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? t('history.routeAssignError'));
      setAssignmentMessage(t('history.routeAssigned').replace('{count}', String(result.customer_ids?.length ?? 0)));
    } catch (reason) { setAssignmentMessage(reason instanceof Error ? reason.message : t('history.routeAssignError')); }
    finally { setAssignmentSaving(false); }
  };

  return <div className="space-y-5">
    {!customerId && <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm"><span>{t('history.searchLabel')}</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('history.searchPlaceholder')} className="rounded border border-border px-3 py-2" /></label>
      <label className="flex flex-col gap-1 text-sm"><span>{t('sell.customer')}</span><select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded border border-border px-3 py-2"><option value="">{t('history.selectCustomer')}</option>{matchingCustomers.map((row) => <option key={row.id} value={row.id}>{row.customer_name}{row.shop_name ? ` — ${row.shop_name}` : ""}</option>)}</select></label>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm"><span>{t('records.from')}</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-border px-3 py-2" /></label><label className="flex flex-col gap-1 text-sm"><span>{t('records.to')}</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-border px-3 py-2" /></label></div>
    {loading && <p className="text-sm text-muted-foreground">{t('history.loading')}</p>}
    {error && <p className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {!customerId && !loading && !error && <section className="overflow-x-auto rounded border border-border bg-card p-4">
      <h3 className="mb-3 font-medium">{t('history.profilesTitle')}</h3>
      <table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">{t('sell.customer')}</th><th>{t('customers.area')}</th><th>{t('history.colInvoices')}</th><th>{t('history.colTotalSales')}</th><th>{t('history.colRemaining')}</th><th>{t('history.colUnpaid')}</th><th>{t('history.colProfile')}</th></tr></thead><tbody>
        {customerOverview.map(({ row, invoiceCount, totalSales, outstanding, unpaid }) => <tr key={row.id} className="border-b border-border/60"><td className="py-2 pr-3"><strong>{row.customer_name}</strong><div className="text-xs text-muted-foreground">{row.shop_name ?? row.organization_name ?? "—"}</div></td><td>{[row.area, row.city].filter(Boolean).join(", ") || "—"}</td><td>{invoiceCount}</td><td>{formatPKR(totalSales)}</td><td className={outstanding > 0 ? "font-medium text-warning" : "text-success"}>{formatPKR(outstanding)}</td><td>{unpaid}</td><td><button type="button" onClick={() => setSelectedId(row.id)} className="rounded border border-primary px-2 py-1 text-xs text-primary">{t('history.open')}</button></td></tr>)}
      </tbody></table>
      {customerOverview.length === 0 && <p className="py-3 text-sm text-muted-foreground">{t('history.noProfilesMatch')}</p>}
    </section>}
    {!loading && !error && !customer && <p className="rounded border border-border bg-muted/30 p-6 text-center text-muted-foreground">{t('history.selectToOpen')}</p>}
    {customer && <>
      <section className="rounded border border-border bg-card p-4"><h3 className="text-lg font-semibold">{customer.customer_name}</h3><p className="text-sm text-muted-foreground">{customer.shop_name ?? customer.organization_name ?? t('history.noShopOrOrg')}</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div>{t('history.contactPrefix')} {customer.contact_person ?? "—"}</div><div>{t('customers.phonePrefix')} {customer.phone ?? "—"}</div><div>{t('history.whatsappPrefix')} {customer.whatsapp ?? "—"}</div><div>{t('history.areaPrefix')} {[customer.area, customer.city].filter(Boolean).join(", ") || "—"}</div><div>{t('customers.typePrefix')} {customer.customer_type ?? "—"}</div><div className="capitalize">{t('history.creditPrefix')} {String(customer.credit_policy ?? "cash_only").replaceAll("_", " ")}</div><div className="sm:col-span-2">{t('history.addressPrefix')} {customer.address ?? "—"}</div></div>
      </section>
      {assignmentOptions && <section className="rounded border border-border bg-card p-4"><h4 className="mb-1 font-medium">{t('history.assignmentTitle')}</h4><p className="mb-3 text-xs text-muted-foreground">{t('history.assignmentHint')}</p>
        <div className="grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1 text-sm"><span>{t('history.territory')}</span><select value={assignmentTerritoryId} onChange={(event) => { setAssignmentTerritoryId(event.target.value); setAssignmentRouteId(""); }} className="rounded border border-border px-3 py-2"><option value="">{t('history.noTerritory')}</option>{assignmentOptions.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm"><span>{t('history.route')}</span><select value={assignmentRouteId} disabled={!assignmentTerritoryId} onChange={(event) => setAssignmentRouteId(event.target.value)} className="rounded border border-border px-3 py-2"><option value="">{t('history.noRoute')}</option>{assignmentOptions.routes.filter((route) => route.territory_id === assignmentTerritoryId).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm"><span>{t('history.employee')}</span><select value={assignmentEmployeeId} onChange={(event) => setAssignmentEmployeeId(event.target.value)} className="rounded border border-border px-3 py-2"><option value="">{t('history.unassigned')}</option>{assignmentOptions.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.designation.replaceAll("_", " ")}</option>)}</select></label></div>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={assignmentSaving} onClick={saveIndividualAssignment} className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">{t('history.assignCustomer')}</button><button type="button" disabled={assignmentSaving || !assignmentRouteId || !assignmentEmployeeId} onClick={assignCompleteRoute} className="rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">{t('history.assignRoute')}</button></div>
        {assignmentMessage && <p className="mt-2 text-sm text-foreground/80">{assignmentMessage}</p>}
      </section>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[[t('history.totalSales'), formatPKR(summary.totalSales)], [t('history.totalPaid'), formatPKR(summary.totalPaid)], [t('history.outstanding'), formatPKR(summary.outstanding)], [t('history.colInvoices'), history.transactions.length], [t('history.unpaidInvoices'), summary.unpaidInvoices], [t('history.pendingOrders'), summary.pendingOrders.length]].map(([label, value]) => <div key={label} className="rounded border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold">{value}</div></div>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">{t('history.topProductsTitle')}</h4>{summary.topProducts.length ? <div className="space-y-2 text-sm">{summary.topProducts.slice(0, 10).map(([id, item]) => <div key={id} className="flex justify-between gap-3 border-b border-border/60 pb-2"><div><div className="font-medium">{products.get(id)?.name ?? t('customers.productFallback').replace('{id}', id)}</div><div className="text-xs text-muted-foreground">{t('history.qtyLast').replace('{qty}', String(item.qty)).replace('{date}', showDate(item.date))}</div></div><div className="text-right">{formatPKR(item.revenue)}<div className="text-xs text-muted-foreground">{t('history.lastPrice').replace('{price}', formatPKR(item.price))}</div></div></div>)}</div> : <p className="text-sm text-muted-foreground">{t('history.noProductHistory')}</p>}</section>
        <section className="rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">{t('history.monthlySales')}</h4>{summary.monthly.length ? summary.monthly.slice(0, 12).map(([month, amount]) => <div key={month} className="flex justify-between border-b border-border/60 py-2 text-sm"><span>{month}</span><strong>{formatPKR(amount)}</strong></div>) : <p className="text-sm text-muted-foreground">{t('history.noMonthlySales')}</p>}</section>
      </div>
      <section className="overflow-x-auto rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">{t('history.salesInvoiceHistory')}</h4><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">{t('sell.invoiceLabel')}</th><th>{t('money.date')}</th><th>{t('history.colSalesman')}</th><th>{t('activity.payment')}</th><th>{t('sell.statusLabel')}</th><th>{t('common.total')}</th></tr></thead><tbody>{history.transactions.map((tx) => { const profile = profiles.get(String(tx.created_by_profile_id)); return <tr key={tx.id} className="border-b border-border/60"><td className="py-2 pr-3 font-medium">{tx.invoice_number}</td><td>{showDate(tx.sale_date ?? tx.created_at)}</td><td>{profile?.display_name ?? profile?.email ?? "—"}</td><td className="capitalize">{tx.payment_type === "credit" ? t('sell.paymentCredit') : tx.payment_type === "card" ? t('sell.paymentCard') : t('sell.paymentCash')}</td><td className="capitalize">{tx.status ?? "confirmed"}</td><td>{formatPKR(tx.total_amount)}</td></tr>; })}</tbody></table>{!history.transactions.length && <p className="py-3 text-sm text-muted-foreground">{t('history.noInvoicesInPeriod')}</p>}</section>
      <HistoricalRecords key={selectedId} organizationId={organizationId} partyId={selectedId} partyType="customer" />
      <section className="overflow-x-auto rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">{t('history.ordersTitle')}</h4><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">{t('sell.orderLabel')}</th><th>{t('money.date')}</th><th>{t('history.colExpected')}</th><th>{t('sell.statusLabel')}</th><th>{t('history.colItems')}</th></tr></thead><tbody>{history.orders.map((order) => <tr key={order.id} className="border-b border-border/60"><td className="py-2 pr-3 font-medium">{order.so_number}</td><td>{showDate(order.order_date ?? order.created_at)}</td><td>{showDate(order.expected_date)}</td><td className="capitalize">{String(order.status).replaceAll("_", " ")}</td><td>{history.orderItems.filter((item) => String(item.sales_order_id) === String(order.id)).length}</td></tr>)}</tbody></table>{!history.orders.length && <p className="py-3 text-sm text-muted-foreground">{t('history.noOrdersInPeriod')}</p>}</section>
    </>}
  </div>;
}
