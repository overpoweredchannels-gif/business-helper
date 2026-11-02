"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

function BarChart({ data, height = 144 }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const width = Math.max(data.length, 1) * 48;
  const plotHeight = height - 24;
  return (
    <div>
    <svg viewBox={`0 0 ${width} ${plotHeight}`} height={plotHeight} preserveAspectRatio="none" className="w-full" role="img">
      <title>{data.map(d => `${d.label}: ${d.value}`).join('; ')}</title>
      {data.map((d, index) => {
        const barHeight = Math.max(0, d.value / max) * plotHeight;
        return <g key={d.label}>
          <rect x={index * 48 + 8} y={0} width={32} height={plotHeight} rx={3} fill="var(--color-muted)" />
          <rect className="aankh-chart-bar" x={index * 48 + 8} y={plotHeight - barHeight} width={32} height={barHeight} rx={3} fill={d.color || 'var(--color-primary)'} />
        </g>;
      })}
    </svg>
    <div aria-hidden="true" className="mt-2 flex gap-2">
      {data.map(d => <span key={d.label} title={d.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-light-text">{d.label}</span>)}
    </div>
    </div>
  );
}

interface TopItemProps {
  rank: number;
  name: string;
  value: string;
  trend?: "up" | "down" | "flat";
}

function TopItem({ rank, name, value, trend }: TopItemProps) {
  return (
    <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn(
          "size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
          rank === 1 && "bg-warning/20 text-warning-text",
          rank === 2 && "bg-muted text-muted-foreground",
          rank === 3 && "bg-primary-light text-primary",
          rank > 3 && "bg-muted text-muted-foreground",
        )}>
          {rank}
        </span>
        <span className="text-sm text-foreground truncate"><bdi>{name}</bdi></span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-3">
        <span className="text-sm font-semibold tabular-nums text-foreground"><bdi>{value}</bdi></span>
        {trend === "up" && <TrendingUp className="size-3 text-success" />}
        {trend === "down" && <TrendingDown className="size-3 text-destructive" />}
        {trend === "flat" && <Minus className="size-3 text-light-text" />}
      </div>
    </div>
  );
}

type TrendPoint = { label: string; value: number };
type RankedItem = { name: string; value: string; trend?: "up" | "down" | "flat" };

const card = "aankh-card rounded-xl border border-border bg-card p-6 h-full";

// Each chart is its own card so the home dashboard can add or remove one at a time.
export function RevenueTrendCard({ data }: { data: TrendPoint[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.revenueTrend')}</h3>
      <BarChart data={data} />
    </div>
  );
}

export function ProfitTrendCard({ data }: { data: TrendPoint[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.profitTrend')}</h3>
      <BarChart data={data} />
    </div>
  );
}

export function TopProductsCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.topProducts')}</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}

export function TopCustomersCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.topCustomers')}</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}
