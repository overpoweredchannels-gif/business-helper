"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { CHART_VALUE_LABEL_CLASS, trendAxisTicks } from "@/lib/dashboard/trends";
import { formatBooksMoney } from "@/lib/tradeos/formatters";

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  /**
   * How a bar's value (and the axis ticks) are formatted. Defaults to
   * books money; the dashboard passes its own formatDashboardMoney so
   * the chart labels match the KPI figures.
   */
  formatValue?: (value: number) => string;
}

function BarChart({ data, height = 144, formatValue = formatBooksMoney }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const ticks = trendAxisTicks(data);
  const width = Math.max(data.length, 1) * 48;
  const plotHeight = height - 24;
  return (
    <div className="grid" style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}>
    {/* Value labels, one per bar, in the same evenly-spaced cells as the
        date labels below — the SVG's preserveAspectRatio="none" would
        distort text drawn inside it, so values stay in HTML. No gap and
        no truncation: with gap-2 the cells were narrower than the bar
        slots (and misaligned with them), so the longest values clipped
        to "€13…" / "€14…". With gap-0 each cell is exactly one bar slot
        wide, centred on its bar, and the text never truncates. */}
    <span aria-hidden="true" />
    <div aria-hidden="true" className="flex">
      {data.map((d) => (
        <span key={d.label} title={formatValue(d.value)} className={CHART_VALUE_LABEL_CLASS}>{formatValue(d.value)}</span>
      ))}
    </div>
    {/* Simple y-axis: max / half / 0, exactly plotHeight tall so the top
        tick lines up with the top of the bars and 0 with their baseline. */}
    <div aria-hidden="true" className="flex flex-col justify-between pr-2 text-right text-[11px] tabular-nums text-light-text" style={{ height: plotHeight }}>
      <span>{formatValue(ticks.max)}</span>
      <span>{formatValue(ticks.mid)}</span>
      <span>{formatValue(0)}</span>
    </div>
    <svg viewBox={`0 0 ${width} ${plotHeight}`} height={plotHeight} preserveAspectRatio="none" className="w-full" role="img">
      <title>{data.map(d => `${d.label}: ${formatValue(d.value)}`).join('; ')}</title>
      {data.map((d, index) => {
        const barHeight = Math.max(0, d.value / max) * plotHeight;
        return <g key={d.label}>
          <rect x={index * 48 + 8} y={0} width={32} height={plotHeight} rx={3} fill="var(--color-muted)" />
          <rect className="aankh-chart-bar" x={index * 48 + 8} y={plotHeight - barHeight} width={32} height={barHeight} rx={3} fill={d.color || 'var(--color-primary)'} />
        </g>;
      })}
    </svg>
    <span aria-hidden="true" />
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
  /** Secondary figure under the value (Top Products revenue). */
  detail?: string;
  trend?: "up" | "down" | "flat";
}

function TopItem({ rank, name, value, detail, trend }: TopItemProps) {
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
      <div className="flex flex-col items-end shrink-0 ml-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold tabular-nums text-foreground"><bdi>{value}</bdi></span>
          {trend === "up" && <TrendingUp className="size-3 text-success" />}
          {trend === "down" && <TrendingDown className="size-3 text-destructive" />}
          {trend === "flat" && <Minus className="size-3 text-light-text" />}
        </div>
        {detail && <span className="text-xs tabular-nums text-muted-foreground"><bdi>{detail}</bdi></span>}
      </div>
    </div>
  );
}

type TrendPoint = { label: string; value: number };
type RankedItem = { name: string; value: string; detail?: string; trend?: "up" | "down" | "flat" };

const card = "aankh-card rounded-xl border border-border bg-card p-6 h-full";

// Each chart is its own card so the home dashboard can add or remove one at a time.
export function RevenueTrendCard({ data, formatValue }: { data: TrendPoint[]; formatValue?: (value: number) => string }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.revenueTrend')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.revenueTrendNoData')}</p>
      ) : (
        <BarChart data={data} formatValue={formatValue} />
      )}
    </div>
  );
}

export function ProfitTrendCard({ data, formatValue, unknownCostLines, unknownCostAmount }: { data: TrendPoint[]; formatValue?: (value: number) => string; unknownCostLines?: number; unknownCostAmount?: string }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.profitTrend')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.profitTrendNoData')}</p>
      ) : (
        <>
          <BarChart data={data} formatValue={formatValue} />
          {unknownCostLines != null && unknownCostLines > 0 && unknownCostAmount && (
            <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.profitTrendExcludesUnknownCost').replace('{amount}', unknownCostAmount).replace('{count}', String(unknownCostLines))}</p>
          )}
        </>
      )}
    </div>
  );
}

export function TopProductsCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.topProducts')}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.topProductsNoData')}</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item, index) => (
            <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} detail={item.detail} trend={item.trend} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TopCustomersCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">{t('dashboard.topCustomers')}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.topCustomersNoData')}</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item, index) => (
            <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
          ))}
        </div>
      )}
    </div>
  );
}
