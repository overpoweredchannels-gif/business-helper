import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface DutyRpcRow {
  duty_session_id?: string | null;
  attendance_record_id?: string | null;
  ended_at?: string | null;
}

function rpcRow<T>(data: T[] | T | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 30), 120);

  const supabase = createSupabaseService();

  // Resolve the employee for this profile
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!emp) {
    return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
  }

  let query = supabase
    .from("attendance_records")
    .select("*")
    .eq("organization_id", permission.actor.organizationId)
    .eq("employee_id", emp.id)
    .order("date", { ascending: false })
    .limit(limit);

  if (date) query = query.eq("date", date);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, records: data ?? [] });
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: { action?: string; latitude?: number; longitude?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "clock_in" && body.action !== "clock_out") {
    return NextResponse.json({ ok: false, error: "action must be clock_in or clock_out" }, { status: 400 });
  }
  const hasLatitude = body.latitude != null;
  const hasLongitude = body.longitude != null;
  if (hasLatitude !== hasLongitude || (hasLatitude && (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || body.latitude! < -90 || body.latitude! > 90 || body.longitude! < -180 || body.longitude! > 180))) {
    return NextResponse.json({ ok: false, error: "Valid latitude and longitude must be provided together" }, { status: 400 });
  }

  const supabase = createSupabaseService();

  const { data: emp } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!emp) {
    return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
  }

  if (body.action === "clock_in") {
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase.rpc("start_employee_duty", {
      p_organization_id: permission.actor.organizationId,
      p_profile_id: permission.actor.profileId,
      p_started_at: startedAt,
      p_start_latitude: body.latitude ?? null,
      p_start_longitude: body.longitude ?? null,
      p_start_accuracy: null,
      p_device_name: "TradeOS web attendance",
    });
    if (error) {
      const status = /already ended|after today|non-working day/i.test(error.message) ? 409 : 400;
      return NextResponse.json({ ok: false, error: `Failed to clock in: ${error.message}` }, { status });
    }

    const duty = rpcRow<DutyRpcRow>(data);
    if (!duty?.attendance_record_id) {
      return NextResponse.json({ ok: false, error: "Duty start did not create attendance." }, { status: 500 });
    }

    const { data: record, error: recordError } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("id", duty.attendance_record_id)
      .single();
    if (recordError) {
      return NextResponse.json({ ok: false, error: `Attendance lookup failed: ${recordError.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, record, action: "clock_in", dutySessionId: duty.duty_session_id });
  }

  const endedAt = new Date().toISOString();
  const { data, error } = await supabase.rpc("stop_employee_duty", {
    p_organization_id: permission.actor.organizationId,
    p_profile_id: permission.actor.profileId,
    p_ended_at: endedAt,
    p_reason: "manual_clock_out",
  });
  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to clock out: ${error.message}` }, { status: 500 });
  }

  const duty = rpcRow<DutyRpcRow>(data);
  if (!duty?.attendance_record_id) {
    return NextResponse.json({ ok: false, error: "You are not currently on duty." }, { status: 409 });
  }

  const { data: record, error: recordError } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("id", duty.attendance_record_id)
    .single();
  if (recordError) {
    return NextResponse.json({ ok: false, error: `Attendance lookup failed: ${recordError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, record, action: "clock_out", dutySessionId: duty.duty_session_id });
}
