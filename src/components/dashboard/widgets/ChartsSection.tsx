"use client";

import { cn } from "@/lib/utils";
import { formatPKR } from "@/lib/tradeos/formatters";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

function BarChart({ data, height = 144 }: BarChartProps) {
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
          <span className="text-[11px] text-light-text truncate w-full text-center">{d.label}</span>
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
          "size-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
          rank === 1 && "bg-warning/20 text-warning",
          rank === 2 && "bg-muted text-muted-foreground",
          rank === 3 && "bg-primary-light text-primary",
          rank > 3 && "bg-muted text-muted-foreground",
        )}>
          {rank}
        </span>
        <span className="text-sm text-foreground truncate">{name}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-3">
        <span className="text-sm font-semibold text-foreground">{value}</span>
        {trend === "up" && <TrendingUp className="size-3 text-success" />}
        {trend === "down" && <TrendingDown className="size-3 text-destructive" />}
        {trend === "flat" && <Minus className="size-3 text-light-text" />}
      </div>
    </div>
  );
}

type TrendPoint = { label: string; value: number };
type RankedItem = { name: string; value: string; trend?: "up" | "down" | "flat" };

const card = "h-full rounded-xl border border-border bg-card p-6 shadow-sm";

// Each chart is its own card so the home dashboard can add or remove one at a time.
// Step 5: period + period total + written zero state + a hidden data list
// for screen readers. Totals are sums of the bars already displayed —
// no new data, no new binding. Top cards already show their values as text,
// so they need no hidden list.
function TrendCardHeader({ title, period, total }: { title: string; period: string; total: number }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <span className="text-lg font-semibold tabular-nums text-foreground shrink-0">{formatPKR(total)}</span>
      </div>
      <p className="text-xs text-light-text mt-0.5">{period}</p>
    </div>
  );
}

function TrendCardBody({ data, emptyMessage }: { data: TrendPoint[]; emptyMessage: string }) {
  if (data.every((d) => d.value === 0)) {
    return <p className="flex h-[144px] items-center text-sm text-light-text">{emptyMessage}</p>;
  }
  return (
    <>
      <BarChart data={data} />
      <ul className="sr-only">
        {data.map((d) => (
          <li key={d.label}>{d.label}: {formatPKR(d.value)}</li>
        ))}
      </ul>
    </>
  );
}

export function RevenueTrendCard({ data }: { data: TrendPoint[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className={card}>
      <TrendCardHeader title="Revenue Trend" period="Last 6 months" total={total} />
      <TrendCardBody data={data} emptyMessage="No sales in this period" />
    </div>
  );
}

export function ProfitTrendCard({ data }: { data: TrendPoint[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className={card}>
      <TrendCardHeader title="Profit Trend" period="Last 14 days" total={total} />
      <TrendCardBody data={data} emptyMessage="No profit in this period" />
    </div>
  );
}

export function TopProductsCard({ items }: { items: RankedItem[] }) {
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">Top Products</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}

export function TopCustomersCard({ items }: { items: RankedItem[] }) {
  return (
    <div className={card}>
      <h3 className="text-base font-semibold text-foreground mb-4">Top Customers</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}
