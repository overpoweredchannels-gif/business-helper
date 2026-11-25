import assert from "node:assert/strict";
import { buildSupplierExportRows } from "../src/lib/suppliers/export";
import type { Supplier } from "../src/lib/tradeos/types";

// Suppliers export slice.
//
// Rule under test: the CSV rows mirror the suppliers list row-for-row —
// name, contact, phone, city, area, outstanding (raw number, like the balances
// exports), last purchase (the list's displayed date), credit summary,
// over-limit flags — plus a Status column for the Archived badge the list renders on
// inactive rows. Missing values show the list's "None" label; the export
// covers exactly the suppliers the list shows (the caller passes the
// already-filtered list), so this helper takes the array as given.

const noneLabel = "None";
const options = {
  noneLabel,
  formatDate: (value: string) => `formatted:${value}`,
  creditSummary: (supplier: Supplier) => `credit:${supplier.supplier_name}`,
  overLimitSummary: (supplier: Supplier) => `overlimit:${supplier.supplier_name}`,
};

const supplierBase: Supplier = {
  id: "s1",
  supplier_name: "Acme Traders",
  contact_person: "Ali Raza",
  phone: "03001234567",
  whatsapp: null,
  city: "Lahore",
  area: "Gulberg",
  notes: null,
  credit_limit: 50000,
  credit_days: 30,
  credit_policy: "cash_only",
  preferred_payment_method: "bank",
  allow_over_limit: false,
  allow_overdue_sales: false,
  outstanding_balance: 1234.5,
  last_purchase_date: "2026-11-10",
  deleted_at: null,
  is_active: true,
};

function main() {
  // ─── 1. Headers + full row for an active supplier ───────────────────────
  const rows = buildSupplierExportRows([supplierBase], options);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), [
    "Supplier Name",
    "Contact Person",
    "Phone",
    "City",
    "Area",
    "Outstanding Balance",
    "Last Purchase",
    "Credit",
    "Over-limit",
    "Status",
  ]);
  assert.deepEqual(rows[0], {
    "Supplier Name": "Acme Traders",
    "Contact Person": "Ali Raza",
    Phone: "03001234567",
    City: "Lahore",
    Area: "Gulberg",
    "Outstanding Balance": 1234.5,
    "Last Purchase": "formatted:2026-11-10",
    Credit: "credit:Acme Traders",
    "Over-limit": "overlimit:Acme Traders",
    Status: "Active",
  });

  // ─── 2. Missing values show the list's "None" label ─────────────────────
  const sparse = buildSupplierExportRows(
    [
      {
        ...supplierBase,
        id: "s2",
        supplier_name: "Bare Supplier",
        contact_person: null,
        phone: null,
        city: null,
        area: null,
        outstanding_balance: null,
        last_purchase_date: null,
      },
    ],
    options,
  );
  assert.deepEqual(sparse[0], {
    "Supplier Name": "Bare Supplier",
    "Contact Person": "None",
    Phone: "None",
    City: "None",
    Area: "None",
    "Outstanding Balance": 0,
    "Last Purchase": "None",
    Credit: "credit:Bare Supplier",
    "Over-limit": "overlimit:Bare Supplier",
    Status: "Active",
  });

  // ─── 3. Archived supplier carries the badge as a Status column ──────────
  const archived = buildSupplierExportRows(
    [{ ...supplierBase, id: "s3", is_active: false }],
    options,
  );
  assert.equal(archived[0]?.Status, "Archived");
  assert.equal(archived[0]?.["Supplier Name"], "Acme Traders");

  // ─── 4. Outstanding is a raw number, never a formatted money string ────
  assert.equal(typeof rows[0]?.["Outstanding Balance"], "number");

  // ─── 5. Empty list exports nothing (downloadCsv no-ops on zero rows) ────
  assert.deepEqual(buildSupplierExportRows([], options), []);

  // ─── 6. Row order follows the input order (the caller's filtered list) ──
  const ordered = buildSupplierExportRows(
    [
      { ...supplierBase, id: "s4", supplier_name: "First" },
      { ...supplierBase, id: "s5", supplier_name: "Second" },
    ],
    options,
  );
  assert.deepEqual(
    ordered.map((row) => row["Supplier Name"]),
    ["First", "Second"],
  );

  // ─── 7. Cash vs credit (2026-11-25): with outstandingBySupplierId the
  // export reads the engine's per-supplier remaining payable — the same
  // values the list renders — instead of the dead stored column. A
  // supplier whose stored column says 1234.5 but whose engine payable
  // is 0 exports 0; one the map omits falls back to the stored column.
  const engineRows = buildSupplierExportRows(
    [
      { ...supplierBase, id: "s6", supplier_name: "Engine Zero" },
      { ...supplierBase, id: "s7", supplier_name: "Engine Value", outstanding_balance: 10 },
      { ...supplierBase, id: "s8", supplier_name: "No Engine Entry", outstanding_balance: 77 },
    ],
    {
      ...options,
      outstandingBySupplierId: { s6: 0, s7: 450 },
    },
  );
  assert.equal(engineRows[0]?.["Outstanding Balance"], 0);
  assert.equal(engineRows[1]?.["Outstanding Balance"], 450);
  assert.equal(engineRows[2]?.["Outstanding Balance"], 77);

  console.log(
    "Suppliers export tests passed: list-mirroring columns (incl. Area + Over-limit), None labels, Archived status, raw outstanding, empty list, engine outstanding override.",
  );
}

main();
