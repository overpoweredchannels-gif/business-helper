/**
 * Slice S3 — Sync issues (Offline Tier-1).
 *
 * A sale the server refuses is never dropped and never lost: it is PARKED
 * here with its full payload, so the owner can retry it (same
 * idempotency key — a retry after the cause is fixed replays the same
 * sale, never a duplicate) or discard it. A provisional number that
 * could not yet be linked to its cloud invoice waits here as a
 * `provisional-link` row until the link succeeds. Rows are never
 * auto-deleted; discard is an explicit owner action (a status, not a
 * delete) and a corrected record is a NEW sale with a new idempotency
 * key — never an edit of the parked row.
 *
 * One store, two backends (same seam as the sale queue in
 * `src/lib/offline/local-store.ts`):
 * - Desktop build: the SQLite `sync_issues` table over IPC
 *   (`electron/store.ts`), so issues survive a browser-cache clear.
 * - Web build: localStorage `tradeos:sync-issues:v1:${scope}`. The web
 *   app keeps its existing queue-notice behaviour for rejections; the
 *   issues store is still written there so the drain code stays shared.
 *
 * Why the server can refuse a sale that already printed a receipt —
 * the 2-PC last-unit conflict (UMAIR's decision 4, 2026-11-17): two
 * PCs offline can both sell the last unit. The first sale to sync
 * proceeds normally. The second sale's `create_sales_invoice_atomic`
 * call fails inside the `inventory_sync_sale_item` trigger, which
 * raises `Insufficient stock, including bonus units, for product …`
 * (or the older `Sale cannot be saved: overselling is blocked …`)
 * when the org/product overselling policy is `block`. The RPC itself
 * has no stock check and no per-sale override, so there is NO
 * server-side path that records the second sale while the policy is
 * `block` — inventing a direct insert would bypass the stock trigger
 * and the atomic RPC's ledger writes. The defined path is therefore:
 * park the sale locally, flag it in Sync issues, and let the owner
 * fix the stock (purchase / adjustment) and retry — or change the
 * org's overselling policy to `allow` (in which case the sale syncs
 * normally and stock goes negative, with no flag to raise). The sale
 * is never lost, never double-posted, and the cashier's cash record
 * is not broken.
 *
 * Slice S5 adds customer issues (`customer-conflict`): two counters
 * can edit the same customer offline; the server keeps the newer
 * copy (last-write-wins on `updated_at`) and the superseded edit is
 * parked here with the local row id, so the owner can Retry it
 * (re-applies the parked copy with a fresh timestamp) or discard it.
 * A customer issue never auto-retries and is never auto-deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDesktopApp } from "@/lib/offline/identity-cache";
import { calculateSaleAmounts } from "@/lib/sales/sale-amounts";
import type { AtomicSaleInput, PendingSale } from "@/lib/sales/atomic-sale-client";

/** Fired after any issues-store mutation, so the Sync issues panel refreshes. */
export const SYNC_ISSUES_CHANGED_EVENT = "tradeos:sync-issues-changed";

export function notifySyncIssuesChanged(): void {
  try {
    window.dispatchEvent(new Event(SYNC_ISSUES_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the issues. */
  }
}

export type SyncIssueKind =
  | "stock-conflict"
  | "fingerprint-mismatch"
  | "rejected"
  | "provisional-link"
  | "customer-conflict"
  | "supplier-conflict";
export type SyncIssueStatus = "open" | "resolved" | "discarded";

export interface SyncIssue {
  id: string;
  scope: string;
  kind: SyncIssueKind;
  /** The sale's idempotency key, for sale kinds; null for provisional-link rows. */
  requestId: string | null;
  /** Local provisional number (`L-000123`) of the parked sale, if it had one. */
  provisionalNumber: string | null;
  /** Server invoice number (`S-100xxx`) once the sale is confirmed. */
  serverInvoiceNumber: string | null;
  /** Server `sales_transactions.id` once the sale is confirmed. */
  serverId: string | null;
  customerName: string | null;
  /** Sale total in books currency, for the issue list. */
  total: number | null;
  /** Human-readable reason (the server message, or the link failure). */
  reason: string;
  /** Full `AtomicSaleInput` for a parked sale (Retry re-submits it). Null for provisional-link rows. */
  payload: AtomicSaleInput | null;
  status: SyncIssueStatus;
  /** Last link/sync error text; provisional-link rows stay silent in the UI while this is null. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Slice S5 — the local customer row id for a customer issue
   * (`customer-conflict` / customer `rejected`). Retry finds the row
   * by this id; null for sale issues.
   */
  customerId: string | null;
  /**
   * Slice S6 — the local supplier row id for a supplier issue
   * (`supplier-conflict` / supplier `rejected`). Retry finds the row
   * by this id; null for every other issue.
   */
  supplierId: string | null;
  /**
   * Slice S6 — the local purchase row id (= the client request key)
   * for a purchase issue (`fingerprint-mismatch` / purchase
   * `rejected`). Retry finds the row by this id; null for every
   * other issue.
   */
  purchaseId: string | null;
}

export interface SyncIssuesBackend {
  /** Issues for a scope, oldest first (open, resolved and discarded). */
  list(scope: string): Promise<SyncIssue[]>;
  /**
   * Insert an issue, or update the already-open one for the same sale
   * (matched by `requestId` for sale kinds, by `serverId` for
   * provisional-link rows). Returns the stored row.
   */
  upsert(scope: string, issue: SyncIssue): Promise<SyncIssue>;
  /** Set one issue's status (`open` | `resolved` | `discarded`). */
  setStatus(scope: string, id: string, status: SyncIssueStatus): Promise<void>;
  /** Update one issue's reason / sync error text. */
  update(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): Promise<void>;
}

const issuesStorageKey = (scope: string) => `tradeos:sync-issues:v1:${scope}`;

function parseIssues(raw: string | null): SyncIssue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SyncIssue =>
        !!item &&
        typeof (item as SyncIssue).id === "string" &&
        typeof (item as SyncIssue).kind === "string" &&
        typeof (item as SyncIssue).reason === "string" &&
        typeof (item as SyncIssue).status === "string",
    );
  } catch {
    return [];
  }
}

/** Web build (and fallback): the issues list in localStorage. */
export class LocalStorageSyncIssuesBackend implements SyncIssuesBackend {
  async list(scope: string): Promise<SyncIssue[]> {
    if (typeof window === "undefined") return [];
    return parseIssues(window.localStorage.getItem(issuesStorageKey(scope)));
  }

  async upsert(scope: string, issue: SyncIssue): Promise<SyncIssue> {
    const issues = await this.list(scope);
    const now = new Date().toISOString();
    const matchIndex = issues.findIndex(
      (item) =>
        item.status === "open" &&
        ((issue.requestId != null && item.requestId === issue.requestId) ||
          (issue.requestId == null && issue.serverId != null && item.serverId === issue.serverId)),
    );
    let stored: SyncIssue;
    if (matchIndex >= 0) {
      stored = { ...issue, id: issues[matchIndex].id, createdAt: issues[matchIndex].createdAt, updatedAt: now };
      issues[matchIndex] = stored;
    } else {
      stored = { ...issue, updatedAt: now };
      issues.push(stored);
    }
    this.writeRaw(scope, issues);
    return stored;
  }

  async setStatus(scope: string, id: string, status: SyncIssueStatus): Promise<void> {
    const issues = await this.list(scope);
    const found = issues.find((item) => item.id === id);
    if (!found) return;
    found.status = status;
    found.updatedAt = new Date().toISOString();
    this.writeRaw(scope, issues);
  }

  async update(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): Promise<void> {
    const issues = await this.list(scope);
    const found = issues.find((item) => item.id === id);
    if (!found) return;
    if (patch.reason !== undefined) found.reason = patch.reason;
    if (patch.syncError !== undefined) found.syncError = patch.syncError;
    found.updatedAt = new Date().toISOString();
    this.writeRaw(scope, issues);
  }

  private writeRaw(scope: string, issues: SyncIssue[]): void {
    try {
      if (issues.length === 0) window.localStorage.removeItem(issuesStorageKey(scope));
      else window.localStorage.setItem(issuesStorageKey(scope), JSON.stringify(issues));
    } catch {
      /* Storage full or blocked: the caller treats a failed write as a failed park. */
      throw new Error("Sync issues could not be saved on this device");
    }
  }
}

/** One sync issue as it crosses the IPC bridge (plain JSON). */
export interface SyncIssueIpcRow {
  id: string;
  scope: string;
  kind: string;
  requestId: string | null;
  provisionalNumber: string | null;
  serverInvoiceNumber: string | null;
  serverId: string | null;
  customerName: string | null;
  total: number | null;
  reason: string;
  payloadJson: string | null;
  status: string;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Slice S5 — the local customer row id for a customer issue. */
  customerId: string | null;
  /** Slice S6 — the local supplier row id for a supplier issue. */
  supplierId: string | null;
  /** Slice S6 — the local purchase row id for a purchase issue. */
  purchaseId: string | null;
}

type DesktopSyncIssuesBridge = {
  list(scope: string): Promise<SyncIssueIpcRow[]>;
  upsert(issue: SyncIssueIpcRow): Promise<SyncIssueIpcRow>;
  setStatus(scope: string, id: string, status: string): Promise<void>;
  update(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): Promise<void>;
};

/** The preload bridge's sync-issues methods, or null outside the desktop shell. */
export function desktopSyncIssuesBridge(): DesktopSyncIssuesBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { syncIssues?: DesktopSyncIssuesBridge } }).aankhDesktop;
  return bridge?.syncIssues ?? null;
}

function toIpcRow(issue: SyncIssue): SyncIssueIpcRow {
  return {
    id: issue.id,
    scope: issue.scope,
    kind: issue.kind,
    requestId: issue.requestId,
    provisionalNumber: issue.provisionalNumber,
    serverInvoiceNumber: issue.serverInvoiceNumber,
    serverId: issue.serverId,
    customerName: issue.customerName,
    total: issue.total,
    reason: issue.reason,
    payloadJson: issue.payload ? JSON.stringify(issue.payload) : null,
    status: issue.status,
    syncError: issue.syncError,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    customerId: issue.customerId ?? null,
    supplierId: issue.supplierId ?? null,
    purchaseId: issue.purchaseId ?? null,
  };
}

function fromIpcRow(row: SyncIssueIpcRow): SyncIssue {
  let payload: AtomicSaleInput | null = null;
  if (row.payloadJson) {
    try {
      const parsed = JSON.parse(row.payloadJson) as unknown;
      if (parsed && typeof parsed === "object") payload = parsed as AtomicSaleInput;
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind as SyncIssueKind,
    requestId: row.requestId,
    provisionalNumber: row.provisionalNumber,
    serverInvoiceNumber: row.serverInvoiceNumber,
    serverId: row.serverId,
    customerName: row.customerName,
    total: row.total,
    reason: row.reason,
    payload,
    status: row.status as SyncIssueStatus,
    syncError: row.syncError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customerId: row.customerId ?? null,
    supplierId: row.supplierId ?? null,
    purchaseId: row.purchaseId ?? null,
  };
}

/**
 * Desktop build: the SQLite issues table over IPC, with a localStorage
 * fallback per call so a store failure never loses a parked sale (the
 * caller falls back to the queue notice when even the fallback fails).
 */
export class DesktopSyncIssuesBackend implements SyncIssuesBackend {
  private readonly fallback = new LocalStorageSyncIssuesBackend();

  async list(scope: string): Promise<SyncIssue[]> {
    const bridge = desktopSyncIssuesBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return (await bridge.list(scope)).map(fromIpcRow);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async upsert(scope: string, issue: SyncIssue): Promise<SyncIssue> {
    const bridge = desktopSyncIssuesBridge();
    if (!bridge) return this.fallback.upsert(scope, issue);
    try {
      return fromIpcRow(await bridge.upsert(toIpcRow(issue)));
    } catch {
      return this.fallback.upsert(scope, issue);
    }
  }

  async setStatus(scope: string, id: string, status: SyncIssueStatus): Promise<void> {
    const bridge = desktopSyncIssuesBridge();
    if (!bridge) return this.fallback.setStatus(scope, id, status);
    try {
      await bridge.setStatus(scope, id, status);
    } catch {
      await this.fallback.setStatus(scope, id, status);
    }
  }

  async update(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): Promise<void> {
    const bridge = desktopSyncIssuesBridge();
    if (!bridge) return this.fallback.update(scope, id, patch);
    try {
      await bridge.update(scope, id, patch);
    } catch {
      await this.fallback.update(scope, id, patch);
    }
  }
}

/** The issues backend for this build: SQLite on desktop, localStorage on web. */
export function getSyncIssuesBackend(): SyncIssuesBackend {
  if (isDesktopApp() && desktopSyncIssuesBridge()) return new DesktopSyncIssuesBackend();
  return new LocalStorageSyncIssuesBackend();
}

/**
 * What the owner sees: open issues, except provisional-link rows whose
 * link has not failed yet (the column migration may simply not be run
 * — a silent retry, not something the owner must act on). Once a link
 * fails for another reason, its `syncError` is set and the row shows.
 */
export function openSyncIssues(issues: SyncIssue[]): SyncIssue[] {
  return issues.filter(
    (issue) => issue.status === "open" && !(issue.kind === "provisional-link" && !issue.syncError),
  );
}

/**
 * Classify a server rejection for the issue list. The stock trigger's
 * message differs by migration generation — match both wordings.
 */
export function classifySaleRejection(message: string): Exclude<SyncIssueKind, "provisional-link"> {
  if (/insufficient stock|overselling is blocked/i.test(message)) return "stock-conflict";
  if (/already used for different sale contents/i.test(message)) return "fingerprint-mismatch";
  return "rejected";
}

/** Retry is safe only when the same key + same payload can succeed: a
 * fingerprint mismatch fails the same way forever, so it has no Retry.
 * A customer / supplier / purchase issue retries by its local row
 * (the owner re-applies the parked copy with a fresh timestamp — see
 * `retryCustomerSyncIssue` / `retrySupplierSyncIssue` /
 * `retryPurchaseSyncIssue`), so it can retry whenever the row id is
 * known — except a fingerprint mismatch, which can never succeed. */
export function syncIssueCanRetry(issue: SyncIssue): boolean {
  if (issue.customerId) return true;
  if (issue.supplierId) return true;
  if (issue.purchaseId) return issue.kind !== "fingerprint-mismatch";
  return issue.kind !== "fingerprint-mismatch" && issue.kind !== "provisional-link" && issue.payload !== null;
}

/**
 * Park a refused sale in Sync issues. Returns the stored issue, or null
 * when the store write failed — the caller then falls back to the queue
 * notice so the sale still surfaces instead of vanishing.
 */
export async function parkSaleAsSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  attempt: PendingSale,
  reason: string,
): Promise<SyncIssue | null> {
  let total: number | null = null;
  try {
    total = calculateSaleAmounts(
      attempt.input.lines.map((line) => ({
        quantity: line.quantity,
        sellingPrice: line.selling_price,
        discount: line.discount,
      })),
      {
        invoiceDiscount: attempt.input.invoice_discount,
        invoiceDiscountType: attempt.input.invoice_discount_type,
        taxRate: attempt.input.tax_rate,
      },
    ).total;
  } catch {
    total = null;
  }
  let customerName: string | null = null;
  try {
    const { data } = (await supabase
      .from("customers")
      .select("customer_name")
      .eq("id", attempt.input.customer_id)
      .maybeSingle()) as { data: { customer_name?: string } | null };
    customerName = data?.customer_name ?? null;
  } catch {
    customerName = null;
  }
  const now = new Date().toISOString();
  const issue: SyncIssue = {
    id: crypto.randomUUID(),
    scope,
    kind: classifySaleRejection(reason),
    requestId: attempt.requestId,
    provisionalNumber: attempt.provisionalNumber ?? null,
    serverInvoiceNumber: null,
    serverId: null,
    customerName,
    total,
    reason,
    payload: attempt.input,
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    customerId: null,
    supplierId: null,
    purchaseId: null,
  };
  try {
    const stored = await getSyncIssuesBackend().upsert(scope, issue);
    notifySyncIssuesChanged();
    return stored;
  } catch {
    return null;
  }
}

/**
 * A sale that later confirms (e.g. a retried parked sale) resolves its
 * open issue. Best-effort: a failed resolve must never break a
 * confirmed sale.
 */
export async function resolveIssueByRequestId(scope: string, requestId: string): Promise<void> {
  try {
    const backend = getSyncIssuesBackend();
    const issues = await backend.list(scope);
    const open = issues.find((issue) => issue.requestId === requestId && issue.status === "open");
    if (!open) return;
    await backend.setStatus(scope, open.id, "resolved");
    notifySyncIssuesChanged();
  } catch {
    /* Ignored — see above. */
  }
}
