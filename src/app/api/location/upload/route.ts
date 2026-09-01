import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseUserClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      return errorResponse("Missing authorization token.", 401);
    }
    const token = authorization.slice(7).trim();

    let userClient;
    try {
      userClient = createSupabaseUserClient(token);
    } catch (err) {
      return errorResponse(
        `Supabase is not configured: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return errorResponse("Invalid or expired session token.", 401);
    }
    const profileId = userData.user.id;

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id, organization_id, is_active")
      .eq("id", profileId)
      .maybeSingle();

    if (profileError) {
      return errorResponse(`Profile lookup failed: ${profileError.message}`, 500);
    }
    if (!profile) {
      return errorResponse("No workspace profile found for this user.", 404);
    }
    if (profile.is_active === false) {
      return errorResponse("This account has been deactivated.", 403);
    }

    const organizationId = profile.organization_id;

    const body = await request.json();
    const { dutySessionId, latitude, longitude, accuracy, speed, heading, altitude, capturedAt } = body;

    if (typeof dutySessionId !== "string" || !dutySessionId.trim()) return errorResponse("dutySessionId is required");
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || typeof longitude !== "number" || !Number.isFinite(longitude)) {
      return errorResponse("latitude and longitude must be finite numbers");
    }
    if (latitude < -90 || latitude > 90) return errorResponse("latitude out of range");
    if (longitude < -180 || longitude > 180) return errorResponse("longitude out of range");
    if (typeof capturedAt !== "string" || !capturedAt.trim()) return errorResponse("capturedAt must be a non-empty date string");

    const capturedAtDate = new Date(capturedAt);
    if (Number.isNaN(capturedAtDate.getTime())) return errorResponse("capturedAt must be a valid date");
    if (capturedAtDate.getTime() > Date.now() + 5 * 60 * 1000) {
      return errorResponse("capturedAt cannot be more than five minutes in the future");
    }
    for (const [name, value] of Object.entries({ accuracy, speed, heading, altitude })) {
      if (value != null && (typeof value !== "number" || !Number.isFinite(value))) {
        return errorResponse(`${name} must be a finite number or null`);
      }
    }
    if (typeof accuracy === "number" && accuracy < 0) return errorResponse("accuracy cannot be negative");

    const capturedAtIso = capturedAtDate.toISOString();

    const serviceClient = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The database cutoff is authoritative. Running it here as well as from
    // Supabase Cron closes an expired session even if the scheduled worker is
    // delayed by a minute.
    const { error: cutoffError } = await serviceClient.rpc("close_expired_duty_sessions", {
      p_now: new Date().toISOString(),
    });
    if (cutoffError) return errorResponse(`Duty cutoff failed: ${cutoffError.message}`, 500);

    const { data: dutySession, error: dutyError } = await serviceClient
      .from("staff_duty_sessions")
      .select("id, status, started_at, ended_at, scheduled_end_at")
      .eq("id", dutySessionId)
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (dutyError) return errorResponse(`Duty session lookup failed: ${dutyError.message}`, 500);
    if (!dutySession) return errorResponse("Duty session not found for this user.", 404);

    const sessionStart = new Date(dutySession.started_at).getTime();
    const sessionEnd = dutySession.ended_at ? new Date(dutySession.ended_at).getTime() : null;
    const scheduledEnd = dutySession.scheduled_end_at ? new Date(dutySession.scheduled_end_at).getTime() : null;
    const captureTime = capturedAtDate.getTime();
    const clockToleranceMs = 5 * 60 * 1000;
    if (!Number.isFinite(sessionStart)) return errorResponse("Duty session has an invalid start time.", 500);
    if (sessionEnd != null && !Number.isFinite(sessionEnd)) return errorResponse("Duty session has an invalid end time.", 500);
    if (scheduledEnd != null && !Number.isFinite(scheduledEnd)) return errorResponse("Duty session has an invalid cutoff time.", 500);
    if (scheduledEnd != null && captureTime > scheduledEnd) {
      return errorResponse("Duty session has reached its scheduled cutoff. Start duty again on the next working day.", 409);
    }
    if (captureTime < sessionStart - clockToleranceMs) {
      return errorResponse("Location time falls before this duty session.", 400);
    }
    if (sessionEnd != null && captureTime > sessionEnd) {
      return errorResponse("Duty session has ended. Stop tracking and start duty again when permitted.", 409);
    }
    if (dutySession.status !== "on_duty" && sessionEnd == null) {
      return errorResponse("Duty session is not active.", 409);
    }

    const { data: existingPoint, error: duplicateError } = await serviceClient
      .from("staff_location_points")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("duty_session_id", dutySessionId)
      .eq("captured_at", capturedAtIso)
      .maybeSingle();
    if (duplicateError) return errorResponse(`Duplicate check failed: ${duplicateError.message}`, 500);
    if (existingPoint) return NextResponse.json({ ok: true, pointId: existingPoint.id, duplicate: true });

    const point = {
      organization_id: organizationId,
      profile_id: profileId,
      duty_session_id: dutySessionId,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      speed: speed ?? null,
      heading: heading ?? null,
      altitude: altitude ?? null,
      captured_at: capturedAtIso,
    };

    const { data, error } = await serviceClient.from("staff_location_points").insert(point).select("id").single();
    if (error) return errorResponse(`Database error: ${error.message}`, 500);

    await serviceClient
      .from("staff_duty_sessions")
      .update({
        last_location_at: capturedAtIso,
        device_status: "tracking",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dutySessionId)
      .or(`last_location_at.is.null,last_location_at.lt.${capturedAtIso}`);

    return NextResponse.json({ ok: true, pointId: data?.id });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}
