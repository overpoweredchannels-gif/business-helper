// TradeOS ERP — Customers Import Config

import type { EntityImportConfig, ParsedRow, ImportContext } from "../types";

function parseNumber(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

function parseCreditPolicy(raw: string): "strict" | "flexible" | "none" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "strict") return "strict";
  if (normalized === "flexible") return "flexible";
  if (normalized === "none") return "none";
  return null;
}

function parsePaymentMethod(raw: string): "cash" | "bank" | "other" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "cash") return "cash";
  if (normalized === "bank") return "bank";
  if (normalized === "other") return "other";
  return null;
}

export const customersImportConfig: EntityImportConfig = {
  entityKey: "customers",
  entityName: "Customers",
  tableName: "customers",
  existingColumns: "id, customer_name, shop_name, phone, whatsapp, city, area, address, shipping_address, contact_person, organization_name, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, is_active, notes, assigned_salesman_id, assigned_territory_id",
  
  fields: [
    { key: "customer_name", label: "Customer Name", type: "text", required: true, unique: true, preview: true, width: 180, help: "Required. Unique identifier." },
    { key: "shop_name", label: "Shop Name", type: "text", required: false, preview: true, width: 160, help: "Optional business/shop name." },
    { key: "organization_name", label: "Organization Name", type: "text", required: false, preview: true, width: 160, help: "Company/organization name." },
    { key: "contact_person", label: "Contact Person", type: "text", required: false, preview: true, width: 140, help: "Contact person at the customer." },
    { key: "phone", label: "Phone", type: "text", required: false, preview: true, width: 130, help: "Primary phone number." },
    { key: "whatsapp", label: "WhatsApp", type: "text", required: false, preview: true, width: 130, help: "WhatsApp number." },
    { key: "city", label: "City", type: "text", required: false, preview: true, width: 120, help: "City for filtering." },
    { key: "area", label: "Area", type: "text", required: false, preview: true, width: 120, help: "Area/neighborhood." },
    { key: "address", label: "Address", type: "text", required: false, preview: false, width: 200, help: "Billing/primary address." },
    { key: "shipping_address", label: "Shipping Address", type: "text", required: false, preview: false, width: 200, help: "Shipping address (if different)." },
    { key: "customer_type", label: "Customer Type", type: "select", required: false, preview: true, width: 120, options: ["regular", "wholesale", "retail", "distributor", "institutional"], help: "Type of customer." },
    { key: "credit_policy", label: "Credit Policy", type: "select", required: false, preview: true, width: 120, options: ["strict", "flexible", "none"], help: "Credit terms policy." },
    { key: "credit_limit", label: "Credit Limit", type: "decimal", required: false, preview: true, width: 110, parse: parseNumber, help: "Maximum credit allowed." },
    { key: "credit_days", label: "Credit Days", type: "integer", required: false, preview: true, width: 90, parse: parseNumber, help: "Payment due days." },
    { key: "allow_over_limit", label: "Allow Over Limit", type: "boolean", required: false, preview: true, width: 110, parse: parseBool, defaultValue: false },
    { key: "allow_overdue_sales", label: "Allow Overdue Sales", type: "boolean", required: false, preview: true, width: 130, parse: parseBool, defaultValue: false },
    { key: "preferred_payment_method", label: "Preferred Payment", type: "select", required: false, preview: true, width: 130, options: ["cash", "bank", "other"], help: "Default payment method." },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, parse: (s) => parseBool(s) ?? true, defaultValue: true },
    { key: "notes", label: "Notes", type: "text", required: false, preview: false, help: "Internal notes." },
    { key: "assigned_salesman", label: "Assigned Salesman", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Salesman name (auto-resolved)." },
    { key: "assigned_territory", label: "Assigned Territory", type: "select", required: false, preview: true, width: 140, options: async () => [], help: "Territory name (auto-resolved)." },
  ],

  uniqueKeys: [
    ["customer_name"],
    ["phone"],
  ],

  defaultDuplicateMode: "skip",
  allowCreateReferences: true,
  maxRows: 5000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const salesmanId = v.assigned_salesman ? await resolveRef(ctx, "employees", v.assigned_salesman as string, "full_name") : null;
    const territoryId = v.assigned_territory ? await resolveRef(ctx, "territories", v.assigned_territory as string) : null;

    return {
      customer_name: String(v.customer_name ?? "").trim(),
      shop_name: v.shop_name ? String(v.shop_name).trim() : null,
      organization_name: v.organization_name ? String(v.organization_name).trim() : null,
      contact_person: v.contact_person ? String(v.contact_person).trim() : null,
      phone: v.phone ? String(v.phone).trim() : null,
      whatsapp: v.whatsapp ? String(v.whatsapp).trim() : null,
      city: v.city ? String(v.city).trim() : null,
      area: v.area ? String(v.area).trim() : null,
      address: v.address ? String(v.address).trim() : null,
      shipping_address: v.shipping_address ? String(v.shipping_address).trim() : null,
      customer_type: v.customer_type ? String(v.customer_type).trim() : null,
      credit_policy: v.credit_policy as "strict" | "flexible" | "none" | null,
      credit_limit: v.credit_limit as number | null,
      credit_days: v.credit_days as number | null,
      allow_over_limit: v.allow_over_limit as boolean ?? false,
      allow_overdue_sales: v.allow_overdue_sales as boolean ?? false,
      preferred_payment_method: v.preferred_payment_method as "cash" | "bank" | "other" | null,
      is_active: v.is_active as boolean ?? true,
      notes: v.notes ? String(v.notes).trim() : null,
      assigned_salesman_id: salesmanId,
      assigned_territory_id: territoryId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const supabase = ctx.supabase;
    
    if (v.customer_name) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("customer_name", String(v.customer_name).trim())
        .maybeSingle();
      if (data) return data as any;
    }
    
    if (v.phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("phone", String(v.phone).trim())
        .maybeSingle();
      if (data) return data as any;
    }
    
    return null;
  },

  async applyUpdate(existing, payload, ctx) {
    const supabase = ctx.supabase;
    const { error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  export: {
    filenamePrefix: "customers_export",
    columns: [
      { key: "customer_name", label: "Customer Name" },
      { key: "shop_name", label: "Shop Name" },
      { key: "organization_name", label: "Organization Name" },
      { key: "contact_person", label: "Contact Person" },
      { key: "phone", label: "Phone" },
      { key: "whatsapp", label: "WhatsApp" },
      { key: "city", label: "City" },
      { key: "area", label: "Area" },
      { key: "address", label: "Address" },
      { key: "shipping_address", label: "Shipping Address" },
      { key: "customer_type", label: "Type" },
      { key: "credit_policy", label: "Credit Policy" },
      { key: "credit_limit", label: "Credit Limit" },
      { key: "credit_days", label: "Credit Days" },
      { key: "allow_over_limit", label: "Allow Over Limit", transform: (v) => v ? "Yes" : "No" },
      { key: "allow_overdue_sales", label: "Allow Overdue Sales", transform: (v) => v ? "Yes" : "No" },
      { key: "preferred_payment_method", label: "Preferred Payment" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      { key: "assigned_salesman", label: "Salesman", transform: (v) => (v as any)?.full_name ?? "" },
      { key: "assigned_territory", label: "Territory", transform: (v) => (v as any)?.name ?? "" },
      { key: "notes", label: "Notes" },
    ],
    async fetchData(orgId, filters) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      let query = supabase
        .from("customers")
        .select(`
          id, customer_name, shop_name, organization_name, contact_person, phone, whatsapp, city, area, address, shipping_address,
          customer_type, credit_policy, credit_limit, credit_days,
          allow_over_limit, allow_overdue_sales, preferred_payment_method,
          is_active, notes,
          employees!assigned_salesman_id(full_name),
          territories!assigned_territory_id(name)
        `)
        .eq("organization_id", orgId);
      
      if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
      if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
      
      const { data, error } = await query.order("customer_name", { ascending: true });
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
  
  if (ctx.createMissingRefs) {
    const { data, error } = await ctx.supabase
      .from(table)
      .insert({ organization_id: ctx.orgId, [nameColumn]: name.trim() })
      .select("id")
      .single();
    if (!error && data) {
      cache.set(key, data.id);
      return data.id;
    }
  }
  
  return null;
}
