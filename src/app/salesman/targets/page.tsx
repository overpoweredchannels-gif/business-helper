"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Target, Loader2, AlertCircle } from "lucide-react";

interface Target {
  id: string;
  employee_id: string;
  period: string;
  metric: string;
  target_value: number;
  start_date: string;
  end_date: string;
}

const METRIC_LABEL: Record<string, string> = {
  revenue: "Revenue",
  orders: "Orders",
  customers: "New customers",
  products: "Products sold",
  collections: "Collections",
};

export default function MyTargetsPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(tData.error || "Failed to load targets");
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

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">My Targets</h1>
        <p className="text-sm text-body mt-1">The sales targets your manager has set for you.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Target className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No targets set for you yet.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {targets.map((t) => {
            return (
              <div key={t.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Target className="size-5 text-primary" />
                    <div>
                      <div className="font-medium text-foreground">{METRIC_LABEL[t.metric] ?? t.metric}</div>
                      <div className="text-xs text-body capitalize">{t.period}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg text-foreground">{t.target_value}</div>
                  </div>
                </div>
                <div className="text-xs text-light-text mt-2">
                  {new Date(t.start_date).toLocaleDateString()} → {new Date(t.end_date).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}