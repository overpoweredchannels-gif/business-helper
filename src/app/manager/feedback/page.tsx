"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { MessageSquareText, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Feedback {
  id: string;
  type: string;
  title?: string | null;
  description?: string | null;
  priority?: string;
  status?: string;
  created_at: string;
  customers?: { customer_name?: string; shop_name?: string };
  employees?: { full_name?: string };
}

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/feedback?limit=100");
      const data = await res.json();
      if (data.ok) setFeedback(data.feedback ?? []);
      else setError(data.error || "Failed to load feedback");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = filter === "all" ? feedback : feedback.filter((f) => (f.status ?? "open") === filter);
  const open = feedback.filter((f) => (f.status ?? "open") === "open").length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Customer Feedback</h1>
        <p className="text-sm text-body mt-1">Complaints, feedback, notes, and requests recorded during field visits.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "open", "in_progress", "resolved"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f.replace("_", " ")}{f === "open" && open > 0 ? ` (${open})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading feedback...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <MessageSquareText className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No feedback items.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((f) => (
            <div key={f.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <TypeBadge type={f.type} />
                  <PriorityBadge priority={f.priority ?? "medium"} />
                </div>
                <StatusBadge status={f.status ?? "open"} />
              </div>
              <div className="font-medium text-foreground">{f.title || f.type}</div>
              <p className="text-sm text-body mt-1">{f.description}</p>
              <div className="text-xs text-light-text mt-2">
                {f.customers?.shop_name || f.customers?.customer_name} · {f.employees?.full_name ?? "Staff"} · {new Date(f.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    complaint: "bg-destructive/10 text-destructive",
    feedback: "bg-primary/10 text-primary",
    note: "bg-muted text-muted-foreground",
    request: "bg-warning/10 text-warning",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[type] ?? "bg-muted text-muted-foreground")}>
      {type}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: "bg-destructive/10 text-destructive",
    medium: "bg-warning/10 text-warning",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[priority] ?? "bg-muted text-muted-foreground")}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-warning/10 text-warning",
    in_progress: "bg-primary/10 text-primary",
    resolved: "bg-success/10 text-success",
    closed: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  );
}