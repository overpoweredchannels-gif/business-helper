// TradeOS ERP — Brands Import Config

import type { EntityImportConfig, ImportFieldDef } from "../types";

export const brandsImportConfig: EntityImportConfig = {
  entityKey: "brands",
  entityName: "Brands",
  tableName: "brands",
  existingColumns: "id, name, description, is_active",
  
  fields: [
    { key: "name", label: "Brand Name", type: "text", required: true, unique: true, preview: true, width: 200, help: "Required. Unique." },
    { key: "description", label: "Description", type: "text", required: false, preview: true, width: 300, help: "Optional description." },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null } satisfies ImportFieldDef,
  ],

  uniqueKeys: [["name"]],
  defaultDuplicateMode: "skip",
  allowCreateReferences: false,
  maxRows: 2000,

  async buildUpsertPayload(row) {
    const v = row.values as Record<string, unknown>;
    return {
      name: String(v.name ?? "").trim(),
      description: v.description ? String(v.description).trim() : null,
      is_active: v.is_active as boolean ?? true,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.name) return null;
    const { data } = await ctx.supabase
      .from("brands")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("name", String(v.name).trim())
      .maybeSingle();
    return data as any;
  },

  async applyUpdate(existing, payload, ctx) {
    const { error } = await ctx.supabase
      .from("brands")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  export: {
    filenamePrefix: "brands_export",
    columns: [
      { key: "name", label: "Brand Name" },
      { key: "description", label: "Description" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, description, is_active")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },
};