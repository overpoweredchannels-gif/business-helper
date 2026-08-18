// TradeOS ERP — Sales Invoice aggregation service.
//
// Reads confirmed sales transactions + line items + products + customers and
// assembles per-invoice documents that the SalesInvoiceDocument renderer
// prints. Supports filtering by customer, salesman (created_by_profile_id),
// date range, area (customers.area), route (sales_route_stops), and city.
//
// Read-only: never mutates data.

import { SupabaseClient } from "@supabase/supabase-js";

export interface SalesInvoiceFilters {
  organizationId: string;
  /** Restrict by customer ids (OR). */
  customerIds?: string[];
  /** Restrict by salesman profile ids - created_by_profile_id (OR). */
  salesmanIds?: string[];
  /** Restrict by sales route ids (customers on those routes). */
  routeIds?: string[];
  /** Restrict by customer area names (OR). */
  areas?: string[];
  /** Restrict by customer city names (OR). */
  cities?: string[];
  /** Inclusive lower bound on sale_date (YYYY-MM-DD). */
  dateFrom?: string | null;
  /** Inclusive upper bound on sale_date (YYYY-MM-DD). */
  dateTo?: string | null;
  /** Organization branding (name/address/city/phone) for the printed header. */
  org?: { name?: string; address?: string; city?: string; phone?: string } | null;
}

export interface SalesInvoiceLine {
  product_id: string | number;
  product_name: string;
  unit_type: string | null;
  subunit_type: string | null;
  /** Main unit label, e.g. "Cotton". */
  main_unit_label: string;
  /** Subunit label, e.g. "Boxes". */
  subunit_unit_label: string;
  unit_mode: "main" | "subunit" | null;
  quantity: number;
  /** Quantity with the unit label it was sold in, e.g. "5 Cotton" or "10 Boxes". */
  quantity_text: string;
  selling_price: number;
  discount: number;
  line_total: number;
}

export interface SalesInvoiceDoc {
  transaction_id: string;
  invoice_number: string;
  sale_date: string | null;
  payment_type: string | null;
  total_amount: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  credit_due_date: string | null;
  customer_id: string | null;
  customer_name: string;
  shop_name: string | null;
  customer_city: string | null;
  customer_area: string | null;
  customer_phone: string | null;
  salesman_id: string | null;
  salesman_name: string;
  /** Organization branding for the printed header/footer. */
  org_name: string;
  org_address: string;
  org_phone: string;
  lines: SalesInvoiceLine[];
  /** Grand total (after invoice-level discount + tax). */
  grand_total: number;
  /** Discount amount (used by the renderer's secondary footer total). */
  discount_total: number;
  /** Tax amount (used by the renderer's tertiary footer total). */
  tax_total: number;
}

export interface SalesInvoiceResult {
  ok: boolean;
  error?: string;
  docs?: SalesInvoiceDoc[];
}

const SALES_TRANSACTION_SELECT = `
  id, invoice_number, sale_date, created_at, payment_type, credit_due_date,
  total_amount, discount_amount, tax_rate, tax_amount,
  created_by_profile_id,
  customers(customer_name, shop_name, city, area, phone)
`;

export async function buildSalesInvoices(
  supabase: SupabaseClient,
  filters: SalesInvoiceFilters,
): Promise<SalesInvoiceResult> {
  if (!filters.organizationId) {
    return { ok: false, error: "Organization context required" };
  }

  try {
    // Resolve route -> customers so we can filter by route membership.
    let routeCustomerIds: string[] | null = null;
    if (filters.routeIds && filters.routeIds.length > 0) {
      const { data: stops } = await supabase
        .from("sales_route_stops")
        .select("customer_id")
        .eq("organization_id", filters.organizationId)
        .in("route_id", filters.routeIds);
      routeCustomerIds = [
        ...new Set((stops ?? []).map((s) => s.customer_id).filter((id): id is string => Boolean(id))),
      ];
    }

    let query = supabase
      .from("sales_transactions")
      .select(SALES_TRANSACTION_SELECT)
      .eq("organization_id", filters.organizationId)
      .in("status", ["confirmed", "paid", "partially_paid"]);

    if (filters.customerIds && filters.customerIds.length > 0) {
      query = query.in("customer_id", filters.customerIds);
    }
    if (routeCustomerIds && routeCustomerIds.length > 0) {
      query = query.in("customer_id", routeCustomerIds);
    }
    if (filters.salesmanIds && filters.salesmanIds.length > 0) {
      query = query.in("created_by_profile_id", filters.salesmanIds);
    }
    if (filters.areas && filters.areas.length > 0) {
      query = query.in("customers.area", filters.areas);
    }
    if (filters.cities && filters.cities.length > 0) {
      query = query.in("customers.city", filters.cities);
    }
    if (filters.dateFrom) {
      query = query.gte("sale_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte("sale_date", filters.dateTo);
    }

    const { data: transactions, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const txs = (transactions ?? []) as Array<Record<string, unknown>>;

    if (txs.length === 0) {
      return { ok: true, docs: [] };
    }

    const txIds = txs.map((t) => t.id as string);

    const [itemsRes, employeesRes] = await Promise.all([
      supabase
        .from("sales_items")
        .select(
          `sales_transaction_id, quantity, selling_price, discount, unit_mode, product_id,
           products!inner(name, unit_type, subunit_type)`,
        )
        .in("sales_transaction_id", txIds),
      supabase
        .from("employees")
        .select("profile_id, full_name")
        .eq("organization_id", filters.organizationId)
        .in(
          "profile_id",
          txs.map((t) => t.created_by_profile_id).filter((id): id is string => Boolean(id)),
        ),
    ]);

    const salesmanName = new Map<string, string>();
    for (const e of employeesRes.data ?? []) {
      if (e.profile_id) salesmanName.set(e.profile_id, e.full_name);
    }

    const itemsByTx = new Map<string, SalesInvoiceLine[]>();
    for (const item of itemsRes.data ?? []) {
      const txId = item.sales_transaction_id as string;
      const products = item.products as Array<{ name: string; unit_type: string | null; subunit_type: string | null }> | null;
      const product = products?.[0] ?? null;
      const mainLabel = product?.unit_type ?? "Units";
      const subLabel = product?.subunit_type ?? "Pcs";
      const unitMode: "main" | "subunit" | null =
        item.unit_mode === "subunit" ? "subunit" : item.unit_mode === "main" ? "main" : null;
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.selling_price) || 0;
      const discount = Number(item.discount) || 0;
      const line: SalesInvoiceLine = {
        product_id: item.product_id,
        product_name: product?.name ?? "Unknown Product",
        unit_type: product?.unit_type ?? null,
        subunit_type: product?.subunit_type ?? null,
        main_unit_label: mainLabel,
        subunit_unit_label: subLabel,
        unit_mode: unitMode,
        quantity,
        quantity_text: `${trim(quantity)} ${unitMode === "subunit" ? subLabel : mainLabel}`,
        selling_price: price,
        discount,
        line_total: round2(quantity * price - discount),
      };
      const list = itemsByTx.get(txId);
      if (list) list.push(line);
      else itemsByTx.set(txId, [line]);
    }

    const docs: SalesInvoiceDoc[] = txs.map((t) => {
      const customer = (t.customers ?? null) as
        | { customer_name: string; shop_name?: string | null; city?: string | null; area?: string | null; phone?: string | null }
        | null;
      const lines = (itemsByTx.get(t.id as string) ?? []).sort((a, b) =>
        a.product_name.localeCompare(b.product_name),
      );
      const totalAmount = Number(t.total_amount);
      const invoiceTotal = Number.isFinite(totalAmount) && totalAmount > 0
        ? totalAmount
        : round2(lines.reduce((s, l) => s + l.line_total, 0));
      const discountAmount = Number(t.discount_amount) || 0;
      const taxRate = Number(t.tax_rate) || 0;
      const taxAmount = Number(t.tax_amount) || 0;
      const netTotal = round2(invoiceTotal - discountAmount + taxAmount);
      const salesmanId = (t.created_by_profile_id as string) ?? null;

      return {
        transaction_id: t.id as string,
        invoice_number: (t.invoice_number as string) ?? "-",
        sale_date: (t.sale_date as string) ?? null,
        payment_type: (t.payment_type as string) ?? "cash",
        total_amount: invoiceTotal,
        discount_amount: discountAmount,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        credit_due_date: (t.credit_due_date as string) ?? null,
        customer_id: (t.customer_id as string) ?? null,
        customer_name: customer?.customer_name ?? "Unknown Customer",
        shop_name: customer?.shop_name ?? null,
        customer_city: customer?.city ?? null,
        customer_area: customer?.area ?? null,
        customer_phone: customer?.phone ?? null,
        salesman_id: salesmanId,
        salesman_name: salesmanId ? (salesmanName.get(salesmanId) ?? "Salesman") : "Salesman",
        org_name: filters.org?.name?.trim() ?? "",
        org_address: [filters.org?.address?.trim(), filters.org?.city?.trim()].filter(Boolean).join(", ") || "",
        org_phone: filters.org?.phone?.trim() ?? "",
        lines,
        grand_total: invoiceTotal,
        discount_total: discountAmount,
        tax_total: taxAmount,
      } satisfies SalesInvoiceDoc;
    });

    docs.sort((a, b) => {
      const d = String(a.sale_date ?? "").localeCompare(String(b.sale_date ?? ""));
      return d !== 0 ? d : String(a.invoice_number).localeCompare(String(b.invoice_number));
    });

    return { ok: true, docs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load sales invoices" };
  }
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}