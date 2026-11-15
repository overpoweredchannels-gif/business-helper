import assert from "node:assert/strict";
import { computeCustomerRemainingByTransaction } from "../src/lib/sales/returns-offset";
import { isVoidedPayment } from "../src/lib/payments/voided-payments";

// Customer History dialog void exclusion.
//
// Live QA (2026-11-15) found the dialog still counted a voided customer
// payment: after voiding a €0.40 payment against invoice S-100090
// (QA Shop A, €0.81 credit), the dialog showed Total paid €5.64 /
// Outstanding €0.62 instead of €5.24 / €1.02 — the Customers list and
// the Sales History badge were already correct. Root cause: the dialog
// runs computeCustomerRemainingByTransaction over data from
// /api/customers/history, which did not select voided_at for
// customer_payments, and the computation had no voided-payment input —
// so the voided payment's allocation row still counted as applied and
// the voided amount still fed the FIFO pool. The fix passes the voided
// payment ids (built from voided_at via isVoidedPayment, the same rule
// the receivables engine in page.tsx applies) into the computation,
// which skips those allocations and leaves voided payments out of the
// pool. These scenarios mirror the QA case: S-100090 €0.81 credit with
// a €0.40 payment, S-100062 €0.21 credit unpaid.

// Money is compared at 2dp: 0.81 − 0.40 is 0.41000000000000003 in binary.
function eqMoney(actual: number, expected: number) {
  assert.equal(Math.round(actual * 100) / 100, expected);
}

function dialogSummary(result: Record<string, { remaining: number; allocatedAmount: number }>) {
  const rows = Object.values(result);
  return {
    totalPaid: rows.reduce((sum, row) => sum + row.allocatedAmount, 0),
    outstanding: rows.reduce((sum, row) => sum + row.remaining, 0),
  };
}

const transactions = [
  {
    id: "t-s100090",
    customerId: "c1",
    invoiceTotal: 0.81,
    paymentType: "credit",
    status: "confirmed",
    sortDate: "2026-11-15",
    createdAt: "2026-11-15T10:00:00.000Z",
  },
  {
    id: "t-s100062",
    customerId: "c1",
    invoiceTotal: 0.21,
    paymentType: "credit",
    status: "confirmed",
    sortDate: "2026-11-14",
    createdAt: "2026-11-14T10:00:00.000Z",
  },
];

const payments = [{ id: "p-void", customerId: "c1", amount: 0.4 }];
const allocations = [
  { salesTransactionId: "t-s100090", amount: 0.4, customerPaymentId: "p-void" },
];
const returnedValueByTransaction = {};

// QA case, fixed: the voided €0.40 counts toward nothing. The dialog
// summary must read Outstanding €1.02 (not €0.62) and Total paid €0.00
// from these two invoices.
{
  const result = computeCustomerRemainingByTransaction({
    transactions,
    payments,
    allocations,
    returnedValueByTransaction,
    voidedPaymentIds: new Set(["p-void"]),
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0);
  eqMoney(result["t-s100090"].remaining, 0.81);
  eqMoney(result["t-s100062"].allocatedAmount, 0);
  eqMoney(result["t-s100062"].remaining, 0.21);
  const summary = dialogSummary(result);
  eqMoney(summary.totalPaid, 0);
  eqMoney(summary.outstanding, 1.02);
}

// Same inputs without the voided set reproduce the bug the QA saw:
// the voided €0.40 still covers S-100090, so the dialog would read
// Outstanding €0.62 / Total paid €0.40. Pins the regression.
{
  const result = computeCustomerRemainingByTransaction({
    transactions,
    payments,
    allocations,
    returnedValueByTransaction,
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0.4);
  eqMoney(result["t-s100090"].remaining, 0.41);
  const summary = dialogSummary(result);
  eqMoney(summary.totalPaid, 0.4);
  eqMoney(summary.outstanding, 0.62);
}

// Live payment still counts: the same €0.40 allocation with an empty
// voided set applies normally.
{
  const result = computeCustomerRemainingByTransaction({
    transactions,
    payments,
    allocations,
    returnedValueByTransaction,
    voidedPaymentIds: new Set<string>(),
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0.4);
  eqMoney(result["t-s100090"].remaining, 0.41);
  const summary = dialogSummary(result);
  eqMoney(summary.totalPaid, 0.4);
  eqMoney(summary.outstanding, 0.62);
}

// Mixed voided + live: the voided €0.40 on S-100090 is skipped while
// the live €0.21 on S-100062 still applies.
{
  const result = computeCustomerRemainingByTransaction({
    transactions,
    payments: [
      { id: "p-void", customerId: "c1", amount: 0.4 },
      { id: "p-live", customerId: "c1", amount: 0.21 },
    ],
    allocations: [
      { salesTransactionId: "t-s100090", amount: 0.4, customerPaymentId: "p-void" },
      { salesTransactionId: "t-s100062", amount: 0.21, customerPaymentId: "p-live" },
    ],
    returnedValueByTransaction,
    voidedPaymentIds: new Set(["p-void"]),
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0);
  eqMoney(result["t-s100090"].remaining, 0.81);
  eqMoney(result["t-s100062"].allocatedAmount, 0.21);
  eqMoney(result["t-s100062"].remaining, 0);
  const summary = dialogSummary(result);
  eqMoney(summary.totalPaid, 0.21);
  eqMoney(summary.outstanding, 0.81);
}

// A voided UNALLOCATED payment must not inflate the FIFO pool: with a
// voided €1.00 and a live €0.50 unallocated, only the live €0.50 can
// cover the €0.81 invoice.
{
  const result = computeCustomerRemainingByTransaction({
    transactions: [transactions[0]],
    payments: [
      { id: "p-void", customerId: "c1", amount: 1 },
      { id: "p-live", customerId: "c1", amount: 0.5 },
    ],
    allocations: [],
    returnedValueByTransaction,
    voidedPaymentIds: new Set(["p-void"]),
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0.5);
  eqMoney(result["t-s100090"].remaining, 0.31);
}

// Same pool case without the voided set: the voided €1.00 joins the
// pool and covers the whole invoice. Pins the pool leak.
{
  const result = computeCustomerRemainingByTransaction({
    transactions: [transactions[0]],
    payments: [
      { id: "p-void", customerId: "c1", amount: 1 },
      { id: "p-live", customerId: "c1", amount: 0.5 },
    ],
    allocations: [],
    returnedValueByTransaction,
  });
  eqMoney(result["t-s100090"].allocatedAmount, 0.81);
  eqMoney(result["t-s100090"].remaining, 0);
}

// Non-credit invoices use the explicit-only branch: a voided allocation
// there is skipped the same way.
{
  const result = computeCustomerRemainingByTransaction({
    transactions: [
      {
        id: "t-cash",
        customerId: "c1",
        invoiceTotal: 1,
        paymentType: "cash",
        status: "confirmed",
        sortDate: "2026-11-15",
        createdAt: "2026-11-15T11:00:00.000Z",
      },
    ],
    payments,
    allocations: [
      { salesTransactionId: "t-cash", amount: 0.4, customerPaymentId: "p-void" },
    ],
    returnedValueByTransaction,
    voidedPaymentIds: new Set(["p-void"]),
  });
  eqMoney(result["t-cash"].allocatedAmount, 0);
  eqMoney(result["t-cash"].remaining, 1);
}

// The voided set is built from payment rows the way CustomerHistory
// builds it: exactly the rows with voided_at set.
{
  const rows = [
    { id: "p-live", voided_at: null },
    { id: "p-void", voided_at: "2026-11-15T10:00:00.000Z" },
    { id: "p-also-live", voided_at: undefined },
  ];
  const ids = new Set(
    rows.filter((row) => isVoidedPayment(row)).map((row) => String(row.id))
  );
  assert.deepEqual([...ids], ["p-void"]);
}

console.log("test-customer-history-void-fix: all assertions passed");
