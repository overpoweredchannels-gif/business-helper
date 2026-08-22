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
  INVOICE_SEQUENCE_PAD_LENGTH,
  INVOICE_SEQUENCE_OFFSET,
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
  // Sales: S-100001, S-100002, ... (6 digits, offset 100000)
  assertEqual(formatInvoiceNumber("sales", 1), "S-100001", "Sales #1 formats as S-100001");
  assertEqual(formatInvoiceNumber("sales", 2), "S-100002", "Sales #2 formats as S-100002");
  assertEqual(formatInvoiceNumber("sales", 125), "S-100125", "Sales #125 formats as S-100125");
  assertEqual(formatInvoiceNumber("sales", 999999), "S-1099999", "Large sales sequence numbers pad correctly");

  // Purchase: P-50001, P-50002, ... (5 digits, offset 50000)
  assertEqual(formatInvoiceNumber("purchase", 1), "P-50001", "Purchase #1 formats as P-50001");
  assertEqual(formatInvoiceNumber("purchase", 2), "P-50002", "Purchase #2 formats as P-50002");
  assertEqual(formatInvoiceNumber("purchase", 125), "P-50125", "Purchase #125 formats as P-50125");
  assertEqual(formatInvoiceNumber("purchase", 99999), "P-149999", "Large purchase sequence numbers pad correctly");

  // Other types (no offset)
  assertEqual(formatInvoiceNumber("sales_return", 1), "SRN-000001", "Sales return #1 formats as SRN-000001");
  assertEqual(formatInvoiceNumber("purchase_return", 1), "PRN-000001", "Purchase return #1 formats as PRN-000001");
  assertEqual(formatInvoiceNumber("purchase_order", 1), "PO-000001", "Purchase order #1 formats as PO-000001");
  assertEqual(formatInvoiceNumber("sales_order", 1), "SO-000001", "Sales order #1 formats as SO-000001");

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

  assertEqual(Object.keys(INVOICE_PREFIXES).length, 6, "Exactly 6 invoice type prefixes defined");
  assertEqual(INVOICE_PREFIXES.sales, "S", "sales prefix is S");
  assertEqual(INVOICE_PREFIXES.purchase, "P", "purchase prefix is P");
  assertEqual(INVOICE_PREFIXES.sales_return, "SRN", "sales_return prefix is SRN");
  assertEqual(INVOICE_PREFIXES.purchase_return, "PRN", "purchase_return prefix is PRN");
  assertEqual(INVOICE_PREFIXES.purchase_order, "PO", "purchase_order prefix is PO");
  assertEqual(INVOICE_PREFIXES.sales_order, "SO", "sales_order prefix is SO");

  // Test pad lengths
  assertEqual(INVOICE_SEQUENCE_PAD_LENGTH.sales, 6, "Sales pad length is 6");
  assertEqual(INVOICE_SEQUENCE_PAD_LENGTH.purchase, 5, "Purchase pad length is 5");
  assertEqual(INVOICE_SEQUENCE_PAD_LENGTH.sales_return, 6, "Sales return pad length is 6");
  assertEqual(INVOICE_SEQUENCE_PAD_LENGTH.sales_order, 6, "Sales order pad length is 6");

  // Test offsets
  assertEqual(INVOICE_SEQUENCE_OFFSET.sales, 100000, "Sales offset is 100000");
  assertEqual(INVOICE_SEQUENCE_OFFSET.purchase, 50000, "Purchase offset is 50000");
  assertEqual(INVOICE_SEQUENCE_OFFSET.sales_return, 0, "Sales return offset is 0");
  assertEqual(INVOICE_SEQUENCE_OFFSET.sales_order, 0, "Sales order offset is 0");
}

testFormatInvoiceNumber();

console.log("\n=== extractSequenceDigits ===\n");

function testExtractSequenceDigits() {
  assertEqual(extractSequenceDigits("S-100125"), "100125", "Extracts digits from new sales invoice number");
  assertEqual(extractSequenceDigits("P-50125"), "50125", "Extracts digits from new purchase invoice number");
  assertEqual(extractSequenceDigits("SAL-000125"), "000125", "Extracts digits from legacy sales invoice number");
  assertEqual(extractSequenceDigits("PUR-000002"), "000002", "Extracts digits from legacy purchase invoice number");
  assertEqual(extractSequenceDigits("125"), "125", "Extracts digits from bare numeric string");
  assertEqual(extractSequenceDigits("S-"), null, "Returns null when no digits present");
}

testExtractSequenceDigits();

// ─── InvoiceNumberService tests ──────────────────────────────────────────────

console.log("\n=== InvoiceNumberService.generateSalesInvoice ===\n");

async function testGenerateSalesInvoice() {
  const mock = createMockSupabaseRpc([{ data: 1 }, { data: 2 }, { data: 125 }]);
  const service = new InvoiceNumberService(mock);

  const first = await service.generateSalesInvoice("org_1");
  assertEqual(first, "S-100001", "First sales invoice is S-100001");

  const second = await service.generateSalesInvoice("org_1");
  assertEqual(second, "S-100002", "Second sales invoice is S-100002");

  const later = await service.generateSalesInvoice("org_1");
  assertEqual(later, "S-100125", "Later sales invoice reflects RPC sequence value");

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
  assertEqual(invoiceNumber, "P-50001", "First purchase invoice is P-50001");
  assertEqual(mock.calls[0].params.p_invoice_type, "purchase", "Passes invoice_type=purchase to RPC");
  assertEqual(mock.calls[0].params.p_organization_id, "org_2", "Passes correct organizationId to RPC");
}

console.log("\n=== InvoiceNumberService — Sales Return / Purchase Return / Purchase Order / Sales Order ===\n");

async function testReturnInvoiceTypes() {
  const mock = createMockSupabaseRpc([{ data: 1 }, { data: 1 }, { data: 1 }, { data: 1 }]);
  const service = new InvoiceNumberService(mock);

  const salesReturn = await service.generateSalesReturnInvoice("org_1");
  assertEqual(salesReturn, "SRN-000001", "Sales return invoice formats as SRN-000001");
  assertEqual(mock.calls[0].params.p_invoice_type, "sales_return", "Passes invoice_type=sales_return to RPC");

  const purchaseReturn = await service.generatePurchaseReturnInvoice("org_1");
  assertEqual(purchaseReturn, "PRN-000001", "Purchase return invoice formats as PRN-000001");
  assertEqual(mock.calls[1].params.p_invoice_type, "purchase_return", "Passes invoice_type=purchase_return to RPC");

  const purchaseOrder = await service.generatePurchaseOrder("org_1");
  assertEqual(purchaseOrder, "PO-000001", "Purchase order invoice formats as PO-000001");
  assertEqual(mock.calls[2].params.p_invoice_type, "purchase_order", "Passes invoice_type=purchase_order to RPC");

  const salesOrder = await service.generateSalesOrder("org_1");
  assertEqual(salesOrder, "SO-000001", "Sales order invoice formats as SO-000001");
  assertEqual(mock.calls[3].params.p_invoice_type, "sales_order", "Passes invoice_type=sales_order to RPC");
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

console.log("\n=== InvoiceNumberService — sequence ordering (simulated concurrency) ===\n");

async function testSequenceOrdering() {
  // Simulate 100 concurrent-like requests by making rapid sequential calls
  // The mock returns incrementing sequence numbers to simulate the DB behavior
  const responses = Array.from({ length: 100 }, (_, i) => ({ data: i + 1 }));
  const mock = createMockSupabaseRpc(responses);
  const service = new InvoiceNumberService(mock);

  const results: string[] = [];
  for (let i = 0; i < 100; i++) {
    results.push(await service.generateSalesInvoice("org_test"));
  }

  // Verify strict ordering: each number should be exactly 1 more than the previous
  for (let i = 1; i < results.length; i++) {
    const prev = parseInt(results[i - 1].split("-")[1], 10);
    const curr = parseInt(results[i].split("-")[1], 10);
    assertEqual(curr, prev + 1, `Sequence order maintained at position ${i}: ${results[i - 1]} -> ${results[i]}`);
  }

  // Verify no duplicates
  const unique = new Set(results);
  assertEqual(unique.size, results.length, "No duplicate invoice numbers in 100 generations");

  // Verify expected format
  assertEqual(results[0], "S-100001", "First invoice is S-100001");
  assertEqual(results[99], "S-100100", "100th invoice is S-100100");

  assertEqual(mock.calls.length, 100, "RPC called exactly 100 times");
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
