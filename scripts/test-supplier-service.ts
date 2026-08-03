/**
 * Supplier Service — Unit Tests
 *
 * Exercises validateSupplierInput / validatePurchaseTransactionInput and the
 * SupplierService end-to-end against a mock Supabase query builder that
 * faithfully mimics the real @supabase/supabase-js chainable API
 * (.from().select().eq().maybeSingle().insert()...). No live database required.
 *
 * Run: npx tsx scripts/test-supplier-service.ts
 */

import { SupplierService } from "../src/lib/purchases/services/supplier-service";
import {
  validateSupplierInput,
  validatePurchaseTransactionInput,
  normalizeOptionalText,
  normalizeOptionalNumber,
  MAX_SUPPLIER_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from "../src/lib/purchases/validation";
import type { ActorContext } from "../src/lib/identity/types";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0;
let failed = 0;

function assertTrue(condition: boolean, label: string): void {
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

async function assertThrows(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
    failed++;
    console.log(`  \u2717 ${label}: expected to throw, but it did not`);
  } catch {
    passed++;
    console.log(`  \u2713 ${label}`);
  }
}

const owner: ActorContext = {
  profileId: "profile-1",
  organizationId: "org-1",
  email: "owner@example.com",
  role: "owner",
  isOwner: true,
  isActive: true,
  permissions: [],
};

const storedSupplier = {
  id: "sup-1",
  organization_id: "org-1",
  supplier_name: "Test Supplier",
  contact_person: null,
  phone: "123",
  whatsapp: null,
  city: "Lahore",
  area: null,
  notes: null,
  credit_limit: null,
  credit_days: 30,
  credit_policy: null,
  preferred_payment_method: null,
  allow_over_limit: null,
  allow_overdue_sales: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

// ─── Mock Supabase query builder ─────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

function createMockQueryBuilder(finalResult: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Call[] = [];
  const builder = {
    calls,
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return builder;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: finalResult.data?.[0] ?? null, error: finalResult.error });
    },
    single() {
      return Promise.resolve({ data: finalResult.data?.[0] ?? null, error: finalResult.error });
    },
    insert(...args: unknown[]) {
      calls.push({ method: "insert", args });
      return builder;
    },
    update(...args: unknown[]) {
      calls.push({ method: "update", args });
      return builder;
    },
    delete() {
      calls.push({ method: "delete", args: [] });
      return builder;
    },
  };
  return builder;
}

type MockFromCall = { table: string; builder: { calls: Call[] } };

function createMockSupabase(finalResult: { data: unknown[] | null; error: { message: string } | null }) {
  const fromCalls: MockFromCall[] = [];
  const mock = {
    fromCalls,
    from(table: string) {
      const builder = createMockQueryBuilder(finalResult);
      fromCalls.push({ table, builder });
      return builder;
    },
  };
  return { mock, client: mock as unknown as SupabaseClient };
}

function findCall(calls: Call[], method: string): Call | undefined {
  return calls.find((c) => c.method === method);
}

function findCallOnTable(mock: MockFromCall[], table: string, method: string): Call | undefined {
  for (let i = mock.length - 1; i >= 0; i--) {
    if (mock[i].table === table) {
      const found = mock[i].builder.calls.find((c) => c.method === method);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

// ─── Validator tests ─────────────────────────────────────────────────────────

console.log("\n=== validateSupplierInput ===\n");

function testSupplierValidator() {
  const empty = validateSupplierInput({});
  assertEqual(empty.ok, false, "Empty input is rejected");
  assertEqual(empty.errors[0], "Supplier name is required.", "Reports missing name");

  const valid = validateSupplierInput({
    supplier_name: "  Acme Traders  ",
    phone: "0300-123",
    credit_limit: 50000,
    credit_days: 30,
  });
  assertEqual(valid.ok, true, "Valid supplier input passes");

  const longName = validateSupplierInput({ supplier_name: "x".repeat(MAX_SUPPLIER_NAME_LENGTH + 1) });
  assertEqual(longName.ok, false, "Overlong name is rejected");

  const longNotes = validateSupplierInput({
    supplier_name: "Acme",
    notes: "y".repeat(MAX_NOTES_LENGTH + 1),
  });
  assertEqual(longNotes.ok, false, "Overlong notes are rejected");

  const negativeCredit = validateSupplierInput({ supplier_name: "Acme", credit_limit: -5 });
  assertEqual(negativeCredit.ok, false, "Negative credit limit is rejected");

  const badPolicy = validateSupplierInput({ supplier_name: "Acme", credit_policy: "weekly" });
  assertEqual(badPolicy.ok, false, "Unknown credit policy is rejected");

  const goodPolicy = validateSupplierInput({ supplier_name: "Acme", credit_policy: "cash_only" });
  assertEqual(goodPolicy.ok, true, "Known credit policy passes");
}

testSupplierValidator();

console.log("\n=== validatePurchaseTransactionInput ===\n");

function testPurchaseTransactionValidator() {
  const noSupplier = validatePurchaseTransactionInput({ supplier_id: null, lines: [] });
  assertEqual(noSupplier.ok, false, "Missing supplier is rejected");

  const noLines = validatePurchaseTransactionInput({ supplier_id: "sup-1", lines: [] });
  assertEqual(noLines.ok, false, "Empty lines are rejected");
  assertTrue(noLines.errors.some((e) => /at least one product line/i.test(e)), "Reports missing lines");

  const badLine = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    lines: [{ product_id: null, quantity: 0, purchase_price: -1 }],
  });
  assertEqual(badLine.ok, false, "Invalid line is rejected");
  assertTrue(badLine.errors.some((e) => /Line 1: select a product/i.test(e)), "Reports missing product per line");
  assertTrue(badLine.errors.some((e) => /quantity must be greater than zero/i.test(e)), "Reports bad quantity per line");

  const valid = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    purchase_date: "2026-02-01",
    payment_type: "cash",
    lines: [{ product_id: "prod-1", quantity: 2, purchase_price: 150 }],
  });
  assertEqual(valid.ok, true, "Valid purchase transaction passes");

  const badDate = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    purchase_date: "not-a-date",
    lines: [{ product_id: "prod-1", quantity: 1, purchase_price: 10 }],
  });
  assertEqual(badDate.ok, false, "Invalid purchase date is rejected");

  const badPayment = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    payment_type: "card",
    lines: [{ product_id: "prod-1", quantity: 1, purchase_price: 10 }],
  });
  assertEqual(badPayment.ok, false, "Unknown payment type is rejected");
}

testPurchaseTransactionValidator();

console.log("\n=== Normalization helpers ===\n");

function testNormalization() {
  assertEqual(normalizeOptionalText("  hi  "), "hi", "Text is trimmed");
  assertEqual(normalizeOptionalText(""), null, "Empty text normalizes to null");
  assertEqual(normalizeOptionalText(null), null, "null stays null");
  assertEqual(normalizeOptionalNumber("150"), 150, "Numeric string converts to number");
  assertEqual(normalizeOptionalNumber(""), null, "Empty string normalizes to null");
  assertEqual(normalizeOptionalNumber(null), null, "null stays null");
  assertEqual(normalizeOptionalNumber("abc"), null, "Non-numeric string normalizes to null");
}

testNormalization();

// ─── SupplierService with mock client ───────────────────────────────────────

console.log("\n=== SupplierService ===\n");

async function testCreateSupplier() {
  const { mock, client } = createMockSupabase({ data: [storedSupplier], error: null });
  const service = SupplierService.withSupabase(client);

  const created = await service.createSupplier(owner, {
    supplier_name: "Test Supplier",
    phone: "123",
    city: "Lahore",
    credit_days: 30,
  });

  assertEqual(created.id, "sup-1", "Returns created supplier");
  assertEqual(mock.fromCalls[0].table, "suppliers", "Inserts into suppliers table");
  const insertArgs = findCall(mock.fromCalls[0].builder.calls as Call[], "insert")?.args[0] as Record<string, unknown>;
  assertEqual(insertArgs.organization_id, "org-1", "Insert is scoped to the actor's organization");
  assertEqual(insertArgs.supplier_name, "Test Supplier", "Insert carries the validated name");
  const auditInsert = findCallOnTable(mock.fromCalls, "audit_logs", "insert")?.args[0] as Record<string, unknown>;
  assertTrue(!!auditInsert, "Audits the creation");
  assertEqual(auditInsert.action, "supplier_created", "Audit action is supplier_created");
  assertEqual(auditInsert.actor_profile_id, "profile-1", "Audit records the actor profile");
}

async function testGetSupplier() {
  const { mock, client } = createMockSupabase({ data: [storedSupplier], error: null });
  const service = SupplierService.withSupabase(client);

  const supplier = await service.getSupplier(owner, "sup-1");
  assertEqual(supplier.id, "sup-1", "Returns the supplier");
  const lastSuppliersBuilder = [...mock.fromCalls].reverse().find((c) => c.table === "suppliers");
  const orgFilter = lastSuppliersBuilder?.builder.calls.find((c) => c.method === "eq" && c.args[0] === "organization_id");
  assertTrue(!!orgFilter, "Tenant filter is applied");
  assertEqual(orgFilter?.args[1], "org-1", "Tenant filter uses the actor's organization");
}

async function testGetSupplierNotFound() {
  const { client } = createMockSupabase({ data: [], error: null });
  const service = SupplierService.withSupabase(client);
  await assertThrows(() => service.getSupplier(owner, "missing"), "Missing supplier throws Supplier not found");
}

async function testCrossTenantDenied() {
  const { client } = createMockSupabase({ data: [], error: null });
  const service = SupplierService.withSupabase(client);
  const otherOrg: ActorContext = { ...owner, organizationId: "org-2" };
  await assertThrows(() => service.getSupplier(otherOrg, "sup-1"), "Supplier from another org is not visible");
}

async function testUpdateSupplier() {
  const { mock, client } = createMockSupabase({ data: [storedSupplier], error: null });
  const service = SupplierService.withSupabase(client);

  const updated = await service.updateSupplier(owner, "sup-1", { supplier_name: "Renamed" });
  assertEqual(updated.supplier_name, "Test Supplier", "Returns the stored (mock) record");
  const updateCall = findCallOnTable(mock.fromCalls, "suppliers", "update");
  assertTrue(!!updateCall, "Issues an update");
  const updateArgs = updateCall?.args[0] as Record<string, unknown>;
  assertEqual(updateArgs.supplier_name, "Renamed", "Update carries the new name");
  assertEqual(updateArgs.credit_days, undefined, "Unsupplied fields are not overwritten");
}

async function testDeleteSupplier() {
  const { mock, client } = createMockSupabase({ data: [storedSupplier], error: null });
  const service = SupplierService.withSupabase(client);

  await service.deleteSupplier(owner, "sup-1");
  const deleteCall = findCallOnTable(mock.fromCalls, "suppliers", "delete");
  assertTrue(!!deleteCall, "Issues a delete");
  const auditArgs = findCallOnTable(mock.fromCalls, "audit_logs", "insert")?.args[0] as Record<string, unknown>;
  assertEqual(auditArgs.action, "supplier_deleted", "Audits the deletion");
}

async function main() {
  await testCreateSupplier();
  await testGetSupplier();
  await testGetSupplierNotFound();
  await testCrossTenantDenied();
  await testUpdateSupplier();
  await testDeleteSupplier();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
