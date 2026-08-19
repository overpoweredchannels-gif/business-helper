// TradeOS ERP — Customer Credit Import Config

import type { EntityImportConfig, ImportFieldDef, ImportContext } from "../types";

function parseNumber(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export const customerCreditImportConfig: EntityImportConfig = {
  entityKey: "customer_credit",
  entityName: "Customer Credit",
  tableName: "customer_credit",
  existingColumns: "id, customer_id, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, credit_policy",
  
  fields: [
    { key: "customer", label: "Customer", type: "select", required: true, preview: true, width: 180, options: async () => [], help: "Customer name (required)." },
    { key: "credit_limit", label: "Credit Limit", type: "decimal", required: false, preview: true, width: 120, parse: (s) => parseNumber(s), help: "Maximum credit allowed (0 = unlimited)." },
    { key: "credit_days", label: "Credit Days", type: "integer", required: false, preview: true, width: 90, parse: (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; }, help: "Payment due days." },
    { key: "allow_over_limit", label: "Allow Over Limit", type: "boolean", required: false, preview: true, width: 110, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null, defaultValue: false },
    { key: "allow_overdue_sales", label: "Allow Overdue Sales", type: "boolean", required: false, preview: true, width: 130, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null, defaultValue: false },
    { key: "credit_policy", label: "Credit Policy", type: "select", required: false, preview: true, width: 120, options: ["strict", "flexible", "none"], defaultValue: "flexible" },
  ],

  uniqueKeys: [["customer"]],
  defaultDuplicateMode: "update",
  allowCreateReferences: false,
  maxRows: 5000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const customerId = v.customer ? await resolveRef(ctx, "customers", v.customer as string) : null;
    
    if (!customerId) throw new Error("Customer not found: " + v.customer);
    
    return {
      customer_id: customerId,
      credit_limit: v.credit_limit as number | null,
      credit_days: v.credit_days as number | null,
      allow_over_limit: v.allow_over_limit as boolean ?? false,
      allow_overdue_sales: v.allow_overdue_sales as boolean ?? false,
      credit_policy: v.credit_policy as "strict" | "flexible" | "none" ?? "flexible",
      organization_id: ctx.orgId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.customer) return null;
    const customerId = await resolveRef(ctx, "customers", v.customer as string);
    if (!customerId) return null;
    const { data } = await ctx.supabase
      .from("customer_credit")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("customer_id", customerId)
      .maybeSingle();
    return data as any;
  },

  async applyUpdate(existing, payload, ctx) {
    const { error } = await ctx.supabase
      .from("customer_credit")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  export: {
    filenamePrefix: "customer_credit_export",
    columns: [
      { key: "customer", label: "Customer", transform: (v) => (v as any)?.customer_name ?? "" },
      { key: "credit_limit", label: "Credit Limit" },
      { key: "credit_days", label: "Credit Days" },
      { key: "allow_over_limit", label: "Allow Over Limit", transform: (v) => v ? "Yes" : "No" },
      { key: "allow_overdue_sales", label: "Allow Overdue Sales", transform: (v) => v ? "Yes" : "No" },
      { key: "credit_policy", label: "Credit Policy" },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("customer_credit")
        .select(`
          id, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, credit_policy,
          customers(customer_name)
        `)
        .eq("organization_id", orgId);
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
    const selectCol = table === "customers" ? "id, customer_name" : "id, name";
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
