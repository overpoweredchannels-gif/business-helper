import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { deriveTrackingStatus, trackingStatusLabel } from "@/lib/location/tracking-status";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const { error: cutoffError } = await supabase.rpc("close_expired_duty_sessions", {
    p_now: new Date().toISOString(),
  });
  if (cutoffError) {
    return NextResponse.json(
      { ok: false, error: `Duty cutoff failed: ${cutoffError.message}` },
      { status: 500 }
    );
  }

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const serverNow = Date.now();
  const canViewTeam = permission.actor.isOwner || permission.actor.role === "manager" || permission.actor.role === "supervisor" || Boolean(permission.actor.permissions?.includes("administration"));
  let locationsQuery = supabase
    .from("staff_location_points")
    .select("profile_id, latitude, longitude, accuracy, speed, heading, altitude, captured_at, duty_session_id")
    .eq("organization_id", organizationId)
    .gte("captured_at", cutoff)
    .order("captured_at", { ascending: false });
  let employeesQuery = supabase
    .from("employees")
    .select("id, profile_id, full_name, designation, status, is_active")
    .eq("organization_id", organizationId);
  let sessionsQuery = supabase
    .from("staff_duty_sessions")
    .select("profile_id, id, status, scheduled_end_at, device_status, last_error")
    .eq("organization_id", organizationId)
    .eq("status", "on_duty");
  if (!canViewTeam) {
    locationsQuery = locationsQuery.eq("profile_id", permission.actor.profileId);
    employeesQuery = employeesQuery.eq("profile_id", permission.actor.profileId);
    sessionsQuery = sessionsQuery.eq("profile_id", permission.actor.profileId);
  }

  const [
    { data: locations, error: locError },
    { data: employees, error: empError },
    { data: sessions, error: sessionError },
  ] =
    await Promise.all([
      locationsQuery,
      employeesQuery,
      sessionsQuery,
    ]);

  if (locError || empError || sessionError) {
    return NextResponse.json(
      { ok: false, error: locError?.message || empError?.message || sessionError?.message || "Query error" },
      { status: 500 }
    );
  }

  const latestMap = new Map<string, (typeof locations)[number]>();
  for (const loc of locations || []) {
    if (!latestMap.has(loc.profile_id)) {
      latestMap.set(loc.profile_id, loc);
    }
  }

  const sessionMap = new Map((sessions || []).map((s) => [s.profile_id, s]));

  const result = (employees || [])
    .filter((e) => e.is_active !== false && e.status !== "archived")
    .map((e) => {
      const pid = e.profile_id;
      const latest = pid ? latestMap.get(pid) : undefined;
      const activeSession = pid ? sessionMap.get(pid) : undefined;
      const health = deriveTrackingStatus({
        isOnDuty: Boolean(activeSession),
        capturedAt: latest?.captured_at,
        deviceStatus: activeSession?.device_status,
        nowMs: serverNow,
      });
      return {
        profileId: pid ?? e.id,
        employeeName: e.full_name || "Unknown",
        role: e.designation || "",
        latitude: latest?.latitude ?? null,
        longitude: latest?.longitude ?? null,
        accuracy: latest?.accuracy ?? null,
        speed: latest?.speed ?? null,
        heading: latest?.heading ?? null,
        capturedAt: latest?.captured_at ?? null,
        isOnDuty: Boolean(activeSession),
        dutySessionId: activeSession?.id ?? null,
        scheduledEndAt: activeSession?.scheduled_end_at ?? null,
        deviceStatus: activeSession?.device_status ?? null,
        trackingStatus: health.trackingStatus,
        trackingStatusLabel: trackingStatusLabel(health.trackingStatus),
        trackingError: activeSession?.last_error ?? null,
        assignedArea: null,
        lastUpdateAge: health.lastUpdateAge,
        hasLocation: !!latest,
      };
    });

  return NextResponse.json({ ok: true, employees: result, total: result.length });
}
