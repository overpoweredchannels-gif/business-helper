import type { SectionId } from "@/lib/tradeos/types";

export type NavigationItem = { id: SectionId; label: string };
const taskSections: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Home", ids: ["dashboard", "setup-import"] },
  { label: "Sell", ids: ["sales"] },
  { label: "Stock", ids: ["products", "inventory", "brands", "categories"] },
  { label: "Buy", ids: ["purchases", "suppliers", "supplier-ledger"] },
  { label: "Customers", ids: ["customers", "customer-credit"] },
  { label: "Money", ids: ["customer-payments", "supplier-payments", "expenses", "profit-loss"] },
  { label: "Insights", ids: ["business-intelligence", "business-records", "ai-analytics", "market-intelligence"] },
  { label: "AI", ids: ["ai-assistant", "ai-business-query", "ai-voice-operator"] },
  { label: "Team & Field", ids: ["employees", "staff-permissions", "staff-duty", "live-tracking", "territories", "routes", "task-manager", "notifications", "mobile-app"] },
  { label: "Settings", ids: ["business-settings", "activity-logs", "security-check", "deployment"] },
];

/** Presentation only: callers provide the already permission-filtered items. */
export function groupNavigationItems(items: NavigationItem[]) {
  const assigned = new Set<SectionId>(taskSections.flatMap(group => group.ids));
  return [
    ...taskSections.map(group => ({ label: group.label, items: items.filter(item => group.ids.includes(item.id)) })),
    { label: "More", items: items.filter(item => !assigned.has(item.id)) },
  ].filter(group => group.items.length > 0);
}
