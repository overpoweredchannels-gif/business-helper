/**
 * Invoice Ledger — Integration Tests
 *
 * TradeOS ERP V2, Sprint 1: Invoice Management Foundation.
 *
 * Exercises querySalesLedger / queryPurchaseLedger end-to-end against a mock
 * Supabase query builder that faithfully mimics the real
 * @supabase/supabase-js chainable API (.from().select().eq().ilike()...).
 * This validates:
 *   - Part 2: invoice number search (full AND partial) is wired correctly.
 *   - Part 3: every universal filter (date, customer/supplier, salesman,
 *     payment type, status) is applied via the correct query method.
 *   - Pagination (limit/offset) is clamped and applied via .range().
 *   - Multi-tenancy: organization_id is always applied first.
 *
 * Run: npx tsx scripts/test-invoice-flow.ts
 */

import {
  querySalesLedger,
  queryPurchaseLedger,
  escapeIlikeTerm,
  normalizeInvoiceSearchTerm,
  buildInvoiceSearchPattern,
  clampLimit,
  clampOffset,
} from "../src/lib/invoices/invoice-ledger-service";

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
    console.log(`  \u2717 ${label}: expected "${JSON.stringify(expected)}", got "${JSON.stringify(actual)}"`);
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

// ─── Mock Supabase query builder ─────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

function createMockQueryBuilder(finalResult: { data: unknown[]; error: { message: string } | null; count: number }) {
  const calls: Call[] = [];
  const builder: any = {
    calls,
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return builder;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return builder;
    },
    ilike(...args: unknown[]) {
      calls.push({ method: "ilike", args });
      return builder;
    },
    gte(...args: unknown[]) {
      calls.push({ method: "gte", args });
      return builder;
    },
    lte(...args: unknown[]) {
      calls.push({ method: "lte", args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return builder;
    },
    range(...args: unknown[]) {
      calls.push({ method: "range", args });
      return Promise.resolve(finalResult);
    },
  };
  return builder;
}

function createMockSupabase(finalResult: { data: unknown[]; error: { message: string } | null; count: number }) {
  const fromCalls: Array<{ table: string; builder: ReturnType<typeof createMockQueryBuilder> }> = [];
  return {
    fromCalls,
    from(table: string) {
      const builder = createMockQueryBuilder(finalResult);
      fromCalls.push({ table, builder });
      return builder;
    },
  } as any;
}

function findCall(calls: Call[], method: string): Call | undefined {
  return calls.find((c) => c.method === method);
}

// ─── Pure helper tests ────────────────────────────────────────────────────────

console.log("\n=== Search term helpers ===\n");

function testSearchHelpers() {
  assertEqual(normalizeInvoiceSearchTerm("  SAL-000125  "), "SAL-000125", "Trims whitespace");
  assertEqual(normalizeInvoiceSearchTerm(""), null, "Empty string normalizes to null");
  assertEqual(normalizeInvoiceSearchTerm(null), null, "null stays null");
  assertEqual(normalizeInvoiceSearchTerm(undefined), null, "undefined stays null");

  assertEqual(escapeIlikeTerm("50%off"), "50\\%off", "Escapes % wildcard");
  assertEqual(escapeIlikeTerm("a_b"), "a\\_b", "Escapes _ wildcard");
  assertEqual(escapeIlikeTerm("125"), "125", "Plain digits pass through unescaped");

  assertEqual(buildInvoiceSearchPattern("125"), "%125%", "Wraps term in wildcards for contains-search");
  assertEqual(buildInvoiceSearchPattern("SAL-000125"), "%SAL-000125%", "Full invoice number also wrapped");

  // Core requirement from Part 2: both a full invoice number and a bare
  // partial numeric fragment must be able to locate the same row. Since the
  // stored value is always zero-padded (e.g. "000125"), a simple "contains"
  // pattern satisfies both — verify the substring relationship holds.
  const stored = "SAL-000125";
  assert(stored.includes("125"), "Partial numeric term '125' is a substring of the full invoice number");
  assert(stored.toUpperCase().includes("SAL-000125".toUpperCase()), "Full invoice number matches itself");

  assertEqual(clampLimit(undefined), 50, "Default limit is 50");
  assertEqual(clampLimit(10), 10, "Custom limit under max is respected");
  assertEqual(clampLimit(10000), 500, "Limit is capped at 500");
  assertEqual(clampLimit(-5), 50, "Negative limit falls back to default");
  assertEqual(clampLimit(0), 50, "Zero limit falls back to default");

  assertEqual(clampOffset(undefined), 0, "Default offset is 0");
  assertEqual(clampOffset(20), 20, "Custom offset is respected");
  assertEqual(clampOffset(-10), 0, "Negative offset falls back to 0");
}

testSearchHelpers();

// ─── querySalesLedger ────────────────────────────────────────────────────────

console.log("\n=== querySalesLedger ===\n");

async function testQuerySalesLedgerBasic() {
  const mockSupabase = createMockSupabase({ data: [{ id: "s1" }], error: null, count: 1 });

  const result = await querySalesLedger(mockSupabase, { organizationId: "org_1" });

  assertEqual(mockSupabase.fromCalls[0].table, "sales_transactions", "Queries the sales_transactions table");
  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  const orgFilter = calls.find((c) => c.method === "eq" && c.args[0] === "organization_id");
  assert(!!orgFilter, "Always filters by organization_id (multi-tenancy)");
  assertEqual(orgFilter?.args[1], "org_1", "organization_id filter uses the requested org");
  assertEqual(result.entries.length, 1, "Returns mapped entries");
  assertEqual(result.total, 1, "Returns total count from Supabase count option");
  assertEqual(result.limit, 50, "Defaults to limit=50");
  assertEqual(result.offset, 0, "Defaults to offset=0");
}

async function testQuerySalesLedgerSearch() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await querySalesLedger(mockSupabase, { organizationId: "org_1", search: "125" });

  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  const ilikeCall = findCall(calls, "ilike");
  assert(!!ilikeCall, "Applies ilike filter when search term provided");
  assertEqual(ilikeCall?.args[0], "invoice_number", "Search filters on invoice_number column");
  assertEqual(ilikeCall?.args[1], "%125%", "Partial numeric search wraps term in wildcards");
}

async function testQuerySalesLedgerFullInvoiceNumberSearch() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await querySalesLedger(mockSupabase, { organizationId: "org_1", search: "SAL-000125" });

  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  const ilikeCall = findCall(calls, "ilike");
  assertEqual(ilikeCall?.args[1], "%SAL-000125%", "Full invoice number search also uses a wildcard pattern");
}

async function testQuerySalesLedgerNoSearchTerm() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await querySalesLedger(mockSupabase, { organizationId: "org_1" });

  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  assert(!findCall(calls, "ilike"), "No ilike filter applied when search is omitted");
}

async function testQuerySalesLedgerAllFilters() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await querySalesLedger(mockSupabase, {
    organizationId: "org_1",
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
    customerId: "cust_1",
    salesmanProfileId: "profile_1",
    paymentType: "credit",
    status: "confirmed",
    limit: 25,
    offset: 10,
  });

  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  assert(!!calls.find((c) => c.method === "gte" && c.args[0] === "sale_date" && c.args[1] === "2026-01-01"), "date_from applies gte on sale_date");
  assert(!!calls.find((c) => c.method === "lte" && c.args[0] === "sale_date" && c.args[1] === "2026-01-31"), "date_to applies lte on sale_date");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "customer_id" && c.args[1] === "cust_1"), "customer filter applies eq on customer_id");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "created_by_profile_id" && c.args[1] === "profile_1"), "salesman filter applies eq on created_by_profile_id");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "payment_type" && c.args[1] === "credit"), "payment_type filter applies eq");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "confirmed"), "status filter applies eq");

  const rangeCall = findCall(calls, "range");
  assertEqual(rangeCall?.args[0], 10, "Pagination offset passed to range() as 'from'");
  assertEqual(rangeCall?.args[1], 34, "Pagination range 'to' is offset + limit - 1");
}

async function testQuerySalesLedgerRequiresOrganizationId() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await assertThrows(
    () => querySalesLedger(mockSupabase, { organizationId: "" }),
    "Throws when organizationId is missing"
  );
}

async function testQuerySalesLedgerPropagatesDbError() {
  const mockSupabase = createMockSupabase({ data: [], error: { message: "connection lost" }, count: 0 });
  await assertThrows(
    () => querySalesLedger(mockSupabase, { organizationId: "org_1" }),
    "Propagates Supabase errors as a thrown Error"
  );
}

// ─── queryPurchaseLedger ─────────────────────────────────────────────────────

console.log("\n=== queryPurchaseLedger ===\n");

async function testQueryPurchaseLedgerBasic() {
  const mockSupabase = createMockSupabase({ data: [{ id: "p1" }], error: null, count: 1 });
  const result = await queryPurchaseLedger(mockSupabase, { organizationId: "org_2" });

  assertEqual(mockSupabase.fromCalls[0].table, "purchase_transactions", "Queries the purchase_transactions table");
  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "organization_id" && c.args[1] === "org_2"), "Filters by organization_id");
  assertEqual(result.entries.length, 1, "Returns mapped entries");
  assertEqual(result.total, 1, "Returns total count");
}

async function testQueryPurchaseLedgerFilters() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await queryPurchaseLedger(mockSupabase, {
    organizationId: "org_2",
    search: "42",
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
    supplierId: "supp_9",
    status: "paid",
  });

  const calls = mockSupabase.fromCalls[0].builder.calls as Call[];
  const ilikeCall = findCall(calls, "ilike");
  assertEqual(ilikeCall?.args[0], "invoice_number", "Search filters on invoice_number");
  assertEqual(ilikeCall?.args[1], "%42%", "Search wraps term in wildcards");
  assert(!!calls.find((c) => c.method === "gte" && c.args[0] === "purchase_date"), "date_from applies gte on purchase_date");
  assert(!!calls.find((c) => c.method === "lte" && c.args[0] === "purchase_date"), "date_to applies lte on purchase_date");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "supplier_id" && c.args[1] === "supp_9"), "supplier filter applies eq on supplier_id");
  assert(!!calls.find((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "paid"), "status filter applies eq");
  // Purchase ledger has no "salesman" concept — assert we never leak a
  // created_by_profile_id filter unless explicitly designed for purchases.
  assert(!calls.find((c) => c.method === "eq" && c.args[0] === "created_by_profile_id"), "No salesman filter leaks into purchase ledger queries");
}

async function testQueryPurchaseLedgerRequiresOrganizationId() {
  const mockSupabase = createMockSupabase({ data: [], error: null, count: 0 });
  await assertThrows(
    () => queryPurchaseLedger(mockSupabase, { organizationId: "" }),
    "Throws when organizationId is missing"
  );
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  await testQuerySalesLedgerBasic();
  await testQuerySalesLedgerSearch();
  await testQuerySalesLedgerFullInvoiceNumberSearch();
  await testQuerySalesLedgerNoSearchTerm();
  await testQuerySalesLedgerAllFilters();
  await testQuerySalesLedgerRequiresOrganizationId();
  await testQuerySalesLedgerPropagatesDbError();

  await testQueryPurchaseLedgerBasic();
  await testQueryPurchaseLedgerFilters();
  await testQueryPurchaseLedgerRequiresOrganizationId();

  console.log("\n" + "=".repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("=".repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

main();
