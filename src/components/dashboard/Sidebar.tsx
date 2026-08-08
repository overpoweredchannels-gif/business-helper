"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Tag, FolderTree, Users, Truck, ShoppingCart, Receipt, Warehouse,
  Banknote, ArrowLeftRight, CreditCard, TrendingUp, Brain, Bot, BookOpen, Settings,
  CheckSquare, History, Shield, Lock, Clock, Sparkles, MessageSquare, Mic, Globe, Smartphone,
  ChevronLeft, ChevronRight, Eye, EyeOff, ArrowDown, ArrowUp, Pencil, RotateCcw, X, MapPin, Bell, Package, Rocket,
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
  "customer-credit": BookOpen,
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
  "live-tracking": MapPin,
  employees: Users,
  territories: Globe,
  routes: MapPin,
  notifications: Bell,
};

interface SidebarProps {
  items: Array<{ id: SectionId; label: string }>;
  activeSection: SectionId;
  onSectionChange: (id: SectionId) => void;
  organizationName?: string;
  forceVisible?: boolean;
  customizeMode?: boolean;
  hiddenIds?: string[];
  canCustomize?: boolean;
  onToggleCustomize?: () => void;
  onMoveItem?: (id: string, direction: "up" | "down") => void;
  onToggleHidden?: (id: string) => void;
  onResetOrder?: () => void;
}

export function Sidebar({
  items,
  activeSection,
  onSectionChange,
  organizationName,
  forceVisible,
  customizeMode,
  hiddenIds,
  canCustomize,
  onToggleCustomize,
  onMoveItem,
  onToggleHidden,
  onResetOrder,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hiddenSet = new Set(hiddenIds || []);
  const customizing = Boolean(customizeMode) && Boolean(canCustomize);

  return (
    <aside
      className={cn(
        forceVisible ? "flex" : "hidden lg:flex",
        "flex-col bg-card border-r border-border transition-all duration-300 h-screen sticky top-0",
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
        {items.map((item, index) => {
          const Icon = navIconMap[item.id];
          const isHidden = hiddenSet.has(item.id);
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-0.5 rounded-lg",
                customizing && "bg-muted/20",
              )}
            >
              {customizing && (
                <button
                  type="button"
                  onClick={() => onMoveItem?.(item.id, "up")}
                  disabled={index === 0}
                  className="shrink-0 pl-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Move up"
                >
                  <ArrowUp className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeSection === item.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-foreground/70 hover:text-foreground hover:bg-muted",
                  isHidden && !customizing && "opacity-40",
                  collapsed && "justify-center px-0",
                )}
                title={collapsed ? item.label : undefined}
              >
                {Icon && <Icon className="size-4.5 shrink-0" />}
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
              {customizing && (
                <>
                  <button
                    type="button"
                    onClick={() => onMoveItem?.(item.id, "down")}
                    disabled={index === items.length - 1}
                    className="shrink-0 pr-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleHidden?.(item.id)}
                    className={cn(
                      "shrink-0 pr-2",
                      isHidden ? "text-success hover:text-success/80" : "text-muted-foreground hover:text-destructive",
                    )}
                    title={isHidden ? "Unhide section" : "Hide section"}
                  >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer: customize + collapse */}
      <div className="border-t border-border p-2 space-y-1">
        {customizing && (
          <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-light-text">
            <span className="truncate">Use arrows to reorder, eye to show/hide</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onResetOrder}
                className="inline-flex items-center gap-1 rounded p-1 text-light-text hover:text-foreground hover:bg-muted/40"
                title="Reset to default order"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleCustomize}
                className="inline-flex items-center gap-1 rounded p-1 text-primary hover:bg-muted/40"
                title="Done customizing"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}
        {!customizing && canCustomize && (
          <button
            type="button"
            onClick={onToggleCustomize}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="size-3.5" />
            {!collapsed && <span>Customize Menu</span>}
          </button>
        )}
        <button
          type="button"
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