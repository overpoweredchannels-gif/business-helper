/**
 * Slice S7 — return sync (Offline Tier-1).
 *
 * Offline-created returns sync AFTER sales in the engine's order
 * (design §4: customers + suppliers first, then sales, then sales
 * returns, then payments, then purchases, then purchase returns +
 * expenses, then pull — a sales return references a sale that must
 * already be synced). The dedup key is the client `request_key`
 * itself (the local row `id`): the server dedupes on
 * `sales_returns.request_key` / `purchase_returns.request_key`
 * (unique per org, new SQL in
 * `src/lib/migrations/returns_expenses_idempotency.sql`, UMAIR runs
 * it disposable-first), so retrying the same key replays the
 * original return instead of a duplicate or a second stock movement.
 *
 * - Status-check first (`get_sales_return_request_status` /
 *   `get_purchase_return_request_status` — new SQL, S7). A lost
 *   POST response is the same path: the status check finds the
 *   confirmed return and lands it in the mirror. Until the new
 *   SQL is run the RPC does not exist — the check fails soft to
 *   "unknown", exactly like a lost response, and the submit below
 *   runs. The routes retry the insert WITHOUT the key when the
 *   column does not exist yet (transitional fallback), so returns
 *   never break between deploy and SQL run — dedup is degraded
 *   until the SQL is run, the same exposure as today.
 * - Submit through the cloud routes (`POST /api/sales/returns`,
 *   `POST /api/purchases/returns`) with the user's token — the
 *   returns routes are plain inserts behind the org's auth, and
 *   the client never calls a service-role RPC (same rule as S6
 *   purchases).
 * - Same key + different payload → the server raises "already used
 *   for a different return" → parked as `fingerprint-mismatch`
 *   (never auto-retried; a corrected return is a NEW return with
 *   a NEW key). Any other definitive 4xx parks as `rejected`.
 * - A network failure or 5xx leaves the row queued; the next
 *   trigger retries. A confirmed return lands its return + items
 *   in the history mirror at once, so the desktop history badge
 *   stays Returned even if the app quits before the refetch runs.
 * - Owner Retry (from Sync issues) re-submits the parked row with
 *   its ORIGINAL key — safe once the cause is fixed. The parked
 *   row is never auto-deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  getLocalReturnsBackend,
  isPendingLocalReturn,
  notifyLocalReturnsChanged,
  pendingReturnToPurchaseReturn,
  pendingReturnToPurchaseReturnItems,
  pendingReturnToSalesReturn,
  pendingReturnToSalesReturnItems,
  type LocalReturnKind,
  type LocalReturnRow,
} from "@/lib/offline/local-returns";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  resolveIssueByRequestId,
  type SyncIssue,
  type SyncIssueKind,
} from "@/lib/offline/sync-issues";
import { upsertHistoryMirrorRow } from "@/lib/offline/history-mirror";

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** The server side of the return sync: one status check per kind. */
export interface ReturnServer {
  /** The confirmed return for a request key, or "unknown" when there is none (or the check failed). */
  checkStatus(
    requestKey: string,
    kind: LocalReturnKind,
  ): Promise<{
    status: "unknown" | "confirmed";
    return?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
  }>;
}

/** The real status check: `get_sales_return_request_status` / `get_purchase_return_request_status` (new SQL, S7). */
export function createReturnServer(supabase: SupabaseClient): ReturnServer {
  return {
    async checkStatus(requestKey: string, kind: LocalReturnKind) {
      const rpcName =
        kind === "sales" ? "get_sales_return_request_status" : "get_purchase_return_request_status";
      const { data, error } = await supabase.rpc(rpcName, {
        p_request_key: requestKey,
      });
      if (error) throw error;
      const result = data as { status?: unknown; result?: unknown } | null;
      if (result?.status !== "confirmed") return { status: "unknown" };
      const payload = result.result as { return?: unknown; items?: unknown } | null;
      const returned =
        payload?.return && typeof payload.return === "object"
          ? (payload.return as Record<string, unknown>)
          : undefined;
      const items = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : [];
      if (!returned) return { status: "unknown" };
      return { status: "confirmed", return: returned, items };
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

interface SubmitReturnResult {
  ok: boolean;
  status: number;
  returnId?: string;
  returnNumber?: string;
  error?: string;
}

/** POST one return to the cloud route with its client request key. Never throws. */
async function submitReturn(
  fetchImpl: FetchImpl,
  row: LocalReturnRow,
): Promise<SubmitReturnResult> {
  const path = row.kind === "sales" ? "/api/sales/returns" : "/api/purchases/returns";
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row.input, requestKey: row.id }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  const result = await readJsonBody(response);
  if (!response.ok || typeof result.returnId !== "string" || result.returnId.length === 0) {
    return {
      ok: false,
      status: response.status,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  }
  return {
    ok: true,
    status: response.status,
    returnId: result.returnId,
    returnNumber: typeof result.returnNumber === "string" ? result.returnNumber : undefined,
  };
}

/**
 * Land one confirmed return in the history mirror immediately.
 * When the server returned the full row + items (status check),
 * those land verbatim; when only the id + number came back (the
 * submit route), the mirror row is built from the local input with
 * the server id + number substituted, so the desktop history badge
 * stays Returned even if the app quits before the refetch runs.
 * Never throws: a failed upsert is healed by the next fetch.
 */
export async function landConfirmedReturnMirror(
  scope: string,
  row: LocalReturnRow,
  serverReturn?: Record<string, unknown>,
  serverItems?: Array<Record<string, unknown>>,
  serverReturnNumber?: string | null,
): Promise<void> {
  try {
    if (serverReturn) {
      const serverId = typeof serverReturn.id === "string" ? serverReturn.id : "";
      if (!serverId) return;
      await upsertHistoryMirrorRow(
        row.kind === "sales" ? "sales_return" : "purchase_return",
        scope,
        { id: serverId, data: serverReturn },
      );
      for (const item of serverItems ?? []) {
        const itemId = typeof item.id === "string" ? item.id : String(item.id ?? "");
        if (!itemId) continue;
        await upsertHistoryMirrorRow(
          row.kind === "sales" ? "sales_return_item" : "purchase_return_item",
          scope,
          { id: itemId, data: item },
        );
      }
      return;
    }
    // Submit path: the server id is the only new fact; the rest of
    // the row is the local input the server just stored. The server
    // return number replaces the provisional number in the mirror
    // (the history then shows the server number, exactly like a
    // live-created return).
    const serverId = row.serverId;
    if (!serverId) return;
    const localReturn =
      row.kind === "sales"
        ? pendingReturnToSalesReturn(row, row.provisionalNumber ?? "")
        : pendingReturnToPurchaseReturn(row, row.provisionalNumber ?? "");
    if (!localReturn) return;
    const mirrorReturn = {
      ...localReturn,
      id: serverId,
      return_number: serverReturnNumber ?? localReturn.return_number,
    };
    await upsertHistoryMirrorRow(
      row.kind === "sales" ? "sales_return" : "purchase_return",
      scope,
      { id: serverId, data: mirrorReturn as unknown as Record<string, unknown> },
    );
    const localItems =
      row.kind === "sales"
        ? pendingReturnToSalesReturnItems(row)
        : pendingReturnToPurchaseReturnItems(row);
    const returnKey = row.kind === "sales" ? "sales_return_id" : "purchase_return_id";
    for (let index = 0; index < localItems.length; index += 1) {
      const item = localItems[index];
      const itemId = `${serverId}:item:${index}`;
      await upsertHistoryMirrorRow(
        row.kind === "sales" ? "sales_return_item" : "purchase_return_item",
        scope,
        {
          id: itemId,
          data: { ...item, id: itemId, [returnKey]: serverId } as unknown as Record<string, unknown>,
        },
      );
    }
  } catch {
    /* Mirror is a cache; the next fetch heals it. */
  }
}

function returnDisplayTotal(row: LocalReturnRow): number | null {
  try {
    const input = row.input;
    const lines = Array.isArray(input.lines) ? input.lines : [];
    let total = 0;
    for (const line of lines) {
      if (!line || typeof line !== "object") continue;
      const quantity = Number((line as Record<string, unknown>).quantity ?? 0);
      const unitPrice = Number((line as Record<string, unknown>).unitPrice ?? 0);
      const discount = Number((line as Record<string, unknown>).discount ?? 0);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
      total += quantity * unitPrice - (Number.isFinite(discount) ? discount : 0);
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Park a return problem in Sync issues. Returns the stored issue,
 * or null when the store write failed — the caller then leaves the
 * row queued so the return still surfaces instead of vanishing.
 */
export async function parkReturnAsSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  row: LocalReturnRow,
  kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected">,
  reason: string,
): Promise<SyncIssue | null> {
  let partyName: string | null = null;
  try {
    if (row.kind === "sales") {
      const customerId = row.input.customerId;
      if (typeof customerId === "string" && customerId.length > 0) {
        const { data } = (await supabase
          .from("customers")
          .select("customer_name")
          .eq("id", customerId)
          .maybeSingle()) as { data: { customer_name?: string } | null };
        partyName = data?.customer_name ?? null;
      }
    } else {
      const supplierId = row.input.supplierId;
      if (typeof supplierId === "string" && supplierId.length > 0) {
        const { data } = (await supabase
          .from("suppliers")
          .select("supplier_name")
          .eq("id", supplierId)
          .maybeSingle()) as { data: { supplier_name?: string } | null };
        partyName = data?.supplier_name ?? null;
      }
    }
  } catch {
    partyName = null;
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
    customerName: partyName,
    total: returnDisplayTotal(row),
    reason,
    payload: null,
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    customerId: null,
    supplierId: null,
    purchaseId: null,
    returnId: row.id,
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

export type ReturnSyncOutcome = "synced" | "parked" | "queued";

export interface ReturnSyncOptions {
  fetchImpl?: FetchImpl;
  server?: ReturnServer;
  /**
   * Slice S7 — drain only one kind. The engine drains sales returns
   * after sales (design §4 step 3) and purchase returns after
   * purchases (step 6): a return references the invoice that must
   * already be synced. Omit to drain both kinds.
   */
  kind?: LocalReturnKind;
  /**
   * Called for every return that confirms, with the server id +
   * number. The drain collects them so the caller can refresh the
   * derived figures (history badge, customer balance).
   */
  onConfirmed?: (row: LocalReturnRow, serverId: string | null, returnNumber: string | null) => void;
}

/**
 * Sync one pending local return row. Never throws: a network
 * failure or 5xx leaves the row queued (`queued`), a definitive
 * rejection parks it (`parked`), a confirmed row is removed from
 * the local store (`synced`).
 */
export async function syncOneReturn(
  supabase: SupabaseClient,
  scope: string,
  row: LocalReturnRow,
  options: ReturnSyncOptions = {},
): Promise<ReturnSyncOutcome> {
  const fetchImpl = options.fetchImpl ?? authorizedFetch;
  const server = options.server ?? createReturnServer(supabase);
  const backend = getLocalReturnsBackend();

  const markRejected = async (reason: string): Promise<ReturnSyncOutcome> => {
    try {
      await backend.upsert(scope, { ...row, syncStatus: "rejected", syncError: reason });
    } catch {
      /* The park below is the visible record; the row stays pending. */
    }
    return "parked";
  };

  const confirmRow = async (
    serverId: string | null,
    serverReturn?: Record<string, unknown>,
    serverItems?: Array<Record<string, unknown>>,
    serverReturnNumber?: string | null,
  ): Promise<ReturnSyncOutcome> => {
    const confirmedRow: LocalReturnRow = { ...row, serverId };
    await landConfirmedReturnMirror(scope, confirmedRow, serverReturn, serverItems, serverReturnNumber);
    // Report the confirmed return before the local row is removed,
    // so the caller can refresh the derived figures from the server
    // id + number (the row itself still carries the provisional one).
    try {
      const returnNumber =
        typeof serverReturn?.return_number === "string"
          ? (serverReturn.return_number as string)
          : serverReturnNumber ?? null;
      options.onConfirmed?.(row, serverId, returnNumber);
    } catch {
      /* The figures are advisory; the return is already synced. */
    }
    try {
      await backend.remove(scope, row.id);
    } catch {
      /* A leftover row replays harmlessly (same key → replay). */
    }
    // A return that confirms after its issue was parked resolves
    // the issue — the panel must not keep showing it.
    await resolveIssueByRequestId(scope, row.id);
    return "synced";
  };

  try {
    // Status-check first: a lost POST response still leaves the
    // return on the server, and the check finds it. Until the new
    // status SQL is run the RPC does not exist — the check throws
    // and the submit below runs, exactly like a lost response.
    let status: { status: "unknown" | "confirmed"; return?: Record<string, unknown>; items?: Array<Record<string, unknown>> };
    try {
      status = await server.checkStatus(row.id, row.kind);
    } catch {
      status = { status: "unknown" };
    }
    if (status.status === "confirmed" && status.return) {
      const serverId = typeof status.return.id === "string" ? (status.return.id as string) : null;
      return confirmRow(serverId, status.return, status.items ?? []);
    }

    const submitted = await submitReturn(fetchImpl, row);
    if (submitted.ok && submitted.returnId) {
      // The submit route returns the server id + number (no full
      // row): hand them to the mirror landing so the history shows
      // the server number, not the provisional one.
      return confirmRow(submitted.returnId, undefined, undefined, submitted.returnNumber ?? null);
    }
    if (submitted.status === 0 || submitted.status >= 500 || submitted.status === 401 || submitted.status === 403) {
      return "queued";
    }
    const reason = submitted.error ?? "Return was rejected by the server.";
    const kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected"> =
      /already used for a different return/i.test(reason) ? "fingerprint-mismatch" : "rejected";
    await markRejected(reason);
    await parkReturnAsSyncIssue(supabase, scope, row, kind, reason);
    return "parked";
  } catch {
    // Any unexpected failure leaves the row queued; the next trigger retries.
    return "queued";
  }
}

export interface ReturnDrainResult {
  confirmedCount: number;
  parkedCount: number;
  queuedCount: number;
  /** True when a network failure stopped the loop early. */
  stoppedEarly: boolean;
  /** Confirmed returns, so the caller can refresh the derived figures. */
  confirmed: Array<{ localId: string; serverId: string | null; returnNumber: string | null; kind: LocalReturnKind }>;
}

/**
 * Drain all pending local returns for a scope, oldest first. A
 * network failure stops the loop (the rest wait for the next
 * trigger). Never throws.
 */
export async function drainPendingReturns(
  supabase: SupabaseClient,
  scope: string,
  options: ReturnSyncOptions = {},
): Promise<ReturnDrainResult> {
  const result: ReturnDrainResult = {
    confirmedCount: 0,
    parkedCount: 0,
    queuedCount: 0,
    stoppedEarly: false,
    confirmed: [],
  };
  let rows: LocalReturnRow[];
  try {
    rows = (await getLocalReturnsBackend().list(scope)).filter(
      (row) => isPendingLocalReturn(row) && (!options.kind || row.kind === options.kind),
    );
  } catch {
    return result;
  }
  let changed = false;
  const drainOptions: ReturnSyncOptions = {
    ...options,
    onConfirmed: (row, serverId, returnNumber) => {
      result.confirmed.push({ localId: row.id, serverId, returnNumber, kind: row.kind });
      options.onConfirmed?.(row, serverId, returnNumber);
    },
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const outcome = await syncOneReturn(supabase, scope, row, drainOptions);
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
  if (changed) notifyLocalReturnsChanged();
  return result;
}

/**
 * Owner Retry of one parked return issue. Re-submits the parked row
 * with its ORIGINAL request key — safe once the cause is fixed
 * (e.g. the sale has now synced). A row that already synced
 * elsewhere resolves the issue without a write. A fingerprint
 * mismatch is refused without submitting — the same key with
 * different contents can never succeed.
 */
export async function retryReturnSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  options: ReturnSyncOptions = {},
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getLocalReturnsBackend();
  const issuesBackend = getSyncIssuesBackend();
  const issues = await issuesBackend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.returnId) {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  if (issue.kind === "fingerprint-mismatch") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const rows = await backend.list(scope);
  const row = rows.find((item) => item.id === issue.returnId);
  if (!row) {
    // The row already synced (or was discarded): the issue is done.
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (!isPendingLocalReturn(row) && row.syncStatus !== "rejected") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  // Back to pending so the submit below runs; the original request
  // key is kept — the server replays it, never duplicates it.
  try {
    await backend.upsert(scope, { ...row, syncStatus: "pending", syncError: null });
  } catch {
    return { confirmed: false, notRetryable: false, reason: "The return could not be saved on this device." };
  }
  const outcome = await syncOneReturn(supabase, scope, { ...row, syncStatus: "pending", syncError: null }, options);
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
