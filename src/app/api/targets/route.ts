import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

const METRICS = ["revenue", "orders", "customers", "products", "collections"];
const PERIODS = ["daily", "weekly", "monthly"];

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") ?? undefined;
  const period = searchParams.get("period") ?? undefined;
  const metric = searchParams.get("metric") ?? undefined;

  const supabase = createSupabaseService();
  const canViewTeam = permission.actor.isOwner || permission.actor.role === "manager" || permission.actor.role === "supervisor" || Boolean(permission.actor.permissions?.includes("settings_manage"));
  let scopedEmployeeId = employeeId;
  if (!canViewTeam) {
    const { data: ownEmployee } = await supabase.from("employees").select("id").eq("organization_id", permission.actor.organizationId).eq("profile_id", permission.actor.profileId).maybeSingle();
    if (!ownEmployee) return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
    if (employeeId && employeeId !== ownEmployee.id) return NextResponse.json({ ok: false, error: "You can only view your own targets" }, { status: 403 });
    scopedEmployeeId = ownEmployee.id;
  }
  let query = supabase
    .from("sales_targets")
    .select(`
      id, employee_id, period, metric, target_value, start_date, end_date, created_at,
      employees(full_name)
    `)
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (scopedEmployeeId) query = query.eq("employee_id", scopedEmployeeId);
  if (period && PERIODS.includes(period)) query = query.eq("period", period);
  if (metric && METRICS.includes(metric)) query = query.eq("metric", metric);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, targets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "settings_manage");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: {
    employeeId?: string;
    period?: string;
    metric?: string;
    targetValue?: number;
    startDate?: string;
    endDate?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.employeeId || !body.period || !body.metric || typeof body.targetValue !== "number" || body.targetValue <= 0) {
    return NextResponse.json({ ok: false, error: "employeeId, period, metric, targetValue are required" }, { status: 400 });
  }
  if (!PERIODS.includes(body.period)) {
    return NextResponse.json({ ok: false, error: `period must be ${PERIODS.join(", ")}` }, { status: 400 });
  }
  if (!METRICS.includes(body.metric)) {
    return NextResponse.json({ ok: false, error: `metric must be ${METRICS.join(", ")}` }, { status: 400 });
  }

  const supabase = createSupabaseService();

  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("id", body.employeeId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!emp) {
    return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 400 });
  }

  const startDate = body.startDate ?? new Date().toISOString().split("T")[0];
  let endDate = body.endDate;
  if (!endDate) {
    const d = new Date();
    if (body.period === "daily") d.setDate(d.getDate() + 1);
    else if (body.period === "weekly") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    endDate = d.toISOString().split("T")[0];
  }

  const { data: target, error } = await supabase
    .from("sales_targets")
    .upsert(
      {
        organization_id: permission.actor.organizationId,
        employee_id: body.employeeId,
        period: body.period,
        metric: body.metric,
        target_value: body.targetValue,
        start_date: startDate,
        end_date: endDate,
      },
      { onConflict: "organization_id,employee_id,period,metric,start_date" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to set target: ${error.message}` }, { status: 400 });
  }

  // Notify employee
  const { data: empFull } = await supabase
    .from("employees")
    .select("profile_id")
    .eq("id", body.employeeId)
    .maybeSingle();
  if (empFull?.profile_id) {
    await supabase.from("notifications").insert({
      organization_id: permission.actor.organizationId,
      recipient_profile_id: empFull.profile_id,
      category: "target",
      title: "New sales target set",
      body: `Your ${body.period} target: ${body.metric} ${body.targetValue}.`,
      entity_type: "sales_target",
      entity_id: target.id,
      channel: "in_app",
      is_read: false,
    });
  }

  return NextResponse.json({ ok: true, target });
}
