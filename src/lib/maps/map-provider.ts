// TradeOS FSM — Mapping & Navigation abstraction.
//
// The FSM module must never hard-code a mapping provider. All route planning,
// territory management, and navigation flows call MapProvider so a Google Maps
// Platform API key can be plugged in later (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
// without changing business logic.
//
// Until the key is provided, MapProvider uses Google Maps deep links
// (https://www.google.com/maps/dir/...) which work in-browser and on mobile
// with zero configuration.

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface RouteStopInput {
  customerId: string;
  label: string;
  location?: GeoPoint | null;
}

export interface NavigationRequest {
  destinationLabel: string;
  destination?: GeoPoint | null;
  address?: string | null;
  waypoints?: GeoPoint[];
  travelMode?: "driving" | "walking" | "bicycling" | "transit";
}

export interface NavigationProvider {
  readonly name: string;
  hasInteractiveMap(): boolean;
  /** Returns a URL (deep link) to navigate from current location to the destination. */
  buildDirectionsUrl(request: NavigationRequest): string;
  /** Returns a URL to view a single location. */
  buildMapUrl(location: GeoPoint, label?: string): string;
  /** Returns an iframe-embeddable URL to render a map at a single location. */
  buildEmbedMapUrl(location: GeoPoint, label?: string): string;
}

export * from "./google-maps";

function formatCoordinate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(6);
}

/**
 * Fallback provider built on Google Maps deep links. Works everywhere today;
 * swap for an embedded interactive renderer when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 * is configured.
 */
class GoogleMapsDeepLinkProvider implements NavigationProvider {
  readonly name = "google-maps-deep-link";

  hasInteractiveMap(): boolean {
    return false;
  }

  buildDirectionsUrl(request: NavigationRequest): string {
    const mode = request.travelMode ?? "driving";
    const parts: string[] = [];

    if (request.waypoints && request.waypoints.length > 0) {
      // Origin + waypoints + destination via deep link (format: lat,lng/to/...).
      const coords = request.waypoints
        .map((p) => `${formatCoordinate(p.latitude)},${formatCoordinate(p.longitude)}`)
        .filter((c) => c.includes("."));
      if (coords.length > 0) {
        parts.push(coords.join("+"));
        parts.push("to");
      }
    }

    if (request.destination) {
      parts.push(
        `${formatCoordinate(request.destination.latitude)},${formatCoordinate(request.destination.longitude)}`
      );
    } else if (request.address) {
      parts.push(encodeURIComponent(request.address));
    } else {
      parts.push(encodeURIComponent(request.destinationLabel || ""));
    }

    const base = parts.join("/");
    const query = [
      `api=1`,
      `destination=${encodeURIComponent(request.destinationLabel || "")}`,
      `travelmode=${mode}`,
    ].join("&");
    return `https://www.google.com/maps/dir/${base}?${query}`;
  }

  buildMapUrl(location: GeoPoint, label?: string): string {
    const q =
      formatCoordinate(location.latitude) && formatCoordinate(location.longitude)
        ? `${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`
        : label
          ? encodeURIComponent(label)
          : "";
    return `https://www.google.com/maps?q=${q}`;
  }

  buildEmbedMapUrl(location: GeoPoint, label?: string): string {
    const q =
      formatCoordinate(location.latitude) && formatCoordinate(location.longitude)
        ? `${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`
        : label
          ? encodeURIComponent(label)
          : "";
    return `https://maps.google.com/maps?q=${q}&z=15&output=embed`;
  }
}

class InteractiveMapProvider implements NavigationProvider {
  readonly name = "google-maps-embedded";

  hasInteractiveMap(): boolean {
    return true;
  }

  buildDirectionsUrl(request: NavigationRequest): string {
    return new GoogleMapsDeepLinkProvider().buildDirectionsUrl(request);
  }

  buildMapUrl(location: GeoPoint, label?: string): string {
    return new GoogleMapsDeepLinkProvider().buildMapUrl(location, label);
  }

  buildEmbedMapUrl(location: GeoPoint, label?: string): string {
    return new GoogleMapsDeepLinkProvider().buildEmbedMapUrl(location, label);
  }
}

function isGoogleMapsConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

export class MapProvider {
  private readonly provider: NavigationProvider;

  constructor() {
    this.provider = isGoogleMapsConfigured()
      ? new InteractiveMapProvider()
      : new GoogleMapsDeepLinkProvider();
  }

  hasInteractiveMap(): boolean {
    return this.provider.hasInteractiveMap();
  }

  buildDirectionsUrl(request: NavigationRequest): string {
    return this.provider.buildDirectionsUrl(request);
  }

  buildMapUrl(location: GeoPoint, label?: string): string {
    return this.provider.buildMapUrl(location, label);
  }

  buildEmbedMapUrl(location: GeoPoint, label?: string): string {
    return this.provider.buildEmbedMapUrl(location, label);
  }
}

let sharedMapProvider: MapProvider | null = null;

export function getMapProvider(): MapProvider {
  if (!sharedMapProvider) {
    sharedMapProvider = new MapProvider();
  }
  return sharedMapProvider;
}

/**
 * Opens navigation to the given destination in a new tab/app using the
 * configured provider. Business code calls this; it never touches provider
 * internals.
 */
export function openNavigation(request: NavigationRequest): void {
  const provider = getMapProvider();
  const url = provider.buildDirectionsUrl(request);
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Opens a single location (map pin / customer location) using the configured
 * provider.
 */
export function openMapLocation(location: GeoPoint, label?: string): void {
  const provider = getMapProvider();
  const url = provider.buildMapUrl(location, label);
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Full route (multi-stop) deep link builder. */
export function buildMultiStopNavigationUrl(
  stops: RouteStopInput[],
  travelMode: NavigationRequest["travelMode"] = "driving",
): string {
  const provider = getMapProvider();
  const withLocation = stops.filter(
    (stop): stop is RouteStopInput & { location: GeoPoint } =>
      Boolean(stop.location && Number.isFinite(stop.location.latitude)),
  );
  const destination = withLocation[withLocation.length - 1];
  const waypoints = withLocation.slice(0, -1).map((stop) => stop.location);
  return provider.buildDirectionsUrl({
    destinationLabel: destination?.label ?? "",
    destination: destination?.location,
    waypoints,
    travelMode,
  });
}
