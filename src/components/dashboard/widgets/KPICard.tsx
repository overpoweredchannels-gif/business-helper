"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { DashboardReadStatus } from "@/lib/dashboard/data-read-state";

interface SparklineProps {
  data: number[];
  className?: string;
}

function Sparkline({ data, className }: SparklineProps) {
  if (!data.length) return null;
  const w = 60;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg className={cn("shrink-0", className)} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary/40"
      />
    </svg>
  );
}

interface KPICardProps {
  title: string;
  value: string;
  readStatus?: DashboardReadStatus;
  lastSuccessfulAt?: string;
  onRetry?: () => void;
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
  sparklineData?: number[];
  format?: "number" | "currency";
  onClick?: () => void;
}

export function KPICard({ title, value, readStatus = "successful-populated", lastSuccessfulAt, onRetry, trend, icon, sparklineData, onClick }: KPICardProps) {
  const isUp = (trend?.value ?? 0) >= 0;
  const readComplete = readStatus === "successful-empty" || readStatus === "successful-populated";
  const shownValue = readComplete ? value : readStatus === "loading" ? "Loading…" : readStatus === "not-loaded" ? "Not loaded" : "Unavailable";
  const Component = onClick && readComplete ? "button" : "div";
  return (
    <Component
      onClick={readComplete ? onClick : undefined}
      className={cn(
        "group rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(45,41,38,0.1)]",
        onClick && readComplete && "w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-light-text uppercase tracking-wider">{title}</span>
        {icon && <div className="size-8 rounded-lg bg-primary-light flex items-center justify-center text-primary">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div role="status" aria-live="polite" className="text-2xl font-semibold tabular-nums text-foreground font-heading">{shownValue}</div>
          {readStatus === "failed" && lastSuccessfulAt && (
            <p className="mt-1 text-xs text-muted-foreground">Last successful update: {new Date(lastSuccessfulAt).toLocaleString()}</p>
          )}
          {readStatus === "failed" && onRetry && (
            <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-md px-2 text-xs font-semibold text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry dashboard reads</button>
          )}
          {readComplete && trend && (
            <div className={cn("flex items-center gap-1 mt-1 text-xs font-medium", isUp ? "text-success" : "text-destructive")}>
              {isUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              <span>{trend.label}</span>
            </div>
          )}
        </div>
        {readComplete && sparklineData && <Sparkline data={sparklineData} />}
      </div>
    </Component>
  );
}
