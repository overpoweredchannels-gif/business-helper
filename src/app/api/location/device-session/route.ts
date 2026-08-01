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
    const { action, organizationId, profileId, deviceToken, deviceName } = body;

    if (!action || !["register", "signout", "status"].includes(action)) {
      return errorResponse("action must be register, signout, or status");
    }
    if (!organizationId) return errorResponse("organizationId is required");
    if (!profileId) return errorResponse("profileId is required");

    const supabase = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
