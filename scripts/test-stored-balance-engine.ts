import assert from "node:assert/strict";
import {
  deriveCustomerOutstanding,
  reconcileCustomerBalance,
  type BalanceAllocationRow,
  type BalanceInvoiceRow,
  type BalancePaymentRow,
  type CustomerBalanceLedgerInput,
} from "../src/lib/accounting/customer-balance";
import { computeReturnedValueBySalesTransaction } from "../src/lib/sales/returns-offset";

// Regression tests for the permanent stored-balance engine
// (UMAIR-approved 2026-11-16): a customer's outstanding balance is ALWAYS
//   Credit Sales − Confirmed Returns − Non-Voided Payments
// for every customer in every organization, maintained atomically by the
// database (production_phase23_stored_balance_engine.sql). This suite locks
// the TypeScript side of the same formula; the SQL side implements it
// identically (customer_derived_outstanding). Both must stay green together.
//
// Fixtures are shaped like the ledger tables the engine consumes:
//   sales_transactions: id, customer_id, total_amount, payment_type, status,
//                       sale_date, created_at
//   sales_returns:      id, sales_transaction_id, status
//   sales_return_items: sales_return_id, quantity, unit_price, discount
//   customer_payments:  id, customer_id, amount, voided_at
//   customer_payment_allocations: sales_transaction_id, amount, customer_payment_id

const CUSTOMER = "22222222-2222-4222-8222-222222222222";

const invoice = (overrides: Partial<BalanceInvoiceRow> & { id: string }): BalanceInvoiceRow => ({
  customerId: CUSTOMER,
  invoiceTotal: 100,
  paymentType: "credit",
  status: "confirmed",
  sortDate: "2026-11-01",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const payment = (overrides: Partial<BalancePaymentRow> & { id: string }): BalancePaymentRow => ({
  customerId: CUSTOMER,
  amount: 0,
  voidedAt: null,
  ...overrides,
});

const allocation = (overrides: Partial<BalanceAllocationRow>): BalanceAllocationRow => ({
  salesTransactionId: "tx-1",
  amount: 0,
  customerPaymentId: "pay-1",
  ...overrides,
});

const baseInput = (overrides: Partial<CustomerBalanceLedgerInput> = {}): CustomerBalanceLedgerInput => ({
  transactions: [],
  payments: [],
  allocations: [],
  returns: [],
  returnItems: [],
  ...overrides,
});

// ── 1. Credit sale increases outstanding ────────────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({ transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })] })
  );
  assert.equal(summary.outstanding, 310, "One credit invoice of 310 with nothing else owes 310");
  assert.equal(summary.creditSales, 310);
  assert.equal(summary.paymentsApplied, 0);
  assert.equal(summary.returnsCredited, 0);
}

// ── 2. Payment decreases outstanding (explicit allocation) ──────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      payments: [payment({ id: "pay-1", amount: 200 })],
      allocations: [allocation({ salesTransactionId: "tx-1", amount: 200, customerPaymentId: "pay-1" })],
    })
  );
  assert.equal(summary.outstanding, 110, "310 − 200 paid = 110");
  assert.equal(summary.paymentsApplied, 200);
  assert.equal(
    summary.creditSales - summary.paymentsApplied - summary.returnsCredited,
    summary.outstanding,
    "identity must hold"
  );
}

// ── 3. Void restores: a voided payment covers nothing ───────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      payments: [payment({ id: "pay-1", amount: 200, voidedAt: "2026-11-02T10:00:00.000Z" })],
      allocations: [allocation({ salesTransactionId: "tx-1", amount: 200, customerPaymentId: "pay-1" })],
    })
  );
  assert.equal(summary.outstanding, 310, "Voided payment's allocation must not cover the invoice");
  assert.equal(summary.paymentsApplied, 0, "Voided payment applies 0");
}

// ── 4. Voided payment leaves the FIFO pool too ──────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [
        invoice({ id: "tx-1", invoiceTotal: 310, sortDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z" }),
        invoice({ id: "tx-2", invoiceTotal: 100, sortDate: "2026-11-02", createdAt: "2026-11-02T10:00:00.000Z" }),
      ],
      payments: [
        payment({ id: "pay-1", amount: 200 }),
        payment({ id: "pay-2", amount: 50, voidedAt: "2026-11-03T10:00:00.000Z" }),
      ],
      allocations: [],
    })
  );
  // Live pool = 200 (the voided 50 contributes nothing). FIFO: tx-1 takes
  // 200, tx-2 takes 0 → outstanding 110 + 100 = 210.
  assert.equal(summary.outstanding, 210, "Voided 50 must not enter the pool (else outstanding would be 160)");
  assert.equal(summary.paymentsApplied, 200);
}

// ── 5. Confirmed return decreases outstanding ───────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      returns: [{ id: "ret-1", sales_transaction_id: "tx-1", status: "confirmed" }],
      returnItems: [{ sales_return_id: "ret-1", quantity: 1, unit_price: 155, discount: 0 }],
    })
  );
  assert.equal(summary.outstanding, 155, "310 − 155 returned = 155");
  assert.equal(summary.returnsCredited, 155);
}

// ── 6. Cancelled return does NOT decrease ───────────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      returns: [{ id: "ret-1", sales_transaction_id: "tx-1", status: "cancelled" }],
      returnItems: [{ sales_return_id: "ret-1", quantity: 1, unit_price: 155, discount: 0 }],
    })
  );
  assert.equal(summary.outstanding, 310, "Cancelled return offsets nothing");
  assert.equal(summary.returnsCredited, 0);
  const map = computeReturnedValueBySalesTransaction(
    [{ id: "ret-1", sales_transaction_id: "tx-1", status: "cancelled" }],
    [{ sales_return_id: "ret-1", quantity: 1, unit_price: 155, discount: 0 }]
  );
  assert.equal(map["tx-1"], undefined, "Cancelled return must not appear in the returned map");
}

// ── 7. Unallocated payment applies FIFO to the oldest invoice ──────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [
        invoice({ id: "tx-1", invoiceTotal: 300, sortDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z" }),
        invoice({ id: "tx-2", invoiceTotal: 200, sortDate: "2026-11-02", createdAt: "2026-11-02T10:00:00.000Z" }),
      ],
      payments: [payment({ id: "pay-1", amount: 350 })],
      allocations: [],
    })
  );
  assert.equal(summary.outstanding, 150, "Pool 350 covers tx-1 (300) then 50 of tx-2 → 150 left");
  assert.equal(summary.paymentsApplied, 350);
}

// ── 8. Over-return floors at 0 — no negative receivable ─────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      returns: [{ id: "ret-1", sales_transaction_id: "tx-1", status: "confirmed" }],
      returnItems: [{ sales_return_id: "ret-1", quantity: 1, unit_price: 400, discount: 0 }],
    })
  );
  assert.equal(summary.outstanding, 0, "Over-return floors at 0");
  assert.equal(summary.returnsCredited, 310, "Effective return is capped at the invoice total");
}

// ── 9. Cash / card sales contribute 0 ───────────────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [
        invoice({ id: "tx-1", invoiceTotal: 310 }),
        invoice({ id: "tx-2", invoiceTotal: 500, paymentType: "cash" }),
        invoice({ id: "tx-3", invoiceTotal: 200, paymentType: "card" }),
      ],
    })
  );
  assert.equal(summary.creditSales, 310, "Only credit invoices count as credit sales");
  assert.equal(summary.outstanding, 310);
}

// ── 10. Cancelled / void invoices are excluded ──────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [
        invoice({ id: "tx-1", invoiceTotal: 310 }),
        invoice({ id: "tx-2", invoiceTotal: 400, status: "cancelled" }),
        invoice({ id: "tx-3", invoiceTotal: 200, status: "void" }),
      ],
    })
  );
  assert.equal(summary.creditSales, 310, "Cancelled/void invoices are not receivables");
  assert.equal(summary.outstanding, 310);
}

// ── 11. The QA-M1 identity: 500 − 350 − 100 = 50 ───────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 500 })],
      payments: [payment({ id: "pay-1", amount: 350 })],
      allocations: [allocation({ salesTransactionId: "tx-1", amount: 350, customerPaymentId: "pay-1" })],
      returns: [{ id: "ret-1", sales_transaction_id: "tx-1", status: "confirmed" }],
      returnItems: [{ sales_return_id: "ret-1", quantity: 1, unit_price: 100, discount: 0 }],
    })
  );
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

// ── 12. Reconciliation helper ───────────────────────────────────────────────
{
  // The AL FAZL case shape: stored 0.00, derived 97.14 → drift −97.14.
  const drifted = reconcileCustomerBalance(0, 97.14);
  assert.equal(drifted.stored, 0);
  assert.equal(drifted.derived, 97.14);
  assert.equal(drifted.drift, -97.14);
  assert.equal(drifted.inSync, false, "A 97.14 drift is out of sync");

  const synced = reconcileCustomerBalance(97.14, 97.14);
  assert.equal(synced.inSync, true, "Equal stored and derived is in sync");
  assert.equal(synced.drift, 0);

  // Sub-cent JS float noise is not drift.
  const noise = reconcileCustomerBalance(97.14000000000001, 97.14);
  assert.equal(noise.inSync, true, "Sub-cent noise must not flag drift");

  // Null stored balance reads as 0.
  const nullStored = reconcileCustomerBalance(null, 34.01);
  assert.equal(nullStored.stored, 0);
  assert.equal(nullStored.inSync, false);
}

// ── 13. Mixed voided + live payments ────────────────────────────────────────
{
  const summary = deriveCustomerOutstanding(
    baseInput({
      transactions: [invoice({ id: "tx-1", invoiceTotal: 310 })],
      payments: [
        payment({ id: "pay-1", amount: 200 }),
        payment({ id: "pay-2", amount: 100, voidedAt: "2026-11-02T10:00:00.000Z" }),
      ],
      allocations: [
        allocation({ salesTransactionId: "tx-1", amount: 200, customerPaymentId: "pay-1" }),
        allocation({ salesTransactionId: "tx-1", amount: 100, customerPaymentId: "pay-2" }),
      ],
    })
  );
  assert.equal(summary.outstanding, 110, "Only the live 200 counts; the voided 100 is ignored");
  assert.equal(summary.paymentsApplied, 200);
}

console.log(
  "Stored-balance engine tests passed: credit sale increases, payment decreases, void restores (allocation + pool), confirmed return decreases, cancelled return does not, FIFO pool, over-return floor, cash/card contribute 0, cancelled/void invoices excluded, QA-M1 identity (500 − 350 − 100 = 50), reconciliation helper (drift / in-sync / sub-cent noise)."
);
