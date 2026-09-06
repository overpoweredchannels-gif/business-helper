import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { requireSalesTool } from "@/lib/sales/authorization";
import { canViewAllSales } from "@/lib/sales/access";

export const runtime = "nodejs";

const SALES_DESIGNATIONS = ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"];

/**
 * GET /api/sales/invoices/options
 * Returns filter options for the invoice generator:
 *   customers  [{ id, label }]  — customer id + shop (customer_name)
 *   salesmen   [{ id, label }]  — profile_id + full_name
 *   areas      [string]         — distinct customer area values
 *   cities     [string]         — distinct customer city values
 *   routes     [{ id, label }]  — sales routes
 */
export async function GET(request: NextRequest) {
  const permission = await requireSalesTool(request, "invoices");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  const [customersRes, employeesRes, routesRes, areasRes, citiesRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_name, shop_name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("customer_name", { ascending: true }),
    supabase
      .from("employees")
      .select("profile_id, full_name")
      .eq("organization_id", organizationId)
      .in("designation", SALES_DESIGNATIONS)
      .filter("profile_id", canViewAllSales(permission.actor.role) ? "not.is" : "eq", canViewAllSales(permission.actor.role) ? null : permission.actor.profileId)
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("sales_routes")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("customers")
      .select("area")
      .eq("organization_id", organizationId)
      .not("area", "is", null)
      .neq("area", ""),
    supabase
      .from("customers")
      .select("city")
      .eq("organization_id", organizationId)
      .not("city", "is", null)
      .neq("city", ""),
  ]);

  const customers = (customersRes.data ?? []).map((c) => ({
    id: c.id,
    label: c.shop_name ? `${c.shop_name} (${c.customer_name})` : c.customer_name,
  }));

  const salesmen = (employeesRes.data ?? [])
    .filter((e) => e.profile_id)
    .map((e) => ({ id: e.profile_id, label: e.full_name }));

  const routes = (routesRes.data ?? []).map((r) => ({ id: r.id, label: r.name }));

  const areas = [...new Set((areasRes.data ?? []).map((a) => String(a.area).trim()).filter(Boolean))].sort();
  const cities = [...new Set((citiesRes.data ?? []).map((c) => String(c.city).trim()).filter(Boolean))].sort();

  return NextResponse.json({ ok: true, customers, salesmen, routes, areas, cities });
}