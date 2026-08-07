// TradeOS ERP — Load Form aggregation service.
//
// A Load Form (distributor warehouse picking sheet) summarizes confirmed sales
// into a printable document grouped by brand, listing each product's
// packing / cartons / pieces / bonus, plus Total / Bonus / Net value footers.
//
// It is intentionally read-only: it reads sales_transactions + sales_items +
// products + brands and aggregates, never mutating data.

import { SupabaseClient } from "@supabase/supabase-js";

export interface LoadFormFilters {
  organizationId: string;
  /** Restrict by customer ids (OR). When empty, all customers. */
  customerIds?: string[];
  /** Restrict by salesman profile ids - created_by_profile_id (OR). */
  salesmanIds?: string[];
  /** Inclusive lower bound on sale_date (YYYY-MM-DD). */
  dateFrom?: string | null;
  /** Inclusive upper bound on sale_date (YYYY-MM-DD). */
  dateTo?: string | null;
}

export interface LoadFormLine {
  product_id: number | string;
  product_name: string;
  units_per_pack: number | null;
  /** Display packing, e.g. units_per_pack or "24X18" style if present. */
  packing: string;
  cartons: number;
  pcs: number;
  bonus: number;
  /** Value of the sold quantity (not bonus): qty * selling_price - discount. */
  total_value: number;
  /** Value of bonus units: bonus * selling_price. */
  bonus_value: number;
  brand_id: string | null;
  brand_name: string;
}

export interface LoadFormSummary {
  lines: LoadFormLine[];
}

export interface LoadFormResult {
  ok: boolean;
  error?: string;
  summary?: LoadFormSummary;
}

interface SalesItemRow {
  product_id: number | string;
  quantity: number;
  bonus: number;
  selling_price: number;
  discount: number;
  products: {
    name: string;
    units_per_pack: number | null;
    brands: { id: string; name: string } | null;
  } | null;
  sales_transactions: { sale_date: string | null } | null;
}

async function fetchSalesItems(
  supabase: SupabaseClient,
  filters: LoadFormFilters,
): Promise<SalesItemRow[]> {
  const org = filters.organizationId;
  let query = supabase
    .from("sales_items")
    .select(
      `product_id,
       quantity,
       bonus,
       selling_price,
       discount,
       products!inner(name, units_per_pack, brands(id, name)),
       sales_transactions!inner(
         organization_id,
         sale_date,
         created_by_profile_id,
         status
       )`,
    )
    .eq("sales_transactions.organization_id", org)
    .in("sales_transactions.status", ["confirmed", "paid", "partially_paid"]);

  if (filters.customerIds && filters.customerIds.length > 0) {
    query = query.in("sales_transactions.customer_id", filters.customerIds);
  }
  if (filters.salesmanIds && filters.salesmanIds.length > 0) {
    query = query.in("sales_transactions.created_by_profile_id", filters.salesmanIds);
  }
  if (filters.dateFrom) {
    query = query.gte("sales_transactions.sale_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("sales_transactions.sale_date", filters.dateTo);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`loadForm: ${error.message}`);
  }
  return (data ?? []) as unknown as SalesItemRow[];
}

interface Agg {
  product_id: number | string;
  product_name: string;
  brand_id: string | null;
  brand_name: string;
  units_per_pack: number | null;
  qty: number;
  bonus: number;
  total_value: number;
  bonus_value: number;
}

export async function buildLoadForm(
  supabase: SupabaseClient,
  filters: LoadFormFilters,
): Promise<LoadFormResult> {
  if (!filters.organizationId) {
    return { ok: false, error: "Organization context required" };
  }

  let rows: SalesItemRow[];
  try {
    rows = await fetchSalesItems(supabase, filters);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load sales" };
  }

  // Aggregate per product.
  const byProduct = new Map<string, Agg>();
  for (const row of rows) {
    const product = row.products;
    if (!product) continue;
    const key = String(row.product_id);
    let agg = byProduct.get(key);
    if (!agg) {
      agg = {
        product_id: row.product_id,
        product_name: product.name,
        brand_id: product.brands?.id ?? null,
        brand_name: product.brands?.name ?? "OTHER",
        units_per_pack: product.units_per_pack ?? null,
        qty: 0,
        bonus: 0,
        total_value: 0,
        bonus_value: 0,
      };
      byProduct.set(key, agg);
    }
    const qty = Number(row.quantity) || 0;
    const bonus = Number(row.bonus) || 0;
    const price = Number(row.selling_price) || 0;
    const disc = Number(row.discount) || 0;
    agg.qty += qty;
    agg.bonus += bonus;
    agg.total_value += qty * price - disc;
    agg.bonus_value += bonus * price;
  }

  const lines: LoadFormLine[] = [...byProduct.values()]
    .map((agg) => {
      const perPack = agg.units_per_pack && agg.units_per_pack > 0 ? agg.units_per_pack : 0;
      const cartons = perPack > 0 ? Math.floor(agg.qty / perPack) : 0;
      const pcs = perPack > 0 ? agg.qty % perPack : agg.qty;
      return {
        product_id: agg.product_id,
        product_name: agg.product_name,
        brand_id: agg.brand_id,
        brand_name: agg.brand_name,
        units_per_pack: perPack,
        packing: perPack > 0 ? String(perPack) : "",
        cartons,
        pcs,
        bonus: round2(agg.bonus),
        total_value: round2(agg.total_value),
        bonus_value: round2(agg.bonus_value),
      };
    })
    .sort((a, b) => a.brand_name.localeCompare(b.brand_name) || a.product_name.localeCompare(b.product_name));

  return { ok: true, summary: { lines } };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}