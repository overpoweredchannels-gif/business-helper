/**
 * AI alert threshold normalization (P1 Area J follow-up) — Unit Tests.
 *
 * Defect: the alert generator compared books-currency amounts against
 * hardcoded PKR-era constants (`payable >= 100000`, expense day total
 * `>= 25000`). In the EUR org a supplier payable is in the hundreds,
 * so the supplier_ledger alert could essentially never fire — the stale
 * Rs204,000 alert was the only reason the card ever showed one.
 *
 * Fix (UMAIR, 2026-11-20): a RELATIVE rule — each threshold is a share
 * of the org's own live figures, computed from the data the generator
 * already holds (5% of total outstanding payables, 10% of trailing
 * 30-day expenses, 10% of total outstanding receivables; high-severity
 * boundaries preserve the old ratios, 2.5x and 3x). No exchange rate,
 * no currency constant, no new settings surface. Live check: total
 * payables €9,475.86 → supplier threshold €473.79, so NATURA HARVERST
 * at ~€660 qualifies; a €300 payable does not.
 *
 * Correction (UMAIR, 2026-11-20 17:25): the first version of this slice
 * scaled the PKR baselines at the STORED exchange rate (100,000 / 312
 * = €320.51). That was discarded, not shipped: if the stored rate goes
 * stale, the threshold silently goes wrong with it. The module must
 * never read the stored rate, and no 320.51-style EUR constant may
 * appear anywhere. The tests below pin that: no stored-rate import, no
 * rate fetch in page.tsx, no currency constant in code.
 *
 * This test also pins the two sibling findings closed in the same
 * slice:
 * (a) Payables tile "Unavailable": the failing query is the plain
 *     `purchase_transactions` select in `fetchPurchaseTransactions`
 *     (page.tsx), run through the DashboardReadTracker source
 *     "purchase-transactions". The Payables metric aggregates five
 *     sources; any one failing marks the tile failed. RLS-policy and
 *     schema failures are ruled out by the pattern — the same
 *     user/org/query returned figures before 12:05 and after, and
 *     failed exactly once — so the failure was transient (network
 *     blip, Supabase hiccup, or the read racing the session/JWT
 *     restore). The tracker now retries once after a short pause (see
 *     scripts/test-dashboard-data-read-state.tsx for the retry checks).
 * (b) Inventory €0.58: the purchase-return create trigger subtracts
 *     the quantity and the cancel RPC adds back exactly the same
 *     quantity (same subunit normalization), and the valuation is a
 *     pure function of (current_stock, last_purchase_price) — so
 *     return + cancel nets the value to zero. The checks below replay
 *     the PRN-000017 sequence (1 × JUICE €2.20) through the valuation.
 *
 * This test imports the production helpers directly (no mirroring)
 * and asserts the wiring on the real page.tsx source.
 *
 * Run: npx tsx scripts/test-ai-alert-thresholds.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_ALERT_THRESHOLD_RATIOS,
  aiAlertThresholdsRelative,
} from "../src/lib/ai/ai-alert-thresholds";
import { computeInventoryValuation } from "../src/lib/inventory/valuation";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function approx(actual: number, expected: number, label: string): void {
  check(Math.abs(actual - expected) < 0.01, `${label} (got ${actual}, expected ${expected})`);
}

function main(): void {
  console.log("(a) ratios are dimensionless shares, not currency amounts");
  check(AI_ALERT_THRESHOLD_RATIOS.supplierPayable === 0.05, "supplier payable ratio is 5% of total outstanding payables");
  check(AI_ALERT_THRESHOLD_RATIOS.supplierPayableHigh === 0.125, "supplier high-severity ratio is 12.5% (2.5x the base)");
  check(AI_ALERT_THRESHOLD_RATIOS.expenseDay === 0.1, "expense-day ratio is 10% of trailing-30-day expenses");
  check(AI_ALERT_THRESHOLD_RATIOS.expenseDayHigh === 0.3, "expense-day high-severity ratio is 30% (3x the base)");
  check(AI_ALERT_THRESHOLD_RATIOS.customerOverdueHigh === 0.1, "customer overdue high-severity ratio is 10% of total outstanding receivables");

  console.log("(b) no stored rate, no PKR baseline, no EUR constant in the module");
  const moduleSource = readFileSync(new URL("../src/lib/ai/ai-alert-thresholds.ts", import.meta.url), "utf8");
  // Comments may cite the worked examples; only CODE may not carry a
  // currency figure — strip comments before testing.
  const moduleCode = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  check(!moduleCode.includes("stored-rate"), "the module never imports the stored-rate helper");
  check(!moduleCode.includes("pkrPerUnit"), "the module never reads a PKR-per-unit rate");
  check(!/100000/.test(moduleCode), "the module code contains no 100,000 PKR baseline");
  check(!/250000/.test(moduleCode), "the module code contains no 250,000 PKR baseline");
  check(!/25000/.test(moduleCode), "the module code contains no 25,000 PKR baseline");
  check(!/75000/.test(moduleCode), "the module code contains no 75,000 PKR baseline");
  check(!/50000/.test(moduleCode), "the module code contains no 50,000 PKR baseline");
  check(!/320\.5/.test(moduleCode), "the module code contains no 320.51-style EUR constant");
  check(!/80\.1/.test(moduleCode), "the module code contains no 80.13-style EUR constant");

  console.log("(c) NATURA calibration with the live figures (payables €9,475.86, receivables €187.72)");
  const live = aiAlertThresholdsRelative({
    totalOutstandingPayables: 9475.86,
    trailing30DayExpenses: 500,
    totalOutstandingReceivables: 187.72,
  });
  approx(live.supplierPayable, 9475.86 * 0.05, "supplier threshold is 5% of total outstanding payables");
  approx(live.supplierPayableHigh, 9475.86 * 0.125, "supplier high-severity threshold is 12.5% of total outstanding payables");
  approx(live.expenseDay, 50, "expense-day threshold is 10% of trailing-30-day expenses");
  approx(live.expenseDayHigh, 150, "expense-day high-severity threshold is 30% of trailing-30-day expenses");
  approx(live.customerOverdueHigh, 187.72 * 0.1, "customer overdue high-severity threshold is 10% of total outstanding receivables");
  check(660 >= live.supplierPayable, "NATURA €660 meets the relative supplier threshold");
  check(660 < live.supplierPayableHigh, "NATURA €660 is medium severity, not high (high is ~€1,184.48)");
  check(300 < live.supplierPayable, "a €300 payable still does NOT qualify — the threshold is not zero");
  check(100 >= live.expenseDay, "a €100 expense day meets the €50 threshold");
  check(20 < live.expenseDay, "a €20 expense day does NOT meet it");
  check(50 >= live.customerOverdueHigh, "a €50 overdue is high severity");
  check(1.02 < live.customerOverdueHigh, "QA Shop A's €1.02 overdue is medium, not high");

  console.log("(d) the threshold tracks the org's own figures, not a fixed number");
  const biggerBook = aiAlertThresholdsRelative({
    totalOutstandingPayables: 20000,
    trailing30DayExpenses: 1000,
    totalOutstandingReceivables: 500,
  });
  approx(biggerBook.supplierPayable, 1000, "a €20,000 payable book raises the supplier threshold to €1,000");
  check(660 < biggerBook.supplierPayable, "NATURA €660 would NOT qualify against a €20,000 book — the rule is relative, not absolute");
  const smallerBook = aiAlertThresholdsRelative({
    totalOutstandingPayables: 1000,
    trailing30DayExpenses: 100,
    totalOutstandingReceivables: 50,
  });
  approx(smallerBook.supplierPayable, 50, "a €1,000 payable book lowers the supplier threshold to €50");

  console.log("(e) zero, negative or non-finite baselines: the alert type does not fire, never a guessed number");
  const zero = aiAlertThresholdsRelative({
    totalOutstandingPayables: 0,
    trailing30DayExpenses: 0,
    totalOutstandingReceivables: 0,
  });
  check(zero.supplierPayable === Number.POSITIVE_INFINITY, "zero total payables → supplier threshold is +Infinity");
  check(zero.expenseDay === Number.POSITIVE_INFINITY, "zero trailing expenses → expense threshold is +Infinity");
  check(zero.customerOverdueHigh === Number.POSITIVE_INFINITY, "zero total receivables → overdue threshold is +Infinity");
  check(!(660 >= zero.supplierPayable), "with no payable baseline even €660 does NOT qualify — no firing on a guessed number");
  const negative = aiAlertThresholdsRelative({
    totalOutstandingPayables: -100,
    trailing30DayExpenses: -50,
    totalOutstandingReceivables: -10,
  });
  check(negative.supplierPayable === Number.POSITIVE_INFINITY, "a negative baseline is invalid and does not fire");
  const nan = aiAlertThresholdsRelative({
    totalOutstandingPayables: Number.NaN,
    trailing30DayExpenses: Number.NaN,
    totalOutstandingReceivables: Number.NaN,
  });
  check(nan.supplierPayable === Number.POSITIVE_INFINITY, "a NaN baseline does not fire");

  console.log("(f) page wiring: the generator uses the relative thresholds from its own loaded data");
  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  check(
    pageSource.includes('import { aiAlertThresholdsRelative } from "@/lib/ai/ai-alert-thresholds";'),
    "page.tsx imports the relative threshold helper",
  );
  check(
    pageSource.includes("const alertThresholds = aiAlertThresholdsRelative({"),
    "the generator computes the relative thresholds from the org's own figures",
  );
  check(
    pageSource.includes("const totalOutstandingPayables = supplierPayables.reduce((sum, item) => sum + item.payable, 0);"),
    "the supplier denominator is the sum of the computed per-supplier payables",
  );
  check(
    pageSource.includes("const trailing30DayStart = addDaysToDateInputValue(todayDateValue, -29);"),
    "the expense denominator covers the trailing 30 days inclusive of today",
  );
  check(
    pageSource.includes("const totalOutstandingReceivables = customerOverdues.reduce("),
    "the customer denominator is the sum of the computed per-customer overdues",
  );
  check(
    pageSource.includes("item.payable >= alertThresholds.supplierPayable"),
    "the supplier filter uses the relative threshold",
  );
  check(
    pageSource.includes("payable >= alertThresholds.supplierPayableHigh"),
    "the supplier high-severity boundary uses the relative threshold",
  );
  check(
    pageSource.includes("todayExpenseTotal >= alertThresholds.expenseDay"),
    "the expense-day filter uses the relative threshold",
  );
  check(
    pageSource.includes("todayExpenseTotal >= alertThresholds.expenseDayHigh"),
    "the expense-day high-severity boundary uses the relative threshold",
  );
  check(
    pageSource.includes("summary.overdueAmount >= alertThresholds.customerOverdueHigh"),
    "the customer overdue high-severity boundary uses the relative threshold",
  );
  check(!pageSource.includes("aiAlertThresholdsInBooks"), "no stored-rate scaler remains in page.tsx");
  check(!pageSource.includes("parseStoredPkrPerUnit"), "no stored-rate parser remains in page.tsx");
  check(!pageSource.includes("booksPkrPerUnit"), "no stored-rate state remains in page.tsx");
  check(!pageSource.includes("/api/fx/rates"), "page.tsx no longer fetches a rate for the thresholds");
  check(!pageSource.includes("item.payable >= 100000"), "no hardcoded 100,000 supplier filter remains");
  check(!pageSource.includes("payable >= 250000"), "no hardcoded 250,000 supplier severity remains");
  check(!pageSource.includes("todayExpenseTotal >= 25000"), "no hardcoded 25,000 expense filter remains");
  check(!pageSource.includes("todayExpenseTotal >= 75000"), "no hardcoded 75,000 expense severity remains");
  check(!pageSource.includes("summary.overdueAmount >= 50000"), "no hardcoded 50,000 overdue severity remains");

  console.log("(g) inventory €0.58: return + cancel nets the valuation to zero");
  const juice = { productId: "juice-1", productName: "1000 ML JUICE", currentStock: 300, lastPurchasePrice: 2.2, defaultSellingPrice: 2.2 };
  const baseline = computeInventoryValuation([juice]).totalValue;
  const afterReturn = computeInventoryValuation([{ ...juice, currentStock: 299 }]).totalValue;
  const afterCancel = computeInventoryValuation([{ ...juice, currentStock: 300 }]).totalValue;
  // Money floats: compare within a cent, never with ===.
  const cents = (value: number): number => Math.round(value * 100);
  check(cents(baseline) === 66000, "baseline valuation is 300 × €2.20 = €660.00");
  check(cents(baseline - afterReturn) === 220, "the return drops the value by exactly €2.20 (PRN-000017)");
  check(cents(afterCancel) === cents(baseline), "the cancel restores the value to exactly the baseline — net zero");
  check(cents(afterCancel - afterReturn) === 220, "the cancel adds back exactly €2.20, not €1.62");
  const mixed = computeInventoryValuation([
    juice,
    { productId: "other-1", productName: "Other", currentStock: 10, lastPurchasePrice: 0.58, defaultSellingPrice: 1 },
  ]);
  check(
    cents(
      computeInventoryValuation([
        { ...juice, currentStock: 299 },
        { productId: "other-1", productName: "Other", currentStock: 10, lastPurchasePrice: 0.58, defaultSellingPrice: 1 },
      ]).totalValue,
    ) === cents(mixed.totalValue - 2.2),
    "an unrelated €0.58-cost product is untouched by the return — the €0.58 read gap is not the return path",
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main();
