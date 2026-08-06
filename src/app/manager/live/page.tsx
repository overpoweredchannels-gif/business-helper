"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import LiveMap from "@/components/location/LiveMap";
import { Loader2, AlertCircle, Navigation } from "lucide-react";
import type { CurrentLocationView } from "@/lib/location/types";

type FilterKey = "all" | "on_duty" | "off_duty" | "with_location" | "moving" | "stale";

export default function ManagerLiveTrackingPage() {
  const [employees, setEmployees] = useState<CurrentLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CurrentLocationView | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pollInterval, setPollInterval] = useState(15000);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

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
      setLastRefresh(new Date().toLocaleTimeString());
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

  return (
    <div className="grid gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Live Workforce Tracking</h1>
          <p className="text-sm text-body mt-1">
            {employees.length} employees &middot; {onDuty.length} on duty &middot; {withLocation.length} with
            location &middot; {moving.length} moving
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-border overflow-hidden min-h-[420px]">
            <LiveMap employees={filtered} onEmployeeClick={setSelected} selectedEmployeeId={selected?.profileId ?? null} />
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Employee List</span>
              {lastRefresh && <span className="text-xs text-light-text">{lastRefresh}</span>}
            </div>
            <div className="max-h-[540px] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-light-text">No employees match the current filter.</div>
              ) : (
                filtered.map((emp) => (
                  <button
                    key={emp.profileId}
                    onClick={() => setSelected(emp)}
                    className={`w-full text-left px-4 py-3 border-b border-border/40 last:border-0 transition-colors ${
                      selected?.profileId === emp.profileId ? "bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{emp.employeeName}</div>
                        <div className="text-xs text-body capitalize">{emp.role || "No role"}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`size-2 rounded-full ${
                            emp.isOnDuty ? (emp.hasLocation ? "bg-success" : "bg-warning") : "bg-muted-foreground"
                          }`}
                        />
                        <span className="text-xs text-body">{emp.isOnDuty ? "On Duty" : "Off Duty"}</span>
                      </div>
                    </div>
                    {emp.hasLocation && (
                      <div className="text-xs text-light-text mt-1">
                        {emp.latitude.toFixed(4)}, {emp.longitude.toFixed(4)}
                        {(emp.speed ?? 0) > 1 ? ` - ${Math.round((emp.speed ?? 0) * 3.6)} km/h` : ""}
                        {emp.lastUpdateAge < 60000 ? " (now)" : ` (${Math.round(emp.lastUpdateAge / 60000)}m ago)`}
                      </div>
                    )}
                    {!emp.hasLocation && emp.isOnDuty && (
                      <div className="text-xs text-warning mt-1">No location data</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {selected && selected.hasLocation && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Navigation className="size-4" /> Open Google Maps Navigation to {selected.employeeName}
        </a>
      )}
    </div>
  );
}
