"use client";

import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeftOpen, Eye, EyeOff, ArrowDown, ArrowUp, Pencil, RotateCcw, X, GripVertical, Search, ChevronDown } from "lucide-react";
import { navIconMap } from "./navigation-icons";
import { useRef, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";
import { DisplayZoomControl } from "./DisplayZoomControl";
import { DASHBOARD_SECTION_DRAG_TYPE, isDashboardSectionCard } from "@/lib/dashboard/section-cards";
import { groupNavigationItems } from "@/lib/dashboard/navigation-groups";
import { useRegional } from "@/components/regional/RegionalProvider";
import { navigationText } from "@/lib/regional/navigation";
import { DesktopUpdates } from "@/components/branding/DesktopUpdates";

interface SidebarProps {
  items: Array<{ id: SectionId; label: string }>;
  activeSection: SectionId;
  onSectionChange: (id: SectionId) => void;
  organizationName?: string;
  userName?: string;
  onOpenAccount?: () => void;
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
  userName,
  onOpenAccount,
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
                customizing && "flex-wrap bg-panel-foreground/10",
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
    <aside className={cn(forceVisible ? "flex" : "hidden lg:flex", "aankh-sidebar shrink-0 flex-col bg-panel border-e border-nav-border text-panel-foreground transition-[width] duration-200 h-dvh sticky top-0", collapsed ? "w-[72px]" : "w-[232px]")}>
      <div className={cn("flex min-h-[72px] shrink-0 items-center gap-2 border-b border-nav-border px-3", collapsed && "justify-center")}>
        {!collapsed && <div className="flex min-w-0 flex-1 items-center gap-2">
          <img src="/aankh-app-eye.png" alt="" width={28} height={28} className="size-7 shrink-0" />
          <span className="font-brand text-base font-bold">Aankh</span>
        </div>}
        {!disableCollapse && (
          <button
            type="button"
            aria-label={collapsed ? navigationText("Expand sidebar", language) : navigationText("Collapse sidebar", language)}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-nav-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-5" /> : <PanelLeftClose aria-hidden="true" className="size-5" />}
          </button>
        )}
      </div>
      {!collapsed && organizationName && onOpenAccount && (
        <button type="button" onClick={onOpenAccount} className="mx-3 mt-3 flex min-h-14 shrink-0 items-center gap-2 rounded-lg border border-nav-input bg-nav-surface px-3 text-start text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">{Array.from(organizationName.trim())[0]?.toLocaleUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate"><bdi>{organizationName}</bdi></span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-nav-muted" />
        </button>
      )}
      {!collapsed && !customizing && <div data-context-help-skip className="px-3 pb-3 pt-4">
        <label className="relative block">
          <span className="sr-only">{navigationText('Find a page',language)}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 size-4 text-nav-muted" />
          <input type="search" value={menuSearch} onChange={event => setMenuSearch(event.target.value)} placeholder={navigationText('Search menu',language)} className="min-h-11 w-full rounded-lg border border-nav-input bg-nav-surface ps-9 pe-3 text-sm text-panel-foreground placeholder:text-nav-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark" />
        </label>
      </div>}
      <nav aria-label={navigationText('Main navigation',language)} data-context-help-skip={customizing ? "" : undefined} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {customizing || collapsed ? displayItems.map(renderItem) : groups.map(group => (
          <div key={group.label} className="aankh-nav-group border-b border-nav-border py-2 last:border-0">
            <p className="px-3 pb-1 pt-2 text-xs font-semibold text-panel-foreground">{navigationText(group.label, language)}</p>
            {group.items.map(renderItem)}
          </div>
        ))}
        {!customizing && !collapsed && groups.length === 0 && <p role="status" className="px-3 py-2 text-sm text-panel-foreground/70">{navigationText('No matching pages. Try another name.',language)}</p>}
        {customizing && displayItems.length === 0 && (
          <p className="px-3 py-2 text-xs text-panel-foreground/70">{navigationText('No menu sections to show.',language)}</p>
        )}
      </nav>

      {/* Footer: workspace utilities and desktop updater */}
      <div className="shrink-0 space-y-1 border-t border-nav-border p-2">
        {!collapsed && userName && onOpenAccount && (
          <button type="button" onClick={onOpenAccount} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-light text-primary">{Array.from(userName.trim())[0]?.toLocaleUpperCase()}</span>
            <span className="min-w-0 truncate"><bdi>{userName}</bdi></span>
          </button>
        )}
        <details open={customizing} className="sidebar-utilities">
          <summary aria-label={navigationText('Customize your workspace',language)} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm text-panel-foreground hover:bg-nav-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"><Pencil className="size-4 shrink-0" />{!collapsed && <span className="flex-1 text-xs">{navigationText('Customize your workspace',language)}</span>}<ChevronDown className="size-3" /></summary>
          <div className="mt-2 max-h-[40dvh] space-y-1 overflow-y-auto rounded-lg bg-nav-surface p-1">
        {customizing && (
          <div data-context-help-skip className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-panel-foreground/70">
            <span>{navigationText('Reorder pages within their task groups. Use the eye to show or hide a page.',language)}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onResetOrder}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-panel-foreground/70 hover:text-panel-foreground hover:bg-panel-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
                title={navigationText('Reset to default order',language)}
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleCustomize}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded p-1.5 text-primary-on-dark hover:bg-panel-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
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
          </div>
        </details>
        <DesktopUpdates surface="dashboard" collapsed={collapsed} />
      </div>
    </aside>
  );
}
