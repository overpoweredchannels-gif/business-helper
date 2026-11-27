"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { CHART_VALUE_LABEL_CLASS } from "@/lib/dashboard/trends";
import { formatBooksMoney } from "@/lib/tradeos/formatters";

interface TrendChartProps {
  data: { label: string; value: number }[];
  label: string;
  formatValue?: (value: number) => string;
}

function TrendChart({ data, label, formatValue = formatBooksMoney }: TrendChartProps) {
  const fillId = useId();
  const high = Math.max(0, ...data.map(point => point.value));
  const low = Math.min(0, ...data.map(point => point.value));
  const plotHeight = 144;
  const formattedValues = data.map(point => formatValue(point.value));
  const slot = Math.max(80, ...formattedValues.map(value => value.length * 8 + 12));
  const width = data.length * slot;
  const range = high - low || 1;
  const y = (value: number) => high === low ? plotHeight - 4 : 4 + (high - value) / range * (plotHeight - 8);
  const points = data.map((point, index) => ({ x: (index + 0.5) * slot, y: y(point.value) }));
  const line = points.map(point => `${point.x},${point.y}`).join(" ");
  const baseline = y(0);
  const area = `${points[0].x},${baseline} ${line} ${points.at(-1)!.x},${baseline}`;

  return (
    <div className="dashboard-table-scroll overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)]" style={{ minWidth: data.length * slot + 60 }}>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="flex">
          {data.map((point, index) => (
            <span key={point.label} title={formattedValues[index]} className={CHART_VALUE_LABEL_CLASS}>{formattedValues[index]}</span>
          ))}
        </div>
        <div aria-hidden="true" className="flex flex-col justify-between pe-3 text-end text-xs tabular-nums text-muted-foreground" style={{ height: plotHeight }}>
          <span>{formatValue(high)}</span>
          <span>{formatValue((high + low) / 2)}</span>
          <span>{formatValue(low)}</span>
        </div>
        <svg viewBox={`0 0 ${width} ${plotHeight}`} height={plotHeight} preserveAspectRatio="none" className="w-full" role="img">
          <title>{data.map((point, index) => `${point.label}: ${formattedValues[index]}`).join("; ")}</title>
          <defs>
            <linearGradient id={fillId} x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-primary)" stopOpacity={0.24} />
              <stop offset="1" stopColor="var(--color-primary)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          {[4, plotHeight / 2, plotHeight - 4].map(tick => (
            <path key={tick} d={`M0 ${tick}H${width}`} stroke="var(--color-border)" vectorEffect="non-scaling-stroke" />
          ))}
          <polygon points={area} fill={`url(#${fillId})`} />
          <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => (
            <circle key={data[index].label} cx={point.x} cy={point.y} r={3}
              fill="var(--color-card)" stroke="var(--color-primary)" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="mt-2 flex">
          {data.map(point => <span key={point.label} className="flex-1 text-center text-xs text-muted-foreground">{point.label}</span>)}
        </div>
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
        <TrendChart data={data} label={t('dashboard.revenueTrend')} formatValue={formatValue} />
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
          <TrendChart data={data} label={t('dashboard.profitTrend')} formatValue={formatValue} />
          {unknownCostLines != null && unknownCostLines > 0 && unknownCostAmount && (
            <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.profitTrendExcludesUnknownCost').replace('{amount}', unknownCostAmount).replace('{count}', String(unknownCostLines))}</p>
          )}
        </>
      )}
    </div>
  );
}

export function TopProductsCard({ items, periodLabel }: { items: RankedItem[]; periodLabel?: string }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{t('dashboard.topProducts')}</h3>
        {periodLabel && <span className="text-xs text-muted-foreground">{periodLabel}</span>}
      </div>
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
