"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, Users, CheckCircle2, MapPin, XCircle, Clock, UserX } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  employee_id: string | null;
  full_name: string;
  phone: string | null;
  designation: string | null;
  status: string;
  photo_url: string | null;
  attendance: { status: string; duty_at: string | null };
  visits: { total: number; completed: number; inProgress: number; planned: number };
}

interface TeamState {
  supervisor: { id: string; full_name: string; designation: string };
  members: Member[];
  stats: {
    total: number;
    presentToday: number;
    onDutyToday: number;
    absentToday: number;
    noRecord: number;
    visitsToday: number;
  };
}

const ATT_LABEL: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  half_day: "Half Day",
  leave: "On Leave",
  holiday: "Holiday",
  no_record: "No record",
};

const ATT_TONE: Record<string, string> = {
  present: "text-success bg-success/10",
  late: "text-warning bg-warning/10",
  absent: "text-destructive bg-destructive/10",
  half_day: "text-warning bg-warning/10",
  leave: "text-info bg-info/10",
  holiday: "text-muted-foreground bg-muted",
  no_record: "text-muted-foreground bg-muted",
};

export default function SupervisorOverviewPage() {
  const [data, setData] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/supervisor/team");
      const json = await res.json();
      if (json.ok) {
        setData(json);
      } else {
        setError(json.error || "Failed to load team");
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
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading your team...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" /> {error ?? "Team data unavailable"}
      </div>
    );
  }

  const { members, stats } = data;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Team Overview</h1>
        <p className="text-sm text-body mt-1">
          Today's attendance and field activity for {stats.total} team members.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<Users className="size-5 text-primary" />} label="Team Members" value={stats.total} />
        <StatCard icon={<CheckCircle2 className="size-5 text-success" />} label="Present Today" value={stats.presentToday} />
        <StatCard icon={<Clock className="size-5 text-info" />} label="On Duty" value={stats.onDutyToday} />
        <StatCard icon={<XCircle className="size-5 text-destructive" />} label="Absent" value={stats.absentToday} />
        <StatCard icon={<MapPin className="size-5 text-warning" />} label="Visits Today" value={stats.visitsToday} />
      </div>

      {members.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-light-text">
          You have no team members assigned to you yet. Ask the owner to assign staff to you as their supervisor.
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Field Staff</span>
            <span className="text-xs text-light-text">{stats.presentToday}/{stats.total} present today</span>
          </div>
          <div className="divide-y divide-border/40">
            {members.map((m) => (
              <div key={m.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="size-10 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-primary shrink-0">
                  {m.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground truncate">{m.full_name}</div>
                  <div className="text-xs text-body capitalize">
                    {m.designation ?? "staff"}
                    {m.employee_id ? ` · ${m.employee_id}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", ATT_TONE[m.attendance.status] ?? "bg-muted text-muted-foreground")}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {ATT_LABEL[m.attendance.status] ?? m.attendance.status}
                  </span>
                  <span className="text-xs text-body flex items-center gap-1">
                    <MapPin className="size-3.5 text-warning" />
                    {m.visits.completed}/{m.visits.total} visited
                  </span>
                </div>
              </div>
            ))}
          </div>
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