"use client";

import { cn } from "@/lib/utils";
import { FolderTree, Users, ShoppingCart, Receipt, Banknote, Package, ChevronLeft, ChevronRight, Eye, EyeOff, ArrowDown, ArrowUp, Pencil, RotateCcw, X, GripVertical, Search, ChevronDown, MoreHorizontal } from "lucide-react";
import { navIconMap } from "./navigation-icons";
import { useRef, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";
import { DisplayZoomControl } from "./DisplayZoomControl";
import { DASHBOARD_SECTION_DRAG_TYPE, isDashboardSectionCard } from "@/lib/dashboard/section-cards";
import { groupNavigationItems } from "@/lib/dashboard/navigation-groups";
import { useRegional } from "@/components/regional/RegionalProvider";
import { navigationText } from "@/lib/regional/navigation";

const groupIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Sell: Receipt, Stock: Package, Buy: ShoppingCart, Customers: Users,
  Money: Banknote, More: MoreHorizontal,
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
  const {language}=useRegional();
  const [collapsed, setCollapsed] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
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

  const canDropOnDashboard = (id: SectionId) => Boolean(dragToDashboard) && isDashboardSectionCard(id);
  const renderItem = (item: SidebarProps["items"][number], index: number) => {
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
                customizing && "bg-panel-foreground/10",
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
                    className="min-h-11 min-w-11 shrink-0 cursor-grab touch-none rounded-md text-nav-muted hover:text-panel-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
                    title={navigationText('Drag to reorder',language)}
                  >
                    <GripVertical className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveItem?.(item.id, "up")}
                    disabled={index === 0}
                    className="min-h-11 min-w-11 shrink-0 rounded-md text-nav-muted hover:text-panel-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
                    title={navigationText('Move up',language)}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={item.label}
                aria-current={activeSection === item.id ? "page" : undefined}
                onClick={() => onSectionChange(item.id)}
                draggable={canDropOnDashboard(item.id)}
                onDragStart={(event) => {
                  if (!canDropOnDashboard(item.id)) return;
                  event.dataTransfer.setData(DASHBOARD_SECTION_DRAG_TYPE, item.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className={cn(
                  "aankh-nav-item min-h-11 w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark",
                  activeSection === item.id
                    ? "bg-nav-active text-nav-active-foreground font-semibold"
                    : "text-nav-muted hover:text-panel-foreground hover:bg-nav-surface",
                  canDropOnDashboard(item.id) && "cursor-grab active:cursor-grabbing",
                  isHidden && !customizing && "opacity-40",
                  collapsed && "justify-center px-0",
                )}
                title={canDropOnDashboard(item.id) ? `${item.label} - ${navigationText('drag onto the home dashboard to add it as a card',language)}` : collapsed ? item.label : undefined}
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
                    className="min-h-11 min-w-11 shrink-0 rounded-md text-nav-muted hover:text-panel-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
                    title={navigationText('Move down',language)}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleHidden?.(item.id)}
                    className={cn(
                      "min-h-11 min-w-11 shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark",
                      isHidden ? "text-success hover:text-success/80" : "text-panel-foreground/70 hover:text-destructive",
                    )}
                    title={isHidden ? navigationText('Unhide section',language) : navigationText('Hide section',language)}
                  >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </>
              )}
            </div>
          );
  };
  const query = menuSearch.trim().toLocaleLowerCase();
  const groups = groupNavigationItems(displayItems)
    .map(group => ({ ...group, items: group.items.filter(item => !query || navigationText(group.label,language).toLocaleLowerCase().includes(query) || item.label.toLocaleLowerCase().includes(query)) }))
    .filter(group => group.items.length > 0);

  return (
    <aside className={cn(forceVisible ? "flex" : "hidden lg:flex", "aankh-sidebar shrink-0 flex-col bg-panel border-e border-nav-border text-panel-foreground transition-[width] duration-200 h-dvh sticky top-0", collapsed ? "w-[72px]" : "w-[248px]")}>
      <div className={cn("border-b border-nav-border flex min-h-20 items-center gap-3 px-5", collapsed ? "justify-center py-4" : "py-5")}>
        <img src="/aankh-app-eye.png" alt="Aankh logo" width={32} height={32} className="size-8 shrink-0 rounded-lg" />
        {!collapsed && <div className="min-w-0"><div className="font-brand font-bold text-base text-panel-foreground truncate">Aankh</div>{organizationName && <div className="text-[11px] text-panel-foreground/70 truncate">{organizationName}</div>}</div>}
      </div>
      {!collapsed && !customizing && <div data-context-help-skip className="px-3 pb-3 pt-4">
        <label className="relative block">
          <span className="sr-only">{navigationText('Find a page',language)}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 size-4 text-nav-muted" />
          <input type="search" value={menuSearch} onChange={event => setMenuSearch(event.target.value)} placeholder={navigationText('Search menu',language)} className="min-h-11 w-full rounded-lg border border-nav-input bg-nav-surface ps-9 pe-3 text-sm text-panel-foreground placeholder:text-nav-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark" />
        </label>
      </div>}
      <nav aria-label={navigationText('Main navigation',language)} data-context-help-skip={customizing ? "" : undefined} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {customizing || collapsed ? displayItems.map(renderItem) : groups.map(group => group.label === "Home"
          ? group.items.map(renderItem)
          : <details key={`${group.label}:${query ? "search" : "browse"}`} open={Boolean(query) || group.items.some(item => item.id === activeSection)} className="aankh-nav-group rounded-lg">
            <summary data-context-help-skip className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-nav-muted hover:bg-nav-surface hover:text-panel-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark">
              {(() => { const GroupIcon = groupIcons[group.label] ?? FolderTree; return <GroupIcon aria-hidden="true" className="size-[18px] shrink-0" />; })()}
              <span className="flex-1">{navigationText(group.label,language)}</span>
              <ChevronDown aria-hidden="true" className="aankh-nav-chevron size-3.5 shrink-0" />
            </summary>
            <div className="ms-5 mt-1 space-y-1 border-s border-nav-border ps-2">{group.items.map(renderItem)}</div>
          </details>)}
        {!customizing && !collapsed && groups.length === 0 && <p role="status" className="px-3 py-2 text-sm text-panel-foreground/70">{navigationText('No matching pages. Try another name.',language)}</p>}
        {customizing && displayItems.length === 0 && (
          <p className="px-3 py-2 text-xs text-panel-foreground/70">{navigationText('No menu sections to show.',language)}</p>
        )}
      </nav>

      {/* Footer: customize + collapse */}
      <div className="border-t border-nav-border p-3 space-y-1">
        {!collapsed && <p className="px-2 py-2 text-[11px] font-medium text-nav-muted">{navigationText('Customize your workspace',language)}</p>}
        {customizing && (
          <div data-context-help-skip className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-panel-foreground/70">
            <span>{navigationText('Reorder pages within their task groups. Use the eye to show or hide a page.',language)}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onResetOrder}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-panel-foreground/70 hover:text-panel-foreground hover:bg-panel-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark sm:min-h-8 sm:min-w-8"
                title={navigationText('Reset to default order',language)}
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleCustomize}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-primary-on-dark hover:bg-panel-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark sm:min-h-8 sm:min-w-8"
                title={navigationText('Done customizing',language)}
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
            data-help-id="sidebar-customize"
            aria-label={navigationText('Reorder or hide menu sections',language)}
            className="min-h-11 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-nav-muted hover:text-panel-foreground hover:bg-nav-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
          >
            <Pencil className="size-3.5" />
            {!collapsed && <span>{navigationText('Reorder / hide sections',language)}</span>}
          </button>
        )}
        <DisplayZoomControl collapsed={collapsed} />
        <div data-workspace-help-slot data-workspace-help-compact={collapsed ? "" : undefined} className="space-y-2 px-1 py-2" />
        {!disableCollapse && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? navigationText('Expand sidebar',language) : navigationText('Collapse sidebar',language)}
          className="min-h-11 w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-nav-muted hover:text-panel-foreground hover:bg-nav-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && !forceVisible && <span>{navigationText('Collapse',language)}</span>}
        </button>
        )}
      </div>
    </aside>
  );
}
