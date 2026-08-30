// TradeOS ERP — Sales Invoices Import Config
//
// Imports full sales invoices with line items. This is the most complex entity
// because it involves parent (sales_transactions) + children (sales_items).

import type { EntityImportConfig, ImportContext } from "../types";
import { generateInvoiceNumberWithClient } from "@/lib/invoices/invoice-number-service";

function parseNumber(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

function parsePaymentType(raw: string): "cash" | "credit" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "cash") return "cash";
  if (normalized === "credit") return "credit";
  return null;
}

export const salesInvoicesImportConfig: EntityImportConfig = {
  entityKey: "sales_invoices",
  entityName: "Sales Invoices",
  tableName: "sales_transactions",
  existingColumns: "id, invoice_number, customer_id, sale_date, payment_type, total_amount, discount_amount, tax_rate, tax_amount, credit_due_date, status, created_by_profile_id, notes",
  
  // Invoice header fields (one row per invoice in the file)
  fields: [
    { key: "invoice_number", label: "Invoice Number", type: "text", required: false, unique: true, preview: true, width: 140, help: "Auto-generated if blank." },
    { key: "customer", label: "Customer", type: "select", required: true, preview: true, width: 180, options: async () => [], help: "Customer name (required)." },
    { key: "sale_date", label: "Sale Date", type: "date", required: true, preview: true, width: 110, parse: parseDate, help: "YYYY-MM-DD format." },
    { key: "payment_type", label: "Payment Type", type: "select", required: true, preview: true, width: 100, parse: parsePaymentType, options: ["cash", "credit"], help: "Cash or Credit." },
    { key: "total_amount", label: "Total Amount", type: "decimal", required: false, preview: true, width: 120, parse: (s) => parseNumber(s), help: "Invoice total (auto-calc if blank)." },
    { key: "discount_amount", label: "Discount", type: "decimal", required: false, preview: true, width: 100, parse: (s) => parseNumber(s), defaultValue: 0, help: "Invoice-level discount." },
    { key: "tax_rate", label: "Tax Rate %", type: "decimal", required: false, preview: true, width: 90, defaultValue: 0, parse: (s) => parseNumber(s), help: "Tax percentage." },
    { key: "tax_amount", label: "Tax Amount", type: "decimal", required: false, preview: true, width: 100, parse: (s) => parseNumber(s), defaultValue: 0 },
    { key: "credit_due_date", label: "Credit Due Date", type: "date", required: false, preview: true, width: 110, parse: parseDate, help: "Required for credit sales." },
    { key: "salesman", label: "Salesman", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Salesman name." },
    { key: "status", label: "Status", type: "select", required: false, preview: true, width: 120, defaultValue: "confirmed", options: ["draft", "confirmed", "paid", "partially_paid", "cancelled", "void"], help: "Invoice status." },
    { key: "notes", label: "Notes", type: "text", required: false, preview: false, help: "Internal notes." },
    // Line item fields (repeated per line - handled specially)
    { key: "line_product", label: "Product", type: "select", required: true, preview: false, options: async () => [], help: "Product name per line." },
    { key: "line_quantity", label: "Quantity", type: "decimal", required: true, preview: false, parse: (s) => parseNumber(s) },
    { key: "line_unit_mode", label: "Unit Mode", type: "select", required: false, preview: false, defaultValue: "main", options: ["main", "subunit"], help: "Main or subunit." },
    { key: "line_price", label: "Unit Price", type: "decimal", required: true, preview: false, parse: (s) => parseNumber(s) },
    { key: "line_discount", label: "Line Discount", type: "decimal", required: false, preview: false, defaultValue: 0, parse: (s) => parseNumber(s) },
    { key: "line_bonus", label: "Bonus Qty", type: "decimal", required: false, preview: false, defaultValue: 0, parse: (s) => parseNumber(s) },
    { key: "line_batch", label: "Batch Number", type: "text", required: false, preview: false },
    { key: "line_expiry", label: "Expiry Date", type: "date", required: false, preview: false, parse: (s) => parseDate(s) },
  ],

  uniqueKeys: [["invoice_number"]],
  defaultDuplicateMode: "error", // Invoices should not duplicate by default
  allowCreateReferences: true,
  maxRows: 1000,

  // Custom handling for invoice + lines - will be handled in processor
  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const customerId = v.customer ? await resolveRef(ctx, "customers", v.customer as string, "customer_name") : null;
    const salesmanId = v.salesman ? await resolveRef(ctx, "employees", v.salesman as string, "full_name") : null;
    if (!customerId) throw new Error(`Customer not found: ${String(v.customer ?? "")}`);
    const invoiceNumber = v.invoice_number
      ? String(v.invoice_number).trim()
      : await generateInvoiceNumberWithClient(ctx.supabase as never, ctx.orgId, "sales");
    
    return {
      invoice_number: invoiceNumber,
      customer_id: customerId,
      sale_date: v.sale_date as string,
      payment_type: v.payment_type as "cash" | "credit",
      total_amount: v.total_amount as number | null,
      discount_amount: v.discount_amount as number ?? 0,
      tax_rate: v.tax_rate as number ?? 0,
      tax_amount: v.tax_amount as number ?? 0,
      credit_due_date: v.credit_due_date as string | null,
      status: v.status as string ?? "confirmed",
      created_by_profile_id: salesmanId ?? ctx.actorProfileId ?? null,
      notes: v.notes ? String(v.notes).trim() : null,
      invoice_type: "sales",
      organization_id: ctx.orgId,
    };
  },

  async createRecord(row, payload, ctx) {
    const v = row.values as Record<string, unknown>;
    const productId = v.line_product ? await resolveRef(ctx, "products", String(v.line_product), "name") : null;
    if (!productId) throw new Error(`Product not found: ${String(v.line_product ?? "")}`);

    const transaction = await ctx.supabase
      .from("sales_transactions")
      .insert({ ...payload, organization_id: ctx.orgId })
      .select("id")
      .single();
    if (transaction.error || !transaction.data?.id) throw transaction.error ?? new Error("Failed to create sales invoice");

    const item = await ctx.supabase.from("sales_items").insert({
      sales_transaction_id: transaction.data.id,
      organization_id: ctx.orgId,
      product_id: productId,
      quantity: Number(v.line_quantity),
      selling_price: Number(v.line_price),
      purchase_price_snapshot: null,
      discount: Number(v.line_discount ?? 0),
      bonus: Number(v.line_bonus ?? 0),
      unit_mode: String(v.line_unit_mode ?? "main"),
    });
    if (item.error) {
      await ctx.supabase.from("sales_transactions").delete().eq("id", transaction.data.id).eq("organization_id", ctx.orgId);
      throw item.error;
    }
    return transaction.data;
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.invoice_number) return null;
    const { data } = await ctx.supabase
      .from("sales_transactions")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("invoice_number", String(v.invoice_number).trim())
      .maybeSingle();
    return data as any;
  },

  export: {
    filenamePrefix: "sales_invoices_export",
    columns: [
      { key: "invoice_number", label: "Invoice #" },
      { key: "sale_date", label: "Date" },
      { key: "customer", label: "Customer", transform: (v) => (v as any)?.customer_name ?? "" },
      { key: "customer", label: "Shop", transform: (v) => (v as any)?.shop_name ?? "" },
      { key: "salesman", label: "Salesman", transform: (v) => (v as any)?.display_name ?? "" },
      { key: "payment_type", label: "Payment" },
      { key: "total_amount", label: "Total" },
      { key: "discount_amount", label: "Discount" },
      { key: "tax_rate", label: "Tax %" },
      { key: "tax_amount", label: "Tax" },
      { key: "credit_due_date", label: "Due Date" },
      { key: "status", label: "Status" },
    ],
    async fetchData(orgId, filters) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      let query = supabase
        .from("sales_transactions")
        .select(`
          id, invoice_number, sale_date, payment_type, total_amount,
          discount_amount, tax_rate, tax_amount, credit_due_date, status,
          customer:customers(customer_name, shop_name),
          salesman:profiles!created_by_profile_id(display_name)
        `)
        .eq("organization_id", orgId)
        .eq("invoice_type", "sales");
      
      if (filters.dateFrom) query = query.gte("sale_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("sale_date", filters.dateTo);
      if (filters.customerIds?.length) query = query.in("customer_id", filters.customerIds);
      if (filters.salesmanIds?.length) query = query.in("created_by_profile_id", filters.salesmanIds);
      
      const { data, error } = await query.order("sale_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  },
};

async function resolveRef(ctx: ImportContext, table: string, name: string, nameColumn = "name"): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  
  let cache = ctx.refCaches.get(table);
  if (!cache) {
    cache = new Map();
    ctx.refCaches.set(table, cache);
    const selectCol = table === "employees" ? "profile_id, full_name" : `id, ${nameColumn}`;
    const { data } = await ctx.supabase
      .from(table)
      .select(selectCol)
      .eq("organization_id", ctx.orgId);
    for (const row of data ?? []) {
      const referencedId = table === "employees" ? row.profile_id : row.id;
      if (referencedId) cache.set(String(row[nameColumn]).trim().toLowerCase(), referencedId);
    }
  }
  
  if (cache.has(name.trim().toLowerCase())) return cache.get(name.trim().toLowerCase())!;
  
  return null;
}
