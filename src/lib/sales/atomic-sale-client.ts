import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_CHANGED_EVENT,
  getSaleQueueBackend,
  notifyQueueChanged,
} from "@/lib/offline/local-store";

export { QUEUE_CHANGED_EVENT };

export type AtomicSaleInput = {
  customer_id: string;
  sale_date: string;
  payment_type: "cash" | "card" | "credit";
  invoice_discount: number;
  invoice_discount_type: "flat" | "percent";
  tax_rate: number;
  cash_received: number | null;
  /** Free-text sale note; stored in sales_transactions.notes by the
   * atomic RPC once the Phase A migration has been run. Null/omitted
   * keeps the historical behaviour (notes null). */
  notes?: string | null;
  credit_override_confirmed: boolean;
  lines: Array<{
    product_id: string;
    quantity: number;
    selling_price: number;
    discount: number;
    bonus: number;
    unit_mode: "main" | "subunit";
  }>;
};

export type AtomicSaleResult = {
  transaction: Record<string, unknown>;
  customer_name: string;
  items: Array<Record<string, unknown>>;
  replayed: boolean;
};

export type PendingSale = {
  requestId: string;
  input: AtomicSaleInput;
  /**
   * Slice S2 (desktop only): the local provisional receipt number
   * (`L-000123`) allocated by the SQLite queue when the sale was saved.
   * Undefined on the web build, where the receipt shows "Pending sync"
   * with no number.
   */
  provisionalNumber?: string;
};
type SaleStatus = { status: "unknown" | "confirmed"; result?: AtomicSaleResult };

/** A server rejection is final: the attempt is dropped, never retried. */
class SaleRejectedError extends Error {}

/** Bound on one sale RPC round-trip (2026-11-15). A hung network must
 * never hold the queue mutex — and the Save button's "Saving…" state —
 * indefinitely: on timeout the attempt stays queued and the server-side
 * idempotency key reconciles it on the next drain, so a late
 * confirmation can never double-post. */
export const SALE_REQUEST_TIMEOUT_MS = 8000;

/** Race one sale RPC against the timeout. A rejection still propagates
 * (fast offline failure stays fast); only a promise that never settles
 * resolves as "timeout". */
export async function withSaleRequestTimeout<T>(promise: Promise<T>, timeoutMs: number = SALE_REQUEST_TIMEOUT_MS): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Slice S2 — the queue lives behind a backend now (localStorage on web,
 * SQLite on desktop; see `src/lib/offline/local-store.ts`). Queue reads
 * are async because the desktop backend crosses IPC; the queue-notices
 * helpers below stay synchronous localStorage — they are transient UI
 * state, and S3 replaces them with the owner-only Sync issues list.
 */
async function readQueue(scope: string): Promise<PendingSale[]> {
  return getSaleQueueBackend().list(scope);
}

async function writeQueue(scope: string, queue: PendingSale[]): Promise<PendingSale[]> {
  const stored = await getSaleQueueBackend().replace(scope, queue);
  notifyQueueChanged();
  return stored;
}

async function removeFromQueue(scope: string, requestId: string): Promise<void> {
  await getSaleQueueBackend().remove(scope, requestId);
  notifyQueueChanged();
}

/** The queue for a scope, oldest first. Async since S2 (SQLite over IPC). */
export async function readPendingSalesQueue(scope: string): Promise<PendingSale[]> {
  return readQueue(scope);
}

/** Backwards-compatible head read: the mount restore and the recovery
 * action both operate on the oldest waiting sale. Async since S2. */
export async function readPendingAtomicSale(scope: string): Promise<PendingSale | null> {
  return (await readQueue(scope))[0] ?? null;
}

/** Rejection notices for sales dropped from the queue: the shopkeeper must
 * see them, or a rejected older sale would vanish silently. */
const noticesStorageKey = (scope: string) => `tradeos:queue-notices:v1:${scope}`;
export function readQueueNotices(scope: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(noticesStorageKey(scope)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

export function clearQueueNotices(scope: string) {
  try {
    window.localStorage.removeItem(noticesStorageKey(scope));
  } catch { /* Ignored. */ }
  notifyQueueChanged();
}

function addQueueNotice(scope: string, message: string) {
  try {
    const notices = [...readQueueNotices(scope), message].slice(-3);
    window.localStorage.setItem(noticesStorageKey(scope), JSON.stringify(notices));
  } catch { /* Ignored. */ }
}

/** Same basket, same sale: both inputs are built by the same form code in
 * the same key order, so a string comparison is stable here. */
function inputsEqual(a: AtomicSaleInput, b: AtomicSaleInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readSaleStatus(supabase: SupabaseClient, requestId: string) {
  try {
    const outcome = await withSaleRequestTimeout(
      supabase.rpc("get_sales_invoice_request_status", { p_request_id: requestId }) as unknown as Promise<{
        data: SaleStatus | null;
        error: { code?: string; message?: string } | null;
      }>,
    );
    if (outcome === "timeout") return { data: null, error: { message: "Request status timed out" } };
    return outcome;
  } catch {
    return { data: null, error: { message: "Request status could not be reached" } };
  }
}

async function removeAttempt(scope: string, requestId: string) {
  await removeFromQueue(scope, requestId);
}

async function submitAtomicSale(
  supabase: SupabaseClient,
  scope: string,
  attempt: PendingSale,
  isRecovery: boolean,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: boolean }> {
  let data: AtomicSaleResult | null = null;
  let error: { code?: string; message?: string } | null = null;
  try {
    const outcome = await withSaleRequestTimeout(
      supabase.rpc("create_sales_invoice_atomic", {
        p_request_id: attempt.requestId,
        p_input: attempt.input,
      }) as unknown as Promise<{ data: AtomicSaleResult | null; error: { code?: string; message?: string } | null }>,
    );
    if (outcome === "timeout") {
      error = { message: "Sale request timed out" };
    } else {
      ({ data, error } = outcome);
    }
  } catch (caught) {
    error = { message: caught instanceof Error ? caught.message : "Sale request connection failed" };
  }

  if (!error && data?.transaction) {
    await removeAttempt(scope, attempt.requestId);
    return { result: data, previousPendingConfirmed: isRecovery };
  }

  const status = await readSaleStatus(supabase, attempt.requestId);
  if (!status.error && status.data?.status === "confirmed" && status.data.result) {
    await removeAttempt(scope, attempt.requestId);
    return { result: status.data.result, previousPendingConfirmed: isRecovery };
  }

  if (!status.error && status.data?.status === "unknown" && /^[0-9A-Z]{5}$/.test(error?.code ?? "")) {
    await removeAttempt(scope, attempt.requestId);
    throw new SaleRejectedError(error?.message || "Sale was rejected. Correct the sale details and try again.");
  }

  throw new Error("Sale status could not be confirmed. Your basket and request are saved; retry to reconcile the same sale.");
}

type QueueOutcome = {
  ownResult: { result: AtomicSaleResult; previousPendingConfirmed: boolean } | null;
  ownQueued: PendingSale | null;
  ownPosition: number;
  confirmedCount: number;
  confirmedResults: AtomicSaleResult[];
  rejectedMessages: string[];
  remaining: number;
};

/** Serialize every queue operation per scope: a drain and a save must never
 * interleave, or two submissions could reorder or double-post. */
const chains = new Map<string, Promise<unknown>>();
function runSerialized<T>(scope: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(scope) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  chains.set(scope, run);
  return run;
}

async function processQueueLocked(
  supabase: SupabaseClient,
  scope: string,
  newInput: AtomicSaleInput | null,
  isRecovery: boolean,
  // True ONLY when the caller re-saves a basket restored from the queue
  // (mount restore). A fresh entry is always a new sale, even when it is
  // identical to the waiting head — content equality alone cannot tell a
  // retry from a second identical sale (2026-11-02 production report: two
  // identical offline sales queued as one, the second silently lost).
  isRetry = false,
): Promise<QueueOutcome> {
  let queue = await readQueue(scope);
  const preExistingIds = new Set(queue.map(item => item.requestId));
  let own: PendingSale | null = null;
  let ownPreExisting = false;
  if (newInput) {
    if (isRetry && queue.length > 0 && inputsEqual(queue[0].input, newInput)) {
      // The restored basket is being re-saved: this is the head's retry,
      // never a second sale.
      own = queue[0];
      ownPreExisting = true;
    } else {
      own = { requestId: crypto.randomUUID(), input: newInput };
      queue = [...queue, own];
      // Slice S2: the stored queue comes back with the provisional
      // number allocated (desktop SQLite); the receipt shows it.
      queue = await writeQueue(scope, queue);
      own = queue.find(item => item.requestId === own!.requestId) ?? own;
    }
  }

  const rejectedMessages: string[] = [];
  const confirmedResults: AtomicSaleResult[] = [];
  let confirmedCount = 0;
  let ownResult: QueueOutcome["ownResult"] = null;
  // Walk from the head; an ambiguous head stops the drain and keeps the
  // rest queued, in order. A rejected head is final and skipped.
  while (queue.length > 0) {
    const head = queue[0];
    if (preExistingIds.has(head.requestId)) {
      // Status-first for a head that survived an earlier call: it may
      // already be confirmed server-side, and re-posting before checking
      // would waste a sale RPC (and break the recovery test's no-repost
      // invariant). Only an unknown status falls through to a submit.
      const status = await readSaleStatus(supabase, head.requestId);
      if (!status.error && status.data?.status === "confirmed" && status.data.result) {
        await removeAttempt(scope, head.requestId);
        confirmedCount += 1;
        confirmedResults.push(status.data.result);
        queue = await readQueue(scope);
        if (own && head.requestId === own.requestId) {
          ownResult = { result: status.data.result, previousPendingConfirmed: isRecovery || ownPreExisting };
          break;
        }
        continue;
      }
      if (status.error) break;
    }
    try {
      const { result } = await submitAtomicSale(supabase, scope, head, isRecovery);
      confirmedCount += 1;
      confirmedResults.push(result);
      queue = await readQueue(scope);
      if (own && head.requestId === own.requestId) {
        ownResult = { result, previousPendingConfirmed: isRecovery || ownPreExisting };
        break;
      }
    } catch (caught) {
      queue = await readQueue(scope);
      if (caught instanceof SaleRejectedError) {
        rejectedMessages.push(caught.message);
        addQueueNotice(scope, caught.message);
        continue;
      }
      break;
    }
  }

  const ownPosition = own ? queue.findIndex(item => item.requestId === own!.requestId) + 1 : 0;
  return {
    ownResult,
    ownQueued: own && ownPosition > 0 ? own : null,
    ownPosition,
    confirmedCount,
    confirmedResults,
    rejectedMessages,
    remaining: queue.length,
  };
}

export type CreateAtomicSaleResult =
  | { result: AtomicSaleResult; previousPendingConfirmed: boolean }
  | { queued: true; attempt: PendingSale; position: number; confirmedCount: number; rejectedMessages: string[] };

export async function createAtomicSale(
  supabase: SupabaseClient,
  scope: string,
  input: AtomicSaleInput,
  opts?: { isRetry?: boolean },
): Promise<CreateAtomicSaleResult> {
  const outcome = await runSerialized(scope, () => processQueueLocked(supabase, scope, input, false, opts?.isRetry ?? false));
  if (outcome.ownResult) return outcome.ownResult;
  if (outcome.ownQueued) {
    return {
      queued: true,
      attempt: outcome.ownQueued,
      position: outcome.ownPosition,
      confirmedCount: outcome.confirmedCount,
      rejectedMessages: outcome.rejectedMessages,
    };
  }
  if (outcome.rejectedMessages.length > 0) {
    // A final server rejection: the sale was dropped from the queue, so
    // there is nothing to reconcile — surface the real reason (e.g. a
    // validation failure) instead of the ambiguous "could not be
    // confirmed" message, which misleads the cashier into retrying a
    // sale that will fail the same way.
    throw new Error(outcome.rejectedMessages.join(" "));
  }
  throw new Error("Sale status could not be confirmed. Your basket and request are saved; retry to reconcile the same sale.");
}

export async function reconcilePendingAtomicSale(
  supabase: SupabaseClient,
  scope: string,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: true } | null> {
  const outcome = await runSerialized(scope, () => processQueueLocked(supabase, scope, null, true));
  if (outcome.confirmedResults.length === 0) return null;
  // The recovery UI shows one receipt: the most recent confirmed sale.
  // (Every confirmed sale is visible in the sales history after refetch.)
  return {
    result: outcome.confirmedResults[outcome.confirmedResults.length - 1],
    previousPendingConfirmed: true,
  };
}

export type DrainResult = { confirmedCount: number; rejectedMessages: string[]; remaining: number };

export async function drainPendingSalesQueue(
  supabase: SupabaseClient,
  scope: string,
): Promise<DrainResult> {
  const outcome = await runSerialized(scope, () => processQueueLocked(supabase, scope, null, true));
  return {
    confirmedCount: outcome.confirmedCount,
    rejectedMessages: outcome.rejectedMessages,
    remaining: outcome.remaining,
  };
}
