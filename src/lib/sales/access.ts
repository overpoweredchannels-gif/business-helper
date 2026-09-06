export const salesTools = [
  { id: "invoice", label: "Create Sales Invoice" },
  { id: "history", label: "Sales Invoice Ledger" },
  { id: "orders", label: "Sales Orders" },
  { id: "returns", label: "Sales Returns" },
  { id: "report", label: "Sales Report" },
  { id: "loadform", label: "Load Form" },
  { id: "invoices", label: "Invoice Generator" },
] as const;
export type SalesTool = typeof salesTools[number]["id"];
export type SalesAccess = { role?: string | null; granted_sections?: string[] | null; can_create_sales?: boolean | null };
export function hasSalesTool(access: SalesAccess, tool: SalesTool): boolean {
  if (access.role === "owner" || access.role === "admin") return true;
  const grants = access.granted_sections ?? [];
  const hasSales = grants.length ? grants.includes("sales") : access.can_create_sales === true;
  if (!hasSales) return false;
  if (grants.includes("sales:configured")) return grants.includes(`sales:${tool}`);
  // Existing broad Sales grants become the simple invoice workspace.
  return tool === "invoice" || tool === "history";
}
export function configureSalesTools(grants: string[]): string[] {
  if (!grants.includes("sales") || grants.includes("sales:configured")) return grants;
  return [...grants, "sales:configured", "sales:invoice", "sales:history"];
}
export function canViewAllSales(role?: string | null): boolean {
  return role === "owner" || role === "admin";
}
