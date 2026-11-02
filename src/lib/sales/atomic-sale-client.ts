import type { SupabaseClient } from "@supabase/supabase-js";

export type AtomicSaleInput = {
  customer_id: string;
  sale_date: string;
  payment_type: "cash" | "card" | "credit";
  invoice_discount: number;
  invoice_discount_type: "flat" | "percent";
  tax_rate: number;
  cash_received: number | null;
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

export type PendingSale = { requestId: string; input: AtomicSaleInput };
type SaleStatus = { status: "unknown" | "confirmed"; result?: AtomicSaleResult };

/** A server rejection is final: the attempt is dropped, never retried. */
class SaleRejectedError extends Error {}

/** Ordered queue, oldest first. Scope is `${organizationId}:${profileId}`. */
const queueStorageKey = (scope: string) => `tradeos:pending-sales-queue:v1:${scope}`;
const legacyStorageKey = (scope: string) => `tradeos:pending-sale:v1:${scope}`;
const noticesStorageKey = (scope: string) => `tradeos:queue-notices:v1:${scope}`;
export const QUEUE_CHANGED_EVENT = "tradeos:pending-sales-changed";

function notifyQueueChanged() {
  try {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  } catch { /* Non-browser or closed window: the next read still sees the queue. */ }
}

function parseQueue(raw: string | null): PendingSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingSale =>
      !!item && typeof (item as PendingSale).requestId === "string" &&
      !!(item as PendingSale).input && typeof (item as PendingSale).input === "object");
  } catch {
    return [];
  }
}

function writePendingSalesQueue(scope: string, queue: PendingSale[], notify = true) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(queueStorageKey(scope));
    else window.localStorage.setItem(queueStorageKey(scope), JSON.stringify(queue));
  } catch { /* Storage full or blocked: the caller's in-memory copy still holds the attempt. */ }
  if (notify) notifyQueueChanged();
}

export function readPendingSalesQueue(scope: string): PendingSale[] {
  if (typeof window === "undefined") return [];
  let queue = parseQueue(window.localStorage.getItem(queueStorageKey(scope)));
  // One-time migration from the old single slot: it is the oldest sale.
  const legacy = window.localStorage.getItem(legacyStorageKey(scope));
  if (legacy) {
    try {
      const old = JSON.parse(legacy) as PendingSale;
      if (old?.requestId && old.input && !queue.some(item => item.requestId === old.requestId)) {
        queue = [old, ...queue];
      }
    } catch { /* A corrupt legacy slot is dropped with the key below. */ }
    window.localStorage.removeItem(legacyStorageKey(scope));
    writePendingSalesQueue(scope, queue, false);
  }
  return queue;
}

/** Backwards-compatible head read: the mount restore and the recovery
 * action both operate on the oldest waiting sale. */
export function readPendingAtomicSale(scope: string): PendingSale | null {
  return readPendingSalesQueue(scope)[0] ?? null;
}

/** Rejection notices for sales dropped from the queue: the shopkeeper must
 * see them, or a rejected older sale would vanish silently. */
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
    return await supabase.rpc("get_sales_invoice_request_status", { p_request_id: requestId }) as unknown as {
      data: SaleStatus | null;
      error: { code?: string; message?: string } | null;
    };
  } catch {
    return { data: null, error: { message: "Request status could not be reached" } };
  }
}

function removeAttempt(scope: string, requestId: string) {
  writePendingSalesQueue(scope, readPendingSalesQueue(scope).filter(item => item.requestId !== requestId));
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
    ({ data, error } = await supabase.rpc("create_sales_invoice_atomic", {
      p_request_id: attempt.requestId,
      p_input: attempt.input,
    }) as unknown as { data: AtomicSaleResult | null; error: { code?: string; message?: string } | null });
  } catch (caught) {
    error = { message: caught instanceof Error ? caught.message : "Sale request connection failed" };
  }

  if (!error && data?.transaction) {
    removeAttempt(scope, attempt.requestId);
    return { result: data, previousPendingConfirmed: isRecovery };
  }

  const status = await readSaleStatus(supabase, attempt.requestId);
  if (!status.error && status.data?.status === "confirmed" && status.data.result) {
    removeAttempt(scope, attempt.requestId);
    return { result: status.data.result, previousPendingConfirmed: isRecovery };
  }

  if (!status.error && status.data?.status === "unknown" && /^[0-9A-Z]{5}$/.test(error?.code ?? "")) {
    removeAttempt(scope, attempt.requestId);
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
  let queue = readPendingSalesQueue(scope);
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
      writePendingSalesQueue(scope, queue);
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
        removeAttempt(scope, head.requestId);
        confirmedCount += 1;
        confirmedResults.push(status.data.result);
        queue = readPendingSalesQueue(scope);
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
      queue = readPendingSalesQueue(scope);
      if (own && head.requestId === own.requestId) {
        ownResult = { result, previousPendingConfirmed: isRecovery || ownPreExisting };
        break;
      }
    } catch (caught) {
      queue = readPendingSalesQueue(scope);
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
