import { allPages } from "@/lib/supabase/all-pages";
import type { ImportContext } from "./types";

export async function resolveImportReference(ctx: ImportContext, table: string, name: string, nameColumn = "name", allowCreate = false): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLocaleLowerCase();
  const cacheKey = `${table}:${nameColumn}`;
  let cache = ctx.refCaches.get(cacheKey);
  if (!cache) {
    const result = await allPages<Record<string, any>>((from, to) => ctx.supabase.from(table).select(`id,${nameColumn}`).eq("organization_id", ctx.orgId).order("id").range(from, to));
    if (result.error) throw new Error(result.error.message);
    cache = new Map();
    for (const row of result.data ?? []) {
      const label = String(row[nameColumn] ?? "").trim().toLocaleLowerCase();
      cache.set(label, cache.has(label) ? "" : row.id);
    }
    ctx.refCaches.set(cacheKey, cache);
  }
  if (cache.has(key)) {
    const id = cache.get(key);
    if (!id) throw new Error(`More than one ${table} record matches "${name}". Use unique names before importing.`);
    return id;
  }
  if (allowCreate && ctx.createMissingRefs && ["brands", "categories", "territories"].includes(table)) {
    const { data, error } = await ctx.supabase.from(table).insert({ organization_id: ctx.orgId, [nameColumn]: name.trim() }).select("id").single();
    if (error) throw new Error(error.message);
    cache.set(key, data.id);
    return data.id;
  }
  throw new Error(`${table}: "${name}" was not found in this organization. Create or correct that record first.`);
}

// Update imports change only fields present in the file; omitted settings survive.
export function suppliedUpdatePayload(payload: Record<string, unknown>, values: Record<string, unknown>) {
  const aliases: Record<string, string[]> = {
    brand_id: ["brand"], category_id: ["category"], assigned_salesman_id: ["assigned_salesman"],
    assigned_territory_id: ["assigned_territory"], assigned_route_id: ["assigned_route"], assigned_supervisor_id: ["supervisor"],
    emergency_contact: ["emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation"],
  };
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key === "updated_at" || (aliases[key] ?? [key]).some(field => Object.hasOwn(values, field))));
}
