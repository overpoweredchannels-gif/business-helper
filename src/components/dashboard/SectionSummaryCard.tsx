"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardReadStatusLabel, type DashboardReadStatus } from "@/lib/dashboard/data-read-state";

export interface SectionSummaryMetric {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger" | "success";
  readStatus?: DashboardReadStatus;
  lastSuccessfulAt?: string;
}

export interface SectionSummaryRow {
  label: string;
  value: string;
}

export interface SectionSummary {
  title: string;
  description?: string;
  metrics: SectionSummaryMetric[];
  rows?: SectionSummaryRow[];
  rowsLabel?: string;
  emptyText?: string;
  rowsReadStatus?: DashboardReadStatus;
  rowsLastSuccessfulAt?: string;
  onOpen: () => void;
}

const toneClass: Record<NonNullable<SectionSummaryMetric["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  success: "text-success",
};

/**
 * A card the user dropped onto the home dashboard from the sidebar. It only
 * summarises the section - the full list stays one tap away in the sidebar.
 */
export function SectionSummaryCard({ summary }: { summary: SectionSummary }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{summary.title}</h2>
          {summary.description && <p className="mt-0.5 text-xs text-light-text">{summary.description}</p>}
        </div>
        <button
          type="button"
          onClick={summary.onOpen}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Open
          <ArrowRight className="size-3" />
        </button>
      </div>

      {summary.metrics.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {summary.metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg bg-muted p-2.5">
              <p role={metric.readStatus && !dashboardReadStatusLabel(metric.readStatus) ? undefined : "status"} aria-live="polite" className={cn("text-lg font-semibold leading-tight", metric.readStatus && dashboardReadStatusLabel(metric.readStatus) ? "text-muted-foreground" : toneClass[metric.tone ?? "default"])}>{metric.readStatus ? dashboardReadStatusLabel(metric.readStatus) ?? metric.value : metric.value}</p>
              {metric.readStatus === "failed" && metric.lastSuccessfulAt && <p className="mt-1 text-[10px] text-muted-foreground">Last successful update: {new Date(metric.lastSuccessfulAt).toLocaleString()}</p>}
              <p className="text-[10px] text-light-text">{metric.label}</p>
            </div>
          ))}
        </div>
      )}

      {summary.rowsReadStatus && dashboardReadStatusLabel(summary.rowsReadStatus) ? (
        <div role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
          <p>{dashboardReadStatusLabel(summary.rowsReadStatus)}</p>
          {summary.rowsReadStatus === "failed" && summary.rowsLastSuccessfulAt && <p className="mt-1">Last successful update: {new Date(summary.rowsLastSuccessfulAt).toLocaleString()}</p>}
        </div>
      ) : summary.rows && summary.rows.length > 0 ? (
        <div className="mt-3">
          {summary.rowsLabel && <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{summary.rowsLabel}</p>}
          <div className="mt-1 divide-y divide-border">
            {summary.rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate text-xs text-foreground/80">{row.label}</span>
                <span className="shrink-0 text-xs font-medium text-foreground">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        summary.emptyText && <p className="mt-3 text-xs text-light-text">{summary.emptyText}</p>
      )}
    </section>
  );
}
