import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/location/history?profile_id=...&minutes=60
 *
 * Returns the location history (movement trail) for one employee within the
 * last `minutes` (default 60, max 24h). Points are ordered oldest first so a
 * polyline can trace the salesman's movement.
 *
 * Response: { ok, points: [{ latitude, longitude, speed, heading, captured_at }] }
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profile_id");
  if (!profileId) {
    return NextResponse.json({ ok: false, error: "profile_id is required" }, { status: 400 });
  }

  const minutes = Math.min(Math.max(Number(searchParams.get("minutes")) || 60, 5), 24 * 60);
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("staff_location_points")
    .select("latitude, longitude, speed, heading, captured_at")
    .eq("organization_id", permission.actor.organizationId)
    .eq("profile_id", profileId)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile_id: profileId,
    minutes,
    points: data ?? [],
  });
}