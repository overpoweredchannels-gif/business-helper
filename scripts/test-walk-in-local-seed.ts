import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureWalkInCustomerSeed,
  isWalkInSeedRow,
  mergeLocalCustomersWithWalkInSeed,
  newWalkInCustomerSeedRow,
  walkInCustomerIdForOrganization,
  walkInCustomerRecord,
  WALK_IN_CUSTOMER_FIELDS,
} from "../src/lib/offline/walk-in-customer";
import {
  getLocalCustomersBackend,
  newLocalCustomerCreateRow,
  type LocalCustomerRow,
} from "../src/lib/offline/local-customers";
import {
  drainPendingCustomers,
  type CustomerServer,
} from "../src/lib/offline/customer-sync";
import { createAtomicSale, readPendingSalesQueue } from "../src/lib/sales/atomic-sale-client";
import type { Customer } from "../src/lib/tradeos/types";

// Slice 5 — Walk-in customer LOCAL seed (HYBRID, B7 fix).
//
// The desktop build has no service key, so `POST /api/sales/walk-in`
// on the local standalone server 500s and a POS quick sale cannot
// start without a manual customer pick. The desktop now stops calling
// that route: it upserts the deterministic Walk-in row locally (same
// row identity as the server path) and selects it with zero network
// calls. This test proves, all mocked, no network:
//  - the local id is byte-identical to the server route's
//    SHA-256(`tradeos:walk-in:${orgId}`) UUID, and the seed record
//    carries exactly the route's upsert fields;
//  - the seed upserts once per scope (orgId:profileId), never
//    duplicates, and is invisible under any other scope;
//  - the customer-list merge treats the seed as a FALLBACK: a server
//    Walk-in row (active or inactive) wins, a local edit wins, and
//    the seed is appended only when the id is otherwise absent;
//  - the customer-sync drain never creates a second Walk-in row: when
//    the server row already exists it reconciles with ZERO customer
//    writes; when it is missing it creates exactly the route's row
//    (same id, same fields) via the normal create — and only then can
//    a Walk-in sale sync, because the sale RPC raises "Customer is
//    unavailable in this organization" for a missing customer;
//  - a Walk-in sale saved offline queues in the EXISTING sale queue
//    (no second queue) with the seed id, and a named-customer sale
//    still queues normally behind it;
//  - page.tsx calls the route only on the web build (one call site,
//    in the non-desktop branch); the manifest no longer carries the
//    slice-5 pending marker and the desktop never calls the route.

const SCOPE = "org-1:profile-1";
const ORG_ID = "org-1";

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

/** Minimal window: localStorage + a working event emitter. */
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
}

/** The server route's id derivation, as the node:crypto oracle. */
function serverWalkInId(organizationId: string): string {
  const hash = createHash("sha256").update(`tradeos:walk-in:${organizationId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const UUID_V5_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

function customerRow(overrides: Partial<Customer> & { id: string }): Customer {
  return {
    customer_name: "Customer",
    shop_name: null,
    phone: null,
    whatsapp: null,
    city: null,
    area: null,
    customer_type: "Retailer",
    credit_policy: "cash_only",
    credit_limit: null,
    credit_days: null,
    allow_over_limit: null,
    allow_overdue_sales: null,
    preferred_payment_method: null,
    is_active: true,
    visit_frequency: "none",
    priority: "medium",
    ...overrides,
  } as Customer;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const dummySupabase = {} as unknown as SupabaseClient;

async function main(): Promise<void> {
  const { win } = stubWindow();
  installWindow(win);
  try {
    // 1. Deterministic id: byte-identical to the server route.
    for (const orgId of [ORG_ID, "00000000-0000-4000-8000-000000000001", "acme-123", "org-üñï"]) {
      const local = walkInCustomerIdForOrganization(orgId);
      assert.equal(local, serverWalkInId(orgId), `seed id matches the server route for org ${orgId}`);
      assert.match(local, UUID_V5_SHAPE, `seed id is a version-5 UUID for org ${orgId}`);
    }
    assert.notEqual(
      walkInCustomerIdForOrganization("org-1"),
      walkInCustomerIdForOrganization("org-2"),
      "different orgs get different Walk-in ids",
    );

    // 2. Seed record fields: exactly the route's upsert payload.
    const routeSrc = readFileSync(join(process.cwd(), "src/app/api/sales/walk-in/route.ts"), "utf8");
    for (const literal of [
      'customer_name: "Walk-in customer"',
      'customer_type: "Retailer"',
      'credit_policy: "cash_only"',
      "is_active: true",
      'visit_frequency: "none"',
      'priority: "medium"',
    ]) {
      assert.ok(routeSrc.includes(literal), `server route still upserts ${literal}`);
    }
    const record = walkInCustomerRecord(ORG_ID);
    assert.equal(record.id, serverWalkInId(ORG_ID), "record id is the deterministic id");
    assert.equal(record.organization_id, ORG_ID, "record is org-scoped");
    assert.equal(record.customer_name, WALK_IN_CUSTOMER_FIELDS.customer_name, "record name matches the route");
    assert.equal(record.customer_type, WALK_IN_CUSTOMER_FIELDS.customer_type, "record type matches the route");
    assert.equal(record.credit_policy, WALK_IN_CUSTOMER_FIELDS.credit_policy, "record policy matches the route");
    assert.equal(record.is_active, true, "record is active like the route row");
    assert.equal(record.visit_frequency, "none", "record frequency matches the route");
    assert.equal(record.priority, "medium", "record priority matches the route");

    // 3. Seed row: pending create, scoped, upserts once, never duplicates.
    const seed = newWalkInCustomerSeedRow(ORG_ID);
    assert.equal(seed.id, serverWalkInId(ORG_ID), "seed row id is the deterministic id");
    assert.equal(seed.kind, "create", "seed row is a create");
    assert.equal(seed.syncStatus, "pending", "seed row starts pending (drains with the customer sync)");
    assert.equal(seed.synced, 0, "seed row starts unsynced");
    assert.ok(isWalkInSeedRow(seed, ORG_ID), "seed row is recognised as the seed for its org");
    assert.ok(!isWalkInSeedRow(seed, "org-2"), "seed row is not the seed for another org");

    const backend = getLocalCustomersBackend();
    const stored = await ensureWalkInCustomerSeed(SCOPE, ORG_ID);
    assert.equal(stored.id, seed.id, "ensured seed has the deterministic id");
    const storedAgain = await ensureWalkInCustomerSeed(SCOPE, ORG_ID);
    assert.equal(storedAgain.idempotencyKey, stored.idempotencyKey, "re-ensuring keeps the same row (no duplicate)");
    assert.deepEqual(
      (await backend.list(SCOPE)).map((row) => row.id),
      [seed.id],
      "exactly one seed row in the scope",
    );
    assert.deepEqual(await backend.list("org-1:profile-2"), [], "seed is invisible under another profile scope");
    assert.deepEqual(await backend.list("org-2:profile-1"), [], "seed is invisible under another org scope");

    // 4. Merge: the seed is a fallback, never an override.
    const seedId = serverWalkInId(ORG_ID);
    const namedLocal = newLocalCustomerCreateRow({
      customer_name: "A Named Shop",
      customer_type: "Retailer",
      credit_policy: "cash_only",
    });
    await backend.upsert(SCOPE, namedLocal);
    // (a) No server Walk-in row: the seed is appended, list stays sorted.
    let merged = mergeLocalCustomersWithWalkInSeed([], await backend.list(SCOPE), ORG_ID);
    assert.deepEqual(
      merged.map((row) => row.customer_name),
      ["A Named Shop", "Walk-in customer"],
      "seed appended after named customers, sorted by name",
    );
    assert.equal(merged.find((row) => row.id === seedId)?.credit_policy, "cash_only", "appended seed carries cash_only");
    // (b) Server Walk-in row (active) wins: no duplicate, server fields kept.
    const serverActive = customerRow({ id: seedId, customer_name: "Walk-in customer", phone: "03001112222" });
    merged = mergeLocalCustomersWithWalkInSeed([serverActive], await backend.list(SCOPE), ORG_ID);
    assert.equal(merged.filter((row) => row.id === seedId).length, 1, "one Walk-in row when the server has it");
    assert.equal(merged.find((row) => row.id === seedId)?.phone, "03001112222", "server row wins over the seed");
    // (c) Server Walk-in row INACTIVE wins too: the seed must not mask it.
    const serverInactive = customerRow({ id: seedId, customer_name: "Walk-in customer", is_active: false });
    merged = mergeLocalCustomersWithWalkInSeed([serverInactive], await backend.list(SCOPE), ORG_ID);
    assert.equal(merged.find((row) => row.id === seedId)?.is_active, false, "inactive server row is not masked by the seed");
    // (d) A local EDIT of the Walk-in id wins like any other edit.
    const edited = {
      ...seed,
      kind: "edit" as const,
      data: { ...seed.data, customer_name: "Walk-in (edited)" },
      serverId: seedId,
    } satisfies LocalCustomerRow;
    const editedMerged = mergeLocalCustomersWithWalkInSeed(
      [],
      [edited, namedLocal],
      ORG_ID,
    );
    assert.equal(
      editedMerged.find((row) => row.id === seedId)?.customer_name,
      "Walk-in (edited)",
      "a local edit of the Walk-in row keeps winning",
    );
    assert.equal(editedMerged.filter((row) => row.id === seedId).length, 1, "edit + seed never duplicate the id");
    // (e) A named local create still merges normally next to the seed.
    assert.ok(editedMerged.some((row) => row.id === namedLocal.id), "named local row still merges");

    // 5. Drain: never a second Walk-in row on the server.
    // (a) Server row already exists (identical profile): ZERO customer writes.
    await backend.remove(SCOPE, namedLocal.id);
    let fetchCalls = 0;
    const serverWithSeed = new Map<string, Record<string, unknown>>([
      [seedId, { ...seed.data, updated_at: "2026-01-01T00:00:00.000Z" }],
    ]);
    const serverA: CustomerServer = { fetchById: async (id) => serverWithSeed.get(id) ?? null };
    const noWriteFetch = async (): Promise<Response> => {
      fetchCalls += 1;
      return jsonResponse(500, { ok: false });
    };
    const drainedA = await drainPendingCustomers(dummySupabase, SCOPE, { server: serverA, fetchImpl: noWriteFetch });
    assert.equal(fetchCalls, 0, "no customer write when the server row already exists");
    assert.equal(drainedA.confirmedCount, 1, "seed confirms via the existence check");
    assert.deepEqual(await backend.list(SCOPE), [], "seed removed after reconcile");

    // (b) Server row missing: exactly ONE create, with the route's row.
    await ensureWalkInCustomerSeed(SCOPE, ORG_ID);
    const created: Array<{ url: string; body: Record<string, unknown> }> = [];
    const serverB: CustomerServer = { fetchById: async () => null };
    const createFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      created.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return jsonResponse(200, { ok: true, customer: { id: seedId } });
    };
    const drainedB = await drainPendingCustomers(dummySupabase, SCOPE, { server: serverB, fetchImpl: createFetch });
    assert.equal(created.length, 1, "exactly one customer create for the missing server row");
    assert.equal(created[0].url, "/api/customers", "seed creates via the normal customer endpoint");
    assert.equal(created[0].body.id, seedId, "create uses the deterministic id (no second row possible)");
    assert.equal(created[0].body.customer_name, "Walk-in customer", "create carries the route's name");
    assert.equal(created[0].body.customer_type, "Retailer", "create carries the route's type");
    assert.equal(created[0].body.credit_policy, "cash_only", "create carries the route's policy");
    assert.equal(drainedB.confirmedCount, 1, "seed confirms after the create");
    assert.deepEqual(await backend.list(SCOPE), [], "seed removed after the create");

    // (c) A named pending customer drains normally next to the seed.
    await ensureWalkInCustomerSeed(SCOPE, ORG_ID);
    await backend.upsert(SCOPE, namedLocal);
    const serverC: CustomerServer = { fetchById: async () => null };
    const createdC: Array<Record<string, unknown>> = [];
    const createFetchC = async (_url: string, init?: RequestInit): Promise<Response> => {
      createdC.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(200, { ok: true, customer: {} });
    };
    const drainedC = await drainPendingCustomers(dummySupabase, SCOPE, { server: serverC, fetchImpl: createFetchC });
    assert.deepEqual(
      createdC.map((body) => body.id).sort(),
      [namedLocal.id, seedId].sort(),
      "named row and seed each create once, with their own ids",
    );
    assert.equal(drainedC.confirmedCount, 2, "both rows confirm");
    assert.deepEqual(await backend.list(SCOPE), [], "no pending customers left");

    // 6. Walk-in sale: queues in the EXISTING sale queue, no second queue.
    const offlineSupabase = {
      rpc: async () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    const walkInInput = {
      customer_id: seedId,
      sale_date: "2026-11-20",
      payment_type: "cash" as const,
      invoice_discount: 0,
      invoice_discount_type: "flat" as const,
      tax_rate: 0,
      cash_received: 300,
      credit_override_confirmed: false,
      lines: [{ product_id: "00000000-0000-4000-8000-000000000020", quantity: 2, selling_price: 100, discount: 0, bonus: 0, unit_mode: "main" as const }],
    };
    const saved = await createAtomicSale(offlineSupabase, SCOPE, walkInInput);
    assert.ok("queued" in saved && saved.queued, "offline Walk-in sale queues instead of failing");
    const queue = await readPendingSalesQueue(SCOPE);
    assert.equal(queue.length, 1, "one queued sale in the existing queue");
    assert.equal(queue[0].input.customer_id, seedId, "queued sale references the Walk-in seed id");
    assert.ok(queue[0].requestId, "queued sale carries its idempotency request key");
    // A named-customer sale queues behind it, unchanged behaviour.
    const namedInput = { ...walkInInput, customer_id: namedLocal.id };
    const savedNamed = await createAtomicSale(offlineSupabase, SCOPE, namedInput);
    assert.ok("queued" in savedNamed && savedNamed.queued, "offline named-customer sale still queues");
    const queue2 = await readPendingSalesQueue(SCOPE);
    assert.equal(queue2.length, 2, "both sales share the one queue, in order");
    assert.equal(queue2[1].input.customer_id, namedLocal.id, "named sale keeps its own customer id");

    // 7. Static checks: the route is called only on the web build.
    const pageSrc = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    const walkInCalls = pageSrc.match(/authorizedFetch\("\/api\/sales\/walk-in"/g) ?? [];
    assert.equal(walkInCalls.length, 1, "exactly one walk-in route call site left (web only)");
    assert.ok(pageSrc.includes("ensureWalkInCustomerSeed"), "page uses the local seed ensure");
    assert.ok(pageSrc.includes("walkInCustomerRecord"), "page uses the local seed record");
    assert.ok(pageSrc.includes("mergeLocalCustomersWithWalkInSeed"), "page merges with the seed fallback");
    const effectStart = pageSrc.indexOf("Slice 5 (HYBRID) — Walk-in preparation");
    assert.ok(effectStart >= 0, "walk-in effect carries the Slice 5 comment");
    const effectSlice = pageSrc.slice(effectStart, effectStart + 2000);
    assert.ok(effectSlice.indexOf("isDesktopApp()") < effectSlice.indexOf('"/api/sales/walk-in"'), "desktop seed branch precedes the web route call");
    assert.ok(!pageSrc.includes('fetch("/api/sales/walk-in"'), "no raw fetch of the walk-in route");
    // Sunday small fix: a Walk-in row the owner deactivated is never
    // auto-selected — the effect shows "Customer chunein" instead.
    assert.ok(effectSlice.includes("is_active === false"), "effect checks the Walk-in row's is_active");
    assert.ok(effectSlice.includes('"Customer chunein"'), "effect shows 'Customer chunein' for a deactivated Walk-in");
    assert.ok(
      effectSlice.indexOf("is_active === false") < effectSlice.indexOf("setSelectedCustomerIdForSale"),
      "deactivated check precedes the auto-select",
    );

    // 8. Manifest: the slice-5 pending marker is gone; the desktop never calls the route.
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "DESKTOP_ROUTE_CLASSIFICATION.json"), "utf8"),
    ) as { routes: Record<string, Record<string, unknown>> };
    const entry = manifest.routes["/api/sales/walk-in"];
    assert.ok(entry, "walk-in manifest entry exists");
    assert.equal(entry.classification, "LOCAL", "walk-in stays LOCAL");
    assert.equal(entry.called_from_desktop, "no", "desktop never calls the walk-in route");
    assert.equal(entry.pending, undefined, "slice-5 pending marker is gone");
    const gateSrc = readFileSync(join(process.cwd(), "scripts/check-desktop-routes.mjs"), "utf8");
    assert.ok(
      gateSrc.includes('called_from_desktop') && gateSrc.includes('startsWith("no")'),
      "gate exempts LOCAL routes the desktop never calls",
    );

    console.log(
      "Slice 5 walk-in local seed passed: deterministic id matches the server route, seed scoped + merged as a fallback, drain never duplicates the Walk-in row, Walk-in sale queues in the existing sale queue, route called only on web.",
    );
  } finally {
    restoreGlobals();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
