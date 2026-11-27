/**
 * Slice S3 — silent sync engine, sales only (Offline Tier-1).
 *
 * No button, no count, no "sync" wording anywhere the cashier looks:
 * a saved sale is *saved*; the cloud copy is invisible. The engine
 * runs the existing drain (`drainPendingSalesQueue` — status-check
 * first, serialized per scope, 8 s request timeout) on:
 * - app launch (once, when the engine starts),
 * - the browser `online` event,
 * - a 5-minute timer while online,
 * - a debounced run after a sale is saved (the queue-changed event
 *   fires on every queue mutation; the debounced run only fires when
 *   the queue is actually non-empty, so a drain that already cleared
 *   the queue does not loop).
 *
 * After each drain the engine retries any pending provisional-number
 * links (`retryPendingLinks`). A run that fails — offline mid-run, a
 * refused sale, a failed link — never throws out of the engine: the
 * sales stay queued locally and the next trigger retries. Two runs
 * never overlap: an in-flight run is shared, and the drain itself is
 * serialized per scope (`runSerialized` in the atomic sale client).
 *
 * Slice S5 — the customer drain runs FIRST (design §4 order step 1:
 * customers are parents of sales), then the sales drain.
 *
 * Slice S6 — the supplier drain runs FIRST too (design §4 order step
 * 1: suppliers are parents of purchases), and the purchase drain runs
 * AFTER the sales drain (design §4 order step 5: purchases reference
 * suppliers already synced in step 1).
 *
 * Slice S7 — the full design §4 order: customers + suppliers first,
 * then sales, then sales returns (step 3), then payments (step 4),
 * then purchases (step 5), then purchase returns + expenses (step
 * 6), then pull. A return references the invoice that must already
 * be synced, and a payment allocates against invoices that must
 * already be synced, so each drain waits for its parents. The
 * debounced run fires on any queue change (sales, returns,
 * payments, expenses), not just the sales queue.
 *
 * Slice 4 (HYBRID) — a saved purchase nudges the engine the same
 * way: the debounced run also fires on the local-purchases changed
 * event, and the non-empty check counts pending purchases. A
 * pre-existing queued purchase therefore re-drives on the next
 * launch run, online event, timer run, or save — it can never sit
 * queued forever just because no other queue changed.
 *
 * Owner Retry of a parked sale also lives here: `retrySyncIssue`
 * re-queues the parked attempt with its ORIGINAL idempotency key at
 * the front of the queue and drains. The drain status-checks it
 * first, so a sale the server already holds replays the original
 * invoice instead of double-posting. A fingerprint mismatch can never
 * succeed on retry (same key + different payload always fails the
 * same way), so it is refused without submitting.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_CHANGED_EVENT,
  drainPendingSalesQueue,
  readPendingSalesQueue,
  requeueParkedSale,
  type DrainResult,
  type PendingSale,
} from "@/lib/sales/atomic-sale-client";
import {
  drainPendingCustomers,
  retryCustomerSyncIssue,
  type CustomerDrainResult,
} from "@/lib/offline/customer-sync";
import {
  drainPendingPurchases,
  retryPurchaseSyncIssue,
  type PurchaseDrainResult,
} from "@/lib/offline/purchase-sync";
import {
  drainPendingSuppliers,
  retrySupplierSyncIssue,
  type SupplierDrainResult,
} from "@/lib/offline/supplier-sync";
import {
  drainPendingReturns,
  retryReturnSyncIssue,
  type ReturnDrainResult,
} from "@/lib/offline/return-sync";
import {
  drainPendingPayments,
  retryPaymentSyncIssue,
  type PaymentSyncOptions,
  type PaymentDrainResult,
} from "@/lib/offline/payment-sync";
import {
  drainPendingExpenses,
  retryExpenseSyncIssue,
  type ExpenseDrainResult,
} from "@/lib/offline/expense-sync";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  syncIssueCanRetry,
} from "@/lib/offline/sync-issues";
import { retryPendingLinks } from "@/lib/offline/provisional-link";
import {
  LOCAL_RETURNS_CHANGED_EVENT,
  getLocalReturnsBackend,
} from "@/lib/offline/local-returns";
import {
  LOCAL_PURCHASES_CHANGED_EVENT,
  getLocalPurchasesBackend,
} from "@/lib/offline/local-purchases";
import {
  LOCAL_PAYMENTS_CHANGED_EVENT,
  getLocalPaymentsBackend,
} from "@/lib/offline/local-payments";
import {
  LOCAL_EXPENSES_CHANGED_EVENT,
  getLocalExpensesBackend,
} from "@/lib/offline/local-expenses";

/** A run every 5 minutes while online (design §4). */
export const SILENT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Debounce after a queue change, so a burst of saves drains once. */
export const SILENT_SYNC_AFTER_SAVE_DEBOUNCE_MS = 2000;

export interface SilentSyncEngineOptions {
  supabase: SupabaseClient;
  getScope: () => string | null;
  /** Called after every drain (also when nothing confirmed), so the page can refetch + refresh counts. */
  onDrained?: (drained: DrainResult) => void;
  /** Called after the customer drain (step 1 of the sync order), so the page can refetch customers. */
  onCustomersDrained?: (drained: CustomerDrainResult) => void;
  /** Called after the supplier drain (step 1 of the sync order), so the page can refetch suppliers. */
  onSuppliersDrained?: (drained: SupplierDrainResult) => void;
  /** Called after the purchase drain (step 5 of the sync order), so the page can refetch purchases. */
  onPurchasesDrained?: (drained: PurchaseDrainResult) => void;
  /** Called after each returns drain (sales returns step 3, purchase returns step 6), so the page can refetch returns. */
  onReturnsDrained?: (drained: ReturnDrainResult) => void;
  /** Called after the payments drain (step 4 of the sync order), so the page can refetch payments. */
  onPaymentsDrained?: (drained: PaymentDrainResult) => void;
  /** Called after the expenses drain (step 6 of the sync order), so the page can refetch expenses. */
  onExpensesDrained?: (drained: ExpenseDrainResult) => void;
  /** Test seam: override the timer intervals. Defaults are the constants above. */
  timers?: { intervalMs?: number; debounceMs?: number };
}

export interface SilentSyncEngine {
  stop(): void;
  /** Debounced manual nudge (e.g. after a sale is saved while a drain is already running). */
  requestSync(): void;
}

export function startSilentSyncEngine(options: SilentSyncEngineOptions): SilentSyncEngine {
  const intervalMs = options.timers?.intervalMs ?? SILENT_SYNC_INTERVAL_MS;
  const debounceMs = options.timers?.debounceMs ?? SILENT_SYNC_AFTER_SAVE_DEBOUNCE_MS;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function isOnline(): boolean {
    return typeof navigator === "undefined" || navigator.onLine;
  }

  function run(): Promise<void> {
    if (stopped) return Promise.resolve();
    const scope = options.getScope();
    if (!scope) return Promise.resolve();
    if (!isOnline()) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        // Slice S5 — customers first (design §4 order): a sale
        // referencing an unsynced customer cannot confirm server-side,
        // so the customer drain runs before the sales drain. A
        // customer failure never blocks the sales drain — the drain
        // handles its own failures and parks what it cannot sync.
        const customersDrained = await drainPendingCustomers(options.supabase, scope);
        options.onCustomersDrained?.(customersDrained);
        // Slice S6 — suppliers first too (design §4 order step 1): a
        // purchase referencing an unsynced supplier cannot confirm
        // server-side. Same discipline as customers: a supplier
        // failure never blocks the later drains.
        const suppliersDrained = await drainPendingSuppliers(options.supabase, scope);
        options.onSuppliersDrained?.(suppliersDrained);
        const drained = await drainPendingSalesQueue(options.supabase, scope);
        await retryPendingLinks(options.supabase, scope);
        options.onDrained?.(drained);
        // Slice S7 — sales returns next (design §4 order step 3): a
        // return references a sale that must already be synced. A
        // return failure never blocks the later drains — the drain
        // handles its own failures and parks what it cannot sync.
        const salesReturnsDrained = await drainPendingReturns(options.supabase, scope, { kind: "sales" });
        options.onReturnsDrained?.(salesReturnsDrained);
        // Slice S7 — payments next (design §4 order step 4): a
        // payment allocates against invoices that must already be
        // synced. Same discipline as the returns drain.
        const paymentsDrained = await drainPendingPayments(options.supabase, scope);
        options.onPaymentsDrained?.(paymentsDrained);
        // Slice S6 — purchases last of the writes (design §4 order
        // step 5): suppliers are already synced, so a purchase can
        // confirm. A purchase failure never blocks the pull — the
        // next trigger retries it.
        const purchasesDrained = await drainPendingPurchases(options.supabase, scope);
        options.onPurchasesDrained?.(purchasesDrained);
        // Slice S7 — purchase returns + expenses last (design §4
        // order step 6): a purchase return references a purchase
        // that must already be synced, and an expense can link one.
        const purchaseReturnsDrained = await drainPendingReturns(options.supabase, scope, { kind: "purchase" });
        options.onReturnsDrained?.(purchaseReturnsDrained);
        const expensesDrained = await drainPendingExpenses(options.supabase, scope);
        options.onExpensesDrained?.(expensesDrained);
      } catch {
        /* A failed run stays local; the next trigger retries. Never throw. */
      }
    })();
    const done = inFlight;
    void done.finally(() => {
      if (inFlight === done) inFlight = null;
    });
    return done;
  }

  function scheduleDebouncedRun(): void {
    if (typeof window === "undefined") return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (stopped || !isOnline()) return;
      const scope = options.getScope();
      if (!scope) return;
      // Only run when a queue is actually non-empty: a drain that
      // already cleared the queues fires these same events on its
      // own removals, and must not loop. Slice S7 — any of the
      // queues (sales, returns, payments, expenses) can trigger it.
      // Slice 4 — pending purchases count too: a purchase-only queue
      // must nudge the engine, not wait for an unrelated queue.
      void Promise.all([
        readPendingSalesQueue(scope),
        getLocalReturnsBackend().list(scope),
        getLocalPaymentsBackend().list(scope),
        getLocalExpensesBackend().list(scope),
        getLocalPurchasesBackend().list(scope),
      ])
        .then(([salesQueue, returns, payments, expenses, purchases]) => {
          const pendingReturns = returns.filter((row) => row.syncStatus === "pending");
          const pendingPayments = payments.filter((row) => row.syncStatus === "pending");
          const pendingExpenses = expenses.filter((row) => row.syncStatus === "pending");
          const pendingPurchases = purchases.filter((row) => row.syncStatus === "pending");
          if (
            salesQueue.length > 0 ||
            pendingReturns.length > 0 ||
            pendingPayments.length > 0 ||
            pendingExpenses.length > 0 ||
            pendingPurchases.length > 0
          ) {
            void run();
          }
        })
        .catch(() => {
          /* A failed read counts as empty — the timer retries. */
        });
    }, debounceMs);
  }

  function onOnline(): void {
    void run();
  }

  function onQueueChanged(): void {
    scheduleDebouncedRun();
  }

  // Launch run: a sale queued before a reload syncs itself.
  void run();
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    // Slice S7 — a saved return / payment / expense nudges the
    // engine the same way a saved sale does.
    window.addEventListener(LOCAL_RETURNS_CHANGED_EVENT, onQueueChanged);
    window.addEventListener(LOCAL_PAYMENTS_CHANGED_EVENT, onQueueChanged);
    window.addEventListener(LOCAL_EXPENSES_CHANGED_EVENT, onQueueChanged);
    // Slice 4 — a saved purchase nudges the engine the same way, so
    // a purchase-only queue re-drives without waiting for the timer.
    window.addEventListener(LOCAL_PURCHASES_CHANGED_EVENT, onQueueChanged);
  }
  if (typeof setInterval !== "undefined") {
    interval = setInterval(() => void run(), intervalMs);
  }

  return {
    stop(): void {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (interval) clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
        window.removeEventListener(LOCAL_RETURNS_CHANGED_EVENT, onQueueChanged);
        window.removeEventListener(LOCAL_PAYMENTS_CHANGED_EVENT, onQueueChanged);
        window.removeEventListener(LOCAL_EXPENSES_CHANGED_EVENT, onQueueChanged);
        window.removeEventListener(LOCAL_PURCHASES_CHANGED_EVENT, onQueueChanged);
      }
    },
    requestSync(): void {
      scheduleDebouncedRun();
    },
  };
}

/**
 * Owner Retry of one parked sale. Returns whether the sale confirmed.
 * A fingerprint mismatch is refused without submitting — the same key
 * with different contents can never succeed.
 * A customer issue dispatches to the customer retry (re-applies the
 * parked copy with a fresh timestamp) and reports kind "customer" so
 * the caller can show the right message. A supplier / purchase /
 * return / payment / expense issue dispatches the same way and
 * reports kind "supplier" / "purchase" / "return" / "payment" /
 * "expense".
 */
export async function retrySyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  onPaymentConfirmed?: PaymentSyncOptions["onConfirmed"],
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null; kind: "sale" | "customer" | "supplier" | "purchase" | "return" | "payment" | "expense" }> {
  const backend = getSyncIssuesBackend();
  const issues = await backend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (issue && issue.customerId) {
    const outcome = await retryCustomerSyncIssue(supabase, scope, issueId);
    return { ...outcome, kind: "customer" as const };
  }
  if (issue && issue.supplierId) {
    const outcome = await retrySupplierSyncIssue(supabase, scope, issueId);
    return { ...outcome, kind: "supplier" as const };
  }
  if (issue && issue.purchaseId) {
    const outcome = await retryPurchaseSyncIssue(supabase, scope, issueId);
    return { ...outcome, kind: "purchase" as const };
  }
  if (issue && issue.returnId) {
    const outcome = await retryReturnSyncIssue(supabase, scope, issueId);
    return { ...outcome, kind: "return" as const };
  }
  if (issue && issue.paymentId) {
    const outcome = await retryPaymentSyncIssue(supabase, scope, issueId, { onConfirmed: onPaymentConfirmed });
    return { ...outcome, kind: "payment" as const };
  }
  if (issue && issue.expenseId) {
    const outcome = await retryExpenseSyncIssue(supabase, scope, issueId);
    return { ...outcome, kind: "expense" as const };
  }
  if (!issue || issue.status !== "open" || !issue.payload || !issue.requestId) {
    return { confirmed: false, notRetryable: false, reason: null, kind: "sale" as const };
  }
  if (!syncIssueCanRetry(issue)) {
    return { confirmed: false, notRetryable: true, reason: null, kind: "sale" as const };
  }
  const attempt: PendingSale = {
    requestId: issue.requestId,
    input: issue.payload,
    provisionalNumber: issue.provisionalNumber ?? undefined,
  };
  await requeueParkedSale(supabase, scope, attempt);
  const after = await backend.list(scope);
  const updated = after.find((item) => item.id === issueId);
  const confirmed = !!updated && updated.status === "resolved";
  notifySyncIssuesChanged();
  return { confirmed, notRetryable: false, reason: confirmed ? null : updated?.reason ?? null, kind: "sale" as const };
}
