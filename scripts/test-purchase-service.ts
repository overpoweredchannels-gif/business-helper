/**
 * Purchase Service — Unit Tests
 *
 * Exercises the PurchaseService end-to-end against a mock Supabase query
 * builder that faithfully mimics the real @supabase/supabase-js chainable
 * API (.from().select().eq().maybeSingle().insert().rpc()...). No live
 * database required.
 *
 * Run: npx tsx scripts/test-purchase-service.ts
 */

import { PurchaseService } from "../src/lib/purchases/services/purchase-service";
import {
  validatePurchaseTransactionInput,
  validateSupplierInput,
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

const storedTransaction = {
  id: "tx-1",
  organization_id: "org-1",
  supplier_id: "sup-1",
  invoice_number: "P-50005",
  purchase_date: "2026-02-01",
  payment_type: "cash",
  notes: null,
  total_amount: 300,
  status: "confirmed",
  invoice_type: "purchase",
  created_by_profile_id: "profile-1",
  created_at: "2026-02-01T10:00:00.000Z",
  updated_at: "2026-02-01T10:00:00.000Z",
};

const storedItems = [
  {
    id: "item-1",
    purchase_transaction_id: "tx-1",
    organization_id: "org-1",
    product_id: 101,
    quantity: 2,
    purchase_price: 150,
    batch_number: null,
    expiry_date: null,
    created_at: "2026-02-01T10:00:00.000Z",
  },
];

const storedSupplier = { id: "sup-1", supplier_name: "Acme", outstanding_balance: 1000 };

const storedProduct = { id: 101, name: "Widget" };

// ─── Mock Supabase query builder ─────────────────────────────────────────────

type Call = { method: string; args: unknown[] };
type MockConfig = {
  tables?: Record<string, { list?: unknown[]; single?: unknown }>;
  rpc?: number;
};

function createMockSupabase(config: MockConfig = {}) {
  const fromCalls: Array<{ table: string; calls: Call[] }> = [];
  const rpcCalls: Call[] = [];

  const makeBuilder = (table: string) => {
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
        return Promise.resolve({ data: config.tables?.[table]?.list ?? [], error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: config.tables?.[table]?.single ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: config.tables?.[table]?.single ?? null, error: null });
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
  };

  const client = {
    rpc(...args: unknown[]) {
      rpcCalls.push({ method: "rpc", args });
      return Promise.resolve({ data: config.rpc ?? 1, error: null });
    },
    from(table: string) {
      const builder = makeBuilder(table);
      fromCalls.push({ table, calls: builder.calls });
      return builder;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    fromCalls,
    rpcCalls,
  };
}

function lastCallOnTable(fromCalls: Array<{ table: string; calls: Call[] }>, table: string, method: string): Call | undefined {
  for (let i = fromCalls.length - 1; i >= 0; i--) {
    if (fromCalls[i].table === table) {
      const found = fromCalls[i].calls.find((c) => c.method === method);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

// ─── Validator tests ─────────────────────────────────────────────────────────

console.log("\n=== validatePurchaseTransactionInput ===\n");

function testPurchaseTransactionValidator() {
  const valid = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    purchase_date: "2026-02-01",
    payment_type: "credit",
    notes: "Monthly restock",
    lines: [
      { product_id: 101, quantity: 5, purchase_price: 100, batch_number: "B1", expiry_date: "2027-01-01" },
      { product_id: 102, quantity: 10, purchase_price: 50 },
    ],
  });
  assertEqual(valid.ok, true, "Valid multi-line purchase passes");

  const emptyLines = validatePurchaseTransactionInput({ supplier_id: "sup-1", lines: [] });
  assertEqual(emptyLines.ok, false, "Empty lines are rejected");

  const noSupplier = validatePurchaseTransactionInput({ supplier_id: null, lines: [{ product_id: 1, quantity: 1, purchase_price: 1 }] });
  assertEqual(noSupplier.ok, false, "Missing supplier is rejected");

  const badLine = validatePurchaseTransactionInput({
    supplier_id: "sup-1",
    lines: [{ product_id: null, quantity: 0, purchase_price: -5 }],
  });
  assertEqual(badLine.ok, false, "Invalid line values are rejected");
}

testPurchaseTransactionValidator();

console.log("\n=== validateSupplierInput ===\n");

function testSupplierValidator() {
  const valid = validateSupplierInput({ supplier_name: "Acme Traders", credit_days: 30 });
  assertEqual(valid.ok, true, "Valid supplier passes");
  const missing = validateSupplierInput({});
  assertEqual(missing.ok, false, "Missing name is rejected");
}

testSupplierValidator();

// ─── PurchaseService with mock client ───────────────────────────────────────

console.log("\n=== PurchaseService ===\n");

async function testCreatePurchaseCash() {
  const { client, fromCalls, rpcCalls } = createMockSupabase({
    tables: {
      suppliers: { single: storedSupplier },
      products: { single: storedProduct },
      purchase_transactions: { single: storedTransaction },
    },
    rpc: 5,
  });
  const service = PurchaseService.withSupabase(client);

  const result = await service.createPurchase(owner, {
    supplier_id: "sup-1",
    purchase_date: "2026-02-01",
    payment_type: "cash",
    created_by_profile_id: "spoofed-profile",
    notes: "Monthly restock",
    lines: [{ product_id: 101, quantity: 2, purchase_price: 150, unit_mode: "subunit" }],
  });

  assertEqual(result.transaction.invoice_number, "P-50005", "Invoice number is server-generated (P-50005)");
  const txInsert = lastCallOnTable(fromCalls, "purchase_transactions", "insert")?.args[0] as Record<string, unknown>;
  assertEqual(txInsert.organization_id, "org-1", "Transaction is scoped to the actor's organization");
  assertEqual(txInsert.status, "confirmed", "Transaction is created as confirmed");
  assertEqual(txInsert.invoice_type, "purchase", "Transaction invoice_type is purchase");
  assertEqual(txInsert.total_amount, 300, "Total amount is computed from lines");
  assertEqual(txInsert.payment_type, "cash", "Payment type is normalized to lowercase");
  assertEqual(txInsert.created_by_profile_id, "profile-1", "Creator is always the authenticated actor profile");

  const itemsInsert = lastCallOnTable(fromCalls, "purchase_items", "insert")?.args[0] as Array<Record<string, unknown>>;
  assertTrue(Array.isArray(itemsInsert), "Items are inserted in a single call");
  assertEqual(itemsInsert[0].purchase_transaction_id, "tx-1", "Items reference the created transaction");
  assertEqual(itemsInsert[0].organization_id, "org-1", "Items carry the organization id");
  assertEqual(itemsInsert[0].product_id, 101, "Item carries the product id");
  assertEqual(itemsInsert[0].quantity, 2, "Item carries the quantity");
  assertEqual(itemsInsert[0].unit_mode, "subunit", "Item preserves subunit purchase mode");

  const audit = lastCallOnTable(fromCalls, "audit_logs", "insert")?.args[0] as Record<string, unknown>;
  assertEqual(audit.action, "purchase_created", "Audits the purchase creation");

  assertEqual(rpcCalls.length, 1, "Calls the invoice number RPC exactly once");
}

async function testCreatePurchaseCreditUpdatesSupplierBalance() {
  const { client, fromCalls } = createMockSupabase({
    tables: {
      suppliers: { single: storedSupplier },
      products: { single: storedProduct },
      purchase_transactions: { single: storedTransaction },
    },
    rpc: 6,
  });
  const service = PurchaseService.withSupabase(client);

  await service.createPurchase(owner, {
    supplier_id: "sup-1",
    purchase_date: "2026-02-01",
    payment_type: "credit",
    credit_days: 30,
    lines: [{ product_id: 101, quantity: 2, purchase_price: 150 }],
  });

  const balanceUpdate = lastCallOnTable(fromCalls, "suppliers", "update")?.args[0] as Record<string, unknown>;
  assertEqual(balanceUpdate.outstanding_balance, 1300, "Credit purchase increases supplier outstanding balance");

  const txInsert = lastCallOnTable(fromCalls, "purchase_transactions", "insert")?.args[0] as Record<string, unknown>;
  assertTrue(typeof txInsert.credit_due_date === "string", "Credit purchase sets a credit due date");
  assertEqual(String(txInsert.credit_due_date).slice(0, 10), "2026-03-03", "Credit due date is based on purchase date");
}

async function testCreatePurchaseValidationFailure() {
  const { client } = createMockSupabase({
    tables: {
      suppliers: { single: storedSupplier },
      products: { single: storedProduct },
    },
    rpc: 7,
  });
  const service = PurchaseService.withSupabase(client);

  await assertThrows(
    () => service.createPurchase(owner, { supplier_id: "sup-1", lines: [] }),
    "Empty lines are rejected by the service",
  );
}

async function testCreatePurchaseUnknownSupplier() {
  const { client } = createMockSupabase({
    tables: {
      suppliers: { single: null },
      products: { single: storedProduct },
      purchase_transactions: { single: storedTransaction },
    },
    rpc: 8,
  });
  const service = PurchaseService.withSupabase(client);

  await assertThrows(
    () =>
      service.createPurchase(owner, {
        supplier_id: "sup-999",
        lines: [{ product_id: 101, quantity: 1, purchase_price: 10 }],
      }),
    "Unknown supplier is rejected",
  );
}

async function testCreatePurchaseUnknownProduct() {
  const { client, fromCalls } = createMockSupabase({
    tables: {
      suppliers: { single: storedSupplier },
      products: { single: null },
      purchase_transactions: { single: storedTransaction },
    },
    rpc: 9,
  });
  const service = PurchaseService.withSupabase(client);

  await assertThrows(
    () =>
      service.createPurchase(owner, {
        supplier_id: "sup-1",
        lines: [{ product_id: 999, quantity: 1, purchase_price: 10 }],
      }),
    "Unknown product is rejected",
  );

  const txInserts = fromCalls.filter((c) => c.table === "purchase_transactions" && c.calls.some((x) => x.method === "insert"));
  assertEqual(txInserts.length, 0, "No transaction is inserted when a product is invalid");
}

async function testGetPurchase() {
  const { client, fromCalls } = createMockSupabase({
    tables: {
      purchase_transactions: { single: storedTransaction },
      purchase_items: { list: storedItems },
    },
  });
  const service = PurchaseService.withSupabase(client);

  const result = await service.getPurchase(owner, "tx-1");
  assertEqual(result.transaction.invoice_number, "P-50005", "Returns the transaction");
  assertEqual(result.items.length, 1, "Returns the transaction items");

  const txCall = fromCalls.find((c) => c.table === "purchase_transactions");
  const orgFilter = txCall?.calls.find((c) => c.method === "eq" && c.args[0] === "organization_id");
  assertTrue(!!orgFilter, "Transaction lookup is tenant-scoped");
  assertEqual(orgFilter?.args[1], "org-1", "Tenant filter uses the actor's organization");
}

async function testGetPurchaseNotFound() {
  const { client } = createMockSupabase({ tables: { purchase_transactions: { single: null } } });
  const service = PurchaseService.withSupabase(client);
  await assertThrows(() => service.getPurchase(owner, "missing"), "Missing purchase throws Purchase not found");
}

async function testCrossTenantDenied() {
  const { client } = createMockSupabase({ tables: { purchase_transactions: { single: null } } });
  const service = PurchaseService.withSupabase(client);
  const otherOrg: ActorContext = { ...owner, organizationId: "org-2" };
  await assertThrows(() => service.getPurchase(otherOrg, "tx-1"), "Purchase from another org is not visible");
}

async function testListPurchases() {
  const { client, fromCalls } = createMockSupabase({
    tables: { purchase_transactions: { list: [storedTransaction] } },
  });
  const service = PurchaseService.withSupabase(client);

  const purchases = await service.listPurchases(owner);
  assertEqual(purchases.length, 1, "Returns the transaction list");
  const txCall = fromCalls.find((c) => c.table === "purchase_transactions");
  const orgFilter = txCall?.calls.find((c) => c.method === "eq" && c.args[0] === "organization_id");
  assertTrue(!!orgFilter, "List is tenant-scoped");
  assertTrue(!!txCall?.calls.find((c) => c.method === "order"), "List is ordered");
}

async function testDeletePurchase() {
  const { client, fromCalls } = createMockSupabase({
    tables: {
      purchase_transactions: { single: storedTransaction },
      purchase_items: { list: storedItems },
    },
  });
  const service = PurchaseService.withSupabase(client);

  await service.deletePurchase(owner, "tx-1");

  const itemDelete = lastCallOnTable(fromCalls, "purchase_items", "delete");
  assertTrue(!!itemDelete, "Deletes the purchase items first");
  const txDelete = lastCallOnTable(fromCalls, "purchase_transactions", "delete");
  assertTrue(!!txDelete, "Deletes the purchase transaction");
  const audit = lastCallOnTable(fromCalls, "audit_logs", "insert")?.args[0] as Record<string, unknown>;
  assertEqual(audit.action, "purchase_deleted", "Audits the purchase deletion");
}

async function testDeletePurchaseNotFound() {
  const { client } = createMockSupabase({ tables: { purchase_transactions: { single: null } } });
  const service = PurchaseService.withSupabase(client);
  await assertThrows(() => service.deletePurchase(owner, "missing"), "Deleting a missing purchase throws");
}

async function main() {
  await testCreatePurchaseCash();
  await testCreatePurchaseCreditUpdatesSupplierBalance();
  await testCreatePurchaseValidationFailure();
  await testCreatePurchaseUnknownSupplier();
  await testCreatePurchaseUnknownProduct();
  await testGetPurchase();
  await testGetPurchaseNotFound();
  await testCrossTenantDenied();
  await testListPurchases();
  await testDeletePurchase();
  await testDeletePurchaseNotFound();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
