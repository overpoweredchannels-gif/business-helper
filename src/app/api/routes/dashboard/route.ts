import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  const [{ data: routes, error: routesError }, { data: stops, error: stopsError }, { data: visits, error: visitsError }] =
    await Promise.all([
      supabase
        .from("sales_routes")
        .select("id, name, territory_id, description, route_frequency, is_active, created_at")
        .eq("organization_id", organizationId),

      supabase
        .from("sales_route_stops")
        .select("id, route_id, customer_id, stop_order")
        .eq("organization_id", organizationId)
        .order("stop_order", { ascending: true }),

      supabase
        .from("customer_visits")
        .select("id, route_id, customer_id, employee_id, visit_status, created_at")
        .eq("organization_id", organizationId)
        .gte("created_at", dayStart.toISOString())
        .lte("created_at", dayEnd.toISOString()),
    ]);

  if (routesError || stopsError || visitsError) {
    return NextResponse.json(
      { ok: false, error: routesError?.message || stopsError?.message || visitsError?.message || "Query error" },
      { status: 500 }
    );
  }

  const stopsByRoute = new Map<string, (typeof stops)[number][]>();
  for (const stop of stops || []) {
    const list = stopsByRoute.get(stop.route_id) || [];
    list.push(stop);
    stopsByRoute.set(stop.route_id, list);
  }

  const visitStatusByKey = new Map<string, string>();
  for (const v of visits || []) {
    const key = v.route_id ? `${v.route_id}:${v.customer_id}` : `:${v.customer_id}`;
    visitStatusByKey.set(key, v.visit_status);
  }

  const rows = (routes || []).map((route) => {
    const routeStops = stopsByRoute.get(route.id) || [];
    let visited = 0;
    let pending = 0;
    let skipped = 0;

    for (const stop of routeStops) {
      const status = visitStatusByKey.get(`${route.id}:${stop.customer_id}`);
      if (!status || status === "planned") {
        pending += 1;
      } else if (status === "completed" || status === "in_progress") {
        visited += 1;
      } else {
        skipped += 1;
      }
    }

    const total = routeStops.length;
    const completionRate = total > 0 ? Math.round((visited / total) * 100) : 0;

    return {
      id: route.id,
      name: route.name,
      territory_id: route.territory_id,
      description: route.description,
      route_frequency: route.route_frequency,
      is_active: route.is_active,
      created_at: route.created_at,
      stops: total,
      visited,
      pending,
      skipped,
      completionRate,
    };
  });

  return NextResponse.json({ ok: true, routes: rows, total: rows.length });
}