// Cancel returns through the atomic RPCs (returns-depth slice).
//
// The browser never deletes a return any more: one cancel_*_return_atomic
// call flips the status to 'cancelled', writes the compensating stock
// movement the item-DELETE trigger would have written, and writes the audit
// row — one transaction. The cancelled row stays in history; nothing is
// hard-deleted. The money side needs no write: the receivables/payables
// engines already exclude cancelled returns, so the offset restores itself
// the moment the status flips.
//
// Mirrors voidPaymentAtomic (src/lib/payments/submit-payment.ts): one
// in-flight cancel per return (a double-click while a cancel is pending
// returns the same promise), and the RPC result is validated before it is
// trusted. The status guard inside the RPC is the idempotency — a second
// cancel errors instead of reversing stock twice — so no request key is
// stored on the return row.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CancelReturnResult {
  return_id: string;
  return_number: string;
  status: string;
  cancelled: boolean;
}

const inFlightSalesCancels = new Map<string, Promise<CancelReturnResult>>();
const inFlightPurchaseCancels = new Map<string, Promise<CancelReturnResult>>();

function validateCancelResult(data: unknown): CancelReturnResult {
  const result = data as CancelReturnResult | null;
  if (!result || typeof result.return_id !== "string" || result.return_id === "") {
    throw new Error("Return could not be cancelled. Please retry.");
  }
  return result;
}

/** Cancel one confirmed sales return through the atomic RPC. */
export async function cancelSalesReturnAtomic(
  client: SupabaseClient,
  returnId: string
): Promise<CancelReturnResult> {
  const existing = inFlightSalesCancels.get(returnId);
  if (existing) return existing;

  const promise = (async (): Promise<CancelReturnResult> => {
    const { data, error } = await client.rpc("cancel_sales_return_atomic", {
      p_return_id: returnId,
    });
    if (error) throw new Error(error.message || "Return could not be cancelled. Please retry.");
    return validateCancelResult(data);
  })();

  inFlightSalesCancels.set(returnId, promise);
  try {
    return await promise;
  } finally {
    if (inFlightSalesCancels.get(returnId) === promise) inFlightSalesCancels.delete(returnId);
  }
}

/** Cancel one confirmed purchase return through the atomic RPC. */
export async function cancelPurchaseReturnAtomic(
  client: SupabaseClient,
  returnId: string
): Promise<CancelReturnResult> {
  const existing = inFlightPurchaseCancels.get(returnId);
  if (existing) return existing;

  const promise = (async (): Promise<CancelReturnResult> => {
    const { data, error } = await client.rpc("cancel_purchase_return_atomic", {
      p_return_id: returnId,
    });
    if (error) throw new Error(error.message || "Return could not be cancelled. Please retry.");
    return validateCancelResult(data);
  })();

  inFlightPurchaseCancels.set(returnId, promise);
  try {
    return await promise;
  } finally {
    if (inFlightPurchaseCancels.get(returnId) === promise) inFlightPurchaseCancels.delete(returnId);
  }
}
