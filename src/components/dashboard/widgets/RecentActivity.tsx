"use client";

import { cn } from "@/lib/utils";
import { Clock, ArrowRight } from "lucide-react";

interface Activity {
  id: string;
  type: "sale" | "purchase" | "payment" | "stock" | "customer" | "task";
  description: string;
  time: string;
  amount?: string;
}

const typeStyles = {
  sale: "bg-success/10 text-success",
  purchase: "bg-primary-light text-primary",
  payment: "bg-warning/10 text-warning",
  stock: "bg-destructive/10 text-destructive",
  customer: "bg-accent text-accent-foreground",
  task: "bg-muted text-muted-foreground",
};

const typeLabels: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  payment: "Payment",
  stock: "Stock",
  customer: "Customer",
  task: "Task",
};

interface RecentActivityProps {
  activities: Activity[];
  onViewAll?: () => void;
}

export function RecentActivity({ activities, onViewAll }: RecentActivityProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
        {onViewAll && (
          <button onClick={onViewAll} className="flex min-h-6 items-center gap-1 -mr-1.5 rounded px-1.5 text-xs font-medium text-primary hover:text-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View all
            <ArrowRight className="size-3" />
          </button>
        )}
      </div>
      <div className="relative pl-6 space-y-4">
        <div className="absolute left-2.5 top-1 bottom-1 w-px bg-border" />
        {activities.map((a) => (
          <div key={a.id} className="relative">
            <div className="absolute -left-[13.5px] top-1.5 size-2 rounded-full border-2 border-background bg-card" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", typeStyles[a.type])}>
                    {typeLabels[a.type]}
                  </span>
                  <span className="text-xs text-light-text flex items-center gap-1">
                    <Clock className="size-3" />
                    {a.time}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-1">{a.description}</p>
              </div>
              {a.amount && <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{a.amount}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
