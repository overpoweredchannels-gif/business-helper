"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { MapPin, Loader2, CheckCircle2, Clock as ClockIcon, XCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";

interface Visit {
  id: string;
  customer_id: string;
  route_id?: string;
  stop_id?: string;
  visit_status: string;
  started_at?: string;
  ended_at?: string;
  notes?: string;
  customers?: { customer_name?: string; shop_name?: string; phone?: string };
}

export default function VisitsPage() {
  const { t } = useRegional();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/staff/me");
      const data = await res.json();
      if (data.ok && data.me?.employee) {
        setEmployeeId(data.me.employee.id);
      } else {
        setError(t('salesman.visits.noProfile'));
      }
    } catch {
      setError(t('salesman.visits.loadError'));
    }
  }, [t]);

  const loadVisits = useCallback(async (empId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch(`/api/visits/today?employeeId=${empId}`);
      const data = await res.json();
      if (data.ok) {
        setVisits(data.visits ?? []);
      } else {
        setError(data.error || t('salesman.visits.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (employeeId) loadVisits(employeeId);
  }, [employeeId, loadVisits]);

  const grouped = {
    in_progress: visits.filter((v) => v.visit_status === "in_progress"),
    planned: visits.filter((v) => v.visit_status === "planned"),
    completed: visits.filter((v) => v.visit_status === "completed"),
    missed: visits.filter((v) => v.visit_status === "missed"),
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('salesman.visits.title')}</h1>
        <p className="text-sm text-body mt-1">{t('salesman.visits.subtitle')}</p>
      </div>

      {error && <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">{t('salesman.visits.loading')}</p>
        </div>
      ) : visits.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <MapPin className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">{t('salesman.visits.noVisits')}</p>
          <p className="text-xs text-light-text mt-1">{t('salesman.visits.noVisitsHint')}</p>
        </div>
      ) : (
        <VisitGroup title={t('salesman.visits.inProgress')} visits={grouped.in_progress} icon={<ClockIcon className="size-4 text-primary" />} t={t} />
      )}

      {visits.length > 0 && (
        <div className="grid gap-6">
          <VisitGroup title={t('salesman.visits.planned')} visits={grouped.planned} icon={<MapPin className="size-4 text-primary" />} t={t} />
          <VisitGroup title={t('salesman.visits.completed')} visits={grouped.completed} icon={<CheckCircle2 className="size-4 text-success" />} t={t} />
          <VisitGroup title={t('salesman.visits.missed')} visits={grouped.missed} icon={<XCircle className="size-4 text-destructive" />} t={t} />
        </div>
      )}
    </div>
  );
}

function VisitGroup({ title, visits, icon, t }: { title: string; visits: Visit[]; icon: React.ReactNode; t: (key: MessageKey) => string }) {
  if (visits.length === 0) return null;
  return (
    <div>
      <h2 className="font-semibold text-foreground mb-2 flex items-center gap-2">{icon} {title}</h2>
      <div className="rounded-2xl border border-border bg-card divide-y divide-border">
        {visits.map((v) => (
          <Link key={v.id} href={`/salesman/visits/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">
                {v.customers?.shop_name || v.customers?.customer_name || t('salesman.visits.customerFallback')}
              </div>
              {v.customers?.phone && <div className="text-xs text-body">{v.customers.phone}</div>}
              {v.ended_at && <div className="text-[11px] text-light-text">{t('salesman.visits.ended').replace('{time}', new Date(v.ended_at).toLocaleTimeString())}</div>}
            </div>
            <div className="flex items-center gap-2">
              <VisitStatus status={v.visit_status} t={t} />
              <ChevronRight className="size-4 text-light-text" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function VisitStatus({ status, t }: { status: string; t: (key: MessageKey) => string }) {
  const styles: Record<string, string> = {
    planned: "bg-muted text-muted-foreground",
    in_progress: "bg-primary-light text-primary",
    completed: "bg-success/10 text-success",
    missed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = {
    planned: t('salesman.visits.status.planned'), in_progress: t('salesman.visits.status.active'), completed: t('salesman.visits.status.done'), missed: t('salesman.visits.status.missed'), cancelled: t('salesman.visits.status.cancelled'),
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", styles[status] ?? "bg-muted text-muted-foreground")}>
      {labels[status] ?? status}
    </span>
  );
}