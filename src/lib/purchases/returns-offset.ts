// Purchase-return offset for purchase-invoice payables.
//
// A confirmed purchase return linked to a purchase invoice offsets what
// is still owed to the supplier on it (the goods went back, so that part
// of the invoice is no longer a payable). Unlike sales return lines,
// purchase return lines carry no discount, so a line's returned value is
// quantity × unit price — the same formula the purchase totals use
// (quantity × purchase_price). Each return's value is floored at 0.
// Cancelled returns and returns not linked to an invoice offset nothing.
//
// The write path is POST /api/purchases/returns: it inserts
// purchase_returns with status "confirmed" and purchase_transaction_id
// set to the source invoice's id (or null when unlinked), plus
// purchase_return_items with quantity / unit_price. The computations
// below consume exactly those columns.
//
// Mirror of src/lib/sales/returns-offset.ts for the payables side;
// page.tsx (payables engine + supplier ledger) consumes this module —
// do not fork the logic.

import { safeNumber } from "@/lib/tradeos/validators";

export interface PurchaseReturnOffsetRow {
  id: string;
  purchase_transaction_id?: string | number | null;
  status?: string | null;
}

export interface PurchaseReturnItemOffsetRow {
  purchase_return_id: string | number;
  quantity?: number | string | null;
  unit_price?: number | string | null;
}

// Per-return returned value for every offset-eligible return (not
// cancelled, linked to a purchase invoice), floored at 0 per return.
// The supplier ledger lists one credit entry per return, so it consumes
// this shape; the payables engine consumes the by-transaction totals.
export function computePurchaseReturnValueByReturnId(
  purchaseReturns: readonly PurchaseReturnOffsetRow[],
  purchaseReturnItems: readonly PurchaseReturnItemOffsetRow[]
): Record<string, number> {
  return purchaseReturns
    .filter(
      (purchaseReturn) =>
        purchaseReturn.status !== "cancelled" &&
        purchaseReturn.purchase_transaction_id
    )
    .reduce<Record<string, number>>((values, purchaseReturn) => {
      const returnValue = purchaseReturnItems
        .filter((item) => item.purchase_return_id === purchaseReturn.id)
        .reduce(
          (sum, item) =>
            sum + safeNumber(item.quantity) * safeNumber(item.unit_price),
          0
        );
      values[String(purchaseReturn.id)] = Math.max(0, returnValue);
      return values;
    }, {});
}

export function computeReturnedValueByPurchaseTransaction(
  purchaseReturns: readonly PurchaseReturnOffsetRow[],
  purchaseReturnItems: readonly PurchaseReturnItemOffsetRow[]
): Record<string, number> {
  const valueByReturnId = computePurchaseReturnValueByReturnId(
    purchaseReturns,
    purchaseReturnItems
  );
  return purchaseReturns.reduce<Record<string, number>>(
    (totals, purchaseReturn) => {
      const returnValue = valueByReturnId[String(purchaseReturn.id)];
      if (returnValue === undefined || !purchaseReturn.purchase_transaction_id) {
        return totals;
      }
      const transactionId = String(purchaseReturn.purchase_transaction_id);
      totals[transactionId] = (totals[transactionId] ?? 0) + returnValue;
      return totals;
    },
    {}
  );
}

export interface PurchaseInvoiceAllocationInput {
  purchaseTotal: number;
  returnedAmount: number;
  explicitAllocatedAmount: number;
  legacyPoolAvailable: number;
}

export interface PurchaseInvoiceAllocationNet {
  returnedAmount: number;
  explicitAllocatedAmount: number;
  fallbackAllocatedAmount: number;
  paidAmount: number;
  remainingPayableAmount: number;
  legacyPoolRemaining: number;
}

// Per-invoice netting for the payables engine: the returned amount
// offsets the invoice before explicit payment allocations, and the
// legacy unallocated-payment pool only covers what is still owed after
// both. Remaining is floored at 0 — an over-return creates no negative
// payable (there is no supplier-credit ledger to hold it).
export function netPurchaseInvoiceAllocation(
  input: PurchaseInvoiceAllocationInput
): PurchaseInvoiceAllocationNet {
  const returnedAmount = Math.max(0, input.returnedAmount);
  const explicitAllocatedAmount = Math.max(0, input.explicitAllocatedAmount);
  const remainingAfterExplicitAllocation = Math.max(
    0,
    input.purchaseTotal - returnedAmount - explicitAllocatedAmount
  );
  const fallbackAllocatedAmount = Math.min(
    input.legacyPoolAvailable,
    remainingAfterExplicitAllocation
  );
  return {
    returnedAmount,
    explicitAllocatedAmount,
    fallbackAllocatedAmount,
    paidAmount: explicitAllocatedAmount + fallbackAllocatedAmount,
    remainingPayableAmount: Math.max(
      0,
      remainingAfterExplicitAllocation - fallbackAllocatedAmount
    ),
    legacyPoolRemaining: Math.max(
      0,
      input.legacyPoolAvailable - fallbackAllocatedAmount
    ),
  };
}
