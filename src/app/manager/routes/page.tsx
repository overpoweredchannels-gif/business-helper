"use client";

import { useCallback, useEffect, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, Route as RouteIcon, Users, CheckCircle2, Clock4, XCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface RouteStat {
  id: string;
  name: string;
  territory_id: string | null;
  description: string | null;
  route_frequency: string;
  is_active: boolean;
  created_at: string;
  stops: number;
  visited: number;
  pending: number;
  skipped: number;
  completionRate: number;
}

export default function ManagerRoutesPage() {
  const { t } = useRegional();
  const [routes, setRoutes] = useState<RouteStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/routes/dashboard");
      const data = await res.json();
      if (data.ok) {
        setRoutes(data.routes || []);
      } else {
        setError(data.error || t('manager.routes.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const active = routes.filter((r) => r.is_active);
  const totalStops = routes.reduce((sum, r) => sum + r.stops, 0);
  const totalVisited = routes.reduce((sum, r) => sum + r.visited, 0);
  const totalPending = routes.reduce((sum, r) => sum + r.pending, 0);
  const totalSkipped = routes.reduce((sum, r) => sum + r.skipped, 0);
  const overallCompletion = totalStops > 0 ? Math.round((totalVisited / totalStops) * 100) : 0;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">{t('manager.routes.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" /> {error}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('manager.routes.title')}</h1>
        <p className="text-sm text-body mt-1">{t('manager.routes.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<RouteIcon className="size-5 text-primary" />} label={t('manager.routes.activeRoutes')} value={active.length} sublabel={t('manager.routes.totalLabel').replace('{count}', String(routes.length))} />
        <StatCard icon={<Users className="size-5 text-info" />} label={t('manager.routes.totalStops')} value={totalStops} />
        <StatCard icon={<CheckCircle2 className="size-5 text-success" />} label={t('manager.routes.visited')} value={totalVisited} sublabel={t('manager.routes.doneLabel').replace('{percent}', String(overallCompletion))} />
        <StatCard icon={<Clock4 className="size-5 text-warning" />} label={t('salesman.collections.status.pending')} value={totalPending} />
        <StatCard icon={<XCircle className="size-5 text-destructive" />} label={t('manager.routes.skippedMissed')} value={totalSkipped} />
      </div>

      {routes.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-light-text">
          {t('manager.routes.noRoutes')}
        </div>
      ) : (
        <div className="grid gap-4">
          {routes.map((route) => {
            const rateColor =
              route.completionRate >= 80
                ? "bg-success"
                : route.completionRate >= 50
                  ? "bg-warning"
                  : "bg-destructive";
            return (
              <div key={route.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground truncate">{route.name}</h3>
                      {!route.is_active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t('manager.routes.inactive')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-body">
                      {route.territory_id && <span>{t('team.territoryAssigned')}</span>}
                      <span className="capitalize">{route.route_frequency}</span>
                      <span>{route.stops} stops</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-2xl font-heading font-bold text-foreground">{route.completionRate}%</div>
                      <div className="text-[10px] uppercase tracking-wide text-light-text">{t('salesman.visits.completed')}</div>
                    </div>
                    <div className="w-36 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", rateColor)} style={{ width: `${route.completionRate}%` }} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <MiniStat label={t('manager.routes.visited')} value={route.visited} tone="text-success" />
                  <MiniStat label={t('salesman.collections.status.pending')} value={route.pending} tone="text-warning" />
                  <MiniStat label={t('manager.routes.skippedMissed')} value={route.skipped} tone="text-destructive" />
                </div>

                {route.stops === 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-light-text">
                    <TrendingUp className="size-3.5" /> {t('manager.routes.noStops')}
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

function StatCard({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="p-2 rounded-lg bg-primary/10 inline-flex">{icon}</div>
      <div className="mt-3">
        <div className="font-heading font-bold text-xl text-foreground">{value}</div>
        <div className="text-xs text-body mt-0.5">{label}</div>
        {sublabel && <div className="text-xs text-light-text mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className={cn("text-lg font-semibold", tone)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-light-text">{label}</div>
    </div>
  );
}
