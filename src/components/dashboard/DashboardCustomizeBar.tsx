"use client";

import { Pencil, Plus, RotateCcw, X } from "lucide-react";
import type { DashboardWidgetDefinition, DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";

/**
 * The only control the home dashboard needs: switch edit mode on, remove what you
 * do not use, and put it back later. Nothing here deletes business data - a
 * removed card is only hidden from the dashboard.
 */
export function DashboardCustomizeBar({ customizing, onToggle, removed, onShow, onReset }: {
  customizing: boolean;
  onToggle: () => void;
  removed: DashboardWidgetDefinition[];
  onShow: (id: DashboardWidgetId) => void;
  onReset: () => void;
}) {
  if (!customizing) {
    return (
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Pencil className="size-3.5" />
          Edit home
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Edit home dashboard" className="mb-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Editing your home dashboard</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Press <span className="font-medium text-foreground">Remove</span> on any card to take it off your dashboard. Your records are untouched and the same
            information stays available in the sidebar.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={removed.length === 0}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            <X className="size-3.5" />
            Done
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold text-foreground">
          {removed.length > 0 ? `Removed from your dashboard (${removed.length})` : "Nothing removed yet"}
        </p>
        {removed.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Every card is currently on your dashboard.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {removed.map((widget) => (
              <button
                key={widget.id}
                type="button"
                onClick={() => onShow(widget.id)}
                title={`Add ${widget.label} back - it also stays available in ${widget.whereToFind}`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="size-3" />
                {widget.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
