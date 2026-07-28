"use client";

import { cn } from "@/lib/utils";
import { Receipt, ShoppingCart, PackagePlus, Banknote, UserPlus, Warehouse } from "lucide-react";

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}

const defaultActions: QuickAction[] = [
  { label: "New Sale", icon: <Receipt className="size-5" />, primary: true },
  { label: "New Purchase", icon: <ShoppingCart className="size-5" />, primary: true },
  { label: "Add Product", icon: <PackagePlus className="size-5" /> },
  { label: "Record Payment", icon: <Banknote className="size-5" /> },
  { label: "Add Customer", icon: <UserPlus className="size-5" /> },
  { label: "View Inventory", icon: <Warehouse className="size-5" /> },
];

interface QuickActionsProps {
  actions?: QuickAction[];
  onAction?: (label: string) => void;
}

export function QuickActions({ actions = defaultActions, onAction }: QuickActionsProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">Quick Actions</h3>
      <div className="grid grid-cols-3 gap-2.5">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => onAction?.(a.label)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg py-3 px-2 text-xs font-medium transition-all duration-200",
              "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              a.primary
                ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm hover:shadow-md"
                : "border border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
