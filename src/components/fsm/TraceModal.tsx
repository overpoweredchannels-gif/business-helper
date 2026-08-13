"use client";

import { useCallback, useEffect, useState } from "react";
import { getGoogleMaps } from "@/lib/maps/client-loader";
import { getMapProvider } from "@/lib/maps/map-provider";
import { getPlaceName } from "@/lib/maps/client-maps";
import { Loader2, MapPin, X, ExternalLink, Navigation, Clock, Crosshair } from "lucide-react";
import type { CurrentLocationView } from "@/lib/location/types";

export interface TracePoint {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  captured_at: string;
}

interface TraceModalProps {
  employee: CurrentLocationView;
  points: TracePoint[];
  onClose: () => void;
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Time gap between consecutive points, in minutes. */
function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

/** Human-friendly "moved X m in Y min" summary between two points. */
function moveInfo(meters: number | null, minutes: number | null): string {
  if (meters == null) return "";
  const dist = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  const time = minutes != null && minutes >= 1 ? ` in ${Math.round(minutes)} min` : "";
  return ` · moved ${dist}${time}`;
}

function buildTrailEmbedUrl(points: TracePoint[], liveLat?: number, liveLng?: number): string {
  const pts = points.length > 0 ? points : [];
  if (pts.length === 0) {
    if (liveLat != null && liveLng != null) {
      return `https://maps.google.com/maps?q=${liveLat},${liveLng}&z=15&output=embed`;
    }
    return "";
  }
  const first = `${pts[0].latitude},${pts[0].longitude}`;
  const rest = pts
    .slice(1)
    .map((p) => `${p.latitude},${p.longitude}`)
    .join("+to:");
  return `https://maps.google.com/maps?saddr=${first}&daddr=${rest}&output=embed&z=14`;
}

function useInteractiveMap(): { google: any; loading: boolean; available: boolean } {
  const [google, setGoogle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    getGoogleMaps().then((g) => {
      if (!alive) return;
      setGoogle(g);
      setAvailable(Boolean(g));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { google, loading, available };
}

function InteractiveTrace({
  google,
  employee,
  points,
  liveLat,
  liveLng,
}: {
  google: any;
  employee: CurrentLocationView;
  points: TracePoint[];
  liveLat?: number;
  liveLng?: number;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !google) return;
      const map = new google.maps.Map(node, {
        zoom: 14,
        center: {
          lat: liveLat ?? points[points.length - 1]?.latitude ?? 31.5204,
          lng: liveLng ?? points[points.length - 1]?.longitude ?? 74.3587,
        },
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        fullscreenControl: true,
        streetViewControl: false,
      });

      const bounds = new google.maps.LatLngBounds();
      const infoWindow = new google.maps.InfoWindow();

      if (points.length > 0) {
        const path = points.map((p) => ({ lat: p.latitude, lng: p.longitude }));
        new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: "#2563eb",
          strokeOpacity: 0.9,
          strokeWeight: 3,
          map,
        });
        new google.maps.Marker({
          position: path[0],
          map,
          title: "Start",
          label: { text: "S", color: "#ffffff", fontSize: "11px" },
        });
        path.forEach((p, i) => {
          if (i === 0 || i === path.length - 1) return;
          new google.maps.Marker({
            position: p,
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 4,
              fillColor: "#2563eb",
              fillOpacity: 0.9,
              strokeColor: "#ffffff",
              strokeWeight: 1,
            },
            title: new Date(points[i].captured_at).toLocaleTimeString(),
          });
          bounds.extend(p);
        });
        bounds.extend(path[0]);
        bounds.extend(path[path.length - 1]);
      }

      if (liveLat != null && liveLng != null && typeof liveLat === "number") {
        const marker = new google.maps.Marker({
          position: { lat: liveLat, lng: liveLng },
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          title: `${employee.employeeName} (live)`,
        });
        marker.addListener("click", () => {
          infoWindow.setContent(
            `<div style="font-family:sans-serif;font-size:13px;line-height:1.5"><strong>${employee.employeeName}</strong><br/>Live location</div>`
          );
          infoWindow.open(map, marker);
        });
        bounds.extend(marker.getPosition());
      }

      if (bounds.getNorthEast()) {
        map.fitBounds(bounds, 60);
      }

      return () => {
        map.setMap && map.setMap(null);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [google, employee.employeeName, employee.profileId, liveLat, liveLng]
  );

  return <div ref={ref} className="h-full min-h-[420px] w-full" />;
}

export default function TraceModal({ employee, points, onClose }: TraceModalProps) {
  const { google, loading: mapLoading, available: mapAvailable } = useInteractiveMap();
  const [placeMap, setPlaceMap] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  const liveLat = employee.hasLocation && employee.latitude != null ? employee.latitude : undefined;
  const liveLng = employee.hasLocation && employee.longitude != null ? employee.longitude : undefined;
  const reversed = [...points].reverse();
  const provider = getMapProvider();
  const embedUrl = buildTrailEmbedUrl(points, liveLat, liveLng);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Auto-resolve a place name for every recorded point in the background, so the
  // owner sees street/shop names without having to tap each one.
  useEffect(() => {
    if (points.length === 0) return;
    let alive = true;
    (async () => {
      for (const p of points) {
        const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
        if (placeMap[key]) continue;
        const place = await getPlaceName(p.latitude, p.longitude);
        if (!alive) return;
        setPlaceMap((prev) => (prev[key] ? prev : { ...prev, [key]: place?.label ?? "Unknown location" }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  const resolvePlace = async (p: TracePoint) => {
    const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
    if (placeMap[key]) return;
    setResolving(key);
    const place = await getPlaceName(p.latitude, p.longitude);
    setPlaceMap((prev) => ({ ...prev, [key]: place?.label ?? "Unknown location" }));
    setResolving(null);
  };// eslint-disable-next-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-card sm:h-[92vh] sm:max-w-5xl sm:rounded-3xl sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground truncate">{employee.employeeName}</div>
            <div className="text-xs text-body flex items-center gap-1.5">
              {employee.isOnDuty ? "On duty" : "Off duty"}
              {liveLat != null && liveLng != null && (
                <span className="inline-flex items-center gap-1 text-success">
                  <Crosshair className="size-3" /> Live
                </span>
              )}
              <span className="text-light-text">· {points.length} recorded points</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-body hover:bg-muted/60 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Big map */}
        <div className="relative min-h-[300px] flex-1 border-b border-border">
          {mapAvailable && google ? (
            <InteractiveTrace google={google} employee={employee} points={points} liveLat={liveLat} liveLng={liveLng} />
          ) : mapLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-body">
              <Loader2 className="size-5 animate-spin" /> Loading map...
            </div>
          ) : embedUrl ? (
            <iframe
              title={`Movement trail for ${employee.employeeName}`}
              src={embedUrl}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              className="h-full w-full min-h-[300px]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-light-text">
              No location data available for this employee.
            </div>
          )}
          {points.length > 0 && (
            <a
              href={liveLat != null && liveLng != null
                ? provider.buildDirectionsUrl({
                    destinationLabel: `${employee.employeeName} (live)`,
                    destination: { latitude: liveLat, longitude: liveLng },
                  })
                : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-xs font-semibold text-background shadow-lg hover:opacity-90"
            >
              <Navigation className="size-3.5" /> Navigate
            </a>
          )}
        </div>

        {/* Recorded points */}
        <div className="max-h-[40%] overflow-y-auto px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <Clock className="size-3.5 text-primary" /> Recorded points
            </span>
            <span className="text-light-text">Street names are resolved automatically; tap for details</span>
          </div>
          {reversed.length === 0 ? (
            <p className="text-sm text-light-text">No recorded points in the last 2 hours.</p>
          ) : (
            <div className="grid gap-2">
              {reversed.map((p, i) => {
                const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
                const place = placeMap[key];
                const isResolving = resolving === key;
                const prev = reversed[i + 1];
                const movedMeters = prev ? haversineMeters(prev, p) : null;
                const gapMinutes = prev ? minutesBetween(prev.captured_at, p.captured_at) : null;
                const isNewest = i === 0;
                return (
                  <button
                    key={`${p.captured_at}-${i}`}
                    onClick={() => resolvePlace(p)}
                    className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span
                      className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isNewest ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {isNewest ? "LIVE" : `#${i}`}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="size-3.5 shrink-0 text-primary" />
                        <span className="text-xs font-medium text-foreground truncate">
                          {place ?? (isResolving ? "Resolving place name..." : "Place name not available")}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-light-text">
                        {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                        {p.speed != null && p.speed > 1
                          ? ` · ${Math.round(p.speed * 3.6)} km/h`
                          : movedMeters != null && movedMeters < 25
                            ? " · stationary"
                            : moveInfo(movedMeters, gapMinutes)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-body">
                        {new Date(p.captured_at).toLocaleString()}
                        {isNewest && p.captured_at
                          ? ` · ${Math.max(0, Math.round((Date.now() - new Date(p.captured_at).getTime()) / 60000))}m ago`
                          : ""}
                      </div>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 rounded-full border border-border p-1.5 text-body hover:bg-muted/60 hover:text-foreground"
                      aria-label="Open in Google Maps"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}