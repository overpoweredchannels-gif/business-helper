import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { allPages } from "@/lib/supabase/all-pages";
import { logAuditEvent } from "@/lib/identity/audit";
import { missingSetup, setupFields, validateSetupValue, type SetupEntity } from "@/lib/tradeos/data-quality";

export const maxDuration = 60;

export async function GET(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) return NextResponse.json({ ok: false, error: "Owner access required" }, { status: 403 });
  const entity = new URL(request.url).searchParams.get("entity") as SetupEntity;
  if (!Object.hasOwn(setupFields, entity ?? "")) return NextResponse.json({ ok: false, error: "Invalid entity" }, { status: 400 });
  const db = createSupabaseService(); const org = permission.actor.organizationId;
  const label = entity === "products" ? "name" : "customer_name";
  const result = await allPages<Record<string, any>>((from, to) => db.from(entity).select(`id,${label},${Object.keys(setupFields[entity]).join(",")}`).eq("organization_id", org).order("id").range(from, to));
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  const options: Record<string, unknown[]> = {};
  for (const [field, table, name] of entity === "products" ? [["brand_id", "brands", "name"], ["category_id", "categories", "name"]] : [["assigned_salesman_id", "employees", "full_name"], ["assigned_territory_id", "territories", "name"]]) {
    const refs = await allPages<Record<string, any>>((from, to) => db.from(table).select(`id,${name}`).eq("organization_id", org).order("id").range(from, to));
    if (refs.error) return NextResponse.json({ ok: false, error: refs.error.message }, { status: 500 });
    options[field] = refs.data!.map(row => ({ id: row.id, label: row[name] }));
  }
  return NextResponse.json({ ok: true, rows: result.data!.map(row => ({ ...row, label: row[label], missing: missingSetup(entity, row) })), options });
}

export async function PATCH(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) return NextResponse.json({ ok: false, error: "Owner access required" }, { status: 403 });
  try {
    const body = await request.json(); const entity = body.entity as SetupEntity;
    if (!Object.hasOwn(setupFields, entity ?? "") || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 5000 || body.ids.some((id: unknown) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("Select between 1 and 5,000 records");
    const ids = [...new Set(body.ids)] as string[];
    const value = validateSetupValue(entity, body.field, body.value);
    const db = createSupabaseService(); const org = permission.actor.organizationId;
    const references: Record<string, string> = { brand_id: "brands", category_id: "categories", assigned_salesman_id: "employees", assigned_territory_id: "territories" };
    if (references[body.field]) {
      const { data, error } = await db.from(references[body.field]).select("id").eq("organization_id", org).eq("id", value).maybeSingle();
      if (error || !data) throw new Error("Selected reference is not in your organization");
    }
    // Keep PostgREST request URLs small for selections containing thousands of UUIDs.
    // Each batch commits separately; report completed work if a later batch fails.
    let updated = 0;
    const audit = (success: boolean) => logAuditEvent({ organizationId: org, actorProfileId: permission.actor!.profileId, actorEmail: permission.actor!.email, action: "bulk_setup_updated", entityType: entity, description: `${body.field} set to ${String(value)} for ${updated} of ${ids.length} selected records.`, success });
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { error, count } = await db.from(entity).update({ [body.field]: value }, { count: "exact" }).eq("organization_id", org).in("id", ids.slice(offset, offset + 100));
      if (error) {
        await audit(false);
        return NextResponse.json({ ok: false, updated, requested: ids.length, error: `Updated ${updated} of ${ids.length} records before an error. Refresh and retry the remaining records. ${error.message}` }, { status: 400 });
      }
      updated += count ?? 0;
    }
    await audit(true);
    return NextResponse.json({ ok: true, updated, requested: ids.length });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Bulk update failed" }, { status: 400 }); }
}
