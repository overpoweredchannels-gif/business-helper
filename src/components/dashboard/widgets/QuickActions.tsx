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
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('quickaction.heading')}</h3>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => onAction?.(a.label)}
            aria-label={a.labelKey ? t(a.labelKey) : a.label}
            className={cn(
              "flex min-h-11 flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition-all duration-200",
              a.primary && "col-span-2 sm:col-span-1",
              "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              a.primary
                ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm hover:shadow-md"
                : "border border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {a.icon}
            <span>{a.labelKey ? t(a.labelKey) : a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
