// Direct payments through the atomic RPC (payment-safety first slice).
//
// The browser never writes the payment tables directly any more: one
// create_payment_atomic call validates, inserts the payment, its
// allocations, the balance change and the audit row in a single
// transaction. The caller owns the attempt key: it is generated once per
// save attempt and retained only while the outcome is uncertain (a
// network failure), so a retry replays instead of duplicating, while a
// genuinely new payment with identical details gets a fresh key.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentKind = "customer" | "supplier";

export interface PaymentAllocationInput {
  invoice_id: string;
  amount: number;
}

export interface PaymentSubmitInput {
  kind: PaymentKind;
  partyId: string;
  amount: number;
  paymentDate: string | null;
  paymentMethod: string;
  notes: string | null;
  allocations: PaymentAllocationInput[];
}

export interface PaymentSubmitResult {
  payment_id: string;
  kind: PaymentKind;
  party_id: string;
  amount: number;
  allocated_amount: number;
  unapplied_amount: number;
  replayed: boolean;
}

export function createPaymentAttemptKey(): string {
  return crypto.randomUUID();
}

// One in-flight submission per attempt key: a second call (double-click,
// double Enter) while a save is pending returns the same promise instead
// of a second RPC call. The entry is cleared once the call settles.
const inFlight = new Map<string, Promise<PaymentSubmitResult>>();

export async function submitPaymentAtomic(
  client: SupabaseClient,
  input: PaymentSubmitInput,
  requestKey: string,
): Promise<PaymentSubmitResult> {
  const existing = inFlight.get(requestKey);
  if (existing) return existing;

  const promise = (async (): Promise<PaymentSubmitResult> => {
    const { data, error } = await client.rpc("create_payment_atomic", {
      p_request_key: requestKey,
      p_kind: input.kind,
      p_party_id: input.partyId,
      p_amount: input.amount,
      p_payment_date: input.paymentDate,
      p_payment_method: input.paymentMethod,
      p_notes: input.notes,
      p_allocations: input.allocations,
    });
    if (error) throw new Error(error.message || "Payment could not be saved. Please retry.");
    const result = data as PaymentSubmitResult | null;
    if (!result || typeof result.payment_id !== "string" || result.payment_id === "") {
      throw new Error("Payment could not be saved. Please retry.");
    }
    return result;
  })();

  inFlight.set(requestKey, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey);
  }
}

/** Confirm a request key after a lost response, without re-posting. */
export async function getPaymentRequestStatus(
  client: SupabaseClient,
  requestKey: string,
  kind: PaymentKind,
): Promise<{ status: string; result?: PaymentSubmitResult }> {
  const { data, error } = await client.rpc("get_payment_request_status", {
    p_request_key: requestKey,
    p_kind: kind,
  });
  if (error) throw new Error(error.message || "Payment status could not be checked. Please retry.");
  return (data ?? { status: "unknown" }) as { status: string; result?: PaymentSubmitResult };
}

/**
 * A thrown error means the outcome is unknown (the request may have
 * committed before the response was lost): the caller must KEEP the
 * attempt key so the next save replays instead of duplicating. A
 * PostgreSQL rejection from the RPC is definitive — nothing was written
 * — so the caller clears the key and the next save is a fresh attempt.
 */
export function isUncertainPaymentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|timeout|abort/i.test(message);
}
