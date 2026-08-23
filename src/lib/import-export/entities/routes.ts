// TradeOS ERP — Sales Routes Import Config

import type { EntityImportConfig, ImportFieldDef, ImportContext } from "../types";

export const routesImportConfig: EntityImportConfig = {
  entityKey: "routes",
  entityName: "Sales Routes",
  tableName: "sales_routes",
  existingColumns: "id, name, territory_id, description, route_frequency, is_active, assigned_salesman_id",
  
  fields: [
    { key: "name", label: "Route Name", type: "text", required: true, unique: true, preview: true, width: 200, help: "Required. Unique." } satisfies ImportFieldDef,
    { key: "territory", label: "Territory", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Territory name." } satisfies ImportFieldDef,
    { key: "description", label: "Description", type: "text", required: false, preview: true, width: 300 } satisfies ImportFieldDef,
    { key: "route_frequency", label: "Frequency", type: "select", required: false, preview: true, width: 120, options: ["daily", "weekly", "monthly"], defaultValue: "daily" } satisfies ImportFieldDef,
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null } satisfies ImportFieldDef,
    { key: "assigned_salesman", label: "Assigned Salesman", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Salesman name." } satisfies ImportFieldDef,
    // Route stops handled separately via sales_route_stops table
    { key: "stops", label: "Stops (JSON)", type: "json", required: false, preview: false, help: "Array of {customer, stop_order, label}." } satisfies ImportFieldDef,
  ],

  uniqueKeys: [["name"]],
  defaultDuplicateMode: "skip",
  allowCreateReferences: true,
  maxRows: 1000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const territoryId = v.territory ? await resolveRef(ctx, "territories", v.territory as string) : null;
    const salesmanId = v.assigned_salesman ? await resolveRef(ctx, "employees", v.assigned_salesman as string, "full_name") : null;

    return {
      name: String(v.name ?? "").trim(),
      territory_id: territoryId,
      description: v.description ? String(v.description).trim() : null,
      route_frequency: v.route_frequency as "daily" | "weekly" | "monthly" ?? "daily",
      is_active: v.is_active as boolean ?? true,
      assigned_salesman_id: salesmanId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.name) return null;
    const { data } = await ctx.supabase
      .from("sales_routes")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("name", String(v.name).trim())
      .maybeSingle();
    return data as any;
  },

  async applyUpdate(existing, payload, ctx) {
    const { error } = await ctx.supabase
      .from("sales_routes")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  async postImportHook(created, updated, ctx) {
    // Handle route stops from JSON
    const all = [...created, ...updated] as any[];
    for (const item of all) {
      const v = item.rawValues as Record<string, unknown>;
      const routeId = item.id;
      if (!routeId || !v.stops) continue;
      
      const stops = Array.isArray(v.stops) ? v.stops : JSON.parse(String(v.stops));
      if (!Array.isArray(stops)) throw new Error(`Stops for route ${String(v.name ?? routeId)} must be a JSON array.`);

      const { data: route, error: routeError } = await ctx.supabase
        .from("sales_routes")
        .select("territory_id, assigned_salesman_id")
        .eq("id", routeId)
        .eq("organization_id", ctx.orgId)
        .single();
      if (routeError) throw routeError;

      for (const stop of stops) {
        const customerId = stop.customer ? await resolveRef(ctx, "customers", String(stop.customer), "customer_name") : null;
        if (!customerId) throw new Error(`Customer not found for route ${String(v.name ?? routeId)}: ${String(stop.customer ?? "")}`);

        const { error: stopError } = await ctx.supabase
          .from("sales_route_stops")
          .upsert({
            route_id: routeId,
            organization_id: ctx.orgId,
            customer_id: customerId,
            stop_order: Number(stop.stop_order) || 0,
            label: stop.label ? String(stop.label).trim() : null,
            address: stop.address ? String(stop.address).trim() : null,
            latitude: Number.isFinite(Number(stop.latitude)) ? Number(stop.latitude) : null,
            longitude: Number.isFinite(Number(stop.longitude)) ? Number(stop.longitude) : null,
          }, { onConflict: "route_id,customer_id" });
        if (stopError) throw stopError;

        const customerAssignment: Record<string, string> = {};
        if (route.territory_id) customerAssignment.assigned_territory_id = route.territory_id;
        if (route.assigned_salesman_id) customerAssignment.assigned_salesman_id = route.assigned_salesman_id;
        if (Object.keys(customerAssignment).length > 0) {
          const { error: customerError } = await ctx.supabase
            .from("customers")
            .update(customerAssignment)
            .eq("id", customerId)
            .eq("organization_id", ctx.orgId);
          if (customerError) throw customerError;
        }
      }
    }
  },

  export: {
    filenamePrefix: "routes_export",
    columns: [
      { key: "name", label: "Route Name" },
      { key: "territory", label: "Territory", transform: (v) => (v as any)?.name ?? "" },
      { key: "description", label: "Description" },
      { key: "route_frequency", label: "Frequency" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      { key: "assigned_salesman", label: "Salesman", transform: (v) => (v as any)?.full_name ?? "" },
      { key: "stops", label: "Stops (JSON)", transform: (v) => JSON.stringify(Array.isArray(v) ? v.map((stop: any) => ({ customer: stop.customer?.customer_name ?? "", stop_order: stop.stop_order ?? 0, label: stop.label ?? null, address: stop.address ?? null, latitude: stop.latitude ?? null, longitude: stop.longitude ?? null })) : []) },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("sales_routes")
        .select(`
          id, name, description, route_frequency, is_active,
          territory:territories!territory_id(name),
          assigned_salesman:employees!assigned_salesman_id(full_name),
          stops:sales_route_stops(stop_order, label, address, latitude, longitude, customer:customers(customer_name))
        `)
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
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
    const selectCol = table === "employees" ? "id, full_name" : "id, name";
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
