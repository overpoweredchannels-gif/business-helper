/**
 * AI Insight cache sync (P1 Area J — live vs stale AI data sync).
 *
 * Defect: the dashboard AI Insight card shows the LATEST STORED alert
 * from the `ai_alerts` table (status active/new, newest first — see
 * page.tsx, the aiInsight builder), NOT a live computation. Alerts are
 * generated only by `generateAiBusinessAlerts` (owner-only, on demand:
 * the daily briefing, or the voice summary when zero alerts are active),
 * and NO save handler ever touched `ai_alerts` — a sale, purchase or
 * payment left the stored alerts exactly as they were.
 *
 * Two mechanisms made the staleness permanent:
 *
 * (1) The alert summary text EMBEDS the formatted money at generation
 *     time (`formatBooksMoney(payable)`). The live card read
 *     "Current payable is Rs204,000." — Rs + 204,000 means it was
 *     generated while the books currency was PKR, before the EUR switch.
 *     The figure and the currency stay wrong until the alert is replaced.
 *
 * (2) The generator's dedupe lock: a candidate is skipped when an ACTIVE
 *     alert with the same (alert_type, source_entity_type,
 *     source_entity_id) already exists — regardless of the amount
 *     in its summary. Regenerating alone can therefore NEVER fix a stale
 *     figure: the old alert must be resolved FIRST, and only then can a
 *     fresh alert with live figures (in the ACTIVE books currency, via
 *     `formatBooksMoney`'s default) be created.
 *
 * Fix (UMAIR, 2026-11-18): on every sale / purchase / customer-payment /
 * supplier-payment save, the AI insight cache is invalidated
 * automatically — the stale active alerts that depend on the changed
 * figures are resolved — and, when the saver is owner/admin, fresh
 * alerts are regenerated from live data immediately. The save itself
 * must NEVER fail because this sync failed: the page-level hook is
 * fire-and-forget and fail-open (try/catch, log only).
 *
 * Extension (2026-11-20, same rules): sales returns and purchase
 * returns hook the same path — a return changes the same
 * customer/supplier figures the sale/purchase hooks cover (a return
 * cancel reverses them again, so it hooks too) — and expense saves
 * hook it for the separate `expenses` source type. Cross-tab refresh
 * (see `ai-alert-sync-broadcast.ts`) keeps a second open tab fresh.
 *
 * Invalidation is TARGETED, not blanket: a save only resolves the
 * alerts for the party whose figures it changed —
 *   sale / customer payment / sales return -> the customer's
 *     `customer_credit` (overdue) alerts;
 *   purchase / supplier payment / purchase return -> the supplier's
 *     `supplier_ledger` (payable) alerts;
 *   expense -> that day's `expenses` alert (source_entity_id is the
 *     deterministic UUID derived from the day — see
 *     `dayKeyedAlertEntityId` in ai-alert-entity-ids.ts — never the raw
 *     date string, which the UUID column rejects and which poisoned the
 *     whole batch insert on 2026-11-20).
 * Unrelated alerts (other parties, other source types — market, staff)
 * are untouched. Regeneration is the generator's own full pass,
 * which only inserts genuinely-new alerts (its dedupe skips the ones
 * that are still active with the same key), so untouched alerts are
 * never churned.
 *
 * Staff saves invalidate but do NOT regenerate: the generator is
 * owner-gated (`isOwnerOrAdmin`), while resolving an alert needs no
 * owner role (same as the manual status update). After a staff save the
 * card falls to its honest fallback until an owner regenerates (next
 * owner save, daily briefing, or voice summary).
 *
 * Deliberately OUT of scope here: the brain health-score
 * formula (the chat's 60 vs the dashboard ring's 75 is a DIFFERENT
 * formula in `memory-writer.ts`, not staleness); the hardcoded "PKR"
 * labels in the business-brain context text
 * (`context-retriever.ts` / `business-memory.ts`); the brain store
 * itself, which is built once at load and never refreshed on save
 * (a separate, heavier item). The currency-blind alert thresholds
 * were out of scope here too — they are fixed in
 * `src/lib/ai/ai-alert-thresholds.ts` (2026-11-20) as a RELATIVE rule:
 * each threshold is a share of the org's own live figures (5% of total
 * outstanding payables, 10% of trailing-30-day expenses, 10% of total
 * outstanding receivables), so a EUR org's €660 payable qualifies
 * instead of never firing. No stored exchange rate is involved: the
 * first version of that slice scaled at the stored rate and was
 * discarded on the user's correction (a stale rate would silently
 * mis-set the threshold).
 */

import { dayKeyedAlertEntityId } from "./ai-alert-entity-ids";

export type AiAlertSyncSaveKind =
  | "sale"
  | "purchase"
  | "customer_payment"
  | "supplier_payment"
  | "sales_return"
  | "purchase_return"
  | "expense";

export interface AiAlertSyncSave {
  kind: AiAlertSyncSaveKind;
  /** Customer whose overdue figures the save changed (sale / customer payment / sales return). */
  customerId?: string | null;
  /** Supplier whose payable figures the save changed (purchase / supplier payment / purchase return). */
  supplierId?: string | null;
  /** Day (YYYY-MM-DD) whose expense total the save changed (expense only — the `expense_day` key). */
  expenseDay?: string | null;
}

/** Minimal shape of an `ai_alerts` row the sync decision needs. */
export interface AiAlertLike {
  id: string;
  status: string;
  source_type: string | null;
  source_entity_id: string | null;
}

/**
 * Statuses the AI Insight card reads (page.tsx aiInsight builder:
 * `status === "active" || status === "new"`). Only these can show a
 * stale figure on the card, so only these are invalidated.
 */
export const SHOWN_AI_ALERT_STATUSES: ReadonlyArray<string> = ["active", "new"];

/** Human label for a save kind, used in the audit entry. */
export const AI_ALERT_SYNC_SAVE_KIND_LABEL: Record<AiAlertSyncSaveKind, string> = {
  sale: "sale",
  purchase: "purchase",
  customer_payment: "customer payment",
  supplier_payment: "supplier payment",
  sales_return: "sales return",
  purchase_return: "purchase return",
  expense: "expense",
};

/**
 * The single atomic-update target for a save's invalidation: the
 * source type and entity ids whose shown (active/new) alerts the save
 * makes stale. Returns null when the save invalidates nothing (no
 * party id, or an expense save with no day).
 *
 * This is the SAME decision `staleAiAlertIdsForSave` makes, factored
 * out so the save hook can resolve in ONE update — `update ai_alerts
 * set status='resolved' ... where organization_id=? and
 * source_type=? and source_entity_id in (...) and status in
 * ('active','new')` — instead of reading rows and then updating by
 * id. The read-then-write races a second tab: an alert created
 * between the read and the update is never invalidated and lives on
 * as a stale alert (the reverse of the 37→36 veto, same stale-state
 * class, 2026-11-23).
 */
export function staleAiAlertUpdateTarget(
  save: AiAlertSyncSave,
): { sourceType: string; entityIds: string[] } | null {
  // Expense rows are keyed by the deterministic UUID derived from the
  // day (see ai-alert-entity-ids.ts) — but the raw date string is
  // matched too, defensively: a row stored under the old identity
  // (written before the UUID fix, or by a path that never went through
  // the generator) must still invalidate when its day's figures
  // change. A raw-date row could not be stored through the client
  // generator (the UUID column rejects it), so this costs nothing on
  // the normal path and only ever helps on a legacy row.
  const expenseEntityIds =
    save.kind === "expense" &&
    typeof save.expenseDay === "string" &&
    save.expenseDay.trim() !== ""
      ? [dayKeyedAlertEntityId("expense_day", save.expenseDay), save.expenseDay.trim()]
      : [];
  const target =
    save.kind === "expense"
      ? { sourceType: "expenses", entityIds: expenseEntityIds }
      : save.kind === "sale" ||
          save.kind === "customer_payment" ||
          save.kind === "sales_return"
        ? { sourceType: "customer_credit", entityIds: save.customerId ? [save.customerId] : [] }
        : { sourceType: "supplier_ledger", entityIds: save.supplierId ? [save.supplierId] : [] };
  const entityIds = target.entityIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id !== "");
  if (entityIds.length === 0) return null;
  return { sourceType: target.sourceType, entityIds };
}

/**
 * Which stored alerts a save makes stale: the active/new alerts for the
 * party whose figures the save changed, in the source type that carries
 * those figures. Returns alert ids (deduped, in input order).
 *
 * - sale / customer_payment / sales_return with a customer id: that
 *   customer's `customer_credit` (overdue) alerts.
 * - purchase / supplier_payment / purchase_return with a supplier id:
 *   that supplier's `supplier_ledger` (payable) alerts.
 * - expense with a day: that day's `expenses` alert (the generator's
 *   `expense_day` candidate keys the alert by day — the stored id is
 *   the deterministic UUID derived from the day, but the raw date
 *   string is matched too, defensively: a row stored under the old
 *   identity must still invalidate when its day's figures change).
 * - a save with no party id (e.g. a walk-in cash sale, which has no
 *   customer record) changes no party's overdue/payable figures, so
 *   nothing is invalidated; an expense save with no day invalidates
 *   nothing.
 * - already-resolved/archived alerts and alerts for other parties or
 *   other source types (market, staff) are untouched.
 */
export function staleAiAlertIdsForSave(
  save: AiAlertSyncSave,
  alerts: ReadonlyArray<AiAlertLike>,
): string[] {
  const target = staleAiAlertUpdateTarget(save);
  if (target === null) return [];

  const ids: string[] = [];
  for (const alert of alerts) {
    if (!SHOWN_AI_ALERT_STATUSES.includes(alert.status)) continue;
    if (alert.source_type !== target.sourceType) continue;
    if (alert.source_entity_id === null || !target.entityIds.includes(alert.source_entity_id)) continue;
    if (!ids.includes(alert.id)) ids.push(alert.id);
  }
  return ids;
}

/**
 * Regeneration reuses `generateAiBusinessAlerts`, which is owner-gated
 * (`isOwnerOrAdmin`). Staff saves invalidate only; the card then shows
 * its honest fallback until an owner regenerates.
 */
export function shouldRegenerateAiAlertsAfterSave(
  role: string | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}
