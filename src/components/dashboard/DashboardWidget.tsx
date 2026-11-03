"use client";

import { X, ArrowUp, ArrowDown } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { cn } from "@/lib/utils";
import { dashboardWidgetDefinition, type DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";

/**
 * Wraps one home-dashboard card. In edit mode the card can be removed without
 * touching the underlying data; the sidebar keeps the same information reachable.
 */
export function DashboardWidget({ id, label: labelProp, hidden = false, customizing = false, onRemove, onMove, moveUpDisabled, moveDownDisabled, className, children }: {
  id: DashboardWidgetId;
  /** Shown on the remove control; defaults to the registered card name. */
  label?: string;
  hidden?: boolean;
  customizing?: boolean;
  onRemove?: (id: DashboardWidgetId) => void;
  onMove?: (direction: "up" | "down") => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useRegional();
  if (hidden) return null;
  const label = labelProp ?? dashboardWidgetDefinition(id)?.label ?? "this card";
  return (
    <div data-dashboard-widget={id} className={cn("relative", customizing && "rounded-xl ring-2 ring-primary/40", className)}>
      {customizing && onMove && <div className="relative z-10 flex items-center gap-1 rounded-t-xl border-b border-border bg-card p-2">
        <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium">{label}</span>
        <button type="button" aria-label={`Move ${label} up`} disabled={moveUpDisabled} onClick={() => onMove("up")} className="workspace-icon-button"><ArrowUp className="size-4" /></button>
        <button type="button" aria-label={`Move ${label} down`} disabled={moveDownDisabled} onClick={() => onMove("down")} className="workspace-icon-button"><ArrowDown className="size-4" /></button>
        <button type="button" aria-label={t('dashboard.widget.removeAria').replace('{label}', label)} onClick={() => onRemove?.(id)} className="workspace-icon-button text-destructive"><X className="size-4" /></button>
      </div>}
      {customizing && !onMove && (
        <button
          type="button"
          onClick={() => onRemove?.(id)}
          aria-label={t('dashboard.widget.removeAria').replace('{label}', label)}
          title={t('dashboard.widget.removeTitle').replace('{label}', label)}
          className="absolute right-2 top-2 z-30 inline-flex min-h-9 items-center gap-1 rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
          {t('sell.remove')}
        </button>
      )}
      {children}
    </div>
  );
}
