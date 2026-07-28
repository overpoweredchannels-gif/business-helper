"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Package, Tag, FolderTree, Users, Truck, ShoppingCart, Receipt, Warehouse,
  Banknote, ArrowLeftRight, CreditCard, TrendingUp, Brain, Bot, Landmark, BookOpen, Settings,
  CheckSquare, History, Shield, Lock, Rocket, Clock, Sparkles, MessageSquare, Mic, Globe, Smartphone,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";

const navIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  products: Package,
  brands: Tag,
  categories: FolderTree,
  customers: Users,
  suppliers: Truck,
  purchases: ShoppingCart,
  sales: Receipt,
  inventory: Warehouse,
  "customer-payments": Banknote,
  "supplier-payments": ArrowLeftRight,
  expenses: CreditCard,
  "profit-loss": TrendingUp,
  "business-intelligence": Brain,
  "ai-analytics": Bot,
  "customer-credit": Landmark,
  "supplier-ledger": BookOpen,
  "business-settings": Settings,
  "task-manager": CheckSquare,
  "activity-logs": History,
  "staff-permissions": Shield,
  "security-check": Lock,
  "deployment": Rocket,
  "staff-duty": Clock,
  "ai-assistant": Sparkles,
  "ai-business-query": MessageSquare,
  "ai-voice-operator": Mic,
  "market-intelligence": Globe,
  "mobile-app": Smartphone,
};

interface SidebarProps {
  items: Array<{ id: SectionId; label: string }>;
  activeSection: SectionId;
  onSectionChange: (id: SectionId) => void;
  organizationName?: string;
  userName?: string;
}

export function Sidebar({ items, activeSection, onSectionChange, organizationName }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col bg-card border-r border-border transition-all duration-300 h-screen sticky top-0",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      {/* Logo */}
      <div className={cn("border-b border-border flex items-center gap-3 px-5", collapsed ? "justify-center py-4" : "py-5")}>
        <div className="size-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-brand font-bold text-sm">T</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-brand font-bold text-base text-foreground truncate">TradeOS</div>
            {organizationName && (
              <div className="text-[10px] text-light-text truncate">{organizationName}</div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map((item) => {
          const Icon = navIconMap[item.id];
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeSection === item.id
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-foreground/70 hover:text-foreground hover:bg-muted",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? item.label : undefined}
            >
              {Icon && <Icon className="size-4.5 shrink-0" />}
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
