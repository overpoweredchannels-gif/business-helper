import assert from "node:assert/strict";
import {
  getSalesPaymentStatusKind,
  paymentStatusBadgeClass,
} from "../src/lib/history/payment-status";
import { computeReturnedValueBySalesTransaction } from "../src/lib/sales/returns-offset";
import { messages } from "../src/lib/regional/messages";

// Sales "Returned" Badge — symmetry with the purchase side (Final Polish,
// 1a7f8a8). A sale that is 100% returned must show a neutral "Returned"
// badge instead of the green "Paid" badge, and the Sales History filter
// must offer a "Returned" option. The live case is S-100091: a €0.81
// credit sale fully returned via SRN-000008, which showed "Paid" with
// Allocated €0.00 / Remaining €0.00 because the badge formula is
// "remaining ≤ 0 → Paid" and the sales row never passed a `returned`
// value to the badge helper.
//
// The sales status is a pure function of the numbers page.tsx already
// computes (getSalesPaymentStatusKind in src/lib/history/payment-status):
// cash/card sales are paid in full by construction (paid = total,
// remaining = 0), but the returned amount comes from
// returnedValueBySalesTransaction, which covers EVERY payment type —
// not from the credit-only allocation engine — so a fully returned
// cash/card sale is "Returned" too. The "returned" check runs first in
// getPaymentStatusBadgeKind, so a fully returned invoice is "Returned"
// even though its remaining is 0.

const TODAY = "2026-11-16";

// --- (a) A fully-returned credit sale is "Returned", not "Paid". ---
// S-100091 shape: €0.81 credit sale, €0.81 returned, nothing paid.
{
  const kind = getSalesPaymentStatusKind({
    paymentType: "credit",
    total: 0.81,
    allocatedAmount: 0,
    remainingUnpaidAmount: 0,
    returnedAmount: 0.81,
  });
  assert.equal(kind, "returned");
  assert.notEqual(kind, "paid");
  assert.equal(paymentStatusBadgeClass(kind), "bg-muted text-muted-foreground");
}

// --- (b) A fully-returned CASH or CARD sale is "Returned" too. ---
// Cash/card sales are paid in full by construction, so without the
// returned check they would read "Paid" — the goods went back, so the
// invoice is neither paid nor owed.
{
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "cash",
      total: 0.81,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0.81,
    }),
    "returned"
  );
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "card",
      total: 0.81,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0.81,
    }),
    "returned"
  );
}

// --- (c) A partially-returned credit sale keeps its normal status. ---
// Half the goods went back and €0.40 of the €0.81 is paid → Partial.
{
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0.81,
      allocatedAmount: 0.4,
      remainingUnpaidAmount: 0.41,
      returnedAmount: 0.4,
    }),
    "partial"
  );
}

// --- (d) A partially-returned CASH sale is still "Paid". ---
// The customer paid in full; only some goods came back (the refund is a
// separate matter), so the invoice is not "Returned".
{
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "cash",
      total: 0.81,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0.4,
    }),
    "paid"
  );
}

// --- (e) A non-returned sale is unchanged. ---
{
  // Credit, nothing paid yet → Unpaid.
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0.81,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0.81,
      returnedAmount: 0,
    }),
    "unpaid"
  );
  // Credit, fully paid → Paid.
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0.81,
      allocatedAmount: 0.81,
      remainingUnpaidAmount: 0,
      returnedAmount: 0,
    }),
    "paid"
  );
  // Cash, no return → Paid.
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "cash",
      total: 0.81,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0,
    }),
    "paid"
  );
  // Credit, still owed past its due date → Overdue.
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0.81,
      allocatedAmount: 0.4,
      remainingUnpaidAmount: 0.41,
      returnedAmount: 0,
      dueDate: "2026-11-01",
      today: TODAY,
    }),
    "overdue"
  );
}

// --- (f) Zero-total guard: a zero-total sale is not "Returned". ---
{
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0,
    }),
    "paid"
  );
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "cash",
      total: 0,
      allocatedAmount: 0,
      remainingUnpaidAmount: 0,
      returnedAmount: 0,
    }),
    "paid"
  );
}

// --- (g) The filter: a fully-returned sale matches "returned", not "paid". ---
// The Sales History filter compares the same status value the row badge
// renders (getSalesTransactionPaymentStatus in page.tsx, which calls
// getSalesPaymentStatusKind), so matching is exact.
{
  const status = getSalesPaymentStatusKind({
    paymentType: "credit",
    total: 0.81,
    allocatedAmount: 0,
    remainingUnpaidAmount: 0,
    returnedAmount: 0.81,
  });
  assert.equal(status, "returned");
  assert.notEqual(status, "paid");
  // And a normal paid sale still matches "paid", not "returned".
  assert.equal(
    getSalesPaymentStatusKind({
      paymentType: "credit",
      total: 0.81,
      allocatedAmount: 0.81,
      remainingUnpaidAmount: 0,
      returnedAmount: 0,
    }),
    "paid"
  );
}

// --- (h) The returned amount is available for CASH sales too. ---
// returnedValueBySalesTransaction sums confirmed returns linked to an
// invoice regardless of the invoice's payment type — this is what lets
// the sales status cover cash/card sales, where the credit allocation
// engine has no row at all. A cancelled return and an unlinked return
// offset nothing.
{
  const byTransaction = computeReturnedValueBySalesTransaction(
    [
      { id: "r-1", sales_transaction_id: "cash-sale-1", status: "confirmed" },
      { id: "r-2", sales_transaction_id: "cash-sale-1", status: "cancelled" },
      { id: "r-3", sales_transaction_id: null, status: "confirmed" },
    ],
    [
      { sales_return_id: "r-1", quantity: 1, unit_price: 0.81, discount: 0 },
      { sales_return_id: "r-2", quantity: 1, unit_price: 0.81, discount: 0 },
      { sales_return_id: "r-3", quantity: 1, unit_price: 0.81, discount: 0 },
    ]
  );
  assert.equal(byTransaction["cash-sale-1"], 0.81);
  assert.equal(byTransaction["credit-sale-1"] ?? 0, 0);
}

// --- (i) The badge is the neutral muted tone, never green or red. ---
{
  assert.equal(paymentStatusBadgeClass("returned"), "bg-muted text-muted-foreground");
  assert.notEqual(paymentStatusBadgeClass("returned"), paymentStatusBadgeClass("paid"));
  assert.notEqual(paymentStatusBadgeClass("returned"), paymentStatusBadgeClass("unpaid"));
}

// --- (j) The filter and badge labels exist in all 4 locales. ---
// The filter dropdown renders sell.statusPaid / sell.statusPartial /
// buy.statusUnpaid / sell.statusOverdue / buy.returnedLabel, and the
// "All payment statuses" option plus aria-label reuse
// buy.allPaymentStatuses / buy.filterByPaymentStatus. "Returned" reuses
// buy.returnedLabel — no new translation key was created.
{
  assert.equal(messages.en["buy.returnedLabel"], "Returned");
  assert.equal(messages.es["buy.returnedLabel"], "Devuelto");
  assert.equal(messages.it["buy.returnedLabel"], "Restituito");
  assert.equal(messages.ur["buy.returnedLabel"], "واپس شدہ");
  for (const language of Object.keys(messages) as Array<keyof typeof messages>) {
    for (const key of [
      "sell.statusPaid",
      "sell.statusPartial",
      "sell.statusOverdue",
      "buy.statusUnpaid",
      "buy.returnedLabel",
      "buy.allPaymentStatuses",
      "buy.filterByPaymentStatus",
    ] as const) {
      assert.equal(typeof messages[language][key], "string", `${language}.${key}`);
      assert.ok(messages[language][key].length > 0, `${language}.${key} non-empty`);
    }
  }
}

console.log("test-sales-returned-badge: all assertions passed");
