"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Tag, FolderTree, Users, Truck, ShoppingCart, Receipt, Warehouse,
  Banknote, ArrowLeftRight, CreditCard, TrendingUp, Brain, Bot, BookOpen, Settings,
  CheckSquare, History, Shield, Lock, Clock, Sparkles, MessageSquare, Mic, Globe, Smartphone,
  ChevronLeft, ChevronRight, Eye, EyeOff, ArrowDown, ArrowUp, Pencil, RotateCcw, X, MapPin, Bell, Package, Rocket,
  GripVertical, FileDown, HandCoins, NotebookPen, UserCog, Map, Route,
} from "lucide-react";
import { useRef, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";
import { NAV_SECTION_GROUPS, navSectionGroupId } from "@/lib/tradeos/constants";
import { DisplayZoomControl } from "./DisplayZoomControl";
import { DASHBOARD_SECTION_DRAG_TYPE, isDashboardSectionCard } from "@/lib/dashboard/section-cards";

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
  "customer-credit": HandCoins,
  "supplier-ledger": NotebookPen,
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
  employees: UserCog,
  territories: Map,
  routes: Route,
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
  /** True while the home dashboard is in edit mode, so sections can be dragged onto it. */
  dragToDashboard?: boolean;
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
  dragToDashboard,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hiddenSet = new Set(hiddenIds || []);
  const customizing = Boolean(customizeMode) && Boolean(canCustomize);
  const displayItems = customizing ? items : items.filter((item) => !hiddenSet.has(item.id));
  // Step 4 groups: Dashboard on top with no heading, then groups in fixed
  // order. Groups with no visible items render no heading. Collapsed mode
  // hides headings entirely (icon-only rows, as before).
  const topItems = displayItems.filter((item) => item.id === "dashboard");
  const groupedItems = NAV_SECTION_GROUPS.map((group) => ({
    ...group,
    items: displayItems.filter((item) => navSectionGroupId(item.id) === group.id),
  })).filter((group) => group.items.length > 0);
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
    if (id && id !== dragId && navSectionGroupId(id as SectionId) === navSectionGroupId(dragId as SectionId)) setDropTargetId(id);
    else if (id && id !== dragId) setDropTargetId(null);
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

  const renderNavRow = (item: { id: SectionId; label: string }, groupIndex: number, groupLength: number) => {
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
          customizing && isHidden && "opacity-60",
          isDragging && "opacity-50 ring-2 ring-primary touch-none",
          isDropTarget && "border-t-2 border-primary bg-primary/10",
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
              className={cn(
                "shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing",
                forceVisible ? "flex min-h-11 min-w-11 items-center justify-center" : "pl-1",
              )}
              title="Drag to reorder"
              aria-label={`Drag to reorder ${item.label}`}
            >
              <GripVertical className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onMoveItem?.(item.id, "up")}
              disabled={groupIndex === 0}
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30",
                forceVisible && "flex min-h-11 min-w-11 items-center justify-center",
              )}
              title="Move up"
              aria-label={`Move ${item.label} up`}
            >
              <ArrowUp className="size-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onSectionChange(item.id)}
          aria-current={activeSection === item.id ? "page" : undefined}
          draggable={canDropOnDashboard(item.id)}
          onDragStart={(event) => {
            if (!canDropOnDashboard(item.id)) return;
            event.dataTransfer.setData(DASHBOARD_SECTION_DRAG_TYPE, item.id);
            event.dataTransfer.effectAllowed = "copy";
          }}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            activeSection === item.id
              ? "bg-primary text-primary-foreground font-medium"
              : "text-foreground/70 hover:text-foreground hover:bg-muted",
            canDropOnDashboard(item.id) && "cursor-grab active:cursor-grabbing",
            isHidden && !customizing && "opacity-40",
            collapsed && "justify-center px-0",
            forceVisible && "min-h-11",
          )}
          title={canDropOnDashboard(item.id) ? `${item.label} - drag onto the home dashboard to add it as a card` : collapsed ? item.label : undefined}
        >
          {Icon && <Icon className="size-4.5 shrink-0" />}
          {!collapsed && <span className="truncate">{item.label}</span>}
        </button>
        {customizing && (
          <>
            <button
              type="button"
              onClick={() => onMoveItem?.(item.id, "down")}
              disabled={groupIndex === groupLength - 1}
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30",
                forceVisible && "flex min-h-11 min-w-11 items-center justify-center",
              )}
              title="Move down"
              aria-label={`Move ${item.label} down`}
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onToggleHidden?.(item.id)}
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground",
                forceVisible ? "flex min-h-11 min-w-11 items-center justify-center" : "pr-2",
                isHidden ? "text-success hover:text-success/80" : "hover:text-destructive",
              )}
              title={isHidden ? "Unhide section" : "Hide section"}
              aria-label={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
            >
              {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </>
        )}
      </div>
    );
  };

  const canDropOnDashboard = (id: SectionId) => Boolean(dragToDashboard) && isDashboardSectionCard(id);

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
        <img
          src="/aankh-icon.svg"
          alt="AANKH logo"
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-lg"
        />
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-brand font-bold text-base text-foreground truncate">AANKH</div>
            {organizationName && (
              <div className="text-[11px] text-light-text truncate">{organizationName}</div>
            )}
          </div>
        )}
      </div>

      {/* Navigation: Dashboard on top, then Step 4 groups (always expanded). */}
      <nav data-context-help-skip={customizing ? "" : undefined} className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {topItems.map((item) => renderNavRow(item, 0, 1))}
        {groupedItems.map((group) => (
          <div key={group.id}>
            {!collapsed && (
              <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
            )}
            {group.items.map((item, groupIndex) => renderNavRow(item, groupIndex, group.items.length))}
          </div>
        ))}
        {customizing && displayItems.length === 0 && (
          <p className="px-3 py-2 text-xs text-light-text">No menu sections to show.</p>
        )}
      </nav>

      {/* Footer: customize + collapse */}
      <div className="border-t border-border p-2 space-y-1">
        {!collapsed && <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customize your workspace</p>}
        {customizing && (
          <div data-context-help-skip className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-light-text">
            <span>Drag with mouse / finger to reorder, arrows fine-tune, eye shows &amp; hides</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onResetOrder}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-light-text hover:text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8"
                title="Reset to default order"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleCustomize}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8"
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
            className={cn(
              "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors",
              forceVisible && "min-h-11",
            )}
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
