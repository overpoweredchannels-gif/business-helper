import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStore, formatProvisionalNumber, type LocalSaleRow, type StoredIdentity } from "../electron/store";
import {
  DesktopSaleQueueBackend,
  LocalStorageSaleQueueBackend,
  getSaleQueueBackend,
} from "../src/lib/offline/local-store";
import {
  clearIdentityCache,
  readIdentityCache,
  readIdentityCacheAsync,
  saveIdentityCache,
  type CachedIdentity,
} from "../src/lib/offline/identity-cache";
import { buildOfflineSaleReceipt } from "../src/lib/print/retail-receipt";
import type { AtomicSaleInput, PendingSale } from "../src/lib/sales/atomic-sale-client";

// Slice S2 — local-first sales. The SQLite store (Electron main process)
// is the durable queue: provisional numbers allocate in order, rows
// survive close + reopen, and the identity cache mirrors to SQLite so a
// wiped browser profile still restores. The renderer seam is covered too:
// the localStorage backend keeps its historical behaviour, the desktop
// backend talks to the bridge (stubbed here) and falls back to
// localStorage when IPC fails, and the offline receipt shows the
// provisional number with its "Pending sync" label.

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

const PROFILE: CachedIdentity = {
  profileId: "profile-1",
  organizationId: "org-1",
  displayName: "Umair",
  email: "owner@example.com",
  role: "owner",
  booksCurrency: "EUR",
  profileRow: { id: "profile-1", organization_id: "org-1", display_name: "Umair", role: "owner" },
  organizationRow: { id: "org-1", name: "OP TRADERS", books_currency: "EUR" },
  cachedAt: new Date().toISOString(),
};

function saleRow(
  requestId: string,
  input: AtomicSaleInput = SALE_INPUT,
  createdAt: string | null = null,
): LocalSaleRow {
  return { requestId, input: input as unknown as Record<string, unknown>, provisionalNumber: null, createdAt };
}

/**
 * Narrow a possibly-null value to its non-null type. (A plain
 * `if (x === null) throw` does NOT narrow a value copied from a `let`
 * that closures assign to — TypeScript keeps the union — so the
 * non-null result is carried by the explicit return type instead.)
 */
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

async function main(): Promise<void> {
  assert.equal(formatProvisionalNumber(123), "L-000123", "provisional numbers are L- + 6 digits");
  assert.equal(formatProvisionalNumber(1), "L-000001", "first provisional number is L-000001");

  // 1. SQLite store on a temp file: enqueue, sequence, replace, remove,
  //    duplicate request_id, close + reopen persistence.
  const dir = mkdtempSync(join(tmpdir(), "aankh-s2-test-"));
  try {
    const dbPath = join(dir, "aankh.db");
    const store = createLocalStore(dbPath);
    assert.deepEqual(store.listSales("org-1:profile-1"), [], "empty queue reads empty");
    assert.equal(store.getIdentity(), null, "no identity cached yet");

    const stored = store.replaceSales("org-1:profile-1", [saleRow("req-1"), saleRow("req-2")]);
    assert.deepEqual(
      stored.map((row) => row.provisionalNumber),
      ["L-000001", "L-000002"],
      "provisional numbers allocate in queue order",
    );
    assert.deepEqual(
      store.listSales("org-1:profile-1").map((row) => row.requestId),
      ["req-1", "req-2"],
      "list returns the queue oldest-first",
    );
    assert.deepEqual(
      store.listSales("org-1:profile-1")[0].input,
      SALE_INPUT as unknown as Record<string, unknown>,
      "the full sale payload round-trips as JSON",
    );

    // Replace keeps numbers for known rows and allocates for new ones.
    const stored2 = store.replaceSales("org-1:profile-1", [saleRow("req-1"), saleRow("req-2"), saleRow("req-3")]);
    assert.deepEqual(
      stored2.map((row) => row.provisionalNumber),
      ["L-000001", "L-000002", "L-000003"],
      "a replace preserves numbers and allocates only for new rows",
    );

    // A duplicate request_id in one replace collapses to one row.
    const stored3 = store.replaceSales("org-1:profile-1", [saleRow("req-1"), saleRow("req-1"), saleRow("req-2")]);
    assert.deepEqual(
      stored3.map((row) => row.requestId),
      ["req-1", "req-2"],
      "a duplicate request_id in one replace keeps the first row only",
    );
    assert.equal(stored3[0].provisionalNumber, "L-000001", "the kept row keeps its number");

    store.removeSale("org-1:profile-1", "req-1");
    assert.deepEqual(
      store.listSales("org-1:profile-1").map((row) => row.requestId),
      ["req-2"],
      "remove drops one sale",
    );

    // Identity round-trip + invalid write.
    store.setIdentity(PROFILE as unknown as StoredIdentity);
    assert.deepEqual(store.getIdentity(), PROFILE, "identity round-trips through SQLite");
    assert.throws(
      () => store.setIdentity({ ...PROFILE, profileId: "" } as unknown as StoredIdentity),
      /Invalid identity/,
      "an identity without a profile id is refused",
    );
    store.clearIdentity();
    assert.equal(store.getIdentity(), null, "clear drops the identity");

    // Close + reopen: rows and the counter survive.
    store.setIdentity(PROFILE as unknown as StoredIdentity);
    store.close();
    const reopened = createLocalStore(dbPath);
    assert.deepEqual(
      reopened.listSales("org-1:profile-1").map((row) => [row.requestId, row.provisionalNumber]),
      [["req-2", "L-000002"]],
      "queued sales survive close + reopen",
    );
    assert.deepEqual(reopened.getIdentity(), PROFILE, "identity survives close + reopen");
    const afterReopen = reopened.replaceSales("org-1:profile-1", [
      { requestId: "req-2", input: SALE_INPUT as unknown as Record<string, unknown>, provisionalNumber: "L-000002", createdAt: null },
      saleRow("req-4"),
    ]);
    assert.equal(afterReopen[1].provisionalNumber, "L-000004", "the counter survives reopen — no number is reused");

    // Slice S4 — createdAt is stamped on first queue and preserved by
    // every later replace (the history shows the save time, not the
    // last drain time). Placed after the number assertions: the
    // provisional counter is global, so these rows consume numbers.
    // A separate scope keeps them out of the queue above. Rows that
    // already exist keep the stamp they were first given, so an
    // explicit later time is ignored.
    const firstQueuedAt = "2026-11-17T02:00:00.000Z";
    const stamped = reopened.replaceSales("org-1:profile-2", [
      saleRow("req-5", SALE_INPUT, firstQueuedAt),
      saleRow("req-6", SALE_INPUT, firstQueuedAt),
    ]);
    assert.equal(stamped[0].createdAt, firstQueuedAt, "replace stamps the first-queued time");
    const restamped = reopened.replaceSales("org-1:profile-2", [
      saleRow("req-5", SALE_INPUT, "2026-11-17T03:00:00.000Z"),
      saleRow("req-6", SALE_INPUT, "2026-11-17T03:00:00.000Z"),
    ]);
    assert.equal(
      restamped[0].createdAt,
      firstQueuedAt,
      "a later replace does not move the first-queued time",
    );
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 2. localStorage backend: historical behaviour, incl. the legacy
  //    single-slot migration.
  {
    const values = new Map<string, string>();
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
    });
    const backend = new LocalStorageSaleQueueBackend();
    const scope = "org-1:profile-1";
    values.set(`tradeos:pending-sale:v1:${scope}`, JSON.stringify({ requestId: "legacy-1", input: SALE_INPUT }));
    assert.deepEqual(
      (await backend.list(scope)).map((sale) => sale.requestId),
      ["legacy-1"],
      "the old single slot migrates to the front of the queue",
    );
    assert.equal(values.has(`tradeos:pending-sale:v1:${scope}`), false, "the legacy key is removed after migration");
    const attempt: PendingSale = { requestId: "req-9", input: SALE_INPUT };
    assert.deepEqual(await backend.replace(scope, [{ requestId: "legacy-1", input: SALE_INPUT }, attempt]), [
      { requestId: "legacy-1", input: SALE_INPUT },
      attempt,
    ]);
    assert.equal((await backend.list(scope)).length, 2);
    await backend.remove(scope, "legacy-1");
    assert.deepEqual(
      (await backend.list(scope)).map((sale) => sale.requestId),
      ["req-9"],
      "remove drops one sale",
    );
    assert.equal(
      (await backend.list(scope))[0].provisionalNumber,
      undefined,
      "the web backend never allocates a provisional number",
    );
  }

  // 3. Desktop backend over a stubbed bridge: numbers flow through, and
  //    an IPC failure falls back to localStorage instead of losing the sale.
  {
    const values = new Map<string, string>();
    const ipcRows = new Map<string, LocalSaleRow[]>();
    let counter = 0;
    const bridge = {
      list: async (scope: string) => ipcRows.get(scope) ?? [],
      replace: async (scope: string, rows: LocalSaleRow[]) => {
        const stored = rows.map((row) => ({
          ...row,
          provisionalNumber: row.provisionalNumber ?? `L-${String(++counter).padStart(6, "0")}`,
        }));
        ipcRows.set(scope, stored);
        return stored;
      },
      remove: async (scope: string, requestId: string) => {
        ipcRows.set(scope, (ipcRows.get(scope) ?? []).filter((row) => row.requestId !== requestId));
      },
    };
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: { isDesktop: true, localSales: bridge },
    });
    const backend = getSaleQueueBackend();
    assert.ok(backend instanceof DesktopSaleQueueBackend, "the bridge present selects the desktop backend");
    const scope = "org-1:profile-1";
    const stored = await backend.replace(scope, [
      { requestId: "req-1", input: SALE_INPUT },
      { requestId: "req-2", input: SALE_INPUT },
    ]);
    assert.deepEqual(
      stored.map((sale) => sale.provisionalNumber),
      ["L-000001", "L-000002"],
      "the desktop backend returns SQLite-allocated numbers",
    );
    assert.deepEqual(
      (await backend.list(scope)).map((sale) => sale.requestId),
      ["req-1", "req-2"],
      "the desktop backend lists from the bridge",
    );
    await backend.remove(scope, "req-1");
    assert.deepEqual(
      (await backend.list(scope)).map((sale) => sale.requestId),
      ["req-2"],
      "the desktop backend removes through the bridge",
    );

    // IPC throws on every call: the sale still lands in localStorage.
    const failingWindow = {
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: {
        isDesktop: true,
        localSales: {
          list: async (): Promise<LocalSaleRow[]> => {
            throw new Error("store unavailable");
          },
          replace: async (): Promise<LocalSaleRow[]> => {
            throw new Error("store unavailable");
          },
          remove: async (): Promise<void> => {
            throw new Error("store unavailable");
          },
        },
      },
    };
    installWindow(failingWindow);
    const fallbackBackend = getSaleQueueBackend();
    assert.ok(fallbackBackend instanceof DesktopSaleQueueBackend, "the bridge is present even when IPC fails");
    await fallbackBackend.replace(scope, [{ requestId: "req-fallback", input: SALE_INPUT }]);
    assert.deepEqual(
      (await fallbackBackend.list(scope)).map((sale) => sale.requestId),
      ["req-fallback"],
      "an IPC failure falls back to localStorage instead of losing the sale",
    );
  }

  // 4. Identity mirror: save writes localStorage AND SQLite; the async
  //    read prefers SQLite, so a wiped profile still restores.
  {
    const values = new Map<string, string>();
    let sqliteIdentity: StoredIdentity | null = null;
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: {
        isDesktop: true,
        identity: {
          get: async () => sqliteIdentity,
          set: async (entry: StoredIdentity) => {
            sqliteIdentity = entry;
          },
          clear: async () => {
            sqliteIdentity = null;
          },
        },
      },
    });
    saveIdentityCache(PROFILE);
    // saveIdentityCache re-stamps cachedAt on every write, so round-trip
    // equality is checked with the timestamp normalized out.
    const cached = readIdentityCache();
    assert.ok(cached, "the sync read still uses localStorage");
    assert.deepEqual({ ...cached, cachedAt: PROFILE.cachedAt }, PROFILE, "the local copy round-trips");
    const mirrored: StoredIdentity = mustBePresent(sqliteIdentity, "the save is mirrored to SQLite");
    assert.deepEqual({ ...mirrored, cachedAt: PROFILE.cachedAt }, PROFILE, "the SQLite mirror matches");
    values.clear();
    assert.equal(readIdentityCache(), null, "the local copy is gone after a profile wipe");
    const restored = await readIdentityCacheAsync();
    assert.ok(restored, "the async read restores from SQLite");
    assert.deepEqual({ ...restored, cachedAt: PROFILE.cachedAt }, PROFILE, "the SQLite restore matches");
    clearIdentityCache();
    assert.equal(sqliteIdentity, null, "sign-out clears the SQLite record too");

    // A failing bridge falls back to the local copy.
    installWindow({
      localStorage: mapStorage(values),
      dispatchEvent: () => true,
      aankhDesktop: {
        isDesktop: true,
        identity: {
          get: async (): Promise<StoredIdentity | null> => {
            throw new Error("store unavailable");
          },
          set: async () => {
            throw new Error("store unavailable");
          },
          clear: async () => {
            throw new Error("store unavailable");
          },
        },
      },
    });
    saveIdentityCache(PROFILE);
    const fallbackRestored = await readIdentityCacheAsync();
    assert.ok(fallbackRestored, "an IPC failure still reads the local copy");
    assert.deepEqual(
      { ...fallbackRestored, cachedAt: PROFILE.cachedAt },
      PROFILE,
      "an IPC failure falls back to localStorage",
    );
  }

  // 5. Offline receipt: provisional number + "Pending sync" label together.
  {
    const details = {
      scope: "org-1:profile-1",
      business: "OP TRADERS",
      pendingLabel: "Pending sync",
      customerName: "Walk-in customer",
      productById: () => ({ name: "COCA COLA 1L", unit_type: "Units" }),
    };
    const withNumber = buildOfflineSaleReceipt(SALE_INPUT, { ...details, provisionalNumber: "L-000123" });
    assert.equal(withNumber.number, "L-000123", "the receipt number is the provisional number");
    assert.equal(withNumber.provisionalNote, "Pending sync", "the receipt still says Pending sync");
    const withoutNumber = buildOfflineSaleReceipt(SALE_INPUT, details);
    assert.equal(withoutNumber.number, "Pending sync", "without a number the label is the number, as before");
    assert.equal(withoutNumber.provisionalNote, null, "without a number there is no separate note");
  }

  console.log("test-local-sales: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
