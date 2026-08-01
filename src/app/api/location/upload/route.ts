import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { organizationId, profileId, dutySessionId, latitude, longitude, accuracy, speed, heading, altitude, capturedAt } = body;

    if (!organizationId) return errorResponse("organizationId is required");
    if (!profileId) return errorResponse("profileId is required");
    if (!dutySessionId) return errorResponse("dutySessionId is required");
    if (typeof latitude !== "number" || typeof longitude !== "number") return errorResponse("latitude and longitude must be numbers");
    if (latitude < -90 || latitude > 90) return errorResponse("latitude out of range");
    if (longitude < -180 || longitude > 180) return errorResponse("longitude out of range");
    if (!capturedAt) return errorResponse("capturedAt is required");

    const supabase = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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

    const { data, error } = await supabase.from("staff_location_points").insert(point).select("id").single();
    if (error) return errorResponse(`Database error: ${error.message}`, 500);

    return NextResponse.json({ ok: true, pointId: data?.id });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}
