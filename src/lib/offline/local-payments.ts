/**
 * Slice S7 — offline payments seam (Offline Tier-1).
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts` and the purchases seam in
 * `src/lib/offline/local-purchases.ts`):
 * - Desktop build: the SQLite `local_payments` table over IPC
 *   (`electron/store.ts`), so an offline-created payment (or void)
 *   survives a browser-cache clear, a restart and an app update.
 * - Web build: the existing payment RPCs are used, never this seam
 *   — the localStorage backend below exists only as the desktop
 *   fallback when the store fails to open, so a payment saved
 *   offline is never lost (a payment can then briefly exist in both
 *   stores — that is safe, because the server dedupes by
 *   `request_key`: the same key re-posted replays the original
 *   payment instead of a duplicate).
 *
 * The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): it is the idempotency key the
 * server dedupes on (`create_payment_atomic` / `void_payment_atomic`,
 * phase 14), so a retry with the same key can never double-post.
 * `action` is "pay" (a new payment — `input` is the full
 * `PaymentSubmitInput`) or "void" (a void of an already-synced
 * payment — `input` is `{ kind, paymentId, reason }`). A void of an
 * unsynced local payment never becomes a row: the payment simply
 * leaves the queue, because it never existed server-side. The
 * provisional number (`PY-000123`) is allocated by the SQLite store
 * on insert; a localStorage-fallback row carries none, and the
 * history shows the "Pending" label for it instead.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** Fired after any local-payments mutation, so the payment lists refresh. */
export const LOCAL_PAYMENTS_CHANGED_EVENT = "tradeos:local-payments-changed";

export function notifyLocalPaymentsChanged(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_PAYMENTS_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the rows. */
  }
}

export type LocalPaymentAction = "pay" | "void";

/** One offline-created payment, or one offline void. */
export interface LocalPaymentRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  action: LocalPaymentAction;
  /** Full payment input (`PaymentSubmitInput`) or void input as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`PY-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server payment id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPaymentsBackend {
  /** Offline-created payments / voids for a scope, oldest first. */
  list(scope: string): Promise<LocalPaymentRow[]>;
  /** Insert or replace one local payment row; returns the stored row. */
  upsert(scope: string, row: LocalPaymentRow): Promise<LocalPaymentRow>;
  /** Delete one local payment row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

const paymentsStorageKey = (scope: string) => `tradeos:local-payments:v1:${scope}`;

function parsePayments(raw: string | null): LocalPaymentRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalPaymentRow =>
        !!item &&
        typeof (item as LocalPaymentRow).id === "string" &&
        ((item as LocalPaymentRow).action === "pay" || (item as LocalPaymentRow).action === "void") &&
        !!(item as LocalPaymentRow).input &&
        typeof (item as LocalPaymentRow).input === "object" &&
        !Array.isArray((item as LocalPaymentRow).input),
    );
  } catch {
    return [];
  }
}

/** Fallback (and desktop store-failure) backend: the rows in localStorage. */
export class LocalStorageLocalPaymentsBackend implements LocalPaymentsBackend {
  async list(scope: string): Promise<LocalPaymentRow[]> {
    if (typeof window === "undefined") return [];
    return parsePayments(window.localStorage.getItem(paymentsStorageKey(scope)));
  }

  async upsert(scope: string, row: LocalPaymentRow): Promise<LocalPaymentRow> {
    const rows = await this.list(scope);
    const index = rows.findIndex((item) => item.id === row.id);
    // A rewrite keeps the first-created time and the provisional
    // number it already had (a retry must not move a payment's
    // history number); the sync columns come from the caller.
    const stored: LocalPaymentRow =
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

  private writeRaw(scope: string, rows: LocalPaymentRow[]): void {
    try {
      if (rows.length === 0) window.localStorage.removeItem(paymentsStorageKey(scope));
      else window.localStorage.setItem(paymentsStorageKey(scope), JSON.stringify(rows));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the row. */
    }
  }
}

type DesktopLocalPaymentsBridge = {
  list(scope: string): Promise<LocalPaymentRow[]>;
  upsert(scope: string, row: LocalPaymentRow): Promise<LocalPaymentRow>;
  remove(scope: string, id: string): Promise<void>;
};

/** The preload bridge's local-payments methods, or null outside the desktop shell. */
export function desktopLocalPaymentsBridge(): DesktopLocalPaymentsBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localPayments?: DesktopLocalPaymentsBridge } })
    .aankhDesktop;
  return bridge?.localPayments ?? null;
}

/**
 * Desktop build: the SQLite rows over IPC, with a localStorage fallback
 * per call so a store failure never loses a payment (see the module
 * header for why a payment briefly living in both stores is safe).
 */
export class DesktopLocalPaymentsBackend implements LocalPaymentsBackend {
  private readonly fallback = new LocalStorageLocalPaymentsBackend();

  async list(scope: string): Promise<LocalPaymentRow[]> {
    const bridge = desktopLocalPaymentsBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return await bridge.list(scope);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, row: LocalPaymentRow): Promise<LocalPaymentRow> {
    const bridge = desktopLocalPaymentsBridge();
    if (!bridge) return this.fallback.upsert(scope, row);
    try {
      return await bridge.upsert(scope, row);
    } catch {
      return this.fallback.upsert(scope, row);
    }
  }

  async remove(scope: string, id: string): Promise<void> {
    const bridge = desktopLocalPaymentsBridge();
    if (!bridge) return this.fallback.remove(scope, id);
    try {
      await bridge.remove(scope, id);
    } catch {
      await this.fallback.remove(scope, id);
    }
  }
}

/** The local-payments backend for this build: SQLite on desktop, localStorage fallback. */
export function getLocalPaymentsBackend(): LocalPaymentsBackend {
  if (isDesktopApp() && desktopLocalPaymentsBridge()) return new DesktopLocalPaymentsBackend();
  return new LocalStorageLocalPaymentsBackend();
}

/** A row is syncable only while it is still pending. */
export function isPendingLocalPayment(row: LocalPaymentRow): boolean {
  return row.syncStatus === "pending";
}

/** A new offline-created payment: the client request key is the row id (and the server idempotency key). */
export function newLocalPaymentRow(input: Record<string, unknown>): LocalPaymentRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    action: "pay",
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

/** A new offline void of an already-synced payment. */
export function newLocalVoidRow(input: Record<string, unknown>): LocalPaymentRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    action: "void",
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

/** Synthetic history id for a pending payment: `pending:<requestKey>`. */
export const PENDING_PAYMENT_HISTORY_ID_PREFIX = "pending:";

export function pendingPaymentHistoryId(requestKey: string): string {
  return `${PENDING_PAYMENT_HISTORY_ID_PREFIX}${requestKey}`;
}

/** True for a synthetic pending row (never a server row). */
export function isPendingPaymentHistoryId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_PAYMENT_HISTORY_ID_PREFIX);
}

/** Payment ids with a pending void — their mirrored rows read as voided until the void syncs. */
export function pendingVoidPaymentIds(rows: LocalPaymentRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.action !== "void") continue;
    const paymentId = row.input.paymentId;
    if (typeof paymentId === "string" && paymentId.length > 0) ids.add(paymentId);
  }
  return ids;
}

function paymentInputNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentInputString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A queued payment as the payments-list row. `fallbackLabel` is not
 * rendered as a number (payments have no invoice number) — the row is
 * recognised as pending by its synthetic id. Returns null when the
 * input has no party or no positive amount. A pending payment counts
 * toward the customer's derived outstanding exactly like a server
 * payment: the balance derivation reads the merged list.
 */
export function pendingPaymentToCustomerPayment(
  pending: LocalPaymentRow,
): Record<string, unknown> | null {
  const input = pending.input;
  if (pending.action !== "pay") return null;
  if (typeof input.partyId !== "string" || input.partyId.length === 0) return null;
  if (paymentInputNumber(input, "amount") <= 0) return null;
  return {
    id: pendingPaymentHistoryId(pending.id),
    customer_id: input.partyId,
    amount: paymentInputNumber(input, "amount"),
    notes: paymentInputString(input, "notes"),
    payment_date: paymentInputString(input, "paymentDate"),
    created_at: pending.createdAt,
    payment_method: paymentInputString(input, "paymentMethod") ?? "cash",
    reference: paymentInputString(input, "reference"),
    voided_at: null,
    void_reason: null,
    edited_at: null,
  };
}

/** Same shape for the supplier payments list. */
export function pendingPaymentToSupplierPayment(
  pending: LocalPaymentRow,
): Record<string, unknown> | null {
  const input = pending.input;
  if (pending.action !== "pay") return null;
  if (typeof input.partyId !== "string" || input.partyId.length === 0) return null;
  if (paymentInputNumber(input, "amount") <= 0) return null;
  return {
    id: pendingPaymentHistoryId(pending.id),
    supplier_id: input.partyId,
    amount: paymentInputNumber(input, "amount"),
    notes: paymentInputString(input, "notes"),
    payment_date: paymentInputString(input, "paymentDate"),
    created_at: pending.createdAt,
    payment_method: paymentInputString(input, "paymentMethod") ?? "cash",
    reference: paymentInputString(input, "reference"),
    voided_at: null,
    void_reason: null,
    edited_at: null,
  };
}

/** A queued payment's allocations as the allocation rows (customer side). */
export function pendingPaymentToCustomerAllocations(pending: LocalPaymentRow): Array<Record<string, unknown>> {
  if (pending.action !== "pay") return [];
  const allocations = pending.input.allocations;
  if (!Array.isArray(allocations)) return [];
  const paymentId = pendingPaymentHistoryId(pending.id);
  return allocations
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map((row, index) => ({
      id: `${paymentId}:alloc:${index}`,
      customer_payment_id: paymentId,
      sales_transaction_id: typeof row.invoice_id === "string" ? row.invoice_id : String(row.invoice_id ?? ""),
      amount: typeof row.amount === "number" ? row.amount : Number(row.amount ?? 0),
      created_at: pending.createdAt,
    }));
}

/** A queued payment's allocations as the allocation rows (supplier side). */
export function pendingPaymentToSupplierAllocations(pending: LocalPaymentRow): Array<Record<string, unknown>> {
  if (pending.action !== "pay") return [];
  const allocations = pending.input.allocations;
  if (!Array.isArray(allocations)) return [];
  const paymentId = pendingPaymentHistoryId(pending.id);
  return allocations
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map((row, index) => ({
      id: `${paymentId}:alloc:${index}`,
      supplier_payment_id: paymentId,
      purchase_transaction_id: typeof row.invoice_id === "string" ? row.invoice_id : String(row.invoice_id ?? ""),
      amount: typeof row.amount === "number" ? row.amount : Number(row.amount ?? 0),
      created_at: pending.createdAt,
    }));
}

/**
 * Merge pending queue payments into the payments display lists. A
 * pending payment is dropped when a synced row already carries its
 * `request_key`, so one payment never renders twice (in practice the
 * queue row is already gone by then — the drain removes a confirmed
 * payment before the refetch — so the dedupe is belt-and-braces for
 * a crash between the two). Pending voids are applied on top: a
 * mirrored payment with a pending void reads as voided (its amount
 * covers nothing), exactly as the server will show it after sync.
 */
export function mergePendingCustomerPayments<T extends { id: string | number; request_key?: unknown; voided_at?: unknown }>(
  syncedPayments: T[],
  pending: LocalPaymentRow[],
): T[] {
  const syncedRequestKeys = new Set(
    syncedPayments
      .map((row) => (typeof row.request_key === "string" ? row.request_key : ""))
      .filter((key) => key.length > 0),
  );
  // A pending void marks its payment voided at the void's own time
  // (the server will stamp its own voided_at after sync; the next
  // fetch heals any difference).
  const voidedAtByPaymentId = new Map<string, string>();
  for (const row of pending) {
    if (row.action !== "void") continue;
    const paymentId = row.input.paymentId;
    if (typeof paymentId === "string" && paymentId.length > 0 && !voidedAtByPaymentId.has(paymentId)) {
      voidedAtByPaymentId.set(paymentId, row.createdAt);
    }
  }
  const merged = syncedPayments.map((row) => {
    const voidedAt = voidedAtByPaymentId.get(String(row.id));
    return voidedAt && !row.voided_at ? ({ ...row, voided_at: voidedAt } as T) : row;
  });
  const pendingRows: T[] = [];
  for (const row of pending) {
    if (row.action !== "pay") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    const parsed = pendingPaymentToCustomerPayment(row);
    if (!parsed) continue;
    pendingRows.push(parsed as unknown as T);
  }
  return [...pendingRows, ...merged];
}

export function mergePendingSupplierPayments<T extends { id: string | number; request_key?: unknown; voided_at?: unknown }>(
  syncedPayments: T[],
  pending: LocalPaymentRow[],
): T[] {
  const syncedRequestKeys = new Set(
    syncedPayments
      .map((row) => (typeof row.request_key === "string" ? row.request_key : ""))
      .filter((key) => key.length > 0),
  );
  // A pending void marks its payment voided at the void's own time
  // (the server will stamp its own voided_at after sync; the next
  // fetch heals any difference).
  const voidedAtByPaymentId = new Map<string, string>();
  for (const row of pending) {
    if (row.action !== "void") continue;
    const paymentId = row.input.paymentId;
    if (typeof paymentId === "string" && paymentId.length > 0 && !voidedAtByPaymentId.has(paymentId)) {
      voidedAtByPaymentId.set(paymentId, row.createdAt);
    }
  }
  const merged = syncedPayments.map((row) => {
    const voidedAt = voidedAtByPaymentId.get(String(row.id));
    return voidedAt && !row.voided_at ? ({ ...row, voided_at: voidedAt } as T) : row;
  });
  const pendingRows: T[] = [];
  for (const row of pending) {
    if (row.action !== "pay") continue;
    if (syncedRequestKeys.has(row.id)) continue;
    const parsed = pendingPaymentToSupplierPayment(row);
    if (!parsed) continue;
    pendingRows.push(parsed as unknown as T);
  }
  return [...pendingRows, ...merged];
}

/** Merge a pending payment's allocations into the allocations list (customer side). */
export function mergePendingCustomerAllocations(
  syncedAllocations: Array<Record<string, unknown>>,
  pending: LocalPaymentRow[],
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const row of pending) {
    if (row.action !== "pay") continue;
    items.push(...pendingPaymentToCustomerAllocations(row));
  }
  return [...items, ...syncedAllocations];
}

/** Merge a pending payment's allocations into the allocations list (supplier side). */
export function mergePendingSupplierAllocations(
  syncedAllocations: Array<Record<string, unknown>>,
  pending: LocalPaymentRow[],
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const row of pending) {
    if (row.action !== "pay") continue;
    items.push(...pendingPaymentToSupplierAllocations(row));
  }
  return [...items, ...syncedAllocations];
}
