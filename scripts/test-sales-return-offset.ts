import assert from "node:assert/strict";
import {
  computeCreditAllocationsByTransaction,
  computeReturnedValueBySalesTransaction,
  netCreditInvoiceAllocation,
  summarizeCustomerCredit,
} from "../src/lib/sales/returns-offset";

// Fixtures are shaped EXACTLY like the sales-return write path stores them
// (POST /api/sales/returns → public.sales_returns / public.sales_return_items,
// see src/lib/sales/schema.sql), using the same column selection that
// page.tsx fetches:
//   sales_returns:      id, organization_id, return_number, customer_id,
//                       sales_transaction_id, return_date, reason, status,
//                       created_by_profile_id, created_at, updated_at
//   sales_return_items: id, sales_return_id, product_id, quantity,
//                       unit_price, discount, unit_mode, batch_number,
//                       expiry_date, created_at
// The API always inserts status "confirmed"; sales_transaction_id is the
// source invoice's id (the UI's customer — required by validation — is set
// only from the selected invoice, so a saved UI return is always linked).

const ORG = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const INVOICE_TX = "33333333-3333-4333-8333-333333333333";
const OTHER_TX = "44444444-4444-4444-8444-444444444444";
const PROFILE = "55555555-5555-4555-8555-555555555555";

const returnRow = (overrides: Record<string, unknown> = {}) => ({
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: ORG,
  return_number: "SRN-000001",
  customer_id: CUSTOMER,
  sales_transaction_id: INVOICE_TX,
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
  sales_return_id: "66666666-6666-4666-8666-666666666666",
  product_id: 42,
  quantity: 1,
  unit_price: 155,
  discount: 0,
  unit_mode: "main",
  batch_number: null,
  expiry_date: null,
  created_at: "2026-10-21T10:00:00.000Z",
  ...overrides,
});

// ── The QA scenario (tradeos-qa, 2026-10-21) ────────────────────────────────
// Credit invoice S-100004: 2 × Rs 155 = Rs 310. Payment Rs 200 allocated.
// Sales return SRN-000001: 1 × Rs 155 against that invoice.
// Expected after the return: remaining 310 − 155 − 200 floored at 0 → Rs 0.
// (The live QA check observed Rs 110 — the value with returnedAmount = 0.)

const scenarioReturns = [returnRow()];
const scenarioItems = [itemRow()];
const scenarioMap = computeReturnedValueBySalesTransaction(scenarioReturns, scenarioItems);
assert.equal(
  scenarioMap[INVOICE_TX],
  155,
  "A confirmed, invoice-linked return of 1 × 155 must offset the invoice by 155"
);

const scenarioNet = netCreditInvoiceAllocation({
  invoiceTotal: 310,
  returnedAmount: scenarioMap[INVOICE_TX] ?? 0,
  explicitAllocatedAmount: 200,
  legacyPoolAvailable: 0,
});
assert.equal(scenarioNet.remainingUnpaidAmount, 0, "Scenario remaining must floor at 0, not stay at 110");
assert.equal(scenarioNet.returnedAmount, 155);
assert.equal(scenarioNet.allocatedAmount, 200);

// Control: with no return offset the same invoice leaves Rs 110 — the exact
// figure the broken live state showed, i.e. the signature of the fix's code
// never having run.
const controlNet = netCreditInvoiceAllocation({
  invoiceTotal: 310,
  returnedAmount: 0,
  explicitAllocatedAmount: 200,
  legacyPoolAvailable: 0,
});
assert.equal(controlNet.remainingUnpaidAmount, 110, "Control: total 310 − paid 200 = 110");

// ── Which returns offset ────────────────────────────────────────────────────

const cancelledMap = computeReturnedValueBySalesTransaction(
  [returnRow({ status: "cancelled" })],
  scenarioItems
);
assert.equal(cancelledMap[INVOICE_TX], undefined, "Cancelled returns offset nothing");

const unlinkedMap = computeReturnedValueBySalesTransaction(
  [returnRow({ sales_transaction_id: null })],
  scenarioItems
);
assert.deepEqual(unlinkedMap, {}, "Returns with no linked invoice offset nothing");

const foreignItemsMap = computeReturnedValueBySalesTransaction(
  scenarioReturns,
  [itemRow({ sales_return_id: "99999999-9999-4999-8999-999999999999" })]
);
assert.equal(foreignItemsMap[INVOICE_TX], 0, "Items of another return must not join");

// ── Value formula: quantity × unit_price − discount, floored per return ────

const discountMap = computeReturnedValueBySalesTransaction(
  [returnRow()],
  [
    itemRow({ quantity: 2, unit_price: 155, discount: 10 }),
    itemRow({ id: "88888888-8888-4888-8888-888888888888", quantity: 1, unit_price: 50, discount: 0 }),
  ]
);
assert.equal(discountMap[INVOICE_TX], 350, "2×155−10 plus 1×50 must total 350");

const flooredMap = computeReturnedValueBySalesTransaction(
  [
    returnRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    returnRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", return_number: "SRN-000002" }),
  ],
  [
    itemRow({ sales_return_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1, unit_price: 100, discount: 150 }),
    itemRow({ sales_return_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 1, unit_price: 155, discount: 0 }),
  ]
);
assert.equal(flooredMap[INVOICE_TX], 155, "A return whose lines net negative contributes 0, never a negative offset");

const accumulatedMap = computeReturnedValueBySalesTransaction(
  [
    returnRow(),
    returnRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", return_number: "SRN-000002" }),
    returnRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", return_number: "SRN-000003", sales_transaction_id: OTHER_TX }),
  ],
  [
    itemRow(),
    itemRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", sales_return_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    itemRow({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", sales_return_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", unit_price: 75 }),
  ]
);
assert.equal(accumulatedMap[INVOICE_TX], 310, "Two 155 returns on one invoice accumulate to 310");
assert.equal(accumulatedMap[OTHER_TX], 75, "Returns key to their own invoice only");

// ── Netting order: returns net before explicit allocations and the pool ────

const partialNet = netCreditInvoiceAllocation({
  invoiceTotal: 310,
  returnedAmount: 155,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
assert.equal(partialNet.remainingUnpaidAmount, 155, "Unpaid invoice: 310 − 155 returned = 155");

const overReturnNet = netCreditInvoiceAllocation({
  invoiceTotal: 310,
  returnedAmount: 400,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
assert.equal(overReturnNet.remainingUnpaidAmount, 0, "Over-return floors at 0 — no negative receivable");

const poolNet = netCreditInvoiceAllocation({
  invoiceTotal: 310,
  returnedAmount: 155,
  explicitAllocatedAmount: 100,
  legacyPoolAvailable: 100,
});
assert.equal(poolNet.fallbackAllocatedAmount, 55, "Legacy pool covers only what returns+explicit leave");
assert.equal(poolNet.remainingUnpaidAmount, 0);
assert.equal(poolNet.legacyPoolRemaining, 45, "Unspent legacy pool carries forward");

// ─── Customer Credit summary (QA fix round item 4) ────────────────────────
// The Receivables Dashboard row must reconcile on its face:
// creditSales − paymentsApplied − returnsCredited = outstanding, with
// every figure derived from the engine's allocation results.

const creditRow = (
  id: string,
  invoiceTotal: number,
  returnedAmount: number,
  explicitAllocatedAmount: number,
  sortDate = "2026-10-01"
) => ({
  id,
  customerId: "cust-1",
  invoiceTotal,
  returnedAmount,
  explicitAllocatedAmount,
  sortDate,
  createdAt: `${sortDate}T00:00:00.000Z`,
});

// QA-M1 Customer: sales 500, payments 350, outstanding 50 — the missing
// 100 was a return the old screen never showed.
{
  const allocations = computeCreditAllocationsByTransaction(
    [creditRow("tx-1", 500, 100, 350)],
    {}
  );
  const summary = summarizeCustomerCredit(Object.values(allocations));
  assert.deepEqual(summary, {
    creditSales: 500,
    paymentsApplied: 350,
    returnsCredited: 100,
    outstanding: 50,
  });
  assert.equal(
    summary.creditSales - summary.paymentsApplied - summary.returnsCredited,
    summary.outstanding,
    "row must foot exactly"
  );
}

// FIFO pool across two invoices with a return on the younger one.
{
  const allocations = computeCreditAllocationsByTransaction(
    [
      creditRow("tx-1", 300, 0, 0, "2026-10-01"),
      creditRow("tx-2", 200, 50, 0, "2026-10-02"),
    ],
    { "cust-1": 350 }
  );
  const summary = summarizeCustomerCredit(Object.values(allocations));
  assert.deepEqual(summary, {
    creditSales: 500,
    paymentsApplied: 350,
    returnsCredited: 50,
    outstanding: 100,
  });
}

// Over-return: the engine caps the receivable at 0, so the credited
// return shown is the EFFECTIVE offset (310), not the raw return (400) —
// the identity still holds instead of displaying a negative remainder.
{
  const allocations = computeCreditAllocationsByTransaction(
    [creditRow("tx-1", 310, 400, 0)],
    {}
  );
  const summary = summarizeCustomerCredit(Object.values(allocations));
  assert.equal(summary.outstanding, 0);
  assert.equal(summary.returnsCredited, 310);
  assert.equal(
    summary.creditSales - summary.paymentsApplied - summary.returnsCredited,
    summary.outstanding
  );
}

// No credit invoices (cash-only / walk-in customer) → an honest all-zero
// credit row; cash activity belongs to Sales History, not this screen.
{
  const summary = summarizeCustomerCredit([]);
  assert.deepEqual(summary, {
    creditSales: 0,
    paymentsApplied: 0,
    returnsCredited: 0,
    outstanding: 0,
  });
}

console.log(
  "Sales return offset tests passed: writer-shaped fixtures reproduce the S-100004 scenario (remaining 0), cancelled/unlinked returns offset nothing, per-return floor, accumulation, and legacy-pool netting order."
);
console.log("Customer credit summary tests passed: QA-M1 row foots (500 − 350 − 100 = 50), FIFO pool + return, over-return cap, cash-only all-zero.");
