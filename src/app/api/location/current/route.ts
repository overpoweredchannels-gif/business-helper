import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveActor } from "@/lib/identity/api-context";
import { deriveTrackingStatus, trackingStatusLabel } from "@/lib/location/tracking-status";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const context = await resolveActor(request);
    if (context.error || !context.actor?.organizationId) {
      return errorResponse(context.error ?? "Unauthorized", context.status ?? 401);
    }

    const organizationId = searchParams.get("organizationId") || context.actor.organizationId;
    if (String(organizationId) !== String(context.actor.organizationId)) {
      return errorResponse("Forbidden: organization mismatch", 403);
    }

    const actorRole = context.actor.role;
    const actorProfileId = context.actor.profileId;
    const requesterRole = actorRole === "owner" || actorRole === "manager" ? actorRole : "employee";

    const supabase = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await supabase.rpc("close_expired_duty_sessions", { p_now: new Date().toISOString() });

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: locations, error: locError } = await supabase
      .from("staff_location_points")
      .select("profile_id, latitude, longitude, accuracy, speed, heading, altitude, captured_at, duty_session_id")
      .eq("organization_id", organizationId)
      .gte("captured_at", cutoff)
      .order("captured_at", { ascending: false });

    if (locError) return errorResponse(`Query error: ${locError.message}`, 500);

    const latestMap = new Map<string, typeof locations[0]>();
    for (const loc of locations || []) {
      if (!latestMap.has(loc.profile_id)) {
        latestMap.set(loc.profile_id, loc);
      }
    }

    const { data: employees, error: staffError } = await supabase
      .from("employees")
      .select("id, profile_id, full_name, designation, status, is_active")
      .eq("organization_id", organizationId);

    if (staffError) return errorResponse(`Staff query error: ${staffError.message}`, 500);

    let filteredStaff = employees || [];
    if (requesterRole !== "owner" && requesterRole !== "manager" && actorProfileId) {
      filteredStaff = filteredStaff.filter((s) => s.profile_id === actorProfileId);
    }

    const { data: sessions } = await supabase
      .from("staff_duty_sessions")
      .select("profile_id, id, status, scheduled_end_at, device_status, last_error")
      .eq("organization_id", organizationId)
      .eq("status", "on_duty");

    const sessionMap = new Map((sessions || []).map((s) => [s.profile_id, s]));

    const result = filteredStaff
      .filter((e) => e.is_active !== false && e.status !== "archived")
      .map((s) => {
        const pid = s.profile_id;
        const latest = pid ? latestMap.get(pid) : undefined;
        const activeSession = pid ? sessionMap.get(pid) : undefined;
        const health = deriveTrackingStatus({
          isOnDuty: Boolean(activeSession),
          capturedAt: latest?.captured_at,
          deviceStatus: activeSession?.device_status,
        });
        return {
          profileId: pid ?? s.id,
          employeeName: s.full_name || "Unknown",
          role: s.designation || "",
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
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}
