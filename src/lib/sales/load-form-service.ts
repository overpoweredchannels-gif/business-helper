// TradeOS ERP — Load Form aggregation service.
//
// A Load Form (distributor warehouse picking sheet) summarizes confirmed sales
// into a printable document grouped by SALESMAN then BRAND (or CUSTOMER). Under
// each brand it lists the products sold with packing / cartons / pieces / bonus,
// plus Total / Bonus / Net value footers.
//
// Read-only: reads sales_transactions + sales_items + products and aggregates;
// never mutates data.

import { SupabaseClient } from "@supabase/supabase-js";

export type LoadFormGroupBy = "brand" | "customer";

export interface LoadFormFilters {
  organizationId: string;
  /** Restrict by customer ids (OR). When empty, all customers. */
  customerIds?: string[];
  /** Restrict by salesman profile ids - created_by_profile_id (OR). */
  salesmanIds?: string[];
  /** Restrict by product brand ids (OR). When empty, all brands. */
  brandIds?: string[];
  /** Inclusive lower bound on sale_date (YYYY-MM-DD). */
  dateFrom?: string | null;
  /** Inclusive upper bound on sale_date (YYYY-MM-DD). */
  dateTo?: string | null;
  /** How to group products: by product brand or by customer. Defaults to brand. */
  groupBy?: LoadFormGroupBy;
  /** Organization branding (name/address/city/phone) for the printed header. */
  org?: { name?: string; address?: string; city?: string; phone?: string } | null;
}

export interface LoadFormLine {
  product_id: number | string;
  product_name: string;
  units_per_pack: number | null;
  /** The recommended unit type assigned to the product, e.g. "Cottons", "Boxes", "Packets", "Pieces". */
  unit_type: string | null;
  cartons: number;
  pcs: number;
  bonus: number;
  /** Value of the sold (non-bonus) quantity. */
  total_value: number;
  /** Value of bonus units. */
  bonus_value: number;
}

export interface LoadFormCustomerGroup {
  customer_id: string | null;
  customer_name: string;
  lines: LoadFormLine[];
  total_value: number;
  bonus_value: number;
}

export interface LoadFormBrandGroup {
  brand_id: string | null;
  brand_name: string;
  lines: LoadFormLine[];
  total_value: number;
  bonus_value: number;
}

export interface LoadFormSalesmanGroup {
  salesman_id: string;
  salesman_name: string;
  customers: LoadFormCustomerGroup[];
  brands: LoadFormBrandGroup[];
  total_value: number;
  bonus_value: number;
}

export interface LoadFormSummary {
  org_name: string;
  org_address: string;
  org_phone: string;
  groupBy: LoadFormGroupBy;
  /**
   * true when the user filtered to specific salesmen (per-salesman sections +
   * per-salesman totals are shown). false when "all salesmen" is selected, in
   * which case the whole load form is a single flow grouped by brand only.
   */
  groupBySalesman: boolean;
  salesmen: LoadFormSalesmanGroup[];
  grand_total: number;
  grand_bonus: number;
  grand_net: number;
}

export interface LoadFormResult {
  ok: boolean;
  error?: string;
  summary?: LoadFormSummary;
}

interface SalesRowRow {
  product_id: number | string;
  quantity: number;
  bonus: number;
  selling_price: number;
  discount: number;
  unit_mode: "main" | "subunit" | null;
  products: {
    name: string;
    unit_type: string | null;
    units_per_pack: number | null;
    brands: { id: string; name: string } | null;
  } | null;
  sales_transactions: {
    customer_id: string | null;
    created_by_profile_id: string | null;
    customers: { customer_name: string; shop_name?: string | null } | null;
  } | null;
}

async function fetchRows(supabase: SupabaseClient, filters: LoadFormFilters): Promise<SalesRowRow[]> {
  const org = filters.organizationId;
  let query = supabase
    .from("sales_items")
    .select(
      `product_id,
       quantity,
       bonus,
       selling_price,
       discount,
       unit_mode,
       products!inner(name, unit_type, units_per_pack, brands(id, name)),
       sales_transactions!inner(
         customer_id,
         created_by_profile_id,
         organization_id,
         sale_date,
         status,
         customers(customer_name, shop_name)
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
  if (filters.brandIds && filters.brandIds.length > 0) {
    query = query.in("products.brand_id", filters.brandIds);
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
  return (data ?? []) as unknown as SalesRowRow[];
}

interface LineAgg {
  product_id: number | string;
  product_name: string;
  units_per_pack: number | null;
  unit_type: string | null;
  cartons: number;
  pcs: number;
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

  let rows: SalesRowRow[];
  try {
    rows = await fetchRows(supabase, filters);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load sales" };
  }

  // When the user selects "all salesmen" (no salesman filter), the load form is
  // a single flow grouped by brand only — no per-salesman sections and no
  // "Unknown Salesman" bucket. When specific salesmen are filtered, each
  // salesman gets their own section.
  const groupBySalesman = Boolean(filters.salesmanIds && filters.salesmanIds.length > 0);

  const salesmanIds = groupBySalesman
    ? [
        ...new Set(
          rows
            .map((r) => r.sales_transactions?.created_by_profile_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
    : [];

  // Resolve salesman display names.
  let profileNames: Record<string, string> = {};
  if (salesmanIds.length > 0) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", salesmanIds);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.name;
      profileNames = map;
    } catch {
      // ignore
    }
  }

  // Aggregate per (salesman, group key, product). The group key is either the
  // customer id (groupBy=customer) or the brand id (groupBy=brand).
  const groupBy: LoadFormGroupBy = filters.groupBy ?? "brand";

  const salesmanMap = new Map<string, Map<string, Map<string, LineAgg>>>();
  const customerName = new Map<string, string>();
  const brandName = new Map<string, string>();
  const salesmanName = new Map<string, string>();
  const salesmanOrder: string[] = [];

  for (const row of rows) {
    const tx = row.sales_transactions;
    const product = row.products;
    if (!tx || !product) continue;

    const sid = groupBySalesman ? (tx.created_by_profile_id ?? "unassigned") : "__all__";
    if (!salesmanName.has(sid)) {
      salesmanName.set(sid, groupBySalesman ? (profileNames[sid] ?? "Unknown Salesman") : "All Salesmen");
      salesmanOrder.push(sid);
    }

    // Determine the grouping key for this line.
    let gid: string;
    if (groupBy === "brand") {
      gid = product.brands?.id ?? "no-brand";
      if (!brandName.get(gid)) {
        brandName.set(gid, product.brands?.name ?? "Unbranded");
      }
    } else {
      gid = tx.customer_id ?? "walk-in";
      if (!customerName.get(gid)) {
        const c = tx.customers;
        customerName.set(
          gid,
          c?.shop_name ? `${c.customer_name} (${c.shop_name})` : (c?.customer_name ?? "Walk-in Customer"),
        );
      }
    }

    let byGroup = salesmanMap.get(sid);
    if (!byGroup) {
      byGroup = new Map<string, Map<string, LineAgg>>();
      salesmanMap.set(sid, byGroup);
    }
    let lineMap = byGroup.get(gid);
    if (!lineMap) {
      lineMap = new Map<string, LineAgg>();
      byGroup.set(gid, lineMap);
    }

    const pid = String(row.product_id);
    const perPack = product.units_per_pack && product.units_per_pack > 0 ? product.units_per_pack : 0;
    const qty = Number(row.quantity) || 0;
    const bonus = Number(row.bonus) || 0;
    const price = Number(row.selling_price) || 0;
    const disc = Number(row.discount) || 0;
    // Normalize the sold quantity to pieces before packing. Subunit sales are
    // already in pieces; main-unit sales carry perPack pieces per unit.
    const qtyPieces = row.unit_mode === "subunit" || perPack === 0 ? qty : qty * perPack;

    const agg = lineMap.get(pid) ?? {
      product_id: pid,
      product_name: product.name,
      units_per_pack: product.units_per_pack ?? null,
      unit_type: product.unit_type ?? null,
      cartons: 0,
      pcs: 0,
      bonus: 0,
      total_value: 0,
      bonus_value: 0,
    } as LineAgg;

    agg.bonus += bonus;
    agg.total_value += qty * price - disc;
    agg.bonus_value += bonus * price;

    if (perPack > 0) {
      const totalUnits = agg.cartons * perPack + agg.pcs + qtyPieces;
      agg.cartons = Math.floor(totalUnits / perPack);
      agg.pcs = totalUnits % perPack;
    } else {
      agg.pcs += qtyPieces;
    }
    lineMap.set(pid, agg);
  }

  const salesmen: LoadFormSalesmanGroup[] = salesmanOrder
    .filter((sid) => salesmanMap.has(sid))
    .map((sid) => {
      const byGroup = salesmanMap.get(sid)!;

      const makeGroup = (gid: string, label: string) => {
        const lineMap = byGroup.get(gid)!;
        const lines: LoadFormLine[] = [...lineMap.values()].sort((a, b) =>
          a.product_name.localeCompare(b.product_name),
        );
        const total = round2(lines.reduce((s, l) => s + l.total_value, 0));
        const bonus = round2(lines.reduce((s, l) => s + l.bonus_value, 0));
        return { label, lines, total, bonus };
      };

      const groupIds = [...byGroup.keys()];
      const customers: LoadFormCustomerGroup[] =
        groupBy === "customer"
          ? groupIds.map((gid) => ({
              customer_id: gid === "walk-in" ? null : gid,
              customer_name: customerName.get(gid) ?? "Customer",
              lines: makeGroup(gid, customerName.get(gid) ?? "Customer").lines,
              total_value: makeGroup(gid, customerName.get(gid) ?? "Customer").total,
              bonus_value: makeGroup(gid, customerName.get(gid) ?? "Customer").bonus,
            }))
          : [];

      const brands: LoadFormBrandGroup[] =
        groupBy === "brand"
          ? groupIds.map((gid) => ({
              brand_id: gid === "no-brand" ? null : gid,
              brand_name: brandName.get(gid) ?? "Unbranded",
              lines: makeGroup(gid, brandName.get(gid) ?? "Unbranded").lines,
              total_value: makeGroup(gid, brandName.get(gid) ?? "Unbranded").total,
              bonus_value: makeGroup(gid, brandName.get(gid) ?? "Unbranded").bonus,
            }))
          : [];

      const total = round2(groupIds.reduce((s, gid) => s + makeGroup(gid, "").total, 0));
      const bonus = round2(groupIds.reduce((s, gid) => s + makeGroup(gid, "").bonus, 0));
      return {
        salesman_id: sid,
        salesman_name: salesmanName.get(sid) ?? "Salesman",
        customers,
        brands,
        total_value: total,
        bonus_value: bonus,
      };
    });

  const grandTotal = round2(salesmen.reduce((s, g) => s + g.total_value, 0));
  const grandBonus = round2(salesmen.reduce((s, g) => s + g.bonus_value, 0));

  const orgName = filters.org?.name?.trim() ?? "";
  const orgCity = filters.org?.city?.trim() ?? "";
  const orgAddress = [filters.org?.address?.trim(), orgCity].filter(Boolean).join(", ") || "";
  const orgPhone = filters.org?.phone?.trim() ?? "";

  return {
    ok: true,
    summary: {
      org_name: orgName,
      org_address: orgAddress,
      org_phone: orgPhone,
      groupBy,
      groupBySalesman,
      salesmen,
      grand_total: grandTotal,
      grand_bonus: grandBonus,
      grand_net: round2(grandTotal - grandBonus),
    },
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}