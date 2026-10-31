import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { TerritoryRepository } from "@/lib/identity/repositories/territory-repository";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

type TerritoryContext = { params: Promise<{ id: string }> };

async function getTerritory(id: string, organizationId: string) {
  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("territories")
    .select("id, name")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function PATCH(request: NextRequest, context: TerritoryContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const name = (body.name as string) ?? "";
  if (!name.trim()) {
    return NextResponse.json({ error: "Territory name is required." }, { status: 400 });
  }

  try {
    const territory = await getTerritory(id, permission.actor.organizationId);
    if (!territory) return NextResponse.json({ error: "Territory not found." }, { status: 404 });

    const repository = new TerritoryRepository();
    const updated = await repository.update(id, {
      name: name.trim(),
      description: (body.description as string) ?? null,
      center_lat: toNullableNumber(body.center_lat),
      center_lng: toNullableNumber(body.center_lng),
      radius_km: toNullableNumber(body.radius_km),
    });
    await logAuditEvent({
      organizationId: permission.actor.organizationId,
      actorProfileId: permission.actor.profileId,
      actorEmail: permission.actor.email,
      action: "territory_updated",
      entityType: "territory",
      entityId: id,
      description: `Updated territory ${updated.name}.`,
      success: true,
    });
    return NextResponse.json({ territory: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update territory";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: TerritoryContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const territory = await getTerritory(id, permission.actor.organizationId);
    if (!territory) return NextResponse.json({ error: "Territory not found." }, { status: 404 });

    const supabase = createSupabaseService();
    const organizationId = permission.actor.organizationId;
    // Unlink instead of blocking: customers, routes and staff keep existing,
    // they simply lose this territory assignment.
    const customers = await supabase
      .from("customers")
      .update({ assigned_territory_id: null })
      .eq("organization_id", organizationId)
      .eq("assigned_territory_id", id)
      .select("id");
    if (customers.error) throw customers.error;
    const routes = await supabase
      .from("sales_routes")
      .update({ territory_id: null })
      .eq("organization_id", organizationId)
      .eq("territory_id", id)
      .select("id");
    if (routes.error) throw routes.error;
    const employees = await supabase
      .from("employees")
      .update({ assigned_territory_id: null })
      .eq("organization_id", organizationId)
      .eq("assigned_territory_id", id)
      .select("id");
    if (employees.error) throw employees.error;

    const repository = new TerritoryRepository();
    await repository.delete(id);
    await logAuditEvent({
      organizationId,
      actorProfileId: permission.actor.profileId,
      actorEmail: permission.actor.email,
      action: "territory_deleted",
      entityType: "territory",
      entityId: id,
      description: `Deleted territory ${territory.name}. Unassigned ${customers.data?.length ?? 0} customer(s), ${routes.data?.length ?? 0} route(s) and ${employees.data?.length ?? 0} staff member(s).`,
      success: true,
    });
    return NextResponse.json({
      ok: true,
      unassignedCustomers: customers.data?.length ?? 0,
      unassignedRoutes: routes.data?.length ?? 0,
      unassignedEmployees: employees.data?.length ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete territory";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
