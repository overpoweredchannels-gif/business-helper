"use client";

import { useEffect, useState } from "react";
import { NotificationCategory, NotificationItem } from "@/lib/tradeos/types";

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  draft_sale: "Draft Sale",
  approval: "Approval",
  target: "Target",
  route: "Route",
  duty: "Duty",
  off_route: "Off Route",
  missed_customer: "Missed Customer",
  inventory: "Inventory",
  attendance: "Attendance",
  leave: "Leave",
  collection: "Collection",
  general: "General",
};

const CATEGORY_COLORS: Record<string, string> = {
  draft_sale: "#f59e0b",
  approval: "#3b82f6",
  target: "#8b5cf6",
  route: "#10b981",
  duty: "#06b6d4",
  off_route: "#ef4444",
  missed_customer: "#f97316",
  inventory: "#eab308",
  attendance: "#6366f1",
  leave: "#ec4899",
  collection: "#14b8a6",
  general: "#6b7280",
};

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const query = unreadOnly ? "?unread_only=true" : "";
      const res = await fetch(`/api/notifications${query}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
        setMessage(null);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load notifications" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [unreadOnly]);

  const markAllRead = async () => {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    const data = await res.json();
    if (data.ok) {
      setMessage({ type: "ok", text: "All notifications marked as read." });
      load();
    } else {
      setMessage({ type: "error", text: data.error || "Failed to update notifications" });
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Clear all notifications?")) return;
    const res = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_all" }),
    });
    const data = await res.json();
    if (data.ok) {
      setMessage({ type: "ok", text: "Notifications cleared." });
      load();
    } else {
      setMessage({ type: "error", text: data.error || "Failed to clear notifications" });
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div style={{ padding: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0" }}>Notifications</h2>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0" }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"} · in-app center
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem" }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
          <button
            style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            Mark all read
          </button>
          <button
            style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
            onClick={clearAll}
            disabled={notifications.length === 0}
          >
            Clear all
          </button>
        </div>
      </div>

      {message && (
        <p
          style={{
            fontSize: "0.875rem",
            margin: "0.75rem 0",
            color: message.type === "ok" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
          No notifications yet. Notifications from field sales (draft sales, approvals, route changes, duties) will appear here.
        </p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {notifications.map((note, index) => {
            const category = (note.category ?? "general") as NotificationCategory;
            const color = CATEGORY_COLORS[category] ?? "#6b7280";
            return (
              <div
                key={note.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                  background: note.is_read ? undefined : "#f8fafc",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: "0.5rem",
                    height: "0.5rem",
                    borderRadius: "999px",
                    background: color,
                    marginTop: "0.35rem",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{note.title}</div>
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {new Date(note.created_at).toLocaleString()}
                    </div>
                  </div>
                  {note.body && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#374151" }}>
                      {note.body}
                    </p>
                  )}
                  <div style={{ marginTop: "0.375rem", display: "flex", gap: "0.375rem" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: color,
                        border: `1px solid ${color}`,
                        borderRadius: "999px",
                        padding: "0.125rem 0.5rem",
                      }}
                    >
                      {CATEGORY_LABELS[category] ?? category}
                    </span>
                    {!note.is_read && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "#166534",
                          background: "#dcfce7",
                          borderRadius: "999px",
                          padding: "0.125rem 0.5rem",
                        }}
                      >
                        Unread
                      </span>
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
