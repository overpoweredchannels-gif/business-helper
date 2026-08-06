"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, MapPin, Clock } from "lucide-react";
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
  no_record: "No record yet",
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

export default function SupervisorAttendancePage() {
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
      else setError(json.error || "Failed to load attendance");
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
        <p className="text-sm text-body">Loading attendance...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" /> {error ?? "Attendance unavailable"}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Team Attendance</h1>
        <p className="text-sm text-body mt-1">Today's attendance status for all team members.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Today</span>
          <span className="text-xs text-light-text">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
        </div>
        <div className="divide-y divide-border/40">
          {data.members.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-light-text">No team members assigned.</div>
          ) : (
            data.members.map((m) => (
              <div key={m.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{m.full_name}</div>
                  <div className="text-xs text-body">{m.designation ?? "staff"}</div>
                </div>
                <div className="flex items-center gap-3">
                  {m.attendance.duty_at && (
                    <span className="text-xs text-body flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {new Date(m.attendance.duty_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", ATT_TONE[m.attendance.status] ?? "bg-muted text-muted-foreground")}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {ATT_LABEL[m.attendance.status] ?? m.attendance.status}
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