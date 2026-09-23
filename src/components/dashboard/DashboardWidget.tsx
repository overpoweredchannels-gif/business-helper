"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardWidgetDefinition, type DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";

/**
 * Wraps one home-dashboard card. In edit mode the card can be removed without
 * touching the underlying data; the sidebar keeps the same information reachable.
 */
export function DashboardWidget({ id, label: labelProp, hidden = false, customizing = false, onRemove, className, children }: {
  id: DashboardWidgetId;
  /** Shown on the remove control; defaults to the registered card name. */
  label?: string;
  hidden?: boolean;
  customizing?: boolean;
  onRemove?: (id: DashboardWidgetId) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  const label = labelProp ?? dashboardWidgetDefinition(id)?.label ?? "this card";
  return (
    <div data-dashboard-widget={id} className={cn("relative", customizing && "rounded-xl ring-2 ring-primary/40", className)}>
      {customizing && (
        <button
          type="button"
          onClick={() => onRemove?.(id)}
          aria-label={`Remove ${label} from the home dashboard`}
          title={`Remove ${label}`}
          className="absolute right-2 top-2 z-30 inline-flex min-h-9 items-center gap-1 rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
          Remove
        </button>
      )}
      {children}
    </div>
  );
}
