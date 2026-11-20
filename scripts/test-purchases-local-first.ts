import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../src/lib/supabase/client";
import {
  getLocalPurchasesBackend,
  newLocalPurchaseRow,
  type LocalPurchaseRow,
} from "../src/lib/offline/local-purchases";
import { drainPendingPurchases } from "../src/lib/offline/purchase-sync";
import { startSilentSyncEngine } from "../src/lib/offline/sync-engine";
import { LOCAL_PURCHASES_CHANGED_EVENT } from "../src/lib/offline/local-purchases";
import { createPurchase, shouldParkPurchaseSaveError } from "../src/lib/purchases/client";
import { loadHistoryMirror } from "../src/lib/offline/history-mirror";

// Slice 4 — purchases local-first (HYBRID, B1 fix).
//
// The desktop build has no service key, so `POST /api/purchases` on the
// local standalone server 500s every online save and every sync drain:
// the purchase is lost on save (only network errors parked locally)
// and every queued row stays queued forever. This test proves the fix,
// all mocked, no network:
//  - on desktop the drain AND the online save post to the Vercel
//    endpoint (purchaseCloudFetch, Bearer token), never the local server;
//  - the web build keeps the relative authorizedFetch exactly as before;
//  - a cloud 500 leaves the row queued (never lost); the online save
//    parks a 500 locally with the SAME request key, and a retry with
//    that key confirms exactly once;
//  - a pre-existing queued row (queued before the fix) re-drives;
//  - the silent sync engine drains a purchase-only queue when a
//    purchase is saved (LOCAL_PURCHASES_CHANGED_EVENT trigger).
// The server side of the dedup (unique index on
// (organization_id, request_key) + replay in create_purchase_atomic)
// is phase-10 SQL, already covered by test-purchase-atomicity.

const SCOPE = "org-1:profile-1";
const CLOUD_URL = "https://business-helper-ten.vercel.app/api/purchases";

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
  return { win, values };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;
const originalGetSession = supabase.auth.getSession.bind(supabase.auth);

function installWindow(win: Record<string, unknown>): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
}

function restoreGlobals(): void {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  globalThis.fetch = originalFetch;
  supabase.auth.getSession = originalGetSession;
}

/** Fake a signed-in session so the Bearer token is attached (same singleton the helpers read). */
function installFakeSession(): void {
  supabase.auth.getSession = (async () => ({
    data: { session: { access_token: "tok-test" } },
    error: null,
  })) as unknown as typeof supabase.auth.getSession;
}

/** In-memory mirror bridge, so confirmed purchases land in the history mirror. */
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

function stubDesktopWindow() {
  const { win } = stubWindow({ aankhDesktop: { isDesktop: true, mirror: stubMirrorBridge() } });
  installWindow(win);
}

function purchaseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplier_id: "00000000-0000-4000-8000-000000000010",
    supplier_invoice_number: null,
    purchase_date: "2026-11-20",
    payment_type: "cash",
    lines: [{ product_id: 1, quantity: 2, purchase_price: 10, selling_price: 12, unit_mode: "main", batch_number: null, expiry_date: null }],
    ...overrides,
  };
}

function purchaseRow(id: string, overrides: Partial<LocalPurchaseRow> = {}): LocalPurchaseRow {
  return { ...newLocalPurchaseRow(purchaseInput(), id), ...overrides };
}

function serverTx(id: string, requestKey: string) {
  return {
    id,
    supplier_id: "00000000-0000-4000-8000-000000000010",
    invoice_number: "P-50100",
    created_at: "2026-11-20T10:00:00.000Z",
    purchase_date: "2026-11-20",
    expense_review_status: "pending",
    expense_reviewed_at: null,
    total_amount: 20,
    request_key: requestKey,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function installFetchStub(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
    const call: FetchCall = {
      url: String(input),
      headers: headerRecord,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function unknownStatusSupabase(): SupabaseClient {
  return {
    rpc: async () => ({ data: { status: "unknown" }, error: null }),
  } as unknown as SupabaseClient;
}

async function main(): Promise<void> {
  // 1. Desktop drain (no fetchImpl — the real default) posts to the
  //    Vercel endpoint with the Bearer token, carrying the row id as
  //    the request key — never the local server.
  {
    stubDesktopWindow();
    installFakeSession();
    try {
      const backend = getLocalPurchasesBackend();
      const row = purchaseRow("key-local-first-1", { provisionalNumber: "LP-000130" });
      await backend.upsert(SCOPE, row);
      const tx = serverTx("tx-server-1", "key-local-first-1");
      const calls = installFetchStub(() => jsonResponse(200, { transaction: tx, items: [] }));
      const drained = await drainPendingPurchases(unknownStatusSupabase(), SCOPE);
      assert.equal(drained.confirmedCount, 1, "one purchase confirms");
      assert.equal(calls.length, 1, "one POST for one purchase");
      assert.equal(calls[0].url, CLOUD_URL, "the desktop drain posts to the Vercel endpoint, never the local server");
      assert.equal(calls[0].headers.authorization, "Bearer tok-test", "the drain carries the user Bearer token");
      assert.equal(calls[0].body.request_key, "key-local-first-1", "the POST carries the local row id as the request key");
      assert.deepEqual(await backend.list(SCOPE), [], "the confirmed row is removed");
      const mirror = await loadHistoryMirror<Record<string, unknown>>("purchase_transaction", SCOPE);
      assert.equal(mirror.rows.length, 1, "the confirmed purchase lands in the history mirror");
    } finally {
      restoreGlobals();
    }
  }

  // 2. Web build: the same drain keeps the relative URL (web behaviour unchanged).
  {
    const { win } = stubWindow({});
    installWindow(win);
    installFakeSession();
    try {
      const backend = getLocalPurchasesBackend();
      const row = purchaseRow("key-local-first-2", { provisionalNumber: "LP-000131" });
      await backend.upsert(SCOPE, row);
      const tx = serverTx("tx-server-2", "key-local-first-2");
      const calls = installFetchStub(() => jsonResponse(200, { transaction: tx, items: [] }));
      const drained = await drainPendingPurchases(unknownStatusSupabase(), SCOPE);
      assert.equal(drained.confirmedCount, 1, "one purchase confirms on web");
      assert.equal(calls.length, 1, "one POST for one purchase on web");
      assert.equal(calls[0].url, "/api/purchases", "the web drain keeps the relative URL");
      assert.equal(calls[0].headers.authorization, "Bearer tok-test", "the web drain still carries the Bearer token");
    } finally {
      restoreGlobals();
    }
  }

  // 3. A cloud 500 leaves the row queued — never lost, never parked as
  //    a rejection (a 500 never confirmed anything).
  {
    stubDesktopWindow();
    installFakeSession();
    try {
      const backend = getLocalPurchasesBackend();
      const row = purchaseRow("key-local-first-3", { provisionalNumber: "LP-000132" });
      await backend.upsert(SCOPE, row);
      const calls = installFetchStub(() => jsonResponse(500, { error: "Internal server error" }));
      const drained = await drainPendingPurchases(unknownStatusSupabase(), SCOPE);
      assert.equal(drained.queuedCount, 1, "the 500 row stays queued");
      assert.equal(drained.stoppedEarly, true, "the drain reports it stopped early");
      assert.equal(calls.length, 1, "one POST attempt");
      assert.equal(calls[0].url, CLOUD_URL, "the 500 came from the cloud endpoint");
      const kept = await backend.list(SCOPE);
      assert.equal(kept.length, 1, "the row is kept locally");
      assert.equal(kept[0].syncStatus, "pending", "the row stays pending for the next trigger");
    } finally {
      restoreGlobals();
    }
  }

  // 4. Online save (createPurchase) on desktop: cloud URL + Bearer +
  //    request key; a 500 throws with the status and the key it used,
  //    and the park decision is true for 500/network, false for 4xx —
  //    and false for everything on the web build.
  {
    stubDesktopWindow();
    installFakeSession();
    try {
      const tx = serverTx("tx-server-4", "key-will-be-set-below");
      const calls = installFetchStub(() => jsonResponse(200, { transaction: tx, items: [] }));
      const result = await createPurchase(purchaseInput());
      assert.equal(result.transaction.id, "tx-server-4", "the online save returns the transaction");
      assert.equal(calls.length, 1, "one POST for the online save");
      assert.equal(calls[0].url, CLOUD_URL, "the online save posts to the Vercel endpoint");
      assert.equal(calls[0].headers.authorization, "Bearer tok-test", "the online save carries the Bearer token");
      const usedKey = calls[0].body.request_key as string;
      assert.equal(typeof usedKey, "string", "the online save allocates a request key");
      assert.ok(usedKey.length > 0, "the request key is non-empty");

      installFetchStub(() => jsonResponse(500, { error: "Internal server error" }));
      let thrown: unknown;
      try {
        await createPurchase(purchaseInput({ supplier_invoice_number: "INV-500" }));
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof Error, "a 500 throws");
      assert.equal((thrown as { status?: number }).status, 500, "the 500 error carries its status");
      assert.equal(typeof (thrown as { requestKey?: string }).requestKey, "string", "the 500 error carries the request key it used");
      assert.equal(shouldParkPurchaseSaveError(thrown), true, "a server 500 parks locally on desktop");

      installFetchStub(() => jsonResponse(400, { error: "Supplier not found" }));
      let refused: unknown;
      try {
        await createPurchase(purchaseInput({ supplier_invoice_number: "INV-400" }));
      } catch (error) {
        refused = error;
      }
      assert.equal((refused as { status?: number }).status, 400, "a 400 carries its status");
      assert.equal(shouldParkPurchaseSaveError(refused), false, "a definitive 400 refusal never parks");

      installFetchStub(() => {
        throw new TypeError("fetch failed");
      });
      const networkError = new TypeError("fetch failed");
      assert.equal(shouldParkPurchaseSaveError(networkError), true, "a network failure parks locally on desktop");
    } finally {
      restoreGlobals();
    }
  }
  {
    // Web build: nothing parks, even a 500 (the web flow keeps its live error).
    const { win } = stubWindow({});
    installWindow(win);
    try {
      const fiveHundred = new Error("boom") as Error & { status?: number };
      fiveHundred.status = 500;
      assert.equal(shouldParkPurchaseSaveError(fiveHundred), false, "a 500 never parks on the web build");
      assert.equal(shouldParkPurchaseSaveError(new TypeError("fetch failed")), false, "a network failure never parks on the web build");
    } finally {
      restoreGlobals();
    }
  }

  // 5. A pre-existing queued row (queued before the fix, old key, old
  //    timestamp) re-drives through the default desktop drain and
  //    confirms with its ORIGINAL key — exactly once.
  {
    stubDesktopWindow();
    installFakeSession();
    try {
      const backend = getLocalPurchasesBackend();
      const old = new Date("2026-11-18T09:00:00.000Z").toISOString();
      const row = purchaseRow("pre-fix-key-1", { provisionalNumber: "LP-000100", createdAt: old, updatedAt: old });
      await backend.upsert(SCOPE, row);
      const rpcKeys: string[] = [];
      const supabase = {
        rpc: async (_fn: string, args: Record<string, unknown>) => {
          rpcKeys.push(String(args.p_request_key));
          return { data: { status: "unknown" }, error: null };
        },
      } as unknown as SupabaseClient;
      const tx = serverTx("tx-server-5", "pre-fix-key-1");
      const calls = installFetchStub(() => jsonResponse(200, { transaction: tx, items: [] }));
      const drained = await drainPendingPurchases(supabase, SCOPE);
      assert.equal(drained.confirmedCount, 1, "the pre-existing queued row confirms after the fix");
      assert.deepEqual(rpcKeys, ["pre-fix-key-1"], "the status check runs first with the original key");
      assert.equal(calls.length, 1, "exactly one POST for the pre-existing row");
      assert.equal(calls[0].body.request_key, "pre-fix-key-1", "the re-drive reuses the ORIGINAL key");
      assert.deepEqual(await backend.list(SCOPE), [], "the re-driven row is removed");
    } finally {
      restoreGlobals();
    }
  }

  // 6. The silent sync engine drains a purchase-only queue when a
  //    purchase is saved (LOCAL_PURCHASES_CHANGED_EVENT trigger).
  {
    stubDesktopWindow();
    installFakeSession();
    const engineSupabase = unknownStatusSupabase();
    try {
      const tx = serverTx("tx-server-6", "key-engine-1");
      const calls = installFetchStub(() => jsonResponse(200, { transaction: tx, items: [] }));
      const engine = startSilentSyncEngine({
        supabase: engineSupabase,
        getScope: () => SCOPE,
        timers: { intervalMs: 60_000, debounceMs: 10 },
      });
      try {
        await sleep(150);
        assert.equal(calls.length, 0, "the launch run posts nothing with an empty queue");
        const backend = getLocalPurchasesBackend();
        await backend.upsert(SCOPE, purchaseRow("key-engine-1", { provisionalNumber: "LP-000133" }));
        (globalThis.window as unknown as { dispatchEvent: (event: { type: string }) => boolean }).dispatchEvent({
          type: LOCAL_PURCHASES_CHANGED_EVENT,
        });
        await sleep(250);
        assert.equal(calls.length, 1, "the purchase-saved trigger drains the queue");
        assert.equal(calls[0].url, CLOUD_URL, "the triggered drain posts to the cloud endpoint");
        assert.equal(calls[0].body.request_key, "key-engine-1", "the triggered drain carries the row key");
        assert.deepEqual(await backend.list(SCOPE), [], "the triggered drain removes the confirmed row");
      } finally {
        engine.stop();
      }
    } finally {
      restoreGlobals();
    }
  }

  // 7. Static checks: the online-save path parks on 500 with the same
  //    key; the route answers the desktop preflight; the sync never
  //    touches the service-role key or the create RPC directly.
  {
    const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.match(page, /shouldParkPurchaseSaveError\(caught\)/, "page.tsx parks the online save via shouldParkPurchaseSaveError");
    assert.match(page, /savePurchaseLocally\(requestKey\)/, "page.tsx parks with the request key the failed attempt used");
    const route = readFileSync(join(process.cwd(), "src/app/api/purchases/route.ts"), "utf8");
    assert.match(route, /desktopPreflightResponse/, "the purchases route answers the desktop preflight");
    assert.match(route, /applyCors\(/, "the purchases route applies loopback-only CORS");
    assert.match(route, /requirePermission/, "the purchases route verifies the Bearer token itself");
    const sync = readFileSync(join(process.cwd(), "src/lib/offline/purchase-sync.ts"), "utf8");
    assert.match(sync, /purchaseCloudFetch/, "the purchase sync submits through the cloud-endpoint helper on desktop");
    assert.doesNotMatch(sync, /create_purchase_atomic\s*\(/, "the purchase sync never invokes the create RPC");
    assert.doesNotMatch(sync, /createSupabaseService|SUPABASE_SERVICE_ROLE_KEY|service_role/, "the purchase sync never touches the service-role key");
    const client = readFileSync(join(process.cwd(), "src/lib/purchases/client.ts"), "utf8");
    assert.doesNotMatch(client, /createSupabaseService|SUPABASE_SERVICE_ROLE_KEY|service_role/, "the online save never touches the service-role key");
    // No ad-hoc supplier-balance write anywhere in the new path: the
    // only balance change is the ledger triggers behind the RPC.
    for (const file of ["src/lib/offline/purchase-sync.ts", "src/lib/purchases/client.ts", "src/lib/desktop/cloud-endpoint.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.doesNotMatch(source, /outstanding_balance/, `no supplier-balance write in ${file}`);
    }
  }

  // 8. A parked row keeps the request key it was given (same-key replay).
  {
    const row = newLocalPurchaseRow(purchaseInput(), "key-parked-1");
    assert.equal(row.id, "key-parked-1", "a supplied id becomes the row id (the request key)");
    assert.equal(row.syncStatus, "pending", "the parked row starts pending");
  }

  console.log("Slice 4 purchases local-first passed: desktop cloud submit, web unchanged, 500 parks with the same key, pre-existing rows re-drive, engine trigger");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
