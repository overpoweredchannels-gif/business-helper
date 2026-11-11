import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelPurchaseReturnAtomic,
  cancelSalesReturnAtomic,
  type CancelReturnResult,
} from "../src/lib/returns/cancel-return";

// Mirrors scripts/test-payment-submit-client.ts: the wrappers call one RPC
// each with exactly { p_return_id }, validate the result shape, surface the
// RPC error message, and dedupe an in-flight cancel for the same return.

type RpcCall = { name: string; args: Record<string, unknown> };

function mockClient(
  behavior: (call: RpcCall) => Promise<{ data: unknown; error: { message: string } | null }>
) {
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

const RETURN_ID = "90000000-0000-4000-8000-000000000001";

const result: CancelReturnResult = {
  return_id: RETURN_ID,
  return_number: "SRN-000001",
  status: "cancelled",
  cancelled: true,
};

async function main() {
  // Sales cancel calls cancel_sales_return_atomic with exactly p_return_id.
  {
    const { client, calls } = mockClient(async () => ({ data: result, error: null }));
    const out = await cancelSalesReturnAtomic(client, RETURN_ID);
    assert.equal(out, result);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "cancel_sales_return_atomic");
    assert.deepEqual(calls[0].args, { p_return_id: RETURN_ID });
  }

  // Purchase cancel calls cancel_purchase_return_atomic with exactly p_return_id.
  {
    const { client, calls } = mockClient(async () => ({
      data: { ...result, return_number: "PRN-000001" },
      error: null,
    }));
    const out = await cancelPurchaseReturnAtomic(client, RETURN_ID);
    assert.equal(out.return_number, "PRN-000001");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "cancel_purchase_return_atomic");
    assert.deepEqual(calls[0].args, { p_return_id: RETURN_ID });
  }

  // An RPC error surfaces its message.
  {
    const { client } = mockClient(async () => ({
      data: null,
      error: { message: "Sales return is already cancelled" },
    }));
    await assert.rejects(
      () => cancelSalesReturnAtomic(client, RETURN_ID),
      /Sales return is already cancelled/
    );
  }

  // A malformed result (no return_id) is rejected, never trusted.
  {
    const { client } = mockClient(async () => ({ data: { status: "cancelled" }, error: null }));
    await assert.rejects(() => cancelPurchaseReturnAtomic(client, RETURN_ID), /could not be cancelled/);
  }

  // Two concurrent cancels for the same return make ONE rpc call.
  {
    let rpcCalls = 0;
    const { client } = mockClient(async () => {
      rpcCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: result, error: null };
    });
    const [first, second] = await Promise.all([
      cancelSalesReturnAtomic(client, RETURN_ID),
      cancelSalesReturnAtomic(client, RETURN_ID),
    ]);
    assert.equal(first, result);
    assert.equal(second, result);
    assert.equal(rpcCalls, 1, "Double-click must not double-cancel");
  }

  console.log("return-cancel-client: all assertions passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
