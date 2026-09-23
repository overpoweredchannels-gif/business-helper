"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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

const card = "rounded-xl border border-border bg-card p-5";

// Each chart is its own card so the home dashboard can add or remove one at a time.
export function RevenueTrendCard({ data }: { data: TrendPoint[] }) {
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">Revenue Trend</h3>
      <BarChart data={data} />
    </div>
  );
}

export function ProfitTrendCard({ data }: { data: TrendPoint[] }) {
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">Profit Trend</h3>
      <BarChart data={data} />
    </div>
  );
}

export function TopProductsCard({ items }: { items: RankedItem[] }) {
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground mb-3">Top Products</h3>
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
      <h3 className="text-sm font-semibold text-foreground mb-3">Top Customers</h3>
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <TopItem key={item.name} rank={index + 1} name={item.name} value={item.value} trend={item.trend} />
        ))}
      </div>
    </div>
  );
}
