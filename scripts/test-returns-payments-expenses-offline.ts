import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { createLocalStore, type LocalExpenseRow, type LocalPaymentRow, type LocalReturnRow } from "../electron/store";
import {
  DesktopLocalReturnsBackend,
  LocalStorageLocalReturnsBackend,
  getLocalReturnsBackend,
  isPendingReturnHistoryId,
  mergePendingPurchaseReturns,
  mergePendingSalesReturns,
  newLocalReturnRow,
  pendingReturnHistoryId,
  pendingReturnRequestKey,
} from "../src/lib/offline/local-returns";
import {
  DesktopLocalPaymentsBackend,
  LocalStorageLocalPaymentsBackend,
  getLocalPaymentsBackend,
  isPendingPaymentHistoryId,
  mergePendingCustomerPayments,
  mergePendingSupplierPayments,
  newLocalPaymentRow,
  newLocalVoidRow,
  pendingPaymentHistoryId,
} from "../src/lib/offline/local-payments";
import {
  DesktopLocalExpensesBackend,
  LocalStorageLocalExpensesBackend,
  getLocalExpensesBackend,
  isPendingExpenseHistoryId,
  mergePendingExpenses,
  newLocalExpenseRow,
  pendingExpenseHistoryId,
} from "../src/lib/offline/local-expenses";
import {
  drainPendingReturns,
  retryReturnSyncIssue,
  type ReturnServer,
} from "../src/lib/offline/return-sync";
import {
  drainPendingPayments,
  retryPaymentSyncIssue,
  type PaymentServer,
} from "../src/lib/offline/payment-sync";
import {
  drainPendingExpenses,
  retryExpenseSyncIssue,
  type ExpenseServer,
} from "../src/lib/offline/expense-sync";
import { loadHistoryMirror } from "../src/lib/offline/history-mirror";
import { deriveOfflineCustomerBalance, type LocalLedgerRows } from "../src/lib/offline/customer-balance-offline";
import { getSyncIssuesBackend } from "../src/lib/offline/sync-issues";
import type { PurchaseReturn, SalesReturn } from "../src/lib/tradeos/types";

// Slice S7 — returns + payments + expenses offline.
// The SQLite store holds offline-created sales/purchase returns (full
// return input + a client idempotency key + a provisional SR/PR-number),
// customer/supplier payments (full payment input + a client key + a
// provisional PY-number, voids as action "void" rows), and expenses
// (full expense input + a client key + a provisional EX-number); the
// renderer seams mirror the local-sales / local-customers /
// local-purchases patterns (SQLite on desktop, localStorage fallback);
// payments drain through the existing phase-14/15 RPCs
// (create_payment_atomic + get_payment_request_status, status-check-
// first); returns + expenses drain through the cloud routes with new
// server idempotency (returns_expenses_idempotency.sql — file only,
// never run here), same-key-different-payload parks in Sync Issues.
// The derived customer balance always comes from the ledger engine:
// a return or a payment reduces it, a voided payment covers nothing.

const SCOPE = "org-1:profile-1";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "00000000-0000-4000-8000-000000000002";

function mustBePresent<T>(value: T, message: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(message);
  return value as NonNullable<T>;
}

function installWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value });
}

function mapStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

/** Minimal window: localStorage + a dispatch that never throws. */
function stubWindow(extra: Record<string, unknown> = {}) {
  installWindow({
    localStorage: mapStorage(new Map<string, string>()),
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    ...extra,
  });
}

function stubMirrorBridge() {
  const rows = new Map<string, Array<{ id: string; data: Record<string, unknown>; savedAt: string }>>();
  return {
    list: async (kind: string, scope: string) => rows.get(`${kind}:${scope}`) ?? [],
    replace: async (kind: string, scope: string, next: Array<{ id: string; data: Record<string, unknown> }>) => {
      const savedAt = new Date().toISOString();
      const stored = next.map((row) => ({ ...row, savedAt }));
      rows.set(`${kind}:${scope}`, stored);
      return stored;
    },
    upsert: async (kind: string, scope: string, row: { id: string; data: Record<string, unknown> }) => {
      const savedAt = new Date().toISOString();
      const stored = { ...row, savedAt };
      const key = `${kind}:${scope}`;
      rows.set(key, [...(rows.get(key) ?? []).filter((item) => item.id !== row.id), stored]);
      return stored;
    },
  };
}

function stubDesktopWindowWithMirror() {
  stubWindow({ aankhDesktop: { isDesktop: true, mirror: stubMirrorBridge() } });
}

function salesReturnInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId: CUSTOMER_ID,
    salesTransactionId: "tx-sale-1",
    returnDate: "2026-11-17",
    reason: "damaged",
    lines: [
      { productId: 1, quantity: 2, unitPrice: 10, discount: 0, unitMode: "main", batchNumber: null, expiryDate: null },
    ],
    ...overrides,
  };
}

function purchaseReturnInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplierId: SUPPLIER_ID,
    purchaseTransactionId: "tx-purchase-1",
    returnDate: "2026-11-17",
    reason: "expired",
    lines: [
      { productId: 2, quantity: 1, unitPrice: 25, discount: 0, unitMode: "main", batchNumber: null, expiryDate: null },
    ],
    ...overrides,
  };
}

function paymentInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "customer",
    partyId: CUSTOMER_ID,
    amount: 40,
    paymentDate: "2026-11-17",
    paymentMethod: "cash",
    reference: null,
    notes: null,
    allocations: [{ invoice_id: "tx-sale-1", amount: 40 }],
    ...overrides,
  };
}

function expenseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expense_type: "Transport",
    amount: 15,
    notes: null,
    expense_date: "2026-11-17",
    supplier_id: null,
    customer_id: null,
    purchase_transaction_id: null,
    sales_transaction_id: null,
    ...overrides,
  };
}

function salesReturnRow(id: string, overrides: Partial<LocalReturnRow> = {}): LocalReturnRow {
  return {
    id,
    kind: "sales",
    input: salesReturnInput(),
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

function paymentRow(id: string, overrides: Partial<LocalPaymentRow> = {}): LocalPaymentRow {
  return {
    id,
    action: "pay",
    input: paymentInput(),
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

function expenseRow(id: string, overrides: Partial<LocalExpenseRow> = {}): LocalExpenseRow {
  return {
    id,
    input: expenseInput(),
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

async function main(): Promise<void> {
  // 1. SQLite store: provisional numbers sequence per kind, never
  //    reused across reopen, idempotency keys are unique, and a
  //    pre-S7 database migrates (downgrade-and-reopen).
  {
    const dir = mkdtempSync(join(tmpdir(), "aankh-s7-"));
    try {
      const dbPath = join(dir, "aankh.db");
      const store = createLocalStore(dbPath);
      const firstSales = store.upsertReturn(SCOPE, salesReturnRow("key-return-1"));
      assert.equal(firstSales.provisionalNumber, "SR-000001", "the first sales return gets SR-000001");
      const secondSales = store.upsertReturn(SCOPE, salesReturnRow("key-return-2"));
      assert.equal(secondSales.provisionalNumber, "SR-000002", "the second sales return gets SR-000002");
      const firstPurchase = store.upsertReturn(SCOPE, {
        ...salesReturnRow("key-return-3"),
        kind: "purchase",
        input: purchaseReturnInput(),
      });
      assert.equal(firstPurchase.provisionalNumber, "PR-000001", "purchase returns sequence separately from SR-000001");
      const firstPayment = store.upsertPayment(SCOPE, paymentRow("key-payment-1"));
      assert.equal(firstPayment.provisionalNumber, "PY-000001", "the first payment gets PY-000001");
      const firstVoid = store.upsertPayment(SCOPE, {
        ...paymentRow("key-void-1"),
        action: "void",
        input: { kind: "customer", paymentId: "pay-server-1", reason: null },
      });
      assert.equal(firstVoid.provisionalNumber, "PY-000002", "a void row takes the next payment number");
      const firstExpense = store.upsertExpense(SCOPE, expenseRow("key-expense-1"));
      assert.equal(firstExpense.provisionalNumber, "EX-000001", "the first expense gets EX-000001");
      // The idempotency key is the row id, and the store upserts: a
      // second row with the same key replaces in place instead of
      // creating a second row — the same key can never duplicate.
      const replacedReturn = store.upsertReturn(SCOPE, salesReturnRow("key-return-1", { syncError: "boom" }));
      assert.equal(replacedReturn.provisionalNumber, "SR-000001", "a rewrite keeps its provisional number");
      assert.equal(store.listReturns(SCOPE).length, 3, "the same key never creates a second return row");
      assert.equal(
        mustBePresent(store.listReturns(SCOPE).find((row) => row.id === "key-return-1"), "the replaced return is listed").syncError,
        "boom",
        "the rewrite carries the new contents",
      );
      store.upsertPayment(SCOPE, paymentRow("key-payment-1", { syncError: "boom" }));
      assert.equal(store.listPayments(SCOPE).length, 2, "the same key never creates a second payment row");
      store.upsertExpense(SCOPE, expenseRow("key-expense-1", { syncError: "boom" }));
      assert.equal(store.listExpenses(SCOPE).length, 1, "the same key never creates a second expense row");
      // A rewrite keeps the provisional number (the counter only
      // moves on a NEW row).
      const rewritten = store.upsertReturn(SCOPE, { ...salesReturnRow("key-return-1"), syncError: "boom" });
      assert.equal(rewritten.provisionalNumber, "SR-000001", "a rewrite keeps its provisional number");
      store.close();
      // Close + reopen: the next numbers continue, never reused.
      const reopened = createLocalStore(dbPath);
      const thirdSales = reopened.upsertReturn(SCOPE, salesReturnRow("key-return-4"));
      assert.equal(thirdSales.provisionalNumber, "SR-000003", "the number survives a reopen (no reuse)");
      assert.equal(reopened.listReturns(SCOPE).length, 4, "all returns survive the reopen (3 + the new one)");
      assert.equal(reopened.listPayments(SCOPE).length, 2, "both payment rows survive the reopen");
      assert.equal(reopened.listExpenses(SCOPE).length, 1, "the expense survives the reopen");
      reopened.close();
      // Downgrade-and-reopen: a pre-S7 database (tables + issue
      // columns dropped) migrates cleanly.
      const legacyPath = join(dir, "legacy.db");
      const legacy = createLocalStore(legacyPath);
      legacy.close();
      const downgrade = new Database(legacyPath);
      downgrade.exec(
        "DROP TABLE local_returns; DROP TABLE local_payments; DROP TABLE local_expenses; ALTER TABLE sync_issues DROP COLUMN return_id; ALTER TABLE sync_issues DROP COLUMN payment_id; ALTER TABLE sync_issues DROP COLUMN expense_id;",
      );
      downgrade.close();
      const migrated = createLocalStore(legacyPath);
      assert.deepEqual(migrated.listReturns(SCOPE), [], "the migrated database has an empty returns table");
      assert.deepEqual(migrated.listPayments(SCOPE), [], "the migrated database has an empty payments table");
      assert.deepEqual(migrated.listExpenses(SCOPE), [], "the migrated database has an empty expenses table");
      const migratedFirst = migrated.upsertReturn(SCOPE, salesReturnRow("key-legacy-1"));
      assert.equal(migratedFirst.provisionalNumber, "SR-000001", "the migrated store hands out SR-000001 first");
      migrated.close();
      const migratedIssues = new Database(legacyPath).prepare("PRAGMA table_info(sync_issues)").all() as Array<{ name: string }>;
      for (const column of ["return_id", "payment_id", "expense_id"]) {
        assert.ok(
          migratedIssues.some((item) => item.name === column),
          `the migration adds ${column} to sync_issues`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 2. Renderer seam: localStorage backend, desktop backend over a
  //    stubbed bridge, IPC failure falls back to localStorage.
  {
    stubWindow();
    const returnsBackend = getLocalReturnsBackend();
    assert.ok(returnsBackend instanceof LocalStorageLocalReturnsBackend, "no bridge selects the localStorage returns backend");
    const returnRow = newLocalReturnRow("sales", salesReturnInput());
    assert.match(returnRow.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "a new return row gets a client UUID as its request key");
    assert.equal(returnRow.provisionalNumber, null, "the store allocates the provisional number, not the seam");
    await returnsBackend.upsert(SCOPE, returnRow);
    assert.deepEqual(
      (await returnsBackend.list(SCOPE)).map((item) => item.id),
      [returnRow.id],
      "the localStorage backend round-trips a return",
    );
    await returnsBackend.remove(SCOPE, returnRow.id);
    assert.deepEqual(await returnsBackend.list(SCOPE), [], "the localStorage backend removes a return");

    const paymentsBackend = getLocalPaymentsBackend();
    assert.ok(paymentsBackend instanceof LocalStorageLocalPaymentsBackend, "no bridge selects the localStorage payments backend");
    const payRow = newLocalPaymentRow(paymentInput());
    await paymentsBackend.upsert(SCOPE, payRow);
    const voidRow = newLocalVoidRow({ kind: "customer", paymentId: "pay-server-1", reason: null });
    await paymentsBackend.upsert(SCOPE, voidRow);
    assert.deepEqual(
      (await paymentsBackend.list(SCOPE)).map((item) => item.id),
      [payRow.id, voidRow.id],
      "the localStorage backend round-trips a payment and a void",
    );

    const expensesBackend = getLocalExpensesBackend();
    assert.ok(expensesBackend instanceof LocalStorageLocalExpensesBackend, "no bridge selects the localStorage expenses backend");
    const expRow = newLocalExpenseRow(expenseInput());
    await expensesBackend.upsert(SCOPE, expRow);
    assert.deepEqual(
      (await expensesBackend.list(SCOPE)).map((item) => item.id),
      [expRow.id],
      "the localStorage backend round-trips an expense",
    );

    // Desktop backend over a stubbed bridge, then IPC failure falls
    // back to localStorage for the same scope. One shared storage map
    // across the stubs, so the fallback reads what the fallback
    // upsert wrote.
    const sharedStorage = new Map<string, string>();
    const bridgeRows = new Map<string, LocalReturnRow[]>();
    stubWindow({
      localStorage: mapStorage(sharedStorage),
      aankhDesktop: {
        isDesktop: true,
        localReturns: {
          list: async (scope: string) => bridgeRows.get(scope) ?? [],
          upsert: async (_scope: string, row: LocalReturnRow) => {
            bridgeRows.set(_scope, [...(bridgeRows.get(_scope) ?? []).filter((item) => item.id !== row.id), row]);
            return row;
          },
          remove: async (scope: string, id: string) => {
            bridgeRows.set(scope, (bridgeRows.get(scope) ?? []).filter((item) => item.id !== id));
          },
        },
      },
    });
    const desktopBackend = getLocalReturnsBackend();
    assert.ok(desktopBackend instanceof DesktopLocalReturnsBackend, "a bridge selects the desktop returns backend");
    await desktopBackend.upsert(SCOPE, returnRow);
    assert.deepEqual(
      (await desktopBackend.list(SCOPE)).map((item) => item.id),
      [returnRow.id],
      "the desktop backend round-trips a return over IPC",
    );
    // IPC failure: the bridge throws, the upsert falls back to the
    // localStorage copy, and the list reads it back.
    stubWindow({
      localStorage: mapStorage(sharedStorage),
      aankhDesktop: {
        isDesktop: true,
        localReturns: {
          list: async () => {
            throw new Error("ipc down");
          },
          upsert: async () => {
            throw new Error("ipc down");
          },
          remove: async () => {
            throw new Error("ipc down");
          },
        },
      },
    });
    await getLocalReturnsBackend().upsert(SCOPE, returnRow);
    assert.deepEqual(
      (await getLocalReturnsBackend().list(SCOPE)).map((item) => item.id),
      [returnRow.id],
      "an IPC failure falls back to the localStorage copy",
    );
    stubWindow({
      aankhDesktop: {
        isDesktop: true,
        localPayments: {
          list: async () => [],
          upsert: async (_scope: string, row: LocalPaymentRow) => row,
          remove: async () => {},
        },
        localExpenses: {
          list: async () => [],
          upsert: async (_scope: string, row: LocalExpenseRow) => row,
          remove: async () => {},
        },
      },
    });
    assert.ok(getLocalPaymentsBackend() instanceof DesktopLocalPaymentsBackend, "a payments bridge selects the desktop payments backend");
    assert.ok(getLocalExpensesBackend() instanceof DesktopLocalExpensesBackend, "an expenses bridge selects the desktop expenses backend");
  }

  // 3. Merge + derived balance: a pending sales return reduces the
  //    customer's outstanding, a pending payment reduces it too, and
  //    a pending void excludes the payment (the balance is restored).
  //    A synced row with the same request key suppresses its pending
  //    twin — one return / payment never renders twice.
  {
    stubWindow();
    const baseRows: LocalLedgerRows = {
      transactions: [
        {
          id: "tx-sale-1",
          customer_id: CUSTOMER_ID,
          payment_type: "credit",
          status: "confirmed",
          sale_date: "2026-11-17",
          created_at: "2026-11-17T10:00:00.000Z",
          total_amount: 100,
        },
      ],
      invoiceTotals: {},
      payments: [],
      allocations: [],
      returns: [],
      returnItems: [],
      pendingSales: [],
      syncedRequestIds: new Set<string>(),
    };
    const base = deriveOfflineCustomerBalance(CUSTOMER_ID, baseRows);
    assert.equal(base.outstanding, 100, "a 100 credit sale owes 100 before any return or payment");

    // A pending sales return of 2 x 10 merges into the returns and
    // drops the outstanding to 80.
    const pendingReturn = salesReturnRow("key-return-balance-1", { provisionalNumber: "SR-000001" });
    const mergedReturns = mergePendingSalesReturns([], [], [pendingReturn]);
    assert.equal(mergedReturns.returns.length, 1, "the pending return merges into the returns list");
    assert.equal(
      mergedReturns.returns[0].id,
      pendingReturnHistoryId("key-return-balance-1"),
      "the merged return carries the synthetic pending id",
    );
    assert.equal(mergedReturns.items.length, 1, "the merged return carries its line");
    assert.equal(
      mergedReturns.items[0].sales_return_id,
      pendingReturnHistoryId("key-return-balance-1"),
      "the merged item points at the pending return",
    );
    assert.equal(isPendingReturnHistoryId(mergedReturns.returns[0].id), true, "a pending return id is recognised");
    assert.equal(isPendingReturnHistoryId("return-server-1"), false, "a server return id is not pending");
    assert.equal(pendingReturnRequestKey(pendingReturnHistoryId("key-return-balance-1")), "key-return-balance-1", "the pending id unwraps to its request key");
    const withReturn = deriveOfflineCustomerBalance(CUSTOMER_ID, {
      ...baseRows,
      returns: mergedReturns.returns,
      returnItems: mergedReturns.items,
    });
    assert.equal(withReturn.outstanding, 80, "the pending return credits 20 against the outstanding");
    assert.equal(withReturn.returnsCredited, 20, "the returns-credited figure is 20");

    // A pending payment of 40 merges and drops the outstanding to 40.
    const pendingPayment = paymentRow("key-payment-balance-1", { provisionalNumber: "PY-000001" });
    const noServerPayments: Array<{ id: string; request_key?: string | null; voided_at?: string | null }> = [];
    const mergedPayments = mergePendingCustomerPayments(noServerPayments, [pendingPayment]);
    assert.equal(mergedPayments.length, 1, "the pending payment merges into the payments list");
    assert.equal(
      mergedPayments[0].id,
      pendingPaymentHistoryId("key-payment-balance-1"),
      "the merged payment carries the synthetic pending id",
    );
    assert.equal(isPendingPaymentHistoryId(mergedPayments[0].id), true, "a pending payment id is recognised");
    const withPayment = deriveOfflineCustomerBalance(CUSTOMER_ID, {
      ...baseRows,
      returns: mergedReturns.returns,
      returnItems: mergedReturns.items,
      payments: mergedPayments,
      allocations: [{ sales_transaction_id: "tx-sale-1", amount: 40, customer_payment_id: pendingPaymentHistoryId("key-payment-balance-1") }],
    });
    assert.equal(withPayment.outstanding, 40, "the pending payment applies 40 against the outstanding");
    assert.equal(withPayment.paymentsApplied, 40, "the payments-applied figure is 40");

    // A pending void of a SYNCED payment excludes it: the balance is
    // restored to 80 (return only). (A void of an UNSYNCED payment
    // removes its queue row outright — see applyVoidPayment — so the
    // payment never appears in the merged list at all.)
    const serverPayment = {
      id: "pay-server-1",
      request_key: "key-payment-server-1",
      customer_id: CUSTOMER_ID,
      amount: 40,
      voided_at: null as string | null,
    };
    const withServerPayment = deriveOfflineCustomerBalance(CUSTOMER_ID, {
      ...baseRows,
      returns: mergedReturns.returns,
      returnItems: mergedReturns.items,
      payments: [serverPayment],
      allocations: [{ sales_transaction_id: "tx-sale-1", amount: 40, customer_payment_id: "pay-server-1" }],
    });
    assert.equal(withServerPayment.outstanding, 40, "the synced payment applies 40 against the outstanding");
    const serverVoid = newLocalVoidRow({ kind: "customer", paymentId: "pay-server-1", reason: null });
    const voidedPayments = mergePendingCustomerPayments([serverPayment], [serverVoid]);
    const voidedRow = mustBePresent(
      voidedPayments.find((row) => row.id === "pay-server-1"),
      "the voided payment is still in the merged list",
    );
    assert.ok(voidedRow.voided_at, "the pending void marks the synced payment voided at once");
    const withVoid = deriveOfflineCustomerBalance(CUSTOMER_ID, {
      ...baseRows,
      returns: mergedReturns.returns,
      returnItems: mergedReturns.items,
      payments: voidedPayments,
      allocations: [{ sales_transaction_id: "tx-sale-1", amount: 40, customer_payment_id: "pay-server-1" }],
    });
    assert.equal(withVoid.outstanding, 80, "a voided payment covers nothing — the balance is restored");
    assert.equal(withVoid.paymentsApplied, 0, "the voided payment applies 0");
    // A void with no payment left behind (the unsynced case) merges
    // to an empty list — no crash, nothing to show.
    const voidOnly = mergePendingCustomerPayments(
      [],
      [newLocalVoidRow({ kind: "customer", paymentId: pendingPaymentHistoryId("key-payment-balance-1"), reason: null })],
    );
    assert.deepEqual(voidOnly, [], "a lone pending void merges to an empty payments list");

    // Dedupe: a synced return / payment carrying the same request key
    // suppresses its pending twin.
    const syncedReturn = {
      id: "return-server-1",
      request_key: "key-return-balance-1",
      return_number: "SRN-000001",
      customer_id: CUSTOMER_ID,
      status: "confirmed",
    } as unknown as SalesReturn;
    const dedupedReturns = mergePendingSalesReturns([syncedReturn], [], [pendingReturn]);
    assert.deepEqual(
      dedupedReturns.returns.map((row) => row.id),
      ["return-server-1"],
      "the synced return suppresses its pending twin",
    );
    const syncedPayment = {
      id: "pay-server-1",
      request_key: "key-payment-balance-1",
      customer_id: CUSTOMER_ID,
      amount: 40,
      voided_at: null,
    };
    const dedupedPayments = mergePendingCustomerPayments([syncedPayment], [pendingPayment]);
    assert.deepEqual(
      dedupedPayments.map((row) => row.id),
      ["pay-server-1"],
      "the synced payment suppresses its pending twin",
    );

    // Purchase returns merge the same way (supplier side).
    const pendingPurchaseReturn = {
      ...salesReturnRow("key-purchase-return-1"),
      kind: "purchase" as const,
      input: purchaseReturnInput(),
      provisionalNumber: "PR-000001",
    };
    const mergedPurchaseReturns = mergePendingPurchaseReturns([], [], [pendingPurchaseReturn]);
    assert.equal(mergedPurchaseReturns.returns.length, 1, "the pending purchase return merges");
    assert.equal(
      (mergedPurchaseReturns.returns[0] as unknown as PurchaseReturn).return_number,
      "PR-000001",
      "the merged purchase return keeps its provisional number",
    );

    // Expenses merge: a pending expense shows in the list once, and a
    // synced row with the same key suppresses it.
    const pendingExpense = expenseRow("key-expense-balance-1", { provisionalNumber: "EX-000001" });
    const mergedExpenses = mergePendingExpenses([], [pendingExpense]);
    assert.equal(mergedExpenses.length, 1, "the pending expense merges into the expenses list");
    assert.equal(
      mergedExpenses[0].id,
      pendingExpenseHistoryId("key-expense-balance-1"),
      "the merged expense carries the synthetic pending id",
    );
    assert.equal(isPendingExpenseHistoryId(mergedExpenses[0].id), true, "a pending expense id is recognised");
    const syncedExpense = { id: "exp-server-1", request_key: "key-expense-balance-1" };
    assert.deepEqual(
      mergePendingExpenses([syncedExpense], [pendingExpense]).map((row) => row.id),
      ["exp-server-1"],
      "the synced expense suppresses its pending twin",
    );
    assert.deepEqual(
      mergePendingSupplierPayments([], [paymentRow("key-supplier-pay-1", { input: paymentInput({ kind: "supplier", partyId: SUPPLIER_ID, allocations: [] }) })]).length,
      1,
      "a pending supplier payment merges",
    );
  }

  // 4. Return sync: status-check-first, one POST per unknown key,
  //    fingerprint parks without submitting, network failure stays
  //    queued. The supabase client is stubbed at the rpc seam only —
  //    the return never calls it, only the cloud route.
  const dummySupabase = {} as unknown as SupabaseClient;
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  {
    // 4a. Status-check-first: the server already holds the key → the
    //     row confirms with NO POST, and the mirror lands.
    stubDesktopWindowWithMirror();
    const backend = getLocalReturnsBackend();
    await backend.upsert(SCOPE, salesReturnRow("key-return-sync-1", { provisionalNumber: "SR-000123" }));
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverReturn = {
      id: "return-server-1",
      return_number: "SRN-000123",
      customer_id: CUSTOMER_ID,
      sales_transaction_id: "tx-sale-1",
      return_date: "2026-11-17",
      reason: "damaged",
      status: "confirmed",
      request_key: "key-return-sync-1",
      created_at: "2026-11-17T10:00:00.000Z",
    };
    const server: ReturnServer = {
      checkStatus: async () => ({
        status: "confirmed",
        return: serverReturn,
        items: [{ id: "item-server-1", sales_return_id: "return-server-1", product_id: 1, quantity: 2, unit_price: 10, discount: 0 }],
      }),
    };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      fetchCalls.push({ url, body });
      return jsonResponse(200, { ok: true, returnId: "return-server-1", returnNumber: "SRN-000123" });
    };
    const drained = await drainPendingReturns(dummySupabase, SCOPE, { server, fetchImpl });
    assert.deepEqual(
      drained,
      { confirmedCount: 1, parkedCount: 0, queuedCount: 0, stoppedEarly: false, confirmed: [{ localId: "key-return-sync-1", serverId: "return-server-1", returnNumber: "SRN-000123", kind: "sales" }] },
      "a status-confirmed return confirms",
    );
    assert.equal(fetchCalls.length, 0, "the confirmed status posts nothing — the drain never blind re-posts");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const mirror = await loadHistoryMirror<SalesReturn>("sales_return", SCOPE);
    assert.equal(mirror.rows.length, 1, "the confirmed return lands in the history mirror");
    assert.equal(mirror.rows[0].return_number, "SRN-000123", "the mirror carries the server return number");
  }
  {
    // 4b. Unknown status → one POST to the cloud route carrying the
    //     same request key → the row confirms. A replay of the same
    //     key (a second drain) finds nothing to post.
    stubDesktopWindowWithMirror();
    const backend = getLocalReturnsBackend();
    await backend.upsert(SCOPE, salesReturnRow("key-return-sync-2", { provisionalNumber: "SR-000124" }));
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const server: ReturnServer = { checkStatus: async () => ({ status: "unknown" }) };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      fetchCalls.push({ url, body });
      return jsonResponse(200, { ok: true, returnId: "return-server-2", returnNumber: "SRN-000124" });
    };
    const drained = await drainPendingReturns(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(drained.confirmedCount, 1, "the posted return confirms");
    assert.equal(fetchCalls.length, 1, "exactly one POST for one unknown key");
    assert.equal(fetchCalls[0].url, "/api/sales/returns", "the return posts to the cloud route, not an RPC");
    assert.equal(fetchCalls[0].body.requestKey, "key-return-sync-2", "the POST carries the client request key");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const replayed = await drainPendingReturns(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(replayed.confirmedCount, 0, "a second drain finds nothing to post");
    assert.equal(fetchCalls.length, 1, "the replay posts nothing — no duplicate");
  }
  {
    // 4c. Same key, different payload → the route refuses with the
    //     fingerprint message → the row parks in Sync Issues, never
    //     auto-retried, never deleted. Retry is refused without
    //     submitting.
    stubDesktopWindowWithMirror();
    const backend = getLocalReturnsBackend();
    await backend.upsert(SCOPE, salesReturnRow("key-return-sync-3"));
    const server: ReturnServer = { checkStatus: async () => ({ status: "unknown" }) };
    const fingerprint = async () => jsonResponse(400, { ok: false, error: "Request key was already used for a different return" });
    const parked = await drainPendingReturns(dummySupabase, SCOPE, { server, fetchImpl: fingerprint });
    assert.deepEqual(
      { confirmedCount: parked.confirmedCount, parkedCount: parked.parkedCount, queuedCount: parked.queuedCount },
      { confirmedCount: 0, parkedCount: 1, queuedCount: 0 },
      "the fingerprint mismatch parks the return",
    );
    const issues = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(issues.length, 1, "one sync issue is parked");
    assert.equal(issues[0].kind, "fingerprint-mismatch", "the parked issue is a fingerprint mismatch");
    assert.equal(issues[0].returnId, "key-return-sync-3", "the parked issue carries the return key");
    const countingFetch = async () => {
      throw new Error("must not submit a fingerprint mismatch");
    };
    const refused = await retryReturnSyncIssue(dummySupabase, SCOPE, issues[0].id, { server, fetchImpl: countingFetch });
    assert.deepEqual(refused, { confirmed: false, notRetryable: true, reason: null }, "retry of a fingerprint mismatch is refused without submitting");
    assert.deepEqual((await getSyncIssuesBackend().list(SCOPE)).length, 1, "the refused issue stays open");
  }
  {
    // 4d. A network failure stops the loop: the row stays queued.
    stubDesktopWindowWithMirror();
    const backend = getLocalReturnsBackend();
    await backend.upsert(SCOPE, salesReturnRow("key-return-sync-4"));
    const server: ReturnServer = { checkStatus: async () => ({ status: "unknown" }) };
    const networkDown = async () => {
      throw new Error("Failed to fetch");
    };
    const queued = await drainPendingReturns(dummySupabase, SCOPE, { server, fetchImpl: networkDown });
    assert.equal(queued.stoppedEarly, true, "the network failure stops the loop early");
    assert.equal(queued.queuedCount, 1, "the row stays queued");
    assert.deepEqual((await backend.list(SCOPE)).map((row) => row.id), ["key-return-sync-4"], "the queued row is still on the device");
  }

  // 5. Payment sync: status-check-first through the existing
  //    phase-14/15 RPCs, submit success confirms, an uncertain error
  //    stays queued. A void of a synced payment drains through
  //    void_payment_atomic; a void of an unsynced payment never
  //    becomes a row (the payment simply leaves the queue — see the
  //    page.tsx void handler; the sync side is covered by the void
  //    drain below).
  {
    // 5a. Status-confirmed → no submit, row removed, mirror lands.
    stubDesktopWindowWithMirror();
    const backend = getLocalPaymentsBackend();
    await backend.upsert(SCOPE, paymentRow("key-payment-sync-1", { provisionalNumber: "PY-000123" }));
    const submits: Array<{ input: Record<string, unknown>; key: string }> = [];
    const server: PaymentServer = {
      checkStatus: async () => ({ status: "confirmed", result: { payment_id: "pay-server-1" } as never }),
      submit: async (input, key) => {
        submits.push({ input: input as unknown as Record<string, unknown>, key });
        return { payment_id: "pay-server-1" } as never;
      },
      submitVoid: async () => {
        throw new Error("must not void a payment");
      },
    };
    const drained = await drainPendingPayments(dummySupabase, SCOPE, { server });
    assert.equal(drained.confirmedCount, 1, "a status-confirmed payment confirms");
    assert.equal(submits.length, 0, "the confirmed status submits nothing");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const mirror = await loadHistoryMirror<Record<string, unknown>>("customer_payment", SCOPE);
    assert.equal(mirror.rows.length, 1, "the confirmed payment lands in the history mirror");
    assert.equal(mirror.rows[0].id, "pay-server-1", "the mirror carries the server payment id");
  }
  {
    // 5b. Unknown status → one submit with the same key → confirms.
    //     A second drain finds nothing to submit.
    stubDesktopWindowWithMirror();
    const backend = getLocalPaymentsBackend();
    await backend.upsert(SCOPE, paymentRow("key-payment-sync-2", { provisionalNumber: "PY-000124" }));
    const submits: string[] = [];
    const server: PaymentServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async (_input, key) => {
        submits.push(key);
        return { payment_id: "pay-server-2" } as never;
      },
      submitVoid: async () => {
        throw new Error("must not void a payment");
      },
    };
    const drained = await drainPendingPayments(dummySupabase, SCOPE, { server });
    assert.equal(drained.confirmedCount, 1, "the submitted payment confirms");
    assert.deepEqual(submits, ["key-payment-sync-2"], "exactly one submit with the client key");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const replayed = await drainPendingPayments(dummySupabase, SCOPE, { server });
    assert.equal(replayed.confirmedCount, 0, "a second drain finds nothing to submit");
    assert.deepEqual(submits, ["key-payment-sync-2"], "the replay submits nothing — no duplicate");
  }
  {
    // 5c. An uncertain submit error leaves the row queued.
    stubDesktopWindowWithMirror();
    const backend = getLocalPaymentsBackend();
    await backend.upsert(SCOPE, paymentRow("key-payment-sync-3"));
    const server: PaymentServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async () => {
        throw new Error("Failed to fetch");
      },
      submitVoid: async () => {
        throw new Error("must not void a payment");
      },
    };
    const queued = await drainPendingPayments(dummySupabase, SCOPE, { server });
    assert.equal(queued.stoppedEarly, true, "the uncertain error stops the loop early");
    assert.deepEqual((await backend.list(SCOPE)).map((row) => row.id), ["key-payment-sync-3"], "the row stays queued");
  }
  {
    // 5d. A void row drains through void_payment_atomic; an
    //     already-voided payment counts as synced (the desired end
    //     state, not an error).
    stubDesktopWindowWithMirror();
    const backend = getLocalPaymentsBackend();
    const voidRow = newLocalVoidRow({ kind: "customer", paymentId: "pay-server-9", reason: null });
    voidRow.id = "key-void-sync-1";
    await backend.upsert(SCOPE, voidRow);
    const voids: string[] = [];
    const server: PaymentServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async () => {
        throw new Error("must not submit a void");
      },
      submitVoid: async (_input, key) => {
        voids.push(key);
        return { payment_id: "pay-server-9", voided: true } as never;
      },
    };
    const drained = await drainPendingPayments(dummySupabase, SCOPE, { server });
    assert.equal(drained.confirmedCount, 1, "the void confirms");
    assert.deepEqual(voids, ["key-void-sync-1"], "the void submits with the row's own key");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed void row is removed");
  }
  {
    // 5e. A definitive rejection parks the payment; the owner Retry
    //     re-submits it with the ORIGINAL key and it confirms exactly
    //     once — the issue resolves.
    stubDesktopWindowWithMirror();
    const backend = getLocalPaymentsBackend();
    await backend.upsert(SCOPE, paymentRow("key-payment-sync-4"));
    let submits = 0;
    const rejectingServer: PaymentServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async () => {
        submits += 1;
        throw new Error("Customer not found");
      },
      submitVoid: async () => {
        throw new Error("must not void a payment");
      },
    };
    const parked = await drainPendingPayments(dummySupabase, SCOPE, { server: rejectingServer });
    assert.equal(parked.parkedCount, 1, "the rejected payment parks");
    const issues = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(issues.length, 1, "one sync issue is parked");
    assert.equal(issues[0].kind, "rejected", "the parked issue is a rejection");
    assert.equal(issues[0].paymentId, "key-payment-sync-4", "the parked issue carries the payment key");
    const fixedServer: PaymentServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async (_input, key) => {
        submits += 1;
        assert.equal(key, "key-payment-sync-4", "the retry re-submits with the original key");
        return { payment_id: "pay-server-4" } as never;
      },
      submitVoid: async () => {
        throw new Error("must not void a payment");
      },
    };
    const retried = await retryPaymentSyncIssue(dummySupabase, SCOPE, issues[0].id, { server: fixedServer });
    assert.deepEqual(retried, { confirmed: true, notRetryable: false, reason: null }, "the retry confirms");
    assert.equal(submits, 2, "exactly two submits: the rejected one and the retry — no duplicate");
    assert.deepEqual(await backend.list(SCOPE), [], "the retried row is removed");
    const after = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(after.filter((issue) => issue.status === "open").length, 0, "the issue resolves on confirm");
  }

  // 6. Expense sync: submit success confirms, a same-key replay
  //    (the fake server already holds the key) returns the existing
  //    id without a second insert, a fingerprint mismatch parks.
  {
    // 6a. Submit success → row removed, mirror lands.
    stubDesktopWindowWithMirror();
    const backend = getLocalExpensesBackend();
    await backend.upsert(SCOPE, expenseRow("key-expense-sync-1", { provisionalNumber: "EX-000123" }));
    const submits: string[] = [];
    const server: ExpenseServer = {
      checkStatus: async () => ({ status: "unknown" }),
      submit: async (_input, key) => {
        submits.push(key);
        return { expenseId: "exp-server-1" };
      },
      markPurchaseExpenseReviewed: async () => {},
    };
    const drained = await drainPendingExpenses(dummySupabase, SCOPE, { server });
    assert.equal(drained.confirmedCount, 1, "the submitted expense confirms");
    assert.deepEqual(submits, ["key-expense-sync-1"], "exactly one submit with the client key");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const mirror = await loadHistoryMirror<Record<string, unknown>>("expense", SCOPE);
    assert.equal(mirror.rows.length, 1, "the confirmed expense lands in the history mirror");
    assert.equal(mirror.rows[0].id, "exp-server-1", "the mirror carries the server expense id");
  }
  {
    // 6b. The server already holds the key with the same contents
    //     (a lost response) → the status check confirms it, the
    //     submit never runs, no second insert, no duplicate.
    stubDesktopWindowWithMirror();
    const backend = getLocalExpensesBackend();
    await backend.upsert(SCOPE, expenseRow("key-expense-sync-2"));
    let submits = 0;
    const server: ExpenseServer = {
      checkStatus: async () => ({
        status: "confirmed",
        expense: { id: "exp-server-2", expense_type: "Transport", amount: 15, notes: null, expense_date: "2026-11-17", supplier_id: null, customer_id: null, purchase_transaction_id: null, sales_transaction_id: null },
      }),
      submit: async () => {
        submits += 1;
        return { expenseId: "exp-server-2" };
      },
      markPurchaseExpenseReviewed: async () => {},
    };
    const drained = await drainPendingExpenses(dummySupabase, SCOPE, { server });
    assert.equal(drained.confirmedCount, 1, "the status-confirmed expense confirms");
    assert.equal(submits, 0, "the replay submits nothing — no second insert");
    assert.deepEqual(await backend.list(SCOPE), [], "the replayed row is removed");
    const replayed = await drainPendingExpenses(dummySupabase, SCOPE, { server });
    assert.equal(replayed.confirmedCount, 0, "a second drain finds nothing to submit");
  }
  {
    // 6c. Status-confirmed with different contents → fingerprint
    //     mismatch, parked, retry refused without submitting.
    stubDesktopWindowWithMirror();
    const backend = getLocalExpensesBackend();
    await backend.upsert(SCOPE, expenseRow("key-expense-sync-3"));
    const server: ExpenseServer = {
      checkStatus: async () => ({
        status: "confirmed",
        expense: { id: "exp-server-3", expense_type: "Fuel", amount: 99, notes: null, expense_date: "2026-11-17", supplier_id: null, customer_id: null, purchase_transaction_id: null, sales_transaction_id: null },
      }),
      submit: async () => {
        throw new Error("must not submit a fingerprint mismatch");
      },
      markPurchaseExpenseReviewed: async () => {},
    };
    const parked = await drainPendingExpenses(dummySupabase, SCOPE, { server });
    assert.equal(parked.parkedCount, 1, "the fingerprint mismatch parks the expense");
    const issues = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(issues.length, 1, "one sync issue is parked");
    assert.equal(issues[0].kind, "fingerprint-mismatch", "the parked issue is a fingerprint mismatch");
    assert.equal(issues[0].expenseId, "key-expense-sync-3", "the parked issue carries the expense key");
    const refused = await retryExpenseSyncIssue(dummySupabase, SCOPE, issues[0].id, { server });
    assert.deepEqual(refused, { confirmed: false, notRetryable: true, reason: null }, "retry of a fingerprint mismatch is refused without submitting");
  }

  // 7. Safety: no S7 sync path calls a returns/expenses RPC with a
  //    service-role key, and no S7 code writes a stored balance.
  //    Payments drain through the existing phase-14/15 RPCs with the
  //    user's JWT (submitPaymentAtomic / voidPaymentAtomic); returns
  //    drain through the cloud routes with the user JWT
  //    (authorizedFetch); expenses insert with the user's JWT.
  {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    for (const path of [
      "src/lib/offline/return-sync.ts",
      "src/lib/offline/payment-sync.ts",
      "src/lib/offline/expense-sync.ts",
      "src/lib/offline/local-returns.ts",
      "src/lib/offline/local-payments.ts",
      "src/lib/offline/local-expenses.ts",
      "src/app/api/sales/returns/route.ts",
      "src/app/api/purchases/returns/route.ts",
    ]) {
      const text = read(path);
      assert.ok(!text.includes("createSupabaseService"), `${path} never touches the service-role client`);
      assert.ok(!text.includes("SUPABASE_SERVICE_ROLE_KEY"), `${path} never reads the service-role key`);
      assert.ok(!text.includes("outstanding_balance"), `${path} never writes a stored balance`);
    }
    assert.ok(read("src/lib/offline/payment-sync.ts").includes("submitPaymentAtomic"), "payment sync uses the existing atomic RPC");
    assert.ok(read("src/lib/offline/return-sync.ts").includes("authorizedFetch"), "return sync posts through the cloud route with the user JWT");
    assert.ok(read("src/app/api/sales/returns/route.ts").includes("createSupabaseUserClient"), "the sales returns route uses the user client");
    assert.ok(read("src/app/api/purchases/returns/route.ts").includes("createSupabaseUserClient"), "the purchase returns route uses the user client");
    assert.ok(read("src/lib/migrations/returns_expenses_idempotency.sql").includes("get_sales_return_request_status"), "the new SQL adds the sales-return status function");
    assert.ok(read("src/lib/migrations/returns_expenses_idempotency.sql").includes("get_expense_request_status"), "the new SQL adds the expense status function");
  }

  console.log("test-returns-payments-expenses-offline: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
