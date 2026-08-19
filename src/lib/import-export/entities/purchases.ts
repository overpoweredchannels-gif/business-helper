// TradeOS ERP — Purchases Import Config

import type { EntityImportConfig, ParsedRow, ImportContext } from "../types";

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

export const purchasesImportConfig: EntityImportConfig = {
  entityKey: "purchases",
  entityName: "Purchase Invoices",
  tableName: "purchase_transactions",
  existingColumns: "id, invoice_number, supplier_id, purchase_date, payment_type, total_amount, discount_amount, tax_rate, tax_amount, credit_due_date, status, created_by_profile_id, notes, supplier_invoice_number",
  
  fields: [
    { key: "invoice_number", label: "Invoice Number", type: "text", required: false, unique: true, preview: true, width: 140, help: "Auto-generated if blank." },
    { key: "supplier_invoice_number", label: "Supplier Invoice #", type: "text", required: false, preview: true, width: 140, help: "Supplier's own invoice number." },
    { key: "supplier", label: "Supplier", type: "select", required: true, preview: true, width: 180, options: async () => [], help: "Supplier name (required)." },
    { key: "purchase_date", label: "Purchase Date", type: "date", required: true, preview: true, width: 110, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; }, help: "YYYY-MM-DD format." },
    { key: "payment_type", label: "Payment Type", type: "select", required: true, preview: true, width: 100, parse: (s) => { const n = s?.trim().toLowerCase(); if (n === "cash") return "cash"; if (n === "credit") return "credit"; return null; }, options: ["cash", "credit"] },
    { key: "total_amount", label: "Total Amount", type: "decimal", required: false, preview: true, width: 120, parse: (s) => parseNumber(s) },
    { key: "discount_amount", label: "Discount", type: "decimal", required: false, preview: true, width: 100, parse: (s) => parseNumber(s), defaultValue: 0 },
    { key: "tax_rate", label: "Tax Rate %", type: "decimal", required: false, preview: true, width: 90, defaultValue: 0, parse: (s) => parseNumber(s) },
    { key: "tax_amount", label: "Tax Amount", type: "decimal", required: false, preview: true, width: 100, parse: (s) => parseNumber(s), defaultValue: 0 },
    { key: "credit_due_date", label: "Credit Due Date", type: "date", required: false, preview: true, width: 110, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; } },
    { key: "status", label: "Status", type: "select", required: false, preview: true, width: 120, defaultValue: "confirmed", options: ["draft", "confirmed", "paid", "partially_paid", "cancelled", "void"] },
    { key: "created_by", label: "Created By", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Staff name." },
    { key: "notes", label: "Notes", type: "text", required: false, preview: false },
    // Line items
    { key: "line_product", label: "Product", type: "select", required: true, preview: false, options: async () => [] },
    { key: "line_quantity", label: "Quantity", type: "decimal", required: true, preview: false, parse: (s) => parseNumber(s) },
    { key: "line_unit_mode", label: "Unit Mode", type: "select", required: false, preview: false, defaultValue: "main", options: ["main", "subunit"] },
    { key: "line_price", label: "Unit Price", type: "decimal", required: true, preview: false, parse: (s) => parseNumber(s) },
    { key: "line_discount", label: "Line Discount", type: "decimal", required: false, preview: false, defaultValue: 0, parse: (s) => parseNumber(s) },
    { key: "line_batch", label: "Batch Number", type: "text", required: false, preview: false },
    { key: "line_expiry", label: "Expiry Date", type: "date", required: false, preview: false, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; } },
    // Expenses linked to purchase
    { key: "expense_type", label: "Expense Type", type: "text", required: false, preview: false },
    { key: "expense_amount", label: "Expense Amount", type: "decimal", required: false, preview: false, parse: (s) => parseNumber(s) },
  ],

  uniqueKeys: [["invoice_number"]],
  defaultDuplicateMode: "error",
  allowCreateReferences: true,
  maxRows: 1000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const supplierId = v.supplier ? await resolveRef(ctx, "suppliers", v.supplier as string) : null;
    const createdById = v.created_by ? await resolveRef(ctx, "profiles", v.created_by as string, "name") : null;
    
    return {
      invoice_number: v.invoice_number ? String(v.invoice_number).trim() : null,
      supplier_invoice_number: v.supplier_invoice_number ? String(v.supplier_invoice_number).trim() : null,
      supplier_id: supplierId,
      purchase_date: v.purchase_date as string,
      payment_type: v.payment_type as "cash" | "credit",
      total_amount: v.total_amount as number | null,
      discount_amount: v.discount_amount as number ?? 0,
      tax_rate: v.tax_rate as number ?? 0,
      tax_amount: v.tax_amount as number ?? 0,
      credit_due_date: v.credit_due_date as string | null,
      status: v.status as string ?? "confirmed",
      created_by_profile_id: createdById ?? ctx.actorProfileId ?? null,
      notes: v.notes ? String(v.notes).trim() : null,
      invoice_type: "purchase",
      organization_id: ctx.orgId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.invoice_number) return null;
    const { data } = await ctx.supabase
      .from("purchase_transactions")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("invoice_number", String(v.invoice_number).trim())
      .maybeSingle();
    return data as any;
  },

  export: {
    filenamePrefix: "purchases_export",
    columns: [
      { key: "invoice_number", label: "Invoice #" },
      { key: "supplier_invoice_number", label: "Supplier Invoice #" },
      { key: "purchase_date", label: "Date" },
      { key: "supplier", label: "Supplier", transform: (v) => (v as any)?.supplier_name ?? "" },
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
        .from("purchase_transactions")
        .select(`
          id, invoice_number, supplier_invoice_number, purchase_date, payment_type,
          total_amount, discount_amount, tax_rate, tax_amount, credit_due_date, status,
          suppliers(supplier_name),
          profiles!created_by_profile_id(name)
        `)
        .eq("organization_id", orgId)
        .eq("invoice_type", "purchase");
      
      if (filters.dateFrom) query = query.gte("purchase_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("purchase_date", filters.dateTo);
      
      const { data, error } = await query.order("purchase_date", { ascending: false });
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
    const selectCol = table === "profiles" ? "id, name" : "id, name";
    const { data } = await ctx.supabase
      .from(table)
      .select(selectCol)
      .eq("organization_id", ctx.orgId);
    for (const row of data ?? []) {
      cache.set(String(row[nameColumn]).trim().toLowerCase(), row.id);
    }
  }
  
  if (cache.has(key)) return cache.get(key)!;
  
  return null;
}