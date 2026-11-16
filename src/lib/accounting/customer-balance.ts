// Single Source of Truth — customer outstanding balance (TypeScript side).
//
// Formula (UMAIR-approved 2026-11-16, permanent for EVERY customer in EVERY
// organization):
//
//   outstanding = Credit Sales − Confirmed Returns − Non-Voided Payments
//
// Rules, all of which the SQL side enforces identically
// (customer_derived_outstanding in
// src/lib/migrations/production_phase23_stored_balance_engine.sql):
//   - Credit Sales: credit invoices only (payment_type = 'credit'), status
//     not 'cancelled' / 'void'. Cash/card sales are Paid by construction
//     and contribute 0 to outstanding.
//   - Confirmed Returns: returns with status <> 'cancelled' and linked to
//     the invoice. A cancelled return offsets nothing. A return's value is
//     quantity × unit_price − discount per line, floored at 0 per return.
//   - Non-Voided Payments: payments with voided_at IS NULL. A voided
//     payment — and its allocation rows — cover nothing. The void RPC
//     marks voided_at but does NOT delete allocations (by design), so
//     every consumer must skip allocations belonging to a voided payment.
//   - Unallocated payments apply FIFO to the customer's oldest open credit
//     invoices (after returns and explicit allocations).
//   - Remaining is floored at 0 per invoice — an over-return creates no
//     negative receivable (there is no customer-credit ledger to hold it).
//
// This module does NOT reimplement the arithmetic. It wraps the proven
// receivables engine in src/lib/sales/returns-offset.ts
// (computeCreditAllocationsByTransaction / summarizeCustomerCredit /
// computeReturnedValueBySalesTransaction) so the formula has ONE named
// entry point in TS. Do not fork the logic: any change to the formula
// changes BOTH the TS side (here) and the SQL side together, and both
// test suites must stay green.

import {
  computeCreditAllocationsByTransaction,
  computeReturnedValueBySalesTransaction,
  summarizeCustomerCredit,
  type CreditAllocationInvoiceRow,
  type CustomerCreditSummary,
  type SalesReturnItemOffsetRow,
  type SalesReturnOffsetRow,
} from "@/lib/sales/returns-offset";
import { safeNumber } from "@/lib/tradeos/validators";

export type { CustomerCreditSummary };

/** One credit invoice as the engine consumes it. */
export interface BalanceInvoiceRow {
  id: string;
  customerId: string;
  /** Invoice total (total_amount; the line-total fallback lives in SQL only). */
  invoiceTotal: number;
  paymentType?: string | null;
  status?: string | null;
  /** Date-only ordering key ("YYYY-MM-DD"); "" sorts first, as in the engine. */
  sortDate: string;
  /** ISO creation timestamp; tie-breaks equal sortDates, as in the engine. */
  createdAt: string;
}

/** One customer payment as the engine consumes it. */
export interface BalancePaymentRow {
  id?: string | null;
  customerId: string | null;
  amount: number;
  /** Set when the payment is voided — voided payments cover nothing. */
  voidedAt?: string | null;
}

/** One explicit payment→invoice allocation as the engine consumes it. */
export interface BalanceAllocationRow {
  salesTransactionId: string;
  amount: number;
  /** Owning payment — allocations of a voided payment are skipped. */
  customerPaymentId?: string | null;
}

export interface CustomerBalanceLedgerInput {
  /** All of the customer's sales transactions (credit and non-credit). */
  transactions: readonly BalanceInvoiceRow[];
  /** All of the customer's payments (voided and live). */
  payments: readonly BalancePaymentRow[];
  /** Explicit allocations against the customer's invoices. */
  allocations: readonly BalanceAllocationRow[];
  /** Sales returns (confirmed and cancelled) linked to the customer's invoices. */
  returns: readonly SalesReturnOffsetRow[];
  /** Lines of those returns. */
  returnItems: readonly SalesReturnItemOffsetRow[];
}

/**
 * Derive a customer's outstanding balance from the ledger rows, using the
 * Single Source of Truth formula. Returns the full summary so the identity
 *   creditSales − paymentsApplied − returnsCredited = outstanding
 * holds exactly (see summarizeCustomerCredit).
 */
export function deriveCustomerOutstanding(
  input: CustomerBalanceLedgerInput
): CustomerCreditSummary {
  const returnedValueByTransaction = computeReturnedValueBySalesTransaction(
    input.returns,
    input.returnItems
  );

  const voidedPaymentIds = new Set<string>();
  for (const payment of input.payments) {
    if (payment.id != null && payment.voidedAt != null && payment.voidedAt !== "") {
      voidedPaymentIds.add(String(payment.id));
    }
  }

  const explicitByTransaction: Record<string, number> = {};
  const explicitByCustomer: Record<string, number> = {};
  for (const allocation of input.allocations) {
    if (voidedPaymentIds.has(String(allocation.customerPaymentId ?? ""))) continue;
    const amount = Math.max(0, safeNumber(allocation.amount));
    explicitByTransaction[String(allocation.salesTransactionId)] =
      (explicitByTransaction[String(allocation.salesTransactionId)] ?? 0) + amount;
    // Attribution needs the invoice's customer; resolve it from the
    // transaction list (the engine's pool is per customer).
    const transaction = input.transactions.find(
      (row) => String(row.id) === String(allocation.salesTransactionId)
    );
    if (transaction?.customerId) {
      explicitByCustomer[transaction.customerId] =
        (explicitByCustomer[transaction.customerId] ?? 0) + amount;
    }
  }

  const totalPaymentsByCustomer: Record<string, number> = {};
  for (const payment of input.payments) {
    if (!payment.customerId) continue;
    if (payment.id != null && voidedPaymentIds.has(String(payment.id))) continue;
    totalPaymentsByCustomer[payment.customerId] =
      (totalPaymentsByCustomer[payment.customerId] ?? 0) + safeNumber(payment.amount);
  }
  const poolByCustomer: Record<string, number> = {};
  for (const customerId of Object.keys(totalPaymentsByCustomer)) {
    poolByCustomer[customerId] = Math.max(
      0,
      totalPaymentsByCustomer[customerId] - (explicitByCustomer[customerId] ?? 0)
    );
  }

  const creditInvoices: CreditAllocationInvoiceRow[] = input.transactions
    .filter(
      (transaction) =>
        transaction.paymentType === "credit" &&
        transaction.customerId &&
        !["cancelled", "void"].includes(String(transaction.status ?? ""))
    )
    .map((transaction) => ({
      id: transaction.id,
      customerId: String(transaction.customerId),
      invoiceTotal: transaction.invoiceTotal,
      returnedAmount: returnedValueByTransaction[transaction.id] ?? 0,
      explicitAllocatedAmount: explicitByTransaction[transaction.id] ?? 0,
      sortDate: transaction.sortDate,
      createdAt: transaction.createdAt,
    }));

  const allocations = computeCreditAllocationsByTransaction(creditInvoices, poolByCustomer);
  return summarizeCustomerCredit(Object.values(allocations));
}

export interface BalanceReconciliation {
  stored: number;
  derived: number;
  /** stored − derived. Positive = stored is too high; negative = too low. */
  drift: number;
  /** True when |drift| is within tolerance (sub-cent float noise is not drift). */
  inSync: boolean;
}

/**
 * Compare a stored outstanding balance against the derived figure.
 * Tolerance defaults to 0.01 (one cent) — JS float noise below a cent is
 * not drift. The SQL side compares exactly (Postgres numeric is exact);
 * the TS side needs the tolerance because the audit script runs in JS.
 */
export function reconcileCustomerBalance(
  storedBalance: number | null | undefined,
  derivedBalance: number,
  tolerance = 0.01
): BalanceReconciliation {
  const stored = safeNumber(storedBalance ?? 0);
  const derived = Math.max(0, safeNumber(derivedBalance));
  const drift = stored - derived;
  return { stored, derived, drift, inSync: Math.abs(drift) <= tolerance };
}
