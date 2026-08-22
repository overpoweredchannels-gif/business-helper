// TradeOS ERP — Supplier Payments Import Config

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

export const supplierPaymentsImportConfig: EntityImportConfig = {
  entityKey: "supplier_payments",
  entityName: "Supplier Payments",
  tableName: "supplier_payments",
  existingColumns: "id, supplier_id, amount, payment_date, payment_method, reference_number, notes, created_by_profile_id",
  
  fields: [
    { key: "supplier", label: "Supplier", type: "select", required: true, preview: true, width: 180, options: async () => [], help: "Supplier name (required)." },
    { key: "amount", label: "Amount", type: "decimal", required: true, preview: true, width: 120, parse: parseNumber, help: "Payment amount." },
    { key: "payment_date", label: "Payment Date", type: "date", required: true, preview: true, width: 110, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; } },
    { key: "payment_method", label: "Method", type: "select", required: true, preview: true, width: 100, parse: (s) => { const n = s?.trim().toLowerCase(); if (n === "cash") return "cash"; if (n === "bank") return "bank"; if (n === "other") return "other"; return null; }, options: ["cash", "bank", "other"], defaultValue: "cash" },
    { key: "reference_number", label: "Reference #", type: "text", required: false, preview: true, width: 140, help: "Bank ref, cheque no, etc." },
    { key: "notes", label: "Notes", type: "text", required: false, preview: false },
    { key: "created_by", label: "Recorded By", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Staff who recorded payment." },
  ],

  uniqueKeys: [],
  defaultDuplicateMode: "error",
  allowCreateReferences: false,
  maxRows: 5000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const supplierId = v.supplier ? await resolveRef(ctx, "suppliers", v.supplier as string, "supplier_name") : null;
    const createdById = v.created_by ? await resolveRef(ctx, "profiles", v.created_by as string, "display_name") : null;
    
    if (!supplierId) throw new Error("Supplier not found: " + v.supplier);
    
    return {
      supplier_id: supplierId,
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
    return null;
  },

  export: {
    filenamePrefix: "supplier_payments_export",
    columns: [
      { key: "payment_date", label: "Date" },
      { key: "supplier", label: "Supplier", transform: (v) => (v as any)?.supplier_name ?? "" },
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
        .from("supplier_payments")
        .select(`
          id, amount, payment_date, payment_method, reference_number, notes,
          supplier:suppliers(supplier_name),
          created_by:profiles!created_by_profile_id(display_name)
        `)
        .eq("organization_id", orgId);
      
      if (filters.dateFrom) query = query.gte("payment_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("payment_date", filters.dateTo);
      if (filters.supplierIds?.length) query = query.in("supplier_id", filters.supplierIds);
      
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
