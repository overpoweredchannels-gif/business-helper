import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { requireSalesTool } from "@/lib/sales/authorization";
import { canViewAllSales } from "@/lib/sales/access";

export const runtime = "nodejs";

const SALES_DESIGNATIONS = ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"];

export async function GET(request: NextRequest) {
  const permission = await requireSalesTool(request, "loadform");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  const [customersRes, employeesRes, brandsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_name, shop_name")
      .eq("organization_id", organizationId)
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
      .from("brands")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
  ]);

  const customers = (customersRes.data ?? []).map((c) => ({
    id: c.id,
    label: c.shop_name ? `${c.shop_name} (${c.customer_name})` : c.customer_name,
  }));

  const salesmen = (employeesRes.data ?? [])
    .filter((e) => e.profile_id)
    .map((e) => ({ id: e.profile_id, label: e.full_name }));

  const brands = (brandsRes.data ?? []).map((b) => ({ id: b.id, label: b.name }));

  return NextResponse.json({ ok: true, customers, salesmen, brands });
}
