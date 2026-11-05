import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPaymentRequestStatus,
  isUncertainPaymentError,
  submitPaymentAtomic,
  type PaymentSubmitInput,
  type PaymentSubmitResult,
} from "../src/lib/payments/submit-payment";

const input: PaymentSubmitInput = {
  kind: "customer",
  partyId: "30000000-0000-4000-8000-000000000001",
  amount: 50,
  paymentDate: null,
  paymentMethod: "cash",
  notes: null,
  allocations: [{ invoice_id: "60000000-0000-4000-8000-000000000001", amount: 40 }],
};

const result: PaymentSubmitResult = {
  payment_id: "90000000-0000-4000-8000-000000000001",
  kind: "customer",
  party_id: input.partyId,
  amount: 50,
  allocated_amount: 40,
  unapplied_amount: 10,
  replayed: false,
};

type RpcCall = { name: string; args: Record<string, unknown> };

function mockClient(behavior: (call: RpcCall) => Promise<{ data: unknown; error: { message: string } | null }>) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const call = { name, args };
      calls.push(call);
      return behavior(call);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

async function main() {
  // T13: two concurrent submissions under one attempt key issue ONE RPC
  // call and both resolve to the same payment.
  {
    const { client, calls } = mockClient(async () => ({ data: result, error: null }));
    const [first, second] = await Promise.all([
      submitPaymentAtomic(client, input, "key-t13"),
      submitPaymentAtomic(client, input, "key-t13"),
    ]);
    assert.equal(calls.length, 1, "Double-click issues one RPC call");
    assert.equal(calls[0].name, "create_payment_atomic");
    assert.equal(calls[0].args.p_request_key, "key-t13");
    assert.equal(calls[0].args.p_kind, "customer");
    assert.deepEqual(calls[0].args.p_allocations, input.allocations);
    assert.equal(first.payment_id, result.payment_id);
    assert.equal(second.payment_id, result.payment_id);
  }

  // Distinct attempt keys are distinct submissions.
  {
    const { client, calls } = mockClient(async () => ({ data: result, error: null }));
    await submitPaymentAtomic(client, input, "key-a");
    await submitPaymentAtomic(client, input, "key-b");
    assert.equal(calls.length, 2, "Two genuinely distinct payments call the RPC twice");
  }

  // A definitive RPC rejection surfaces its message and frees the key:
  // the next attempt calls the RPC again.
  {
    const { client, calls } = mockClient(async () => ({ data: null, error: { message: "Payments permission is required" } }));
    await assert.rejects(submitPaymentAtomic(client, input, "key-err"), /Payments permission is required/);
    await assert.rejects(submitPaymentAtomic(client, input, "key-err"), /Payments permission is required/);
    assert.equal(calls.length, 2, "A definitive rejection does not swallow the next attempt");
  }

  // A result without a payment id is a failure, never a silent success.
  {
    const { client } = mockClient(async () => ({ data: { kind: "customer" }, error: null }));
    await assert.rejects(submitPaymentAtomic(client, input, "key-noid"), /could not be saved/);
  }

  // Status confirmation reuses the same RPC channel without re-posting.
  {
    const { client, calls } = mockClient(async (call) => {
      if (call.name === "get_payment_request_status") return { data: { status: "confirmed", result }, error: null };
      return { data: null, error: { message: "unexpected" } };
    });
    const confirmed = await getPaymentRequestStatus(client, "key-status", "customer");
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.result?.payment_id, result.payment_id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_request_key, "key-status");
  }

  // Uncertain vs definitive errors decide whether the caller keeps the
  // attempt key for a retry.
  assert.equal(isUncertainPaymentError(new Error("Failed to fetch")), true);
  assert.equal(isUncertainPaymentError(new Error("Network request failed")), true);
  assert.equal(isUncertainPaymentError(new Error("Load failed")), true);
  assert.equal(isUncertainPaymentError(new Error("Payments permission is required")), false);
  assert.equal(isUncertainPaymentError(new Error("Invalid payment_method")), false);
  assert.equal(isUncertainPaymentError(new Error("Allocation exceeds the invoice remaining balance")), false);

  console.log("Payment submit-client tests passed: single RPC per attempt key, distinct keys submit twice, definitive errors surface, and lost-response errors are classified uncertain.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
