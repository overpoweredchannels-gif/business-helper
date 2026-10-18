"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Target, Loader2, AlertCircle } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { localeFor } from "@/lib/regional/settings";
import { renderDeferred, type DeferredMessage } from "@/lib/regional/deferred";

interface Target {
  id: string;
  employee_id: string;
  period: string;
  metric: string;
  target_value: number;
  start_date: string;
  end_date: string;
}

const METRIC_KEYS: Record<string, 'salesman.targets.metric.revenue' | 'salesman.targets.metric.orders' | 'salesman.targets.metric.customers' | 'salesman.targets.metric.products' | 'salesman.targets.metric.collections'> = {
  revenue: 'salesman.targets.metric.revenue',
  orders: 'salesman.targets.metric.orders',
  customers: 'salesman.targets.metric.customers',
  products: 'salesman.targets.metric.products',
  collections: 'salesman.targets.metric.collections',
};

export default function MyTargetsPage() {
  const { t, language } = useRegional();
  const locale = localeFor(language);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | DeferredMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, tRes] = await Promise.all([
        authorizedFetch("/api/identity/staff/me"),
        authorizedFetch("/api/targets"),
      ]);
      const meData = await meRes.json();
      const empId = meData.me?.employee?.id;
      const tData = await tRes.json();
      if (tData.ok) {
        const mine = empId ? (tData.targets ?? []).filter((t: Target) => t.employee_id === empId) : (tData.targets ?? []);
        setTargets(mine);
      } else {
        setError(tData.error || { key: 'salesman.targets.loadError' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : { key: 'salesman.att.networkError' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('salesman.targets.title')}</h1>
        <p className="text-sm text-body mt-1">{t('salesman.targets.subtitle')}</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {typeof error === "string" ? error : renderDeferred(t, error)}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Target className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">{t('salesman.targets.none')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {targets.map((tg) => {
            return (
              <div key={tg.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Target className="size-5 text-primary" />
                    <div>
                      <div className="font-medium text-foreground">{METRIC_KEYS[tg.metric] ? t(METRIC_KEYS[tg.metric]) : tg.metric}</div>
                      <div className="text-xs text-body capitalize">{tg.period}</div>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold text-lg text-foreground"><bdi>{tg.target_value}</bdi></div>
                  </div>
                </div>
                <div className="text-xs text-light-text mt-2">
                  <bdi>{new Date(tg.start_date).toLocaleDateString(locale)} → {new Date(tg.end_date).toLocaleDateString(locale)}</bdi>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}