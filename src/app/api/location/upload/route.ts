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

    if (!dutySessionId) return errorResponse("dutySessionId is required");
    if (typeof latitude !== "number" || typeof longitude !== "number") return errorResponse("latitude and longitude must be numbers");
    if (latitude < -90 || latitude > 90) return errorResponse("latitude out of range");
    if (longitude < -180 || longitude > 180) return errorResponse("longitude out of range");
    if (!capturedAt) return errorResponse("capturedAt is required");

    const serviceClient = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: dutySession, error: dutyError } = await serviceClient
      .from("staff_duty_sessions")
      .select("id, status")
      .eq("id", dutySessionId)
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (dutyError) return errorResponse(`Duty session lookup failed: ${dutyError.message}`, 500);
    if (!dutySession) return errorResponse("Duty session not found for this user.", 404);
    if (dutySession.status !== "on_duty") return errorResponse("Duty session is not active.", 400);

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
      captured_at: capturedAt,
    };

    const { data, error } = await serviceClient.from("staff_location_points").insert(point).select("id").single();
    if (error) return errorResponse(`Database error: ${error.message}`, 500);

    return NextResponse.json({ ok: true, pointId: data?.id });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}