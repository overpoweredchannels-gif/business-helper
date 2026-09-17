"use client";

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import HistoricalRecords from "@/components/import-export/HistoricalRecords";
import { formatPKR } from "@/lib/tradeos/formatters";

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
type Data = { customers: CustomerRow[]; transactions: TransactionRow[]; salesItems: SalesItemRow[]; payments: PaymentRow[]; allocations: AllocationRow[]; orders: OrderRow[]; orderItems: OrderItemRow[]; products: ProductRow[]; profiles: ProfileRow[] };
type AssignmentOptions = { employees: Array<{ id: string; full_name: string; designation: string }>; territories: Array<{ id: string; name: string }>; routes: Array<{ id: string; name: string; territory_id: string | null; assigned_salesman_id?: string | null }>; routeStops: Array<{ route_id: string; customer_id: string }> };
const empty: Data = { customers: [], transactions: [], salesItems: [], payments: [], allocations: [], orders: [], orderItems: [], products: [], profiles: [] };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const showDate = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-PK") : "—";

export default function CustomerHistory({ organizationId, customerId }: Props) {
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
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Failed to load customer history");
        if (active) setData(result);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Failed to load customer history"); })
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
  const allocationsByTransaction = useMemo(() => {
    const map = new Map<string, number>();
    for (const allocation of data.allocations) map.set(String(allocation.sales_transaction_id), (map.get(String(allocation.sales_transaction_id)) ?? 0) + num(allocation.amount));
    return map;
  }, [data.allocations]);
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
    const totalPaid = history.transactions.reduce((sum, row) => sum + Math.min(num(row.total_amount), allocationsByTransaction.get(String(row.id)) ?? 0), 0);
    const unpaidInvoices = history.transactions.filter((row) => num(row.total_amount) - (allocationsByTransaction.get(String(row.id)) ?? 0) > 0.005).length;
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
    return { totalSales, totalPaid, outstanding: Math.max(0, totalSales - totalPaid), unpaidInvoices, pendingOrders,
      topProducts: [...productStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue), monthly: [...monthly.entries()].sort((a, b) => b[0].localeCompare(a[0])) };
  }, [allocationsByTransaction, history, transactionsById]);

  const customerOverview = useMemo(() => matchingCustomers.map((row) => {
    const invoices = data.transactions.filter((transaction) => String(transaction.customer_id) === String(row.id) && !["cancelled", "void"].includes(String(transaction.status)));
    const totalSales = invoices.reduce((sum, invoice) => sum + num(invoice.total_amount), 0);
    const outstanding = invoices.reduce((sum, invoice) => sum + Math.max(0, num(invoice.total_amount) - (allocationsByTransaction.get(String(invoice.id)) ?? 0)), 0);
    const unpaid = invoices.filter((invoice) => num(invoice.total_amount) - (allocationsByTransaction.get(String(invoice.id)) ?? 0) > 0.005).length;
    return { row, invoiceCount: invoices.length, totalSales, outstanding, unpaid };
  }), [allocationsByTransaction, data.transactions, matchingCustomers]);

  const saveIndividualAssignment = async () => {
    if (!customer) return;
    setAssignmentSaving(true); setAssignmentMessage(null);
    try {
      const response = await authorizedFetch(`/api/customers/${customer.id}/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ territory_id: assignmentTerritoryId || null, route_id: assignmentRouteId || null, salesman_id: assignmentEmployeeId || null }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Failed to save customer assignment");
      setData((current) => ({ ...current, customers: current.customers.map((row) => row.id === customer.id ? { ...row, assigned_territory_id: result.territory_id, assigned_salesman_id: result.salesman_id } : row) }));
      setAssignmentMessage("Customer assignment saved.");
    } catch (reason) { setAssignmentMessage(reason instanceof Error ? reason.message : "Failed to save customer assignment"); }
    finally { setAssignmentSaving(false); }
  };

  const assignCompleteRoute = async () => {
    if (!assignmentEmployeeId || !assignmentRouteId) { setAssignmentMessage("Select an employee and route first."); return; }
    setAssignmentSaving(true); setAssignmentMessage(null);
    try {
      const response = await authorizedFetch(`/api/identity/employees/${assignmentEmployeeId}/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ territory_id: assignmentTerritoryId || null, route_id: assignmentRouteId, assignment_scope: "route_all", customer_ids: [] }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Failed to assign route customers");
      setAssignmentMessage(`Employee assigned to the complete route and ${result.customer_ids?.length ?? 0} customer(s).`);
    } catch (reason) { setAssignmentMessage(reason instanceof Error ? reason.message : "Failed to assign route customers"); }
    finally { setAssignmentSaving(false); }
  };

  return <div className="space-y-5">
    {!customerId && <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm"><span>Search customer, salesman, invoice, or order</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, invoice, salesman..." className="rounded border border-border px-3 py-2" /></label>
      <label className="flex flex-col gap-1 text-sm"><span>Customer</span><select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded border border-border px-3 py-2"><option value="">Select customer</option>{matchingCustomers.map((row) => <option key={row.id} value={row.id}>{row.customer_name}{row.shop_name ? ` — ${row.shop_name}` : ""}</option>)}</select></label>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm"><span>From</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-border px-3 py-2" /></label><label className="flex flex-col gap-1 text-sm"><span>To</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-border px-3 py-2" /></label></div>
    {loading && <p className="text-sm text-muted-foreground">Loading customer history...</p>}
    {error && <p className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {!customerId && !loading && !error && <section className="overflow-x-auto rounded border border-border bg-card p-4">
      <h3 className="mb-3 font-medium">Customer Profiles</h3>
      <table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Customer</th><th>Area</th><th>Invoices</th><th>Total Sales</th><th>Remaining</th><th>Unpaid</th><th>Profile</th></tr></thead><tbody>
        {customerOverview.map(({ row, invoiceCount, totalSales, outstanding, unpaid }) => <tr key={row.id} className="border-b border-border/60"><td className="py-2 pr-3"><strong>{row.customer_name}</strong><div className="text-xs text-muted-foreground">{row.shop_name ?? row.organization_name ?? "—"}</div></td><td>{[row.area, row.city].filter(Boolean).join(", ") || "—"}</td><td>{invoiceCount}</td><td>{formatPKR(totalSales)}</td><td className={outstanding > 0 ? "font-medium text-warning" : "text-success"}>{formatPKR(outstanding)}</td><td>{unpaid}</td><td><button type="button" onClick={() => setSelectedId(row.id)} className="rounded border border-primary px-2 py-1 text-xs text-primary">Open</button></td></tr>)}
      </tbody></table>
      {customerOverview.length === 0 && <p className="py-3 text-sm text-muted-foreground">No customer profiles match the search.</p>}
    </section>}
    {!loading && !error && !customer && <p className="rounded border border-border bg-muted/30 p-6 text-center text-muted-foreground">Select a customer to open the complete profile.</p>}
    {customer && <>
      <section className="rounded border border-border bg-card p-4"><h3 className="text-lg font-semibold">{customer.customer_name}</h3><p className="text-sm text-muted-foreground">{customer.shop_name ?? customer.organization_name ?? "No shop or organization"}</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div>Contact: {customer.contact_person ?? "—"}</div><div>Phone: {customer.phone ?? "—"}</div><div>WhatsApp: {customer.whatsapp ?? "—"}</div><div>Area: {[customer.area, customer.city].filter(Boolean).join(", ") || "—"}</div><div>Type: {customer.customer_type ?? "—"}</div><div className="capitalize">Credit: {String(customer.credit_policy ?? "cash_only").replaceAll("_", " ")}</div><div className="sm:col-span-2">Address: {customer.address ?? "—"}</div></div>
      </section>
      {assignmentOptions && <section className="rounded border border-border bg-card p-4"><h4 className="mb-1 font-medium">Customer Assignment</h4><p className="mb-3 text-xs text-muted-foreground">Assign only this customer, or assign the employee to every customer saved on the selected route.</p>
        <div className="grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1 text-sm"><span>Territory</span><select value={assignmentTerritoryId} onChange={(event) => { setAssignmentTerritoryId(event.target.value); setAssignmentRouteId(""); }} className="rounded border border-border px-3 py-2"><option value="">No territory</option>{assignmentOptions.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm"><span>Route</span><select value={assignmentRouteId} disabled={!assignmentTerritoryId} onChange={(event) => setAssignmentRouteId(event.target.value)} className="rounded border border-border px-3 py-2"><option value="">No route</option>{assignmentOptions.routes.filter((route) => route.territory_id === assignmentTerritoryId).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm"><span>Employee</span><select value={assignmentEmployeeId} onChange={(event) => setAssignmentEmployeeId(event.target.value)} className="rounded border border-border px-3 py-2"><option value="">Unassigned</option>{assignmentOptions.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.designation.replaceAll("_", " ")}</option>)}</select></label></div>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={assignmentSaving} onClick={saveIndividualAssignment} className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">Assign This Customer</button><button type="button" disabled={assignmentSaving || !assignmentRouteId || !assignmentEmployeeId} onClick={assignCompleteRoute} className="rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">Assign Complete Route</button></div>
        {assignmentMessage && <p className="mt-2 text-sm text-foreground/80">{assignmentMessage}</p>}
      </section>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[["Total sales", formatPKR(summary.totalSales)], ["Total paid", formatPKR(summary.totalPaid)], ["Outstanding", formatPKR(summary.outstanding)], ["Invoices", history.transactions.length], ["Unpaid invoices", summary.unpaidInvoices], ["Pending orders", summary.pendingOrders.length]].map(([label, value]) => <div key={label} className="rounded border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold">{value}</div></div>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">Top products and last price</h4>{summary.topProducts.length ? <div className="space-y-2 text-sm">{summary.topProducts.slice(0, 10).map(([id, item]) => <div key={id} className="flex justify-between gap-3 border-b border-border/60 pb-2"><div><div className="font-medium">{products.get(id)?.name ?? `Product ${id}`}</div><div className="text-xs text-muted-foreground">Qty {item.qty} · last {showDate(item.date)}</div></div><div className="text-right">{formatPKR(item.revenue)}<div className="text-xs text-muted-foreground">Last {formatPKR(item.price)}</div></div></div>)}</div> : <p className="text-sm text-muted-foreground">No product history.</p>}</section>
        <section className="rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">Monthly sales</h4>{summary.monthly.length ? summary.monthly.slice(0, 12).map(([month, amount]) => <div key={month} className="flex justify-between border-b border-border/60 py-2 text-sm"><span>{month}</span><strong>{formatPKR(amount)}</strong></div>) : <p className="text-sm text-muted-foreground">No monthly sales.</p>}</section>
      </div>
      <section className="overflow-x-auto rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">Sales invoice history</h4><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Invoice</th><th>Date</th><th>Salesman</th><th>Payment</th><th>Status</th><th>Total</th></tr></thead><tbody>{history.transactions.map((tx) => { const profile = profiles.get(String(tx.created_by_profile_id)); return <tr key={tx.id} className="border-b border-border/60"><td className="py-2 pr-3 font-medium">{tx.invoice_number}</td><td>{showDate(tx.sale_date ?? tx.created_at)}</td><td>{profile?.display_name ?? profile?.email ?? "—"}</td><td className="capitalize">{tx.payment_type ?? "cash"}</td><td className="capitalize">{tx.status ?? "confirmed"}</td><td>{formatPKR(tx.total_amount)}</td></tr>; })}</tbody></table>{!history.transactions.length && <p className="py-3 text-sm text-muted-foreground">No invoices in this period.</p>}</section>
      <HistoricalRecords key={selectedId} organizationId={organizationId} partyId={selectedId} partyType="customer" />
      <section className="overflow-x-auto rounded border border-border bg-card p-4"><h4 className="mb-3 font-medium">Orders</h4><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Order</th><th>Date</th><th>Expected</th><th>Status</th><th>Items</th></tr></thead><tbody>{history.orders.map((order) => <tr key={order.id} className="border-b border-border/60"><td className="py-2 pr-3 font-medium">{order.so_number}</td><td>{showDate(order.order_date ?? order.created_at)}</td><td>{showDate(order.expected_date)}</td><td className="capitalize">{String(order.status).replaceAll("_", " ")}</td><td>{history.orderItems.filter((item) => String(item.sales_order_id) === String(order.id)).length}</td></tr>)}</tbody></table>{!history.orders.length && <p className="py-3 text-sm text-muted-foreground">No orders in this period.</p>}</section>
    </>}
  </div>;
}
