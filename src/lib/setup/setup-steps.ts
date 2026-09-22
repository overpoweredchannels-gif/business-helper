import type { SectionId } from "@/lib/tradeos/types";

/** The recommended setup checklist shown in Setup & Data Import. */
export const SETUP_STEPS: { title: string; description: string; section: SectionId; entities: string[]; optional?: boolean }[] = [
  { title: "Business settings and units", description: "Check your business details, currency and invoice preferences. Decide how you buy and sell: for example, one box contains 12 pieces.", section: "business-settings", entities: [] },
  { title: "Brands and categories", description: "Organize your catalog. Use consistent names so imported products link to the correct brand and category.", section: "brands", entities: ["brands", "categories"] },
  { title: "Customers and suppliers", description: "Add the people you sell to and buy from before importing transactions. Use unique names and contact details. Customer assignment is optional; importing employees does not create login accounts.", section: "customers", entities: ["customers", "suppliers"] },
  { title: "Products and opening stock", description: "Add product names, units, pack sizes and prices. Opening stock is the quantity on your chosen start date. Review reorder levels, barcode, batch and expiry settings before selling.", section: "products", entities: ["products"] },
  { title: "Historical data archive", description: "Optional: search older sales, purchases and payments in the Historical Data Hub without forcing a mapping step. This archive stays read-only, does not change stock or balances, and is meant for review by date, customer, invoice number or product keyword.", section: "sales", entities: [], optional: true },
  { title: "Team and final review", description: "Optional: import your team, territories and routes. Invite employees and assign permissions separately. Check stock, balances and a sample invoice before starting daily work.", section: "staff-permissions", entities: ["employees", "staff", "territories", "routes"], optional: true },
];
