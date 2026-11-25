// Sales-return offset for credit-invoice receivables.
//
// A confirmed sales return linked to a credit invoice offsets what the
// customer still owes on it (the goods came back, so that part of the
// invoice is no longer a receivable). Return lines carry the invoice
// line's price and discount, so a line's returned value mirrors the
// sales-line value formula (quantity × unit price − discount), floored
// at 0 per return. Cancelled returns and returns not linked to an
// invoice offset nothing.
//
// The write path is POST /api/sales/returns: it inserts sales_returns
// with status "confirmed" and sales_transaction_id set to the source
// invoice's id, plus sales_return_items with quantity / unit_price /
// discount. The computations below consume exactly those columns.
//
// Extracted verbatim from src/app/page.tsx (commit b065e1f) so the
// receivables engine's arithmetic is unit-testable; page.tsx and
// CustomerHistory both consume this module — do not fork the logic.

import { safeNumber } from "@/lib/tradeos/validators";

export interface SalesReturnOffsetRow {
  id: string;
  sales_transaction_id?: string | number | null;
  status?: string | null;
}

export interface SalesReturnItemOffsetRow {
  sales_return_id: string | number;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount?: number | string | null;
}

export function computeReturnedValueBySalesTransaction(
  salesReturns: readonly SalesReturnOffsetRow[],
  salesReturnItems: readonly SalesReturnItemOffsetRow[]
): Record<string, number> {
  return salesReturns
    .filter(
      (salesReturn) =>
        salesReturn.status !== "cancelled" && salesReturn.sales_transaction_id
    )
    .reduce<Record<string, number>>((totals, salesReturn) => {
      const transactionId = String(salesReturn.sales_transaction_id);
      const returnValue = salesReturnItems
        .filter((item) => item.sales_return_id === salesReturn.id)
        .reduce(
          (sum, item) =>
            sum +
            safeNumber(item.quantity) * safeNumber(item.unit_price) -
            safeNumber(item.discount),
          0
        );
      totals[transactionId] =
        (totals[transactionId] ?? 0) + Math.max(0, returnValue);
      return totals;
    }, {});
}

// ─── Sales invoice net total (J1b receivables fix) ──────────────────────────
//
// The dashboard tile's sales invoice total (page.tsx
// salesInvoiceTotalsByTransaction): the STORED total_amount when finite
// and > 0, else a recompute matching the save path — Σ(qty × price −
// line discount) − |invoice discount|, floored at 0, plus tax%. The
// brain's customer ledger used the plain item sum (qty × price), so a
// discounted/taxed credit invoice overstated the receivable (on
// production data: J1b receivables +€1.33 vs the tile). The ledger must
// use this same total — do not fork the formula.

export interface SalesInvoiceNetTotalTransactionRow {
  total_amount?: number | string | null;
  discount_amount?: number | string | null;
  tax_rate?: number | string | null;
}

export interface SalesInvoiceNetTotalItemRow {
  quantity?: number | string | null;
  selling_price?: number | string | null;
  discount?: number | string | null;
}

export function computeSalesInvoiceNetTotal(
  transaction: SalesInvoiceNetTotalTransactionRow,
  items: readonly SalesInvoiceNetTotalItemRow[]
): number {
  const storedTotal = Number(transaction.total_amount ?? 0);
  if (Number.isFinite(storedTotal) && storedTotal > 0) return storedTotal;
  // Fallback: recompute net-of-discount subtotal + tax, matching the save path.
  const lineSubtotal = items.reduce(
    (sum, item) =>
      sum +
      safeNumber(item.quantity) * safeNumber(item.selling_price) -
      safeNumber(item.discount),
    0
  );
  const invoiceDiscount = Math.abs(safeNumber(transaction.discount_amount));
  const taxRate = safeNumber(transaction.tax_rate);
  const taxableBase = Math.max(0, lineSubtotal - invoiceDiscount);
  return taxableBase + (taxableBase * taxRate) / 100;
}

export interface CreditInvoiceAllocationInput {
  invoiceTotal: number;
  returnedAmount: number;
  explicitAllocatedAmount: number;
  legacyPoolAvailable: number;
}export interface CreditInvoiceAllocationNet {
  returnedAmount: number;
  explicitAllocatedAmount: number;
  fallbackAllocatedAmount: number;
  allocatedAmount: number;
  remainingUnpaidAmount: number;
  legacyPoolRemaining: number;
}

// Per-invoice netting from the credit allocation engine: the returned
// amount offsets the invoice before explicit payment allocations, and
// the legacy unallocated-payment pool only covers what is still owed
// after both. Remaining is floored at 0 — an over-return creates no
// negative receivable (there is no customer-credit ledger to hold it).
export function netCreditInvoiceAllocation(
  input: CreditInvoiceAllocationInput
): CreditInvoiceAllocationNet {
  const returnedAmount = Math.max(0, input.returnedAmount);
  const explicitAllocatedAmount = Math.max(0, input.explicitAllocatedAmount);
  const remainingAfterExplicitAllocation = Math.max(
    0,
    input.invoiceTotal - returnedAmount - explicitAllocatedAmount
  );
  const fallbackAllocatedAmount = Math.min(
    input.legacyPoolAvailable,
    remainingAfterExplicitAllocation
  );
  return {
    returnedAmount,
    explicitAllocatedAmount,
    fallbackAllocatedAmount,
    allocatedAmount: explicitAllocatedAmount + fallbackAllocatedAmount,
    remainingUnpaidAmount: Math.max(
      0,
      remainingAfterExplicitAllocation - fallbackAllocatedAmount
    ),
    legacyPoolRemaining: Math.max(
      0,
      input.legacyPoolAvailable - fallbackAllocatedAmount
    ),
  };
}

// ─── FIFO credit allocation engine ──────────────────────────────────────────
//
// The receivables engine's ordering, extracted from page.tsx so Customer
// History runs the SAME computation (M1 decision 3, UMAIR-approved
// 2026-10-22). Invoices are processed oldest first (sale date, then
// creation time); each customer's unallocated-payment pool — total payments
// minus payments already allocated explicitly — is applied FIFO across
// their open credit invoices, after returns and explicit allocations
// (netCreditInvoiceAllocation). History previously counted only explicit
// allocations, overstating what customers owed (production: REHAN PSO
// History Rs 265,850 vs Receivables Rs 0).

export interface CreditAllocationInvoiceRow {
  id: string;
  customerId: string;
  invoiceTotal: number;
  returnedAmount: number;
  explicitAllocatedAmount: number;
  /** Date-only ordering key ("YYYY-MM-DD"); "" sorts first, as in page.tsx. */
  sortDate: string;
  /** ISO creation timestamp; tie-breaks equal sortDates, as in page.tsx. */
  createdAt: string;
}

export interface CreditAllocationResult extends CreditInvoiceAllocationNet {
  invoiceTotal: number;
}

export function computeCreditAllocationsByTransaction(
  invoices: readonly CreditAllocationInvoiceRow[],
  unallocatedPoolByCustomer: Readonly<Record<string, number>>
): Record<string, CreditAllocationResult> {
  const poolByCustomer: Record<string, number> = { ...unallocatedPoolByCustomer };
  const ordered = [...invoices].sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate.localeCompare(b.sortDate);
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const allocations: Record<string, CreditAllocationResult> = {};
  for (const invoice of ordered) {
    const net = netCreditInvoiceAllocation({
      invoiceTotal: invoice.invoiceTotal,
      returnedAmount: invoice.returnedAmount,
      explicitAllocatedAmount: invoice.explicitAllocatedAmount,
      legacyPoolAvailable: poolByCustomer[invoice.customerId] ?? 0,
    });
    poolByCustomer[invoice.customerId] = net.legacyPoolRemaining;
    allocations[invoice.id] = { invoiceTotal: invoice.invoiceTotal, ...net };
  }
  return allocations;
}

// ─── Customer Credit summary (QA fix round, 2026-10-23) ───────────────────
//
// The Receivables Dashboard used to place three independently-computed
// figures side by side: credit-only Total Sales, ALL customer payments
// (including the auto-payments the atomic sale RPC writes for CASH sales),
// and the engine's remaining — which also nets returns. The row could not
// reconcile on its face (500 − 350 ≠ 50 with the offsetting return
// invisible; a cash-only customer showed Total Sales 0 / Payments 270.45).
// This summary derives every figure from the SAME allocation results the
// outstanding already came from, so for every customer:
//
//   creditSales − paymentsApplied − returnsCredited = outstanding
//
// holds exactly. returnsCredited is the EFFECTIVE return offset: when an
// invoice was over-returned, the engine caps the receivable at 0 (no
// customer-credit ledger exists), so the capped excess is not shown as
// credit — the effective amount is what actually offset the invoice.

export interface CustomerCreditSummary {
  creditSales: number;
  paymentsApplied: number;
  returnsCredited: number;
  outstanding: number;
}

export function summarizeCustomerCredit(
  allocations: readonly CreditAllocationResult[]
): CustomerCreditSummary {
  let creditSales = 0;
  let paymentsApplied = 0;
  let returnsCredited = 0;
  let outstanding = 0;
  for (const allocation of allocations) {
    const invoiceTotal = Math.max(0, allocation.invoiceTotal);
    const allocated = Math.max(0, allocation.allocatedAmount);
    const remaining = Math.max(0, allocation.remainingUnpaidAmount);
    const effectiveReturned = Math.min(
      Math.max(0, allocation.returnedAmount),
      Math.max(0, invoiceTotal - allocated - remaining)
    );
    creditSales += invoiceTotal;
    paymentsApplied += allocated;
    returnsCredited += effectiveReturned;
    outstanding += remaining;
  }
  return { creditSales, paymentsApplied, returnsCredited, outstanding };
}

// Per-transaction remaining for Customer History, mirroring the receivables
// engine's inputs exactly: the pool per customer is total payments minus
// explicit allocations across ALL of that customer's transactions (the
// engine's definition); the FIFO runs over the customer's CREDIT invoices
// (the engine's set), restricted to the non-cancelled/non-void documents
// History displays. Non-credit invoices never draw on the pool — their
// remaining is total − returns − explicit allocations, floored at 0.

export interface HistoryTransactionRow {
  id: string;
  customerId: string | null;
  invoiceTotal: number;
  paymentType?: string | null;
  status?: string | null;
  sortDate: string;
  createdAt: string;
}

export interface HistoryPaymentRow {
  /** Payment id — used to match a payment against `voidedPaymentIds`. */
  id?: string | null;
  customerId: string | null;
  amount: number;
}

export interface HistoryAllocationRow {
  salesTransactionId: string;
  amount: number;
  /** Owning payment — allocations of a voided payment are skipped. */
  customerPaymentId?: string | null;
}

export interface CustomerRemainingResult {
  remaining: number;
  /** Amount covered by payments (explicit + FIFO pool share). */
  allocatedAmount: number;
  returnedAmount: number;
}

export function computeCustomerRemainingByTransaction(input: {
  transactions: readonly HistoryTransactionRow[];
  payments: readonly HistoryPaymentRow[];
  allocations: readonly HistoryAllocationRow[];
  returnedValueByTransaction: Readonly<Record<string, number>>;
  /**
   * Ids of voided payments. The void RPC marks a payment voided_at but
   * does NOT delete its allocation rows (by design), so a voided payment's
   * allocations must be skipped here — otherwise the voided payment stays
   * counted as applied and its invoice never shows unpaid again (the same
   * rule the receivables engine in page.tsx applies via
   * voidedCustomerPaymentIds). A voided payment also leaves the FIFO pool:
   * it contributes nothing to total payments. Omitted = no voided payments,
   * behaviour unchanged.
   */
  voidedPaymentIds?: ReadonlySet<string>;
}): Record<string, CustomerRemainingResult> {
  const visible = input.transactions.filter(
    (transaction) => !["cancelled", "void"].includes(String(transaction.status ?? ""))
  );
  // Customer attribution for pool inputs uses ALL transactions, matching the
  // receivables engine (its pool is total payments − explicit allocations
  // per customer, computed before any status filtering). Only the FIFO set
  // and the returned remainings are restricted to visible documents.
  const allById = new Map(input.transactions.map((transaction) => [transaction.id, transaction]));
  const voidedPaymentIds = input.voidedPaymentIds ?? new Set<string>();

  const explicitByTransaction: Record<string, number> = {};
  const explicitByCustomer: Record<string, number> = {};
  for (const allocation of input.allocations) {
    if (voidedPaymentIds.has(String(allocation.customerPaymentId ?? ""))) continue;
    const transaction = allById.get(String(allocation.salesTransactionId));
    const amount = Math.max(0, safeNumber(allocation.amount));
    explicitByTransaction[String(allocation.salesTransactionId)] =
      (explicitByTransaction[String(allocation.salesTransactionId)] ?? 0) + amount;
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

  const creditInvoices: CreditAllocationInvoiceRow[] = visible
    .filter((transaction) => transaction.paymentType === "credit" && transaction.customerId)
    .map((transaction) => ({
      id: transaction.id,
      customerId: String(transaction.customerId),
      invoiceTotal: transaction.invoiceTotal,
      returnedAmount: input.returnedValueByTransaction[transaction.id] ?? 0,
      explicitAllocatedAmount: explicitByTransaction[transaction.id] ?? 0,
      sortDate: transaction.sortDate,
      createdAt: transaction.createdAt,
    }));
  const creditAllocations = computeCreditAllocationsByTransaction(creditInvoices, poolByCustomer);

  const remaining: Record<string, CustomerRemainingResult> = {};
  for (const transaction of visible) {
    const returnedAmount = Math.max(
      0,
      input.returnedValueByTransaction[transaction.id] ?? 0
    );
    const credit = creditAllocations[transaction.id];
    if (credit) {
      remaining[transaction.id] = {
        remaining: credit.remainingUnpaidAmount,
        allocatedAmount: credit.allocatedAmount,
        returnedAmount: credit.returnedAmount,
      };
    } else {
      const explicit = explicitByTransaction[transaction.id] ?? 0;
      const remainingAmount = Math.max(
        0,
        transaction.invoiceTotal - returnedAmount - explicit
      );
      remaining[transaction.id] = {
        remaining: remainingAmount,
        allocatedAmount: Math.max(
          0,
          transaction.invoiceTotal - returnedAmount - remainingAmount
        ),
        returnedAmount,
      };
    }
  }
  return remaining;
}
