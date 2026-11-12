// Suppliers list export: build the CSV rows for the suppliers the list shows.
//
// The columns mirror the suppliers list row-for-row (name, contact, phone,
// city, outstanding, last purchase, credit summary) plus a Status column
// for the Archived badge the list renders on inactive rows. Headers are
// hardcoded English, like every other CSV export in the app
// (handleExportSupplierBalancesCsv, handleExportCustomerBalancesCsv,
// handleExportInventoryCsv — all via downloadCsv in
// src/lib/tradeos/formatters.ts). Outstanding is a raw number, like the
// balances exports; the last-purchase date and the credit summary are the
// list's own displayed values, passed in as callbacks so this helper stays
// pure and testable without the page's translation hook.
//
// The list does NOT display the supplier's area (the form captures it and
// the record stores it, but no list row renders it), so the export does
// not invent an Area column — it exports exactly what the list shows.
import { safeNumber } from "@/lib/tradeos/validators";
import type { Supplier } from "@/lib/tradeos/types";

export type SupplierExportOptions = {
  /** Label for a missing value, e.g. t('common.none'). */
  noneLabel: string;
  /** Formats a last-purchase date the way the list displays it. */
  formatDate: (value: string) => string;
  /** The list's one-line credit summary for a supplier. */
  creditSummary: (supplier: Supplier) => string;
};

export const buildSupplierExportRows = (
  suppliers: Supplier[],
  options: SupplierExportOptions,
): Array<Record<string, unknown>> =>
  suppliers.map((supplier) => ({
    "Supplier Name": supplier.supplier_name,
    "Contact Person": supplier.contact_person ?? options.noneLabel,
    Phone: supplier.phone ?? options.noneLabel,
    City: supplier.city ?? options.noneLabel,
    "Outstanding Balance": safeNumber(supplier.outstanding_balance ?? 0),
    "Last Purchase": supplier.last_purchase_date
      ? options.formatDate(supplier.last_purchase_date)
      : options.noneLabel,
    Credit: options.creditSummary(supplier),
    Status: supplier.is_active === false ? "Archived" : "Active",
  }));
