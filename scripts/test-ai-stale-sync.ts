/**
 * Live vs stale AI data sync (P1 Area J) — Unit Tests.
 *
 * Defect: the dashboard AI Insight card shows the LATEST STORED alert
 * from the `ai_alerts` table (status active/new, newest first), NOT a
 * live computation. Alerts are generated only by
 * `generateAiBusinessAlerts` (owner-only, on demand), and NO save
 * handler ever touched `ai_alerts`. The live card read
 * "Current payable is Rs204,000." — generated while the books currency
 * was PKR, before the EUR switch — and the summary text embeds the
 * formatted money at generation time, so the figure and the currency
 * stay wrong until the alert is replaced.
 *
 * Two mechanisms made the staleness permanent:
 * (1) the embedded generation-time figure/currency above;
 * (2) the generator's dedupe lock — a candidate is skipped when an
 *     ACTIVE alert with the same (alert_type, source_entity_type,
 *     source_entity_id, title) already exists, whatever its amount.
 *     Regenerating alone can therefore NEVER fix a stale figure: the
 *     old alert must be resolved FIRST, then a fresh one can be created.
 *
 * Fix (UMAIR, 2026-11-18): on every sale / purchase / customer-payment
 * / supplier-payment save, the AI insight cache is invalidated
 * automatically (targeted: only the alerts for the party whose figures
 * the save changed) and, when the saver is owner/admin, fresh alerts
 * are regenerated from live data in the ACTIVE books currency. The
 * page-level hook (`refreshAiAlertsAfterSave`) is fire-and-forget and
 * fail-open: it must NEVER fail, delay or change a save. Staff saves
 * invalidate only (the generator is owner-gated). Offline-parked saves
 * never sync — their figures have not reached the server yet.
 *
 * This test imports the production helpers directly (no mirroring)
 * and asserts the wiring on the real page.tsx / formatters.ts sources.
 *
 * Run: npx tsx scripts/test-ai-stale-sync.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  AI_ALERT_SYNC_SAVE_KIND_LABEL,
  SHOWN_AI_ALERT_STATUSES,
  shouldRegenerateAiAlertsAfterSave,
  staleAiAlertIdsForSave,
  type AiAlertLike,
} from "../src/lib/ai/ai-alert-sync";
import { dashboardAiInsightKind } from "../src/lib/dashboard/ai-insight";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function alert(
  id: string,
  status: string,
  sourceType: string | null,
  sourceEntityId: string | null,
): AiAlertLike {
  return { id, status, source_type: sourceType, source_entity_id: sourceEntityId };
}

function main(): void {
  const pageSource = readFileSync("src/app/page.tsx", "utf8");
  const formattersSource = readFileSync("src/lib/tradeos/formatters.ts", "utf8");
  const generatorStart = pageSource.indexOf("const generateAiBusinessAlerts");
  const generatorEnd = pageSource.indexOf("const updateAiAlertStatus");
  const generatorSource = pageSource.slice(generatorStart, generatorEnd);
  const hookStart = pageSource.indexOf("const refreshAiAlertsAfterSave");
  const hookEnd = pageSource.indexOf("const updateAiAlertStatus", hookStart);
  const hookSource = pageSource.slice(hookStart, hookEnd);

  // The live stale alert: supplier payable, active, Rs204,000 era.
  const stalePayable = alert("alert-payable-1", "active", "supplier_ledger", "supplier-1");
  const otherSupplierPayable = alert("alert-payable-2", "active", "supplier_ledger", "supplier-2");
  const overdueC1 = alert("alert-overdue-1", "active", "customer_credit", "customer-1");
  const overdueC2 = alert("alert-overdue-2", "active", "customer_credit", "customer-2");
  const marketAlert = alert("alert-market-1", "active", "market_intelligence", "market-1");
  const expenseAlert = alert("alert-expense-1", "active", "expenses", "2026-11-18");
  const resolvedPayable = alert("alert-payable-3", "resolved", "supplier_ledger", "supplier-1");
  const newOverdue = alert("alert-overdue-3", "new", "customer_credit", "customer-1");
  const allAlerts = [
    stalePayable,
    otherSupplierPayable,
    overdueC1,
    overdueC2,
    marketAlert,
    expenseAlert,
    resolvedPayable,
    newOverdue,
  ];

  console.log("(a) invalidation is targeted by save kind + party");
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "purchase", supplierId: "supplier-1" }, allAlerts)) ===
      JSON.stringify(["alert-payable-1"]),
    "purchase from S1 resolves only S1's active supplier_ledger alert",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "supplier_payment", supplierId: "supplier-1" }, allAlerts)) ===
      JSON.stringify(["alert-payable-1"]),
    "supplier payment to S1 resolves only S1's active supplier_ledger alert",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, allAlerts)) ===
      JSON.stringify(["alert-overdue-1", "alert-overdue-3"]),
    "sale to C1 resolves C1's active AND new customer_credit alerts",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "customer_payment", customerId: "customer-1" }, allAlerts)) ===
      JSON.stringify(["alert-overdue-1", "alert-overdue-3"]),
    "customer payment from C1 resolves C1's customer_credit alerts",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "purchase", supplierId: "supplier-1" }, allAlerts).includes("alert-payable-3"),
    "already-resolved alerts are never re-resolved",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, allAlerts).includes("alert-market-1") &&
      !staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, allAlerts).includes("alert-expense-1"),
    "market / expense alerts are untouched by a sale",
  );
  check(
    staleAiAlertIdsForSave({ kind: "sale", customerId: null }, allAlerts).length === 0 &&
      staleAiAlertIdsForSave({ kind: "sale", customerId: "   " }, allAlerts).length === 0,
    "walk-in sale (no customer id) invalidates nothing",
  );
  check(
    staleAiAlertIdsForSave({ kind: "purchase", supplierId: undefined }, allAlerts).length === 0,
    "purchase with no supplier id invalidates nothing",
  );
  check(
    staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, []).length === 0,
    "no alerts at all -> nothing to invalidate",
  );
  check(
    JSON.stringify(
      staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, [overdueC1, overdueC1]),
    ) === JSON.stringify(["alert-overdue-1"]),
    "duplicate alert rows resolve to one id",
  );

  console.log("(b) regeneration is owner-gated; invalidation is not");
  check(shouldRegenerateAiAlertsAfterSave("owner") === true, "owner regenerates after save");
  check(shouldRegenerateAiAlertsAfterSave("admin") === true, "admin regenerates after save");
  check(shouldRegenerateAiAlertsAfterSave("salesman") === false, "staff (salesman) does NOT regenerate");
  check(shouldRegenerateAiAlertsAfterSave("staff") === false, "staff role does NOT regenerate");
  check(shouldRegenerateAiAlertsAfterSave(null) === false, "null role does NOT regenerate");
  check(shouldRegenerateAiAlertsAfterSave(undefined) === false, "undefined role does NOT regenerate");
  check(
    AI_ALERT_SYNC_SAVE_KIND_LABEL.sale === "sale" &&
      AI_ALERT_SYNC_SAVE_KIND_LABEL.purchase === "purchase" &&
      AI_ALERT_SYNC_SAVE_KIND_LABEL.customer_payment === "customer payment" &&
      AI_ALERT_SYNC_SAVE_KIND_LABEL.supplier_payment === "supplier payment",
    "save-kind labels exist for the audit entry",
  );
  check(
    SHOWN_AI_ALERT_STATUSES.includes("active") && SHOWN_AI_ALERT_STATUSES.includes("new"),
    "shown statuses are active + new (the card's read filter)",
  );

  console.log("(c) regeneration uses the ACTIVE books currency, never a hardcoded one");
  check(
    formattersSource.includes("export const formatBooksMoney = (value: unknown, currency: Currency = activeBooksCurrency)"),
    "formatBooksMoney defaults to the active books currency",
  );
  check(
    generatorSource.includes("formatBooksMoney(payable)"),
    "supplier payable candidate formats with formatBooksMoney (active books currency)",
  );
  check(
    !/["']Rs/.test(generatorSource) && !generatorSource.includes('"PKR"') && !generatorSource.includes("'PKR'"),
    "generator candidate block hardcodes no Rs/PKR currency",
  );
  check(
    generatorSource.includes("supplierPaymentAllocationByPurchaseTransaction"),
    "payable candidate is computed from the live allocation map",
  );

  console.log("(d) after invalidation the card no longer shows the stale figure");
  check(
    dashboardAiInsightKind({ hasActiveAlert: true, outOfStockCount: 18, lowStockCount: 2 }) === "alert",
    "before the save the stale alert wins the card",
  );
  const remainingAfterSave = allAlerts.filter(
    (a) => !staleAiAlertIdsForSave({ kind: "supplier_payment", supplierId: "supplier-1" }, allAlerts).includes(a.id),
  );
  const hasActiveAlertAfterSave = remainingAfterSave.some(
    (a) => SHOWN_AI_ALERT_STATUSES.includes(a.status) && a.id === "alert-payable-1",
  );
  check(hasActiveAlertAfterSave === false, "the stale Rs204,000 alert is gone after the save");
  check(
    dashboardAiInsightKind({ hasActiveAlert: false, outOfStockCount: 18, lowStockCount: 2 }) === "fallback",
    "with the stale alert resolved the card falls to the honest low-stock fallback, not the stale figure",
  );
  check(
    dashboardAiInsightKind({ hasActiveAlert: false, outOfStockCount: 0, lowStockCount: 0 }) === "none",
    "with no alert and no stock problem the card hides",
  );

  console.log("(e) the sync is fail-open and never throws into the save path");
  check(
    hookSource.includes("try {") && hookSource.includes("} catch (err) {"),
    "refreshAiAlertsAfterSave wraps everything in try/catch",
  );
  check(
    hookSource.includes("void (async () => {"),
    "refreshAiAlertsAfterSave is fire-and-forget (void async IIFE, never awaited by the save)",
  );
  check(
    hookSource.includes("AI alert sync after save failed (non-fatal)"),
    "sync failures are logged as non-fatal, never surfaced",
  );
  check(
    staleAiAlertIdsForSave({ kind: "sale", customerId: "customer-1" }, []) !== null,
    "decision helper never throws on empty input",
  );
  check(
    pageSource.includes(
      'refreshAiAlertsAfterSave({ kind: "sale", customerId: saleCustomerId })',
    ) &&
      pageSource.includes(
        'const saleCustomerId = typeof transaction.customer_id === "string" ? transaction.customer_id : null;',
      ),
    "sale hook passes the confirmed transaction's customer id (narrowed from unknown)",
  );

  console.log("(f) all five save completions are hooked; offline saves are not");
  check(
    pageSource.includes("refreshAiAlertsAfterSave({ kind: \"sale\", customerId: order.customer_id })"),
    "draft approval hooks the sale sync with the order's customer id",
  );
  check(
    pageSource.includes("refreshAiAlertsAfterSave({ kind: \"purchase\", supplierId: selectedSupplierId })"),
    "purchase save hooks the supplier sync",
  );
  check(
    pageSource.includes("refreshAiAlertsAfterSave({ kind: \"customer_payment\", customerId: selectedCustomerPaymentId })"),
    "customer payment save hooks the customer sync",
  );
  check(
    pageSource.includes("refreshAiAlertsAfterSave({ kind: \"supplier_payment\", supplierId: selectedSupplierPaymentId })"),
    "supplier payment save hooks the supplier sync",
  );
  check(
    !pageSource.includes("refreshAiAlertsAfterSave({ kind: \"return\""),
    "returns are NOT hooked (out of scope by design)",
  );
  const saleHookIndex = pageSource.indexOf(
    'refreshAiAlertsAfterSave({ kind: "sale", customerId: saleCustomerId })',
  );
  const queuedReturnIndex = pageSource.indexOf("completeActiveMiniTab();", pageSource.indexOf("if (\"queued\" in saved"));
  check(
    saleHookIndex > 0 && queuedReturnIndex > 0 && queuedReturnIndex < saleHookIndex,
    "queued/parked (unconfirmed) sale returns BEFORE the hook — no invalidation for unconfirmed sales",
  );
  check(
    pageSource.includes("if (!customerPaymentSavedOffline) {") &&
      pageSource.includes("if (!supplierPaymentSavedOffline) {"),
    "offline-parked payments are guarded out of the sync",
  );

  console.log("(g) regeneration runs silently and on fresh state");
  check(
    generatorSource.includes("async (options?: { silent?: boolean })") &&
      generatorSource.includes("const silent = options?.silent === true;"),
    "generator accepts a silent option",
  );
  check(
    hookSource.includes("generateAiBusinessAlerts({ silent: true })"),
    "post-save regeneration runs silent (no briefing toasts during a save)",
  );
  check(
    hookSource.includes("shouldRegenerateAiAlertsAfterSave(currentProfile?.role ?? null)"),
    "regeneration is gated on the saver's role",
  );
  check(
    pageSource.includes("const fetchAiAlerts = async (organizationId?: string | null): Promise<AiAlert[]>"),
    "fetchAiAlerts returns its rows",
  );
  check(
    hookSource.includes("const freshAlerts = await fetchAiAlerts(currentOrganizationId);") &&
      hookSource.includes("staleAiAlertIdsForSave(save, freshAlerts)"),
    "the hook decides on fresh server rows, not rendered state",
  );
  check(
    hookSource.indexOf("await fetchAiAlerts(currentOrganizationId);") <
      hookSource.indexOf("generateAiBusinessAlerts({ silent: true })"),
    "state is re-read after resolving, so the generator's dedupe sees the resolved rows",
  );

  console.log("(h) scope: thresholds and schema untouched, no migration");
  check(
    generatorSource.includes("payable >= 100000"),
    "payable threshold is UNCHANGED (currency-blind threshold is a reported follow-up, not this slice)",
  );
  check(
    !readdirSync("src/lib/migrations").some((f) => f.includes("ai_alert") || f.includes("stale")),
    "no migration was added for this slice",
  );
  check(
    pageSource.includes("confidence: 85,") && pageSource.includes("confidence: 90,"),
    "confidence 85/90 are untouched by this slice (separate tracker item)",
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main();
