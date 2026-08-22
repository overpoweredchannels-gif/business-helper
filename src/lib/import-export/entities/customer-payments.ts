// TradeOS ERP — Customer Payments Import Config

import type { EntityImportConfig, ImportFieldDef, ImportContext } from "../types";

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

function parsePaymentMethod(raw: string): "cash" | "bank" | "other" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "cash") return "cash";
  if (normalized === "bank") return "bank";
  if (normalized === "other") return "other";
  return null;
}

export const customerPaymentsImportConfig: EntityImportConfig = {
  entityKey: "customer_payments",
  entityName: "Customer Payments",
  tableName: "customer_payments",
  existingColumns: "id, customer_id, amount, payment_date, payment_method, reference_number, notes, created_by_profile_id",
  
  fields: [
    { key: "customer", label: "Customer", type: "select", required: true, preview: true, width: 180, options: async () => [], help: "Customer name (required)." },
    { key: "amount", label: "Amount", type: "decimal", required: true, preview: true, width: 120, parse: parseNumber, help: "Payment amount." },
    { key: "payment_date", label: "Payment Date", type: "date", required: true, preview: true, width: 110, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; }, help: "YYYY-MM-DD." },
    { key: "payment_method", label: "Method", type: "select", required: true, preview: true, width: 100, parse: parsePaymentMethod, options: ["cash", "bank", "other"], defaultValue: "cash" },
    { key: "reference_number", label: "Reference #", type: "text", required: false, preview: true, width: 140, help: "Bank ref, cheque no, etc." },
    { key: "notes", label: "Notes", type: "text", required: false, preview: false },
    { key: "created_by", label: "Recorded By", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Staff who recorded payment." },
  ],

  uniqueKeys: [], // Payments can have same customer/date/amount
  defaultDuplicateMode: "error",
  allowCreateReferences: false,
  maxRows: 5000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const customerId = v.customer ? await resolveRef(ctx, "customers", v.customer as string, "customer_name") : null;
    const createdById = v.created_by ? await resolveRef(ctx, "profiles", v.created_by as string, "display_name") : null;
    
    if (!customerId) throw new Error("Customer not found: " + v.customer);
    
    return {
      customer_id: customerId,
      amount: v.amount as number,
      payment_date: v.payment_date as string,
      payment_method: v.payment_method as "cash" | "bank" | "other",
      reference_number: v.reference_number ? String(v.reference_number).trim() : null,
      notes: v.notes ? String(v.notes).trim() : null,
      created_by_profile_id: createdById ?? ctx.actorProfileId ?? null,
      organization_id: ctx.orgId,
    };
  },

  async findExisting(row, ctx) {
    // Payments don't have natural unique key - treat as new always
    return null;
  },

  export: {
    filenamePrefix: "customer_payments_export",
    columns: [
      { key: "payment_date", label: "Date" },
      { key: "customer", label: "Customer", transform: (v) => (v as any)?.customer_name ?? "" },
      { key: "amount", label: "Amount" },
      { key: "payment_method", label: "Method" },
      { key: "reference_number", label: "Reference" },
      { key: "notes", label: "Notes" },
      { key: "created_by", label: "Recorded By", transform: (v) => (v as any)?.display_name ?? "" },
    ],
    async fetchData(orgId, filters) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      let query = supabase
        .from("customer_payments")
        .select(`
          id, amount, payment_date, payment_method, reference_number, notes,
          customer:customers(customer_name),
          created_by:profiles!created_by_profile_id(display_name)
        `)
        .eq("organization_id", orgId);
      
      if (filters.dateFrom) query = query.gte("payment_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("payment_date", filters.dateTo);
      if (filters.customerIds?.length) query = query.in("customer_id", filters.customerIds);
      
      const { data, error } = await query.order("payment_date", { ascending: false });
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
    const { data } = await ctx.supabase
      .from(table)
      .select(`id, ${nameColumn}`)
      .eq("organization_id", ctx.orgId);
    for (const row of data ?? []) {
      cache.set(String(row[nameColumn]).trim().toLowerCase(), row.id);
    }
  }
  
  if (cache.has(key)) return cache.get(key)!;
  
  return null;
}
