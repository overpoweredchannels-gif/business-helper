import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/identity/authorization";
import { reverseGeocode, mapsClient } from "@/lib/maps/google-maps";

export const runtime = "nodejs";

/**
 * GET /api/maps/reverse-geocode?lat=31.5204&lng=74.3587
 *
 * Returns the human-readable place name / street / address for a coordinate so
 * the live tracking UI can show "Main Boulevard, near XYZ Store" instead of raw
 * lat/lng numbers. Uses Google Geocoding (reverse) when GOOGLE_MAPS_API_KEY is
 * configured; otherwise returns a null place with a `configured:false` flag.
 */
export async function GET(request: NextRequest) {
  const permission = await requireOrganization(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: false, error: "lat and lng are required" }, { status: 400 });
  }

  if (!mapsClient) {
    return NextResponse.json({
      ok: true,
      configured: false,
      place: null,
    });
  }

  try {
    const result = await reverseGeocode(lat, lng);
    if (!result) {
      return NextResponse.json({ ok: true, configured: true, place: null });
    }

    // Prefer the most useful short label. Full formatted_address is the exact
    // street; we surface it verbatim so the owner sees the real place name.
    return NextResponse.json({
      ok: true,
      configured: true,
      place: {
        latitude: result.lat,
        longitude: result.lng,
        label: result.formattedAddress,
        placeId: result.placeId,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Reverse geocoding failed" },
      { status: 500 }
    );
  }
}
