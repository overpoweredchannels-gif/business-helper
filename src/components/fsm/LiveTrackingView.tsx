"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { getMapProvider } from "@/lib/maps/map-provider";
import { getPlaceName, getEta, formatEta, type EtaResult } from "@/lib/maps/client-maps";
import {
  Loader2,
  AlertCircle,
  Navigation,
  MapPin,
  Clock,
  ChevronDown,
  Maximize2,
  Crosshair,
  ExternalLink,
} from "lucide-react";
import type { CurrentLocationView } from "@/lib/location/types";
import TraceModal, { type TracePoint } from "./TraceModal";

type FilterKey = "all" | "on_duty" | "off_duty" | "with_location" | "moving" | "stale";

export default function LiveTrackingView({ compact = false }: { compact?: boolean }) {
  const [employees, setEmployees] = useState<CurrentLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pollInterval, setPollInterval] = useState(15000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, TracePoint[]>>({});
  const [booting, setBooting] = useState<string | null>(null);
  const [liveLabel, setLiveLabel] = useState<Record<string, string>>({});
  const [etas, setEtas] = useState<Record<string, EtaResult | null>>({});
  const [etaLoading, setEtaLoading] = useState<string | null>(null);
  const [traceModal, setTraceModal] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/location/live");
      const data = await res.json();
      if (data.ok) {
        setEmployees(data.employees || []);
        setError(null);
      } else {
        setError(data.error || "Failed to load live locations");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, pollInterval);
    return () => clearInterval(interval);
  }, [load, pollInterval]);

  // Lazily reverse-geocode the live location for each visible employee.
  const resolveLiveLabel = useCallback(async (emp: CurrentLocationView) => {
    if (!emp.hasLocation || emp.latitude == null || emp.longitude == null) return;
    const key = `${emp.latitude.toFixed(4)},${emp.longitude.toFixed(4)}`;
    if (liveLabel[key]) return;
    const place = await getPlaceName(emp.latitude, emp.longitude);
    if (place?.label) {
      setLiveLabel((prev) => ({ ...prev, [key]: place.label }));
    }
  }, [liveLabel]);

  useEffect(() => {
    employees.forEach((e) => {
      void resolveLiveLabel(e);
    });
  }, [employees, resolveLiveLabel]);

  const onDuty = employees.filter((e) => e.isOnDuty);
  const withLocation = employees.filter((e) => e.hasLocation);
  const moving = employees.filter((e) => (e.speed ?? 0) > 1);
  const stale = employees.filter((e) => e.isOnDuty && (!e.hasLocation || e.lastUpdateAge > 300000));

  let filtered = employees;
  if (filter === "on_duty") filtered = onDuty;
  else if (filter === "off_duty") filtered = employees.filter((e) => !e.isOnDuty);
  else if (filter === "with_location") filtered = withLocation;
  else if (filter === "moving") filtered = moving;
  else if (filter === "stale") filtered = stale;

  const counts: Record<FilterKey, number> = {
    all: employees.length,
    on_duty: onDuty.length,
    off_duty: employees.length - onDuty.length,
    with_location: withLocation.length,
    moving: moving.length,
    stale: stale.length,
  };

  const toggleDetails = async (emp: CurrentLocationView) => {
    setExpanded((prev) => (prev === emp.profileId ? null : emp.profileId));
    if (emp.profileId !== expanded) {
      setBooting(emp.profileId);
      try {
        const res = await authorizedFetch(
          `/api/location/history?profile_id=${encodeURIComponent(emp.profileId)}&minutes=15`
        );
        const data = await res.json();
        if (data.ok) {
          setHistory((prev) => ({ ...prev, [emp.profileId]: data.points ?? [] }));
        }
      } catch {
        // ignore; trail is best-effort
      } finally {
        setBooting(null);
      }
    }
  };

  /**
   * Owner clicks Navigate: ask the browser for the owner's own location to
   * compute ETA, then open turn-by-turn directions in Google Maps.
   */
  const handleNavigate = (emp: CurrentLocationView) => {
    if (!emp.latitude || !emp.longitude) return;
    if (!navigator.geolocation) return;
    setEtaLoading(emp.profileId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const eta = await getEta(latitude, longitude, emp.latitude!, emp.longitude!);
        setEtas((prev) => ({ ...prev, [emp.profileId]: eta }));
        setEtaLoading(null);
        const provider = getMapProvider();
        window.open(
          provider.buildDirectionsUrl({
            destinationLabel: `${emp.employeeName} (live location)`,
            destination: { latitude: emp.latitude!, longitude: emp.longitude! },
          }),
          "_blank",
          "noopener,noreferrer"
        );
      },
      () => {
        setEtaLoading(null);
        setEtas((prev) => ({ ...prev, [emp.profileId]: null }));
        const provider = getMapProvider();
        window.open(
          provider.buildDirectionsUrl({
            destinationLabel: `${emp.employeeName} (live location)`,
            destination: { latitude: emp.latitude!, longitude: emp.longitude! },
          }),
          "_blank",
          "noopener,noreferrer"
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const provider = getMapProvider();
  const traceEmployee = employees.find((e) => e.profileId === traceModal);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-body">
          <span>
            <span className="font-semibold text-foreground">{employees.length}</span> employees
          </span>
          <span>
            <span className="font-semibold text-success">{onDuty.length}</span> on duty
          </span>
          <span>
            <span className="font-semibold text-foreground">{withLocation.length}</span> with location
          </span>
          <span>
            <span className="font-semibold text-primary">{moving.length}</span> moving
          </span>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterKey)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          {(
            [
              ["all", "All Employees"],
              ["on_duty", "On Duty"],
              ["off_duty", "Off Duty"],
              ["with_location", "With Location"],
              ["moving", "Moving"],
              ["stale", "Stale / No Update"],
            ] as [FilterKey, string][]
          ).map(([key, label]) => (
            <option key={key} value={key}>
              {label} ({counts[key]})
            </option>
          ))}
        </select>
        <select
          value={pollInterval}
          onChange={(e) => setPollInterval(Number(e.target.value))}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value={5000}>5s refresh</option>
          <option value={15000}>15s refresh</option>
          <option value={30000}>30s refresh</option>
          <option value={60000}>1m refresh</option>
        </select>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {loading && employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading live locations...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-light-text">
          No employees match the current filter.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((emp) => {
            const points = history[emp.profileId] ?? [];
            const embedUrl =
              emp.hasLocation && emp.latitude != null && emp.longitude != null
                ? provider.buildEmbedMapUrl({ latitude: emp.latitude, longitude: emp.longitude }, emp.employeeName)
                : null;
            const last = points[points.length - 1];
            const labelKey =
              emp.latitude != null && emp.longitude != null
                ? `${emp.latitude.toFixed(4)},${emp.longitude.toFixed(4)}`
                : "";
            const placeLabel = labelKey ? liveLabel[labelKey] : undefined;
            const eta = etas[emp.profileId];
            return (
              <div key={emp.profileId} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
                {/* Listing header */}
                <div className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{emp.employeeName}</div>
                    <div className="text-xs text-body capitalize">{emp.role || "No role"}</div>
                    {emp.hasLocation ? (
                      <>
                        {placeLabel ? (
                          <div className="mt-0.5 flex items-start gap-1 text-xs text-foreground/90">
                            <MapPin className="size-3.5 mt-0.5 shrink-0 text-primary" />
                            <span className="truncate" title={placeLabel}>
                              {placeLabel}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-light-text">
                            <Crosshair className="size-3 shrink-0 animate-pulse text-success" />
                            <span className="font-mono">
                              {emp.latitude.toFixed(4)}, {emp.longitude.toFixed(4)}
                            </span>
                          </div>
                        )}
                        <div className="text-[11px] text-light-text">
                          {(emp.speed ?? 0) > 1 ? `Moving ${Math.round((emp.speed ?? 0) * 3.6)} km/h` : "Stationary"}
                          {emp.lastUpdateAge < 60000 ? " · now" : ` · ${Math.round(emp.lastUpdateAge / 60000)}m ago`}
                        </div>
                      </>
                    ) : (
                      emp.isOnDuty && <div className="text-xs text-warning mt-0.5">No location data</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`size-2.5 rounded-full ${
                        emp.isOnDuty ? (emp.hasLocation ? "bg-success" : "bg-warning") : "bg-muted-foreground"
                      }`}
                    />
                    <span className="text-[11px] text-body">{emp.isOnDuty ? "On Duty" : "Off Duty"}</span>
                  </div>
                </div>

                {/* Embedded live map (auto, no manual link needed) */}
                {embedUrl ? (
                  <iframe
                    title={`Live location for ${emp.employeeName}`}
                    src={embedUrl}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    className="w-full border-y border-border"
                    style={{ height: compact ? 160 : 180 }}
                  />
                ) : (
                  <div className="flex items-center gap-2 bg-muted/30 px-4 py-6 text-xs text-light-text border-y border-border">
                    <MapPin className="size-4 shrink-0" /> No location to show for this employee yet.
                  </div>
                )}

                {/* Actions */}
                <div className="px-4 py-3 flex flex-wrap gap-2">
                  {emp.hasLocation && (
                    <button
                      onClick={() => handleNavigate(emp)}
                      disabled={etaLoading === emp.profileId}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {etaLoading === emp.profileId ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Navigation className="size-3.5" />
                      )}
                      {eta ? `Navigate · ${formatEta(eta)}` : "Navigate"}
                    </button>
                  )}
                  {expanded === emp.profileId && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground">
                      <MapPin className="size-3.5" />
                      {points.length} recorded points
                    </span>
                  )}
                  {emp.hasLocation && (
                    <button
                      onClick={() => setTraceModal(emp.profileId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
                    >
                      <Maximize2 className="size-3.5" /> View Moments
                    </button>
                  )}
                  <button
                    onClick={() => toggleDetails(emp)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
                  >
                    <Clock className="size-3.5" />
                    {expanded === emp.profileId ? "Hide Movement" : "View Movement"}
                    <ChevronDown className={`size-3.5 transition-transform ${expanded === emp.profileId ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {/* Movement trail / history */}
                {expanded === emp.profileId && (
                  <div className="border-t border-border px-4 py-3 grid gap-3">
                    {booting === emp.profileId ? (
                      <div className="flex items-center gap-2 text-xs text-body">
                        <Loader2 className="size-3.5 animate-spin" /> Loading movement trail...
                      </div>
                    ) : points.length === 0 ? (
                      <div className="text-xs text-light-text">
                        No location history found for this employee in the last 15 minutes.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-light-text">{points.length} recorded points</span>
                          <span className="text-body">Last: {new Date(last.captured_at).toLocaleTimeString()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-primary">
                          <Maximize2 className="size-3.5" />
                          <button onClick={() => setTraceModal(emp.profileId)} className="underline underline-offset-2">
                            Open {emp.employeeName}&apos;s full movement map
                          </button>
                          <ExternalLink className="size-3.5 text-light-text" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {traceEmployee && (
        <TraceModal
          employee={traceEmployee}
          points={history[traceEmployee.profileId] ?? []}
          onClose={() => setTraceModal(null)}
        />
      )}
    </div>
  );
}