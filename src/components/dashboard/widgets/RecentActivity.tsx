"use client";

import { cn } from "@/lib/utils";
import { ArrowRight, Receipt, ShoppingCart, Banknote, Package, UserPlus, CheckSquare } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";

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
  payment: "bg-warning/10 text-warning-text",
  stock: "bg-destructive/10 text-destructive",
  customer: "bg-accent text-accent-foreground",
  task: "bg-muted text-muted-foreground",
};

const activityIcons = { sale: Receipt, purchase: ShoppingCart, payment: Banknote, stock: Package, customer: UserPlus, task: CheckSquare };

const typeLabels: Record<string, MessageKey> = {
  sale: "activity.sale",
  purchase: "activity.purchase",
  payment: "activity.payment",
  stock: "activity.stock",
  customer: "activity.customer",
  task: "activity.task",
};

interface RecentActivityProps {
  activities: Activity[];
  onViewAll?: () => void;
}

export function RecentActivity({ activities, onViewAll }: RecentActivityProps) {
  const { t } = useRegional();
  return (
    <div className="aankh-card rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{t('dashboard.recentActivity')}</h3>
        {onViewAll && (
          <button onClick={onViewAll} className="flex min-h-11 items-center gap-1 -mr-1.5 rounded px-1.5 text-xs font-medium text-primary hover:text-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('dashboard.viewAll')}
            <ArrowRight className="size-3" />
          </button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {activities.slice(0, 5).map(a => {
          const Icon = activityIcons[a.type];
          return <li key={a.id} className="flex min-h-16 items-center gap-3 py-3">
            <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", typeStyles[a.type])}><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground"><bdi>{a.description}</bdi></p><p className="mt-1 text-[11px] text-muted-foreground">{t(typeLabels[a.type])} · {a.time}</p></div>
            {a.amount && <span className="shrink-0 text-sm font-semibold tabular-nums"><bdi>{a.amount}</bdi></span>}
          </li>;
        })}
      </ul>
    </div>
  );
}
