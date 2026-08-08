"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { getMapProvider } from "@/lib/maps/map-provider";
import { Loader2, AlertCircle, Navigation, MapPin, Clock, ChevronDown } from "lucide-react";
import type { CurrentLocationView } from "@/lib/location/types";

type FilterKey = "all" | "on_duty" | "off_duty" | "with_location" | "moving" | "stale";

interface HistoryPoint {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  captured_at: string;
}

export default function LiveTrackingView({ compact = false }: { compact?: boolean }) {
  const [employees, setEmployees] = useState<CurrentLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pollInterval, setPollInterval] = useState(15000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [booting, setBooting] = useState<string | null>(null);

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
          `/api/location/history?profile_id=${encodeURIComponent(emp.profileId)}&minutes=120`
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

  const provider = getMapProvider();

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
            const trace = points;
            const embedUrl =
              emp.hasLocation && emp.latitude != null && emp.longitude != null
                ? provider.buildEmbedMapUrl({ latitude: emp.latitude, longitude: emp.longitude }, emp.employeeName)
                : null;
            const last = points[points.length - 1];
            return (
              <div key={emp.profileId} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
                {/* Listing header */}
                <div className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{emp.employeeName}</div>
                    <div className="text-xs text-body capitalize">{emp.role || "No role"}</div>
                    {emp.hasLocation ? (
                      <div className="text-xs text-light-text mt-0.5">
                        {emp.latitude != null && emp.longitude != null
                          ? `${emp.latitude.toFixed(4)}, ${emp.longitude.toFixed(4)}`
                          : "Location unavailable"}
                        {(emp.speed ?? 0) > 1 ? ` · ${Math.round((emp.speed ?? 0) * 3.6)} km/h` : " · stationary"}
                        {emp.lastUpdateAge < 60000 ? " · now" : ` · ${Math.round(emp.lastUpdateAge / 60000)}m ago`}
                      </div>
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

                {/* Embedded map below each listing */}
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
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${emp.latitude},${emp.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      <Navigation className="size-3.5" /> Navigate
                    </a>
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
                    ) : trace.length === 0 ? (
                      <div className="text-xs text-light-text">
                        No location history found for this employee in the last 2 hours.
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-light-text">{trace.length} recorded points</span>
                            <span className="text-body">Last: {new Date(last.captured_at).toLocaleTimeString()}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {trace.map((p, i) => (
                              <span
                                key={i}
                                className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-foreground/80"
                                title={`${new Date(p.captured_at).toLocaleTimeString()}`}
                              >
                                {p.latitude.toFixed(4)},{p.longitude.toFixed(4)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <a
                          href={`https://www.google.com/maps/dir/${
                            trace.map((p) => `${p.latitude},${p.longitude}`).join("/")
                          }?api=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <Navigation className="size-3.5" /> Open movement trail in Google Maps
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}