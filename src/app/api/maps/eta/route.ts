import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/identity/authorization";
import { getDirections, mapsClient } from "@/lib/maps/google-maps";

export const runtime = "nodejs";

/**
 * GET /api/maps/eta?originLat=31.49&originLng=74.34&destLat=31.52&destLng=74.35
 *
 * Returns driving distance + travel time from the owner's current location to an
 * employee's live location via the Google Directions API. Used by the Navigate
 * button so the owner sees "18 min · 12.4 km" before launching turn-by-turn.
 */
export async function GET(request: NextRequest) {
  const permission = await requireOrganization(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const originLat = Number(searchParams.get("originLat"));
  const originLng = Number(searchParams.get("originLng"));
  const destLat = Number(searchParams.get("destLat"));
  const destLng = Number(searchParams.get("destLng"));

  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng)
  ) {
    return NextResponse.json({ ok: false, error: "originLat, originLng, destLat, destLng are required" }, { status: 400 });
  }

  if (!mapsClient) {
    return NextResponse.json({ ok: true, configured: false, eta: null });
  }

  try {
    const result = await getDirections(
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng }
    );
    if (!result) {
      return NextResponse.json({ ok: true, configured: true, eta: null });
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      eta: {
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "ETA lookup failed" },
      { status: 500 }
    );
  }
}