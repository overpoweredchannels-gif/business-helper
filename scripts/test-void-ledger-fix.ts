import assert from "node:assert/strict";
import {
  excludeVoidedPayments,
  historyAmountsForPayment,
  isVoidedPayment,
} from "../src/lib/payments/voided-payments";
import { safeNumber } from "../src/lib/tradeos/validators";

// Void exclusion for payment-derived totals.
//
// The void RPC (void_payment_atomic, phase 15) marks a payment voided_at
// and restores the stored balance, but it does NOT delete the payment's
// allocation rows (by design). The allocation engines already skip
// allocations of voided payments, but the Supplier Ledger builder read
// raw payment rows with no voided_at check — so voided payments still
// appeared as credits and were counted in Total Payments / Current
// Ledger Balance. These scenarios mirror the live QA case that exposed
// it: Test Pepsi Agency, purchase P-50034 €1.00, two €0.50 supplier
// payments, both voided, full return PRN-000014 €1.00. Before the fix the
// ledger showed Current Ledger Balance −€1.00; after it, €0.00.

// isVoidedPayment: exactly voided_at set counts as voided.
{
  assert.equal(isVoidedPayment({ voided_at: null }), false);
  assert.equal(isVoidedPayment({ voided_at: undefined }), false);
  assert.equal(isVoidedPayment({}), false);
  assert.equal(isVoidedPayment(null), false);
  assert.equal(isVoidedPayment(undefined), false);
  assert.equal(isVoidedPayment({ voided_at: "2026-11-15T10:00:00.000Z" }), true);
}

// excludeVoidedPayments: keeps live payments (in order), drops voided ones.
{
  const payments = [
    { id: "live-1", voided_at: null, amount: 0.5 },
    { id: "voided-1", voided_at: "2026-11-15T10:00:00.000Z", amount: 0.5 },
    { id: "live-2", voided_at: undefined, amount: 0.25 },
    { id: "voided-2", voided_at: "2026-11-15T10:05:00.000Z", amount: 0.5 },
  ];
  const kept = excludeVoidedPayments(payments);
  assert.deepEqual(
    kept.map((payment) => payment.id),
    ["live-1", "live-2"]
  );
  assert.equal(excludeVoidedPayments([]).length, 0);
}

// Ledger arithmetic, mirroring page.tsx (supplierLedgerTotalPayments and
// supplierLedgerCurrentBalance = TotalPurchases − TotalPayments −
// TotalReturns), with the ledger's payment list passed through the same
// excludeVoidedPayments filter the ledger builder now applies.
function ledgerTotals(
  purchaseTotal: number,
  payments: { voided_at?: string | null; amount: number }[],
  returnsTotal: number
) {
  const totalPayments = excludeVoidedPayments(payments).reduce(
    (sum, payment) => sum + safeNumber(payment.amount),
    0
  );
  return {
    totalPayments,
    balance: purchaseTotal - totalPayments - returnsTotal,
  };
}

// The live QA case: purchase €1.00, two €0.50 payments, both voided,
// full return €1.00 → Total Payments €0.00, balance €0.00 (was −€1.00).
{
  const payments = [
    { voided_at: "2026-11-15T10:00:00.000Z", amount: 0.5 },
    { voided_at: "2026-11-15T10:05:00.000Z", amount: 0.5 },
  ];
  const totals = ledgerTotals(1.0, payments, 1.0);
  assert.equal(totals.totalPayments, 0);
  assert.equal(totals.balance, 0);
}

// Control: the same payments, NOT voided, still count — the filter is
// what changes the outcome, and a live payment is never dropped.
{
  const payments = [
    { voided_at: null, amount: 0.5 },
    { voided_at: null, amount: 0.5 },
  ];
  const totals = ledgerTotals(1.0, payments, 1.0);
  assert.equal(totals.totalPayments, 1.0);
  // Paid in full, then returned in full: the supplier owes €1.00.
  assert.equal(totals.balance, -1.0);
}

// Mixed: one voided payment of €0.50 and one live payment of €0.50
// against a €1.00 purchase, no return → Total Payments €0.50, balance
// €0.50 (the voided half does not count).
{
  const payments = [
    { voided_at: "2026-11-15T10:00:00.000Z", amount: 0.5 },
    { voided_at: null, amount: 0.5 },
  ];
  const totals = ledgerTotals(1.0, payments, 0);
  assert.equal(totals.totalPayments, 0.5);
  assert.equal(totals.balance, 0.5);
}

// History card amounts: a voided payment covers nothing — no allocation
// rows, both amounts zero, no exceeds flag — even though its allocation
// rows still exist (the void keeps them by design).
{
  const result = historyAmountsForPayment(
    { voided_at: "2026-11-15T10:00:00.000Z", amount: 0.5 },
    [{ amount: 0.5 }]
  );
  assert.deepEqual(result.allocations, []);
  assert.equal(result.explicitlyAllocatedAmount, 0);
  assert.equal(result.unallocatedAmount, 0);
  assert.equal(result.allocationExceedsPayment, false);
}

// History card amounts: a live payment keeps its allocations and amounts.
{
  // Fully allocated: €0.50 paid, €0.50 allocated → unallocated €0.00.
  const fully = historyAmountsForPayment({ voided_at: null, amount: 0.5 }, [
    { amount: 0.5 },
  ]);
  assert.equal(fully.allocations.length, 1);
  assert.equal(fully.explicitlyAllocatedAmount, 0.5);
  assert.equal(fully.unallocatedAmount, 0);
  assert.equal(fully.allocationExceedsPayment, false);

  // Partially allocated: €1.00 paid, €0.40 allocated → unallocated €0.60.
  const partial = historyAmountsForPayment({ voided_at: null, amount: 1.0 }, [
    { amount: 0.4 },
  ]);
  assert.equal(partial.explicitlyAllocatedAmount, 0.4);
  assert.equal(partial.unallocatedAmount, 0.6);
  assert.equal(partial.allocationExceedsPayment, false);

  // Over-allocated: €0.50 paid, €0.60 allocated → exceeds flag set.
  const over = historyAmountsForPayment({ voided_at: null, amount: 0.5 }, [
    { amount: 0.6 },
  ]);
  assert.equal(over.explicitlyAllocatedAmount, 0.6);
  assert.equal(over.unallocatedAmount, 0);
  assert.equal(over.allocationExceedsPayment, true);
}

// CSV "Unallocated Payments" shape: a voided payment contributes €0.00
// (it is filtered before the reduce), a live unallocated payment keeps
// its full unallocated slice.
{
  const payments = [
    { id: "voided", voided_at: "2026-11-15T10:00:00.000Z", amount: 0.5 },
    { id: "live", voided_at: null, amount: 1.0 },
  ];
  const allocationsByPayment: Record<string, number> = { voided: 0.5, live: 0.4 };
  const unallocated = excludeVoidedPayments(payments).reduce((sum, payment) => {
    return (
      sum +
      Math.max(0, safeNumber(payment.amount) - (allocationsByPayment[payment.id] ?? 0))
    );
  }, 0);
  assert.equal(unallocated, 0.6);
}

console.log("test-void-ledger-fix: all assertions passed");
