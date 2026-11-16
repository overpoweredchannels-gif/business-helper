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
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  syncIssueCanRetry,
} from "@/lib/offline/sync-issues";
import { retryPendingLinks } from "@/lib/offline/provisional-link";

/** A run every 5 minutes while online (design §4). */
export const SILENT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Debounce after a queue change, so a burst of saves drains once. */
export const SILENT_SYNC_AFTER_SAVE_DEBOUNCE_MS = 2000;

export interface SilentSyncEngineOptions {
  supabase: SupabaseClient;
  getScope: () => string | null;
  /** Called after every drain (also when nothing confirmed), so the page can refetch + refresh counts. */
  onDrained?: (drained: DrainResult) => void;
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
        const drained = await drainPendingSalesQueue(options.supabase, scope);
        await retryPendingLinks(options.supabase, scope);
        options.onDrained?.(drained);
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
      // Only run when the queue is actually non-empty: a drain that
      // already cleared the queue fires this same event on its own
      // removals, and must not loop.
      void readPendingSalesQueue(scope)
        .then((queue) => {
          if (queue.length > 0) void run();
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
 */
export async function retrySyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getSyncIssuesBackend();
  const issues = await backend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.payload || !issue.requestId) {
    return { confirmed: false, notRetryable: false, reason: null };
  }
  if (!syncIssueCanRetry(issue)) {
    return { confirmed: false, notRetryable: true, reason: null };
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
  return { confirmed, notRetryable: false, reason: confirmed ? null : updated?.reason ?? null };
}
