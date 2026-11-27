/**
 * Slice S7 — payment sync (Offline Tier-1).
 *
 * Offline-created payments + voids sync AFTER sales returns in the
 * engine's order (design §4: customers + suppliers first, then
 * sales, then sales returns, then payments, then purchases, then
 * purchase returns + expenses, then pull — a payment allocates
 * against invoices that must already be synced). The dedup key is
 * the client `request_key` itself (the local row `id`): the server
 * dedupes on `customer_payments.request_key` /
 * `supplier_payments.request_key` (unique per org, phase 14), so
 * retrying the same key replays the original payment instead of a
 * duplicate or a second balance change.
 *
 * - Status-check first (`get_payment_request_status` — exists,
 *   phase 14) for "pay" rows. A lost RPC response is the same path:
 *   the status check finds the confirmed payment and lands it in
 *   the mirror. The client calls the RPCs directly with the user's
 *   JWT (`create_payment_atomic` / `void_payment_atomic` /
 *   `get_payment_request_status` are all granted to `authenticated`
 *   — phase 14/15); no service-role key is involved anywhere.
 * - "void" rows have no status function, but `void_payment_atomic`
 *   is replay-safe by `void_request_key` (phase 15): a lost
 *   response just re-submits with the same key and replays. A
 *   payment already voided by another device ("Payment is already
 *   voided") is the desired end state, so the row resolves instead
 *   of parking.
 * - Same key + different payload → the server raises "already used
 *   for a different payment" (pay) or "already used for a different
 *   void" (void) → parked as `fingerprint-mismatch` (never
 *   auto-retried; a corrected payment is a NEW payment with a NEW
 *   key). Any other definitive rejection parks as `rejected`.
 * - A network failure (uncertain error) leaves the row queued; the
 *   next trigger retries. A confirmed payment lands its payment +
 *   allocations in the history mirror at once, so the desktop
 *   balances stay correct even if the app quits before the refetch
 *   runs. A voided payment is excluded from every total — locally
 *   (the merge marks it voided) and after sync (the server marks
 *   it voided and its allocations stop covering anything).
 * - Owner Retry (from Sync issues) re-submits the parked row with
 *   its ORIGINAL key — safe once the cause is fixed. The parked
 *   row is never auto-deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLocalPaymentsBackend,
  isPendingLocalPayment,
  notifyLocalPaymentsChanged,
  type LocalPaymentRow,
} from "@/lib/offline/local-payments";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  resolveIssueByRequestId,
  type SyncIssue,
  type SyncIssueKind,
} from "@/lib/offline/sync-issues";
import {
  getPaymentRequestStatus,
  isUncertainPaymentError,
  submitPaymentAtomic,
  voidPaymentAtomic,
  type PaymentKind,
  type PaymentSubmitInput,
  type PaymentSubmitResult,
  type VoidPaymentResult,
} from "@/lib/payments/submit-payment";
import { upsertHistoryMirrorRow } from "@/lib/offline/history-mirror";

/** The server side of the payment sync: the phase-14/15 RPCs. */
export interface PaymentServer {
  /** The confirmed payment for a request key, or "unknown" when there is none (or the check failed). */
  checkStatus(
    requestKey: string,
    kind: PaymentKind,
  ): Promise<{ status: "unknown" | "confirmed"; result?: PaymentSubmitResult }>;
  /** Submit one payment through `create_payment_atomic`. */
  submit(input: PaymentSubmitInput, requestKey: string): Promise<PaymentSubmitResult>;
  /** Void one payment through `void_payment_atomic`. */
  submitVoid(
    input: { kind: PaymentKind; paymentId: string; reason: string | null },
    requestKey: string,
  ): Promise<VoidPaymentResult>;
}

/** The real server: the phase-14/15 RPCs with the user's JWT. */
export function createPaymentServer(supabase: SupabaseClient): PaymentServer {
  return {
    checkStatus: async (requestKey, kind) => {
      const { status, result } = await getPaymentRequestStatus(supabase, requestKey, kind);
      return { status: status === "confirmed" ? "confirmed" : "unknown", result };
    },
    submit: (input, requestKey) => submitPaymentAtomic(supabase, input, requestKey),
    submitVoid: (input, requestKey) => voidPaymentAtomic(supabase, input, requestKey),
  };
}

function paymentKindOf(row: LocalPaymentRow): PaymentKind | null {
  const kind = row.input.kind;
  return kind === "customer" || kind === "supplier" ? kind : null;
}

function paymentInputOf(row: LocalPaymentRow): PaymentSubmitInput | null {
  const input = row.input;
  const kind = paymentKindOf(row);
  if (!kind) return null;
  if (typeof input.partyId !== "string" || input.partyId.length === 0) return null;
  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    kind,
    partyId: input.partyId,
    amount,
    paymentDate: typeof input.paymentDate === "string" ? input.paymentDate : null,
    paymentMethod: typeof input.paymentMethod === "string" ? input.paymentMethod : "cash",
    notes: typeof input.notes === "string" ? input.notes : null,
    allocations: Array.isArray(input.allocations)
      ? (input.allocations as Array<{ invoice_id?: unknown; amount?: unknown }>)
          .filter((alloc) => !!alloc && typeof alloc === "object")
          .map((alloc) => ({
            invoice_id: typeof alloc.invoice_id === "string" ? alloc.invoice_id : String(alloc.invoice_id ?? ""),
            amount: typeof alloc.amount === "number" ? alloc.amount : Number(alloc.amount ?? 0),
          }))
      : [],
    reference: typeof input.reference === "string" ? input.reference : null,
  };
}

/**
 * Land one confirmed payment in the history mirror immediately.
 * The payment + its allocations come from the local input + the
 * server payment id, so the desktop balances stay correct even if
 * the app quits before the refetch runs. Never throws: a failed
 * upsert is healed by the next fetch.
 */
export async function landConfirmedPaymentMirror(
  scope: string,
  row: LocalPaymentRow,
  result: PaymentSubmitResult,
): Promise<void> {
  try {
    const input = paymentInputOf(row);
    const kind = paymentKindOf(row);
    if (!input || !kind) return;
    const paymentId = result.payment_id;
    const now = new Date().toISOString();
    const paymentData: Record<string, unknown> = {
      id: paymentId,
      amount: input.amount,
      notes: input.notes,
      payment_date: input.paymentDate,
      created_at: now,
      payment_method: input.paymentMethod,
      reference: input.reference,
      voided_at: null,
      void_reason: null,
      edited_at: null,
      request_key: row.id,
    };
    if (kind === "customer") {
      paymentData.customer_id = input.partyId;
      await upsertHistoryMirrorRow("customer_payment", scope, { id: paymentId, data: paymentData });
      for (let index = 0; index < input.allocations.length; index += 1) {
        const alloc = input.allocations[index];
        const allocId = `${paymentId}:alloc:${index}`;
        await upsertHistoryMirrorRow("customer_payment_allocation", scope, {
          id: allocId,
          data: {
            id: allocId,
            customer_payment_id: paymentId,
            sales_transaction_id: alloc.invoice_id,
            amount: alloc.amount,
            created_at: now,
          },
        });
      }
    } else {
      paymentData.supplier_id = input.partyId;
      await upsertHistoryMirrorRow("supplier_payment", scope, { id: paymentId, data: paymentData });
      for (let index = 0; index < input.allocations.length; index += 1) {
        const alloc = input.allocations[index];
        const allocId = `${paymentId}:alloc:${index}`;
        await upsertHistoryMirrorRow("supplier_payment_allocation", scope, {
          id: allocId,
          data: {
            id: allocId,
            supplier_payment_id: paymentId,
            purchase_transaction_id: alloc.invoice_id,
            amount: alloc.amount,
            created_at: now,
          },
        });
      }
    }
  } catch {
    /* Mirror is a cache; the next fetch heals it. */
  }
}

/**
 * Park a payment / void problem in Sync issues. Returns the stored
 * issue, or null when the store write failed — the caller then
 * leaves the row queued so the payment still surfaces instead of
 * vanishing.
 */
export async function parkPaymentAsSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  row: LocalPaymentRow,
  kind: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected">,
  reason: string,
): Promise<SyncIssue | null> {
  let partyName: string | null = null;
  try {
    const partyId = row.input.partyId;
    const paymentKind = paymentKindOf(row);
    if (typeof partyId === "string" && partyId.length > 0 && paymentKind) {
      if (paymentKind === "customer") {
        const { data } = (await supabase
          .from("customers")
          .select("customer_name")
          .eq("id", partyId)
          .maybeSingle()) as { data: { customer_name?: string } | null };
        partyName = data?.customer_name ?? null;
      } else {
        const { data } = (await supabase
          .from("suppliers")
          .select("supplier_name")
          .eq("id", partyId)
          .maybeSingle()) as { data: { supplier_name?: string } | null };
        partyName = data?.supplier_name ?? null;
      }
    }
  } catch {
    partyName = null;
  }
  const now = new Date().toISOString();
  const input = paymentInputOf(row);
  const issue: SyncIssue = {
    id: crypto.randomUUID(),
    scope,
    kind,
    requestId: row.id,
    provisionalNumber: row.provisionalNumber,
    serverInvoiceNumber: null,
    serverId: row.serverId,
    customerName: partyName,
    total: input ? input.amount : null,
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
    paymentId: row.id,
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

export type PaymentSyncOutcome = "synced" | "parked" | "queued";

export interface PaymentSyncOptions {
  server?: PaymentServer;
  /**
   * Called for every payment / void that confirms, with the server
   * payment id. The drain collects them so the caller can refresh
   * the derived figures.
   */
  onConfirmed?: (row: LocalPaymentRow, serverId: string | null) => void;
}

/**
 * Sync one pending local payment / void row. Never throws: a
 * network failure leaves the row queued (`queued`), a definitive
 * rejection parks it (`parked`), a confirmed row is removed from
 * the local store (`synced`).
 */
export async function syncOnePayment(
  supabase: SupabaseClient,
  scope: string,
  row: LocalPaymentRow,
  options: PaymentSyncOptions = {},
): Promise<PaymentSyncOutcome> {
  const server = options.server ?? createPaymentServer(supabase);
  const backend = getLocalPaymentsBackend();

  const markRejected = async (reason: string): Promise<PaymentSyncOutcome> => {
    try {
      await backend.upsert(scope, { ...row, syncStatus: "rejected", syncError: reason });
    } catch {
      /* The park below is the visible record; the row stays pending. */
    }
    return "parked";
  };

  const confirmRow = async (serverId: string | null): Promise<PaymentSyncOutcome> => {
    // Report the confirmed payment before the local row is removed,
    // so the caller can refresh the derived figures from the server
    // id (the row itself still carries none).
    try {
      options.onConfirmed?.(row, serverId);
    } catch {
      /* The figures are advisory; the payment is already synced. */
    }
    try {
      await backend.remove(scope, row.id);
    } catch {
      /* A leftover row replays harmlessly (same key → replay). */
    }
    // A payment that confirms after its issue was parked resolves
    // the issue — the panel must not keep showing it.
    await resolveIssueByRequestId(scope, row.id);
    return "synced";
  };

  try {
    if (row.action === "void") {
      // Voids have no status function, but void_payment_atomic is
      // replay-safe by void_request_key: a lost response just
      // re-submits with the same key and replays.
      const kind = paymentKindOf(row);
      const paymentId = row.input.paymentId;
      if (!kind || typeof paymentId !== "string" || paymentId.length === 0) {
        await markRejected("The voided payment could not be identified.");
        await parkPaymentAsSyncIssue(supabase, scope, row, "rejected", "The voided payment could not be identified.");
        return "parked";
      }
      try {
        const result = await server.submitVoid(
          {
            kind,
            paymentId,
            reason: typeof row.input.reason === "string" ? row.input.reason : null,
          },
          row.id,
        );
        return confirmRow(result.payment_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (isUncertainPaymentError(error)) return "queued";
        // Already voided by another device: the desired end state
        // is achieved — resolve the row instead of parking it.
        if (/already voided/i.test(message)) return confirmRow(paymentId);
        const kind2: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected"> =
          /already used for a different void/i.test(message) ? "fingerprint-mismatch" : "rejected";
        await markRejected(message || "Payment could not be voided.");
        await parkPaymentAsSyncIssue(supabase, scope, row, kind2, message || "Payment could not be voided.");
        return "parked";
      }
    }

    // "pay" rows: status-check first, then submit.
    const input = paymentInputOf(row);
    if (!input) {
      await markRejected("The payment could not be read from this device.");
      await parkPaymentAsSyncIssue(supabase, scope, row, "rejected", "The payment could not be read from this device.");
      return "parked";
    }
    try {
      const status = await server.checkStatus(row.id, input.kind);
      if (status.status === "confirmed" && status.result) {
        await landConfirmedPaymentMirror(scope, row, status.result);
        return confirmRow(status.result.payment_id);
      }
    } catch {
      // A failed status check is "unknown" — the submit below runs.
    }
    try {
      const result = await server.submit(input, row.id);
      await landConfirmedPaymentMirror(scope, row, result);
      return confirmRow(result.payment_id);
    } catch (error) {
      if (isUncertainPaymentError(error)) return "queued";
      const message = error instanceof Error ? error.message : String(error ?? "");
      const kind2: Extract<SyncIssueKind, "fingerprint-mismatch" | "rejected"> =
        /already used for a different payment/i.test(message) ? "fingerprint-mismatch" : "rejected";
      await markRejected(message || "Payment was rejected by the server.");
      await parkPaymentAsSyncIssue(supabase, scope, row, kind2, message || "Payment was rejected by the server.");
      return "parked";
    }
  } catch {
    // Any unexpected failure leaves the row queued; the next trigger retries.
    return "queued";
  }
}

export interface PaymentDrainResult {
  confirmedCount: number;
  parkedCount: number;
  queuedCount: number;
  /** True when a network failure stopped the loop early. */
  stoppedEarly: boolean;
  /** Confirmed payments, so the caller can refresh the derived figures. */
  confirmed: Array<{ localId: string; serverId: string | null; kind: PaymentKind | null; action: LocalPaymentRow["action"] }>;
}

/**
 * Drain all pending local payments / voids for a scope, oldest
 * first. A network failure stops the loop (the rest wait for the
 * next trigger). Never throws.
 */
export async function drainPendingPayments(
  supabase: SupabaseClient,
  scope: string,
  options: PaymentSyncOptions = {},
): Promise<PaymentDrainResult> {
  const result: PaymentDrainResult = {
    confirmedCount: 0,
    parkedCount: 0,
    queuedCount: 0,
    stoppedEarly: false,
    confirmed: [],
  };
  let rows: LocalPaymentRow[];
  try {
    rows = (await getLocalPaymentsBackend().list(scope)).filter(isPendingLocalPayment);
  } catch {
    return result;
  }
  let changed = false;
  const drainOptions: PaymentSyncOptions = {
    ...options,
    onConfirmed: (row, serverId) => {
      result.confirmed.push({ localId: row.id, serverId, kind: paymentKindOf(row), action: row.action });
      options.onConfirmed?.(row, serverId);
    },
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const outcome = await syncOnePayment(supabase, scope, row, drainOptions);
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
  if (changed) notifyLocalPaymentsChanged();
  return result;
}

/**
 * Owner Retry of one parked payment / void issue. Re-submits the
 * parked row with its ORIGINAL request key — safe once the cause
 * is fixed. A row that already synced elsewhere resolves the issue
 * without a write. A fingerprint mismatch is refused without
 * submitting — the same key with different contents can never
 * succeed.
 */
export async function retryPaymentSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  options: PaymentSyncOptions = {},
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getLocalPaymentsBackend();
  const issuesBackend = getSyncIssuesBackend();
  const issues = await issuesBackend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.paymentId) {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  if (issue.kind === "fingerprint-mismatch") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const rows = await backend.list(scope);
  const row = rows.find((item) => item.id === issue.paymentId);
  if (!row) {
    // The row already synced (or was discarded): the issue is done.
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (!isPendingLocalPayment(row) && row.syncStatus !== "rejected") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  // Back to pending so the submit below runs; the original request
  // key is kept — the server replays it, never duplicates it.
  try {
    await backend.upsert(scope, { ...row, syncStatus: "pending", syncError: null });
  } catch {
    return { confirmed: false, notRetryable: false, reason: "The payment could not be saved on this device." };
  }
  const outcome = await syncOnePayment(supabase, scope, { ...row, syncStatus: "pending", syncError: null }, options);
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
