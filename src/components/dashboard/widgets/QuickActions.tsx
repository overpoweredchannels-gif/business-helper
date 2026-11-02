"use client";

import { cn } from "@/lib/utils";
import { Receipt, ShoppingCart, PackagePlus, Banknote, UserPlus, Warehouse } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";

interface QuickAction {
  /** Stable English routing key passed to onAction (page.tsx matches on these). Never translated. */
  label: string;
  /** Catalog key for the translated display label; falls back to `label` when absent. */
  labelKey?: MessageKey;
  icon: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}

const defaultActions: QuickAction[] = [
  { label: "New Sale", labelKey: "quickaction.newSale", icon: <Receipt className="size-5" />, primary: true },
  { label: "New Purchase", labelKey: "quickaction.newPurchase", icon: <ShoppingCart className="size-5" /> },
  { label: "Add Product", labelKey: "quickaction.addProduct", icon: <PackagePlus className="size-5" /> },
  { label: "Record Payment", labelKey: "quickaction.recordPayment", icon: <Banknote className="size-5" /> },
  { label: "Add Customer", labelKey: "quickaction.addCustomer", icon: <UserPlus className="size-5" /> },
  { label: "View Inventory", labelKey: "quickaction.viewInventory", icon: <Warehouse className="size-5" /> },
];

interface QuickActionsProps {
  actions?: QuickAction[];
  onAction?: (label: string) => void;
}

export function QuickActions({ actions = defaultActions, onAction }: QuickActionsProps) {
  const { t } = useRegional();
  return (
    <div className="aankh-card rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">{t('quickaction.heading')}</h3><div aria-hidden="true" className="aankh-object"><span /><span /><span /></div></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => onAction?.(a.label)}
            data-help-id="dashboard-quick-actions"
            aria-label={a.labelKey ? t(a.labelKey) : a.label}
            className={cn(
              "aankh-action flex min-h-14 items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              a.primary
                ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                : "border border-input bg-card text-foreground hover:bg-muted",
            )}
          >
            <span aria-hidden="true" className="shrink-0">{a.icon}</span>
            <span>{a.labelKey ? t(a.labelKey) : a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
