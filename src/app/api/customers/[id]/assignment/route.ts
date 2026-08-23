import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

const optionalId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const { id: customerId } = await params;
  const body = await request.json().catch(() => ({}));
  const salesmanId = optionalId(body.salesman_id);
  const territoryId = optionalId(body.territory_id);
  const routeId = optionalId(body.route_id);
  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, customer_name, shop_name, address, latitude, longitude")
    .eq("id", customerId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (customerError) return NextResponse.json({ ok: false, error: customerError.message }, { status: 500 });
  if (!customer) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });

  if (salesmanId) {
    const { data } = await supabase.from("employees").select("id").eq("id", salesmanId).eq("organization_id", organizationId).maybeSingle();
    if (!data) return NextResponse.json({ ok: false, error: "Employee not found." }, { status: 400 });
  }
  if (territoryId) {
    const { data } = await supabase.from("territories").select("id").eq("id", territoryId).eq("organization_id", organizationId).maybeSingle();
    if (!data) return NextResponse.json({ ok: false, error: "Territory not found." }, { status: 400 });
  }

  let routeTerritoryId: string | null = null;
  if (routeId) {
    const { data: route, error } = await supabase
      .from("sales_routes")
      .select("id, territory_id")
      .eq("id", routeId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!route?.territory_id) return NextResponse.json({ ok: false, error: "The selected route needs a territory." }, { status: 400 });
    if (territoryId && territoryId !== route.territory_id) {
      return NextResponse.json({ ok: false, error: "The route does not belong to the selected territory." }, { status: 400 });
    }
    routeTerritoryId = route.territory_id;
  }
  const effectiveTerritoryId = routeTerritoryId ?? territoryId;
  const { error: updateError } = await supabase
    .from("customers")
    .update({ assigned_salesman_id: salesmanId, assigned_territory_id: effectiveTerritoryId, updated_at: new Date().toISOString() })
    .eq("id", customerId)
    .eq("organization_id", organizationId);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  const { data: existingStops, error: existingStopsError } = await supabase
    .from("sales_route_stops")
    .select("id, route_id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId);
  if (existingStopsError) return NextResponse.json({ ok: false, error: existingStopsError.message }, { status: 500 });
  const obsoleteStopIds = (existingStops ?? []).filter((stop) => String(stop.route_id) !== String(routeId ?? "")).map((stop) => String(stop.id));
  if (obsoleteStopIds.length) {
    const { error } = await supabase.from("sales_route_stops").delete().eq("organization_id", organizationId).in("id", obsoleteStopIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (routeId) {
    const { data: lastStop } = await supabase
      .from("sales_route_stops")
      .select("stop_order")
      .eq("route_id", routeId)
      .order("stop_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("sales_route_stops").upsert({
      organization_id: organizationId,
      route_id: routeId,
      customer_id: customerId,
      stop_order: Number(lastStop?.stop_order ?? 0) + 1,
      label: customer.shop_name ?? customer.customer_name,
      address: customer.address,
      latitude: customer.latitude,
      longitude: customer.longitude,
    }, { onConflict: "route_id,customer_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAuditEvent({
    organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: "customer_assignment_updated",
    entityType: "customer",
    entityId: customerId,
    description: `Updated territory, route, and employee assignment for ${customer.customer_name}.`,
    success: true,
  });
  return NextResponse.json({ ok: true, customer_id: customerId, territory_id: effectiveTerritoryId, route_id: routeId, salesman_id: salesmanId });
}
