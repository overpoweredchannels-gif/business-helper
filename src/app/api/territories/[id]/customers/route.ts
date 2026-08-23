import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const territory = await getTerritory(id, permission.actor.organizationId);
  if (!territory) return NextResponse.json({ ok: false, error: "Territory not found." }, { status: 404 });

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("customers")
    .select("id, customer_name, shop_name, city, area, phone, assigned_territory_id, assigned_salesman_id, is_active")
    .eq("organization_id", permission.actor.organizationId)
    .eq("assigned_territory_id", id)
    .order("customer_name", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, territory, customers: data ?? [] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const territory = await getTerritory(id, permission.actor.organizationId);
  if (!territory) return NextResponse.json({ ok: false, error: "Territory not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const requestedIds: string[] = Array.isArray(body.customer_ids)
    ? [...new Set<string>(body.customer_ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0))]
    : [];
  const supabase = createSupabaseService();
  const organizationId = permission.actor.organizationId;
  const { data: currentMembers, error: currentMembersError } = await supabase
    .from("customers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("assigned_territory_id", id);
  if (currentMembersError) return NextResponse.json({ ok: false, error: currentMembersError.message }, { status: 500 });
  const requestedSet = new Set(requestedIds);
  const removedIds = (currentMembers ?? []).map((customer) => String(customer.id)).filter((customerId) => !requestedSet.has(customerId));

  if (requestedIds.length) {
    const { data: validCustomers, error: validationError } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", requestedIds);
    if (validationError) return NextResponse.json({ ok: false, error: validationError.message }, { status: 500 });
    if ((validCustomers ?? []).length !== requestedIds.length) {
      return NextResponse.json({ ok: false, error: "One or more customers do not belong to this organization." }, { status: 400 });
    }
  }

  let clearQuery = supabase
    .from("customers")
    .update({ assigned_territory_id: null, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("assigned_territory_id", id);
  if (requestedIds.length) clearQuery = clearQuery.not("id", "in", `(${requestedIds.join(",")})`);
  const { error: clearError } = await clearQuery;
  if (clearError) return NextResponse.json({ ok: false, error: clearError.message }, { status: 500 });

  if (requestedIds.length) {
    const { error: assignError } = await supabase
      .from("customers")
      .update({ assigned_territory_id: id, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("id", requestedIds);
    if (assignError) return NextResponse.json({ ok: false, error: assignError.message }, { status: 500 });
  }

  const { data: routes, error: routesError } = await supabase
    .from("sales_routes")
    .select("id, territory_id")
    .eq("organization_id", organizationId);
  if (routesError) return NextResponse.json({ ok: false, error: routesError.message }, { status: 500 });
  const currentRouteIds = (routes ?? []).filter((route) => String(route.territory_id) === id).map((route) => String(route.id));
  const otherRouteIds = (routes ?? []).filter((route) => route.territory_id && String(route.territory_id) !== id).map((route) => String(route.id));
  if (removedIds.length && currentRouteIds.length) {
    const { error } = await supabase.from("sales_route_stops").delete().eq("organization_id", organizationId).in("route_id", currentRouteIds).in("customer_id", removedIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (requestedIds.length && otherRouteIds.length) {
    const { error } = await supabase.from("sales_route_stops").delete().eq("organization_id", organizationId).in("route_id", otherRouteIds).in("customer_id", requestedIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAuditEvent({
    organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: "territory_customers_synced",
    entityType: "territory",
    entityId: id,
    description: `Assigned ${requestedIds.length} customer(s) to territory ${territory.name}.`,
    success: true,
  });
  return NextResponse.json({ ok: true, customer_ids: requestedIds });
}
