/**
 * Offline data cache (Phase E1): the rows the sale form needs while the
 * network is gone — products and customers — kept in IndexedDB, scoped
 * per org + profile like the held-sales and mini-tab stores.
 *
 * Why IndexedDB and not the localStorage queue: the sale queue already
 * stores sale *inputs* in localStorage, but the sale form also needs the
 * *catalogue* (products to scan, customers to pick). localStorage is
 * synchronous and small; a product list can be thousands of rows, and a
 * synchronous JSON.parse on every load would stall the POS. IndexedDB is
 * async and roomy, so the cache never blocks the sale screen.
 *
 * Safety rules:
 * - Every function degrades silently when IndexedDB is unavailable
 *   (private mode, SSR, old browser): saves return false, loads return
 *   empty. The app must never break because the cache failed.
 * - A cached row is a snapshot: it is only used when the live fetch
 *   fails or the browser is offline. The server stays the source of
 *   truth — a queued sale is still validated server-side on sync, and a
 *   rejection there becomes a queue notice, never a silent duplicate.
 * - Rows are stored whole, as fetched. No merging: the newest successful
 *   fetch replaces the whole cache for that scope.
 */

const DB_NAME = "aankh-offline";
const DB_VERSION = 1;
const PRODUCTS_STORE = "products";
const CUSTOMERS_STORE = "customers";

export type OfflineCachedRows<T> = {
  rows: T[];
  /** ISO timestamp of the newest successful save, or null when empty. */
  savedAt: string | null;
};

type CachedRecord<T> = {
  cacheKey: string;
  scope: string;
  savedAt: string;
  data: T;
};

function cacheKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function idbFactory(): IDBFactory | null {
  if (typeof globalThis === "undefined") return null;
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return factory ?? null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idbFactory();
    if (!factory) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCTS_STORE)) {
        db.createObjectStore(PRODUCTS_STORE, { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains(CUSTOMERS_STORE)) {
        db.createObjectStore(CUSTOMERS_STORE, { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function saveRows<T extends { id: string }>(
  storeName: string,
  scope: string,
  rows: T[],
): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      const savedAt = new Date().toISOString();
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      // Replace the whole cache for this scope: delete the old rows
      // first, so a product deleted server-side does not linger offline.
      const oldKeys = await requestToPromise(store.getAllKeys());
      for (const key of oldKeys) {
        if (typeof key === "string" && key.startsWith(`${scope}:`)) {
          store.delete(key);
        }
      }
      for (const row of rows) {
        const record: CachedRecord<T> = { cacheKey: cacheKey(scope, row.id), scope, savedAt, data: row };
        store.put(record);
      }
      await txComplete(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

async function loadRows<T>(
  storeName: string,
  scope: string,
): Promise<OfflineCachedRows<T>> {
  const empty: OfflineCachedRows<T> = { rows: [], savedAt: null };
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const range = IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`);
      const records = await requestToPromise(store.getAll(range)) as Array<CachedRecord<T>>;
      await txComplete(tx);
      if (records.length === 0) return empty;
      const savedAt = records.reduce<string | null>(
        (latest, record) => (latest === null || record.savedAt > latest ? record.savedAt : latest),
        null,
      );
      return { rows: records.map((record) => record.data), savedAt };
    } finally {
      db.close();
    }
  } catch {
    return empty;
  }
}

/** Products the POS needs offline: the full fetched rows, as-is. */
export function saveOfflineProducts<T extends { id: string }>(scope: string, rows: T[]): Promise<boolean> {
  return saveRows(PRODUCTS_STORE, scope, rows);
}

export function loadOfflineProducts<T>(scope: string): Promise<OfflineCachedRows<T>> {
  return loadRows<T>(PRODUCTS_STORE, scope);
}

/** Customers the sale form needs offline: the full fetched rows, as-is. */
export function saveOfflineCustomers<T extends { id: string }>(scope: string, rows: T[]): Promise<boolean> {
  return saveRows(CUSTOMERS_STORE, scope, rows);
}

export function loadOfflineCustomers<T>(scope: string): Promise<OfflineCachedRows<T>> {
  return loadRows<T>(CUSTOMERS_STORE, scope);
}
