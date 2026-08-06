"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  full_name: string;
  designation: string | null;
  visits: { total: number; completed: number; inProgress: number; planned: number };
}

interface TeamState {
  supervisor: { id: string; full_name: string; designation: string };
  members: Member[];
}

export default function SupervisorVisitsPage() {
  const [data, setData] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/supervisor/team");
      const json = await res.json();
      if (json.ok) setData(json);
      else setError(json.error || "Failed to load visits");
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
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading team visits...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" /> {error ?? "Visits unavailable"}
      </div>
    );
  }

  const totalVisits = data.members.reduce((sum, m) => sum + m.visits.total, 0);
  const completed = data.members.reduce((sum, m) => sum + m.visits.completed, 0);
  const inProgress = data.members.reduce((sum, m) => sum + m.visits.inProgress, 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Team Visits</h1>
        <p className="text-sm text-body mt-1">Field visit activity for today.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Visits" value={totalVisits} tone="text-foreground" />
        <StatCard label="Completed" value={completed} tone="text-success" />
        <StatCard label="In Progress" value={inProgress} tone="text-warning" />
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">Team Members</div>
        <div className="divide-y divide-border/40">
          {data.members.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-light-text">No team members assigned.</div>
          ) : (
            data.members.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{m.full_name}</div>
                  <div className="text-xs text-body capitalize">{m.designation ?? "staff"}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-warning/10 text-warning font-medium">
                    {m.visits.inProgress} in progress
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-success/10 text-success font-medium">
                    {m.visits.completed}/{m.visits.total} done
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 inline-flex"><MapPin className="size-5 text-primary" /></div>
        <div>
          <div className={cn("font-heading font-bold text-2xl", tone)}>{value}</div>
          <div className="text-xs text-body">{label}</div>
        </div>
      </div>
    </div>
  );
}