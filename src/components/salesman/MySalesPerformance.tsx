"use client";
import { useEffect, useState } from "react";
import { MyPendingSales } from "./MyPendingSales";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { filterPerformance, performanceAmount, type PerformanceSale } from "@/lib/sales/performance";
import { useRegional } from "@/components/regional/RegionalProvider";
import { renderDeferred, type DeferredMessage } from "@/lib/regional/deferred";

const money = (amount: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(amount);

export function MySalesPerformance() {
  const { t } = useRegional();
  const [sales, setSales] = useState<PerformanceSale[]>([]);
  const [error, setError] = useState<string | DeferredMessage>("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: "", to: "", customer: "", brand: "" });
  useEffect(() => {
    let active = true;
    authorizedFetch("/api/identity/staff/performance").then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (active) setError(data.error || { key: 'salesman.perf.loadError' });
        return;
      }
      if (active) setSales(data.sales ?? []);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : { key: 'salesman.perf.loadError' }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const customers = new Map(sales.map(sale => [sale.customer_id ?? "", sale.customers?.shop_name || sale.customers?.customer_name || t('salesman.perf.customerFallback')]));
  const brands = new Map(sales.flatMap(sale => sale.sales_items.map(item => [item.products?.brand_id ?? "", item.products?.brands?.name ?? "Unbranded"] as const)));
  const rows = filterPerformance(sales, filters);
  const update = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  return <><section className="rounded-xl border border-border bg-card p-4 sm:p-6">
    <h2 className="text-xl font-semibold">{t('salesman.perf.title')}</h2>
    <p className="mb-4 text-sm text-muted-foreground">{t('salesman.perf.subtitle')}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">{t('salesman.perf.fromDate')}<input type="date" value={filters.from} onInput={e => update("from", e.currentTarget.value)} onChange={e => update("from", e.target.value)} className="min-w-0 rounded border p-2" /></label>
      <label className="grid gap-1 text-sm">{t('salesman.perf.toDate')}<input type="date" value={filters.to} onInput={e => update("to", e.currentTarget.value)} onChange={e => update("to", e.target.value)} className="min-w-0 rounded border p-2" /></label>
      <label className="grid gap-1 text-sm">{t('salesman.perf.customer')}<select value={filters.customer} onChange={e => update("customer", e.target.value)} className="min-w-0 rounded border p-2"><option value="">{t('salesman.perf.allCustomers')}</option>{[...customers].filter(([id]) => id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{t('salesman.perf.brand')}<select value={filters.brand} onChange={e => update("brand", e.target.value)} className="min-w-0 rounded border p-2"><option value="">{t('salesman.perf.allBrands')}</option>{[...brands].filter(([id]) => id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    <button type="button" className="my-3 text-sm text-primary underline" onClick={() => setFilters({ from: "", to: "", customer: "", brand: "" })}>{t('salesman.perf.clearFilters')}</button>
    {loading ? <p>{t('salesman.perf.loading')}</p> : error ? <p role="alert" className="text-destructive">{typeof error === "string" ? error : renderDeferred(t, error)}</p> : <>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert">{t('salesman.perf.dateError')}</p>}
      <div className="mb-4 flex flex-wrap gap-5"><div><p className="text-sm text-muted-foreground">{filters.brand ? t('salesman.perf.brandValue') : t('salesman.perf.totalSales')}</p><strong className="text-xl"><bdi>{money(rows.reduce((sum, sale) => sum + performanceAmount(sale, filters.brand), 0))}</bdi></strong></div><div><p className="text-sm text-muted-foreground">{t('salesman.perf.invoices')}</p><strong className="text-xl">{rows.length}</strong></div></div>
      {filters.brand && <p className="mb-3 text-xs text-muted-foreground">{t('salesman.perf.brandNote')}</p>}
      {!rows.length && <p>{t('salesman.perf.noMatch')}</p>}
      <ul className="grid gap-2">{rows.map(sale => <li key={sale.id} className="rounded border border-border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-medium"><span><bdi>{sale.invoice_number}</bdi></span><span><bdi>{money(performanceAmount(sale, filters.brand))}</bdi></span></div>
        <p><bdi>{sale.customers?.shop_name || sale.customers?.customer_name || t('salesman.perf.customerFallback')}</bdi> · {(sale.sale_date || sale.created_at).slice(0, 10)}</p>
        <p className="text-muted-foreground"><bdi>{sale.sales_items.filter(item => !filters.brand || item.products?.brand_id === filters.brand).map(item => item.products?.name || t('salesman.perf.productFallback')).join(", ")}</bdi></p>
      </li>)}</ul>
    </>}
  </section><MyPendingSales /></>;
}
