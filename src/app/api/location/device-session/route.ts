import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveActor } from "@/lib/identity/api-context";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const TRACKING_HEALTH_VALUES = new Set([
  "tracking",
  "permission_denied",
  "gps_disabled",
  "battery_restricted",
  "error",
]);

interface DutySessionRow {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  scheduled_end_at?: string | null;
  timezone_snapshot?: string | null;
  ended_reason?: string | null;
  device_status?: string | null;
  last_location_at?: string | null;
}

interface DutyRpcRow {
  duty_session_id: string;
  attendance_record_id?: string | null;
  started_at?: string | null;
  scheduled_end_at?: string | null;
  timezone_name?: string | null;
  created?: boolean;
  ended_at?: string | null;
  ended_reason?: string | null;
}

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function rpcRow<T>(data: T[] | T | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

function dutyErrorStatus(message: string): number {
  if (/already ended|after today|non-working day/i.test(message)) return 409;
  if (/not found|linked to this profile/i.test(message)) return 404;
  return 400;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, deviceName } = body;

    if (!action || !["register", "signout", "status", "start", "health"].includes(action)) {
      return errorResponse("action must be register, signout, status, start, or health");
    }

    const context = await resolveActor(request);
    if (!context.actor?.profileId || !context.actor.organizationId) {
      return errorResponse(context.error ?? "Unauthorized", context.status ?? 401);
    }

    const organizationId = context.actor.organizationId;
    const profileId = context.actor.profileId;
    const supabase = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "start") {
      const { startLatitude, startLongitude, startAccuracy } = body;
      const hasLatitude = startLatitude != null;
      const hasLongitude = startLongitude != null;
      if (
        hasLatitude !== hasLongitude ||
        (hasLatitude &&
          (!Number.isFinite(startLatitude) ||
            !Number.isFinite(startLongitude) ||
            startLatitude < -90 ||
            startLatitude > 90 ||
            startLongitude < -180 ||
            startLongitude > 180)) ||
        (startAccuracy != null && (!Number.isFinite(startAccuracy) || startAccuracy < 0))
      ) {
        return errorResponse("Valid start coordinates must be provided together");
      }

      const startedAt = new Date().toISOString();
      const { data, error } = await supabase.rpc("start_employee_duty", {
        p_organization_id: organizationId,
        p_profile_id: profileId,
        p_started_at: startedAt,
        p_start_latitude: startLatitude ?? null,
        p_start_longitude: startLongitude ?? null,
        p_start_accuracy: startAccuracy ?? null,
        p_device_name: typeof deviceName === "string" ? deviceName.slice(0, 160) : null,
      });

      if (error) {
        return errorResponse(error.message, dutyErrorStatus(error.message));
      }

      const session = rpcRow<DutyRpcRow>(data);
      if (!session?.duty_session_id) {
        return errorResponse("Duty start did not return a session.", 500);
      }

      return NextResponse.json({
        ok: true,
        started: Boolean(session.created),
        dutySessionId: session.duty_session_id,
        attendanceRecordId: session.attendance_record_id ?? null,
        startedAt: session.started_at ?? startedAt,
        scheduledEndAt: session.scheduled_end_at ?? null,
        timezone: session.timezone_name ?? "Asia/Karachi",
        message: session.created ? "Duty session started" : "Active duty session found",
      });
    }

    if (action === "signout") {
      const endedAt = new Date().toISOString();
      const { data, error } = await supabase.rpc("stop_employee_duty", {
        p_organization_id: organizationId,
        p_profile_id: profileId,
        p_ended_at: endedAt,
        p_reason: "manual_stop",
      });

      if (error) return errorResponse(`Duty stop error: ${error.message}`, 500);
      const stopped = rpcRow<DutyRpcRow>(data);

      return NextResponse.json({
        ok: true,
        stopped: Boolean(stopped?.duty_session_id),
        dutySessionId: stopped?.duty_session_id ?? null,
        endedAt: stopped?.ended_at ?? null,
        endedReason: stopped?.ended_reason ?? null,
        message: stopped ? "Duty ended successfully." : "No active duty session.",
      });
    }

    if (action === "health") {
      const health = typeof body.health === "string" ? body.health : "";
      if (!TRACKING_HEALTH_VALUES.has(health)) {
        return errorResponse("health must be tracking, permission_denied, gps_disabled, battery_restricted, or error");
      }

      const lastError = typeof body.error === "string" ? body.error.slice(0, 500) : null;
      const { data, error } = await supabase
        .from("staff_duty_sessions")
        .update({
          device_status: health,
          last_error: lastError,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .eq("status", "on_duty")
        .select("id")
        .maybeSingle();

      if (error) return errorResponse(`Tracking health update failed: ${error.message}`, 500);
      return NextResponse.json({ ok: true, dutySessionId: data?.id ?? null });
    }

    const { error: cutoffError } = await supabase.rpc("close_expired_duty_sessions", {
      p_now: new Date().toISOString(),
    });
    if (cutoffError) return errorResponse(`Duty cutoff failed: ${cutoffError.message}`, 500);

    const { data: activeDuty, error: activeError } = await supabase
      .from("staff_duty_sessions")
      .select("id, status, started_at, ended_at, scheduled_end_at, timezone_snapshot, ended_reason, device_status, last_location_at")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("status", "on_duty")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<DutySessionRow>();

    if (activeError) return errorResponse(`Duty lookup error: ${activeError.message}`, 500);

    let latestDuty: DutySessionRow | null = activeDuty;
    if (!latestDuty) {
      const { data: latest, error: latestError } = await supabase
        .from("staff_duty_sessions")
        .select("id, status, started_at, ended_at, scheduled_end_at, timezone_snapshot, ended_reason, device_status, last_location_at")
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<DutySessionRow>();
      if (latestError) return errorResponse(`Latest duty lookup error: ${latestError.message}`, 500);
      latestDuty = latest;
    }

    return NextResponse.json({
      ok: true,
      onDuty: Boolean(activeDuty),
      dutySessionId: activeDuty?.id ?? null,
      startedAt: activeDuty?.started_at ?? null,
      scheduledEndAt: activeDuty?.scheduled_end_at ?? null,
      timezone: activeDuty?.timezone_snapshot ?? latestDuty?.timezone_snapshot ?? "Asia/Karachi",
      deviceStatus: activeDuty?.device_status ?? latestDuty?.device_status ?? "off_duty",
      lastLocationAt: activeDuty?.last_location_at ?? latestDuty?.last_location_at ?? null,
      lastEndedAt: activeDuty ? null : latestDuty?.ended_at ?? null,
      lastEndedReason: activeDuty ? null : latestDuty?.ended_reason ?? null,
      message: activeDuty
        ? "Active duty session found"
        : latestDuty?.ended_reason === "automatic_cutoff"
          ? "Duty ended automatically at the scheduled cutoff. Start duty again on the next working day."
          : "No active duty session. Start duty first.",
    });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}
