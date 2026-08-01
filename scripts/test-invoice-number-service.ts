/**
 * Invoice Number Service — Unit Tests
 *
 * TradeOS ERP V2, Sprint 1: Invoice Management Foundation.
 *
 * Tests the pure formatting helpers and the InvoiceNumberService class in
 * isolation, using an injected mock Supabase client (no live database
 * required — see the class's constructor which accepts an injectable
 * SupabaseClient for exactly this purpose).
 *
 * Run: npx tsx scripts/test-invoice-number-service.ts
 */

import {
  InvoiceNumberService,
  formatInvoiceNumber,
  extractSequenceDigits,
  INVOICE_PREFIXES,
} from "../src/lib/invoices/invoice-number-service";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}: expected "${expected}", got "${actual}"`);
  }
}

async function assertThrows(fn: () => unknown | Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
    failed++;
    console.log(`  \u2717 ${label}: expected to throw, but it did not`);
  } catch {
    passed++;
    console.log(`  \u2713 ${label}`);
  }
}

// ─── Mock Supabase client (RPC) ──────────────────────────────────────────────

type RpcCall = { fnName: string; params: Record<string, unknown> };

function createMockSupabaseRpc(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const calls: RpcCall[] = [];
  let index = 0;
  return {
    calls,
    rpc(fnName: string, params: Record<string, unknown>) {
      calls.push({ fnName, params });
      const response = responses[index] ?? { data: null, error: { message: "no mock response configured" } };
      index++;
      return Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
    },
  } as any;
}

// ─── Pure formatting tests ────────────────────────────────────────────────────

console.log("\n=== formatInvoiceNumber ===\n");

function testFormatInvoiceNumber() {
  assertEqual(formatInvoiceNumber("sales", 1), "SAL-000001", "Sales #1 formats as SAL-000001");
  assertEqual(formatInvoiceNumber("sales", 2), "SAL-000002", "Sales #2 formats as SAL-000002");
  assertEqual(formatInvoiceNumber("sales", 125), "SAL-000125", "Sales #125 formats as SAL-000125");
  assertEqual(formatInvoiceNumber("purchase", 1), "PUR-000001", "Purchase #1 formats as PUR-000001");
  assertEqual(formatInvoiceNumber("purchase", 2), "PUR-000002", "Purchase #2 formats as PUR-000002");
  assertEqual(formatInvoiceNumber("sales_return", 1), "SRN-000001", "Sales return #1 formats as SRN-000001");
  assertEqual(formatInvoiceNumber("purchase_return", 1), "PRN-000001", "Purchase return #1 formats as PRN-000001");
  assertEqual(formatInvoiceNumber("sales", 999999), "SAL-999999", "Large sequence numbers pad correctly");
  assertEqual(formatInvoiceNumber("sales", 1000000), "SAL-1000000", "Overflowing sequence numbers are not truncated");

  let threw = false;
  try {
    formatInvoiceNumber("sales", 0);
  } catch {
    threw = true;
  }
  assert(threw, "Zero sequence number throws");

  threw = false;
  try {
    formatInvoiceNumber("sales", -5);
  } catch {
    threw = true;
  }
  assert(threw, "Negative sequence number throws");

  threw = false;
  try {
    formatInvoiceNumber("unknown_type" as any, 1);
  } catch {
    threw = true;
  }
  assert(threw, "Unknown invoice type throws");

  assertEqual(Object.keys(INVOICE_PREFIXES).length, 4, "Exactly 4 invoice type prefixes defined");
  assertEqual(INVOICE_PREFIXES.sales, "SAL", "sales prefix is SAL");
  assertEqual(INVOICE_PREFIXES.purchase, "PUR", "purchase prefix is PUR");
  assertEqual(INVOICE_PREFIXES.sales_return, "SRN", "sales_return prefix is SRN");
  assertEqual(INVOICE_PREFIXES.purchase_return, "PRN", "purchase_return prefix is PRN");
}

testFormatInvoiceNumber();

console.log("\n=== extractSequenceDigits ===\n");

function testExtractSequenceDigits() {
  assertEqual(extractSequenceDigits("SAL-000125"), "000125", "Extracts digits from full invoice number");
  assertEqual(extractSequenceDigits("PUR-000002"), "000002", "Extracts digits from purchase invoice number");
  assertEqual(extractSequenceDigits("125"), "125", "Extracts digits from bare numeric string");
  assertEqual(extractSequenceDigits("SAL-"), null, "Returns null when no digits present");
}

testExtractSequenceDigits();

// ─── InvoiceNumberService tests ──────────────────────────────────────────────

console.log("\n=== InvoiceNumberService.generateSalesInvoice ===\n");

async function testGenerateSalesInvoice() {
  const mock = createMockSupabaseRpc([{ data: 1 }, { data: 2 }, { data: 125 }]);
  const service = new InvoiceNumberService(mock);

  const first = await service.generateSalesInvoice("org_1");
  assertEqual(first, "SAL-000001", "First sales invoice is SAL-000001");

  const second = await service.generateSalesInvoice("org_1");
  assertEqual(second, "SAL-000002", "Second sales invoice is SAL-000002");

  const later = await service.generateSalesInvoice("org_1");
  assertEqual(later, "SAL-000125", "Later sales invoice reflects RPC sequence value");

  assertEqual(mock.calls.length, 3, "RPC called once per generated invoice");
  assertEqual(mock.calls[0].fnName, "next_invoice_number", "Calls the next_invoice_number RPC function");
  assertEqual(mock.calls[0].params.p_organization_id, "org_1", "Passes organizationId to RPC");
  assertEqual(mock.calls[0].params.p_invoice_type, "sales", "Passes invoice_type=sales to RPC");
}

console.log("\n=== InvoiceNumberService.generatePurchaseInvoice ===\n");

async function testGeneratePurchaseInvoice() {
  const mock = createMockSupabaseRpc([{ data: 1 }]);
  const service = new InvoiceNumberService(mock);

  const invoiceNumber = await service.generatePurchaseInvoice("org_2");
  assertEqual(invoiceNumber, "PUR-000001", "First purchase invoice is PUR-000001");
  assertEqual(mock.calls[0].params.p_invoice_type, "purchase", "Passes invoice_type=purchase to RPC");
  assertEqual(mock.calls[0].params.p_organization_id, "org_2", "Passes correct organizationId to RPC");
}

console.log("\n=== InvoiceNumberService — Sales Return / Purchase Return (future-proofing) ===\n");

async function testReturnInvoiceTypes() {
  const mock = createMockSupabaseRpc([{ data: 1 }, { data: 1 }]);
  const service = new InvoiceNumberService(mock);

  const salesReturn = await service.generateSalesReturnInvoice("org_1");
  assertEqual(salesReturn, "SRN-000001", "Sales return invoice formats as SRN-000001");
  assertEqual(mock.calls[0].params.p_invoice_type, "sales_return", "Passes invoice_type=sales_return to RPC");

  const purchaseReturn = await service.generatePurchaseReturnInvoice("org_1");
  assertEqual(purchaseReturn, "PRN-000001", "Purchase return invoice formats as PRN-000001");
  assertEqual(mock.calls[1].params.p_invoice_type, "purchase_return", "Passes invoice_type=purchase_return to RPC");
}

console.log("\n=== InvoiceNumberService — organizations are independent sequences ===\n");

async function testIndependentOrgSequences() {
  // Simulates two organizations calling concurrently — each RPC call is
  // scoped by p_organization_id, so sequences never interfere with each
  // other. We assert the correct organizationId is threaded through on each
  // call (the atomicity itself is guaranteed by the DB function, see
  // src/lib/invoices/schema.sql).
  const mock = createMockSupabaseRpc([{ data: 1 }, { data: 1 }, { data: 2 }]);
  const service = new InvoiceNumberService(mock);

  await service.generateSalesInvoice("org_a");
  await service.generateSalesInvoice("org_b");
  await service.generateSalesInvoice("org_a");

  assertEqual(mock.calls[0].params.p_organization_id, "org_a", "Call 1 scoped to org_a");
  assertEqual(mock.calls[1].params.p_organization_id, "org_b", "Call 2 scoped to org_b");
  assertEqual(mock.calls[2].params.p_organization_id, "org_a", "Call 3 scoped to org_a again");
}

console.log("\n=== InvoiceNumberService — error handling ===\n");

async function testErrorHandling() {
  // Uses a mock client (never touched, since validation happens before any
  // RPC call) so this test never requires real Supabase credentials.
  const unusedMock = createMockSupabaseRpc([]);
  const service = new InvoiceNumberService(unusedMock);

  await assertThrows(
    () => service.generateInvoiceNumber("", "sales"),
    "Empty organizationId throws"
  );

  await assertThrows(
    () => service.generateInvoiceNumber("org_1", "unknown_type" as any),
    "Unknown invoice type throws before touching the database"
  );
  assertEqual(unusedMock.calls.length, 0, "No RPC call made for invalid input");

  const rpcFailureMock = createMockSupabaseRpc([{ error: { message: "relation does not exist" } }]);
  const serviceWithFailingRpc = new InvoiceNumberService(rpcFailureMock);
  await assertThrows(
    () => serviceWithFailingRpc.generateSalesInvoice("org_1"),
    "RPC error is surfaced as a thrown error (e.g. migration not yet applied)"
  );

  const rpcInvalidValueMock = createMockSupabaseRpc([{ data: "not-a-number" }]);
  const serviceWithInvalidValue = new InvoiceNumberService(rpcInvalidValueMock);
  await assertThrows(
    () => serviceWithInvalidValue.generateSalesInvoice("org_1"),
    "Non-numeric RPC response throws"
  );

  const rpcZeroValueMock = createMockSupabaseRpc([{ data: 0 }]);
  const serviceWithZeroValue = new InvoiceNumberService(rpcZeroValueMock);
  await assertThrows(
    () => serviceWithZeroValue.generateSalesInvoice("org_1"),
    "Zero/invalid sequence value from RPC throws"
  );
}

// ─── Run async tests sequentially, then report ───────────────────────────────

async function main() {
  await testGenerateSalesInvoice();
  await testGeneratePurchaseInvoice();
  await testReturnInvoiceTypes();
  await testIndependentOrgSequences();
  await testErrorHandling();

  console.log("\n" + "=".repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("=".repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

main();
