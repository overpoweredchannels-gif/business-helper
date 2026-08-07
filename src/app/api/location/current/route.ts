import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const profileId = searchParams.get("profileId");
    const requesterRole = searchParams.get("role") || "employee";

    if (!organizationId) return errorResponse("organizationId is required");

    const supabase = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
    if (requesterRole !== "owner" && requesterRole !== "manager" && profileId) {
      filteredStaff = filteredStaff.filter((s) => s.profile_id === profileId);
    }

    const { data: sessions } = await supabase
      .from("staff_duty_sessions")
      .select("profile_id, id, status")
      .eq("organization_id", organizationId)
      .eq("status", "on_duty");

    const onDutySet = new Set((sessions || []).map((s) => s.profile_id));
    const sessionMap = new Map((sessions || []).map((s) => [s.profile_id, s.id]));

    const result = filteredStaff
      .filter((e) => e.is_active !== false && e.status !== "archived")
      .map((s) => {
        const pid = s.profile_id;
        const latest = pid ? latestMap.get(pid) : undefined;
        const age = latest ? Date.now() - new Date(latest.captured_at).getTime() : Infinity;
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
          isOnDuty: pid ? onDutySet.has(pid) : false,
          dutySessionId: pid ? sessionMap.get(pid) || null : null,
          assignedArea: null,
          lastUpdateAge: age,
          hasLocation: !!latest,
        };
      });

    return NextResponse.json({ ok: true, employees: result, total: result.length });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
}