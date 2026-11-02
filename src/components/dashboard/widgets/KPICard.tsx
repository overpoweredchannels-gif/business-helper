"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { DashboardReadStatus } from "@/lib/dashboard/data-read-state";
import { useRegional } from "@/components/regional/RegionalProvider";

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
  tone?: "default" | "accent" | "success" | "warning";
}

export function KPICard({ title, value, readStatus = "successful-populated", lastSuccessfulAt, onRetry, trend, icon, sparklineData, onClick, tone = "default" }: KPICardProps) {
  const { t, ui, language } = useRegional();
  const isUp = (trend?.value ?? 0) >= 0;
  const readComplete = readStatus === "successful-empty" || readStatus === "successful-populated";
  const shownValue = readComplete ? value : readStatus === "loading" ? ui('loading') : readStatus === "not-loaded" ? t('dashboard.notLoaded') : t('dashboard.unavailable');
  const Component = onClick && readComplete ? "button" : "div";
  return (
    <Component
      onClick={readComplete ? onClick : undefined}
      data-tone={tone}
      className={cn(
        "aankh-card aankh-metric group h-full min-h-32 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5",
        onClick && readComplete && "w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="mb-4 flex min-h-9 items-start justify-between gap-3">
        <span className="pt-1 text-xs font-medium leading-relaxed text-body">{title}</span>
        {icon && <div aria-hidden="true" className="aankh-metric-icon flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <div className="min-w-0">
          <div role="status" aria-live="polite" className="break-words text-2xl sm:text-[28px] font-semibold tracking-tight tabular-nums leading-tight text-foreground font-heading"><bdi>{shownValue}</bdi></div>
          {readStatus === "failed" && lastSuccessfulAt && (
            <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.lastSuccessful')}: {new Date(lastSuccessfulAt).toLocaleString(language === 'es' ? 'es-ES' : language === 'it' ? 'it-IT' : language === 'ur' ? 'ur-PK' : 'en-US')}</p>
          )}
          {readStatus === "failed" && onRetry && (
            <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-md px-2 text-xs font-semibold text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('dashboard.retryReads')}</button>
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
