import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveActor } from "@/lib/identity/api-context";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, deviceName } = body;

    if (!action || !["register", "signout", "status", "start"].includes(action)) {
      return errorResponse("action must be register, signout, status, or start");
    }

    // Resolve the signed-in actor from the bearer token so employees can manage
    // their own duty sessions (the existing service-role path below is kept for
    // actions where a trusted client provides organization/profile ids).
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
      if (hasLatitude !== hasLongitude || (hasLatitude && (!Number.isFinite(startLatitude) || !Number.isFinite(startLongitude) || startLatitude < -90 || startLatitude > 90 || startLongitude < -180 || startLongitude > 180)) || (startAccuracy != null && (!Number.isFinite(startAccuracy) || startAccuracy < 0))) {
        return errorResponse("Valid start coordinates must be provided together");
      }

      const { data: existingDuty, error: dutyError } = await supabase
        .from("staff_duty_sessions")
        .select("id, status, started_at")
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .eq("status", "on_duty")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dutyError) return errorResponse(`Duty lookup error: ${dutyError.message}`, 500);

      if (existingDuty) {
        return NextResponse.json({
          ok: true,
          started: false,
          dutySessionId: existingDuty.id,
          message: "Active duty session found",
        });
      }

      const startedAt = new Date().toISOString();
      const { data: created, error: createError } = await supabase
        .from("staff_duty_sessions")
        .insert({
          organization_id: organizationId,
          profile_id: profileId,
          status: "on_duty",
          started_at: startedAt,
          start_latitude: startLatitude ?? null,
          start_longitude: startLongitude ?? null,
          start_accuracy: startAccuracy ?? null,
          notes: deviceName ? `Device: ${deviceName}` : null,
        })
        .select("id")
        .single();

      if (createError) return errorResponse(`Duty start error: ${createError.message}`, 500);

      return NextResponse.json({
        ok: true,
        started: true,
        dutySessionId: created.id,
        message: "Duty session started",
      });
    }

    if (action === "register") {
      const { data: existingDuty, error: dutyError } = await supabase
        .from("staff_duty_sessions")
        .select("id, status, started_at")
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .eq("status", "on_duty")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dutyError) return errorResponse(`Duty lookup error: ${dutyError.message}`, 500);

      return NextResponse.json({
        ok: true,
        dutySessionId: existingDuty?.id || null,
        message: existingDuty ? "Active duty session found" : "No active duty session. Start duty first.",
      });
    }

    if (action === "signout") {
      const endedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("staff_duty_sessions")
        .update({ status: "off_duty", ended_at: endedAt, updated_at: endedAt })
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .eq("status", "on_duty");

      if (updateError) return errorResponse(`Signout error: ${updateError.message}`, 500);

      return NextResponse.json({ ok: true, message: "Signed out successfully." });
    }

    if (action === "status") {
      const { data: activeDuty } = await supabase
        .from("staff_duty_sessions")
        .select("id, started_at")
        .eq("organization_id", organizationId)
        .eq("profile_id", profileId)
        .eq("status", "on_duty")
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        onDuty: !!activeDuty,
        dutySessionId: activeDuty?.id || null,
        startedAt: activeDuty?.started_at || null,
      });
    }

    return errorResponse("Unknown action");
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}
