import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const [employees, territories, routes, stops] = await Promise.all([
    supabase.from("employees").select("id, full_name, designation, status, assigned_territory_id, assigned_route_id").eq("organization_id", organizationId).eq("is_active", true).order("full_name"),
    supabase.from("territories").select("id, name, is_active").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("sales_routes").select("id, name, territory_id, assigned_salesman_id, is_active").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("sales_route_stops").select("route_id, customer_id, stop_order").eq("organization_id", organizationId).not("customer_id", "is", null),
  ]);
  const error = [employees.error, territories.error, routes.error, stops.error].find(Boolean);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, employees: employees.data ?? [], territories: territories.data ?? [], routes: routes.data ?? [], routeStops: stops.data ?? [] });
}
