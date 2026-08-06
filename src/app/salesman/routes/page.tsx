"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Route as RouteIcon, Loader2, MapPin, ChevronRight, AlertCircle } from "lucide-react";

interface RouteItem {
  id: string;
  name: string;
  description?: string | null;
  assigned_salesman_id?: string | null;
  route_frequency?: string;
  is_active?: boolean;
}

export default function MyRoutesPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await authorizedFetch("/api/identity/staff/me");
      const meData = await meRes.json();
      if (!meData.ok || !meData.me?.employee) {
        setError("No staff profile linked to this account.");
        setLoading(false);
        return;
      }
      const empId = meData.me.employee.id;
      setEmployeeId(empId);

      const routesRes = await authorizedFetch("/api/routes");
      const routesData = await routesRes.json();
      if (Array.isArray(routesData.routes)) {
        const mine = routesData.routes.filter((r: RouteItem) => r.assigned_salesman_id === empId);
        setRoutes(mine);
      } else {
        setError("Failed to load routes");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading your routes...</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">My Routes</h1>
        <p className="text-sm text-body mt-1">Routes assigned to you for field visits.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!error && routes.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <RouteIcon className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No routes assigned to you yet.</p>
          <p className="text-xs text-light-text mt-1">Ask your manager to assign a route from the business app.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {routes.map((r) => (
            <Link key={r.id} href={`/salesman/routes/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-primary-light flex items-center justify-center">
                  <RouteIcon className="size-5 text-primary" />
                </div>
                <div>
                  <div className="font-medium text-foreground">{r.name}</div>
                  <div className="text-xs text-body">{r.description || `${r.route_frequency ?? "daily"} route`}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {r.is_active === false && <span className="text-xs text-light-text">Inactive</span>}
                <MapPin className="size-4 text-light-text" />
                <ChevronRight className="size-4 text-light-text" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}