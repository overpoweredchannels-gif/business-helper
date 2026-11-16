import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  editPaymentAtomic,
  submitPaymentAtomic,
  type EditPaymentInput,
  type PaymentSubmitInput,
  type PaymentSubmitResult,
} from "../src/lib/payments/submit-payment";
import { roundMoney } from "../src/lib/sales/sale-amounts";

// Payment save integrity (P0-2 + P0-3, audit Area 6) — the customer and
// supplier payment handlers in src/app/page.tsx.
//
// Verified against main eab0dc9 before this slice: the atomic path, the
// idempotency key and the loading guard the audit asked for ALREADY exist
// (payment-safety slice, main a82eb26) — both handlers route through
// submitPaymentAtomic / editPaymentAtomic (one create_payment_atomic /
// edit_payment_atomic RPC: payment + allocations + balance + audit in a
// single transaction), carry an attempt key that is kept on an uncertain
// error and cleared on a definitive rejection, and guard on
// customerPaymentLoading / supplierPaymentLoading at entry. The card
// CHECK the audit flagged was already widened by phase 15
// (production_phase15_card_void_reconcile.sql) to
// ('cash', 'bank', 'card', 'other') on both tables, and both forms offer
// card. What was genuinely still missing, and what this slice fixes:
// (a) NO rounding — the handlers sent raw floats, and both RPCs reject
// any amount with more than two decimals, so a typed 10.005 or a
// 0.1 + 0.2 float artifact failed the save instead of saving; (b) the
// entry guard was state-only, so a second click before React re-rendered
// could pass it and run the success path (form reset + refetches) twice.
// This slice rounds the payment and every allocation amount with
// roundMoney BEFORE validation in both handlers, and adds a synchronous
// ref-based in-flight flag to both. The audit row is written inside the
// RPC transaction, never through the page's catch-and-log createAuditLog,
// so an audit failure aborts the payment instead of being swallowed.

const workspace = path.resolve(__dirname, "..");
const page = readFileSync(path.join(workspace, "src/app/page.tsx"), "utf8");
const phase17 = readFileSync(
  path.join(workspace, "src/lib/migrations/production_phase17_edit_kindscope.sql"),
  "utf8"
);

function handlerBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} not found in page.tsx`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} not found after ${startMarker}`);
  return source.slice(start, end);
}

function functionBody(sql: string, functionName: string): string {
  const marker = `create or replace function public.${functionName}(`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `${functionName} not found in the phase-17 SQL`);
  const next = sql.indexOf("create or replace function public.", start + marker.length);
  // The last function in the file has no successor: slice to end of file.
  return sql.slice(start, next >= 0 ? next : undefined);
}

const customerHandler = handlerBody(
  page,
  "const handleSaveCustomerPayment = async () => {",
  "const handleSaveSupplierPayment = async () => {"
);
const supplierHandler = handlerBody(
  page,
  "const handleSaveSupplierPayment = async () => {",
  "const resetCustomerPaymentForm = () => {"
);

const input: PaymentSubmitInput = {
  kind: "customer",
  partyId: "30000000-0000-4000-8000-000000000001",
  amount: 50,
  paymentDate: null,
  paymentMethod: "cash",
  reference: "CHQ-99",
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
  // (4) Amounts are rounded to 2 decimals, half away from zero, with
  // exact decimal arithmetic — never the float Math.round that turns
  // 2.675 into 2.67.
  {
    assert.equal(roundMoney(10.005), 10.01, "a typed third decimal rounds up");
    assert.equal(roundMoney(0.1 + 0.2), 0.3, "a float artifact rounds to the intended cents");
    assert.equal(roundMoney(0.415), 0.42);
    assert.equal(roundMoney(2.675), 2.68);
    assert.equal(roundMoney(0.004), 0, "sub-cent rounds to zero, so validation rejects it as an amount");
    assert.equal(roundMoney(0.005), 0.01);
    assert.equal(roundMoney(-1.005), -1.01, "rounding is symmetric for negatives");
    assert.equal(roundMoney(0), 0);
    assert.equal(roundMoney(50), 50);
    assert.equal(roundMoney(Number.NaN), 0, "a non-finite input never reaches the RPC as NaN");
    assert.equal(roundMoney(Number.POSITIVE_INFINITY), 0);
  }

  // (4) Both handlers round the payment amount and every allocation
  // amount BEFORE validation, so validation compares exactly the values
  // the RPC receives — and the RPC's two-decimal scale check can never
  // trigger from the UI.
  {
    assert.match(customerHandler, /const paymentAmount = roundMoney\(Number\(customerPaymentAmount\)\);/);
    assert.match(
      customerHandler,
      /const allocationAmount = roundMoney\(Number\(customerPaymentAllocationsByInvoice\[invoice\.transaction\.id\] \|\| 0\)\);/
    );
    assert.match(supplierHandler, /const paymentAmount = roundMoney\(Number\(supplierPaymentAmount\)\);/);
    assert.match(
      supplierHandler,
      /const allocationAmount = roundMoney\(Number\(supplierPaymentAllocationsByInvoice\[invoice\.transaction\.id\] \|\| 0\)\);/
    );
    assert.ok(
      customerHandler.indexOf("roundMoney(Number(customerPaymentAmount))") <
        customerHandler.indexOf("if (totalAllocationAmount > paymentAmount)"),
      "customer rounding precedes the total-vs-payment check"
    );
    assert.ok(
      supplierHandler.indexOf("roundMoney(Number(supplierPaymentAmount))") <
        supplierHandler.indexOf("if (totalAllocationAmount > paymentAmount)"),
      "supplier rounding precedes the total-vs-payment check"
    );
  }

  // (1) An allocation failure rolls back / leaves no orphan: the single
  // RPC is the only write, so a rejection writes nothing — and the
  // rejection surfaces to the caller instead of leaving a committed
  // payment row behind.
  {
    const { client, calls } = mockClient(async () => ({
      data: null,
      error: { message: "Allocation exceeds the invoice remaining balance" },
    }));
    await assert.rejects(
      submitPaymentAtomic(client, input, "key-pi-alloc"),
      /Allocation exceeds the invoice remaining balance/
    );
    assert.equal(calls.length, 1, "one RPC attempt and nothing else: no follow-up write can orphan a payment");
  }

  // (1) The code tolerates the RPC being absent: a missing function
  // fails with a clear error, never a silent partial save.
  {
    const { client, calls } = mockClient(async () => ({
      data: null,
      error: { message: "Could not find the function public.create_payment_atomic in the schema cache" },
    }));
    await assert.rejects(submitPaymentAtomic(client, input, "key-pi-missing"), /Could not find the function/);
    assert.equal(calls.length, 1);
  }

  // (1) Neither handler writes a payment table directly: the only write
  // path is the atomic RPC (create or edit), so there is no second
  // insert that could commit while an allocation fails.
  {
    assert.doesNotMatch(customerHandler, /\.from\("customer_payments"\)/);
    assert.doesNotMatch(customerHandler, /\.from\("supplier_payments"\)/);
    assert.doesNotMatch(supplierHandler, /\.from\("customer_payments"\)/);
    assert.doesNotMatch(supplierHandler, /\.from\("supplier_payments"\)/);
    assert.match(customerHandler, /submitPaymentAtomic\(/);
    assert.match(customerHandler, /editPaymentAtomic\(/);
    assert.match(supplierHandler, /submitPaymentAtomic\(/);
    assert.match(supplierHandler, /editPaymentAtomic\(/);
  }

  // (2) The same idempotency key twice yields one payment: two
  // concurrent submissions under one key issue one RPC call and both
  // resolve to the same payment — for creates and for edits.
  {
    const { client, calls } = mockClient(async () => ({ data: result, error: null }));
    const [first, second] = await Promise.all([
      submitPaymentAtomic(client, input, "key-pi-idem"),
      submitPaymentAtomic(client, input, "key-pi-idem"),
    ]);
    assert.equal(calls.length, 1, "double-submit under one key issues one RPC call");
    assert.equal(calls[0].name, "create_payment_atomic");
    assert.equal(first.payment_id, result.payment_id);
    assert.equal(second.payment_id, result.payment_id);
  }
  {
    const editInput: EditPaymentInput = {
      kind: "customer",
      paymentId: result.payment_id,
      partyId: input.partyId,
      amount: 30,
      paymentDate: "2026-11-09",
      paymentMethod: "card",
      reference: "4321",
      notes: "Corrected amount",
      allocations: [{ invoice_id: "60000000-0000-4000-8000-000000000001", amount: 20 }],
    };
    const edited = { ...result, amount: 30, allocated_amount: 20, unapplied_amount: 10 };
    const { client, calls } = mockClient(async () => ({ data: edited, error: null }));
    const [first, second] = await Promise.all([
      editPaymentAtomic(client, editInput, "key-pi-idem-edit"),
      editPaymentAtomic(client, editInput, "key-pi-idem-edit"),
    ]);
    assert.equal(calls.length, 1, "double-submit of one edit issues one RPC call");
    assert.equal(calls[0].name, "edit_payment_atomic");
    assert.equal(first.payment_id, result.payment_id);
    assert.equal(second.payment_id, result.payment_id);
  }
  {
    const { client, calls } = mockClient(async () => ({ data: result, error: null }));
    await submitPaymentAtomic(client, input, "key-pi-a");
    await submitPaymentAtomic(client, input, "key-pi-b");
    assert.equal(calls.length, 2, "two genuinely distinct payments call the RPC twice");
  }

  // (3) Both handlers have a loading guard at entry, before any
  // validation: the state guard plus a synchronous ref flag, so a second
  // click before React re-renders is blocked outright. The flag is set
  // after validation (a failed validation never leaves it set) and
  // cleared in the finally, on every exit path.
  for (const [name, body, loading, savingRef, partyCheck] of [
    ["customer", customerHandler, "customerPaymentLoading", "customerPaymentSavingRef", "if (!selectedCustomerPaymentId)"],
    ["supplier", supplierHandler, "supplierPaymentLoading", "supplierPaymentSavingRef", "if (!selectedSupplierPaymentId)"],
  ] as const) {
    const guard = body.indexOf(`if (${loading} || ${savingRef}.current) {`);
    assert.ok(guard >= 0, `${name} handler has the entry guard`);
    assert.ok(guard < body.indexOf(partyCheck), `${name} guard runs before validation`);
    const setFlag = body.indexOf(`${savingRef}.current = true;`);
    assert.ok(setFlag > body.indexOf("if (totalAllocationAmount > paymentAmount)"), `${name} flag is set after validation`);
    assert.ok(setFlag < body.indexOf("submitPaymentAtomic("), `${name} flag is set before the save flight`);
    const finallyIdx = body.indexOf("} finally {");
    assert.ok(finallyIdx >= 0, `${name} handler has a finally`);
    assert.ok(
      body.indexOf(`${savingRef}.current = false;`, finallyIdx) >= 0,
      `${name} flag is cleared in the finally`
    );
    assert.match(page, new RegExp(`const ${savingRef} = useRef\\(false\\);`), `${name} in-flight ref is declared`);
  }

  // (5) An audit failure surfaces, never swallowed: the RPC writes the
  // audit row inside the same transaction as the payment, so an audit
  // failure rejects the whole call — and the page's catch-and-log
  // createAuditLog is never called on the payment path.
  {
    const { client } = mockClient(async () => ({
      data: null,
      error: { message: "insert into audit_logs violates foreign key constraint" },
    }));
    await assert.rejects(submitPaymentAtomic(client, input, "key-pi-audit"), /audit_logs/);
  }
  {
    assert.doesNotMatch(customerHandler, /createAuditLog\(/);
    assert.doesNotMatch(supplierHandler, /createAuditLog\(/);
    const createBody = functionBody(phase17, "create_payment_atomic");
    assert.match(createBody, /insert into public\.customer_payments \(/);
    assert.match(createBody, /insert into public\.supplier_payments \(/);
    assert.match(createBody, /insert into public\.audit_logs \(/, "audit row is written inside create_payment_atomic");
    const editBody = functionBody(phase17, "edit_payment_atomic");
    assert.match(editBody, /insert into public\.audit_logs \(/, "audit row is written inside edit_payment_atomic");
  }

  console.log(
    "Payment integrity tests passed: amounts rounded to 2 decimals before validation, one atomic RPC is the only payment write, same attempt key yields one payment, entry guards block double-submit, and audit failures surface."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
