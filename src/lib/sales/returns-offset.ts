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

export interface CreditInvoiceAllocationInput {
  invoiceTotal: number;
  returnedAmount: number;
  explicitAllocatedAmount: number;
  legacyPoolAvailable: number;
}

export interface CreditInvoiceAllocationNet {
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
