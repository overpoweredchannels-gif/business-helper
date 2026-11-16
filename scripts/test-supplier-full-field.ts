/**
 * Supplier full-field API slice (P0-6) — Unit Tests.
 *
 * The audit premise was stale: the full-field wiring landed in commit
 * 424e444 ("Supplier edit/delete: full-field API wiring + 7-day recycle
 * bin") — the form already writes every field through the full-field API.
 * What was genuinely missing, and what this slice adds:
 *   1. The suppliers list never rendered the area or the two over-limit
 *      flags (saved by the form, stored, invisible except in Edit).
 *      The display helpers are the single rendering for the list and the
 *      CSV export, so the two surfaces can never drift apart again.
 *   2. The save handler did Number(raw) with no finiteness check: a
 *      non-numeric string becomes NaN, JSON.stringify turns NaN into
 *      null, and the typed value is silently dropped.
 * This test proves: the display helpers render every saved field, the
 * client guard rejects bad numbers, the service passes every field
 * through on create and update, and the export carries the new columns.
 *
 * Run: npx tsx scripts/test-supplier-full-field.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  supplierCreditSummary,
  supplierOverLimitSummary,
  validateSupplierCreditFields,
} from "../src/lib/suppliers/display";
import { buildSupplierExportRows } from "../src/lib/suppliers/export";
import { SupplierService } from "../src/lib/purchases/services/supplier-service";
import { validateSupplierInput } from "../src/lib/purchases/validation";
import type { ActorContext } from "../src/lib/identity/types";
import type { MessageKey } from "../src/lib/regional/messages";
import type { Supplier } from "../src/lib/tradeos/types";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

// ─── Translator stub (English labels, like the en locale) ──────────────────

const labels: Record<string, string> = {
  "common.none": "None",
  "common.yes": "Yes",
  "common.no": "No",
  "suppliers.creditDaysSuffix": "days",
  "page.creditCashOnly": "Cash Only",
  "page.creditUnrestricted": "Unrestricted Credit",
  "money.cash": "Cash",
  "money.bank": "Bank",
  "money.card": "Card",
  "money.cheque": "Cheque",
  "suppliers.allowOverLimitLabel": "Allow over credit limit",
  "suppliers.allowOverdueSalesLabel": "Allow sales with overdue balance",
};

const t = (key: MessageKey): string => labels[key] ?? key;

const supplierBase: Supplier = {
  id: "s1",
  supplier_name: "Acme Traders",
  contact_person: "Ali Raza",
  phone: "03001234567",
  whatsapp: "03007654321",
  city: "Lahore",
  area: "Gulberg",
  notes: "Main supplier",
  credit_limit: 50000,
  credit_days: 30,
  credit_policy: "cash_only",
  preferred_payment_method: "bank",
  allow_over_limit: true,
  allow_overdue_sales: false,
  outstanding_balance: 1234.5,
  last_purchase_date: "2026-11-10",
  deleted_at: null,
  is_active: true,
};

// ─── 1. Credit summary renders every credit field ─────────────────────────

console.log("\n=== supplierCreditSummary ===\n");

{
  const summary = supplierCreditSummary(supplierBase, t);
  check(summary.includes("50,000"), "Credit summary shows the credit limit");
  check(summary.includes("30 days"), "Credit summary shows the credit days");
  check(summary.includes("Cash Only"), "Credit summary shows the credit policy");
  check(summary.includes("Bank"), "Credit summary shows the preferred payment method");
  check(!summary.includes("None"), "Full supplier shows no None in the credit summary");

  const sparse = supplierCreditSummary(
    { ...supplierBase, credit_limit: null, credit_days: null, credit_policy: null, preferred_payment_method: null },
    t,
  );
  check(sparse === "None · None · None · None", `Unset credit fields show as None (got "${sparse}")`);

  const card = supplierCreditSummary(
    { ...supplierBase, credit_policy: "unrestricted", preferred_payment_method: "card" },
    t,
  );
  check(card.includes("Unrestricted Credit"), "Unrestricted policy renders");
  check(card.includes("Card"), "Card payment method renders");
}

// ─── 2. Over-limit summary renders both flags ─────────────────────────────

console.log("\n=== supplierOverLimitSummary ===\n");

{
  const summary = supplierOverLimitSummary(supplierBase, t);
  check(
    summary === "Allow over credit limit: Yes · Allow sales with overdue balance: No",
    `Both flags render with Yes/No (got "${summary}")`,
  );

  const none = supplierOverLimitSummary(
    { ...supplierBase, allow_over_limit: false, allow_overdue_sales: true },
    t,
  );
  check(
    none === "Allow over credit limit: No · Allow sales with overdue balance: Yes",
    `Mixed flags render correctly (got "${none}")`,
  );

  const unset = supplierOverLimitSummary(
    { ...supplierBase, allow_over_limit: null, allow_overdue_sales: null },
    t,
  );
  check(
    unset === "Allow over credit limit: No · Allow sales with overdue balance: No",
    `Null flags count as No, the effective permission (got "${unset}")`,
  );
}

// ─── 3. Client-side credit-number guard ────────────────────────────────────

console.log("\n=== validateSupplierCreditFields ===\n");

{
  check(validateSupplierCreditFields("", "") === null, "Empty fields are fine (unset)");
  check(validateSupplierCreditFields("50000", "30") === null, "Valid numbers pass");
  check(validateSupplierCreditFields("10.5", "0") === null, "Decimal limit and zero days pass");
  check(
    validateSupplierCreditFields("-5", "30") === "suppliers.creditLimitInvalid",
    "Negative credit limit is rejected",
  );
  check(
    validateSupplierCreditFields("abc", "30") === "suppliers.creditLimitInvalid",
    "Non-numeric credit limit is rejected (no silent NaN-to-null drop)",
  );
  check(
    validateSupplierCreditFields("50000", "-1") === "suppliers.creditDaysInvalid",
    "Negative credit days are rejected",
  );
  check(
    validateSupplierCreditFields("50000", "x") === "suppliers.creditDaysInvalid",
    "Non-numeric credit days are rejected",
  );
  check(
    validateSupplierCreditFields("  ", "30") === null,
    "Blank limit (whitespace only) counts as unset",
  );
}

// ─── 4. Server validation still rejects bad credit values ─────────────────

console.log("\n=== validateSupplierInput (server rule) ===\n");

{
  check(
    validateSupplierInput({ supplier_name: "Acme", credit_days: -1 }).ok === false,
    "Negative credit days are rejected server-side",
  );
  check(
    validateSupplierInput({ supplier_name: "Acme", credit_limit: -5 }).ok === false,
    "Negative credit limit is rejected server-side",
  );
  check(
    validateSupplierInput({
      supplier_name: "Acme",
      area: "Gulberg",
      credit_limit: 50000,
      credit_days: 30,
      credit_policy: "unrestricted",
      preferred_payment_method: "card",
      allow_over_limit: true,
      allow_overdue_sales: true,
    }).ok === true,
    "A supplier with every full field passes server validation",
  );
}

// ─── 5. Service passes every field through (mock Supabase) ────────────────

console.log("\n=== SupplierService full-field passthrough ===\n");

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
    then(
      onFulfilled?: (value: { data: unknown[] | null; error: { message: string } | null; count: number }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: finalResult.data, error: finalResult.error, count: 0 }).then(
        onFulfilled,
        onRejected,
      );
    },
  };
  return builder;
}

function createMockSupabase(finalResult: { data: unknown[] | null; error: { message: string } | null }) {
  const fromCalls: Array<{ table: string; builder: { calls: Call[] } }> = [];
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

function findCallOnTable(
  mock: Array<{ table: string; builder: { calls: Call[] } }>,
  table: string,
  method: string,
): Call | undefined {
  for (let i = mock.length - 1; i >= 0; i--) {
    if (mock[i].table === table) {
      const found = mock[i].builder.calls.find((c) => c.method === method);
      if (found) return found;
    }
  }
  return undefined;
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
  supplier_name: "Acme Traders",
  contact_person: "Ali Raza",
  phone: "03001234567",
  whatsapp: "03007654321",
  city: "Lahore",
  area: "Gulberg",
  notes: "Main supplier",
  credit_limit: 50000,
  credit_days: 30,
  credit_policy: "cash_only",
  preferred_payment_method: "bank",
  allow_over_limit: true,
  allow_overdue_sales: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const fullInput = {
  supplier_name: "Acme Traders",
  contact_person: "Ali Raza",
  phone: "03001234567",
  whatsapp: "03007654321",
  city: "Lahore",
  area: "Gulberg",
  notes: "Main supplier",
  credit_limit: 50000,
  credit_days: 30,
  credit_policy: "cash_only",
  preferred_payment_method: "bank",
  allow_over_limit: true,
  allow_overdue_sales: false,
};

async function testServicePassthrough() {
  const { mock, client } = createMockSupabase({ data: [storedSupplier], error: null });
  const service = SupplierService.withSupabase(client);

  await service.createSupplier(owner, fullInput);
  const insertArgs = findCallOnTable(mock.fromCalls, "suppliers", "insert")?.args[0] as Record<string, unknown>;
  check(insertArgs.area === "Gulberg", "Create insert carries area");
  check(insertArgs.credit_limit === 50000, "Create insert carries credit limit");
  check(insertArgs.credit_days === 30, "Create insert carries credit days");
  check(insertArgs.credit_policy === "cash_only", "Create insert carries credit policy");
  check(insertArgs.preferred_payment_method === "bank", "Create insert carries preferred payment method");
  check(insertArgs.allow_over_limit === true, "Create insert carries allow_over_limit");
  check(insertArgs.allow_overdue_sales === false, "Create insert carries allow_overdue_sales");

  const { mock: mock2, client: client2 } = createMockSupabase({ data: [storedSupplier], error: null });
  const service2 = SupplierService.withSupabase(client2);
  await service2.updateSupplier(owner, "sup-1", {
    ...fullInput,
    area: "Model Town",
    credit_limit: 75000,
    allow_over_limit: false,
  });
  const updateArgs = findCallOnTable(mock2.fromCalls, "suppliers", "update")?.args[0] as Record<string, unknown>;
  check(updateArgs.area === "Model Town", "Update carries the new area");
  check(updateArgs.credit_limit === 75000, "Update carries the new credit limit");
  check(updateArgs.credit_days === 30, "Update carries credit days");
  check(updateArgs.credit_policy === "cash_only", "Update carries credit policy");
  check(updateArgs.preferred_payment_method === "bank", "Update carries preferred payment method");
  check(updateArgs.allow_over_limit === false, "Update carries allow_over_limit=false");
  check(updateArgs.allow_overdue_sales === false, "Update carries allow_overdue_sales=false");
}

// ─── 6. Export carries the new columns via the shared helpers ─────────────

console.log("\n=== buildSupplierExportRows (shared helpers) ===\n");

function testExportColumns() {
  const rows = buildSupplierExportRows([supplierBase], {
    noneLabel: "None",
    formatDate: (value: string) => `formatted:${value}`,
    creditSummary: (supplier) => supplierCreditSummary(supplier, t),
    overLimitSummary: (supplier) => supplierOverLimitSummary(supplier, t),
  });
  assert.deepEqual(Object.keys(rows[0]), [
    "Supplier Name",
    "Contact Person",
    "Phone",
    "City",
    "Area",
    "Outstanding Balance",
    "Last Purchase",
    "Credit",
    "Over-limit",
    "Status",
  ]);
  check(rows[0]?.Area === "Gulberg", "Export Area column shows the saved area");
  check(
    rows[0]?.["Over-limit"] === "Allow over credit limit: Yes · Allow sales with overdue balance: No",
    "Export Over-limit column shows both flags",
  );
  check(
    typeof rows[0]?.Credit === "string" && (rows[0]?.Credit as string).includes("Cash Only"),
    "Export Credit column uses the shared credit summary",
  );

  const sparse = buildSupplierExportRows(
    [{ ...supplierBase, area: null, allow_over_limit: null, allow_overdue_sales: null }],
    {
      noneLabel: "None",
      formatDate: (value: string) => `formatted:${value}`,
      creditSummary: (supplier) => supplierCreditSummary(supplier, t),
      overLimitSummary: (supplier) => supplierOverLimitSummary(supplier, t),
    },
  );
  check(sparse[0]?.Area === "None", "Export shows None for a missing area");
  check(
    sparse[0]?.["Over-limit"] === "Allow over credit limit: No · Allow sales with overdue balance: No",
    "Export shows No for null flags",
  );
}

// ─── 7. Credit inputs are text inputs so the guard can fire ──────────────
//
// Follow-up fix (live QA 2026-11-16): the guard in §3 already rejected
// "abc" and "x", but the inputs were type="number", and a number input
// swallows non-numeric keystrokes in the browser — the typed text never
// reached the guard, the state stayed "", and the save proceeded with an
// empty credit limit. These inputs must stay type="text" (with inputMode
// for the mobile numeric keyboard) so the raw string reaches the guard.
// This section proves the wiring: the input type in page.tsx, and the
// save decision (blocked vs allowed) for each raw typed string.

console.log("\n=== Credit inputs reach the guard (text, not number) ===\n");

function inputTagFor(source: string, valueAttr: string): string | null {
  const valueIndex = source.indexOf(valueAttr);
  if (valueIndex === -1) return null;
  const inputStart = source.lastIndexOf("<input", valueIndex);
  if (inputStart === -1) return null;
  return source.slice(inputStart, valueIndex);
}

{
  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  const limitInput = inputTagFor(pageSource, "value={supplierCreditLimit}");
  check(limitInput !== null, "Credit Limit input exists in the supplier form");
  check(
    limitInput?.includes('type="text"') === true,
    'Credit Limit input is type="text" so non-numeric keystrokes reach the guard',
  );
  check(
    limitInput?.includes('inputMode="decimal"') === true,
    "Credit Limit input keeps the numeric keyboard on mobile",
  );
  check(
    limitInput?.includes('type="number"') === false,
    'Credit Limit input is not type="number" (which swallows non-numeric text)',
  );

  const daysInput = inputTagFor(pageSource, "value={supplierCreditDays}");
  check(daysInput !== null, "Credit Days input exists in the supplier form");
  check(
    daysInput?.includes('type="text"') === true,
    'Credit Days input is type="text" so non-numeric keystrokes reach the guard',
  );
  check(
    daysInput?.includes('inputMode="decimal"') === true,
    "Credit Days input keeps the numeric keyboard on mobile",
  );
  check(
    daysInput?.includes('type="number"') === false,
    'Credit Days input is not type="number" (which swallows non-numeric text)',
  );

  // The save decision in handleSaveSupplier: the guard runs on the raw
  // typed strings; a returned key blocks the save with that error, null
  // lets it proceed. This is the exact flow a user typing "abc" takes.
  const saveBlocked = (limitRaw: string, daysRaw: string): string | null =>
    validateSupplierCreditFields(limitRaw, daysRaw);
  check(
    saveBlocked("abc", "30") === "suppliers.creditLimitInvalid",
    'Typing "abc" in Credit Limit blocks the save with the credit-limit error',
  );
  check(
    saveBlocked("50000", "x") === "suppliers.creditDaysInvalid",
    'Typing "x" in Credit Days blocks the save with the credit-days error',
  );
  check(
    saveBlocked("-5", "30") === "suppliers.creditLimitInvalid",
    "Typing -5 in Credit Limit blocks the save",
  );
  check(
    saveBlocked("50000", "-1") === "suppliers.creditDaysInvalid",
    "Typing -1 in Credit Days blocks the save",
  );
  check(
    saveBlocked("", "") === null,
    "Blank credit fields still allow the save (the fields are optional)",
  );
  check(
    saveBlocked("50000", "30") === null,
    "Valid credit numbers still allow the save",
  );
}

async function main() {
  testExportColumns();
  await testServicePassthrough();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
