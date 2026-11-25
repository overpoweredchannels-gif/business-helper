// Suppliers list export: build the CSV rows for the suppliers the list shows.
//
// The columns mirror the suppliers list row-for-row (name, contact, phone,
// city, area, outstanding, last purchase, credit summary, over-limit flags)
// plus a Status column for the Archived badge the list renders on inactive
// rows. Headers are hardcoded English, like every other CSV export in the
// app (handleExportSupplierBalancesCsv, handleExportCustomerBalancesCsv,
// handleExportInventoryCsv — all via downloadCsv in
// src/lib/tradeos/formatters.ts). Outstanding is a raw number, like the
// balances exports; the last-purchase date, the credit summary and the
// over-limit summary are the list's own displayed values, passed in as
// callbacks so this helper stays pure and testable without the page's
// translation hook.
import { safeNumber } from "@/lib/tradeos/validators";
import type { Supplier } from "@/lib/tradeos/types";

export type SupplierExportOptions = {
  /** Label for a missing value, e.g. t('common.none'). */
  noneLabel: string;
  /** Formats a last-purchase date the way the list displays it. */
  formatDate: (value: string) => string;
  /** The list's one-line credit summary for a supplier. */
  creditSummary: (supplier: Supplier) => string;
  /** The list's over-limit flags line for a supplier. */
  overLimitSummary: (supplier: Supplier) => string;
  /** Cash vs credit (2026-11-25): the engine's per-supplier remaining
   * payable, the same values the list renders. When given, the export
   * reads it — never the dead suppliers.outstanding_balance column
   * (always 0.00) — so the list and the export can never drift apart.
   * When omitted, the stored column is used as before. */
  outstandingBySupplierId?: Record<string, number>;
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
    Area: supplier.area ?? options.noneLabel,
    "Outstanding Balance":
      options.outstandingBySupplierId?.[supplier.id] !== undefined
        ? safeNumber(options.outstandingBySupplierId[supplier.id])
        : safeNumber(supplier.outstanding_balance ?? 0),
    "Last Purchase": supplier.last_purchase_date
      ? options.formatDate(supplier.last_purchase_date)
      : options.noneLabel,
    Credit: options.creditSummary(supplier),
    "Over-limit": options.overLimitSummary(supplier),
    Status: supplier.is_active === false ? "Archived" : "Active",
  }));
