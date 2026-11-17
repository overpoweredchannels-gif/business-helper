import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { createLocalStore, type LocalCustomerRow } from "../electron/store";
import {
  DesktopLocalCustomersBackend,
  LocalStorageLocalCustomersBackend,
  editLocalCustomerRow,
  getLocalCustomersBackend,
  mergeLocalCustomers,
  newLocalCustomerCreateRow,
} from "../src/lib/offline/local-customers";
import { buildCustomerBalanceInput, deriveOfflineCustomerBalance } from "../src/lib/offline/customer-balance-offline";
import {
  drainPendingCustomers,
  retryCustomerSyncIssue,
  type CustomerServer,
} from "../src/lib/offline/customer-sync";
import { getSyncIssuesBackend, openSyncIssues } from "../src/lib/offline/sync-issues";
import { isValidCustomerClientId } from "../src/app/api/customers/route";
import type { Customer } from "../src/lib/tradeos/types";
import type { PendingSale } from "../src/lib/sales/atomic-sale-client";

// Slice S5 — customers offline (Quick-Add/edit + credit balances).
// The SQLite store holds offline-created / offline-edited customers
// with a client-generated UUID as the id (the same id becomes the
// server id on sync); the renderer seam mirrors the local-sales
// pattern (SQLite on desktop, localStorage fallback); the balance is
// derived from local ledger rows and never written; the sync drains
// customers first, dedupes by id, and parks conflicts in Sync issues
// instead of overwriting the newer copy.

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

function customerData(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    customer_name: name,
    shop_name: null,
    phone: "03001234567",
    whatsapp: null,
    city: null,
    area: null,
    address: "Main Bazaar",
    customer_type: "Retailer",
    credit_policy: "unrestricted",
    credit_limit: null,
    credit_days: null,
    allow_over_limit: false,
    allow_overdue_sales: false,
    preferred_payment_method: "credit",
    is_active: true,
    ...overrides,
  };
}

function createRow(id: string, data: Record<string, unknown>, createdAt = "2026-11-17T02:00:00.000Z"): LocalCustomerRow {
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
  // 1. SQLite store on a temp file: create round-trip, edit merges into
  //    a create, last-write-wins, idempotency uniqueness, close + reopen.
  const dir = mkdtempSync(join(tmpdir(), "aankh-s5-test-"));
  try {
    const dbPath = join(dir, "aankh.db");
    const store = createLocalStore(dbPath);
    assert.deepEqual(store.listCustomers(SCOPE), [], "empty customers read empty");

    const row = createRow("00000000-0000-4000-8000-000000000001", customerData("Offline Customer"));
    const stored = store.upsertCustomer(SCOPE, row);
    assert.equal(stored.id, row.id, "the client UUID is the row id");
    assert.equal(stored.kind, "create", "a Quick-Add row is a create");
    assert.equal(stored.idempotencyKey, "key-00000000-0000-4000-8000-000000000001", "the idempotency key survives");
    assert.deepEqual(
      store.listCustomers(SCOPE).map((item) => item.data.customer_name),
      ["Offline Customer"],
      "the created customer lists back",
    );

    // An edit of an unsynced create stays a create: the key and the
    // first-created time survive, the newest data wins.
    const edited = editLocalCustomerRow(stored, stored.id, customerData("Offline Customer Renamed", { phone: "03009998888" }));
    assert.equal(edited.kind, "create", "an edit of a create stays a create");
    assert.equal(edited.idempotencyKey, stored.idempotencyKey, "the key survives an edit");
    assert.equal(edited.createdAt, stored.createdAt, "the first-created time survives an edit");
    assert.equal(edited.data.customer_name, "Offline Customer Renamed", "the newest edit wins");
    assert.equal(edited.data.phone, "03009998888", "the newest edit wins on every field");
    const storedEdited = store.upsertCustomer(SCOPE, edited);
    assert.equal(storedEdited.data.customer_name, "Offline Customer Renamed", "the edit persists");

    // A second edit overwrites the first (last-write-wins, never merge).
    const edited2 = editLocalCustomerRow(storedEdited, storedEdited.id, customerData("Offline Customer Final", { phone: null }));
    assert.equal(edited2.data.customer_name, "Offline Customer Final", "the second edit wins");
    assert.equal(edited2.data.phone, null, "the second edit's null wins over the first edit's phone");
    store.upsertCustomer(SCOPE, edited2);

    // An edit of a server row is kind "edit" with the server id.
    const serverRow: LocalCustomerRow = {
      ...createRow("00000000-0000-4000-8000-000000000002", customerData("Server Customer")),
      kind: "edit",
      serverId: "00000000-0000-4000-8000-000000000002",
    };
    store.upsertCustomer(SCOPE, serverRow);
    const serverEdited = editLocalCustomerRow(serverRow, serverRow.id, customerData("Server Customer Renamed"));
    assert.equal(serverEdited.kind, "edit", "an edit of a server row stays an edit");
    assert.equal(serverEdited.serverId, serverRow.serverId, "the server id survives an edit");
    store.upsertCustomer(SCOPE, serverEdited);

    // A duplicate idempotency key is refused, never a second row.
    assert.throws(
      () =>
        store.upsertCustomer(SCOPE, {
          ...createRow("00000000-0000-4000-8000-000000000003", customerData("Duplicate Key")),
          idempotencyKey: "key-00000000-0000-4000-8000-000000000001",
        }),
      /UNIQUE constraint failed/,
      "a duplicate idempotency key is refused",
    );
    assert.equal(store.listCustomers(SCOPE).length, 2, "the refused row did not land");

    store.removeCustomer(SCOPE, "00000000-0000-4000-8000-000000000002");
    assert.deepEqual(
      store.listCustomers(SCOPE).map((item) => item.id),
      ["00000000-0000-4000-8000-000000000001"],
      "remove drops one customer",
    );

    // Close + reopen: rows survive, and the customer_id column exists.
    store.close();
    const reopened = createLocalStore(dbPath);
    assert.deepEqual(
      reopened.listCustomers(SCOPE).map((item) => [item.id, item.data.customer_name]),
      [["00000000-0000-4000-8000-000000000001", "Offline Customer Final"]],
      "customers survive close + reopen",
    );

    // Migration: a pre-S5 database (no local_customers table, no
    // customer_id on sync_issues) gains both on open. Built by
    // downgrading a real store, so every other table stays exactly as
    // the store created it.
    const legacyPath = join(dir, "legacy.db");
    const legacyStore = createLocalStore(legacyPath);
    legacyStore.close();
    const downgrade = new Database(legacyPath);
    downgrade.exec("DROP TABLE local_customers; ALTER TABLE sync_issues DROP COLUMN customer_id;");
    downgrade.close();
    const migrated = createLocalStore(legacyPath);
    assert.deepEqual(migrated.listCustomers(SCOPE), [], "the migrated database has an empty customers table");
    migrated.close();
    const migratedIssues = new Database(legacyPath).prepare("PRAGMA table_info(sync_issues)").all() as Array<{ name: string }>;
    assert.ok(
      migratedIssues.some((column) => column.name === "customer_id"),
      "the migration adds customer_id to sync_issues",
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
    const backend = getLocalCustomersBackend();
    assert.ok(backend instanceof LocalStorageLocalCustomersBackend, "no bridge selects the localStorage backend");
    const row = newLocalCustomerCreateRow(customerData("Seam Customer"));
    assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "a create row gets a client UUID");
    assert.equal(row.kind, "create", "a new row is a create");
    assert.ok(row.idempotencyKey.length > 0, "a create row gets an idempotency key");
    await backend.upsert(SCOPE, row);
    assert.deepEqual(
      (await backend.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the localStorage backend round-trips a row",
    );
    await backend.remove(SCOPE, row.id);
    assert.deepEqual(await backend.list(SCOPE), [], "the localStorage backend removes a row");
  }
  {
    const values = new Map<string, string>();
    const ipcRows = new Map<string, LocalCustomerRow[]>();
    const bridge = {
      list: async (scope: string) => ipcRows.get(scope) ?? [],
      upsert: async (scope: string, row: LocalCustomerRow) => {
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
      aankhDesktop: { isDesktop: true, localCustomers: bridge },
    });
    const backend = getLocalCustomersBackend();
    assert.ok(backend instanceof DesktopLocalCustomersBackend, "the bridge present selects the desktop backend");
    const row = newLocalCustomerCreateRow(customerData("Desktop Customer"));
    await backend.upsert(SCOPE, row);
    assert.deepEqual(
      (await backend.list(SCOPE)).map((item) => item.id),
      [row.id],
      "the desktop backend lists from the bridge",
    );
    await backend.remove(SCOPE, row.id);
    assert.deepEqual(await backend.list(SCOPE), [], "the desktop backend removes through the bridge");

    // An IPC failure falls back to localStorage instead of losing the customer.
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
      aankhDesktop: { isDesktop: true, localCustomers: failingBridge },
    });
    const fallback = getLocalCustomersBackend();
    const fallbackRow = newLocalCustomerCreateRow(customerData("Fallback Customer"));
    await fallback.upsert(SCOPE, fallbackRow);
    assert.deepEqual(
      (await fallback.list(SCOPE)).map((item) => item.id),
      [fallbackRow.id],
      "an IPC failure falls back to localStorage",
    );
  }
  {
    // Merge: the local row wins per id, creates append, sorted by name.
    const serverCustomers = [
      { id: "00000000-0000-4000-8000-000000000001", customer_name: "Alpha", credit_policy: "cash_only" },
      { id: "00000000-0000-4000-8000-000000000002", customer_name: "Beta", credit_policy: "cash_only" },
    ] as Customer[];
    const localRows: LocalCustomerRow[] = [
      {
        ...createRow("00000000-0000-4000-8000-000000000002", customerData("Beta Renamed")),
        kind: "edit",
        serverId: "00000000-0000-4000-8000-000000000002",
      },
      createRow("00000000-0000-4000-8000-000000000003", customerData("Gamma")),
    ];
    const merged = mergeLocalCustomers(serverCustomers, localRows);
    assert.deepEqual(
      merged.map((customer) => customer.customer_name),
      ["Alpha", "Beta Renamed", "Gamma"],
      "the merge keeps the local edit, appends the create, and sorts by name",
    );
    // Slice S8 — the merge carries the authoritative row id. The
    // stored `data` below still carries the stale id
    // 00000000-0000-4000-8000-000000000001 for every row (that is
    // what customerData writes); trusting it rendered the edit and
    // the create under Alpha's id — the same latent shape S6 fixed
    // for suppliers.
    assert.deepEqual(
      merged.map((customer) => String(customer.id)),
      [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
      ],
      "the merge overrides the stored data id with the row id",
    );
    assert.deepEqual(
      mergeLocalCustomers(serverCustomers, []),
      serverCustomers,
      "no local rows leaves the server list untouched",
    );
  }

  // 3. Balance: derived from local ledger rows (sale + payment +
  //    return), never written, with the pending queued sale counted
  //    and a voided payment ignored.
  {
    const customerId = "00000000-0000-4000-8000-000000000001";
    const baseRows = {
      transactions: [
        {
          id: "tx-1",
          customer_id: customerId,
          payment_type: "credit",
          status: "confirmed",
          sale_date: "2026-11-17",
          created_at: "2026-11-17T10:00:00.000Z",
          invoice_number: "S-100001",
          total_amount: 10,
        },
      ],
      invoiceTotals: { "tx-1": 10 },
      payments: [
        { id: "pay-1", customer_id: customerId, amount: 4, voided_at: null },
        { id: "pay-2", customer_id: customerId, amount: 3, voided_at: "2026-11-17T11:00:00.000Z" },
      ],
      allocations: [
        { sales_transaction_id: "tx-1", amount: 4, customer_payment_id: "pay-1" },
        { sales_transaction_id: "tx-1", amount: 3, customer_payment_id: "pay-2" },
      ],
      returns: [{ id: "ret-1", customer_id: customerId, sales_transaction_id: "tx-1", status: "confirmed" }],
      returnItems: [{ sales_return_id: "ret-1", quantity: 1, unit_price: 2, discount: 0 }],
      pendingSales: [] as PendingSale[],
      syncedRequestIds: new Set<string>(),
    };
    const before = JSON.stringify(baseRows);
    const derived = deriveOfflineCustomerBalance(customerId, baseRows);
    assert.deepEqual(
      derived,
      { outstanding: 4, creditSales: 10, paymentsApplied: 4, returnsCredited: 2 },
      "credit sale 10 − payment 4 − return 2 = outstanding 4 (the voided payment of 3 covers nothing)",
    );
    assert.equal(JSON.stringify(baseRows), before, "the derivation never writes to its inputs");
    const built = buildCustomerBalanceInput(customerId, baseRows);
    assert.equal(built.transactions.length, 1, "one credit invoice feeds the engine");
    assert.equal(built.payments.length, 2, "both payments feed the engine (the void is filtered inside it)");

    // A pending queued credit sale counts at once; a cash one and
    // another customer's sale do not.
    const pendingCredit: PendingSale = {
      requestId: "req-pending-1",
      input: {
        customer_id: customerId,
        sale_date: "2026-11-17",
        payment_type: "credit",
        invoice_discount: 0,
        invoice_discount_type: "flat",
        tax_rate: 0,
        cash_received: 0,
        credit_override_confirmed: false,
        lines: [{ product_id: "product-1", quantity: 1, selling_price: 5, discount: 0, bonus: 0, unit_mode: "main" }],
      },
    };
    const pendingCash: PendingSale = {
      requestId: "req-pending-2",
      input: { ...pendingCredit.input, payment_type: "cash" },
    };
    const pendingOther: PendingSale = {
      requestId: "req-pending-3",
      input: { ...pendingCredit.input, customer_id: "00000000-0000-4000-8000-000000000099" },
    };
    assert.equal(
      deriveOfflineCustomerBalance(customerId, { ...baseRows, pendingSales: [pendingCredit] }).outstanding,
      9,
      "a pending queued credit sale of 5 adds to the outstanding balance",
    );
    assert.equal(
      deriveOfflineCustomerBalance(customerId, { ...baseRows, pendingSales: [pendingCash] }).outstanding,
      4,
      "a pending cash sale does not add to the outstanding balance",
    );
    assert.equal(
      deriveOfflineCustomerBalance(customerId, { ...baseRows, pendingSales: [pendingOther] }).outstanding,
      4,
      "another customer's pending sale does not add to this balance",
    );
    // A pending sale whose request id already synced is skipped —
    // the synced row carries the same sale, so counting both would
    // double it.
    assert.equal(
      deriveOfflineCustomerBalance(customerId, {
        ...baseRows,
        pendingSales: [pendingCredit],
        syncedRequestIds: new Set(["req-pending-1"]),
      }).outstanding,
      4,
      "an already-synced pending sale is not counted twice",
    );
    assert.deepEqual(
      deriveOfflineCustomerBalance(null, baseRows),
      { outstanding: 0, creditSales: 0, paymentsApplied: 0, returnsCredited: 0 },
      "a missing customer id derives zero, never a guessed number",
    );
  }

  // 4. Sync: drain with a stubbed server + stubbed fetch. The
  //    supabase client is unused when a server stub is passed.
  const dummySupabase = {} as unknown as SupabaseClient;
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  {
    // 4a. Create: no server row → one POST carrying the client id →
    //     the row is removed. A replay of the same key never duplicates.
    stubWindow();
    const backend = getLocalCustomersBackend();
    const row = createRow("00000000-0000-4000-8000-000000000001", customerData("Sync Customer"));
    await backend.upsert(SCOPE, row);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverRows = new Map<string, Record<string, unknown>>();
    const server: CustomerServer = { fetchById: async (id) => serverRows.get(id) ?? null };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return jsonResponse(200, { ok: true, customer: { id: body.id, customer_name: body.customer_name, is_active: true } });
    };
    const drained = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.deepEqual(
      drained,
      { confirmedCount: 1, parkedCount: 0, queuedCount: 0, stoppedEarly: false },
      "one create confirms",
    );
    assert.equal(calls.length, 1, "one POST for one create");
    assert.equal(calls[0].url, "/api/customers", "the create posts to the customer route");
    assert.equal(calls[0].body.id, row.id, "the POST carries the client UUID as the id");
    assert.equal(calls[0].body.credit_policy, "unrestricted", "the Quick-Add credit policy travels with the create");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");

    // A second drain with the same row re-queued replays: the server
    // already holds the id with the same profile, so no POST happens.
    await backend.upsert(SCOPE, row);
    serverRows.set(row.id, { ...customerData("Sync Customer"), updated_at: "2026-11-17T02:00:00.000Z" });
    const replayed = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(replayed.confirmedCount, 1, "the replay confirms");
    assert.equal(calls.length, 1, "the replay posts nothing — the existence check found the row");
    assert.deepEqual(await backend.list(SCOPE), [], "the replayed row is removed");
  }
  {
    // 4b. Create against an older server copy: the local copy is newer
    //     → PUT reconciles. Against a newer server copy: parked as a
    //     customer-conflict issue, never overwritten.
    stubWindow();
    const backend = getLocalCustomersBackend();
    const older = createRow("00000000-0000-4000-8000-000000000002", customerData("Newer Local"));
    await backend.upsert(SCOPE, older);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverRows = new Map<string, Record<string, unknown>>([
      [
        older.id,
        {
          ...customerData("Older Server"),
          updated_at: "2026-11-17T01:00:00.000Z",
        },
      ],
    ]);
    const server: CustomerServer = { fetchById: async (id) => serverRows.get(id) ?? null };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return jsonResponse(200, { ok: true, customer: { id: older.id, customer_name: "Newer Local", is_active: true } });
    };
    const drained = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.equal(drained.confirmedCount, 1, "the newer local copy reconciles");
    assert.equal(calls[0].url, `/api/customers/${older.id}`, "the reconcile is a PUT to the customer");
    assert.equal(calls[0].body.customer_name, "Newer Local", "the PUT carries the local profile");

    const superseded = createRow("00000000-0000-4000-8000-000000000003", customerData("Older Local"), "2026-11-16T01:00:00.000Z");
    await backend.upsert(SCOPE, superseded);
    serverRows.set(superseded.id, {
      ...customerData("Newer Server"),
      updated_at: "2026-11-16T03:00:00.000Z",
    });
    const parked = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl });
    assert.deepEqual(
      parked,
      { confirmedCount: 0, parkedCount: 1, queuedCount: 0, stoppedEarly: false },
      "the older local copy is parked, not overwritten",
    );
    const issues = openSyncIssues(await getSyncIssuesBackend().list(SCOPE));
    assert.equal(issues.length, 1, "one conflict issue is parked");
    assert.equal(issues[0].kind, "customer-conflict", "the issue kind is customer-conflict");
    assert.equal(issues[0].customerId, superseded.id, "the issue carries the local row id for Retry");
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
      return jsonResponse(200, { ok: true, customer: { id: superseded.id, customer_name: "Older Local", is_active: true } });
    };
    const retried = await retryCustomerSyncIssue(dummySupabase, SCOPE, issues[0].id, { server, fetchImpl: retryFetch });
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
    // 4c. Edit: PUT ok → removed. PUT superseded → parked.
    //     A 400 validation parks as rejected. A network failure leaves
    //     the row queued and stops the loop early.
    stubWindow();
    const backend = getLocalCustomersBackend();
    const editRow: LocalCustomerRow = {
      ...createRow("00000000-0000-4000-8000-000000000004", customerData("Edited Customer")),
      kind: "edit",
      serverId: "00000000-0000-4000-8000-000000000004",
    };
    await backend.upsert(SCOPE, editRow);
    const server: CustomerServer = { fetchById: async () => null };
    const putOk = async () =>
      jsonResponse(200, { ok: true, customer: { id: editRow.id, customer_name: "Edited Customer", is_active: true } });
    const drained = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl: putOk });
    assert.equal(drained.confirmedCount, 1, "an edit PUT confirms");
    assert.deepEqual(await backend.list(SCOPE), [], "the confirmed edit is removed");

    await backend.upsert(SCOPE, editRow);
    const putSuperseded = async () =>
      jsonResponse(200, {
        ok: true,
        customer: { id: editRow.id, customer_name: "Newer Server", is_active: true },
        superseded: true,
      });
    const parked = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl: putSuperseded });
    assert.equal(parked.parkedCount, 1, "a superseded edit is parked");
    assert.equal(openSyncIssues(await getSyncIssuesBackend().list(SCOPE)).length, 1, "the superseded edit parks one issue");
    await backend.remove(SCOPE, editRow.id);
    const issuesBackend = getSyncIssuesBackend();
    for (const issue of await issuesBackend.list(SCOPE)) {
      await issuesBackend.setStatus(SCOPE, issue.id, "discarded");
    }

    const badRow = createRow("00000000-0000-4000-8000-000000000005", { ...customerData("Bad Customer"), customer_name: "" });
    await backend.upsert(SCOPE, badRow);
    const badRequest = async () => jsonResponse(400, { ok: false, error: "Customer name is required." });
    const rejected = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl: badRequest });
    assert.equal(rejected.parkedCount, 1, "a validation failure parks the row");
    const rejectedIssues = openSyncIssues(await getSyncIssuesBackend().list(SCOPE));
    assert.equal(rejectedIssues[0].kind, "rejected", "a validation failure parks as rejected");
    assert.match(rejectedIssues[0].reason, /Customer name is required/, "the server message is kept on the issue");

    const queuedRow = createRow("00000000-0000-4000-8000-000000000006", customerData("Queued One"));
    const queuedRow2 = createRow("00000000-0000-4000-8000-000000000007", customerData("Queued Two"));
    await backend.upsert(SCOPE, queuedRow);
    await backend.upsert(SCOPE, queuedRow2);
    let fetchCalls = 0;
    const networkDown = async (): Promise<Response> => {
      fetchCalls += 1;
      throw new TypeError("fetch failed");
    };
    const queued = await drainPendingCustomers(dummySupabase, SCOPE, { server, fetchImpl: networkDown });
    assert.equal(fetchCalls, 1, "a network failure stops the loop after the first row");
    assert.equal(queued.stoppedEarly, true, "the drain reports it stopped early");
    assert.equal(queued.queuedCount, 2, "both rows stay queued (the attempted one + the unattempted one)");
    assert.equal((await backend.list(SCOPE)).length, 3, "nothing is removed on a network failure");
  }

  // 5. Route helper: a client id must be a full UUID; anything else is
  //    refused, so a caller cannot collide with server-generated ids.
  {
    assert.equal(isValidCustomerClientId(crypto.randomUUID()), true, "a generated UUID is accepted");
    assert.equal(isValidCustomerClientId("00000000-0000-4000-8000-000000000001"), true, "a well-formed UUID is accepted");
    assert.equal(isValidCustomerClientId("not-a-uuid"), false, "a non-UUID is refused");
    assert.equal(isValidCustomerClientId("123"), false, "a short id is refused");
    assert.equal(isValidCustomerClientId(""), false, "an empty id is refused");
    assert.equal(isValidCustomerClientId(null), false, "a null id is refused");
    assert.equal(isValidCustomerClientId(undefined), false, "an undefined id is refused");
    assert.equal(isValidCustomerClientId("00000000-0000-4000-8000-00000000001"), false, "a short final segment is refused");
    assert.equal(isValidCustomerClientId("00000000-0000-4000-8000-000000000001-extra"), false, "a long id is refused");
  }

  console.log("test-customers-offline: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
