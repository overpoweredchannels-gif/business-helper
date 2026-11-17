/**
 * Slice S6 — purchase sync (Offline Tier-1).
 *
 * Offline-created purchases sync AFTER sales in the engine's order
 * (design §4: customers + suppliers first, then sales, then
 * purchases — a purchase references a supplier that must already be
 * synced). The dedup key is the client `request_key` itself (the
 * local row `id`): the server dedupes on
 * `purchase_transactions.request_key` (unique per org, phase 10), so
 * retrying the same key replays the original purchase instead of a
 * duplicate or a second stock movement.
 *
 * - Status-check first (`get_purchase_request_status` — new SQL in
 *   `src/lib/migrations/get_purchase_request_status.sql`, UMAIR runs
 *   it disposable-first; until it is run the RPC does not exist and
 *   the check fails soft to "unknown", exactly like a lost response).
 *   A lost POST response is the same path: the status check finds
 *   the confirmed purchase and lands it in the mirror.
 * - Submit through the cloud `POST /api/purchases` route with the
 *   user's token (design §2 rule: `create_purchase_atomic` is
 *   service-role-only, so the client never calls the RPC directly
 *   and the service-role key never ships in the desktop app).
 * - Same key + different payload → the server raises "already used
 *   for a different purchase" → parked as `fingerprint-mismatch`
 *   (never auto-retried; a corrected purchase is a NEW purchase
 *   with a NEW key). Any other definitive 4xx parks as `rejected`.
 * - A network failure or 5xx leaves the row queued; the next
 *   trigger retries. A confirmed purchase lands its transaction +
 *   items in the history mirror at once, so the desktop history
 *   stays correct even if the app quits before the refetch runs.
 * - Owner Retry (from Sync issues) re-submits the parked row with
 *   its ORIGINAL key — safe once the cause is fixed (e.g. the
 *   supplier has now synced). The parked row is never auto-deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  getLocalPurchasesBackend,
  isPendingLocalPurchase,
  notifyLocalPurchasesChanged,
  type LocalPurchaseRow,
} from "@/lib/offline/local-purchases";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  resolveIssueByRequestId,
  type SyncIssue,
  type SyncIssueKind,
} from "@/lib/offline/sync-issues";
import { pendingPurchaseTotal } from "@/lib/purchases/pending-purchase-history";
import { upsertHistoryMirrorRow } from "@/lib/offline/history-mirror";

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** The server side of the purchase sync: one status check. */
export interface PurchaseServer {
  /** The confirmed purchase for a request key, or "unknown" when there is none (or the check failed). */
  checkStatus(requestKey: string): Promise<{
    status: "unknown" | "confirmed";
    transaction?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
  }>;
}

/** The real status check: `get_purchase_request_status` (new SQL, S6). */
export function createPurchaseServer(supabase: SupabaseClient): PurchaseServer {
  return {
    async checkStatus(requestKey: string) {
      const { data, error } = await supabase.rpc("get_purchase_request_status", {
        p_request_key: requestKey,
      });
      if (error) throw error;
      const result = data as { status?: unknown; result?: unknown } | null;
      if (result?.status !== "confirmed") return { status: "unknown" };
      const payload = result.result as { transaction?: unknown; items?: unknown } | null;
      const transaction =
        payload?.transaction && typeof payload.transaction === "object"
          ? (payload.transaction as Record<string, unknown>)
          : undefined;
      const items = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : [];
      if (!transaction) return { status: "unknown" };
      return { status: "confirmed", transaction, items };
    },
  };
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

interface SubmitPurchaseResult {
  ok: boolean;
  status: number;
  transaction?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  error?: string;
}

/** POST one purchase to the cloud route with its client request key. Never throws. */
async function submitPurchase(
  fetchImpl: FetchImpl,
  input: Record<string, unknown>,
  requestKey: string,
): Promise<SubmitPurchaseResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, request_key: requestKey }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  const result = await readJsonBody(response);
  if (!response.ok || !result.transaction) {
    return {
      ok: false,
      status: response.status,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  }
  const transaction = result.transaction as Record<string, unknown>;
  const items = Array.isArray(result.items)
    ? (result.items as Array<Record<string, unknown>>)
    : [];
  return { ok: true, status: response.status, transaction, items };
}

/**
 * Land one confirmed purchase in the history mirror immediately.
 * The confirmed row + its items come from the route result, so the
 * desktop history stays correct even if the app quits before the
 * refetch runs. Never throws: a failed upsert is healed by the next
 * fetch.
 */
export async function landConfirmedPurchaseMirror(
  scope: string,
  transaction: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): Promise<void> {
  try {
    const serverId = typeof transaction.id === "string" ? transaction.id : "";
    if (!serverId) return;
    await upsertHistoryMirrorRow("purchase_transaction", scope, { id: serverId, data: transaction });
    for (const item of items) {
      const itemId = typeof item.id === "string" ? item.id : String(item.id ?? "");
      if (!itemId) continue;
      await upsertHistoryMirrorRow("purchase_item", scope, { id: itemId, data: item });
    }
  } catch {
    /* Mirror is a cache; the next fetch heals it. */
  }
}

function purchaseDisplayTotal(row: LocalPurchaseRow): number | null {
  try {
    return pendingPurchaseTotal(row.input);
  } catch {
    return null;
  }
}

/**
 * Park a purchase problem in Sync issues. Returns the stored issue,
 * or null when the store write failed — the caller then leaves the
 * row queued so the purchase still surfaces instead of vanishing.
 */
export async function parkPurchaseAsSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  row: LocalPurchaseRow,
  kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected">,
  reason: string,
): Promise<SyncIssue | null> {
  let supplierName: string | null = null;
  try {
    const supplierId = row.input.supplier_id;
    if (typeof supplierId === "string" && supplierId.length > 0) {
      const { data } = (await supabase
        .from("suppliers")
        .select("supplier_name")
        .eq("id", supplierId)
        .maybeSingle()) as { data: { supplier_name?: string } | null };
      supplierName = data?.supplier_name ?? null;
    }
  } catch {
    supplierName = null;
  }
  const now = new Date().toISOString();
  const issue: SyncIssue = {
    id: crypto.randomUUID(),
    scope,
    kind,
    requestId: row.id,
    provisionalNumber: row.provisionalNumber,
    serverInvoiceNumber: null,
    serverId: row.serverId,
    customerName: supplierName,
    total: purchaseDisplayTotal(row),
    reason,
    payload: null,
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    customerId: null,
    supplierId: null,
    purchaseId: row.id,
    returnId: null,
    paymentId: null,
    expenseId: null,
  };
  try {
    const stored = await getSyncIssuesBackend().upsert(scope, issue);
    notifySyncIssuesChanged();
    return stored;
  } catch {
    return null;
  }
}

export type PurchaseSyncOutcome = "synced" | "parked" | "queued";

export interface PurchaseSyncOptions {
  fetchImpl?: FetchImpl;
  server?: PurchaseServer;
  /**
   * Slice S7 — called for every purchase that confirms, with the
   * server transaction. The engine passes it through so the caller
   * (page.tsx) can attach the expense-review reminder to a synced
   * purchase that has no linked expense yet — the S6 gap.
   */
  onConfirmed?: (row: LocalPurchaseRow, transaction: Record<string, unknown>) => void;
}

/**
 * Sync one pending local purchase row. Never throws: a network
 * failure or 5xx leaves the row queued (`queued`), a definitive
 * rejection parks it (`parked`), a confirmed row is removed from
 * the local store (`synced`).
 */
export async function syncOnePurchase(
  supabase: SupabaseClient,
  scope: string,
  row: LocalPurchaseRow,
  options: PurchaseSyncOptions = {},
): Promise<PurchaseSyncOutcome> {
  const fetchImpl = options.fetchImpl ?? authorizedFetch;
  const server = options.server ?? createPurchaseServer(supabase);
  const backend = getLocalPurchasesBackend();

  const markRejected = async (reason: string): Promise<PurchaseSyncOutcome> => {
    try {
      await backend.upsert(scope, { ...row, syncStatus: "rejected", syncError: reason });
    } catch {
      /* The park below is the visible record; the row stays pending. */
    }
    return "parked";
  };

  const confirmRow = async (
    transaction: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
  ): Promise<PurchaseSyncOutcome> => {
    await landConfirmedPurchaseMirror(scope, transaction, items);
    // Slice S7 — the confirmed purchase is reported to the caller
    // before the local row is removed, so the expense-review
    // reminder can be attached to the synced purchase (S6 gap).
    try {
      options.onConfirmed?.(row, transaction);
    } catch {
      /* The reminder is advisory; the purchase is already synced. */
    }
    try {
      await backend.remove(scope, row.id);
    } catch {
      /* A leftover row replays harmlessly (same key → replay). */
    }
    // A purchase that confirms after its issue was parked resolves
    // the issue — the panel must not keep showing it.
    await resolveIssueByRequestId(scope, row.id);
    return "synced";
  };

  try {
    // Status-check first: a lost POST response still leaves the
    // purchase on the server, and the check finds it. Until the new
    // status SQL is run the RPC does not exist — the check throws
    // and the submit below runs, exactly like a lost response.
    let status: { status: "unknown" | "confirmed"; transaction?: Record<string, unknown>; items?: Array<Record<string, unknown>> };
    try {
      status = await server.checkStatus(row.id);
    } catch {
      status = { status: "unknown" };
    }
    if (status.status === "confirmed" && status.transaction) {
      return confirmRow(status.transaction, status.items ?? []);
    }

    const submitted = await submitPurchase(fetchImpl, row.input, row.id);
    if (submitted.ok && submitted.transaction) {
      return confirmRow(submitted.transaction, submitted.items ?? []);
    }
    if (submitted.status === 0 || submitted.status >= 500 || submitted.status === 401 || submitted.status === 403) {
      return "queued";
    }
    const reason =
      submitted.error ?? "Purchase was rejected by the server.";
    const kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected"> =
      /already used for a different purchase/i.test(reason) ? "fingerprint-mismatch" : "rejected";
    await markRejected(reason);
    await parkPurchaseAsSyncIssue(supabase, scope, row, kind, reason);
    return "parked";
  } catch {
    // Any unexpected failure leaves the row queued; the next trigger retries.
    return "queued";
  }
}

export interface PurchaseDrainResult {
  confirmedCount: number;
  parkedCount: number;
  queuedCount: number;
  /** True when a network failure stopped the loop early. */
  stoppedEarly: boolean;
  /**
   * Slice S7 — confirmed purchases, so the caller can attach the
   * expense-review reminder to a synced purchase that has no linked
   * expense yet (the S6 gap).
   */
  confirmed: Array<{
    localId: string;
    serverId: string;
    invoiceNumber: string | null;
    supplierId: string | null;
  }>;
}

/**
 * Drain all pending local purchases for a scope, oldest first. A
 * network failure stops the loop (the rest wait for the next
 * trigger). Never throws.
 */
export async function drainPendingPurchases(
  supabase: SupabaseClient,
  scope: string,
  options: PurchaseSyncOptions = {},
): Promise<PurchaseDrainResult> {
  const result: PurchaseDrainResult = {
    confirmedCount: 0,
    parkedCount: 0,
    queuedCount: 0,
    stoppedEarly: false,
    confirmed: [],
  };
  let rows: LocalPurchaseRow[];
  try {
    rows = (await getLocalPurchasesBackend().list(scope)).filter(isPendingLocalPurchase);
  } catch {
    return result;
  }
  let changed = false;
  const drainOptions: PurchaseSyncOptions = {
    ...options,
    onConfirmed: (row, transaction) => {
      // Slice S7 — collect the confirmed purchases for the
      // expense-review reminder (S6 gap), then still call the
      // caller's own hook, if any.
      const serverId = typeof transaction.id === "string" ? transaction.id : "";
      if (serverId) {
        result.confirmed.push({
          localId: row.id,
          serverId,
          invoiceNumber:
            typeof transaction.invoice_number === "string" ? transaction.invoice_number : null,
          supplierId: typeof transaction.supplier_id === "string" ? transaction.supplier_id : null,
        });
      }
      options.onConfirmed?.(row, transaction);
    },
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const outcome = await syncOnePurchase(supabase, scope, row, drainOptions);
    if (outcome === "synced") {
      result.confirmedCount += 1;
      changed = true;
    } else if (outcome === "parked") {
      result.parkedCount += 1;
      changed = true;
    } else {
      // A network failure mid-loop: this row and the rest keep their
      // order for the next trigger instead of failing one by one.
      result.queuedCount += rows.length - index;
      result.stoppedEarly = true;
      break;
    }
  }
  if (changed) notifyLocalPurchasesChanged();
  return result;
}

/**
 * Owner Retry of one parked purchase issue. Re-submits the parked
 * row with its ORIGINAL request key — safe once the cause is fixed
 * (e.g. the supplier has now synced). A row that already synced
 * elsewhere resolves the issue without a write. A fingerprint
 * mismatch is refused without submitting — the same key with
 * different contents can never succeed.
 */
export async function retryPurchaseSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  options: PurchaseSyncOptions = {},
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getLocalPurchasesBackend();
  const issuesBackend = getSyncIssuesBackend();
  const issues = await issuesBackend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.purchaseId) {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  if (issue.kind === "fingerprint-mismatch") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const rows = await backend.list(scope);
  const row = rows.find((item) => item.id === issue.purchaseId);
  if (!row) {
    // The row already synced (or was discarded): the issue is done.
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (!isPendingLocalPurchase(row) && row.syncStatus !== "rejected") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  // Back to pending so the submit below runs; the original request
  // key is kept — the server replays it, never duplicates it.
  try {
    await backend.upsert(scope, { ...row, syncStatus: "pending", syncError: null });
  } catch {
    return { confirmed: false, notRetryable: false, reason: "The purchase could not be saved on this device." };
  }
  const outcome = await syncOnePurchase(supabase, scope, { ...row, syncStatus: "pending", syncError: null }, options);
  if (outcome === "synced") {
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (outcome === "parked") {
    const after = await issuesBackend.list(scope);
    const updated = after.find((item) => item.id === issueId);
    return { confirmed: false, notRetryable: false, reason: updated?.reason ?? null };
  }
  return { confirmed: false, notRetryable: false, reason: null };
}
