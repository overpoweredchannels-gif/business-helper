"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

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
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
  sparklineData?: number[];
  format?: "number" | "currency";
  onClick?: () => void;
}

export function KPICard({ title, value, trend, icon, sparklineData, onClick }: KPICardProps) {
  const isUp = (trend?.value ?? 0) >= 0;
  const Component = onClick ? "button" : "div";
  return (
    <Component
      onClick={onClick}
      className={cn(
        "group rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(45,41,38,0.1)]",
        onClick && "cursor-pointer text-left w-full",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-light-text uppercase tracking-wider">{title}</span>
        {icon && <div className="size-8 rounded-lg bg-primary-light flex items-center justify-center text-primary">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-semibold text-foreground font-heading">{value}</div>
          {trend && (
            <div className={cn("flex items-center gap-1 mt-1 text-xs font-medium", isUp ? "text-success" : "text-destructive")}>
              {isUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              <span>{trend.label}</span>
            </div>
          )}
        </div>
        {sparklineData && <Sparkline data={sparklineData} />}
      </div>
    </Component>
  );
}
