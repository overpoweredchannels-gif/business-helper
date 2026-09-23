import type { SectionId } from "@/lib/tradeos/types";

/** Drag payload used when a sidebar section is dropped onto the home dashboard. */
export const DASHBOARD_SECTION_DRAG_TYPE = "application/x-tradeos-section";

/** A sidebar section that can be dropped on the home dashboard as a summary card. */
export type DashboardSectionWidgetId = `section:${SectionId}`;

export interface DashboardSectionCardDefinition {
  section: SectionId;
  label: string;
  description: string;
}

export const DASHBOARD_SECTION_CARDS: DashboardSectionCardDefinition[] = [
  { section: "sales", label: "Sales", description: "Latest sales invoices with customer and amount." },
  { section: "purchases", label: "Purchases", description: "Latest supplier bills with amount." },
  { section: "customer-payments", label: "Customer Payments", description: "Money received from customers." },
  { section: "supplier-payments", label: "Supplier Payments", description: "Money paid out to suppliers." },
  { section: "expenses", label: "Expenses", description: "What the business has spent." },
  { section: "customers", label: "Customers", description: "Customer count and the newest names." },
  { section: "suppliers", label: "Suppliers", description: "Supplier count and what you still owe." },
  { section: "products", label: "Products", description: "Catalogue size and stock attention." },
  { section: "brands", label: "Brands", description: "How your catalogue splits by brand." },
  { section: "categories", label: "Categories", description: "How your catalogue splits by category." },
  { section: "inventory", label: "Inventory", description: "Stock value, low stock and out of stock." },
  { section: "task-manager", label: "Task Manager", description: "Open work and anything overdue." },
  { section: "activity-logs", label: "Activity Logs", description: "The most recent recorded actions." },
];

const SECTION_IDS = new Set<string>(DASHBOARD_SECTION_CARDS.map((card) => card.section));

export function dashboardSectionWidgetId(section: SectionId): DashboardSectionWidgetId {
  return `section:${section}`;
}

export function dashboardSectionFromWidgetId(id: string): SectionId | null {
  return id.startsWith("section:") && SECTION_IDS.has(id.slice("section:".length)) ? (id.slice("section:".length) as SectionId) : null;
}

export function isDashboardSectionCard(value: unknown): value is SectionId {
  return typeof value === "string" && SECTION_IDS.has(value);
}

export function normalizeSectionCards(value: unknown): SectionId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: SectionId[] = [];
  for (const entry of value) {
    if (!isDashboardSectionCard(entry) || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

export function dashboardSectionCardDefinition(section: SectionId) {
  return DASHBOARD_SECTION_CARDS.find((card) => card.section === section);
}

export function availableSectionCards(added: SectionId[]) {
  const addedSet = new Set(added);
  return DASHBOARD_SECTION_CARDS.filter((card) => !addedSet.has(card.section));
}
