/**
 * Slice S7 — offline returns seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts` and the purchases seam in
 * `src/lib/offline/local-purchases.ts`):
 * - Desktop build: the SQLite `local_returns` table over IPC
 *   (`electron/store.ts`), so an offline-created return survives a
 *   browser-cache clear, a restart and an app update.
 * - Web build: the existing returns routes are used, never this seam
 *   — the localStorage backend below exists only as the desktop
 *   fallback when the store fails to open, so a return saved offline
 *   is never lost (a return can then briefly exist in both stores —
 *   that is safe, because the server dedupes by `request_key`: the
 *   same key re-posted replays the original return instead of a
 *   duplicate or a second stock movement).
 *
 * The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): it is the idempotency key the
 * server dedupes on, so a retry with the same key can never
 * double-post or double-restore stock. The provisional number
 * (`SR-000123` for sales, `PR-000123` for purchases) is allocated
 * by the SQLite store on insert; a localStorage-fallback row
 * carries none, and the history shows the "Pending" label for it
 * instead. The provisional number is local-only: the server assigns
 * the return number at sync and the history then shows the server
 * number.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";
import type { PurchaseReturn, PurchaseReturnItem, SalesReturn, SalesReturnItem } from "@/lib/tradeos/types";

/** Fired after any local-returns mutation, so the returns lists refresh. */
export const LOCAL_RETURNS_CHANGED_EVENT = "tradeos:local-returns-changed";

export function notifyLocalReturnsChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_RETURNS_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

export type LocalReturnKind = "sales" | "purchase";

/** One offline-created return. */
export interface LocalReturnRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  kind: LocalReturnKind;
  /** Full return input (party, linked invoice, date, reason, lines) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`SR-000123` / `PR-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server return id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalReturnsBackend {
  /** Offline-created returns for a scope, oldest first. */
  list(scope: string): Promise<LocalReturnRow[]>;
  /** Insert or replace one local return row; returns the stored row. */
  upsert(scope: string, row: LocalReturnRow): Promise<LocalReturnRow>;
  /** Delete one local return row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const returnsStorageKey = (scope: string) => `tradeos:local-returns:v1:${scope}`;

function parseReturns(raw: string | null): LocalReturnRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalReturnRow =>
        !!item &&
        typeof (item as LocalReturnRow).id === "string" &&
        ((item as LocalReturnRow).kind === "sales" || (item as LocalReturnRow).kind === "purchase") &&
        !!(item as LocalReturnRow).input &&
        typeof (item as LocalReturnRow).input === "object" &&
        !Array.isArray((item as LocalReturnRow).input),
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalReturnsBackend implements LocalReturnsBackend {
  async list(scope: string): Promise<LocalReturnRow[]> {
    if (typeof window === "undefined") return [];
    return parseReturns(window.localStorage.getItem(returnsStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalReturnRow): Promise<LocalReturnRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // A rewrite keeps the first-created time and the provisional
    // number it already had (a retry must not move a return's
    // history number); the sync columns come from the caller.
    const stored: LocalReturnRow =
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

  private writeRaw(scope: string, rows: LocalReturnRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(returnsStorageKey(scope));
      else window.localStorage.setItem(returnsStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalReturnsBridge = {
  list(scope: string): Promise<LocalReturnRow[]>;
  upsert(scope: string, row: LocalReturnRow): Promise<LocalReturnRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-returns methods, or null outside the desktop shell. */
export function desktopLocalReturnsBridge(): DesktopLocalReturnsBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localReturns?: DesktopLocalReturnsBridge } })
    .aankhDesktop;
  return bridge?.localReturns ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses a return (see the module
 * header for why a return briefly living in both stores is safe).
 */
export class DesktopLocalReturnsBackend implements LocalReturnsBackend {
  private readonly fallback = new LocalStorageLocalReturnsBackend();

  async list(scope: string): Promise<LocalReturnRow[]> {
    const bridge = desktopLocalReturnsBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalReturnRow): Promise<LocalReturnRow> {
    const bridge = desktopLocalReturnsBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalReturnsBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-returns backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalReturnsBackend(): LocalReturnsBackend {
  if (isDesktopApp() && desktopLocalReturnsBridge()) return new DesktopLocalReturnsBackend();
  return new LocalStorageLocalReturnsBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalReturn(row: LocalReturnRow): boolean {
  return row.syncStatus === "pending";
}

/** A new offline-created return: the client request key is the row id (and the server idempotency key). */
export function newLocalReturnRow(kind: LocalReturnKind, input: Record<string, unknown>): LocalReturnRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
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

/** Synthetic history id for a pending return: `pending:<requestKey>`. */
export const PENDING_RETURN_HISTORY_ID_PREFIX = "pending:";

export function pendingReturnHistoryId(requestKey: string): string {
  return `${PENDING_RETURN_HISTORY_ID_PREFIX}${requestKey}`;
}

/** True for a synthetic pending row (never a server row). */
export function isPendingReturnHistoryId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_RETURN_HISTORY_ID_PREFIX);
}

/** The request key (local row id) behind a synthetic pending id. */
export function pendingReturnRequestKey(id: string): string {
  return id.startsWith(PENDING_RETURN_HISTORY_ID_PREFIX)
    ? id.slice(PENDING_RETURN_HISTORY_ID_PREFIX.length)
    : id;
}

export interface ReturnInputLine {
  productId?: string | number | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  discount?: number | string | null;
  unitMode?: "main" | "subunit" | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

/** The return input lines, or an empty list when they are unusable. */
export function returnInputLines(input: Record<string, unknown>): ReturnInputLine[] {
  const lines = input.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (line): line is ReturnInputLine =>
      !!line && typeof line === "object" && !Array.isArray(line),
  );
}

function returnInputString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A queued sales return as the returns-list row. `fallbackLabel` is
 * shown as the return number when the return has no provisional
 * number yet (SQLite rows always have one; a localStorage-fallback
 * row may not). Returns null when the input has no customer or no
 * lines. The row is a confirmed local return — never cancelled — so
 * the history badge, the credit-balance derivation and the returns
 * list all read it exactly like a server row.
 */
export function pendingReturnToSalesReturn(
  pending: LocalReturnRow,
  fallbackLabel = "",
): SalesReturn | null {
  const input = pending.input;
  if (!input || typeof input.customerId !== "string" || input.customerId.length === 0) return null;
  if (returnInputLines(input).length === 0) return null;
  return {
    id: pendingReturnHistoryId(pending.id),
    organization_id: "",
    return_number: pending.provisionalNumber ?? fallbackLabel,
    customer_id: input.customerId,
    sales_transaction_id: returnInputString(input, "salesTransactionId"),
    return_date: returnInputString(input, "returnDate"),
    reason: returnInputString(input, "reason"),
    status: "confirmed",
    created_by_profile_id: null,
    created_at: pending.createdAt,
    updated_at: pending.updatedAt,
  };
}

/** A queued sales return's lines as the return-items rows. */
export function pendingReturnToSalesReturnItems(pending: LocalReturnRow): SalesReturnItem[] {
  const transactionId = pendingReturnHistoryId(pending.id);
  return returnInputLines(pending.input).map((line, index) => ({
    id: `${transactionId}:item:${index}`,
    sales_return_id: transactionId,
    product_id: Number(line.productId ?? 0),
    quantity: Number(line.quantity ?? 0),
    unit_price: line.unitPrice != null ? Number(line.unitPrice) : null,
    discount: line.discount != null ? Number(line.discount) : null,
    unit_mode: line.unitMode === "subunit" ? "subunit" : "main",
    batch_number: typeof line.batchNumber === "string" ? line.batchNumber : null,
    expiry_date: typeof line.expiryDate === "string" ? line.expiryDate : null,
    created_at: pending.createdAt,
  }));
}

/**
 * A queued purchase return as the returns-list row. Same discipline
 * as the sales return: a confirmed local return, never cancelled.
 */
export function pendingReturnToPurchaseReturn(
  pending: LocalReturnRow,
  fallbackLabel = "",
): PurchaseReturn | null {
  const input = pending.input;
  if (!input || typeof input.supplierId !== "string" || input.supplierId.length === 0) return null;
  if (returnInputLines(input).length === 0) return null;
  return {
    id: pendingReturnHistoryId(pending.id),
    organization_id: "",
    return_number: pending.provisionalNumber ?? fallbackLabel,
    supplier_id: input.supplierId,
    purchase_transaction_id: returnInputString(input, "purchaseTransactionId"),
    return_date: returnInputString(input, "returnDate"),
    reason: returnInputString(input, "reason"),
    status: "confirmed",
    created_by_profile_id: null,
    created_at: pending.createdAt,
    updated_at: pending.updatedAt,
  };
}

/** A queued purchase return's lines as the return-items rows. */
export function pendingReturnToPurchaseReturnItems(pending: LocalReturnRow): PurchaseReturnItem[] {
  const transactionId = pendingReturnHistoryId(pending.id);
  return returnInputLines(pending.input).map((line, index) => ({
    id: `${transactionId}:item:${index}`,
    purchase_return_id: transactionId,
    product_id: Number(line.productId ?? 0),
    quantity: Number(line.quantity ?? 0),
    unit_price: line.unitPrice != null ? Number(line.unitPrice) : null,
    unit_mode: line.unitMode === "subunit" ? "subunit" : "main",
    batch_number: typeof line.batchNumber === "string" ? line.batchNumber : null,
    expiry_date: typeof line.expiryDate === "string" ? line.expiryDate : null,
    created_at: pending.createdAt,
  }));
}

/**
 * Merge pending queue returns into the returns display lists. A
 * pending return is dropped when a synced row already carries its
 * `request_key`, so one return never renders twice (in practice the
 * queue row is already gone by then — the drain removes a confirmed
 * return before the refetch — so the dedupe is belt-and-braces for a
 * crash between the two). The merge is what flips a sale's history
 * badge to Returned while the return is still offline: the badge
 * math reads the merged returns + items.
 */
export function mergePendingSalesReturns(
  syncedReturns: SalesReturn[],
  syncedItems: SalesReturnItem[],
  pending: LocalReturnRow[],
  fallbackLabel = "",
): { returns: SalesReturn[]; items: SalesReturnItem[] } {
  const syncedRequestKeys = new Set(
    syncedReturns
      .map((row) => (typeof row.request_key === "string" ? row.request_key : ""))
      .filter((key) => key.length > 0),
  );
  const returns: SalesReturn[] = [];
  const items: SalesReturnItem[] = [];
  for (const row of pending) {
    if (row.kind !== "sales") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    const parsed = pendingReturnToSalesReturn(row, fallbackLabel);
    if (!parsed) continue;
    returns.push(parsed);
    items.push(...pendingReturnToSalesReturnItems(row));
  }
  return {
    returns: [...returns, ...syncedReturns],
    items: [...items, ...syncedItems],
  };
}

export function mergePendingPurchaseReturns(
  syncedReturns: PurchaseReturn[],
  syncedItems: PurchaseReturnItem[],
  pending: LocalReturnRow[],
  fallbackLabel = "",
): { returns: PurchaseReturn[]; items: PurchaseReturnItem[] } {
  const syncedRequestKeys = new Set(
    syncedReturns
      .map((row) => (typeof row.request_key === "string" ? row.request_key : ""))
      .filter((key) => key.length > 0),
  );
  const returns: PurchaseReturn[] = [];
  const items: PurchaseReturnItem[] = [];
  for (const row of pending) {
    if (row.kind !== "purchase") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    const parsed = pendingReturnToPurchaseReturn(row, fallbackLabel);
    if (!parsed) continue;
    returns.push(parsed);
    items.push(...pendingReturnToPurchaseReturnItems(row));
  }
  return {
    returns: [...returns, ...syncedReturns],
    items: [...items, ...syncedItems],
  };
}

/**
 * Merge only the items of pending sales returns into the
 * return-items list. The dedupe reads the synced returns'
 * `request_key` set (the items fetch holds the return ids, not the
 * full return rows): a pending return whose key already synced is
 * skipped, so its lines never render twice. Used by the
 * return-items fetch; the returns fetch uses
 * `mergePendingSalesReturns` above.
 */
export function mergePendingSalesReturnItems(
  syncedItems: SalesReturnItem[],
  syncedRequestKeys: ReadonlySet<string>,
  pending: LocalReturnRow[],
): SalesReturnItem[] {
  const items: SalesReturnItem[] = [];
  for (const row of pending) {
    if (row.kind !== "sales") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    items.push(...pendingReturnToSalesReturnItems(row));
  }
  return [...items, ...syncedItems];
}

/** Same discipline for the purchase return-items list. */
export function mergePendingPurchaseReturnItems(
  syncedItems: PurchaseReturnItem[],
  syncedRequestKeys: ReadonlySet<string>,
  pending: LocalReturnRow[],
): PurchaseReturnItem[] {
  const items: PurchaseReturnItem[] = [];
  for (const row of pending) {
    if (row.kind !== "purchase") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    items.push(...pendingReturnToPurchaseReturnItems(row));
  }
  return [...items, ...syncedItems];
}
