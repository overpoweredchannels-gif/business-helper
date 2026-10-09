import type { SectionId } from "@/lib/tradeos/types";

export type NavigationItem = { id: SectionId; label: string };
const taskSections: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Sell", ids: ["sales"] },
  { label: "Stock", ids: ["products", "inventory", "brands", "categories"] },
  { label: "Buy", ids: ["purchases", "suppliers", "supplier-ledger"] },
  { label: "Customers", ids: ["customers", "customer-credit"] },
  { label: "Money", ids: ["customer-payments", "supplier-payments", "expenses", "profit-loss"] },
];

/** Presentation only: callers provide the already permission-filtered items. */
export function groupNavigationItems(items: NavigationItem[]) {
  const assigned = new Set<SectionId>(["dashboard", ...taskSections.flatMap(group => group.ids)]);
  return [
    { label: "Home", items: items.filter(item => item.id === "dashboard") },
    ...taskSections.map(group => ({ label: group.label, items: items.filter(item => group.ids.includes(item.id)) })),
    { label: "More", items: items.filter(item => !assigned.has(item.id)) },
  ].filter(group => group.items.length > 0);
}
