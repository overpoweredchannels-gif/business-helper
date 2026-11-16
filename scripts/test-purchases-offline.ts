import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { createLocalStore, type LocalPurchaseRow, type LocalSupplierRow } from "../electron/store";
import {
  DesktopLocalPurchasesBackend,
  LocalStorageLocalPurchasesBackend,
  getLocalPurchasesBackend,
  newLocalPurchaseRow,
} from "../src/lib/offline/local-purchases";
import {
  DesktopLocalSuppliersBackend,
  LocalStorageLocalSuppliersBackend,
  editLocalSupplierRow,
  getLocalSuppliersBackend,
  mergeLocalSuppliers,
  newLocalSupplierCreateRow,
} from "../src/lib/offline/local-suppliers";
import {
  isPendingPurchaseHistoryId,
  mergePendingPurchases,
  pendingPurchaseToItems,
  pendingPurchaseToTransaction,
} from "../src/lib/purchases/pending-purchase-history";
import {
  drainPendingPurchases,
  retryPurchaseSyncIssue,
} from "../src/lib/offline/purchase-sync";
import {
  drainPendingSuppliers,
  retrySupplierSyncIssue,
  type SupplierServer,
} from "../src/lib/offline/supplier-sync";
import { loadHistoryMirror } from "../src/lib/offline/history-mirror";
import { getSyncIssuesBackend, openSyncIssues } from "../src/lib/offline/sync-issues";
import { isValidSupplierClientId } from "../src/app/api/suppliers/route";
import type { PurchaseTransaction, Supplier } from "../src/lib/tradeos/types";

// Slice S6 — purchases + suppliers offline.
// The SQLite store holds offline-created purchases (full input + a
// client idempotency key + a provisional LP-number) and offline
// suppliers (client-generated UUID as the id, profile
// last-write-wins, balance NEVER written); the renderer seams mirror
// the local-sales / local-customers patterns (SQLite on desktop,
// localStorage fallback); the purchase sync drains through the cloud
// POST /api/purchases route (user JWT, never service-role from the
// client), status-check-first via get_purchase_request_status; the
// supplier sync drains through the supplier routes with the same
// client-id replay safety as S5's customers.

const SCOPE = "org-1:profile-1";

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

/**
 * In-memory mirror bridge: the history mirror is desktop-only
 * (`getHistoryMirrorBackend` returns null without the bridge), so the
 * sync section installs a bridge-backed desktop window. The local
 * purchase/supplier seams still fall back to localStorage — the
 * window carries no localPurchases / localSuppliers bridge.
 */
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

function purchaseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplier_id: "00000000-0000-4000-8000-000000000010",
    supplier_invoice_number: null,
    purchase_date: "2026-11-17",
    payment_type: "cash",
    lines: [
      {
        product_id: "1",
        quantity: 2,
        purchase_price: 10,
        selling_price: 12,
        unit_mode: "main",
        batch_number: null,
        expiry_date: null,
      },
      {
        product_id: "2",
        quantity: 1,
        purchase_price: 5,
        selling_price: 8,
        unit_mode: "main",
        batch_number: null,
        expiry_date: null,
      },
    ],
    ...overrides,
  };
}

function purchaseRow(id: string, overrides: Partial<LocalPurchaseRow> = {}): LocalPurchaseRow {
  return {
    id,
    input: purchaseInput(),
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: "2026-11-17T02:00:00.000Z",
    updatedAt: "2026-11-17T02:00:00.000Z",
    ...overrides,
  };
}

function supplierData(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    supplier_name: name,
    contact_person: "Ayesha",
    phone: "03001234567",
    whatsapp: null,
    city: "Lahore",
    area: "Gulberg",
    notes: null,
    credit_limit: 50000,
    credit_days: 30,
    credit_policy: "unrestricted",
    preferred_payment_method: "cash",
    allow_over_limit: false,
    allow_overdue_sales: false,
    is_active: true,
    ...overrides,
  };
}

function supplierRow(id: string, data: Record<string, unknown>, createdAt = "2026-11-17T02:00:00.000Z"): LocalSupplierRow {
  return {
    id,
    kind: "create",
    data,
    idempotencyKey: `key-${id}`,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt,
    updatedAt: createdAt,
  };
}

async function main(): Promise<void> {
  // 1. SQLite store on a temp file: purchase round-trip with the
  //    provisional LP-number, supplier round-trip with edit-of-create
  //    staying a create, close + reopen, migration.
  const dir = mkdtempSync(join(tmpdir(), "aankh-s6-test-"));
  try {
    const dbPath = join(dir, "aankh.db");
    const store = createLocalStore(dbPath);
    assert.deepEqual(store.listPurchases(SCOPE), [], "empty purchases read empty");
    assert.deepEqual(store.listSuppliers(SCOPE), [], "empty suppliers read empty");

    // The first purchase takes LP-000001; a second takes LP-000002.
    const first = store.upsertPurchase(SCOPE, purchaseRow("key-purchase-1"));
    assert.equal(first.provisionalNumber, "LP-000001", "the first purchase takes LP-000001");
    assert.equal(first.id, "key-purchase-1", "the client request key is the row id");
    const second = store.upsertPurchase(SCOPE, purchaseRow("key-purchase-2"));
    assert.equal(second.provisionalNumber, "LP-000002", "the second purchase takes LP-000002");
    assert.notEqual(
      first.provisionalNumber,
      second.provisionalNumber,
      "a purchase never takes a sale's number or another purchase's",
    );

    // A rewrite preserves the provisional number and the first-created
    // time — the number is handed out once, never re-issued.
    const rewritten = store.upsertPurchase(SCOPE, {
      ...first,
      input: purchaseInput({ supplier_invoice_number: "SUP-9" }),
      updatedAt: "2026-11-17T03:00:00.000Z",
    });
    assert.equal(rewritten.provisionalNumber, "LP-000001", "a rewrite keeps its provisional number");
    assert.equal(rewritten.createdAt, first.createdAt, "a rewrite keeps its first-created time");
    assert.deepEqual(
      store.listPurchases(SCOPE).map((item) => item.provisionalNumber),
      ["LP-000001", "LP-000002"],
      "the purchases list back in creation order",
    );

    // Re-upserting the same request key rewrites in place — the row
    // id IS the idempotency key, so the same purchase can never land
    // twice.
    store.upsertPurchase(SCOPE, purchaseRow("key-purchase-1"));
    assert.equal(store.listPurchases(SCOPE).length, 2, "re-upserting the same key rewrites, never duplicates");

    // Two different keys can never share a provisional number.
    assert.throws(
      () => store.upsertPurchase(SCOPE, purchaseRow("key-purchase-9", { provisionalNumber: "LP-000001" })),
      /UNIQUE constraint failed/,
      "a provisional number is never shared by two purchases",
    );
    assert.equal(store.listPurchases(SCOPE).length, 2, "the refused row did not land");

    store.removePurchase(SCOPE, "key-purchase-2");
    assert.deepEqual(
      store.listPurchases(SCOPE).map((item) => item.id),
      ["key-purchase-1"],
      "remove drops one purchase",
    );

    // Suppliers: a create round-trips with its client UUID; an edit
    // of an unsynced create stays a create (last-write-wins).
    const supplier = supplierRow("00000000-0000-4000-8000-000000000001", supplierData("Offline Supplier"));
    const storedSupplier = store.upsertSupplier(SCOPE, supplier);
    assert.equal(storedSupplier.id, supplier.id, "the client UUID is the row id");
    assert.equal(storedSupplier.kind, "create", "an offline-created supplier is a create");
    const editedSupplier = editLocalSupplierRow(
      storedSupplier,
      storedSupplier.id,
      supplierData("Offline Supplier Renamed", { phone: "03009998888" }),
    );
    assert.equal(editedSupplier.kind, "create", "an edit of a create stays a create");
    assert.equal(editedSupplier.idempotencyKey, storedSupplier.idempotencyKey, "the key survives an edit");
    assert.equal(editedSupplier.data.supplier_name, "Offline Supplier Renamed", "the newest edit wins");
    assert.equal(editedSupplier.data.phone, "03009998888", "the newest edit wins on every field");
    const storedEdited = store.upsertSupplier(SCOPE, editedSupplier);
    assert.equal(storedEdited.data.supplier_name, "Offline Supplier Renamed", "the edit persists");

    // A duplicate idempotency key is refused, never a second row.
    assert.throws(
      () =>
        store.upsertSupplier(SCOPE, {
          ...supplierRow("00000000-0000-4000-8000-000000000003", supplierData("Duplicate Key")),
          idempotencyKey: "key-00000000-0000-4000-8000-000000000001",
        }),
      /UNIQUE constraint failed/,
      "a duplicate idempotency key is refused",
    );
    assert.equal(store.listSuppliers(SCOPE).length, 1, "the refused row did not land");
    const edited2 = editLocalSupplierRow(
      storedEdited,
      storedEdited.id,
      supplierData("Offline Supplier Final", { phone: null }),
    );
    assert.equal(edited2.data.phone, null, "the second edit's null wins over the first edit's phone");
    store.upsertSupplier(SCOPE, edited2);

    // An edit of a server row is kind "edit" with the server id.
    const serverRow: LocalSupplierRow = {
      ...supplierRow("00000000-0000-4000-8000-000000000002", supplierData("Server Supplier")),
      kind: "edit",
      serverId: "00000000-0000-4000-8000-000000000002",
    };
    store.upsertSupplier(SCOPE, serverRow);
    const serverEdited = editLocalSupplierRow(serverRow, serverRow.id, supplierData("Server Supplier Renamed"));
    assert.equal(serverEdited.kind, "edit", "an edit of a server row stays an edit");
    assert.equal(serverEdited.serverId, serverRow.serverId, "the server id survives an edit");
    store.upsertSupplier(SCOPE, serverEdited);

    // Close + reopen: rows survive, and the next purchase takes
    // LP-000003 — a number is never reused after a restart.
    store.close();
    const reopened = createLocalStore(dbPath);
    assert.deepEqual(
      reopened.listPurchases(SCOPE).map((item) => [item.id, item.provisionalNumber]),
      [["key-purchase-1", "LP-000001"]],
      "purchases survive close + reopen",
    );
    const third = reopened.upsertPurchase(SCOPE, purchaseRow("key-purchase-3"));
    assert.equal(third.provisionalNumber, "LP-000003", "the next purchase after reopen takes LP-000003");
    assert.deepEqual(
      reopened.listSuppliers(SCOPE).map((item) => [item.id, item.data.supplier_name]),
      [
        ["00000000-0000-4000-8000-000000000001", "Offline Supplier Final"],
        ["00000000-0000-4000-8000-000000000002", "Server Supplier Renamed"],
      ],
      "suppliers survive close + reopen",
    );

    // Migration: a pre-S6 database (no local_purchases /
    // local_suppliers tables, no supplier_id / purchase_id on
    // sync_issues) gains all four on open.
    const legacyPath = join(dir, "legacy.db");
    const legacyStore = createLocalStore(legacyPath);
    legacyStore.close();
    const downgrade = new Database(legacyPath);
    downgrade.exec(
      "DROP TABLE local_purchases; DROP TABLE local_suppliers; ALTER TABLE sync_issues DROP COLUMN supplier_id; ALTER TABLE sync_issues DROP COLUMN purchase_id;",
    );
    downgrade.close();
    const migrated = createLocalStore(legacyPath);
    assert.deepEqual(migrated.listPurchases(SCOPE), [], "the migrated database has an empty purchases table");
    assert.deepEqual(migrated.listSuppliers(SCOPE), [], "the migrated database has an empty suppliers table");
    const migratedFirst = migrated.upsertPurchase(SCOPE, purchaseRow("key-legacy-1"));
    assert.equal(migratedFirst.provisionalNumber, "LP-000001", "the migrated store hands out LP-000001 first");
    migrated.close();
    const migratedIssues = new Database(legacyPath).prepare("PRAGMA table_info(sync_issues)").all() as Array<{ name: string }>;
    assert.ok(
      migratedIssues.some((column) => column.name === "supplier_id"),
      "the migration adds supplier_id to sync_issues",
    );
    assert.ok(
      migratedIssues.some((column) => column.name === "purchase_id"),
      "the migration adds purchase_id to sync_issues",
    );
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 2. Renderer seam: localStorage backend, desktop backend over a
  //    stubbed bridge, IPC failure falls back to localStorage, and the
  //    list merge (local wins per id, creates appended, sorted).
  {
    stubWindow();
    const backend = getLocalPurchasesBackend();
    assert.ok(backend instanceof LocalStorageLocalPurchasesBackend, "no bridge selects the localStorage backend");
    const row = newLocalPurchaseRow(purchaseInput());
    assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "a new purchase row gets a client UUID as its request key");
    assert.equal(row.provisionalNumber, null, "the store allocates the provisional number, not the seam");
    await backend.upsert(SCOPE, row);
    assert.deepEqual(
      (await backend.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the localStorage backend round-trips a purchase",
    );
    assert.equal(
      (await backend.list(SCOPE))[0].provisionalNumber,
      null,
      "the fallback keeps a null provisional number (the history shows the Pending label instead)",
    );
    await backend.remove(SCOPE, row.id);
    assert.deepEqual(await backend.list(SCOPE), [], "the localStorage backend removes a purchase");
  }
  {
    const values = new Map<string, string>();
    const ipcRows = new Map<string, LocalPurchaseRow[]>();
    const bridge = {
      list: async (scope: string) => ipcRows.get(scope) ?? [],
      upsert: async (scope: string, row: LocalPurchaseRow) => {
        ipcRows.set(scope, [...(ipcRows.get(scope) ?? []).filter((item) => item.id !== row.id), row]);
        return row;
      },
      remove: async (scope: string, id: string) => {
        ipcRows.set(scope, (ipcRows.get(scope) ?? []).filter((item) => item.id !== id));
      },
    };
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: { isDesktop: true, localPurchases: bridge },
    });
    const backend = getLocalPurchasesBackend();
    assert.ok(backend instanceof DesktopLocalPurchasesBackend, "the bridge present selects the desktop backend");
    const row = newLocalPurchaseRow(purchaseInput());
    await backend.upsert(SCOPE, row);
    assert.deepEqual(
      (await backend.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the desktop backend lists from the bridge",
    );
    await backend.remove(SCOPE, row.id);
    assert.deepEqual(await backend.list(SCOPE), [], "the desktop backend removes through the bridge");

    // An IPC failure falls back to localStorage instead of losing the purchase.
    const failingBridge = {
      list: async () => {
        throw new Error("IPC down");
      },
      upsert: async () => {
        throw new Error("IPC down");
      },
      remove: async () => {
        throw new Error("IPC down");
      },
    };
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: { isDesktop: true, localPurchases: failingBridge },
    });
    const fallback = getLocalPurchasesBackend();
    const fallbackRow = newLocalPurchaseRow(purchaseInput());
    await fallback.upsert(SCOPE, fallbackRow);
    assert.deepEqual(
      (await fallback.list(SCOPE)).map((item) => item.id),
      [fallbackRow.id],
      "an IPC failure falls back to localStorage",
    );
  }
  {
    stubWindow();
    const backend = getLocalSuppliersBackend();
    assert.ok(backend instanceof LocalStorageLocalSuppliersBackend, "no bridge selects the localStorage backend for suppliers");
    const row = newLocalSupplierCreateRow(supplierData("Seam Supplier"));
    assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "a create row gets a client UUID");
    await backend.upsert(SCOPE, row);
    assert.deepEqual(
      (await backend.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the localStorage backend round-trips a supplier",
    );
    await backend.remove(SCOPE, row.id);
    assert.deepEqual(await backend.list(SCOPE), [], "the localStorage backend removes a supplier");
    const values = new Map<string, string>();
    const ipcRows = new Map<string, LocalSupplierRow[]>();
    const bridge = {
      list: async (scope: string) => ipcRows.get(scope) ?? [],
      upsert: async (scope: string, row: LocalSupplierRow) => {
        ipcRows.set(scope, [...(ipcRows.get(scope) ?? []).filter((item) => item.id !== row.id), row]);
        return row;
      },
      remove: async (scope: string, id: string) => {
        ipcRows.set(scope, (ipcRows.get(scope) ?? []).filter((item) => item.id !== id));
      },
    };
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: { isDesktop: true, localSuppliers: bridge },
    });
    const desktop = getLocalSuppliersBackend();
    assert.ok(desktop instanceof DesktopLocalSuppliersBackend, "the bridge present selects the desktop backend for suppliers");
    await desktop.upsert(SCOPE, row);
    assert.deepEqual(
      (await desktop.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the desktop supplier backend lists from the bridge",
    );
  }
  {
    // Merge: the local row wins per id, creates append, sorted by name.
    // Note the Gamma row's data carries the fixture's default id
    // (...001) while the row id is ...003 — deliberate: the row id is
    // authoritative, so the merged create must still carry ...003.
    const serverSuppliers = [
      { id: "00000000-0000-4000-8000-000000000001", supplier_name: "Alpha", credit_policy: "cash_only" },
      { id: "00000000-0000-4000-8000-000000000002", supplier_name: "Beta", credit_policy: "cash_only" },
    ] as Supplier[];
    const localRows: LocalSupplierRow[] = [
      {
        ...supplierRow("00000000-0000-4000-8000-000000000002", supplierData("Beta Renamed")),
        kind: "edit",
        serverId: "00000000-0000-4000-8000-000000000002",
      },
      supplierRow("00000000-0000-4000-8000-000000000003", supplierData("Gamma")),
    ];
    const merged = mergeLocalSuppliers(serverSuppliers, localRows);
    assert.deepEqual(
      merged.map((supplier) => supplier.supplier_name),
      ["Alpha", "Beta Renamed", "Gamma"],
      "the merge keeps the local edit, appends the create, and sorts by name",
    );
    assert.deepEqual(
      mergeLocalSuppliers(serverSuppliers, []),
      serverSuppliers,
      "no local rows leaves the server list untouched",
    );
    // A merged create carries no balance of its own — the balance
    // stays derived on read, never written from the local row.
    const created = mustBePresent(
      merged.find((supplier) => supplier.id === "00000000-0000-4000-8000-000000000003"),
      "the created supplier merges",
    );
    assert.equal(created.outstanding_balance, undefined, "a merged create carries no stored balance");
  }

  // 3. Pending history: a pending purchase converts to a history row
  //    with its provisional number, merges without duplicating its
  //    confirmed twin, and computes its value from its own lines.
  {
    const serverTransactions: PurchaseTransaction[] = [
      {
        id: "tx-1",
        supplier_id: "00000000-0000-4000-8000-000000000010",
        invoice_number: "P-50001",
        created_at: "2026-11-17T10:00:00.000Z",
        purchase_date: "2026-11-17",
        expense_review_status: "pending",
        expense_reviewed_at: null,
        total_amount: 50,
        request_key: "key-synced-1",
      },
    ];
    const serverItems = [
      {
        id: "item-1",
        purchase_transaction_id: "tx-1",
        product_id: 1,
        quantity: 5,
        purchase_price: 10,
        selling_price: 12,
        unit_mode: "main",
        batch_number: null,
        expiry_date: null,
      },
    ];
    const pendingSyncedTwin = purchaseRow("key-synced-1", { provisionalNumber: "LP-000100" });
    const pendingNew = purchaseRow("key-pending-1", { provisionalNumber: "LP-000123" });
    const converted = pendingPurchaseToTransaction(pendingNew, "Pending");
    assert.ok(converted, "a pending purchase converts to a history row");
    assert.equal(converted?.id, "pending:key-pending-1", "the pending row id is namespaced");
    assert.equal(converted?.invoice_number, "LP-000123", "the pending row shows its provisional number");
    assert.equal(converted?.total_amount, 25, "the pending total is the line sum (2x10 + 1x5)");
    assert.equal(converted?.expense_review_status, "pending", "the pending row is not expense-reviewed");
    assert.equal(
      pendingPurchaseToItems(pendingNew).length,
      2,
      "the pending row converts its lines to history items",
    );
    assert.equal(
      pendingPurchaseToItems(pendingNew)[0].purchase_transaction_id,
      "pending:key-pending-1",
      "the pending items point at the pending row",
    );
    const merged = mergePendingPurchases(serverTransactions, serverItems, [pendingSyncedTwin, pendingNew], "Pending");
    assert.deepEqual(
      merged.transactions.map((tx) => tx.id),
      ["pending:key-pending-1", "tx-1"],
      "the synced twin drops out; the new pending row appends once (pending rows come first — the history's own sort orders the merged list for display)",
    );
    assert.equal(
      merged.items.filter((item) => item.purchase_transaction_id === "pending:key-pending-1").length,
      2,
      "the merged items carry the pending row's lines",
    );
    assert.equal(isPendingPurchaseHistoryId("pending:key-pending-1"), true, "a pending id is recognised");
    assert.equal(isPendingPurchaseHistoryId("tx-1"), false, "a server id is not pending");
    assert.equal(
      pendingPurchaseToTransaction(purchaseRow("key-empty", { input: purchaseInput({ lines: [] }) }), "Pending"),
      null,
      "a purchase without lines converts to nothing",
    );
    assert.equal(
      pendingPurchaseToTransaction(purchaseRow("key-nosupplier", { input: purchaseInput({ supplier_id: null }) }), "Pending"),
      null,
      "a purchase without a supplier converts to nothing",
    );
  }

  // 4. Purchase sync: drain with a stubbed status RPC + stubbed
  //    fetch. The supabase client is stubbed at the rpc seam only —
  //    the create never calls it, only the cloud route.
  const dummySupabase = {} as unknown as SupabaseClient;
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  {
    // 4a. Status-check-first: the server already holds the key → the
    //     row confirms with NO POST, and the mirror lands.
    stubDesktopWindowWithMirror();
    const backend = getLocalPurchasesBackend();
    const row = purchaseRow("key-purchase-sync-1", { provisionalNumber: "LP-000123" });
    await backend.upsert(SCOPE, row);
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverTx = {
      id: "tx-server-1",
      supplier_id: "00000000-0000-4000-8000-000000000010",
      invoice_number: "P-50099",
      created_at: "2026-11-17T10:00:00.000Z",
      purchase_date: "2026-11-17",
      expense_review_status: "pending",
      expense_reviewed_at: null,
      total_amount: 25,
      request_key: "key-purchase-sync-1",
    };
    const supabase = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: { status: "confirmed", result: { transaction: serverTx, items: [{ id: "item-server-1", purchase_transaction_id: "tx-server-1", product_id: 1, quantity: 2, purchase_price: 10, selling_price: 12, unit_mode: "main", batch_number: null, expiry_date: null }] } }, error: null };
      },
    } as unknown as SupabaseClient;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      fetchCalls.push({ url, body });
      return jsonResponse(200, { transaction: serverTx, items: [] });
    };
    const drained = await drainPendingPurchases(supabase, SCOPE, { fetchImpl });
    assert.deepEqual(
      drained,
      { confirmedCount: 1, parkedCount: 0, queuedCount: 0, stoppedEarly: false },
      "a status-confirmed purchase confirms",
    );
    assert.equal(fetchCalls.length, 0, "the confirmed status posts nothing — the drain never blind re-posts");
    assert.equal(rpcCalls.length, 1, "the drain asks the status RPC once");
    assert.equal(rpcCalls[0].fn, "get_purchase_request_status", "the status check is the new purchase function");
    assert.equal(rpcCalls[0].args.p_request_key, "key-purchase-sync-1", "the status check passes the request key");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
    const mirror = await loadHistoryMirror<PurchaseTransaction>("purchase_transaction", SCOPE);
    assert.equal(mirror.rows.length, 1, "the confirmed purchase lands in the history mirror");
    assert.equal(mirror.rows[0].invoice_number, "P-50099", "the mirror carries the server invoice number");
    const itemMirror = await loadHistoryMirror<Record<string, unknown>>("purchase_item", SCOPE);
    assert.equal(itemMirror.rows.length, 1, "the confirmed items land in the item mirror");
  }
  {
    // 4b. Unknown status → one POST to the cloud route carrying the
    //     same request key → the row confirms. A replay of the same
    //     key (lost response) posts again with the SAME key, and the
    //     server dedupes — never a second purchase.
    stubWindow();
    const backend = getLocalPurchasesBackend();
    const row = purchaseRow("key-purchase-sync-2", { provisionalNumber: "LP-000124" });
    await backend.upsert(SCOPE, row);
    const fetchCalls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, unknown> }> = [];
    const serverTx = {
      id: "tx-server-2",
      supplier_id: "00000000-0000-4000-8000-000000000010",
      invoice_number: "P-50100",
      created_at: "2026-11-17T10:00:00.000Z",
      purchase_date: "2026-11-17",
      expense_review_status: "pending",
      expense_reviewed_at: null,
      total_amount: 25,
      request_key: "key-purchase-sync-2",
    };
    const supabase = {
      rpc: async () => ({ data: { status: "unknown" }, error: null }),
    } as unknown as SupabaseClient;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      fetchCalls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, unknown> });
      return jsonResponse(200, { transaction: serverTx, items: [] });
    };
    const drained = await drainPendingPurchases(supabase, SCOPE, { fetchImpl });
    assert.equal(drained.confirmedCount, 1, "one purchase confirms");
    assert.equal(fetchCalls.length, 1, "one POST for one purchase");
    assert.equal(fetchCalls[0].url, "/api/purchases", "the purchase sync posts to the cloud route, never the RPC directly");
    assert.equal(fetchCalls[0].body.request_key, "key-purchase-sync-2", "the POST carries the client request key");
    assert.equal(fetchCalls[0].body.supplier_id, "00000000-0000-4000-8000-000000000010", "the POST carries the purchase input");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");

    // A lost response re-queues the same row: the status check is
    // unknown again, the POST repeats with the SAME key — the server
    // dedupes by request_key, so it can never become a second
    // purchase. (The server side of that dedup is create_purchase_atomic's
    // unique index; the client side is: the key never changes.)
    await backend.upsert(SCOPE, row);
    const replayed = await drainPendingPurchases(supabase, SCOPE, { fetchImpl });
    assert.equal(replayed.confirmedCount, 1, "the replay confirms");
    assert.equal(fetchCalls.length, 2, "the replay posts once more");
    assert.equal(fetchCalls[1].body.request_key, "key-purchase-sync-2", "the replay reuses the ORIGINAL key");
  }
  {
    // 4c. A 400 "already used for a different purchase" parks as a
    //     fingerprint mismatch (no Retry — it can never succeed); a
    //     network failure leaves the row queued and stops the loop.
    stubWindow();
    const backend = getLocalPurchasesBackend();
    const row = purchaseRow("key-purchase-sync-3", { provisionalNumber: "LP-000125" });
    await backend.upsert(SCOPE, row);
    const supabase = {
      rpc: async () => ({ data: { status: "unknown" }, error: null }),
    } as unknown as SupabaseClient;
    const fingerprint = async () =>
      jsonResponse(400, { error: "Request key was already used for a different purchase." });
    const parked = await drainPendingPurchases(supabase, SCOPE, { fetchImpl: fingerprint });
    assert.equal(parked.parkedCount, 1, "a fingerprint mismatch parks the row");
    const issues = openSyncIssues(await getSyncIssuesBackend().list(SCOPE));
    assert.equal(issues.length, 1, "one issue is parked");
    assert.equal(issues[0].kind, "fingerprint-mismatch", "the issue kind is fingerprint-mismatch");
    assert.equal(issues[0].purchaseId, "key-purchase-sync-3", "the issue carries the local row id for Retry");
    assert.equal(issues[0].provisionalNumber, "LP-000125", "the issue carries the provisional number");
    const parkedRow = mustBePresent(
      (await backend.list(SCOPE)).find((item) => item.id === "key-purchase-sync-3"),
      "the parked row stays local",
    );
    assert.equal(parkedRow.syncStatus, "rejected", "the parked row is marked rejected");

    // Owner Retry of a fingerprint mismatch is refused without
    // submitting — the same key with different contents can never
    // succeed.
    let retryPosts = 0;
    const countingFetch = async () => {
      retryPosts += 1;
      return jsonResponse(200, { transaction: { id: "tx-x" }, items: [] });
    };
    const refused = await retryPurchaseSyncIssue(supabase, SCOPE, issues[0].id, { fetchImpl: countingFetch });
    assert.equal(refused.notRetryable, true, "a fingerprint mismatch refuses retry");
    assert.equal(retryPosts, 0, "the refused retry submits nothing");

    const queuedRow = purchaseRow("key-purchase-sync-4", { provisionalNumber: "LP-000126" });
    const queuedRow2 = purchaseRow("key-purchase-sync-5", { provisionalNumber: "LP-000127" });
    await backend.upsert(SCOPE, queuedRow);
    await backend.upsert(SCOPE, queuedRow2);
    let fetchAttempts = 0;
    const networkDown = async (): Promise<Response> => {
      fetchAttempts += 1;
      throw new TypeError("fetch failed");
    };
    const queued = await drainPendingPurchases(supabase, SCOPE, { fetchImpl: networkDown });
    assert.equal(fetchAttempts, 1, "a network failure stops the loop after the first row");
    assert.equal(queued.stoppedEarly, true, "the drain reports it stopped early");
    assert.equal(queued.queuedCount, 2, "both rows stay queued");
  }

  // 5. Supplier sync: drain with a stubbed server + stubbed fetch.
  {
    // 5a. Create: no server row → one POST carrying the client id →
    //     the row is removed. The POST body carries NO balance field.
    stubWindow();
    const backend = getLocalSuppliersBackend();
    const row = supplierRow("00000000-0000-4000-8000-000000000001", supplierData("Sync Supplier"));
    await backend.upsert(SCOPE, row);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverRows = new Map<string, Record<string, unknown>>();
    const server: SupplierServer = { fetchById: async (id) => serverRows.get(id) ?? null };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return jsonResponse(200, { supplier: { id: body.id, supplier_name: body.supplier_name, is_active: true } });
    };
    const drained = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.deepEqual(
      drained,
      { confirmedCount: 1, parkedCount: 0, queuedCount: 0, stoppedEarly: false },
      "one create confirms",
    );
    assert.equal(calls.length, 1, "one POST for one create");
    assert.equal(calls[0].url, "/api/suppliers", "the create posts to the supplier route");
    assert.equal(calls[0].body.id, row.id, "the POST carries the client UUID as the id");
    assert.ok(!("outstanding_balance" in calls[0].body), "the create body never carries a stored balance");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");

    // A second drain with the same row re-queued replays: the server
    // already holds the id with the same profile, so no POST happens.
    await backend.upsert(SCOPE, row);
    serverRows.set(row.id, { ...supplierData("Sync Supplier"), updated_at: "2026-11-17T02:00:00.000Z" });
    const replayed = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(replayed.confirmedCount, 1, "the replay confirms");
    assert.equal(calls.length, 1, "the replay posts nothing — the existence check found the row");
    assert.deepEqual(await backend.list(SCOPE), [], "the replayed row is removed");
  }
  {
    // 5b. Create against an older server copy: the local copy is newer
    //     → PUT reconciles. Against a newer server copy: parked as a
    //     supplier-conflict issue, never overwritten. Retry forces it.
    stubWindow();
    const backend = getLocalSuppliersBackend();
    const older = supplierRow("00000000-0000-4000-8000-000000000002", supplierData("Newer Local"));
    await backend.upsert(SCOPE, older);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverRows = new Map<string, Record<string, unknown>>([
      [
        older.id,
        {
          ...supplierData("Older Server"),
          updated_at: "2026-11-17T01:00:00.000Z",
        },
      ],
    ]);
    const server: SupplierServer = { fetchById: async (id) => serverRows.get(id) ?? null };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return jsonResponse(200, { supplier: { id: older.id, supplier_name: "Newer Local", is_active: true } });
    };
    const drained = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(drained.confirmedCount, 1, "the newer local copy reconciles");
    assert.equal(calls[0].url, `/api/suppliers/${older.id}`, "the reconcile is a PATCH to the supplier");
    assert.equal(calls[0].body.supplier_name, "Newer Local", "the PATCH carries the local profile");
    assert.ok(!("outstanding_balance" in calls[0].body), "the reconcile body never carries a stored balance");

    const superseded = supplierRow("00000000-0000-4000-8000-000000000003", supplierData("Older Local"), "2026-11-16T01:00:00.000Z");
    await backend.upsert(SCOPE, superseded);
    serverRows.set(superseded.id, {
      ...supplierData("Newer Server"),
      updated_at: "2026-11-16T03:00:00.000Z",
    });
    const parked = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.deepEqual(
      parked,
      { confirmedCount: 0, parkedCount: 1, queuedCount: 0, stoppedEarly: false },
      "the older local copy is parked, not overwritten",
    );
    const issues = openSyncIssues(await getSyncIssuesBackend().list(SCOPE));
    assert.equal(issues.length, 1, "one conflict issue is parked");
    assert.equal(issues[0].kind, "supplier-conflict", "the issue kind is supplier-conflict");
    assert.equal(issues[0].supplierId, superseded.id, "the issue carries the local row id for Retry");
    const parkedRow = mustBePresent(
      (await backend.list(SCOPE)).find((item) => item.id === superseded.id),
      "the parked row stays local",
    );
    assert.equal(parkedRow.syncStatus, "rejected", "the parked row is marked rejected");

    // Owner Retry re-applies the parked copy with a fresh timestamp
    // and force: true — the owner's explicit decision that this copy
    // wins — and resolves the issue.
    const retryCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const retryFetch = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      retryCalls.push({ url, body });
      return jsonResponse(200, { supplier: { id: superseded.id, supplier_name: "Older Local", is_active: true } });
    };
    const retried = await retrySupplierSyncIssue(dummySupabase, SCOPE, issues[0].id, { server, fetchImpl: retryFetch });
    assert.equal(retried.confirmed, true, "the owner retry confirms");
    assert.equal(retryCalls[0].body.force, true, "the retry forces the parked copy");
    assert.ok(
      typeof retryCalls[0].body.updated_at === "string" &&
        (retryCalls[0].body.updated_at as string) > "2026-11-16T03:00:00.000Z",
      "the retry carries a fresh timestamp newer than the server copy",
    );
    assert.deepEqual(await backend.list(SCOPE), [], "the retried row is removed");
    assert.deepEqual(openSyncIssues(await getSyncIssuesBackend().list(SCOPE)), [], "the issue resolves on retry");
  }
  {
    // 5c. Edit: PATCH ok → removed. PATCH superseded → parked.
    //     A 400 validation parks as rejected. A network failure leaves
    //     the row queued and stops the loop early.
    stubWindow();
    const backend = getLocalSuppliersBackend();
    const editRow: LocalSupplierRow = {
      ...supplierRow("00000000-0000-4000-8000-000000000004", supplierData("Edited Supplier")),
      kind: "edit",
      serverId: "00000000-0000-4000-8000-000000000004",
    };
    await backend.upsert(SCOPE, editRow);
    const server: SupplierServer = { fetchById: async () => null };
    const patchOk = async () =>
      jsonResponse(200, { supplier: { id: editRow.id, supplier_name: "Edited Supplier", is_active: true } });
    const drained = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl: patchOk });
    assert.equal(drained.confirmedCount, 1, "an edit PATCH confirms");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed edit is removed");

    await backend.upsert(SCOPE, editRow);
    const patchSuperseded = async () =>
      jsonResponse(200, {
        supplier: { id: editRow.id, supplier_name: "Newer Server", is_active: true },
        superseded: true,
      });
    const parked = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl: patchSuperseded });
    assert.equal(parked.parkedCount, 1, "a superseded edit is parked");
    assert.equal(openSyncIssues(await getSyncIssuesBackend().list(SCOPE)).length, 1, "the superseded edit parks one issue");
    await backend.remove(SCOPE, editRow.id);
    const issuesBackend = getSyncIssuesBackend();
    for (const issue of await issuesBackend.list(SCOPE)) {
      await issuesBackend.setStatus(SCOPE, issue.id, "discarded");
    }

    const badRow = supplierRow("00000000-0000-4000-8000-000000000005", { ...supplierData("Bad Supplier"), supplier_name: "" });
    await backend.upsert(SCOPE, badRow);
    const badRequest = async () => jsonResponse(400, { error: "Supplier name is required." });
    const rejected = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl: badRequest });
    assert.equal(rejected.parkedCount, 1, "a validation failure parks the row");
    const rejectedIssues = openSyncIssues(await getSyncIssuesBackend().list(SCOPE));
    assert.equal(rejectedIssues[0].kind, "rejected", "a validation failure parks as rejected");
    assert.match(rejectedIssues[0].reason, /Supplier name is required/, "the server message is kept on the issue");

    const queuedRow = supplierRow("00000000-0000-4000-8000-000000000006", supplierData("Queued One"));
    const queuedRow2 = supplierRow("00000000-0000-4000-8000-000000000007", supplierData("Queued Two"));
    await backend.upsert(SCOPE, queuedRow);
    await backend.upsert(SCOPE, queuedRow2);
    let fetchCalls = 0;
    const networkDown = async (): Promise<Response> => {
      fetchCalls += 1;
      throw new TypeError("fetch failed");
    };
    const queued = await drainPendingSuppliers(dummySupabase, SCOPE, { server, fetchImpl: networkDown });
    assert.equal(fetchCalls, 1, "a network failure stops the loop after the first row");
    assert.equal(queued.stoppedEarly, true, "the drain reports it stopped early");
    assert.equal(queued.queuedCount, 2, "both rows stay queued (the attempted one + the unattempted one)");
    assert.equal((await backend.list(SCOPE)).length, 3, "nothing is removed on a network failure");
  }

  // 6. Route helper + SQL file + source guards.
  {
    assert.equal(isValidSupplierClientId(crypto.randomUUID()), true, "a generated UUID is accepted");
    assert.equal(isValidSupplierClientId("00000000-0000-4000-8000-000000000001"), true, "a well-formed UUID is accepted");
    assert.equal(isValidSupplierClientId("not-a-uuid"), false, "a non-UUID is refused");
    assert.equal(isValidSupplierClientId("123"), false, "a short id is refused");
    assert.equal(isValidSupplierClientId(""), false, "an empty id is refused");
    assert.equal(isValidSupplierClientId(null), false, "a null id is refused");
    assert.equal(isValidSupplierClientId(undefined), false, "an undefined id is refused");
    assert.equal(isValidSupplierClientId("00000000-0000-4000-8000-00000000001"), false, "a short final segment is refused");
    assert.equal(isValidSupplierClientId("00000000-0000-4000-8000-000000000001-extra"), false, "a long id is refused");
  }
  {
    // The status-check SQL ships as a file only (UMAIR runs it
    // disposable-first). The file must define the function, read the
    // request_key, and grant execute to authenticated — never to
    // service_role, and never call the create RPC.
    const sql = readFileSync(join(process.cwd(), "src/lib/migrations/get_purchase_request_status.sql"), "utf8");
    assert.match(sql, /create or replace function public\.get_purchase_request_status\(p_request_key text\)/, "the file defines get_purchase_request_status");
    assert.match(sql, /purchase_transactions\.request_key/, "the function reads the request_key column");
    assert.match(sql, /grant execute on function public\.get_purchase_request_status\(text\) to authenticated/, "the function is granted to authenticated");
    assert.doesNotMatch(sql, /grant execute[^;]*service_role/, "the file grants nothing to service_role");
    assert.doesNotMatch(sql, /create_purchase_atomic/, "the file never calls the create RPC");
    assert.match(sql, /status.*unknown/, "the function answers unknown for a missing key");
  }
  {
    // The client sync never calls the purchase RPC and never touches
    // a service-role client: purchases sync through the cloud route
    // with the user's JWT only (decision 3).
    const purchaseSyncSource = readFileSync(join(process.cwd(), "src/lib/offline/purchase-sync.ts"), "utf8");
    // An invocation, not a bare mention: the header comment names the
    // RPC to explain why the cloud route is the only path.
    assert.doesNotMatch(purchaseSyncSource, /\.rpc\(\s*["']create_purchase_atomic["']/, "the purchase sync never calls the create RPC");
    assert.doesNotMatch(purchaseSyncSource, /create_purchase_atomic\s*\(/, "the purchase sync never invokes the create RPC");
    assert.doesNotMatch(purchaseSyncSource, /createSupabaseService|SUPABASE_SERVICE_ROLE_KEY|service_role/, "the purchase sync never touches the service-role key");
    assert.match(purchaseSyncSource, /\/api\/purchases/, "the purchase sync posts to the cloud route");
    const supplierSyncSource = readFileSync(join(process.cwd(), "src/lib/offline/supplier-sync.ts"), "utf8");
    assert.doesNotMatch(supplierSyncSource, /createSupabaseService|SUPABASE_SERVICE_ROLE_KEY|service_role/, "the supplier sync never touches the service-role key");
    // No supplier-balance write anywhere in the S6 sync code: the
    // only balance word in the supplier sync is the comment stating
    // the balance is never written.
    const balanceMentions = supplierSyncSource.split("\n").filter((line) => line.includes("outstanding_balance"));
    assert.deepEqual(balanceMentions, [], "the supplier sync never mentions a stored balance at all");
  }

  console.log("test-purchases-offline: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
