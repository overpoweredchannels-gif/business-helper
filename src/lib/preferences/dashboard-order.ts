import { DASHBOARD_WIDGETS, type DashboardWidgetId } from "./dashboard-widgets";
import { dashboardSectionFromWidgetId } from "@/lib/dashboard/section-cards";

const preferredOrder: DashboardWidgetId[] = [
  "setup-import", "quick-actions",
  "kpi-today-sales", "kpi-today-profit", "kpi-inventory-value", "kpi-receivables", "kpi-payables", "kpi-low-stock",
  "quick-sale", "business-records-export", "needs-attention", "chart-revenue", "chart-profit", "chart-top-products", "chart-top-customers",
  "recent-activity", "ai-insight", "business-health", "smart-modules",
  ...DASHBOARD_WIDGETS.map(widget => widget.id),
];
export const DEFAULT_DASHBOARD_ORDER = [...new Set(preferredOrder)];

export function normalizeDashboardOrder(value: unknown): DashboardWidgetId[] {
  const valid = new Set<string>(DASHBOARD_WIDGETS.map(widget => widget.id));
  const incoming = Array.isArray(value) ? value.filter((id): id is DashboardWidgetId => typeof id === "string" && (valid.has(id) || dashboardSectionFromWidgetId(id) !== null)) : [];
  return [...new Set([...incoming, ...DEFAULT_DASHBOARD_ORDER])];
}

/** Move against visible neighbors, keeping the positions of hidden cards intact. */
export function moveDashboardWidget(order: DashboardWidgetId[], id: DashboardWidgetId, direction: "up" | "down", visible: DashboardWidgetId[]): DashboardWidgetId[] {
  const next = normalizeDashboardOrder([...order, ...visible]);
  const index = visible.indexOf(id);
  if (index < 0) return next;
  const neighbor = visible[index + (direction === "up" ? -1 : 1)];
  if (!neighbor) return next;
  const from = next.indexOf(id), to = next.indexOf(neighbor);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export const dashboardOrderKey = (profileId?: string | null) => `aankh_dashboard_order_${profileId ?? "anon"}`;
export function readDashboardOrder(profileId?: string | null): DashboardWidgetId[] {
  try { return normalizeDashboardOrder(JSON.parse(localStorage.getItem(dashboardOrderKey(profileId)) ?? "null")); }
  catch { return normalizeDashboardOrder(null); }
}

export function saveDashboardOrder(profileId: string | null | undefined, order: DashboardWidgetId[]): DashboardWidgetId[] {
  const next = normalizeDashboardOrder(order);
  try { localStorage.setItem(dashboardOrderKey(profileId), JSON.stringify(next)); } catch { /* Session layout still works without storage. */ }
  return next;
}
