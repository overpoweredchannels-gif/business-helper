import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const supabase = createSupabaseService();

  const { data: visit, error } = await supabase
    .from("customer_visits")
    .select(`
      id, employee_id, customer_id, route_id, stop_id, visit_status, started_at, ended_at,
      latitude, longitude, accuracy, notes, images, created_at,
      customers!inner(customer_name, shop_name, phone, latitude, longitude)
    `)
    .eq("id", id)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  if (error || !visit) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Visit not found" }, { status: 404 });
  }

  if (!(permission.actor.isOwner || permission.actor.role === "manager" || permission.actor.role === "supervisor")) {
    const { data: employee } = await supabase.from("employees").select("id").eq("organization_id", permission.actor.organizationId).eq("profile_id", permission.actor.profileId).maybeSingle();
    if (!employee || employee.id !== visit.employee_id) {
      return NextResponse.json({ ok: false, error: "You can only view your own visits" }, { status: 403 });
    }
  }

  return NextResponse.json({ ok: true, visit });
}
