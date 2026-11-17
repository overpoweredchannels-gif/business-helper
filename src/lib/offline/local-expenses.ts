/**
 * Slice S7 — offline expenses seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts` and the purchases seam in
 * `src/lib/offline/local-purchases.ts`):
 * - Desktop build: the SQLite `local_expenses` table over IPC
 *   (`electron/store.ts`), so an offline-created expense survives a
 *   browser-cache clear, a restart and an app update.
 * - Web build: the direct expense insert is used, never this seam —
 *   the localStorage backend below exists only as the desktop
 *   fallback when the store fails to open, so an expense saved
 *   offline is never lost (an expense can then briefly exist in
 *   both stores — that is safe, because the server dedupes by
 *   `request_key`: the same key re-posted returns the existing row
 *   instead of a duplicate).
 *
 * The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): it is the idempotency key
 * the sync uses, so a retry with the same key can never
 * double-post. The provisional number (`EX-000123`) is allocated
 * by the SQLite store on insert; a localStorage-fallback row
 * carries none, and the expenses list shows the "Pending" label
 * for it instead.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** Fired after any local-expenses mutation, so the expenses lists refresh. */
export const LOCAL_EXPENSES_CHANGED_EVENT = "tradeos:local-expenses-changed";

export function notifyLocalExpensesChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_EXPENSES_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

/** One offline-created expense. */
export interface LocalExpenseRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  /** Full expense insert payload (expense_type, amount, notes, expense_date, supplier/customer/purchase/sales ids) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`EX-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server expense id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalExpensesBackend {
  /** Offline-created expenses for a scope, oldest first. */
  list(scope: string): Promise<LocalExpenseRow[]>;
  /** Insert or replace one local expense row; returns the stored row. */
  upsert(scope: string, row: LocalExpenseRow): Promise<LocalExpenseRow>;
  /** Delete one local expense row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const expensesStorageKey = (scope: string) => `tradeos:local-expenses:v1:${scope}`;

function parseExpenses(raw: string | null): LocalExpenseRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalExpenseRow =>
        !!item &&
        typeof (item as LocalExpenseRow).id === "string" &&
        !!(item as LocalExpenseRow).input &&
        typeof (item as LocalExpenseRow).input === "object" &&
        !Array.isArray((item as LocalExpenseRow).input),
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalExpensesBackend implements LocalExpensesBackend {
  async list(scope: string): Promise<LocalExpenseRow[]> {
    if (typeof window === "undefined") return [];
    return parseExpenses(window.localStorage.getItem(expensesStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalExpenseRow): Promise<LocalExpenseRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // A rewrite keeps the first-created time and the provisional
    // number it already had (a retry must not move an expense's
    // history number); the sync columns come from the caller.
    const stored: LocalExpenseRow =
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

  private writeRaw(scope: string, rows: LocalExpenseRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(expensesStorageKey(scope));
      else window.localStorage.setItem(expensesStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalExpensesBridge = {
  list(scope: string): Promise<LocalExpenseRow[]>;
  upsert(scope: string, row: LocalExpenseRow): Promise<LocalExpenseRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-expenses methods, or null outside the desktop shell. */
export function desktopLocalExpensesBridge(): DesktopLocalExpensesBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localExpenses?: DesktopLocalExpensesBridge } })
    .aankhDesktop;
  return bridge?.localExpenses ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses an expense (see the module
 * header for why an expense briefly living in both stores is safe).
 */
export class DesktopLocalExpensesBackend implements LocalExpensesBackend {
  private readonly fallback = new LocalStorageLocalExpensesBackend();

  async list(scope: string): Promise<LocalExpenseRow[]> {
    const bridge = desktopLocalExpensesBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalExpenseRow): Promise<LocalExpenseRow> {
    const bridge = desktopLocalExpensesBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalExpensesBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-expenses backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalExpensesBackend(): LocalExpensesBackend {
  if (isDesktopApp() && desktopLocalExpensesBridge()) return new DesktopLocalExpensesBackend();
  return new LocalStorageLocalExpensesBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalExpense(row: LocalExpenseRow): boolean {
  return row.syncStatus === "pending";
}

/** A new offline-created expense: the client request key is the row id (and the server idempotency key). */
export function newLocalExpenseRow(input: Record<string, unknown>): LocalExpenseRow {
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

/** Synthetic history id for a pending expense: `pending:<requestKey>`. */
export const PENDING_EXPENSE_HISTORY_ID_PREFIX = "pending:";

export function pendingExpenseHistoryId(requestKey: string): string {
  return `${PENDING_EXPENSE_HISTORY_ID_PREFIX}${requestKey}`;
}

/** True for a synthetic pending row (never a server row). */
export function isPendingExpenseHistoryId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_EXPENSE_HISTORY_ID_PREFIX);
}

/**
 * A queued expense as the expenses-list row. The expense insert
 * payload already carries every column the list reads (expense_type,
 * amount, notes, expense_date, supplier/customer/purchase/sales ids),
 * so the row is the payload plus the synthetic id and the queue's
 * created time. Returns null when the payload has no expense type
 * or no positive amount.
 */
export function pendingExpenseToExpense(pending: LocalExpenseRow): Record<string, unknown> | null {
  const input = pending.input;
  if (typeof input.expense_type !== "string" || input.expense_type.length === 0) return null;
  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    ...input,
    id: pendingExpenseHistoryId(pending.id),
    created_at: pending.createdAt,
  };
}

/**
 * Merge pending queue expenses into the expenses display list. A
 * pending expense is dropped when a synced row already carries its
 * `request_key`, so one expense never renders twice (in practice
 * the queue row is already gone by then — the drain removes a
 * confirmed expense before the refetch — so the dedupe is
 * belt-and-braces for a crash between the two).
 */
export function mergePendingExpenses(
  syncedExpenses: Array<Record<string, unknown>>,
  pending: LocalExpenseRow[],
): Array<Record<string, unknown>> {
  const syncedRequestKeys = new Set(
    syncedExpenses
      .map((row) => (typeof row.request_key === "string" ? row.request_key : ""))
      .filter((key) => key.length > 0),
  );
  const pendingRows: Array<Record<string, unknown>> = [];
  for (const row of pending) {
    if (syncedRequestKeys.has(row.id)) continue;
    const parsed = pendingExpenseToExpense(row);
    if (!parsed) continue;
    pendingRows.push(parsed);
  }
  return [...pendingRows, ...syncedExpenses];
}
