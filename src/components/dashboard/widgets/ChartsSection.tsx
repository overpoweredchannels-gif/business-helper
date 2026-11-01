"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

function BarChart({ data, height = 120 }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t-sm transition-all duration-500"
            style={{
              height: `${(d.value / max) * 100}%`,
              backgroundColor: d.color || "var(--color-primary)",
              opacity: 0.8,
            }}
          />
          <span className="text-[10px] text-light-text truncate w-full text-center">{d.label}</span>
        </div>
      ))}
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
          rank === 1 && "bg-warning/20 text-warning",
          rank === 2 && "bg-muted text-muted-foreground",
          rank === 3 && "bg-primary-light text-primary",
          rank > 3 && "bg-muted text-muted-foreground",
        )}>
          {rank}
        </span>
        <span className="text-sm text-foreground truncate"><bdi>{name}</bdi></span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-3">
        <span className="text-sm font-semibold text-foreground"><bdi>{value}</bdi></span>
        {trend === "up" && <TrendingUp className="size-3 text-success" />}
        {trend === "down" && <TrendingDown className="size-3 text-destructive" />}
        {trend === "flat" && <Minus className="size-3 text-light-text" />}
      </div>
    </div>
  );
}

type TrendPoint = { label: string; value: number };
type RankedItem = { name: string; value: string; trend?: "up" | "down" | "flat" };

const card = "rounded-xl border border-border bg-card p-5";

// Each chart is its own card so the home dashboard can add or remove one at a time.
export function RevenueTrendCard({ data }: { data: TrendPoint[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('dashboard.revenueTrend')}</h3>
      <BarChart data={data} />
    </div>
  );
}

export function ProfitTrendCard({ data }: { data: TrendPoint[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('dashboard.profitTrend')}</h3>
      <BarChart data={data} />
    </div>
  );
}

export function TopProductsCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('dashboard.topProducts')}</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}

export interface TrendLinePoint {
  label: string;
  value: number;
}

export interface TrendLineSeries {
  name: string;
  color: string;
  fill?: boolean;
  points: TrendLinePoint[];
}

// A real SVG line/area chart: the dashboard's BarChart and the BI section's
// CSS bars show only relative widths. This one shows the actual shape over
// time, with a zero line when a series goes negative and a native tooltip
// (title) on every point. It takes no translated strings: names, labels and
// money formatting all arrive as props, so it works under either regional
// message system.
export function TrendLineChart({ series, formatValue, height = 220 }: {
  series: TrendLineSeries[];
  formatValue: (value: number) => string;
  height?: number;
}) {
  const width = 720;
  const padTop = 16;
  const padBottom = 30;
  const padSide = 10;
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (allValues.length === 0) return null;
  const maxValue = Math.max(0, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const span = maxValue - minValue || 1;
  const xFor = (index: number, count: number) =>
    count <= 1 ? width / 2 : padSide + (index / (count - 1)) * (width - padSide * 2);
  const yFor = (value: number) =>
    padTop + (1 - (value - minValue) / span) * (height - padTop - padBottom);
  const longest = series.reduce((a, b) => (b.points.length > a.points.length ? b : a), series[0]);
  const axisPoints = longest.points.length > 2
    ? [longest.points[0], longest.points[Math.floor(longest.points.length / 2)], longest.points[longest.points.length - 1]]
    : longest.points;
  const axisStyle: CSSProperties = {
    fill: "var(--color-muted-foreground)",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={series.map((s) => s.name).join(", ")}
      >
        {minValue < 0 && (
          <line x1={padSide} x2={width - padSide} y1={yFor(0)} y2={yFor(0)} stroke="var(--color-muted-foreground)" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        )}
        <text x={padSide} y={padTop - 4} style={axisStyle}>{formatValue(maxValue)}</text>
        {minValue < 0 && (
          <text x={padSide} y={height - padBottom + 14} style={axisStyle}>{formatValue(minValue)}</text>
        )}
        {series.map((s) => {
          const line = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i, s.points.length)},${yFor(p.value)}`).join(" ");
          const area = s.points.length > 1
            ? `${line} L${xFor(s.points.length - 1, s.points.length)},${yFor(0)} L${xFor(0, s.points.length)},${yFor(0)} Z`
            : "";
          return (
            <g key={s.name}>
              {s.fill && area && <path d={area} fill={s.color} opacity={0.12} />}
              {s.points.length > 1 && <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {s.points.map((p, i) => (
                <circle key={`${p.label}-${i}`} cx={xFor(i, s.points.length)} cy={yFor(p.value)} r={3.5} fill={s.color}>
                  <title>{`${p.label}: ${formatValue(p.value)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {axisPoints.map((p, i) => (
          <text
            key={`${p.label}-${i}`}
            x={xFor(longest.points.indexOf(p), longest.points.length)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === axisPoints.length - 1 ? "end" : "middle"}
            style={axisStyle}
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function TopCustomersCard({ items }: { items: RankedItem[] }) {
  const { t } = useRegional();
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('dashboard.topCustomers')}</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}
