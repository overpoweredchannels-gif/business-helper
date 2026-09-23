import {
  dashboardSectionFromWidgetId,
  normalizeSectionCards,
  type DashboardSectionWidgetId,
} from "@/lib/dashboard/section-cards";
import type { SectionId } from "@/lib/tradeos/types";

/**
 * The home dashboard is a user-owned layout: every card can be removed from the
 * dashboard and restored later. Hidden cards never lose their data - the same
 * information stays reachable from the sidebar section named in `whereToFind`.
 */
export type DashboardWidgetId =
  | "greeting"
  | "setup-import"
  | "quick-sale"
  | "business-records-export"
  | "kpi-today-sales"
  | "kpi-today-profit"
  | "kpi-inventory-value"
  | "kpi-receivables"
  | "kpi-payables"
  | "kpi-low-stock"
  | "kpi-approvals"
  | "kpi-orders-today"
  | "kpi-customers-today"
  | "ai-insight"
  | "business-health"
  | "quick-actions"
  | "smart-modules"
  | "needs-attention"
  | "chart-revenue"
  | "chart-profit"
  | "chart-top-products"
  | "chart-top-customers"
  | "recent-activity"
  | DashboardSectionWidgetId;

export type DashboardWidgetGroup = "Header" | "Key numbers" | "Insight and actions" | "Activity";

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  label: string;
  description: string;
  group: DashboardWidgetGroup;
  /** Sidebar section that still reaches this information once the card is removed. */
  whereToFind: string;
}

export const DASHBOARD_WIDGET_GROUPS: DashboardWidgetGroup[] = ["Header", "Key numbers", "Insight and actions", "Activity"];

export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
  { id: "greeting", label: "Greeting", description: "Your name and today's date.", group: "Header", whereToFind: "always shown at the top of the dashboard" },
  { id: "setup-import", label: "Setup & Data Import", description: "The guided checklist for getting your business ready.", group: "Header", whereToFind: "Setup & Data Import" },
  { id: "quick-sale", label: "Quick sale", description: "One-tap shortcut into Retail POS and sales invoicing.", group: "Header", whereToFind: "Sales" },
  { id: "business-records-export", label: "Export business records", description: "Save a dated PDF of transactions, payments and stock movement.", group: "Header", whereToFind: "Export Business Records" },
  { id: "kpi-today-sales", label: "Today's Sales", description: "Sales total for today.", group: "Key numbers", whereToFind: "Sales" },
  { id: "kpi-today-profit", label: "Today's Profit", description: "Estimated profit for today.", group: "Key numbers", whereToFind: "Profit & Loss" },
  { id: "kpi-inventory-value", label: "Inventory Value", description: "Value of the stock you are holding.", group: "Key numbers", whereToFind: "Inventory" },
  { id: "kpi-receivables", label: "Outstanding Receivables", description: "Money customers still owe you.", group: "Key numbers", whereToFind: "Customer Payments" },
  { id: "kpi-payables", label: "Outstanding Payables", description: "Money you still owe suppliers.", group: "Key numbers", whereToFind: "Supplier Payments" },
  { id: "kpi-low-stock", label: "Low Stock Alerts", description: "How many products need reordering.", group: "Key numbers", whereToFind: "Inventory" },
  { id: "kpi-approvals", label: "Pending Approvals", description: "Staff sales waiting for your approval.", group: "Key numbers", whereToFind: "Sales" },
  { id: "kpi-orders-today", label: "Orders Today", description: "Orders booked today.", group: "Key numbers", whereToFind: "Sales" },
  { id: "kpi-customers-today", label: "Customers Today", description: "Customers you sold to today.", group: "Key numbers", whereToFind: "Customers" },
  { id: "ai-insight", label: "AI recommendation", description: "The latest alert with a suggested action.", group: "Insight and actions", whereToFind: "AI Assistant" },
  { id: "business-health", label: "Business Health", description: "Cash flow, stock and margin health score.", group: "Insight and actions", whereToFind: "Business Intelligence" },
  { id: "quick-actions", label: "Quick actions", description: "Shortcuts for common daily tasks.", group: "Insight and actions", whereToFind: "the sidebar sections each action opens" },
  { id: "smart-modules", label: "Business Overview", description: "Products, customers, suppliers, sales, purchases and inventory summaries.", group: "Insight and actions", whereToFind: "Products, Customers, Suppliers, Sales, Purchases and Inventory" },
  { id: "needs-attention", label: "Needs Your Attention", description: "Invoices due, payments due, follow-ups and expiring products.", group: "Insight and actions", whereToFind: "Task Manager" },
  { id: "chart-revenue", label: "Revenue Trend", description: "Sales over your recent periods.", group: "Activity", whereToFind: "Business Intelligence" },
  { id: "chart-profit", label: "Profit Trend", description: "Estimated profit over your recent periods.", group: "Activity", whereToFind: "Profit & Loss" },
  { id: "chart-top-products", label: "Top Products", description: "Your best selling products.", group: "Activity", whereToFind: "Products" },
  { id: "chart-top-customers", label: "Top Customers", description: "The customers buying the most.", group: "Activity", whereToFind: "Customers" },
  { id: "recent-activity", label: "Recent activity", description: "Your latest sales and purchases.", group: "Activity", whereToFind: "Activity Logs" },
];

export const DASHBOARD_WIDGETS_STORAGE_PREFIX = "tradeos_dashboard_widgets_";
export const DASHBOARD_WIDGETS_CHANGE_EVENT = "tradeos:dashboard-widgets-change";

/** Folded banners from the earlier release are treated as removed cards. */
const LEGACY_BANNER_STORAGE_PREFIX = "tradeos_dashboard_banners_";
const LEGACY_BANNER_WIDGET_IDS: DashboardWidgetId[] = ["greeting", "setup-import", "quick-sale", "business-records-export"];

/** Cards that used to be grouped and are now separate, so an existing choice still applies. */
const LEGACY_WIDGET_ALIASES: Record<string, DashboardWidgetId[]> = {
  charts: ["chart-revenue", "chart-profit", "chart-top-products", "chart-top-customers"],
};

const WIDGET_IDS = new Set<string>(DASHBOARD_WIDGETS.map((widget) => widget.id));

export interface DashboardWidgetPrefs {
  hidden: DashboardWidgetId[];
  /** Sidebar sections the user dropped onto the dashboard as summary cards. */
  added: SectionId[];
}

export function dashboardWidgetsStorageKey(profileId?: string | null) {
  return `${DASHBOARD_WIDGETS_STORAGE_PREFIX}${profileId ?? "anon"}`;
}

export function normalizeHiddenWidgets(value: unknown): DashboardWidgetId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<DashboardWidgetId>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (WIDGET_IDS.has(entry)) seen.add(entry as DashboardWidgetId);
    else for (const replacement of LEGACY_WIDGET_ALIASES[entry] ?? []) seen.add(replacement);
  }
  return DASHBOARD_WIDGETS.filter((widget) => seen.has(widget.id)).map((widget) => widget.id);
}

function readLegacyHiddenWidgets(profileId?: string | null): DashboardWidgetId[] {
  try {
    const raw = localStorage.getItem(`${LEGACY_BANNER_STORAGE_PREFIX}${profileId ?? "anon"}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const collapsed = parsed as Record<string, unknown>;
    return LEGACY_BANNER_WIDGET_IDS.filter((id) => collapsed[id] === true);
  } catch {
    return [];
  }
}

export function readDashboardWidgetPrefs(profileId?: string | null): DashboardWidgetPrefs {
  try {
    const raw = localStorage.getItem(dashboardWidgetsStorageKey(profileId));
    if (!raw) return { hidden: readLegacyHiddenWidgets(profileId), added: [] };
    const parsed = JSON.parse(raw) as { hidden?: unknown; added?: unknown };
    return { hidden: normalizeHiddenWidgets(parsed?.hidden), added: normalizeSectionCards(parsed?.added) };
  } catch {
    return { hidden: [], added: [] };
  }
}

function publishDashboardWidgetPrefs(profileId: string | null | undefined, prefs: DashboardWidgetPrefs) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ profileId?: string | null } & DashboardWidgetPrefs>(DASHBOARD_WIDGETS_CHANGE_EVENT, { detail: { profileId, ...prefs } }));
}

export function writeDashboardWidgetPrefs(profileId: string | null | undefined, prefs: DashboardWidgetPrefs): DashboardWidgetPrefs {
  const next: DashboardWidgetPrefs = { hidden: normalizeHiddenWidgets(prefs.hidden), added: normalizeSectionCards(prefs.added) };
  try {
    localStorage.setItem(dashboardWidgetsStorageKey(profileId), JSON.stringify(next));
  } catch {
    // Browser storage may be unavailable; the layout still applies to this session.
  }
  publishDashboardWidgetPrefs(profileId, next);
  return next;
}

export function setDashboardWidgetHidden(profileId: string | null | undefined, id: DashboardWidgetId, hidden: boolean): DashboardWidgetPrefs {
  const current = readDashboardWidgetPrefs(profileId);
  const next = hidden ? [...current.hidden, id] : current.hidden.filter((entry) => entry !== id);
  return writeDashboardWidgetPrefs(profileId, { hidden: next, added: current.added });
}

/** Reset restores the cards that ship with the dashboard; dropped cards stay. */
export function resetDashboardWidgets(profileId: string | null | undefined): DashboardWidgetPrefs {
  return writeDashboardWidgetPrefs(profileId, { hidden: [], added: readDashboardWidgetPrefs(profileId).added });
}

export function addDashboardSectionCard(profileId: string | null | undefined, section: SectionId): DashboardWidgetPrefs {
  const current = readDashboardWidgetPrefs(profileId);
  return writeDashboardWidgetPrefs(profileId, { hidden: current.hidden, added: [...current.added, section] });
}

export function removeDashboardSectionCard(profileId: string | null | undefined, section: SectionId): DashboardWidgetPrefs {
  const current = readDashboardWidgetPrefs(profileId);
  return writeDashboardWidgetPrefs(profileId, { hidden: current.hidden, added: current.added.filter((entry) => entry !== section) });
}

/** Routes a removal from any card, whether it ships with the dashboard or was dropped on. */
export function removeDashboardWidget(profileId: string | null | undefined, id: DashboardWidgetId): DashboardWidgetPrefs {
  const section = dashboardSectionFromWidgetId(id);
  return section ? removeDashboardSectionCard(profileId, section) : setDashboardWidgetHidden(profileId, id, true);
}

export function isDashboardWidgetHidden(prefs: DashboardWidgetPrefs | undefined, id: DashboardWidgetId) {
  return Boolean(prefs?.hidden.includes(id));
}

export function dashboardWidgetDefinition(id: DashboardWidgetId) {
  return DASHBOARD_WIDGETS.find((widget) => widget.id === id);
}

export function removedDashboardWidgets(hidden: DashboardWidgetId[]) {
  const hiddenSet = new Set(hidden);
  return DASHBOARD_WIDGETS.filter((widget) => hiddenSet.has(widget.id));
}
