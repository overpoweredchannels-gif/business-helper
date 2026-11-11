import assert from "node:assert/strict";
import { buildReturnPrefillLines } from "../src/lib/returns/prefill";

// Product with a subunit: 12 pieces per pack (main = pack, subunit = piece).
const PRODUCTS = [{ id: 7, units_per_pack: 12 }];
// Product with no subunit.
const NO_SUBUNIT = [{ id: 9, units_per_pack: null }];

const invoiceLine = (overrides: Record<string, unknown> = {}) => ({
  product_id: 7,
  quantity: 24,
  unit_mode: "subunit" as const,
  batch_number: "B1",
  expiry_date: "2027-01-01",
  ...overrides,
});

const returnedItem = (overrides: Record<string, unknown> = {}) => ({
  product_id: 7,
  quantity: 1,
  unit_mode: "main" as const,
  cancelled: false,
  ...overrides,
});

// ── The bug (sales prefill, pre-2026-11-12) ────────────────────────────────
// Invoice line 24 subunits + prior return 1 main (12/pack): the old code
// subtracted raw quantities (24 − 1 = 23 subunits). Correct: 24 subunits =
// 2 main, minus 1 main returned = 1 main = 12 subunits.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine()],
    returnedItems: [returnedItem()],
    products: PRODUCTS,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, "12", "24 subunits sold, 1 main returned → 12 subunits remain");
  assert.equal(lines[0].unit_mode, "subunit", "Prefill keeps the invoice line's own unit mode");
  assert.equal(lines[0].batch_number, "B1");
  assert.equal(lines[0].expiry_date, "2027-01-01");
}

// Reverse direction: invoice line 2 main + prior return 12 subunits
// (12/pack = 1 main): the old code prefilled max(0, 2 − 12) = 0, hiding the
// 1 returnable main unit.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine({ quantity: 2, unit_mode: "main" })],
    returnedItems: [returnedItem({ quantity: 12, unit_mode: "subunit" })],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "1", "2 main sold, 12 subunits returned → 1 main remains");
  assert.equal(lines[0].unit_mode, "main");
}

// Same-mode arithmetic is unchanged: 10 main sold, 3 main returned → 7.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine({ quantity: 10, unit_mode: "main" })],
    returnedItems: [returnedItem({ quantity: 3, unit_mode: "main" })],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "7");
  assert.equal(lines[0].unit_mode, "main");
}

// No prior returns: the full sold quantity prefills, in the line's mode.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine()],
    returnedItems: [],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "24");
  assert.equal(lines[0].unit_mode, "subunit");
}

// A CANCELLED prior return never counts: cancelling restores the full
// returnable quantity (mirror of the server guard's .neq(status, 'cancelled')).
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine()],
    returnedItems: [returnedItem({ cancelled: true })],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "24", "Cancelled return must not shrink the prefill");
  const mixed = buildReturnPrefillLines({
    invoiceItems: [invoiceLine()],
    returnedItems: [
      returnedItem({ cancelled: true }),
      returnedItem({ quantity: 1, unit_mode: "main", cancelled: false }),
    ],
    products: PRODUCTS,
  });
  assert.equal(mixed[0].quantity, "12", "Only the confirmed return counts");
}

// Fully returned: remaining floors at 0, never negative.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine({ quantity: 1, unit_mode: "main" })],
    returnedItems: [returnedItem({ quantity: 24, unit_mode: "subunit" })],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "0");
}

// Subunit return against a main line, fractional remainder: 2 main sold,
// 6 subunits returned (0.5 main) → 1.5 main remain.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [invoiceLine({ quantity: 2, unit_mode: "main" })],
    returnedItems: [returnedItem({ quantity: 6, unit_mode: "subunit" })],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "1.5");
}

// A product with no subunit never divides: 5 sold, 2 returned → 3.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [{ product_id: 9, quantity: 5, unit_mode: "main" as const, batch_number: null, expiry_date: null }],
    returnedItems: [{ product_id: 9, quantity: 2, unit_mode: "main" as const, cancelled: false }],
    products: NO_SUBUNIT,
  });
  assert.equal(lines[0].quantity, "3");
}

// Missing unit_mode defaults to "main" on both sides.
{
  const lines = buildReturnPrefillLines({
    invoiceItems: [{ product_id: 7, quantity: 2, batch_number: null, expiry_date: null }],
    returnedItems: [{ product_id: 7, quantity: 1, cancelled: false }],
    products: PRODUCTS,
  });
  assert.equal(lines[0].quantity, "1");
  assert.equal(lines[0].unit_mode, "main");
}

console.log("return-prefill: all assertions passed");
