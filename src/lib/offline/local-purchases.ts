/**
 * Slice S6 — offline purchases seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts` and the customers seam in
 * `src/lib/offline/local-customers.ts`):
 * - Desktop build: the SQLite `local_purchases` table over IPC
 *   (`electron/store.ts`), so an offline-created purchase survives a
 *   browser-cache clear, a restart and an app update.
 * - Web build: the existing POST /api/purchases flow is used, never
 *   this seam — the localStorage backend below exists only as the
 *   desktop fallback when the store fails to open, so a purchase
 *   saved offline is never lost (a purchase can then briefly exist
 *   in both stores — that is safe, because the server dedupes by
 *   `request_key`: the same key re-posted replays the original
 *   purchase instead of a duplicate).
 *
 * The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): it is the idempotency key the
 * server dedupes on, so a retry with the same key can never
 * double-post or double-stock. The provisional number (`LP-000123`)
 * is allocated by the SQLite store on insert; a localStorage-fallback
 * row carries none, and the history shows the "Pending" label for it
 * instead. The provisional number is local-only: the server assigns
 * `P-500xx` at sync and the history then shows the server number.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** Fired after any local-purchases mutation, so the purchase history refreshes. */
export const LOCAL_PURCHASES_CHANGED_EVENT = "tradeos:local-purchases-changed";

export function notifyLocalPurchasesChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_PURCHASES_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

/** One offline-created purchase. */
export interface LocalPurchaseRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  /** Full purchase input (supplier, terms, lines) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`LP-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server `purchase_transactions.id` once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPurchasesBackend {
  /** Offline-created purchases for a scope, oldest first. */
  list(scope: string): Promise<LocalPurchaseRow[]>;
  /** Insert or replace one local purchase row; returns the stored row. */
  upsert(scope: string, row: LocalPurchaseRow): Promise<LocalPurchaseRow>;
  /** Delete one local purchase row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const purchasesStorageKey = (scope: string) => `tradeos:local-purchases:v1:${scope}`;

function parsePurchases(raw: string | null): LocalPurchaseRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalPurchaseRow =>
        !!item &&
        typeof (item as LocalPurchaseRow).id === "string" &&
        !!(item as LocalPurchaseRow).input &&
        typeof (item as LocalPurchaseRow).input === "object" &&
        !Array.isArray((item as LocalPurchaseRow).input),
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalPurchasesBackend implements LocalPurchasesBackend {
  async list(scope: string): Promise<LocalPurchaseRow[]> {
    if (typeof window === "undefined") return [];
    return parsePurchases(window.localStorage.getItem(purchasesStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalPurchaseRow): Promise<LocalPurchaseRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // A rewrite keeps the first-created time and the provisional
    // number it already had (a retry must not move a purchase's
    // history number); the sync columns come from the caller.
    const stored: LocalPurchaseRow =
      index >= 0
        ? {
            ...row,
            provisionalNumber: rows[index].provisionalNumber ?? row.provisionalNumber,
            createdAt: rows[index].createdAt,
          }
        : row;
    if (index >= 0) rows[index] = stored;
    else rows.push(stored);
    this.writeRaw(scope, rows);
    return stored;
  }

  async remove(scope: string, id: string): Promise<void> {
    const rows = await this.list(scope);
    this.writeRaw(
      scope,
      rows.filter((item) => item.id !== id),
    );
  }

  private writeRaw(scope: string, rows: LocalPurchaseRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(purchasesStorageKey(scope));
      else window.localStorage.setItem(purchasesStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalPurchasesBridge = {
  list(scope: string): Promise<LocalPurchaseRow[]>;
  upsert(scope: string, row: LocalPurchaseRow): Promise<LocalPurchaseRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-purchases methods, or null outside the desktop shell. */
export function desktopLocalPurchasesBridge(): DesktopLocalPurchasesBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localPurchases?: DesktopLocalPurchasesBridge } })
    .aankhDesktop;
  return bridge?.localPurchases ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses a purchase (see the module
 * header for why a purchase briefly living in both stores is safe).
 */
export class DesktopLocalPurchasesBackend implements LocalPurchasesBackend {
  private readonly fallback = new LocalStorageLocalPurchasesBackend();

  async list(scope: string): Promise<LocalPurchaseRow[]> {
    const bridge = desktopLocalPurchasesBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalPurchaseRow): Promise<LocalPurchaseRow> {
    const bridge = desktopLocalPurchasesBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalPurchasesBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-purchases backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalPurchasesBackend(): LocalPurchasesBackend {
  if (isDesktopApp() && desktopLocalPurchasesBridge()) return new DesktopLocalPurchasesBackend();
  return new LocalStorageLocalPurchasesBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalPurchase(row: LocalPurchaseRow): boolean {
  return row.syncStatus === "pending";
}

/**
 * A new offline-created purchase: the client request key is the row
 * id (and the server idempotency key); the provisional number is
 * allocated by the store on insert (null here — the stored row
 * returned by `upsert` carries it).
 */
export function newLocalPurchaseRow(input: Record<string, unknown>): LocalPurchaseRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    input,
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
}
