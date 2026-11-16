import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalStore, type LocalSaleRow, type SyncIssueRow } from "../electron/store";
import {
  createAtomicSale,
  drainPendingSalesQueue,
  readPendingSalesQueue,
  type AtomicSaleInput,
  type AtomicSaleResult,
} from "../src/lib/sales/atomic-sale-client";
import {
  LocalStorageSyncIssuesBackend,
  classifySaleRejection,
  getSyncIssuesBackend,
  openSyncIssues,
  syncIssueCanRetry,
  type SyncIssue,
} from "../src/lib/offline/sync-issues";
import { getSaleQueueBackend } from "../src/lib/offline/local-store";
import { retryPendingLinks } from "../src/lib/offline/provisional-link";
import { retrySyncIssue, startSilentSyncEngine } from "../src/lib/offline/sync-engine";
import { QUEUE_CHANGED_EVENT } from "../src/lib/sales/atomic-sale-client";

// Slice S3 — silent sync engine (sales only). The engine reuses the
// drain's status-check-first + serialized mechanics; these tests prove
// the S3 additions: a refused sale is parked in Sync issues (never
// dropped on desktop), the drain continues past it, a retry with the
// same key confirms once, a timed-out attempt reconciles to exactly
// one invoice, the provisional number is linked to the cloud row, the
// engine's triggers fire without overlapping drains, and the web
// build's rejection behaviour is unchanged.

const SCOPE = "org-1:profile-1";
const SALE_INPUT: AtomicSaleInput = {
  customer_id: "customer-1",
  sale_date: "2026-11-17",
  payment_type: "cash",
  invoice_discount: 0,
  invoice_discount_type: "flat",
  tax_rate: 0,
  cash_received: 10,
  credit_override_confirmed: false,
  lines: [{ product_id: "product-1", quantity: 1, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }],
};
const SALE_INPUT_2: AtomicSaleInput = {
  ...SALE_INPUT,
  customer_id: "customer-2",
  lines: [{ product_id: "product-2", quantity: 2, selling_price: 5, discount: 0, bonus: 0, unit_mode: "main" }],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Minimal window: localStorage + a working event emitter + optional desktop bridges. */
function stubWindow(extra: Record<string, unknown> = {}) {
  const values = new Map<string, string>();
  const listeners = new Map<string, Set<(event: { type: string }) => void>>();
  const win: Record<string, unknown> = {
    localStorage: mapStorage(values),
    addEventListener: (type: string, fn: (event: { type: string }) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: (event: { type: string }) => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((fn) => fn(event));
      return true;
    },
    ...extra,
  };
  return { win, values, listeners };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDesktopEnv = process.env.NEXT_PUBLIC_DESKTOP;

function installWindow(win: Record<string, unknown>): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
}

function restoreGlobals(): void {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalDesktopEnv === undefined) delete process.env.NEXT_PUBLIC_DESKTOP;
  else process.env.NEXT_PUBLIC_DESKTOP = originalDesktopEnv;
}

/** In-memory desktop queue bridge (same allocation rule as the SQLite store). */
function memorySalesBridge() {
  const rows = new Map<string, LocalSaleRow[]>();
  let counter = 0;
  return {
    list: async (scope: string) => rows.get(scope) ?? [],
    replace: async (scope: string, next: LocalSaleRow[]) => {
      const stored = next.map((row) => ({
        ...row,
        provisionalNumber: row.provisionalNumber ?? `L-${String(++counter).padStart(6, "0")}`,
      }));
      rows.set(scope, stored);
      return stored;
    },
    remove: async (scope: string, requestId: string) => {
      rows.set(scope, (rows.get(scope) ?? []).filter((row) => row.requestId !== requestId));
    },
  };
}

/** In-memory desktop issues bridge (same open-row upsert rule as SQLite). */
function memoryIssuesBridge() {
  const rows = new Map<string, SyncIssueRow[]>();
  const toRow = (issue: SyncIssue): SyncIssueRow => ({
    id: issue.id,
    scope: issue.scope,
    kind: issue.kind,
    requestId: issue.requestId,
    provisionalNumber: issue.provisionalNumber,
    serverInvoiceNumber: issue.serverInvoiceNumber,
    serverId: issue.serverId,
    customerName: issue.customerName,
    customerId: issue.customerId ?? null,
    supplierId: issue.supplierId ?? null,
    purchaseId: issue.purchaseId ?? null,
    total: issue.total,
    reason: issue.reason,
    payloadJson: issue.payload ? JSON.stringify(issue.payload) : null,
    status: issue.status,
    syncError: issue.syncError,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  });
  const fromRow = (row: SyncIssueRow): SyncIssue => ({
    id: row.id,
    scope: row.scope,
    kind: row.kind as SyncIssue["kind"],
    requestId: row.requestId,
    provisionalNumber: row.provisionalNumber,
    serverInvoiceNumber: row.serverInvoiceNumber,
    serverId: row.serverId,
    customerName: row.customerName,
    customerId: row.customerId,
    supplierId: row.supplierId,
    purchaseId: row.purchaseId,
    total: row.total,
    reason: row.reason,
    payload: row.payloadJson ? (JSON.parse(row.payloadJson) as AtomicSaleInput) : null,
    status: row.status as SyncIssue["status"],
    syncError: row.syncError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return {
    list: async (scope: string) => (rows.get(scope) ?? []).map((row) => row),
    upsert: async (issue: SyncIssueRow) => {
      const list = rows.get(issue.scope) ?? [];
      const match = list.findIndex(
        (item) =>
          item.status === "open" &&
          ((issue.requestId != null && item.requestId === issue.requestId) ||
            (issue.requestId == null && issue.serverId != null && item.serverId === issue.serverId)),
      );
      if (match >= 0) {
        const kept = { ...issue, id: list[match].id, createdAt: list[match].createdAt, updatedAt: new Date().toISOString() };
        list[match] = kept;
        return kept;
      }
      list.push(issue);
      rows.set(issue.scope, list);
      return issue;
    },
    setStatus: async (scope: string, id: string, status: string) => {
      const found = (rows.get(scope) ?? []).find((item) => item.id === id);
      if (found) {
        found.status = status;
        found.updatedAt = new Date().toISOString();
      }
    },
    update: async (scope: string, id: string, patch: { reason?: string; syncError?: string | null }) => {
      const found = (rows.get(scope) ?? []).find((item) => item.id === id);
      if (!found) return;
      if (patch.reason !== undefined) found.reason = patch.reason;
      if (patch.syncError !== undefined) found.syncError = patch.syncError;
      found.updatedAt = new Date().toISOString();
    },
    toRow,
    fromRow,
  };
}

type RpcResult = { data: AtomicSaleResult | null; error: { code?: string; message?: string } | null };
type StatusResult = { status: "unknown" | "confirmed"; result?: AtomicSaleResult };

function fakeClient(behavior: {
  onCreate?: (requestId: string, input: AtomicSaleInput) => RpcResult | Promise<RpcResult>;
  onStatus?: (requestId: string) => { data: StatusResult | null; error: { message?: string } | null } | Promise<{ data: StatusResult | null; error: { message?: string } | null }>;
  onUpdate?: (values: Record<string, unknown>, id: string) => { error: { code?: string; message?: string } | null };
  customerName?: string | null;
  calls?: { create: string[]; update: Array<{ values: Record<string, unknown>; id: string }> };
}): SupabaseClient {
  const calls = behavior.calls ?? { create: [], update: [] };
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "create_sales_invoice_atomic") {
        calls.create.push(String(args.p_request_id));
        if (behavior.onCreate) return behavior.onCreate(String(args.p_request_id), args.p_input as AtomicSaleInput);
        return {
          data: { transaction: { id: "sale-confirmed", invoice_number: "S-100001" }, customer_name: "Cash Customer", items: [], replayed: false },
          error: null,
        };
      }
      if (name === "get_sales_invoice_request_status") {
        if (behavior.onStatus) return behavior.onStatus(String(args.p_request_id));
        return { data: { status: "unknown" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => {
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: behavior.customerName ? { customer_name: behavior.customerName } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "sales_transactions") {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              calls.update.push({ values, id });
              return { data: null, error: behavior.onUpdate ? behavior.onUpdate(values, id).error : null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function installDesktopWindow() {
  process.env.NEXT_PUBLIC_DESKTOP = "1";
  const salesBridge = memorySalesBridge();
  const issuesBridge = memoryIssuesBridge();
  const { win, values } = stubWindow({
    aankhDesktop: { isDesktop: true, localSales: salesBridge, syncIssues: issuesBridge },
  });
  installWindow(win);
  return { values, salesBridge, issuesBridge };
}

async function seedQueue(input: AtomicSaleInput = SALE_INPUT) {
  const queue = await getSaleQueueBackend().replace(SCOPE, [{ requestId: crypto.randomUUID(), input }]);
  return queue[0];
}

function issueRow(overrides: Partial<SyncIssueRow> = {}): SyncIssueRow {
  const now = new Date().toISOString();
  // Slice S5 — customerId is required on the row; an override that
  // omits it (or sets undefined) reads as null, never undefined.
  // Slice S6 — same for supplierId and purchaseId.
  const { customerId, supplierId, purchaseId, ...rest } = overrides;
  return {
    id: crypto.randomUUID(),
    scope: SCOPE,
    kind: "stock-conflict",
    requestId: "req-1",
    provisionalNumber: "L-000001",
    serverInvoiceNumber: null,
    serverId: null,
    customerName: "Cash Customer",
    customerId: customerId ?? null,
    supplierId: supplierId ?? null,
    purchaseId: purchaseId ?? null,
    total: 10,
    reason: "Insufficient stock, including bonus units, for product p1",
    payloadJson: JSON.stringify(SALE_INPUT),
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

async function testIssueStoreSqlite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "aankh-s3-test-"));
  try {
    const dbPath = join(dir, "aankh.db");
    const store = createLocalStore(dbPath);
    assert.deepEqual(store.listIssues(SCOPE), [], "no issues at first");
    const stored = store.upsertIssue(issueRow());
    assert.equal(stored.kind, "stock-conflict", "the parked issue round-trips");
    assert.deepEqual(
      store.listIssues(SCOPE).map((row) => row.requestId),
      ["req-1"],
      "list returns the issue",
    );
    // A re-park of the same sale updates the open row instead of duplicating it.
    const again = store.upsertIssue(issueRow({ reason: "Insufficient stock, including bonus units, for product p2" }));
    assert.equal(again.id, stored.id, "a re-park keeps the same row id");
    assert.equal(again.reason, "Insufficient stock, including bonus units, for product p2", "a re-park refreshes the reason");
    assert.equal(store.listIssues(SCOPE).length, 1, "a re-park never duplicates the issue");
    assert.throws(
      () => store.upsertIssue(issueRow({ kind: "not-a-kind" })),
      /Invalid sync issue/,
      "an unknown kind is refused",
    );
    assert.throws(
      () => store.setIssueStatus(SCOPE, stored.id, "gone"),
      /Invalid sync issue status/,
      "an unknown status is refused",
    );
    store.setIssueStatus(SCOPE, stored.id, "resolved");
    assert.deepEqual(store.listIssues(SCOPE).map((row) => row.status), ["resolved"], "resolve marks the row");
    assert.equal(store.listIssues(SCOPE).length, 1, "a resolved row is kept, never deleted");
    // A later problem with the same sale is a NEW issue, not a resurrection.
    const fresh = store.upsertIssue(issueRow({ reason: "Customer credit limit exceeded" }));
    assert.notEqual(fresh.id, stored.id, "a new problem after resolve is a new row");
    assert.equal(store.listIssues(SCOPE).length, 2, "both rows are kept");
    store.updateIssue(SCOPE, fresh.id, { syncError: "link failed" });
    assert.equal(
      store.listIssues(SCOPE).find((row) => row.id === fresh.id)?.syncError,
      "link failed",
      "the error text updates",
    );
    store.close();
    const reopened = createLocalStore(dbPath);
    assert.equal(reopened.listIssues(SCOPE).length, 2, "issues survive close + reopen");
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testClassifySaleRejection(): Promise<void> {
  assert.equal(
    classifySaleRejection("Insufficient stock, including bonus units, for product abc"),
    "stock-conflict",
    "the current trigger wording is a stock conflict",
  );
  assert.equal(
    classifySaleRejection("Sale cannot be saved: overselling is blocked for product abc (available: 0, attempted sale: 1)."),
    "stock-conflict",
    "the older trigger wording is a stock conflict too",
  );
  assert.equal(
    classifySaleRejection("Request id was already used for different sale contents"),
    "fingerprint-mismatch",
    "same key + different payload is a fingerprint mismatch",
  );
  assert.equal(classifySaleRejection("Customer credit limit exceeded"), "rejected", "anything else is a plain rejection");
  const fingerprint: SyncIssue = {
    id: "i-1", scope: SCOPE, kind: "fingerprint-mismatch", requestId: "req-1",
    provisionalNumber: null, serverInvoiceNumber: null, serverId: null, customerName: null, customerId: null,
    supplierId: null, purchaseId: null,
    total: null, reason: "x", payload: SALE_INPUT, status: "open", syncError: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  assert.equal(syncIssueCanRetry(fingerprint), false, "a fingerprint mismatch has no retry");
  assert.equal(syncIssueCanRetry({ ...fingerprint, kind: "stock-conflict" }), true, "a stock conflict can retry");
  assert.equal(
    syncIssueCanRetry({ ...fingerprint, kind: "stock-conflict", payload: null }),
    false,
    "a row without a payload cannot retry",
  );
}

async function testStockConflictParksAndDrainContinues(): Promise<void> {
  installDesktopWindow();
  try {
    await getSaleQueueBackend().replace(SCOPE, [
      { requestId: crypto.randomUUID(), input: SALE_INPUT },
      { requestId: crypto.randomUUID(), input: SALE_INPUT_2 },
    ]);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    const client = fakeClient({
      calls,
      customerName: "Cash Customer",
      onCreate: () => {
        if (calls.create.length === 1) {
          // The first sale hits the stock trigger: the second PC already
          // sold the last unit and the policy is `block`.
          return { data: null, error: { code: "P0001", message: "Insufficient stock, including bonus units, for product product-1" } };
        }
        return {
          data: { transaction: { id: "sale-2", invoice_number: "S-100002" }, customer_name: "Second", items: [], replayed: false },
          error: null,
        };
      },
    });
    const drained = await drainPendingSalesQueue(client, SCOPE);
    assert.equal(drained.confirmedCount, 1, "the second sale still confirms");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the queue drains fully — a parked head does not block it");
    const issues = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(issues.length, 1, "exactly one issue is parked");
    const issue = issues[0];
    assert.equal(issue.kind, "stock-conflict", "the refusal is classified as a stock conflict");
    assert.equal(issue.provisionalNumber, "L-000001", "the provisional number is kept on the issue");
    assert.equal(issue.customerName, "Cash Customer", "the customer name is looked up for the issue");
    assert.equal(issue.total, 10, "the sale total is computed for the issue");
    assert.deepEqual(issue.payload, SALE_INPUT, "the full payload is kept for a later retry");
    assert.equal(issue.status, "open", "the issue is open");
    assert.equal(openSyncIssues(issues).length, 1, "the open list shows it");
    assert.equal(calls.create.length, 2, "both sales were submitted once each");
  } finally {
    restoreGlobals();
  }
}

async function testStockConflictRetryConfirms(): Promise<void> {
  installDesktopWindow();
  try {
    await seedQueue(SALE_INPUT);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    let allowSync = false;
    const client = fakeClient({
      calls,
      customerName: "Cash Customer",
      onCreate: () => {
        if (!allowSync) {
          return { data: null, error: { code: "P0001", message: "Insufficient stock, including bonus units, for product product-1" } };
        }
        return {
          data: { transaction: { id: "sale-1", invoice_number: "S-100001" }, customer_name: "Cash Customer", items: [], replayed: false },
          error: null,
        };
      },
    });
    await drainPendingSalesQueue(client, SCOPE);
    const parked = (await getSyncIssuesBackend().list(SCOPE))[0];
    assert.equal(parked.kind, "stock-conflict", "the sale parks first");
    // The owner fixes the stock (a purchase lands), then retries.
    allowSync = true;
    const outcome = await retrySyncIssue(client, SCOPE, parked.id);
    assert.equal(outcome.confirmed, true, "the retry confirms once the stock is fixed");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the queue is empty after the retry");
    const after = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(after[0].status, "resolved", "the confirmed retry resolves the issue");
    assert.equal(calls.create.length, 2, "the same key was submitted twice in total, never a duplicate invoice");
    assert.deepEqual(
      calls.update,
      [{ values: { provisional_receipt_number: "L-000001" }, id: "sale-1" }],
      "the provisional number is linked to the confirmed cloud row",
    );
  } finally {
    restoreGlobals();
  }
}

async function testFingerprintMismatchRefusesRetry(): Promise<void> {
  installDesktopWindow();
  try {
    await seedQueue(SALE_INPUT);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    const client = fakeClient({
      calls,
      onCreate: () => ({
        data: null,
        error: { code: "22023", message: "Request id was already used for different sale contents" },
      }),
    });
    await drainPendingSalesQueue(client, SCOPE);
    const parked = (await getSyncIssuesBackend().list(SCOPE))[0];
    assert.equal(parked.kind, "fingerprint-mismatch", "the mismatch is classified");
    const outcome = await retrySyncIssue(client, SCOPE, parked.id);
    assert.equal(outcome.confirmed, false, "the mismatch does not confirm");
    assert.equal(outcome.notRetryable, true, "the mismatch is refused without submitting");
    assert.equal(calls.create.length, 1, "no second submit was attempted");
    assert.equal((await getSyncIssuesBackend().list(SCOPE))[0].status, "open", "the issue stays open");
  } finally {
    restoreGlobals();
  }
}

async function testTimeoutThenStatusConfirmed(): Promise<void> {
  installDesktopWindow();
  try {
    await seedQueue(SALE_INPUT);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    const confirmed: AtomicSaleResult = {
      transaction: { id: "sale-1", invoice_number: "S-100001" },
      customer_name: "Cash Customer",
      items: [],
      replayed: false,
    };
    let createCount = 0;
    let statusCalls = 0;
    const client = fakeClient({
      calls,
      onCreate: () => {
        createCount += 1;
        // The response is lost (the server did save it) — the client
        // throws, then the status check finds the confirmation.
        throw new Error("simulated response timeout");
      },
      onStatus: () => {
        statusCalls += 1;
        // First check (before the submit): unknown, so the drain submits.
        // Second check (after the lost response): confirmed.
        if (statusCalls === 1) return { data: { status: "unknown" }, error: null };
        return { data: { status: "confirmed", result: confirmed }, error: null };
      },
    });
    const drained = await drainPendingSalesQueue(client, SCOPE);
    assert.equal(drained.confirmedCount, 1, "the status check confirms the sale");
    assert.equal(createCount, 1, "the sale was posted exactly once — no blind re-post");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the attempt leaves the queue");
    assert.deepEqual(
      calls.update,
      [{ values: { provisional_receipt_number: "L-000001" }, id: "sale-1" }],
      "the timed-out sale still links its provisional number",
    );
    assert.deepEqual(await getSyncIssuesBackend().list(SCOPE), [], "no issue for a reconciled sale");
  } finally {
    restoreGlobals();
  }
}

async function testProvisionalLinkMigrationMissingThenRetry(): Promise<void> {
  installDesktopWindow();
  try {
    await seedQueue(SALE_INPUT);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    let linkWorks = false;
    const client = fakeClient({
      calls,
      onUpdate: () =>
        linkWorks
          ? { error: null }
          : { error: { code: "PGRST204", message: "Could not find the 'provisional_receipt_number' column of 'sales_transactions' in the schema cache" } },
    });
    const drained = await drainPendingSalesQueue(client, SCOPE);
    assert.equal(drained.confirmedCount, 1, "the sale confirms even when the link cannot be written");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the queue drains");
    const issues = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(issues.length, 1, "the unlinked number waits as a provisional-link row");
    assert.equal(issues[0].kind, "provisional-link", "the row is a provisional link");
    assert.equal(issues[0].syncError, null, "a missing column stays silent — the migration simply has not run yet");
    assert.equal(issues[0].serverId, "sale-confirmed", "the cloud row id is kept for the retry");
    assert.equal(openSyncIssues(issues).length, 0, "the silent row does not show in the owner list");
    // UMAIR runs the migration; the next sync run links it.
    linkWorks = true;
    const linked = await retryPendingLinks(client, SCOPE);
    assert.equal(linked, 1, "the retry links the number");
    const after = await getSyncIssuesBackend().list(SCOPE);
    assert.equal(after[0].status, "resolved", "the link resolves its row");
    assert.equal(openSyncIssues(after).length, 0, "nothing open remains");
  } finally {
    restoreGlobals();
  }
}

async function testSerializationNoOverlap(): Promise<void> {
  installDesktopWindow();
  try {
    await getSaleQueueBackend().replace(SCOPE, [
      { requestId: crypto.randomUUID(), input: SALE_INPUT },
      { requestId: crypto.randomUUID(), input: SALE_INPUT_2 },
    ]);
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    let inFlight = 0;
    let maxInFlight = 0;
    const client = fakeClient({
      calls,
      onCreate: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(20);
        inFlight -= 1;
        return {
          data: { transaction: { id: `sale-${calls.create.length}`, invoice_number: `S-10000${calls.create.length}` }, customer_name: "C", items: [], replayed: false },
          error: null,
        };
      },
    });
    const [first, second] = await Promise.all([
      drainPendingSalesQueue(client, SCOPE),
      drainPendingSalesQueue(client, SCOPE),
    ]);
    assert.equal(first.confirmedCount + second.confirmedCount, 2, "both sales confirm exactly once across the two drains");
    assert.equal(calls.create.length, 2, "each sale was submitted exactly once");
    assert.equal(maxInFlight, 1, "two drains never overlap a submit");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the queue is empty");
  } finally {
    restoreGlobals();
  }
}

async function testEngineTriggers(): Promise<void> {
  installDesktopWindow();
  try {
    const calls = { create: [] as string[], update: [] as Array<{ values: Record<string, unknown>; id: string }> };
    const client = fakeClient({ calls });
    await seedQueue(SALE_INPUT);
    const engine = startSilentSyncEngine({
      supabase: client,
      getScope: () => SCOPE,
      timers: { intervalMs: 60, debounceMs: 10 },
    });
    try {
      await sleep(150);
      assert.equal(calls.create.length, 1, "the launch run drains the queued sale");
      // A sale saved while the app runs: the debounced run picks it up.
      await seedQueue(SALE_INPUT_2);
      const dispatch = (type: string) =>
        (globalThis.window as unknown as { dispatchEvent: (event: { type: string }) => boolean }).dispatchEvent({ type });
      dispatch(QUEUE_CHANGED_EVENT);
      await sleep(150);
      assert.equal(calls.create.length, 2, "the debounced after-save run drains the new sale");
      // The timer keeps running while online, but an empty queue submits nothing.
      await sleep(150);
      assert.equal(calls.create.length, 2, "timer runs on an empty queue submit nothing");
      engine.stop();
      await seedQueue(SALE_INPUT);
      dispatch("online");
      dispatch(QUEUE_CHANGED_EVENT);
      await sleep(150);
      assert.equal(calls.create.length, 2, "after stop, no trigger drains again");
    } finally {
      engine.stop();
    }
  } finally {
    restoreGlobals();
  }
}

async function testSyncIssuesPersistLocalStorage(): Promise<void> {
  const { win, values } = stubWindow({});
  installWindow(win);
  try {
    const backend = new LocalStorageSyncIssuesBackend();
    const issue: SyncIssue = {
      id: "issue-1", scope: SCOPE, kind: "rejected", requestId: "req-1",
      provisionalNumber: "L-000001", serverInvoiceNumber: null, serverId: null,
      customerName: "Cash Customer", customerId: null, supplierId: null, purchaseId: null, total: 10, reason: "Customer credit limit exceeded",
      payload: SALE_INPUT, status: "open", syncError: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await backend.upsert(SCOPE, issue);
    assert.equal((await backend.list(SCOPE)).length, 1, "the issue persists in localStorage");
    const again = await backend.upsert(SCOPE, { ...issue, reason: "Customer credit limit exceeded (retry)" });
    assert.equal(again.id, "issue-1", "an upsert of the same sale keeps the row");
    assert.equal((await backend.list(SCOPE)).length, 1, "an upsert never duplicates");
    assert.equal(values.size, 1, "one storage key holds the list");
    await backend.setStatus(SCOPE, "issue-1", "discarded");
    const rows = await backend.list(SCOPE);
    assert.equal(rows.length, 1, "a discarded row is kept, never deleted");
    assert.equal(rows[0].status, "discarded", "discard is a status");
    assert.equal(openSyncIssues(rows).length, 0, "the open list hides it");
  } finally {
    restoreGlobals();
  }
}

async function testWebRejectionUnchanged(): Promise<void> {
  // No desktop flag, no bridge: the web build keeps drop + notice.
  const { win, values } = stubWindow({});
  installWindow(win);
  try {
    const client = fakeClient({
      onCreate: () => ({
        data: null,
        error: { code: "22023", message: "Cash received is less than the sale total" },
      }),
    });
    let thrown: unknown;
    try {
      await createAtomicSale(client, SCOPE, SALE_INPUT);
    } catch (caught) {
      thrown = caught;
    }
    assert.ok(thrown instanceof Error, "a server rejection throws on web");
    assert.match(thrown.message, /Cash received is less than the sale total/, "the real reason surfaces");
    assert.deepEqual(await readPendingSalesQueue(SCOPE), [], "the rejected attempt is dropped from the queue, as before");
    assert.equal(
      JSON.parse(values.get(`tradeos:queue-notices:v1:${SCOPE}`) ?? "[]").length,
      1,
      "the refusal is recorded as a queue notice, as before",
    );
    assert.deepEqual(await getSyncIssuesBackend().list(SCOPE), [], "no Sync issue is written on the web build");
  } finally {
    restoreGlobals();
  }
}

async function main(): Promise<void> {
  await testIssueStoreSqlite();
  await testClassifySaleRejection();
  await testStockConflictParksAndDrainContinues();
  await testStockConflictRetryConfirms();
  await testFingerprintMismatchRefusesRetry();
  await testTimeoutThenStatusConfirmed();
  await testProvisionalLinkMigrationMissingThenRetry();
  await testSerializationNoOverlap();
  await testEngineTriggers();
  await testSyncIssuesPersistLocalStorage();
  await testWebRejectionUnchanged();
  console.log("test-silent-sync: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
