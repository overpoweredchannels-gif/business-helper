"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { CalendarPlus, Loader2, AlertCircle, CalendarClock } from "lucide-react";
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

export default function LeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [leaveType, setLeaveType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/leave?scope=mine");
      const data = await res.json();
      if (data.ok) setRequests(data.requests ?? []);
      else setError(data.error || "Failed to load leave requests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!startDate) {
      setMessage({ type: "error", text: "Please select a start date." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await authorizedFetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leave_type: leaveType, start_date: startDate, end_date: endDate || startDate, reason }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to submit");
      setMessage({ type: "ok", text: "Leave request submitted for approval." });
      setLeaveType("annual");
      setStartDate("");
      setEndDate("");
      setReason("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Leave Requests</h1>
        <p className="text-sm text-body mt-1">Request time off and track approval status.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <CalendarPlus className="size-5 text-primary" /> New Request
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="text-body">Leave Type</span>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2"
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-body">Start Date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-body">End Date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>
        </div>
        <label className="grid gap-1.5 text-sm mt-4">
          <span className="text-body">Reason (optional)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Brief reason for your leave"
            className="rounded-lg border border-border bg-background px-3 py-2 resize-none"
          />
        </label>
        <button
          onClick={submit}
          disabled={submitting}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Submit Request
        </button>
      </div>

      {message && (
        <div
          className={cn(
            "rounded-2xl border p-4 text-sm",
            message.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive-bg text-destructive"
          )}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading leave history...</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-light-text">
          <CalendarClock className="size-8 mx-auto mb-2 opacity-50" />
          No leave requests yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border/40">
          {requests.map((r) => (
            <div key={r.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {TYPE_LABEL[r.leave_type] ?? r.leave_type} Leave
                  <span className="text-sm font-normal text-body ml-2">
                    {new Date(r.start_date).toLocaleDateString()} → {new Date(r.end_date).toLocaleDateString()}
                  </span>
                </div>
                {r.reason && <div className="text-xs text-body mt-0.5">{r.reason}</div>}
                {r.review_note && <div className="text-xs text-light-text mt-0.5">Review note: {r.review_note}</div>}
              </div>
              <span className={cn("inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize", STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground")}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}