// TradeOS ERP — Territories Import Config

import type { EntityImportConfig, ImportFieldDef } from "../types";

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

export const territoriesImportConfig: EntityImportConfig = {
  entityKey: "territories",
  entityName: "Territories",
  tableName: "territories",
  existingColumns: "id, name, description, is_active",
  
  fields: [
    { key: "name", label: "Territory Name", type: "text", required: true, unique: true, preview: true, width: 200, help: "Required. Unique." } satisfies ImportFieldDef,
    { key: "description", label: "Description", type: "text", required: false, preview: true, width: 300, help: "Optional description." } satisfies ImportFieldDef,
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null } satisfies ImportFieldDef,
    { key: "center_lat", label: "Center Latitude", type: "decimal", required: false, preview: false, parse: (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; }, help: "For geo territories." } satisfies ImportFieldDef,
    { key: "center_lng", label: "Center Longitude", type: "decimal", required: false, preview: false, parse: (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; } } satisfies ImportFieldDef,
    { key: "radius_km", label: "Radius (km)", type: "decimal", required: false, preview: false, parse: (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; } } satisfies ImportFieldDef,
  ],

  uniqueKeys: [["name"]],
  defaultDuplicateMode: "skip",
  allowCreateReferences: false,
  maxRows: 1000,

  async buildUpsertPayload(row) {
    const v = row.values as Record<string, unknown>;
    return {
      name: String(v.name ?? "").trim(),
      description: v.description ? String(v.description).trim() : null,
      is_active: v.is_active as boolean ?? true,
      center_lat: v.center_lat as number | null,
      center_lng: v.center_lng as number | null,
      radius_km: v.radius_km as number | null,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.name) return null;
    const { data } = await ctx.supabase
      .from("territories")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("name", String(v.name).trim())
      .maybeSingle();
    return data as any;
  },

  async applyUpdate(existing, payload, ctx) {
    const { error } = await ctx.supabase
      .from("territories")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  export: {
    filenamePrefix: "territories_export",
    columns: [
      { key: "name", label: "Territory Name" },
      { key: "description", label: "Description" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      { key: "center_lat", label: "Center Lat" },
      { key: "center_lng", label: "Center Lng" },
      { key: "radius_km", label: "Radius (km)" },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("territories")
        .select("id, name, description, is_active, center_lat, center_lng, radius_km")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },
};