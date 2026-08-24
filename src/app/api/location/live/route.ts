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
    .select("profile_id, id, status")
    .eq("organization_id", organizationId)
    .eq("status", "on_duty");
  if (!canViewTeam) {
    locationsQuery = locationsQuery.eq("profile_id", permission.actor.profileId);
    employeesQuery = employeesQuery.eq("profile_id", permission.actor.profileId);
    sessionsQuery = sessionsQuery.eq("profile_id", permission.actor.profileId);
  }

  const [{ data: locations, error: locError }, { data: employees, error: empError }, { data: sessions }] =
    await Promise.all([
      locationsQuery,
      employeesQuery,
      sessionsQuery,
    ]);

  if (locError || empError) {
    return NextResponse.json(
      { ok: false, error: locError?.message || empError?.message || "Query error" },
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

  const result = (employees || [])
    .filter((e) => e.is_active !== false && e.status !== "archived")
    .map((e) => {
      const pid = e.profile_id;
      const latest = pid ? latestMap.get(pid) : undefined;
      const age = latest ? serverNow - new Date(latest.captured_at).getTime() : Infinity;
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
        isOnDuty: pid ? onDutySet.has(pid) : false,
        dutySessionId: pid ? sessionMap.get(pid) || null : null,
        assignedArea: null,
        lastUpdateAge: age,
        hasLocation: !!latest,
      };
    });

  return NextResponse.json({ ok: true, employees: result, total: result.length });
}
