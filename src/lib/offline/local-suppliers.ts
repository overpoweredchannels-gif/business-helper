/**
 * Slice S6 — offline suppliers seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the customers seam in
 * `src/lib/offline/local-customers.ts`):
 * - Desktop build: the SQLite `local_suppliers` table over IPC
 *   (`electron/store.ts`), so an offline-created supplier survives a
 *   browser-cache clear, a restart and an app update.
 * - Web build: the existing POST /api/suppliers flow is used, never
 *   this seam — the localStorage backend below exists only as the
 *   desktop fallback when the store fails to open, so a supplier
 *   saved offline is never lost (a supplier can then briefly exist
 *   in both stores — that is safe, because the server dedupes by the
 *   row `id`: the same client UUID re-posted returns the existing
 *   row instead of a duplicate).
 *
 * The row `id` is a client-generated UUID. For a create it BECOMES
 * the server id on sync (the route accepts a client-supplied id), so
 * purchases that already reference it need no rewrite. An edit of an
 * unsynced create stays a create. The balance is NEVER stored here:
 * supplier outstanding is derived on read, exactly as server-side
 * (`payment_derived_outstanding('supplier', …)`).
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** Fired after any local-suppliers mutation, so the supplier list refreshes. */
export const LOCAL_SUPPLIERS_CHANGED_EVENT = "tradeos:local-suppliers-changed";

export function notifyLocalSuppliersChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_SUPPLIERS_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

export type LocalSupplierKind = "create" | "edit";

/** One offline-created / offline-edited supplier. */
export interface LocalSupplierRow {
  /** Client UUID (create) or server id (edit). */
  id: string;
  kind: LocalSupplierKind;
  /** Full supplier record as plain JSON. */
  data: Record<string, unknown>;
  /** The idempotency key (`crypto.randomUUID()` at creation). */
  idempotencyKey: string;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server id once synced (same UUID as `id` for suppliers). */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  /** Last local write — the last-write-wins timestamp sent on sync. */
  updatedAt: string;
}

export interface LocalSuppliersBackend {
  /** Offline-created / offline-edited suppliers for a scope, oldest first. */
  list(scope: string): Promise<LocalSupplierRow[]>;
  /** Insert or replace one local supplier row; returns the stored row. */
  upsert(scope: string, row: LocalSupplierRow): Promise<LocalSupplierRow>;
  /** Delete one local supplier row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const suppliersStorageKey = (scope: string) => `tradeos:local-suppliers:v1:${scope}`;

function parseSuppliers(raw: string | null): LocalSupplierRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalSupplierRow =>
        !!item &&
        typeof (item as LocalSupplierRow).id === "string" &&
        ((item as LocalSupplierRow).kind === "create" || (item as LocalSupplierRow).kind === "edit") &&
        !!(item as LocalSupplierRow).data &&
        typeof (item as LocalSupplierRow).data === "object" &&
        typeof (item as LocalSupplierRow).idempotencyKey === "string",
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalSuppliersBackend implements LocalSuppliersBackend {
  async list(scope: string): Promise<LocalSupplierRow[]> {
    if (typeof window === "undefined") return [];
    return parseSuppliers(window.localStorage.getItem(suppliersStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalSupplierRow): Promise<LocalSupplierRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // An edit of an unsynced create stays a create — same rule as the
    // SQLite store (see electron/store.ts upsertSupplierTx).
    const stored: LocalSupplierRow =
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

  private writeRaw(scope: string, rows: LocalSupplierRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(suppliersStorageKey(scope));
      else window.localStorage.setItem(suppliersStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalSuppliersBridge = {
  list(scope: string): Promise<LocalSupplierRow[]>;
  upsert(scope: string, row: LocalSupplierRow): Promise<LocalSupplierRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-suppliers methods, or null outside the desktop shell. */
export function desktopLocalSuppliersBridge(): DesktopLocalSuppliersBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localSuppliers?: DesktopLocalSuppliersBridge } })
    .aankhDesktop;
  return bridge?.localSuppliers ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses a supplier (see the module
 * header for why a supplier briefly living in both stores is safe).
 */
export class DesktopLocalSuppliersBackend implements LocalSuppliersBackend {
  private readonly fallback = new LocalStorageLocalSuppliersBackend();

  async list(scope: string): Promise<LocalSupplierRow[]> {
    const bridge = desktopLocalSuppliersBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalSupplierRow): Promise<LocalSupplierRow> {
    const bridge = desktopLocalSuppliersBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalSuppliersBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-suppliers backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalSuppliersBackend(): LocalSuppliersBackend {
  if (isDesktopApp() && desktopLocalSuppliersBridge()) return new DesktopLocalSuppliersBackend();
  return new LocalStorageLocalSuppliersBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalSupplier(row: LocalSupplierRow): boolean {
  return row.syncStatus === "pending";
}

/** A new offline-created supplier: client UUID as the id, kind "create". */
export function newLocalSupplierCreateRow(data: Record<string, unknown>): LocalSupplierRow {
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
 * Apply an offline edit to a supplier. An edit of an unsynced create
 * stays a create (one insert on sync); an edit of a synced row is kind
 * "edit". The idempotency key and first-created time survive; the
 * updated time refreshes (it is the last-write-wins timestamp), and
 * the row goes back to pending so the next drain retries it.
 */
export function editLocalSupplierRow(
  existing: LocalSupplierRow | null,
  id: string,
  data: Record<string, unknown>,
): LocalSupplierRow {
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
 * Merge local suppliers into a fetched server list (desktop read path).
 * A local row wins for its id — it is the newest local write — and a
 * local create (no server row yet) is appended. The merged list is
 * ordered by supplier name, like the live fetch.
 *
 * The row id is authoritative: a local row's data can carry a stale
 * id (an edit built from an older copy), but the row id is the
 * client UUID that becomes the server id on sync — a merged row
 * with the wrong id would buy from the wrong supplier.
 */
export function mergeLocalSuppliers<T extends { id: string | number; supplier_name?: string | null }>(
  serverRows: T[],
  localRows: LocalSupplierRow[],
): T[] {
  const localById = new Map<string, LocalSupplierRow>();
  for (const row of localRows) localById.set(row.id, row);
  const merged: T[] = serverRows
    .filter((row) => !localById.has(String(row.id)))
    .concat(
      localRows.map(
        (row) => ({ ...(row.data as Record<string, unknown>), id: row.id }) as unknown as T,
      ),
    );
  merged.sort((a, b) =>
    String(a.supplier_name ?? "").localeCompare(String(b.supplier_name ?? "")),
  );
  return merged;
}
