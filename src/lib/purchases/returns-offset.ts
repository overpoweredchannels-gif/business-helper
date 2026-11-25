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

// Cash vs credit (2026-11-25, Rule 1): only an explicit "credit"
// purchase is a payable. Cash and card are paid at the moment of the
// purchase — "Paid by construction" (Rule 1) — and contribute 0 to
// outstanding. Anything else (missing, null, or an unrecognised value)
// is treated as paid at entry too, but it is NOT a clean value: it is
// logged as an anomaly so a bad write can never silently hide a payable.
//
// This normalization is the single place the rule lives. The tile
// engine, the supplier-payment candidates, the supplier statement and
// the brain all call these helpers — never re-implement the check.
export type PurchasePaymentType = "credit" | "cash" | "card" | "unknown";

export function normalizePurchasePaymentType(value: unknown): PurchasePaymentType {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized === "credit") return "credit";
  if (normalized === "cash") return "cash";
  if (normalized === "card") return "card";
  return "unknown";
}

// Positive match: ONLY an explicit credit purchase is payable. Every
// other value — cash, card, unknown, null — is paid at entry.
export function isPayablePurchasePaymentType(value: unknown): boolean {
  return normalizePurchasePaymentType(value) === "credit";
}

export function isPaidAtEntryPurchasePaymentType(value: unknown): boolean {
  return !isPayablePurchasePaymentType(value);
}

export interface PurchaseInvoiceAllocationInput {
  purchaseTotal: number;
  returnedAmount: number;
  explicitAllocatedAmount: number;
  legacyPoolAvailable: number;
  // The invoice's payment_type. When it is missing or unrecognised the
  // invoice is treated as paid at entry and an anomaly is logged — a
  // missing type must never silently become a payable.
  paymentType?: string | null;
}

export interface PurchaseInvoiceAllocationNet {
  returnedAmount: number;
  explicitAllocatedAmount: number;
  fallbackAllocatedAmount: number;
  paidAmount: number;
  remainingPayableAmount: number;
  legacyPoolRemaining: number;
  // True when the invoice was paid at entry (cash, card, or an
  // unknown/missing type) — it can never be a payable.
  paidAtEntry: boolean;
  // Explicit payment allocations recorded against a paid-at-entry
  // invoice: money recorded twice (once at entry, once as a payment).
  // The engine ignores them for the payable; the brain reports the
  // count so the anomaly stays visible instead of vanishing.
  ignoredAllocatedAmount: number;
}

// Per-supplier outstanding from the tile's payables stats — the
// Suppliers list and the suppliers export read this, never the dead
// suppliers.outstanding_balance column (always 0.00: no trigger and no
// writer ever updates it).
export function payableBySupplierId(
  stats: ReadonlyArray<{ supplierId: string; remainingPayable: number }>
): Record<string, number> {
  return stats.reduce<Record<string, number>>((byId, stat) => {
    byId[stat.supplierId] = Math.max(0, stat.remainingPayable);
    return byId;
  }, {});
}

// The credit a paid-at-entry purchase posts on the supplier statement:
// the net amount paid at entry (total minus confirmed returns). A
// credit purchase posts 0 — it is still owed. The confirmed return
// itself is a separate credit entry, so netting it here keeps the
// statement's balance effect of a cash purchase at exactly zero.
export function paidAtEntryCreditForPurchase(net: {
  paidAtEntry: boolean;
  paidAmount: number;
}): number {
  return net.paidAtEntry ? Math.max(0, net.paidAmount) : 0;
}

// Per-invoice netting for the payables engine: the returned amount
// offsets the invoice before explicit payment allocations, and the
// legacy unallocated-payment pool only covers what is still owed after
// both. Remaining is floored at 0 — an over-return creates no negative
// payable (there is no supplier-credit ledger to hold it).
//
// Cash rule: a paid-at-entry invoice (cash, card, unknown/missing
// type) is never a payable — remaining is 0, the legacy pool is not
// consumed by it (the pool stays available for credit invoices), and
// paidAmount is the net amount paid at entry (total minus confirmed
// returns). Explicit allocations recorded against it are reported as
// ignoredAllocatedAmount: the money was already counted at entry.
export function netPurchaseInvoiceAllocation(
  input: PurchaseInvoiceAllocationInput
): PurchaseInvoiceAllocationNet {
  const returnedAmount = Math.max(0, input.returnedAmount);
  const explicitAllocatedAmount = Math.max(0, input.explicitAllocatedAmount);
  const paymentType = normalizePurchasePaymentType(input.paymentType);
  if (paymentType !== "credit") {
    if (paymentType === "unknown") {
      console.warn(
        "[cash-vs-credit] purchase invoice payment_type is missing or unknown; treating as paid at entry"
      );
    }
    return {
      returnedAmount,
      explicitAllocatedAmount,
      fallbackAllocatedAmount: 0,
      paidAmount: Math.max(0, input.purchaseTotal - returnedAmount),
      remainingPayableAmount: 0,
      legacyPoolRemaining: Math.max(0, input.legacyPoolAvailable),
      paidAtEntry: true,
      ignoredAllocatedAmount: explicitAllocatedAmount,
    };
  }
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
    paidAtEntry: false,
    ignoredAllocatedAmount: 0,
  };
}
