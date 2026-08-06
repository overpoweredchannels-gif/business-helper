"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, MapPin, ArrowLeft, Navigation, Route as RouteIcon, AlertCircle } from "lucide-react";

interface RouteDetail {
  id: string;
  name: string;
  description?: string | null;
  route_frequency?: string;
  is_active?: boolean;
  assigned_salesman_id?: string | null;
}

interface Stop {
  id: string;
  customer_id?: string | null;
  stop_order: number;
  label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const routeId = params.id;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authorizedFetch(`/api/routes/${routeId}`);
        const data = await res.json();
        if (data.route) {
          setRoute(data.route);
          setStops(data.stops ?? []);
        } else {
          setError(data.error || "Route not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading route...</p>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">{error ?? "Route not found"}</div>
        <button onClick={() => router.push("/salesman/routes")} className="inline-flex items-center gap-2 text-sm text-primary">
          <ArrowLeft className="size-4" /> Back to routes
        </button>
      </div>
    );
  }

  const orderedStops = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/salesman/routes")} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back
        </button>
        <RouteIcon className="size-5 text-primary" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">{route.name}</h1>
        {route.description && <p className="text-sm text-body mt-1">{route.description}</p>}
        <div className="flex items-center gap-2 mt-3">
          <span className="px-2.5 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground capitalize">
            {route.route_frequency ?? "daily"}
          </span>
          {route.is_active === false && <span className="px-2.5 py-1 rounded-full bg-destructive/10 text-xs font-medium text-destructive">Inactive</span>}
          <span className="px-2.5 py-1 rounded-full bg-primary-light text-primary text-xs font-medium">{orderedStops.length} stops</span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold text-foreground mb-1">Route stops</h2>
        <p className="text-sm text-body mb-4">Navigate to each stop and start a visit when you arrive.</p>

        {orderedStops.length === 0 ? (
          <p className="text-sm text-body text-center py-6">This route has no stops yet.</p>
        ) : (
          <ol className="relative">
            {orderedStops.map((stop, index) => (
              <li key={stop.id} className="flex items-start gap-3 pb-5 last:pb-0">
                <div className="flex flex-col items-center">
                  <div className="size-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                    {index + 1}
                  </div>
                  {index < orderedStops.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="pt-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{stop.label || `Stop ${stop.stop_order}`}</div>
                  {stop.address && <div className="text-xs text-body">{stop.address}</div>}
                  {stop.latitude != null && stop.longitude != null ? (
                    <div className="flex items-center gap-1 text-[11px] text-light-text mt-0.5">
                      <MapPin className="size-3" /> Has location
                    </div>
                  ) : (
                    <div className="text-[11px] text-light-text mt-0.5">No GPS coordinates set</div>
                  )}
                  {stop.customer_id && (
                    <button
                      onClick={() => router.push(`/salesman/visits?customer=${stop.customer_id}`)}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Navigation className="size-3" /> Visit customer
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}