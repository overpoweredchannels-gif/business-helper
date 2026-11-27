import { rankVisibleAiAlerts } from "../ai/ai-alert-presentation";
import type { AiAlert, NotificationItem } from "../tradeos/types";

export const BELL_NOTIFICATION_LIMIT = 12;

export type VisibleNotification = Pick<NotificationItem,
  "category" | "title" | "body" | "entity_id" | "is_read"
> & {
  id: string;
  source: "notification" | "ai_alert" | "derived_low_stock";
  notificationId?: string;
  created_at: string | null;
  severity: "info" | "warning" | "critical";
};

// Preserve source grouping: database notifications newest first, then
// active AI alerts by severity and recency, then the stock rollup.
// Current notification writers emit workflow events. The stock rollup
// is an inventory count, while inventory alerts name distinct products.
export function getVisibleNotifications(input: {
  realNotifications: readonly NotificationItem[];
  aiAlerts: readonly AiAlert[];
  lowStock: { productIds: readonly (string | number)[]; title: string; description: string };
  readDerivedIds?: ReadonlySet<string>;
}): VisibleNotification[] {
  const { realNotifications, aiAlerts, lowStock, readDerivedIds } = input;
  const rows = [...realNotifications]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map<VisibleNotification>((row) => ({
      id: `notification:${row.id}`,
      source: "notification",
      notificationId: row.id,
      title: row.title,
      body: row.body,
      category: row.category,
      entity_id: row.entity_id,
      created_at: row.created_at,
      severity: row.category === "draft_sale" || row.category === "inventory" ? "warning" : "info",
      is_read: row.is_read,
    }));
  const alerts = rankVisibleAiAlerts(aiAlerts).map<VisibleNotification>((alert) => {
    const id = `ai_alert:${alert.id}`;
    return {
      id, source: "ai_alert", title: alert.title, body: alert.summary, entity_id: null,
      category: alert.alert_type === "inventory" ? "inventory" : "general",
      severity: alert.severity === "critical" ? "critical"
        : ["high", "warning", "medium"].includes(alert.severity) ? "warning" : "info",
      created_at: alert.created_at,
      is_read: readDerivedIds?.has(id) ?? false,
    };
  });
  if (lowStock.productIds.length === 0) return [...rows, ...alerts];
  const id = `derived_low_stock:${JSON.stringify(lowStock.productIds.map(String).sort())}`;
  return [...rows, ...alerts, {
    id, source: "derived_low_stock", title: lowStock.title, body: lowStock.description,
    category: "inventory", entity_id: null, created_at: null,
    severity: lowStock.productIds.length > 5 ? "critical" : "warning",
    is_read: readDerivedIds?.has(id) ?? false,
  }];
}
