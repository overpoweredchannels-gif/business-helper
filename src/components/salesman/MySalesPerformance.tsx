"use client";
import { useEffect, useState } from "react";
import { MyPendingSales } from "./MyPendingSales";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { filterPerformance, performanceAmount, type PerformanceSale } from "@/lib/sales/performance";

const money = (amount: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(amount);

export function MySalesPerformance() {
  const [sales, setSales] = useState<PerformanceSale[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: "", to: "", customer: "", brand: "" });
  useEffect(() => {
    let active = true;
    authorizedFetch("/api/identity/staff/performance").then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load your sales");
      if (active) setSales(data.sales ?? []);
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const customers = new Map(sales.map(sale => [sale.customer_id ?? "", sale.customers?.shop_name || sale.customers?.customer_name || "Customer"]));
  const brands = new Map(sales.flatMap(sale => sale.sales_items.map(item => [item.products?.brand_id ?? "", item.products?.brands?.name ?? "Unbranded"] as const)));
  const rows = filterPerformance(sales, filters);
  const update = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  return <><section className="rounded-xl border border-border bg-card p-4 sm:p-6">
    <h2 className="text-xl font-semibold">My Sales</h2>
    <p className="mb-4 text-sm text-muted-foreground">Your confirmed invoices only. Sales waiting for owner approval are not counted.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">From date<input type="date" value={filters.from} onInput={e => update("from", e.currentTarget.value)} onChange={e => update("from", e.target.value)} className="min-w-0 rounded border p-2" /></label>
      <label className="grid gap-1 text-sm">To date<input type="date" value={filters.to} onInput={e => update("to", e.currentTarget.value)} onChange={e => update("to", e.target.value)} className="min-w-0 rounded border p-2" /></label>
      <label className="grid gap-1 text-sm">Customer<select value={filters.customer} onChange={e => update("customer", e.target.value)} className="min-w-0 rounded border p-2"><option value="">All my customers</option>{[...customers].filter(([id]) => id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Brand<select value={filters.brand} onChange={e => update("brand", e.target.value)} className="min-w-0 rounded border p-2"><option value="">All brands</option>{[...brands].filter(([id]) => id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    <button type="button" className="my-3 text-sm text-primary underline" onClick={() => setFilters({ from: "", to: "", customer: "", brand: "" })}>Clear filters</button>
    {loading ? <p>Loading your sales…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : <>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert">From date must be before To date.</p>}
      <div className="mb-4 flex flex-wrap gap-5"><div><p className="text-sm text-muted-foreground">{filters.brand ? "Brand sales value" : "Total sales"}</p><strong className="text-xl">{money(rows.reduce((sum, sale) => sum + performanceAmount(sale, filters.brand), 0))}</strong></div><div><p className="text-sm text-muted-foreground">Invoices</p><strong className="text-xl">{rows.length}</strong></div></div>
      {filters.brand && <p className="mb-3 text-xs text-muted-foreground">Brand value includes line discounts, before invoice discount and tax.</p>}
      {!rows.length && <p>No confirmed sales match these filters.</p>}
      <ul className="grid gap-2">{rows.map(sale => <li key={sale.id} className="rounded border border-border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-medium"><span>{sale.invoice_number}</span><span>{money(performanceAmount(sale, filters.brand))}</span></div>
        <p>{sale.customers?.shop_name || sale.customers?.customer_name || "Customer"} · {(sale.sale_date || sale.created_at).slice(0, 10)}</p>
        <p className="text-muted-foreground">{sale.sales_items.filter(item => !filters.brand || item.products?.brand_id === filters.brand).map(item => item.products?.name || "Product").join(", ")}</p>
      </li>)}</ul>
    </>}
  </section><MyPendingSales /></>;
}
