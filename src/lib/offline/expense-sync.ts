/**
 * Slice S7 — expense sync (Offline Tier-1).
 *
 * Offline-created expenses sync LAST in the engine's order (design
 * §4: customers + suppliers first, then sales, then sales returns,
 * then payments, then purchases, then purchase returns + expenses,
 * then pull — an expense can link a purchase that must already be
 * synced). The dedup key is the client `request_key` itself (the
 * local row `id`): the server dedupes on `expenses.request_key`
 * (unique per org, new SQL in
 * `src/lib/migrations/returns_expenses_idempotency.sql`, UMAIR runs
 * it disposable-first), so retrying the same key returns the
 * existing row instead of a duplicate.
 *
 * - Status-check first (`get_expense_request_status` — new SQL,
 *   S7). A lost insert response is the same path: the check finds
 *   the confirmed expense and lands it in the mirror. Until the new
 *   SQL is run the RPC does not exist — the check fails soft to
 *   "unknown", exactly like a lost response, and the submit below
 *   runs. The routes retry the insert WITHOUT the key when the
 *   column does not exist yet (transitional fallback), so expenses
 *   never break between deploy and SQL run — dedup is degraded
 *   until the SQL is run, the same exposure as today.
 * - Submit is the same direct insert the online flow uses
 *   (`supabase.from("expenses").insert(...)`), with the user's
 *   JWT — no service-role key anywhere. A unique-violation (23505)
 *   on the key selects the existing row and treats it as a replay.
 * - Same key + different payload → the server raises "already used
 *   for a different expense" → parked as `fingerprint-mismatch`
 *   (never auto-retried; a corrected expense is a NEW expense with
 *   a NEW key). Any other definitive rejection parks as `rejected`.
 * - A network failure leaves the row queued; the next trigger
 *   retries. A confirmed expense lands in the history mirror at
 *   once, so the desktop expenses list stays correct even if the
 *   app quits before the refetch runs. When the expense links a
 *   purchase, the purchase's `expense_review_status` is set to
 *   "expenses_added" after confirm (the same second call the
 *   online flow makes) — best-effort, never a sync failure.
 * - Owner Retry (from Sync issues) re-submits the parked row with
 *   its ORIGINAL key — safe once the cause is fixed. The parked
 *   row is never auto-deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLocalExpensesBackend,
  isPendingLocalExpense,
  notifyLocalExpensesChanged,
  type LocalExpenseRow,
} from "@/lib/offline/local-expenses";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  resolveIssueByRequestId,
  type SyncIssue,
  type SyncIssueKind,
} from "@/lib/offline/sync-issues";
import { upsertHistoryMirrorRow } from "@/lib/offline/history-mirror";

/** The server side of the expense sync: one status check + one insert. */
export interface ExpenseServer {
  /** The confirmed expense for a request key, or "unknown" when there is none (or the check failed). */
  checkStatus(requestKey: string): Promise<{
    status: "unknown" | "confirmed";
    expense?: Record<string, unknown>;
  }>;
  /** Insert one expense with its client request key; returns the server id. */
  submit(input: Record<string, unknown>, requestKey: string): Promise<{ expenseId: string }>;
  /** Best-effort: mark a purchase's expense review as done. Never throws. */
  markPurchaseExpenseReviewed(purchaseId: string): Promise<void>;
}

/**
 * True when a server expense row holds exactly the local input's
 * contents. Expenses have no md5 helper in the browser, so the
 * comparison is field-by-field (null-safe, stringified): a row the
 * server already holds under this key with different contents is a
 * fingerprint mismatch, never a replay.
 */
export function expenseMatchesInput(
  expense: Record<string, unknown>,
  input: Record<string, unknown>,
): boolean {
  const same = (key: string): boolean =>
    String(expense[key] ?? "") === String(input[key] ?? "");
  return (
    same("expense_type") &&
    Number(expense.amount ?? 0) === Number(input.amount ?? 0) &&
    same("notes") &&
    same("expense_date") &&
    same("supplier_id") &&
    same("customer_id") &&
    same("purchase_transaction_id") &&
    same("sales_transaction_id")
  );
}

/** The real server: the direct expense insert, with the user's JWT. */
export function createExpenseServer(supabase: SupabaseClient): ExpenseServer {
  return {
    async checkStatus(requestKey: string) {
      const { data, error } = await supabase.rpc("get_expense_request_status", {
        p_request_key: requestKey,
      });
      if (error) throw error;
      const result = data as { status?: unknown; result?: unknown } | null;
      if (result?.status !== "confirmed") return { status: "unknown" };
      const payload = result.result as { expense?: unknown } | null;
      const expense =
        payload?.expense && typeof payload.expense === "object"
          ? (payload.expense as Record<string, unknown>)
          : undefined;
      if (!expense) return { status: "unknown" };
      return { status: "confirmed", expense };
    },
    async submit(input: Record<string, unknown>, requestKey: string) {
      const { data, error } = await supabase
        .from("expenses")
        .insert({ ...input, request_key: requestKey })
        .select("id")
        .single();
      if (!error && data && typeof (data as { id?: unknown }).id === "string") {
        return { expenseId: (data as { id: string }).id };
      }
      const code = (error as { code?: unknown } | null)?.code;
      // Transitional fallback (same as the returns routes): the
      // `request_key` column does not exist yet — retry the insert
      // without the key so the expense still saves (dedup is
      // degraded until the SQL runs).
      if (code === "42703") {
        const { data: retried, error: retryError } = await supabase
          .from("expenses")
          .insert(input)
          .select("id")
          .single();
        if (!retryError && retried && typeof (retried as { id?: unknown }).id === "string") {
          return { expenseId: (retried as { id: string }).id };
        }
        const retryMessage =
          retryError instanceof Error
            ? retryError.message
            : (retryError as { message?: string } | null)?.message;
        throw new Error(retryMessage || "Expense could not be saved. Please retry.");
      }
      if (code === "23505") {
        const { data: existing, error: selectError } = await supabase
          .from("expenses")
          .select("*")
          .eq("request_key", requestKey)
          .maybeSingle();
        if (!selectError && existing && typeof (existing as { id?: unknown }).id === "string") {
          const existingRow = existing as Record<string, unknown>;
          if (!expenseMatchesInput(existingRow, input)) {
            throw new Error("Request key was already used for a different expense");
          }
          return { expenseId: existingRow.id as string };
        }
      }
      const message =
        error instanceof Error ? error.message : (error as { message?: string } | null)?.message;
      throw new Error(message || "Expense could not be saved. Please retry.");
    },
    async markPurchaseExpenseReviewed(purchaseId: string) {
      try {
        await supabase
          .from("purchase_transactions")
          .update({ expense_review_status: "expenses_added" })
          .eq("id", purchaseId);
      } catch {
        /* Best-effort only: the expense is already synced. */
      }
    },
  };
}

/**
 * Land one confirmed expense in the history mirror immediately.
 * Never throws: a failed upsert is healed by the next fetch.
 */
export async function landConfirmedExpenseMirror(
  scope: string,
  expense: Record<string, unknown>,
): Promise<void> {
  try {
    const serverId = typeof expense.id === "string" ? expense.id : "";
    if (!serverId) return;
    await upsertHistoryMirrorRow("expense", scope, { id: serverId, data: expense });
  } catch {
    /* Mirror is a cache; the next fetch heals it. */
  }
}

/**
 * Park an expense problem in Sync issues. Returns the stored issue,
 * or null when the store write failed — the caller then leaves the
 * row queued so the expense still surfaces instead of vanishing.
 */
export async function parkExpenseAsSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  row: LocalExpenseRow,
  kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected">,
  reason: string,
): Promise<SyncIssue | null> {
  let partyName: string | null = null;
  try {
    const supplierId = row.input.supplier_id;
    const customerId = row.input.customer_id;
    if (typeof supplierId === "string" && supplierId.length > 0) {
      const { data } = (await supabase
        .from("suppliers")
        .select("supplier_name")
        .eq("id", supplierId)
        .maybeSingle()) as { data: { supplier_name?: string } | null };
      partyName = data?.supplier_name ?? null;
    } else if (typeof customerId === "string" && customerId.length > 0) {
      const { data } = (await supabase
        .from("customers")
        .select("customer_name")
        .eq("id", customerId)
        .maybeSingle()) as { data: { customer_name?: string } | null };
      partyName = data?.customer_name ?? null;
    }
  } catch {
    partyName = null;
  }
  const now = new Date().toISOString();
  const amount = typeof row.input.amount === "number" ? row.input.amount : Number(row.input.amount ?? 0);
  const issue: SyncIssue = {
    id: crypto.randomUUID(),
    scope,
    kind,
    requestId: row.id,
    provisionalNumber: row.provisionalNumber,
    serverInvoiceNumber: null,
    serverId: row.serverId,
    customerName: partyName,
    total: Number.isFinite(amount) ? amount : null,
    reason,
    payload: null,
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    customerId: null,
    supplierId: null,
    purchaseId: null,
    returnId: null,
    paymentId: null,
    expenseId: row.id,
  };
  try {
    const stored = await getSyncIssuesBackend().upsert(scope, issue);
    notifySyncIssuesChanged();
    return stored;
  } catch {
    return null;
  }
}

export type ExpenseSyncOutcome = "synced" | "parked" | "queued";

export interface ExpenseSyncOptions {
  server?: ExpenseServer;
  /**
   * Called for every expense that confirms, with the server id. The
   * drain collects them so the caller can refresh the derived
   * figures.
   */
  onConfirmed?: (row: LocalExpenseRow, serverId: string | null) => void;
}

/**
 * Sync one pending local expense row. Never throws: a network
 * failure leaves the row queued (`queued`), a definitive rejection
 * parks it (`parked`), a confirmed row is removed from the local
 * store (`synced`).
 */
export async function syncOneExpense(
  supabase: SupabaseClient,
  scope: string,
  row: LocalExpenseRow,
  options: ExpenseSyncOptions = {},
): Promise<ExpenseSyncOutcome> {
  const server = options.server ?? createExpenseServer(supabase);
  const backend = getLocalExpensesBackend();

  const markRejected = async (reason: string): Promise<ExpenseSyncOutcome> => {
    try {
      await backend.upsert(scope, { ...row, syncStatus: "rejected", syncError: reason });
    } catch {
      /* The park below is the visible record; the row stays pending. */
    }
    return "parked";
  };

  const confirmRow = async (expense: Record<string, unknown>): Promise<ExpenseSyncOutcome> => {
    await landConfirmedExpenseMirror(scope, expense);
    // The expense-review link: the same second call the online
    // flow makes — best-effort, never a sync failure.
    const purchaseId = row.input.purchase_transaction_id;
    if (typeof purchaseId === "string" && purchaseId.length > 0) {
      await server.markPurchaseExpenseReviewed(purchaseId);
    }
    // Report the confirmed expense before the local row is removed,
    // so the caller can refresh the derived figures from the server
    // id (the row itself still carries none).
    try {
      const serverId = typeof expense.id === "string" ? (expense.id as string) : null;
      options.onConfirmed?.(row, serverId);
    } catch {
      /* The figures are advisory; the expense is already synced. */
    }
    try {
      await backend.remove(scope, row.id);
    } catch {
      /* A leftover row replays harmlessly (same key → replay). */
    }
    // An expense that confirms after its issue was parked resolves
    // the issue — the panel must not keep showing it.
    await resolveIssueByRequestId(scope, row.id);
    return "synced";
  };

  try {
    // Status-check first: a lost insert response still leaves the
    // expense on the server, and the check finds it. Until the new
    // SQL is run the RPC does not exist — the check throws and the
    // submit below runs, exactly like a lost response. A confirmed
    // expense with different contents is a fingerprint mismatch,
    // never a replay.
    try {
      const status = await server.checkStatus(row.id);
      if (status.status === "confirmed" && status.expense) {
        if (!expenseMatchesInput(status.expense, row.input)) {
          const reason = "Request key was already used for a different expense";
          await markRejected(reason);
          await parkExpenseAsSyncIssue(supabase, scope, row, "fingerprint-mismatch", reason);
          return "parked";
        }
        return confirmRow(status.expense);
      }
    } catch {
      // A failed status check is "unknown" — the submit below runs.
    }
    try {
      const submitted = await server.submit(row.input, row.id);
      const expense = { ...row.input, id: submitted.expenseId, request_key: row.id };
      return confirmRow(expense);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      // A network failure is uncertain: the insert may have
      // committed before the response was lost — stay queued and
      // let the status check reconcile it next time.
      if (/failed to fetch|networkerror|network request failed|load failed|timeout|abort/i.test(message)) {
        return "queued";
      }
      const kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected"> =
        /already used for a different expense/i.test(message) ? "fingerprint-mismatch" : "rejected";
      await markRejected(message || "Expense was rejected by the server.");
      await parkExpenseAsSyncIssue(supabase, scope, row, kind, message || "Expense was rejected by the server.");
      return "parked";
    }
  } catch {
    // Any unexpected failure leaves the row queued; the next trigger retries.
    return "queued";
  }
}

export interface ExpenseDrainResult {
  confirmedCount: number;
  parkedCount: number;
  queuedCount: number;
  /** True when a network failure stopped the loop early. */
  stoppedEarly: boolean;
  /** Confirmed expenses, so the caller can refresh the derived figures. */
  confirmed: Array<{ localId: string; serverId: string | null }>;
}

/**
 * Drain all pending local expenses for a scope, oldest first. A
 * network failure stops the loop (the rest wait for the next
 * trigger). Never throws.
 */
export async function drainPendingExpenses(
  supabase: SupabaseClient,
  scope: string,
  options: ExpenseSyncOptions = {},
): Promise<ExpenseDrainResult> {
  const result: ExpenseDrainResult = {
    confirmedCount: 0,
    parkedCount: 0,
    queuedCount: 0,
    stoppedEarly: false,
    confirmed: [],
  };
  let rows: LocalExpenseRow[];
  try {
    rows = (await getLocalExpensesBackend().list(scope)).filter(isPendingLocalExpense);
  } catch {
    return result;
  }
  let changed = false;
  const drainOptions: ExpenseSyncOptions = {
    ...options,
    onConfirmed: (row, serverId) => {
      result.confirmed.push({ localId: row.id, serverId });
      options.onConfirmed?.(row, serverId);
    },
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const outcome = await syncOneExpense(supabase, scope, row, drainOptions);
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
  if (changed) notifyLocalExpensesChanged();
  return result;
}

/**
 * Owner Retry of one parked expense issue. Re-submits the parked
 * row with its ORIGINAL request key — safe once the cause is fixed.
 * A row that already synced elsewhere resolves the issue without
 * a write. A fingerprint mismatch is refused without submitting —
 * the same key with different contents can never succeed.
 */
export async function retryExpenseSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  options: ExpenseSyncOptions = {},
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getLocalExpensesBackend();
  const issuesBackend = getSyncIssuesBackend();
  const issues = await issuesBackend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.expenseId) {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  if (issue.kind === "fingerprint-mismatch") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const rows = await backend.list(scope);
  const row = rows.find((item) => item.id === issue.expenseId);
  if (!row) {
    // The row already synced (or was discarded): the issue is done.
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (!isPendingLocalExpense(row) && row.syncStatus !== "rejected") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  // Back to pending so the submit below runs; the original request
  // key is kept — the server replays it, never duplicates it.
  try {
    await backend.upsert(scope, { ...row, syncStatus: "pending", syncError: null });
  } catch {
    return { confirmed: false, notRetryable: false, reason: "The expense could not be saved on this device." };
  }
  const outcome = await syncOneExpense(supabase, scope, { ...row, syncStatus: "pending", syncError: null }, options);
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
