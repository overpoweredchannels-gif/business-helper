import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const serverNow = Date.now();

  const [{ data: locations, error: locError }, { data: staff, error: staffError }, { data: sessions }] =
    await Promise.all([
      supabase
        .from("staff_location_points")
        .select("profile_id, latitude, longitude, accuracy, speed, heading, altitude, captured_at, duty_session_id")
        .eq("organization_id", organizationId)
        .gte("captured_at", cutoff)
        .order("captured_at", { ascending: false }),

      supabase
        .from("profiles")
        .select("id, name, role, is_active_duty")
        .eq("organization_id", organizationId),

      supabase
        .from("staff_duty_sessions")
        .select("profile_id, id, status")
        .eq("organization_id", organizationId)
        .eq("status", "on_duty"),
    ]);

  if (locError || staffError) {
    return NextResponse.json(
      { ok: false, error: locError?.message || staffError?.message || "Query error" },
      { status: 500 }
    );
  }

  const latestMap = new Map<string, (typeof locations)[number]>();
  for (const loc of locations || []) {
    if (!latestMap.has(loc.profile_id)) {
      latestMap.set(loc.profile_id, loc);
    }
  }

  const onDutySet = new Set((sessions || []).map((s) => s.profile_id));
  const sessionMap = new Map((sessions || []).map((s) => [s.profile_id, s.id]));

  const result = (staff || []).map((s) => {
    const latest = latestMap.get(s.id);
    const age = latest ? serverNow - new Date(latest.captured_at).getTime() : Infinity;
    return {
      profileId: s.id,
      employeeName: s.name || "Unknown",
      role: s.role || "",
      latitude: latest?.latitude ?? null,
      longitude: latest?.longitude ?? null,
      accuracy: latest?.accuracy ?? null,
      speed: latest?.speed ?? null,
      heading: latest?.heading ?? null,
      capturedAt: latest?.captured_at ?? null,
      isOnDuty: onDutySet.has(s.id),
      dutySessionId: sessionMap.get(s.id) || null,
      assignedArea: null,
      lastUpdateAge: age,
      hasLocation: !!latest,
    };
  });

  return NextResponse.json({ ok: true, employees: result, total: result.length });
}