import assert from "node:assert/strict";
import {
  HELD_SALE_NOTES_MAX_LENGTH,
  heldSaleCurrencyStatus,
  loadHeldSales,
  parseHeldSales,
  type HeldSale,
} from "../src/lib/sales/held-sales";
import { parseBasketTemplates } from "../src/lib/sales/basket-templates";
import {
  buildAtomicSaleReceipt,
  buildOfflineSaleReceipt,
  buildPrintableReceiptHtml,
} from "../src/lib/print/retail-receipt";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import type { AtomicSaleInput } from "../src/lib/sales/atomic-sale-client";

// Phase A (held sale must persist): a held sale returns exactly as left —
// customer, lines, quantities, prices, discounts, payment mode, the typed
// cash tender, the scan-unit preference and the sale note — after another
// invoice is completed and after a page reload (both are plain
// localStorage round-trips through parse/load).

const SCOPE_KEY = "tradeos-pos-held-v1:org:profile";

const heldRow = (overrides: Partial<HeldSale> = {}): HeldSale => ({
  id: "55555555-5555-4555-8555-555555555555",
  savedAt: "2026-11-13T07:00:00.000Z",
  sale: {
    lines: [
      { product_id: "p1", quantity: "2", selling_price: "155", discount: "10", discount_type: "percent", unit_mode: "main" },
      { product_id: "p2", quantity: "1", selling_price: "80.60", discount: "", bonus: "1", unit_mode: "subunit" },
    ],
    customerId: "c1",
    date: "2026-11-13",
    paymentType: "cash",
    discount: "5",
    discountType: "flat",
    tax: "",
    cashReceived: "500",
    scanUnit: "main",
    notes: "Deliver after 5pm",
  },
  ...overrides,
});

const fakeStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
};

// 1. A writer-shaped row round-trips byte-identical, new fields included.
assert.deepEqual(
  parseHeldSales(JSON.stringify([heldRow()])),
  [heldRow()],
  "hold persists the whole sale: tender, scan unit and notes survive the round-trip",
);

// 2. A pre-Phase A row (no new fields) still parses, normalized to the
// empty-sale defaults instead of being rejected or quarantined.
const legacyRow = heldRow();
delete (legacyRow.sale as Partial<typeof legacyRow.sale>).cashReceived;
delete (legacyRow.sale as Partial<typeof legacyRow.sale>).scanUnit;
delete (legacyRow.sale as Partial<typeof legacyRow.sale>).notes;
const parsedLegacy = parseHeldSales(JSON.stringify([legacyRow]));
assert.equal(parsedLegacy[0]?.sale.cashReceived, "", "legacy row normalizes to an empty tender");
assert.equal(parsedLegacy[0]?.sale.scanUnit, "subunit", "legacy row normalizes to the default scan unit");
assert.equal(parsedLegacy[0]?.sale.notes, "", "legacy row normalizes to no note");
const legacyLoaded = loadHeldSales(fakeStorage({ [SCOPE_KEY]: JSON.stringify([legacyRow]) }), SCOPE_KEY);
assert.equal(legacyLoaded.quarantined, false, "a legacy row loads without quarantine");

// 3. Strictness is kept for the new fields: bad values are rejected.
assert.throws(
  () => parseHeldSales(JSON.stringify([heldRow({ sale: { ...heldRow().sale, scanUnit: "box" as never } })])),
  /Invalid held sales/,
  "an unknown scan unit is rejected",
);
assert.throws(
  () => parseHeldSales(JSON.stringify([heldRow({ sale: { ...heldRow().sale, cashReceived: 500 as never } })])),
  /Invalid held sales/,
  "a non-string tender is rejected",
);
assert.equal(HELD_SALE_NOTES_MAX_LENGTH, 500, "the held-sale note cap matches the POS input maxLength");
assert.throws(
  () => parseHeldSales(JSON.stringify([heldRow({ sale: { ...heldRow().sale, notes: "x".repeat(501) } })])),
  /Invalid held sales/,
  "a note over 500 chars is rejected",
);
assert.deepEqual(
  parseHeldSales(JSON.stringify([heldRow({ sale: { ...heldRow().sale, notes: "x".repeat(500) } })]))[0]?.sale.notes,
  "x".repeat(500),
  "a note at exactly 500 chars is accepted",
);

// 4. The currency guard is untouched: a stale row is still stale, so a
// held sale never resumes under the wrong currency label.
assert.equal(
  heldSaleCurrencyStatus({ ...heldRow(), currency: "EUR" }, "PKR"),
  "stale",
  "a EUR-held sale under PKR books is still blocked",
);
assert.equal(
  heldSaleCurrencyStatus({ ...heldRow(), currency: "PKR" }, "PKR"),
  "current",
  "a matching stamp still resumes",
);

// 5. Basket templates share the held-sale shape, so the new fields flow
// through a saved basket exactly like a held sale.
const templateRow = {
  id: "basket-1",
  name: "Morning basket",
  sale: heldRow().sale,
  savedAt: "2026-11-13T07:00:00.000Z",
  currency: "PKR",
};
assert.equal(parseBasketTemplates(JSON.stringify([templateRow]))[0]?.sale.notes, "Deliver after 5pm", "a basket keeps the note");
assert.equal(parseBasketTemplates(JSON.stringify([templateRow]))[0]?.sale.cashReceived, "500", "a basket keeps the tender");

// 6. Receipts: the stored note prints. The atomic result carries the
// whole transaction row, so transaction.notes reaches the receipt with
// no extra select; the offline receipt reads it straight off the input.
const confirmed = buildAtomicSaleReceipt({
  customer_name: "Walk-in",
  transaction: {
    invoice_number: "S-100200", sale_date: "2026-11-13", payment_type: "cash",
    discount_amount: "5.00", tax_rate: "0", tax_amount: "0",
    total_amount: "385.60", cash_received: "500", change_due: "114.40",
    notes: "Deliver after 5pm",
  },
  items: [{ product_name: "Test product", quantity: "2", selling_price: "155", discount: "10", bonus: "0", unit_mode: "main", unit_type: "Box" }],
}, { scope: "org:owner", business: "Corner Shop", fallbackDate: "today", fallbackPayment: "cash" });
assert.equal(confirmed.notes, "Deliver after 5pm", "a confirmed sale's note reaches its receipt");
assert.equal(
  buildAtomicSaleReceipt({
    customer_name: "Walk-in",
    transaction: {
      invoice_number: "S-100201", sale_date: "2026-11-13", payment_type: "cash",
      discount_amount: "0", tax_rate: "0", tax_amount: "0",
      total_amount: "100", cash_received: "100", change_due: "0",
      notes: null,
    },
    items: [],
  }, { scope: "org:owner", business: "Corner Shop", fallbackDate: "today", fallbackPayment: "cash" }).notes,
  null,
  "a sale with no note has a null receipt note",
);

const offlineInput: AtomicSaleInput = {
  customer_id: "c1",
  sale_date: "2026-11-13",
  payment_type: "cash",
  invoice_discount: 5,
  invoice_discount_type: "flat",
  tax_rate: 0,
  cash_received: 500,
  notes: "Deliver after 5pm",
  credit_override_confirmed: false,
  lines: [{ product_id: "p1", quantity: 2, selling_price: 155, discount: 10, bonus: 0, unit_mode: "main" }],
};
const offline = buildOfflineSaleReceipt(offlineInput, {
  scope: "org:owner",
  business: "Corner Shop",
  pendingLabel: "Pending sync",
  customerName: "Walk-in",
  productById: () => ({ name: "Test product", unit_type: "Box" }),
});
assert.equal(offline.notes, "Deliver after 5pm", "a queued offline sale's note reaches its provisional receipt");

// 7. Printed HTML shows the note under the header meta, and shows no
// note line at all when the sale has none.
const template = cloneDefaultTemplate("retail_receipt");
const htmlWithNote = buildPrintableReceiptHtml(confirmed, template);
assert.match(htmlWithNote, /Notes: Deliver after 5pm/, "the printed receipt carries the note");
const noNoteReceipt = { ...confirmed, notes: null };
assert.doesNotMatch(
  buildPrintableReceiptHtml(noNoteReceipt, template),
  /Notes:/,
  "a receipt without a note prints no note line",
);

// 8. Multiple held sales (UMAIR 2026-11-13): several sales held at once,
// each row carrying its own customer, timestamp and note — and discard /
// resume-clean removing ONLY that row, never the others.
const multiHeld = [
  heldRow({ id: "11111111-1111-4111-8111-111111111111", savedAt: "2026-11-13T07:00:00.000Z", sale: { ...heldRow().sale, customerId: "c1", notes: "Deliver after 5pm" } }),
  heldRow({ id: "22222222-2222-4222-8222-222222222222", savedAt: "2026-11-13T07:05:00.000Z", sale: { ...heldRow().sale, customerId: "c2", notes: "Call before dispatch", paymentType: "credit" } }),
  heldRow({ id: "33333333-3333-4333-8333-333333333333", savedAt: "2026-11-13T07:10:00.000Z", sale: { ...heldRow().sale, customerId: null, notes: "" } }),
];
const parsedMulti = parseHeldSales(JSON.stringify(multiHeld));
assert.equal(parsedMulti.length, 3, "three held sales round-trip as three rows");
assert.deepEqual(
  parsedMulti.map(row => [row.sale.customerId, row.savedAt, row.sale.notes]),
  [["c1", "2026-11-13T07:00:00.000Z", "Deliver after 5pm"], ["c2", "2026-11-13T07:05:00.000Z", "Call before dispatch"], [null, "2026-11-13T07:10:00.000Z", ""]],
  "each held row keeps its own customer, timestamp and note so it can be told apart",
);
// Discard = the same filter resume uses: only the named id leaves.
const afterDiscard = parsedMulti.filter(row => row.id !== "22222222-2222-4222-8222-222222222222");
assert.deepEqual(afterDiscard.map(row => row.id), ["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"], "discarding removes only that row; the other held sales stay byte-identical");
assert.deepEqual(afterDiscard[0], parsedMulti[0], "a surviving held row is untouched by a discard");
// Resume-clean: restoring a row filters it out of the list, and applying
// the same filter again is a no-op — the restored sale cannot duplicate.
const afterResume = parsedMulti.filter(row => row.id !== "11111111-1111-4111-8111-111111111111");
assert.equal(afterResume.length, 2, "resuming removes the row from the held list");
assert.equal(afterResume.filter(row => row.id === "11111111-1111-4111-8111-111111111111").length, 0, "no duplicate of the restored sale remains in the held list");
assert.deepEqual(afterResume.filter(row => row.id !== "11111111-1111-4111-8111-111111111111"), afterResume, "re-applying the resume filter changes nothing");

console.log("Held-sale Phase A checks passed: full-sale round-trip (tender, scan unit, notes), legacy normalization, strict validation, currency guard, basket flow-through, receipt + print notes, multi-hold display fields, discard-only-that-row, resume-clean with no duplicates.");
