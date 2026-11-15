// Void exclusion for payment-derived totals.
//
// The void RPC (void_payment_atomic, phase 15) marks a payment voided_at
// and restores the party's stored outstanding balance, but it does NOT
// delete the payment's allocation rows (by design — the comment at
// page.tsx ~10778 says consumers must skip allocations that belong to a
// voided payment). The allocation engines already do that
// (voidedCustomerPaymentIds / voidedSupplierPaymentIds in page.tsx), which
// is why a voided payment correctly stops covering its invoices. These
// helpers give every OTHER payment-derived total the same exclusion, so
// the Supplier Ledger, the payment history cards, the dashboard tiles,
// the AI summary and the suppliers CSV all agree with the engines:
// a voided payment counts toward nothing except its own audit record
// (the history card still shows the payment row with its "Voided" badge).

import { safeNumber } from "../tradeos/validators";

export type VoidablePayment = {
  voided_at?: string | null;
  amount?: unknown;
};

// A payment is voided exactly when voided_at is set (any non-null value).
export function isVoidedPayment(payment: VoidablePayment | null | undefined): boolean {
  return Boolean(payment?.voided_at);
}

// Drop voided payments from a list. Use wherever a total, balance or
// allocation is derived from payment rows.
export function excludeVoidedPayments<T extends VoidablePayment>(
  payments: readonly T[]
): T[] {
  return payments.filter((payment) => !isVoidedPayment(payment));
}

export interface PaymentAllocationLike {
  amount: number;
}

export interface PaymentHistoryAmounts<TAllocation> {
  allocations: TAllocation[];
  explicitlyAllocatedAmount: number;
  unallocatedAmount: number;
  allocationExceedsPayment: boolean;
}

// The amounts a payment history card shows. A voided payment covers
// nothing: its allocation rows are hidden and both amounts are zero, so
// the card cannot present it as still covering invoices. The payment
// amount itself is untouched — the card remains the audit record of a
// payment of that amount, now marked Voided.
export function historyAmountsForPayment<TAllocation extends PaymentAllocationLike>(
  payment: VoidablePayment | null | undefined,
  allocations: readonly TAllocation[]
): PaymentHistoryAmounts<TAllocation> {
  if (isVoidedPayment(payment)) {
    return {
      allocations: [],
      explicitlyAllocatedAmount: 0,
      unallocatedAmount: 0,
      allocationExceedsPayment: false,
    };
  }
  const explicitlyAllocatedAmount = allocations.reduce(
    (sum, allocation) => sum + safeNumber(allocation.amount),
    0
  );
  const paymentAmount = safeNumber(payment?.amount);
  return {
    allocations: [...allocations],
    explicitlyAllocatedAmount,
    unallocatedAmount: Math.max(0, paymentAmount - explicitlyAllocatedAmount),
    allocationExceedsPayment: explicitlyAllocatedAmount > paymentAmount,
  };
}
