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
 * Extension (2026-11-20): sales returns and purchase returns hook the
 * same path (a return changes the same customer/supplier figures; a
 * return cancel reverses them, so it hooks too), expense saves hook it
 * for the separate `expenses` source type (keyed by day), and a save in
 * one tab broadcasts so a second open tab re-reads its rows instead of
 * staying stale until reload (BroadcastChannel + storage-event fallback
 * — see `src/lib/ai/ai-alert-sync-broadcast.ts`).
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
import { dayKeyedAlertEntityId } from "../src/lib/ai/ai-alert-entity-ids";
import {
  AI_ALERTS_CROSS_TAB_CHANNEL,
  AI_ALERTS_CROSS_TAB_STORAGE_KEY,
  aiAlertsInvalidatedMessage,
  broadcastAiAlertsInvalidated,
  isAiAlertsInvalidatedMessage,
  subscribeAiAlertsInvalidated,
} from "../src/lib/ai/ai-alert-sync-broadcast";
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
  // Stored expense alerts are keyed by the deterministic UUID derived
  // from the day (see ai-alert-entity-ids.ts), never the raw date
  // string — the UUID column rejects that, and a date-string row could
  // never have been stored in the first place.
  const expenseAlert = alert("alert-expense-1", "active", "expenses", dayKeyedAlertEntityId("expense_day", "2026-11-18"));
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
    AI_ALERT_SYNC_SAVE_KIND_LABEL.sales_return === "sales return" &&
      AI_ALERT_SYNC_SAVE_KIND_LABEL.purchase_return === "purchase return" &&
      AI_ALERT_SYNC_SAVE_KIND_LABEL.expense === "expense",
    "extension save-kind labels exist for the audit entry (returns + expense)",
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

  console.log("(f) all save completions are hooked; offline saves are not");
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
    pageSource.includes('refreshAiAlertsAfterSave({ kind: "sales_return", customerId: srCustomerId })'),
    "sales return save hooks the customer sync with the form's customer id",
  );
  check(
    pageSource.includes('refreshAiAlertsAfterSave({ kind: "purchase_return", supplierId: returnSupplierId })'),
    "purchase return save hooks the supplier sync with the form's supplier id",
  );
  check(
    pageSource.includes('refreshAiAlertsAfterSave({ kind: "sales_return", customerId: salesReturn.customer_id })'),
    "sales return cancel hooks the customer sync (the receivable offset restores)",
  );
  check(
    pageSource.includes('refreshAiAlertsAfterSave({ kind: "purchase_return", supplierId: purchaseReturn.supplier_id })'),
    "purchase return cancel hooks the supplier sync (the payable offset restores)",
  );
  check(
    pageSource.includes('refreshAiAlertsAfterSave({ kind: "expense", expenseDay: expensePayload.expense_date })'),
    "expense save hooks the expense-day sync with the saved payload's date",
  );
  const purchaseReturnFn = pageSource.slice(
    pageSource.indexOf("const handleCreatePurchaseReturn"),
    pageSource.indexOf("const handleCancelPurchaseReturn"),
  );
  check(
    purchaseReturnFn.indexOf('refreshAiAlertsAfterSave({ kind: "purchase_return"') > 0 &&
      purchaseReturnFn.indexOf("if (isDesktopApp() && typeof navigator !== \"undefined\" && !navigator.onLine) {") <
        purchaseReturnFn.indexOf('refreshAiAlertsAfterSave({ kind: "purchase_return"'),
    "offline-parked purchase return returns before the hook — no invalidation for unconfirmed returns",
  );
  const salesReturnFn = pageSource.slice(
    pageSource.indexOf("const handleCreateSalesReturn"),
    pageSource.indexOf("const handleCancelSalesReturn"),
  );
  check(
    salesReturnFn.indexOf('refreshAiAlertsAfterSave({ kind: "sales_return"') > 0 &&
      salesReturnFn.indexOf("if (isDesktopApp() && typeof navigator !== \"undefined\" && !navigator.onLine) {") <
        salesReturnFn.indexOf('refreshAiAlertsAfterSave({ kind: "sales_return"'),
    "offline-parked sales return returns before the hook — no invalidation for unconfirmed returns",
  );
  const expenseFn = pageSource.slice(
    pageSource.indexOf("const saveExpense"),
    pageSource.indexOf("const handleAddPurchaseExpense"),
  );
  check(
    expenseFn.indexOf('refreshAiAlertsAfterSave({ kind: "expense"') > 0 &&
      expenseFn.indexOf("if (expenseOffline) {") <
        expenseFn.indexOf('refreshAiAlertsAfterSave({ kind: "expense"'),
    "offline-parked expense returns before the hook — no invalidation for unconfirmed expenses",
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

  console.log("(h) scope: thresholds are relative to the org's own figures, no migration");
  check(
    generatorSource.includes("item.payable >= alertThresholds.supplierPayable"),
    "payable threshold is the relative books-currency value (threshold slice, 2026-11-20 — the old hardcoded 100,000 is gone)",
  );
  check(
    !readdirSync("src/lib/migrations").some((f) => f.includes("ai_alert") || f.includes("stale")),
    "no migration was added for this slice",
  );
  check(
    pageSource.includes("confidence: 85,") && pageSource.includes("confidence: 90,"),
    "confidence 85/90 are untouched by this slice (separate tracker item)",
  );

  console.log("(i) extension: returns invalidate the same party figures as the sale/purchase");
  const expenseDay2 = alert("alert-expense-2", "active", "expenses", dayKeyedAlertEntityId("expense_day", "2026-11-19"));
  const expenseResolvedToday = alert("alert-expense-3", "resolved", "expenses", dayKeyedAlertEntityId("expense_day", "2026-11-18"));
  const alertsWithExpenseDays = [...allAlerts, expenseDay2, expenseResolvedToday];
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "sales_return", customerId: "customer-1" }, allAlerts)) ===
      JSON.stringify(["alert-overdue-1", "alert-overdue-3"]),
    "sales return from C1 resolves C1's active AND new customer_credit alerts",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "purchase_return", supplierId: "supplier-1" }, allAlerts)) ===
      JSON.stringify(["alert-payable-1"]),
    "purchase return to S1 resolves only S1's active supplier_ledger alert",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "sales_return", customerId: "customer-2" }, allAlerts)) ===
      JSON.stringify(["alert-overdue-2"]),
    "sales return from C2 resolves only C2's customer_credit alert",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "purchase_return", supplierId: "supplier-2" }, allAlerts)) ===
      JSON.stringify(["alert-payable-2"]),
    "purchase return to S2 resolves only S2's supplier_ledger alert",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "sales_return", customerId: "customer-1" }, allAlerts).includes("alert-payable-1") &&
      !staleAiAlertIdsForSave({ kind: "purchase_return", supplierId: "supplier-1" }, allAlerts).includes("alert-overdue-1"),
    "a return never touches the other side's alerts",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "sales_return", customerId: "customer-1" }, allAlerts).includes("alert-expense-1") &&
      !staleAiAlertIdsForSave({ kind: "purchase_return", supplierId: "supplier-1" }, allAlerts).includes("alert-market-1"),
    "a return never touches expense / market alerts",
  );
  check(
    staleAiAlertIdsForSave({ kind: "sales_return", customerId: null }, allAlerts).length === 0 &&
      staleAiAlertIdsForSave({ kind: "purchase_return", supplierId: undefined }, allAlerts).length === 0,
    "return with no party id invalidates nothing",
  );
  check(
    JSON.stringify(
      staleAiAlertIdsForSave({ kind: "sales_return", customerId: "customer-1" }, [overdueC1, overdueC1]),
    ) === JSON.stringify(["alert-overdue-1"]),
    "duplicate alert rows resolve to one id for a sales return too",
  );

  console.log("(j) extension: expense saves invalidate only that day's expense alert");
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-18" }, alertsWithExpenseDays)) ===
      JSON.stringify(["alert-expense-1"]),
    "expense save resolves only the active expense alert for that day",
  );
  check(
    JSON.stringify(staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-19" }, alertsWithExpenseDays)) ===
      JSON.stringify(["alert-expense-2"]),
    "expense save for another day resolves only that day's alert",
  );
  check(
    staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-20" }, alertsWithExpenseDays).length === 0,
    "expense save for a day with no alert invalidates nothing",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-18" }, alertsWithExpenseDays).includes("alert-expense-3"),
    "already-resolved expense alerts are never re-resolved",
  );
  check(
    staleAiAlertIdsForSave({ kind: "expense", expenseDay: null }, alertsWithExpenseDays).length === 0 &&
      staleAiAlertIdsForSave({ kind: "expense", expenseDay: "   " }, alertsWithExpenseDays).length === 0,
    "expense save with no day invalidates nothing",
  );
  check(
    !staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-18" }, alertsWithExpenseDays).includes("alert-overdue-1") &&
      !staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-18" }, alertsWithExpenseDays).includes("alert-payable-1") &&
      !staleAiAlertIdsForSave({ kind: "expense", expenseDay: "2026-11-18" }, alertsWithExpenseDays).includes("alert-market-1"),
    "an expense save never touches customer / supplier / market alerts",
  );
  check(
    staleAiAlertIdsForSave(
      { kind: "expense", expenseDay: "2026-11-18" },
      [alert("alert-expense-raw", "active", "expenses", "2026-11-18")],
    ).length === 0,
    "a stored row keyed by the raw date string is never matched — the generator keys by the derived UUID, and a date-string row could never have been stored (UUID column)",
  );

  console.log("(k) extension: cross-tab signal is emitted on save and heard by a second tab");
  check(
    aiAlertsInvalidatedMessage("org-1", "2026-11-20T07:00:00.000Z").type === "ai-alerts-invalidated" &&
      aiAlertsInvalidatedMessage("org-1", "2026-11-20T07:00:00.000Z").organizationId === "org-1" &&
      aiAlertsInvalidatedMessage("org-1", "2026-11-20T07:00:00.000Z").at === "2026-11-20T07:00:00.000Z",
    "invalidation message carries type + org + timestamp",
  );
  check(
    isAiAlertsInvalidatedMessage(aiAlertsInvalidatedMessage("org-1")) === true,
    "a built message validates",
  );
  check(
    isAiAlertsInvalidatedMessage({ type: "ai-alerts-invalidated", organizationId: "", at: "2026-11-20T07:00:00.000Z" }) === false &&
      isAiAlertsInvalidatedMessage({ type: "ai-alerts-invalidated", at: "2026-11-20T07:00:00.000Z" }) === false &&
      isAiAlertsInvalidatedMessage({ type: "other", organizationId: "org-1", at: "2026-11-20T07:00:00.000Z" }) === false &&
      isAiAlertsInvalidatedMessage({ type: "ai-alerts-invalidated", organizationId: "org-1" }) === false &&
      isAiAlertsInvalidatedMessage(null) === false &&
      isAiAlertsInvalidatedMessage("ai-alerts-invalidated") === false &&
      isAiAlertsInvalidatedMessage([]) === false,
    "malformed messages are rejected (empty/missing org, wrong type, missing timestamp, non-object)",
  );

  // Two-tab simulation with in-memory fakes (no real browser): the
  // module's singleton channel is tab A; a second FakeBroadcastChannel
  // instance is tab B. The fakes are installed before the module's
  // lazy channel is first created, so the module uses them.
  class FakeBroadcastChannel {
    static instances: FakeBroadcastChannel[] = [];
    private listeners = new Set<(event: { data: unknown }) => void>();
    constructor(public readonly name: string) {
      FakeBroadcastChannel.instances.push(this);
    }
    postMessage(message: unknown): void {
      // BroadcastChannel never delivers to the object that posted.
      for (const instance of FakeBroadcastChannel.instances) {
        if (instance === this) continue;
        for (const listener of [...instance.listeners]) listener({ data: message });
      }
    }
    addEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
      this.listeners.add(listener);
    }
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
      this.listeners.delete(listener);
    }
    close(): void {}
  }
  const storageData = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string): string | null => storageData.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storageData.set(key, value);
    },
  };
  const storageListeners = new Set<(event: { key: string | null; newValue: string | null }) => void>();
  const fakeWindow = {
    addEventListener: (
      _type: string,
      listener: (event: { key: string | null; newValue: string | null }) => void,
    ): void => {
      storageListeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: { key: string | null; newValue: string | null }) => void,
    ): void => {
      storageListeners.delete(listener);
    },
  };
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel = FakeBroadcastChannel;
  (globalThis as unknown as Record<string, unknown>).window = fakeWindow;
  (globalThis as unknown as Record<string, unknown>).localStorage = fakeStorage;

  let invalidationsHeard = 0;
  const unsubscribe = subscribeAiAlertsInvalidated("org-1", () => {
    invalidationsHeard++;
  });
  const tabB = new FakeBroadcastChannel(AI_ALERTS_CROSS_TAB_CHANNEL);
  tabB.postMessage(aiAlertsInvalidatedMessage("org-1"));
  check(invalidationsHeard === 1, "tab B's broadcast reaches tab A's listener for the same org");
  tabB.postMessage(aiAlertsInvalidatedMessage("org-2"));
  check(invalidationsHeard === 1, "a broadcast for another org is ignored");
  tabB.postMessage({ type: "ai-alerts-invalidated" });
  check(invalidationsHeard === 1, "a malformed broadcast is ignored");
  tabB.postMessage({ type: "something-else", organizationId: "org-1", at: "2026-11-20T07:00:00.000Z" });
  check(invalidationsHeard === 1, "a different message type is ignored");

  const tabBReceived: unknown[] = [];
  tabB.addEventListener("message", (event) => {
    tabBReceived.push(event.data);
  });
  broadcastAiAlertsInvalidated("org-1");
  check(
    tabBReceived.length === 1 &&
      isAiAlertsInvalidatedMessage(tabBReceived[0]) &&
      (tabBReceived[0] as { organizationId: string }).organizationId === "org-1",
    "broadcast reaches the other tab with a valid invalidation for the org",
  );
  check(invalidationsHeard === 1, "the broadcasting tab does NOT hear its own broadcast (no self-echo)");
  const stored = storageData.get(AI_ALERTS_CROSS_TAB_STORAGE_KEY);
  check(
    typeof stored === "string" &&
      isAiAlertsInvalidatedMessage(JSON.parse(stored) as unknown) &&
      (JSON.parse(stored) as { organizationId: string }).organizationId === "org-1",
    "broadcast also writes the storage fallback with a valid invalidation",
  );
  broadcastAiAlertsInvalidated("   ");
  check(tabBReceived.length === 1, "broadcast with a blank org sends nothing");
  check(subscribeAiAlertsInvalidated("   ", () => {})() === undefined, "subscribing with a blank org is a safe no-op");

  const fireStorageEvent = (key: string | null, newValue: string | null): void => {
    for (const listener of [...storageListeners]) listener({ key, newValue });
  };
  fireStorageEvent(AI_ALERTS_CROSS_TAB_STORAGE_KEY, JSON.stringify(aiAlertsInvalidatedMessage("org-1")));
  check(invalidationsHeard === 2, "storage event for the same org triggers a refresh (fallback transport)");
  fireStorageEvent(AI_ALERTS_CROSS_TAB_STORAGE_KEY, JSON.stringify(aiAlertsInvalidatedMessage("org-2")));
  check(invalidationsHeard === 2, "storage event for another org is ignored");
  fireStorageEvent("some-other-key", JSON.stringify(aiAlertsInvalidatedMessage("org-1")));
  check(invalidationsHeard === 2, "storage event for another key is ignored");
  fireStorageEvent(AI_ALERTS_CROSS_TAB_STORAGE_KEY, "{not json");
  check(invalidationsHeard === 2, "malformed storage payload is ignored, never throws");
  fireStorageEvent(AI_ALERTS_CROSS_TAB_STORAGE_KEY, null);
  check(invalidationsHeard === 2, "storage event with no value is ignored");

  unsubscribe();
  tabB.postMessage(aiAlertsInvalidatedMessage("org-1"));
  fireStorageEvent(AI_ALERTS_CROSS_TAB_STORAGE_KEY, JSON.stringify(aiAlertsInvalidatedMessage("org-1")));
  check(invalidationsHeard === 2, "after unsubscribe neither transport reaches the handler");

  console.log("(l) extension: the page hook broadcasts and the page subscribes");
  check(
    hookSource.includes("broadcastAiAlertsInvalidated(currentOrganizationId)"),
    "refreshAiAlertsAfterSave broadcasts after the save refresh",
  );
  check(
    pageSource.includes('import { broadcastAiAlertsInvalidated, subscribeAiAlertsInvalidated } from "@/lib/ai/ai-alert-sync-broadcast";'),
    "page.tsx imports the cross-tab helpers",
  );
  check(
    pageSource.includes("subscribeAiAlertsInvalidated(currentOrganizationId, () => {") &&
      pageSource.includes("void fetchAiAlerts(currentOrganizationId);"),
    "a cross-tab effect subscribes for the current org and re-reads its alerts",
  );
  check(
    pageSource.indexOf("subscribeAiAlertsInvalidated(currentOrganizationId, () => {") >
      pageSource.indexOf("const refreshAiAlertsAfterSave"),
    "the cross-tab effect sits with the save hook (same org, same refresh)",
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main();
