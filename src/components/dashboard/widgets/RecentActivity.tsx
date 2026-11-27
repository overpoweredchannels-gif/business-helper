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
  onExport?: () => void;
}

export function RecentActivity({ activities, onViewAll, onExport }: RecentActivityProps) {
  const { t } = useRegional();
  return (
    <div className="aankh-card rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('dashboard.recentActivity')}</h3>
        {onExport && <button type="button" onClick={onExport} className="workspace-button-secondary">Export CSV</button>}
        {onViewAll && (
          <button onClick={onViewAll} className="flex min-h-11 items-center gap-1 -mr-1.5 rounded px-1.5 text-xs font-medium text-primary hover:text-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('dashboard.viewAll')}
            <ArrowRight className="size-3" />
          </button>
        )}
      </div>
      <div className="dashboard-table-scroll overflow-x-auto rounded-xl border border-border"
        role="region" aria-label={t('dashboard.recentActivity')} tabIndex={0}>
        <table className="w-full table-auto text-start text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-3 text-start">{t('hist.typeLabel')}</th>
              <th scope="col" className="px-3 py-3 text-start">{t('logs.colDescription')}</th>
              <th scope="col" className="px-3 py-3 text-end">{t('money.amount')}</th>
              <th scope="col" className="px-3 py-3 text-start">{t('logs.colTime')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activities.slice(0, 5).map(activity => {
              const Icon = activityIcons[activity.type];
              return (
                <tr key={activity.id}>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg", typeStyles[activity.type])}><Icon className="size-4" /></span>
                      {t(typeLabels[activity.type])}
                    </span>
                  </td>
                  <td className="min-w-36 px-3 py-3 font-medium"><bdi>{activity.description}</bdi></td>
                  <td className="whitespace-nowrap px-3 py-3 text-end font-semibold tabular-nums"><bdi>{activity.amount ?? "—"}</bdi></td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground"><bdi>{activity.time}</bdi></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
