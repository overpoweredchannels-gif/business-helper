"use client";

import { useMemo, useState } from "react";
import type { NotificationCategory } from "@/lib/tradeos/types";
import type { VisibleNotification } from "@/lib/notifications/visible-notifications";
import { useRegional } from "@/components/regional/RegionalProvider";
import { Bell, CheckCircle2, X } from "lucide-react";

const CATEGORY_STYLES: Record<string, string> = {
  draft_sale: "bg-warning/10 text-warning-text border-warning/30",
  approval: "bg-primary/10 text-primary border-primary/30",
  target: "bg-primary/10 text-primary border-primary/30",
  route: "bg-success/10 text-success border-success/30",
  duty: "bg-primary/10 text-primary border-primary/30",
  off_route: "bg-destructive/10 text-destructive border-destructive/30",
  missed_customer: "bg-warning/10 text-warning-text border-warning/30",
  inventory: "bg-warning/10 text-warning-text border-warning/30",
  attendance: "bg-primary/10 text-primary border-primary/30",
  leave: "bg-muted text-muted-foreground border-border",
  collection: "bg-success-light text-success border-success/30",
  general: "bg-muted text-muted-foreground border-border",
};

interface NotificationCenterProps {
  notifications: readonly VisibleNotification[];
  unreadCount: number;
  loading: boolean;
  loadError: string | null;
  onMarkRead: (item: VisibleNotification) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onClearStored: () => Promise<void>;
  onReviewDraft?: (draftEntityId: string, notificationId: string) => void;
  // Opens the page-level in-app confirm dialog (the repo standard). The
  // destructive Clear all action must never go through window.confirm:
  // native dialogs are suppressed in automated/embedded browsers, so the
  // click produced no prompt and the DELETE was never called.
  onRequestConfirm: (dialog: {
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) => void;
}

export default function NotificationCenter({
  notifications, unreadCount, loading, loadError, onMarkRead, onMarkAllRead, onClearStored,
  onReviewDraft, onRequestConfirm,
}: NotificationCenterProps) {
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
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [maxVisible, setMaxVisible] = useState(30);

  const markRead = async (item: VisibleNotification) => {
    try {
      await onMarkRead(item);
      setMessage(null);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t('fsm.notifications.updateFailed') });
    }
  };

  const markAllRead = async () => {
    try {
      await onMarkAllRead();
      setMessage({ type: "ok", text: t('fsm.notifications.allRead') });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t('fsm.notifications.updateAllFailed') });
    }
  };

  const doClearAll = async () => {
    try {
      await onClearStored();
      setMessage({ type: "ok", text: t('fsm.notifications.cleared') });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t('fsm.notifications.clearFailed') });
    }
  };

  const clearAll = () => {
    onRequestConfirm({
      title: t('fsm.notifications.clearConfirm'),
      body: t('fsm.notifications.clearConfirmBody'),
      confirmLabel: t('fsm.notifications.clearAll'),
      onConfirm: () => {
        void doClearAll();
      },
    });
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

  const filteredCount =
    filter === "all" ? notifications.length : filter === "unread" ? unreadCount : notifications.filter((n) => n.category === filter).length;

  return (
    <div className="operations-section p-1 sm:p-2">
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
            disabled={!notifications.some((note) => note.source === "notification")}
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
              aria-pressed={active}
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

      {loadError && <p className="mt-3 text-sm text-destructive" role="alert">{loadError}</p>}
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
            const isDraft = category === "draft_sale" && Boolean(note.entity_id && note.notificationId);
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
                    {note.created_at && <div className="shrink-0 text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleString()}
                    </div>}
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
                        onClick={() => onReviewDraft(note.entity_id!, note.notificationId!)}
                        className="min-h-11 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        {t('fsm.notifications.reviewDraft')}
                      </button>
                    )}
                    {!note.is_read && (
                      <button
                        type="button"
                        onClick={() => markRead(note)}
                        className="min-h-11 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted"
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
