"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { MapPin, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Visit {
  id: string;
  employee_id: string;
  visit_status: string;
  started_at?: string;
  ended_at?: string;
  customers?: { customer_name?: string; shop_name?: string; phone?: string };
  employees?: { full_name?: string };
}

export default function VisitMonitorPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "in_progress" | "completed" | "missed" | "planned">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/visits/owner?limit=100");
      const data = await res.json();
      if (data.ok) setVisits(data.visits ?? []);
      else setError(data.error || "Failed to load visits");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = filter === "all" ? visits : visits.filter((v) => v.visit_status === filter);
  const inProgress = visits.filter((v) => v.visit_status === "in_progress").length;
  const completed = visits.filter((v) => v.visit_status === "completed").length;
  const missed = visits.filter((v) => v.visit_status === "missed").length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Visit Monitor</h1>
        <p className="text-sm text-body mt-1">Live view of field visits recorded by your team.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs font-medium text-light-text uppercase tracking-wide mb-1">Active now</div>
          <div className="font-heading font-bold text-2xl text-primary">{inProgress}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs font-medium text-light-text uppercase tracking-wide mb-1">Completed</div>
          <div className="font-heading font-bold text-2xl text-success">{completed}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs font-medium text-light-text uppercase tracking-wide mb-1">Missed</div>
          <div className="font-heading font-bold text-2xl text-destructive">{missed}</div>
        </div>
      </div>

      {message && (
        <div className={cn(
          "flex items-start gap-2 rounded-2xl border p-4 text-sm",
          message.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive-bg text-destructive",
        )}>
          {message.type === "ok" ? <CheckCircle2 className="size-4 mt-0.5 shrink-0" /> : <AlertCircle className="size-4 mt-0.5 shrink-0" />}
          {message.text}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "in_progress", "completed", "planned", "missed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading visits...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <MapPin className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No visits in this view.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {filtered.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{v.customers?.shop_name || v.customers?.customer_name}</div>
                <div className="text-xs text-body">{v.employees?.full_name ?? "Team member"}{v.customers?.phone ? ` · ${v.customers.phone}` : ""}</div>
                <div className="text-xs text-light-text mt-0.5">
                  {v.started_at ? `Started ${new Date(v.started_at).toLocaleString()}` : "Not started"}
                  {v.ended_at ? ` · Ended ${new Date(v.ended_at).toLocaleTimeString()}` : ""}
                </div>
              </div>
              <VisitStatus status={v.visit_status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitStatus({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planned: "bg-muted text-muted-foreground",
    in_progress: "bg-primary-light text-primary",
    completed: "bg-success/10 text-success",
    missed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  const Icon = status === "completed" ? CheckCircle2 : status === "missed" ? XCircle : MapPin;
  return (
    <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium capitalize flex items-center gap-1 whitespace-nowrap", styles[status] ?? "bg-muted text-muted-foreground")}>
      <Icon className="size-3" /> {status.replace("_", " ")}
    </span>
  );
}