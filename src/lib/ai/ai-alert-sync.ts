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
 *     source_entity_id, title) already exists — regardless of the amount
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
 *     day, e.g. today — see the generator's `expense_day` candidate).
 * Unrelated alerts (other parties, other source types — market, staff)
 * are untouched. Regeneration is the generator's own full pass,
 * which only inserts genuinely-new alerts (its dedupe skips the ones
 * that are still active with the same title), so untouched alerts are
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
 * (a separate, heavier item); and the currency-blind alert thresholds
 * (`payable >= 100000` compares a books-currency amount against a
 * hardcoded 100,000, so in EUR the payable alert effectively never
 * fires — the stale Rs alert was the only reason the card showed one).
 */

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
 * Which stored alerts a save makes stale: the active/new alerts for the
 * party whose figures the save changed, in the source type that carries
 * those figures. Returns alert ids (deduped, in input order).
 *
 * - sale / customer_payment / sales_return with a customer id: that
 *   customer's `customer_credit` (overdue) alerts.
 * - purchase / supplier_payment / purchase_return with a supplier id:
 *   that supplier's `supplier_ledger` (payable) alerts.
 * - expense with a day: that day's `expenses` alert (the generator's
 *   `expense_day` candidate keys the alert by day, not by expense id).
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
  const target =
    save.kind === "expense"
      ? { sourceType: "expenses", entityId: save.expenseDay ?? null }
      : save.kind === "sale" ||
          save.kind === "customer_payment" ||
          save.kind === "sales_return"
        ? { sourceType: "customer_credit", entityId: save.customerId ?? null }
        : { sourceType: "supplier_ledger", entityId: save.supplierId ?? null };
  const entityId = typeof target.entityId === "string" ? target.entityId.trim() : "";
  if (entityId === "") return [];

  const ids: string[] = [];
  for (const alert of alerts) {
    if (!SHOWN_AI_ALERT_STATUSES.includes(alert.status)) continue;
    if (alert.source_type !== target.sourceType) continue;
    if (alert.source_entity_id !== entityId) continue;
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
