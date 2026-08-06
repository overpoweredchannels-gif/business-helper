"use client";

import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Bell, Loader2, CheckCheck, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  draft_sale: "bg-warning/10 text-warning",
  approval: "bg-primary/10 text-primary",
  target: "bg-secondary text-primary",
  route: "bg-success/10 text-success",
  duty: "bg-muted text-muted-foreground",
  off_route: "bg-destructive/10 text-destructive",
  missed_customer: "bg-destructive/10 text-destructive",
  inventory: "bg-warning/10 text-warning",
  attendance: "bg-primary/10 text-primary",
  leave: "bg-destructive/10 text-destructive",
  collection: "bg-success/10 text-success",
  general: "bg-muted text-muted-foreground",
};

const CATEGORY_LABELS: Record<string, string> = {
  draft_sale: "Draft sale", approval: "Approval", target: "Target", route: "Route", duty: "Duty",
  off_route: "Off route", missed_customer: "Missed customer", inventory: "Inventory",
  attendance: "Attendance", leave: "Leave", collection: "Collection", general: "General",
};

interface Notif {
  id: string;
  category: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await authorizedFetch("/api/notifications?limit=100");
      const data = await res.json();
      if (data.ok) setNotifs(data.notifications ?? []);
      else setError(data.error || "Failed to load notifications");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markAllRead = async () => {
    const res = await authorizedFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    const data = await res.json();
    if (data.ok) {
      setMessage({ type: "ok", text: "Marked all as read." });
      setNotifs(notifs.map((n) => ({ ...n, is_read: true })));
    } else {
      setMessage({ type: "error", text: data.error || "Failed to update" });
    }
  };

  const markRead = async (id: string) => {
    await authorizedFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifs(notifs.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const deleteOne = async (id: string) => {
    await authorizedFetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifs(notifs.filter((n) => n.id !== id));
  };

  const unread = notifs.filter((n) => !n.is_read).length;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Notifications</h1>
          <p className="text-sm text-body mt-1">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        </div>
        <button
          onClick={markAllRead}
          disabled={unread === 0}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          <CheckCheck className="size-4" /> Mark all read
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {message && (
        <div className={cn(
          "rounded-2xl border p-4 text-sm",
          message.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive-bg text-destructive",
        )}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading notifications...</p>
        </div>
      ) : notifs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Bell className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No notifications.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {notifs.map((n) => (
            <div
              key={n.id}
              className={cn("flex items-start gap-3 px-5 py-4", !n.is_read && "bg-primary-light/50")}
            >
              <div className={cn("mt-0.5 px-2 py-1 rounded-full text-[11px] font-medium shrink-0", CATEGORY_COLORS[n.category] ?? "bg-muted text-muted-foreground")}>
                {CATEGORY_LABELS[n.category] ?? n.category}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <div className={cn("text-sm font-medium text-foreground", !n.is_read && "font-semibold")}>{n.title}</div>
                  {!n.is_read && <span className="size-2 rounded-full bg-primary shrink-0" />}
                </div>
                <p className="text-sm text-body mt-0.5">{n.body}</p>
                <div className="text-[11px] text-light-text mt-1">{new Date(n.created_at).toLocaleString()}</div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {!n.is_read && (
                  <button onClick={() => markRead(n.id)} className="text-xs text-primary hover:underline">Mark read</button>
                )}
                <button onClick={() => deleteOne(n.id)} className="text-xs text-destructive hover:underline flex items-center gap-1">
                  <Trash2 className="size-3" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}