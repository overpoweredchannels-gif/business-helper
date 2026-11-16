/**
 * Slice S3 — provisional receipt number link (Offline Tier-1).
 *
 * After `create_sales_invoice_atomic` confirms a sale, the sync records
 * the local provisional number (`L-000123`) on the confirmed cloud row
 * (`sales_transactions.provisional_receipt_number`, added by
 * `src/lib/migrations/provisional_receipt_number.sql` — additive only,
 * run by UMAIR: disposable first, then production), so the bill is
 * searchable by the number on the paper receipt too (UMAIR's decision
 * 2, 2026-11-17).
 *
 * The write is a plain UPDATE with the user's JWT. It is permitted by
 * the RLS policies: the permissive `sales_transactions_update_org`
 * allows updates in the actor's org, and the restrictive
 * `sales_access_update` requires `sales_tool_allowed(org, 'owner')` —
 * the same check the sale RPC itself enforces, so any actor that could
 * confirm the sale can also link it.
 *
 * The link must never fail a confirmed sale: a confirmed sale stays
 * confirmed even when the link cannot be written. A failed link is
 * kept as a `provisional-link` issue row and retried on every later
 * sync run until it succeeds. While the failure is only "column does
 * not exist" (the migration has not been run yet) the row stays silent
 * in the UI — it is a pending retry, not something the owner must act
 * on. Any other failure sets `syncError` and the row shows in Sync
 * issues.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  resolveIssueByRequestId,
  type SyncIssue,
} from "@/lib/offline/sync-issues";
import { upsertConfirmedSaleMirror } from "@/lib/offline/history-mirror";
import type { AtomicSaleResult, PendingSale } from "@/lib/sales/atomic-sale-client";

export type ProvisionalLinkResult =
  | { ok: true }
  | { ok: false; error: string; migrationMissing: boolean };

/** True when the failure is only "the column is not there yet". */
export function isMigrationMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /provisional_receipt_number/i.test(error.message ?? "") && /does not exist/i.test(error.message ?? "");
}

/**
 * Write the provisional number onto one confirmed cloud invoice.
 * Returns the failure (never throws) so the caller can keep the link
 * pending without failing the sync.
 */
export async function linkProvisionalNumber(
  supabase: SupabaseClient,
  serverId: string,
  provisionalNumber: string,
): Promise<ProvisionalLinkResult> {
  try {
    const { error } = (await supabase
      .from("sales_transactions")
      .update({ provisional_receipt_number: provisionalNumber })
      .eq("id", serverId)) as { error: { code?: string; message?: string } | null };
    if (!error) return { ok: true };
    return { ok: false, error: error.message ?? "Provisional number could not be linked", migrationMissing: isMigrationMissingColumnError(error) };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Provisional number could not be linked";
    return { ok: false, error: message, migrationMissing: false };
  }
}

function pendingLinkIssue(
  scope: string,
  serverId: string,
  serverInvoiceNumber: string,
  provisionalNumber: string,
  syncError: string | null,
): SyncIssue {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    scope,
    kind: "provisional-link",
    requestId: null,
    provisionalNumber,
    serverInvoiceNumber,
    serverId,
    customerName: null,
    customerId: null,
    total: null,
    reason: `Provisional number ${provisionalNumber} is not yet linked to invoice ${serverInvoiceNumber}.`,
    payload: null,
    status: "open",
    syncError,
    createdAt: now,
    updatedAt: now,
  };
}

/** Record (or refresh) the pending link for one confirmed sale. */
export async function recordPendingLink(
  scope: string,
  serverId: string,
  serverInvoiceNumber: string,
  provisionalNumber: string,
  syncError: string | null,
): Promise<void> {
  try {
    await getSyncIssuesBackend().upsert(scope, pendingLinkIssue(scope, serverId, serverInvoiceNumber, provisionalNumber, syncError));
    notifySyncIssuesChanged();
  } catch {
    /* Best-effort: the sale is confirmed; the link retries next run. */
  }
}

/**
 * Retry every open provisional link for a scope. Called after each
 * drain. A link that now succeeds resolves its issue row; a link that
 * still fails stays pending (silent while the column is missing, shown
 * once it fails for another reason).
 */
export async function retryPendingLinks(supabase: SupabaseClient, scope: string): Promise<number> {
  let linked = 0;
  try {
    const backend = getSyncIssuesBackend();
    const issues = await backend.list(scope);
    const pending = issues.filter(
      (issue) => issue.kind === "provisional-link" && issue.status === "open" && issue.serverId && issue.provisionalNumber,
    );
    for (const issue of pending) {
      const result = await linkProvisionalNumber(supabase, issue.serverId as string, issue.provisionalNumber as string);
      if (result.ok) {
        await backend.setStatus(scope, issue.id, "resolved");
        linked += 1;
      } else {
        await backend.update(scope, issue.id, {
          syncError: result.migrationMissing ? null : result.error,
        });
      }
    }
    if (pending.length > 0) notifySyncIssuesChanged();
  } catch {
    /* Best-effort — see recordPendingLink. */
  }
  return linked;
}

/**
 * Run after ANY confirmation of an attempt (fresh submit or status
 * check): link the provisional number when the sale had one, and
 * resolve the open issue when a retried parked sale confirms. Never
 * throws — a confirmed sale must never be un-confirmed by a link or
 * resolve failure.
 */
export async function afterSaleConfirmed(
  supabase: SupabaseClient,
  scope: string,
  attempt: PendingSale,
  result: AtomicSaleResult,
): Promise<void> {
  const transaction = result.transaction as Record<string, unknown>;
  const serverId = typeof transaction.id === "string" ? transaction.id : "";
  const serverInvoiceNumber =
    typeof transaction.invoice_number === "string" ? transaction.invoice_number : "";
  if (attempt.provisionalNumber && serverId) {
    const linked = await linkProvisionalNumber(supabase, serverId, attempt.provisionalNumber);
    if (!linked.ok) {
      await recordPendingLink(
        scope,
        serverId,
        serverInvoiceNumber,
        attempt.provisionalNumber,
        linked.migrationMissing ? null : linked.error,
      );
    }
  }
  // Slice S4 — the confirmed sale lands in the history mirror now, so
  // the desktop history stays correct even if the app quits before the
  // refetch runs. Never throws; a failed upsert is healed by the next
  // fetch. (On web there is no mirror backend, so this is a no-op.)
  await upsertConfirmedSaleMirror(scope, attempt, result);
  if (attempt.requestId) {
    await resolveIssueByRequestId(scope, attempt.requestId);
  }
}
