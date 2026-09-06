type Coordinates = { lat: number; lng: number };
type Params = { key: string; [key: string]: unknown };
interface Place {
  place_id: string;
  name?: string;
  formatted_address: string;
  geometry?: { location: Coordinates };
  types?: string[];
}
interface Geocode extends Place { geometry: { location: Coordinates } }
interface Step {
  distance: { value: number };
  duration: { value: number };
  html_instructions: string;
  polyline: { points: string };
  start_location: Coordinates;
  end_location: Coordinates;
}
interface Leg extends Omit<Step, "html_instructions" | "polyline"> {
  start_address: string;
  end_address: string;
  steps: Step[];
}
interface Route { legs: Leg[]; overview_polyline: { points: string }; waypoint_order: number[] }

function encodeValue(value: unknown): string {
  if (typeof value === "object" && value !== null && "lat" in value && "lng" in value) {
    const point = value as Coordinates;
    return `${point.lat},${point.lng}`;
  }
  return String(value);
}

/** Small server-only transport for the existing Maps REST endpoints. Never expose request URLs in errors. */
export class Client {
  private async request<T>(endpoint: string, params: Params): Promise<{ data: T }> {
    const url = new URL(`https://maps.googleapis.com/maps/api/${endpoint}/json`);
    for (const [name, value] of Object.entries(params)) {
      if (value == null || name === "optimize") continue;
      let encoded = Array.isArray(value) ? value.map(encodeValue).join(name === "fields" ? "," : "|") : encodeValue(value);
      if (name === "waypoints" && params.optimize === true && encoded) encoded = `optimize:true|${encoded}`;
      url.searchParams.set(name, encoded);
    }
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    } catch {
      throw new Error("Google Maps could not be reached. Please retry.");
    }
    const data = await response.json().catch(() => null) as (T & { status?: string }) | null;
    if (data?.status === "ZERO_RESULTS" || data?.status === "NOT_FOUND") return { data };
    if (!response.ok || !data || data.status !== "OK") {
      throw new Error(`Google Maps request failed (${data?.status?.replace(/[^A-Z_]/g, "") || response.status}). Check API access and quota.`);
    }
    return { data };
  }
  geocode({ params }: { params: Params }) { return this.request<{ results: Geocode[] }>("geocode", params); }
  reverseGeocode({ params }: { params: Params }) { return this.geocode({ params }); }
  textSearch({ params }: { params: Params }) { return this.request<{ results: Place[] }>("place/textsearch", params); }
  placeDetails({ params }: { params: Params }) { return this.request<{ result: Place }>("place/details", params); }
  directions({ params }: { params: Params }) { return this.request<{ routes: Route[] }>("directions", params); }
}
