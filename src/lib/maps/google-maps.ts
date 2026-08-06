import { Client } from "@googlemaps/google-maps-services-js";

const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!apiKey) {
  console.warn("[Maps] GOOGLE_MAPS_API_KEY not set — Google Maps features will fail");
}

export const mapsClient = apiKey ? new Client() : null;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId: string;
}

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  types: string[];
}

export interface DirectionStep {
  distanceMeters: number;
  durationSeconds: number;
  instructions: string;
  polyline: string;
  startLocation: LatLng;
  endLocation: LatLng;
}

export interface DirectionsLeg {
  distanceMeters: number;
  durationSeconds: number;
  startAddress: string;
  endAddress: string;
  startLocation: LatLng;
  endLocation: LatLng;
  steps: DirectionStep[];
}

export interface DirectionsResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  legs: DirectionsLeg[];
}

export interface RouteOptimizationResult {
  orderedWaypoints: Array<{
    index: number;
    placeId: string;
    lat: number;
    lng: number;
    address: string;
  }>;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  polyline: string;
  legs: DirectionsLeg[];
}

/** Normalize a package location (union type) into our clean LatLng shape. */
function toLatLng(loc: unknown): LatLng {
  if (loc && typeof loc === "object" && "lat" in (loc as object)) {
    const l = loc as { lat: number; lng: number };
    return { lat: l.lat, lng: l.lng };
  }
  const arr = loc as [number, number];
  return { lat: arr[0], lng: arr[1] };
}

function toCoords(value: LatLng | string): string {
  return typeof value === "string" ? value : `${value.lat},${value.lng}`;
}

/**
 * Geocode an address to lat/lng using Google Geocoding API
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");

  try {
    const response = await mapsClient.geocode({ params: { address, key: apiKey! } });
    if (response.data.results.length === 0) return null;

    const result = response.data.results[0];
    const loc = toLatLng(result.geometry.location);
    return {
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
    };
  } catch (error) {
    console.error("[Maps] Geocode error:", error);
    throw error;
  }
}

/**
 * Reverse geocode lat/lng to address
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");

  try {
    const response = await mapsClient.reverseGeocode({
      params: { latlng: { lat, lng }, key: apiKey! },
    });
    if (response.data.results.length === 0) return null;

    const result = response.data.results[0];
    const loc = toLatLng(result.geometry.location);
    return {
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
    };
  } catch (error) {
    console.error("[Maps] Reverse geocode error:", error);
    throw error;
  }
}

/**
 * Search places by query (autocomplete-style)
 */
export async function searchPlaces(query: string, location?: LatLng, radius = 50000): Promise<PlaceResult[]> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");

  try {
    const params: Record<string, unknown> = {
      query,
      key: apiKey!,
    };
    if (location) {
      params.location = { lat: location.lat, lng: location.lng };
      params.radius = radius;
    }

    const response = await mapsClient.textSearch({ params: params as never });
    return response.data.results
      .filter((r) => r.geometry)
      .map((r) => {
        const loc = toLatLng(r.geometry!.location);
        return {
          placeId: r.place_id ?? "",
          name: r.name ?? "",
          formattedAddress: r.formatted_address ?? "",
          lat: loc.lat,
          lng: loc.lng,
          types: r.types ?? [],
        };
      });
  } catch (error) {
    console.error("[Maps] Places search error:", error);
    throw error;
  }
}

/**
 * Get place details by place_id
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");

  try {
    const response = await mapsClient.placeDetails({
      params: { place_id: placeId, key: apiKey!, fields: ["name", "formatted_address", "geometry", "types"] },
    });
    const r = response.data.result;
    if (!r.geometry) return null;
    const loc = toLatLng(r.geometry.location);
    return {
      placeId: r.place_id ?? placeId,
      name: r.name ?? "",
      formattedAddress: r.formatted_address ?? "",
      lat: loc.lat,
      lng: loc.lng,
      types: r.types ?? [],
    };
  } catch (error) {
    console.error("[Maps] Place details error:", error);
    throw error;
  }
}

/**
 * Get directions between origin and destination with optional waypoints
 * If optimize=true, Google solves TSP for waypoints
 */
export async function getDirections(
  origin: LatLng | string,
  destination: LatLng | string,
  waypoints?: Array<LatLng | string>,
  optimize = false
): Promise<DirectionsResult | null> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");

  try {
    const params: Record<string, unknown> = {
      origin: toCoords(origin),
      destination: toCoords(destination),
      key: apiKey!,
      mode: "driving",
    };

    if (waypoints && waypoints.length > 0) {
      params.waypoints = waypoints.map(toCoords);
      if (optimize) {
        params.optimize = true;
      }
    }

    const response = await mapsClient.directions({ params: params as never });
    if (response.data.routes.length === 0) return null;

    const route = response.data.routes[0];

    return {
      distanceMeters: route.legs.reduce((sum, leg) => sum + leg.distance.value, 0),
      durationSeconds: route.legs.reduce((sum, leg) => sum + leg.duration.value, 0),
      polyline: route.overview_polyline.points,
      legs: route.legs.map((l) => ({
        distanceMeters: l.distance.value,
        durationSeconds: l.duration.value,
        startAddress: l.start_address,
        endAddress: l.end_address,
        startLocation: toLatLng(l.start_location),
        endLocation: toLatLng(l.end_location),
        steps: l.steps.map((s) => ({
          distanceMeters: s.distance.value,
          durationSeconds: s.duration.value,
          instructions: s.html_instructions.replace(/<[^>]*>/g, ""),
          polyline: s.polyline.points,
          startLocation: toLatLng(s.start_location),
          endLocation: toLatLng(s.end_location),
        })),
      })),
    };
  } catch (error) {
    console.error("[Maps] Directions error:", error);
    throw error;
  }
}

/**
 * Optimize route order for multiple stops (Traveling Salesman Problem)
 * Returns waypoints in optimized order with total distance/duration
 */
export async function optimizeRoute(
  origin: LatLng,
  destination: LatLng,
  stops: Array<{ placeId: string; lat: number; lng: number; address: string }>
): Promise<RouteOptimizationResult | null> {
  if (!mapsClient) throw new Error("Google Maps client not initialized");
  if (stops.length === 0) return null;

  try {
    const waypoints = stops.map((s) => ({ lat: s.lat, lng: s.lng }));

    const response = await mapsClient.directions({
      params: {
        origin,
        destination,
        waypoints,
        optimize: true,
        key: apiKey!,
        mode: "driving" as never,
      },
    });

    if (response.data.routes.length === 0) return null;

    const route = response.data.routes[0];
    const waypointOrder = route.waypoint_order || [];

    const orderedWaypoints = waypointOrder.map((idx: number, order: number) => ({
      index: order,
      ...stops[idx],
    }));

    let totalDistance = 0;
    let totalDuration = 0;
    for (const leg of route.legs) {
      totalDistance += leg.distance.value;
      totalDuration += leg.duration.value;
    }

    return {
      orderedWaypoints,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      polyline: route.overview_polyline.points,
      legs: route.legs.map((l) => ({
        distanceMeters: l.distance.value,
        durationSeconds: l.duration.value,
        startAddress: l.start_address,
        endAddress: l.end_address,
        startLocation: toLatLng(l.start_location),
        endLocation: toLatLng(l.end_location),
        steps: l.steps.map((s) => ({
          distanceMeters: s.distance.value,
          durationSeconds: s.duration.value,
          instructions: s.html_instructions.replace(/<[^>]*>/g, ""),
          polyline: s.polyline.points,
          startLocation: toLatLng(s.start_location),
          endLocation: toLatLng(s.end_location),
        })),
      })),
    };
  } catch (error) {
    console.error("[Maps] Route optimization error:", error);
    throw error;
  }
}

/**
 * Check if a point is within a radius of another point (Haversine formula)
 * Useful for GPS verification without API call
 */
export function isWithinRadius(
  point: LatLng,
  center: LatLng,
  radiusMeters: number
): boolean {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(point.lat - center.lat);
  const dLng = toRad(point.lng - center.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(point.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance <= radiusMeters;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Decode Google encoded polyline to array of LatLng
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dLng;

    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }

  return points;
}