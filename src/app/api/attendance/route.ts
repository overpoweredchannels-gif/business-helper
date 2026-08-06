import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

const getOrgTZ = () => "Asia/Karachi";

function toLocalDateString(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);
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

  const now = new Date();
  const date = toLocalDateString(now, getOrgTZ());

  const { data: existing } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("organization_id", permission.actor.organizationId)
    .eq("employee_id", emp.id)
    .eq("date", date)
    .maybeSingle();

  if (body.action === "clock_in") {
    if (existing && existing.duty_start) {
      return NextResponse.json({ ok: false, error: "You have already clocked in today." }, { status: 400 });
    }
    const dutyStart = now.toISOString();
    const { data: record, error } = await supabase
      .from("attendance_records")
      .upsert(
        {
          organization_id: permission.actor.organizationId,
          employee_id: emp.id,
          date,
          status: "present",
          duty_start: dutyStart,
          scheduled_start: existing?.scheduled_start ?? null,
          scheduled_end: existing?.scheduled_end ?? null,
          notes: body.latitude ? `Clock-in lat:${body.latitude}, lng:${body.longitude}` : null,
        },
        { onConflict: "organization_id,employee_id,date" }
      )
      .select()
      .single();
    if (error) {
      return NextResponse.json({ ok: false, error: `Failed to clock in: ${error.message}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, record, action: "clock_in" });
  }

  // clock_out
  if (!existing || !existing.duty_start) {
    return NextResponse.json({ ok: false, error: "You have not clocked in today." }, { status: 400 });
  }
  if (existing.duty_end) {
    return NextResponse.json({ ok: false, error: "You have already clocked out today." }, { status: 400 });
  }

  const dutyEnd = now.toISOString();
  const start = new Date(existing.duty_start);
  const hours = (now.getTime() - start.getTime()) / (1000 * 60 * 60);

  const { data: record, error } = await supabase
    .from("attendance_records")
    .update({
      duty_end: dutyEnd,
      total_hours: Math.round(hours * 100) / 100,
      status: "present",
      updated_at: now.toISOString(),
    })
    .eq("id", existing.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to clock out: ${error.message}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, record, action: "clock_out" });
}