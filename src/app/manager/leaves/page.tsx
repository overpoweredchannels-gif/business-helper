"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, CalendarClock, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
  review_note: string | null;
  employee: { id: string; full_name: string; designation: string | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  annual: "Annual",
  sick: "Sick",
  casual: "Casual",
  unpaid: "Unpaid",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-warning bg-warning/10",
  approved: "text-success bg-success/10",
  rejected: "text-destructive bg-destructive/10",
  cancelled: "text-muted-foreground bg-muted",
};

export default function ManagerLeavesPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch(`/api/leave?scope=all&status=${filter}`);
      const data = await res.json();
      if (data.ok) setRequests(data.requests ?? []);
      else setError(data.error || "Failed to load leave requests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (id: string, status: "approved" | "rejected") => {
    setActingId(id);
    try {
      const res = await authorizedFetch(`/api/leave?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update request");
    } finally {
      setActingId(null);
    }
  };

  const [actingId, setActingId] = useState<string | null>(null);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Leave Requests</h1>
          <p className="text-sm text-body mt-1">Review and manage field staff leave requests.</p>
        </div>
        <div className="flex gap-2">
          {[
            ["pending", "Pending"],
            ["approved", "Approved"],
            ["rejected", "Rejected"],
            ["all", "All"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm transition-colors",
                filter === v ? "bg-primary text-primary-foreground" : "bg-card border border-border text-body hover:bg-muted"
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading leave requests...</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-light-text">
          <CalendarClock className="size-8 mx-auto mb-2 opacity-50" />
          No {filter !== "all" ? `${filter} ` : ""}leave requests.
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((r) => {
            const days = Math.max(1, Math.round((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1);
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="size-9 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-primary">
                        {r.employee?.full_name.slice(0, 1).toUpperCase() ?? "?"}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{r.employee?.full_name ?? "Unknown"}</div>
                        <div className="text-xs text-body capitalize">{r.employee?.designation ?? "staff"}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-sm">
                      <span className="font-medium text-foreground">{TYPE_LABEL[r.leave_type] ?? r.leave_type} leave</span>
                      <span className="text-body ml-2">
                        {new Date(r.start_date).toLocaleDateString()} → {new Date(r.end_date).toLocaleDateString()}
                        <span className="text-light-text ml-1">({days} day{days > 1 ? "s" : ""})</span>
                      </span>
                    </div>
                    {r.reason && <div className="text-sm text-body mt-1">{r.reason}</div>}
                    {r.review_note && <div className="text-xs text-light-text mt-1">Note: {r.review_note}</div>}
                  </div>
                  <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                    <span className={cn("inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize", STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground")}>
                      {r.status}
                    </span>
                    {r.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => review(r.id, "approved")}
                          disabled={actingId === r.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          <Check className="size-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => review(r.id, "rejected")}
                          disabled={actingId === r.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          <X className="size-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}