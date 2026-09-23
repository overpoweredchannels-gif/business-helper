"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Tag, FolderTree, Users, Truck, ShoppingCart, Receipt, Warehouse,
  Banknote, ArrowLeftRight, CreditCard, TrendingUp, Brain, Bot, BookOpen, Settings,
  CheckSquare, History, Shield, Lock, Clock, Sparkles, MessageSquare, Mic, Globe, Smartphone,
  ChevronLeft, ChevronRight, Eye, EyeOff, ArrowDown, ArrowUp, Pencil, RotateCcw, X, MapPin, Bell, Package, Rocket,
  GripVertical, FileDown,
} from "lucide-react";
import { useRef, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";
import { DisplayZoomControl } from "./DisplayZoomControl";

const navIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  "setup-import": BookOpen,
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
  "business-records": FileDown,
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
  onDropItem?: (id: string, targetId: string) => void;
  onToggleHidden?: (id: string) => void;
  onResetOrder?: () => void;
  disableCollapse?: boolean;
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
  onDropItem,
  onToggleHidden,
  onResetOrder,
  disableCollapse,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hiddenSet = new Set(hiddenIds || []);
  const customizing = Boolean(customizeMode) && Boolean(canCustomize);
  const displayItems = customizing ? items : items.filter((item) => !hiddenSet.has(item.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragPointerStart = useRef<number | null>(null);

  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (!customizing) return;
    e.preventDefault();
    dragPointerStart.current = e.pointerId;
    if ((e.currentTarget as Element).setPointerCapture) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    setDragId(id);
    setDropTargetId(null);
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragId || e.pointerId !== dragPointerStart.current) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const row = hit?.closest?.("[data-nav-id]") as HTMLElement | null;
    const id = row?.getAttribute("data-nav-id");
    if (id && id !== dragId) setDropTargetId(id);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragId || e.pointerId !== dragPointerStart.current) return;
    const fromId = dragId;
    const targetId = dropTargetId;
    setDragId(null);
    setDropTargetId(null);
    dragPointerStart.current = null;
    if (fromId && targetId && targetId !== fromId) {
      onDropItem?.(fromId, targetId);
    }
  };

  return (
    <aside
      className={cn(
        forceVisible ? "flex" : "hidden lg:flex",
        "shrink-0 flex-col bg-card border-r border-border transition-all duration-300 h-dvh sticky top-0",
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
      <nav data-context-help-skip={customizing ? "" : undefined} className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {displayItems.map((item, index) => {
          const Icon = navIconMap[item.id];
          const isHidden = hiddenSet.has(item.id);
          const isDragging = dragId === item.id;
          const isDropTarget = dropTargetId === item.id;
          return (
            <div
              key={item.id}
              data-nav-id={item.id}
              className={cn(
                "flex items-center gap-0.5 rounded-lg",
                customizing && "bg-muted/20",
                isDragging && "opacity-50 ring-2 ring-primary touch-none",
                isDropTarget && "border-t-2 border-primary",
              )}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {customizing && (
                <>
                  <button
                    type="button"
                    onPointerDown={(e) => startDrag(e, item.id)}
                    className="shrink-0 cursor-grab touch-none pl-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveItem?.(item.id, "up")}
                    disabled={index === 0}
                    className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                </>
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
                    disabled={index === displayItems.length - 1}
                    className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
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
        {customizing && displayItems.length === 0 && (
          <p className="px-3 py-2 text-xs text-light-text">No menu sections to show.</p>
        )}
      </nav>

      {/* Footer: customize + collapse */}
      <div className="border-t border-border p-2 space-y-1">
        {!collapsed && <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customize your workspace</p>}
        {customizing && (
          <div data-context-help-skip className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-light-text">
            <span className="truncate">Drag with mouse / finger to reorder, arrows fine-tune, eye shows &amp; hides</span>
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
            onClick={() => { setCollapsed(false); onToggleCustomize?.(); }}
            aria-label="Reorder or hide menu sections"
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="size-3.5" />
            {!collapsed && <span>Reorder / hide sections</span>}
          </button>
        )}
        <DisplayZoomControl collapsed={collapsed} />
        <div data-workspace-help-slot data-workspace-help-compact={collapsed ? "" : undefined} className="space-y-2 px-1 py-2" />
        {!disableCollapse && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && !forceVisible && <span>Collapse</span>}
        </button>
        )}
      </div>
    </aside>
  );
}
