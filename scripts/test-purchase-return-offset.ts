import assert from "node:assert/strict";
import {
  computePurchaseReturnValueByReturnId,
  computeReturnedValueByPurchaseTransaction,
  netPurchaseInvoiceAllocation,
} from "../src/lib/purchases/returns-offset";

// Fixtures are shaped EXACTLY like the purchase-return write path stores
// them (POST /api/purchases/returns → public.purchase_returns /
// public.purchase_return_items, see src/lib/purchases/schema.sql), using
// the same column selection that page.tsx fetches:
//   purchase_returns:      id, organization_id, return_number, supplier_id,
//                          purchase_transaction_id, return_date, reason,
//                          status, created_by_profile_id, created_at,
//                          updated_at
//   purchase_return_items: id, purchase_return_id, product_id, quantity,
//                          unit_price, unit_mode, batch_number, expiry_date,
//                          created_at
// The API always inserts status "confirmed"; purchase_transaction_id is the
// source invoice's id when the return is linked (null when unlinked).
// Deliberate difference from sales: purchase_return_items has NO discount
// column, so a line's returned value is quantity × unit_price.

const ORG = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "22222222-2222-4222-8222-222222222222";
const INVOICE_TX = "33333333-3333-4333-8333-333333333333";
const OTHER_TX = "44444444-4444-4444-8444-444444444444";
const PROFILE = "55555555-5555-4555-8555-555555555555";

const returnRow = (overrides: Record<string, unknown> = {}) => ({
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: ORG,
  return_number: "PRN-000001",
  supplier_id: SUPPLIER,
  purchase_transaction_id: INVOICE_TX,
  return_date: "2026-10-21",
  reason: null,
  status: "confirmed",
  created_by_profile_id: PROFILE,
  created_at: "2026-10-21T10:00:00.000Z",
  updated_at: "2026-10-21T10:00:00.000Z",
  ...overrides,
});

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "77777777-7777-4777-8777-777777777777",
  purchase_return_id: "66666666-6666-4666-8666-666666666666",
  product_id: 42,
  quantity: 2,
  unit_price: 100,
  unit_mode: "main",
  batch_number: null,
  expiry_date: null,
  created_at: "2026-10-21T10:00:00.000Z",
  ...overrides,
});

// ── The live QA scenario (tradeos-qa, 2026-10-21) ──────────────────────────
// Purchase invoice P-50001: Rs 500, unpaid. Purchase return PRN-000001:
// 2 × Rs 100 = Rs 200 against that invoice, confirmed (and restocked).
// Expected after the return: remaining 500 − 200 − 0 = Rs 300.
// (The live QA check observed the payable still at Rs 500 — the value
// with returnedAmount = 0.)

const scenarioReturns = [returnRow()];
const scenarioItems = [itemRow()];
const scenarioMap = computeReturnedValueByPurchaseTransaction(scenarioReturns, scenarioItems);
assert.equal(
  scenarioMap[INVOICE_TX],
  200,
  "A confirmed, invoice-linked return of 2 × 100 must offset the invoice by 200"
);

const scenarioNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 500,
  returnedAmount: scenarioMap[INVOICE_TX] ?? 0,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
assert.equal(scenarioNet.remainingPayableAmount, 300, "Scenario remaining must be 300, not stay at 500");
assert.equal(scenarioNet.returnedAmount, 200);
assert.equal(scenarioNet.paidAmount, 0);

// Part-paid variant: the same invoice with Rs 200 already paid leaves
// 500 − 200 returned − 200 paid = Rs 100.
const partPaidNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 500,
  returnedAmount: scenarioMap[INVOICE_TX] ?? 0,
  explicitAllocatedAmount: 200,
  legacyPoolAvailable: 0,
});
assert.equal(partPaidNet.remainingPayableAmount, 100, "Part-paid: 500 − 200 returned − 200 paid = 100");
assert.equal(partPaidNet.paidAmount, 200);

// Control: with no return offset the same invoice leaves Rs 500 unpaid —
// the exact figure the broken live state showed, i.e. the signature of
// the fix's code never having run.
const controlNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 500,
  returnedAmount: 0,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
assert.equal(controlNet.remainingPayableAmount, 500, "Control: total 500 − paid 0 = 500");

// ── Which returns offset ────────────────────────────────────────────────────

const cancelledMap = computeReturnedValueByPurchaseTransaction(
  [returnRow({ status: "cancelled" })],
  scenarioItems
);
assert.equal(cancelledMap[INVOICE_TX], undefined, "Cancelled returns offset nothing");

const unlinkedMap = computeReturnedValueByPurchaseTransaction(
  [returnRow({ purchase_transaction_id: null })],
  scenarioItems
);
assert.deepEqual(unlinkedMap, {}, "Returns with no linked invoice offset nothing");

const foreignItemsMap = computeReturnedValueByPurchaseTransaction(
  scenarioReturns,
  [itemRow({ purchase_return_id: "99999999-9999-4999-8999-999999999999" })]
);
assert.equal(foreignItemsMap[INVOICE_TX], 0, "Items of another return must not join");

// Per-return values (the supplier ledger's shape): eligible returns are
// present with their floored value; cancelled and unlinked are absent.
const perReturnValues = computePurchaseReturnValueByReturnId(
  [
    returnRow(),
    returnRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", return_number: "PRN-000002", status: "cancelled" }),
    returnRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", return_number: "PRN-000003", purchase_transaction_id: null }),
  ],
  [
    itemRow(),
    itemRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", purchase_return_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    itemRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", purchase_return_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
  ]
);
assert.equal(perReturnValues["66666666-6666-4666-8666-666666666666"], 200);
assert.equal(perReturnValues["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"], undefined, "Cancelled return has no ledger value");
assert.equal(perReturnValues["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], undefined, "Unlinked return has no ledger value");

// ── Value formula: quantity × unit_price (no discount on purchase lines) ──

const multiLineMap = computeReturnedValueByPurchaseTransaction(
  [returnRow()],
  [
    itemRow({ quantity: 2, unit_price: 100 }),
    itemRow({ id: "88888888-8888-4888-8888-888888888888", quantity: 1, unit_price: 50 }),
  ]
);
assert.equal(multiLineMap[INVOICE_TX], 250, "2×100 plus 1×50 must total 250");

const unpricedMap = computeReturnedValueByPurchaseTransaction(
  [returnRow()],
  [itemRow({ unit_price: null })]
);
assert.equal(unpricedMap[INVOICE_TX], 0, "Lines with no stored price contribute 0");

// Per-return floor: even corrupt data (a negative stored price) must
// never produce a negative offset — the eligible return contributes 0
// while a healthy return on the same invoice still counts in full.
const flooredMap = computeReturnedValueByPurchaseTransaction(
  [
    returnRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    returnRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", return_number: "PRN-000002" }),
  ],
  [
    itemRow({ purchase_return_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1, unit_price: -50 }),
    itemRow({ purchase_return_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 1, unit_price: 100 }),
  ]
);
assert.equal(flooredMap[INVOICE_TX], 100, "A return whose lines net negative contributes 0, never a negative offset");

const accumulatedMap = computeReturnedValueByPurchaseTransaction(
  [
    returnRow(),
    returnRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", return_number: "PRN-000002" }),
    returnRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", return_number: "PRN-000003", purchase_transaction_id: OTHER_TX }),
  ],
  [
    itemRow(),
    itemRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", purchase_return_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    itemRow({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", purchase_return_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", quantity: 1, unit_price: 75 }),
  ]
);
assert.equal(accumulatedMap[INVOICE_TX], 400, "Two 200 returns on one invoice accumulate to 400");
assert.equal(accumulatedMap[OTHER_TX], 75, "Returns key to their own invoice only");

// ── Netting order: returns net before explicit allocations and the pool ────

const overReturnNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 500,
  returnedAmount: 600,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
assert.equal(overReturnNet.remainingPayableAmount, 0, "Over-return floors at 0 — no negative payable");

const poolNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 500,
  returnedAmount: 200,
  explicitAllocatedAmount: 100,
  legacyPoolAvailable: 300,
});
assert.equal(poolNet.fallbackAllocatedAmount, 200, "Legacy pool covers only what returns+explicit leave");
assert.equal(poolNet.remainingPayableAmount, 0);
assert.equal(poolNet.paidAmount, 300);
assert.equal(poolNet.legacyPoolRemaining, 100, "Unspent legacy pool carries forward");

console.log(
  "Purchase return offset tests passed: writer-shaped fixtures reproduce the P-50001 scenario (remaining 300), part-paid variant (100), cancelled/unlinked returns offset nothing, per-return floor, accumulation, and legacy-pool netting order."
);
