"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NotificationCategory, NotificationItem } from "@/lib/tradeos/types";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { Bell, CheckCircle2, X } from "lucide-react";

const CATEGORY_STYLES: Record<string, string> = {
  draft_sale: "bg-warning/10 text-warning border-warning/30",
  approval: "bg-primary/10 text-primary border-primary/30",
  target: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  route: "bg-success/10 text-success border-success/30",
  duty: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30",
  off_route: "bg-destructive/10 text-destructive border-destructive/30",
  missed_customer: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  inventory: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  attendance: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  leave: "bg-pink-500/10 text-pink-500 border-pink-500/30",
  collection: "bg-teal-500/10 text-teal-500 border-teal-500/30",
  general: "bg-muted text-muted-foreground border-border",
};

interface NotificationCenterProps {
  onReviewDraft?: (draftEntityId: string) => void;
}

export default function NotificationCenter({ onReviewDraft }: NotificationCenterProps) {
  const { t } = useRegional();
  const categoryLabel = (c: NotificationCategory) => {
    const labels: Record<NotificationCategory, string> = {
      draft_sale: t('fsm.notifications.catDraftSale'),
      approval: t('fsm.notifications.catApproval'),
      target: t('fsm.notifications.catTarget'),
      route: t('fsm.notifications.catRoute'),
      duty: t('fsm.notifications.catDuty'),
      off_route: t('fsm.notifications.catOffRoute'),
      missed_customer: t('fsm.notifications.catMissedCustomer'),
      inventory: t('fsm.notifications.catInventory'),
      attendance: t('fsm.notifications.catAttendance'),
      leave: t('fsm.notifications.catLeave'),
      collection: t('fsm.notifications.catCollection'),
      general: t('fsm.notifications.catGeneral'),
    };
    return labels[c] ?? c;
  };
  const filterOptions: Array<{ id: string; label: string }> = [
    { id: "all", label: t('fsm.notifications.filterAll') },
    { id: "unread", label: t('fsm.notifications.filterUnread') },
    { id: "draft_sale", label: t('fsm.notifications.filterDraftSales') },
    { id: "approval", label: t('fsm.notifications.filterApprovals') },
    { id: "inventory", label: t('fsm.notifications.catInventory') },
    { id: "attendance", label: t('fsm.notifications.catAttendance') },
    { id: "collection", label: t('team.metricCollections') },
    { id: "general", label: t('fsm.notifications.catGeneral') },
  ];
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [maxVisible, setMaxVisible] = useState(30);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authorizedFetch("/api/notifications?limit=100");
      const data = await res.json();
      if (data.ok && Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
        setMessage(null);
      } else {
        setMessage({ type: "error", text: data.error || t('fsm.notifications.loadFailed') });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('tracking.networkError') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    const res = await authorizedFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.ok) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)));
      setMessage(null);
    } else {
      setMessage({ type: "error", text: data.error || t('fsm.notifications.updateFailed') });
    }
  };

  const markAllRead = async () => {
    const res = await authorizedFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    const data = await res.json();
    if (data.ok) {
      setNotifications((prev) => prev.map((n) => (n.is_read ? n : { ...n, is_read: true, read_at: new Date().toISOString() })));
      setMessage({ type: "ok", text: t('fsm.notifications.allRead') });
    } else {
      setMessage({ type: "error", text: data.error || t('fsm.notifications.updateAllFailed') });
    }
  };

  const clearAll = async () => {
    if (!window.confirm(t('fsm.notifications.clearConfirm'))) return;
    const res = await authorizedFetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_all" }),
    });
    const data = await res.json();
    if (data.ok) {
      setNotifications([]);
      setMessage({ type: "ok", text: t('fsm.notifications.cleared') });
    } else {
      setMessage({ type: "error", text: data.error || t('fsm.notifications.clearFailed') });
    }
  };

  const visible = useMemo(() => {
    const filtered =
      filter === "all"
        ? notifications
        : filter === "unread"
          ? notifications.filter((n) => !n.is_read)
          : notifications.filter((n) => n.category === filter);
    return filtered.slice(0, maxVisible);
  }, [notifications, filter, maxVisible]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const filteredCount =
    filter === "all" ? notifications.length : filter === "unread" ? unreadCount : notifications.filter((n) => n.category === filter).length;

  return (
    <div className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-foreground">{t('fsm.notifications.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadCount > 0 ? t('fsm.notifications.unreadCount').replace('{count}', String(unreadCount)) : t('fsm.notifications.caughtUp')} · {t('fsm.notifications.inAppCenter')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 hover:bg-muted/30 disabled:opacity-40"
          >
            <CheckCircle2 className="size-3.5 text-success" />
            {t('fsm.notifications.markAllRead')}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={notifications.length === 0}
            className="inline-flex items-center gap-1.5 rounded border border-destructive/40 bg-card px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-40"
          >
            <X className="size-3.5" />
            {t('fsm.notifications.clearAll')}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {filterOptions.map((option) => {
          let count: number | null = null;
          if (option.id === "all") count = notifications.length;
          else if (option.id === "unread") count = unreadCount;
          else count = notifications.filter((n) => n.category === option.id).length;
          const active = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setFilter(option.id);
                setMaxVisible(30);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {option.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {message && (
        <p
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border-success/20 bg-success/5 text-success"
              : "border-destructive/20 bg-destructive/5 text-destructive"
          }`}
        >
          {message.text}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('fsm.notifications.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {filter !== "all" ? t('fsm.notifications.emptyFiltered') : t('fsm.notifications.emptyAll')}
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((note, index) => {
            const category = (note.category ?? "general") as NotificationCategory;
            const categoryClass = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.general;
            const isDraft = category === "draft_sale" && Boolean(note.entity_id);
            return (
              <div
                key={note.id}
                className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3 ${
                  index === 0 ? "" : "border-t border-border"
                } ${note.is_read ? "" : "bg-muted/20"}`}
              >
                <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full">
                  <Bell className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="font-medium text-foreground">{note.title}</div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleString()}
                    </div>
                  </div>
                  {note.body && <p className="mt-0.5 text-sm text-foreground/80">{note.body}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${categoryClass}`}>
                      {categoryLabel(category)}
                    </span>
                    {!note.is_read && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        {t('fsm.notifications.filterUnread')}
                      </span>
                    )}
                    {isDraft && onReviewDraft && (
                      <button
                        type="button"
                        onClick={() => onReviewDraft(note.entity_id!)}
                        className="rounded bg-primary px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-primary/90"
                      >
                        {t('fsm.notifications.reviewDraft')}
                      </button>
                    )}
                    {!note.is_read && (
                      <button
                        type="button"
                        onClick={() => markRead(note.id)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        {t('fsm.notifications.markRead')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filteredCount > maxVisible && (
        <button
          type="button"
          onClick={() => setMaxVisible((prev) => prev + 30)}
          className="mt-4 rounded border border-border bg-card px-4 py-2 text-sm text-foreground/80 hover:bg-muted/30"
        >
          {t('fsm.notifications.showMore').replace('{count}', String(filteredCount - maxVisible))}
        </button>
      )}
    </div>
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}