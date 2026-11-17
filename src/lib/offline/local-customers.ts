/**
 * Slice S5 — offline customers seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts`):
 * - Desktop build: the SQLite `local_customers` table over IPC
 *   (`electron/store.ts`), so an offline-created customer survives a
 *   browser-cache clear, a restart and an app update.
 * - Web build: the existing POST /api/customers flow is used, never
 *   this seam — the localStorage backend below exists only as the
 *   desktop fallback when the store fails to open, so a customer
 *   saved offline is never lost (a customer can then briefly exist
 *   in both stores — that is safe, because the server dedupes by the
 *   row `id`: the same client UUID re-posted returns the existing
 *   row instead of a duplicate).
 *
 * The row `id` is a client-generated UUID. For a create it BECOMES
 * the server id on sync (the route accepts a client-supplied id), so
 * sales that already reference it need no rewrite. An edit of an
 * unsynced create stays a create. The balance is NEVER stored here:
 * it is always derived from ledger transactions (see
 * `src/lib/offline/customer-balance-offline.ts`).
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** Fired after any local-customers mutation, so the customer list refreshes. */
export const LOCAL_CUSTOMERS_CHANGED_EVENT = "tradeos:local-customers-changed";

export function notifyLocalCustomersChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_CUSTOMERS_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

export type LocalCustomerKind = "create" | "edit";

/** One offline-created / offline-edited customer. */
export interface LocalCustomerRow {
  /** Client UUID (create) or server id (edit). */
  id: string;
  kind: LocalCustomerKind;
  /** Full customer record as plain JSON. */
  data: Record<string, unknown>;
  /** The idempotency key (`crypto.randomUUID()` at creation). */
  idempotencyKey: string;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server id once synced (same UUID as `id` for customers). */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  /** Last local write — the last-write-wins timestamp sent on sync. */
  updatedAt: string;
}

export interface LocalCustomersBackend {
  /** Offline-created / offline-edited customers for a scope, oldest first. */
  list(scope: string): Promise<LocalCustomerRow[]>;
  /** Insert or replace one local customer row; returns the stored row. */
  upsert(scope: string, row: LocalCustomerRow): Promise<LocalCustomerRow>;
  /** Delete one local customer row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const customersStorageKey = (scope: string) => `tradeos:local-customers:v1:${scope}`;

function parseCustomers(raw: string | null): LocalCustomerRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalCustomerRow =>
        !!item &&
        typeof (item as LocalCustomerRow).id === "string" &&
        ((item as LocalCustomerRow).kind === "create" || (item as LocalCustomerRow).kind === "edit") &&
        !!(item as LocalCustomerRow).data &&
        typeof (item as LocalCustomerRow).data === "object" &&
        typeof (item as LocalCustomerRow).idempotencyKey === "string",
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalCustomersBackend implements LocalCustomersBackend {
  async list(scope: string): Promise<LocalCustomerRow[]> {
    if (typeof window === "undefined") return [];
    return parseCustomers(window.localStorage.getItem(customersStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalCustomerRow): Promise<LocalCustomerRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // An edit of an unsynced create stays a create — same rule as the
    // SQLite store (see electron/store.ts upsertCustomerTx).
    const stored: LocalCustomerRow =
      index >= 0
        ? {
            ...row,
            kind: rows[index].kind === "create" ? "create" : row.kind,
            idempotencyKey: rows[index].idempotencyKey,
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

  private writeRaw(scope: string, rows: LocalCustomerRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(customersStorageKey(scope));
      else window.localStorage.setItem(customersStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalCustomersBridge = {
  list(scope: string): Promise<LocalCustomerRow[]>;
  upsert(scope: string, row: LocalCustomerRow): Promise<LocalCustomerRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-customers methods, or null outside the desktop shell. */
export function desktopLocalCustomersBridge(): DesktopLocalCustomersBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localCustomers?: DesktopLocalCustomersBridge } })
    .aankhDesktop;
  return bridge?.localCustomers ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses a customer (see the module
 * header for why a customer briefly living in both stores is safe).
 */
export class DesktopLocalCustomersBackend implements LocalCustomersBackend {
  private readonly fallback = new LocalStorageLocalCustomersBackend();

  async list(scope: string): Promise<LocalCustomerRow[]> {
    const bridge = desktopLocalCustomersBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalCustomerRow): Promise<LocalCustomerRow> {
    const bridge = desktopLocalCustomersBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalCustomersBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-customers backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalCustomersBackend(): LocalCustomersBackend {
  if (isDesktopApp() && desktopLocalCustomersBridge()) return new DesktopLocalCustomersBackend();
  return new LocalStorageLocalCustomersBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalCustomer(row: LocalCustomerRow): boolean {
  return row.syncStatus === "pending";
}

/** A new offline-created customer: client UUID as the id, kind "create". */
export function newLocalCustomerCreateRow(data: Record<string, unknown>): LocalCustomerRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "create",
    data,
    idempotencyKey: crypto.randomUUID(),
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Apply an offline edit to a customer. An edit of an unsynced create
 * stays a create (one insert on sync); an edit of a synced row is kind
 * "edit". The idempotency key and first-created time survive; the
 * updated time refreshes (it is the last-write-wins timestamp), and
 * the row goes back to pending so the next drain retries it.
 */
export function editLocalCustomerRow(
  existing: LocalCustomerRow | null,
  id: string,
  data: Record<string, unknown>,
): LocalCustomerRow {
  const now = new Date().toISOString();
  if (!existing) {
    return {
      id,
      kind: "edit",
      data,
      idempotencyKey: crypto.randomUUID(),
      synced: 0,
      serverId: id,
      syncStatus: "pending",
      syncError: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    ...existing,
    kind: existing.kind === "create" ? "create" : "edit",
    data,
    syncStatus: "pending",
    syncError: null,
    updatedAt: now,
  };
}

/**
 * Merge local customers into a fetched server list (desktop read path).
 * A local row wins for its id — it is the newest local write — and a
 * local create (no server row yet) is appended. The merged list is
 * ordered by customer name, like the live fetch.
 */
export function mergeLocalCustomers<T extends { id: string | number; customer_name?: string | null }>(
  serverRows: T[],
  localRows: LocalCustomerRow[],
): T[] {
  const localById = new Map<string, LocalCustomerRow>();
  for (const row of localRows) localById.set(row.id, row);
  const merged: T[] = serverRows
    .filter((row) => !localById.has(String(row.id)))
    .concat(
      localRows.map(
        // Slice S8 — the row id is authoritative (the client UUID for
        // a create, the server id for an edit). The stored `data`
        // predates the client-UUID scheme on some rows, so trusting
        // `data.id` renders a stale id — the same latent shape S6
        // fixed for suppliers (mergeLocalSuppliers).
        (row) => ({ ...(row.data as Record<string, unknown>), id: row.id }) as unknown as T,
      ),
    );
  merged.sort((a, b) =>
    String(a.customer_name ?? "").localeCompare(String(b.customer_name ?? "")),
  );
  return merged;
}
