/**
 * Business Health metric-row statuses (P1 Area B) — Unit Tests.
 *
 * Defects: the Profit Margin row's status was hardcoded "good", so a
 * negative margin showed a green dot; the Cash Flow row used
 * `receivables > payables ? "good" : "warning"`, so when receivables
 * and payables were both 0 (0 > 0 is false) it showed "warning" even
 * though nothing was outstanding — empty data looked unhealthy.
 *
 * Fix: both rows now derive their status from their values in the one
 * shared helper (src/lib/dashboard/health.ts) — margin < 0 is
 * "critical", margin == 0 is "warning", margin > 0 is "good";
 * receivables >= payables is "good" (which covers the 0/0 case),
 * receivables < payables is "warning". The displayed values are
 * unchanged; only the status (dot colour) derivation moved.
 *
 * This test imports the production helpers directly (no mirroring) and
 * asserts the exact status at every boundary.
 *
 * Run: npx tsx scripts/test-health-metric-rows.ts
 */

import assert from "node:assert/strict";
import {
  businessHealthCashFlowStatus,
  businessHealthProfitMarginStatus,
  type BusinessHealthMetricStatus,
} from "../src/lib/dashboard/health";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function checkMargin(marginPercent: number, expected: BusinessHealthMetricStatus): void {
  check(
    businessHealthProfitMarginStatus(marginPercent) === expected,
    `margin ${marginPercent}%: status is "${expected}"`,
  );
}

function checkCashFlow(receivables: number, payables: number, expected: BusinessHealthMetricStatus): void {
  check(
    businessHealthCashFlowStatus(receivables, payables) === expected,
    `cash flow (receivables ${receivables}, payables ${payables}): status is "${expected}"`,
  );
}

function main(): void {
  console.log("\n=== Profit Margin boundaries: exact status ===\n");

  // Clearly negative — a loss must never show a green dot.
  checkMargin(-12.5, "critical");
  // Just below zero.
  checkMargin(-0.1, "critical");
  // Exactly zero — no profit, but no loss either.
  checkMargin(0, "warning");
  // Just above zero.
  checkMargin(0.1, "good");
  // Clearly positive.
  checkMargin(44.7, "good");

  console.log("\n=== Cash Flow boundaries: exact status ===\n");

  // Both zero — nothing outstanding is healthy, not a warning.
  checkCashFlow(0, 0, "good");
  // Owed more than receivable.
  checkCashFlow(0, 100, "warning");
  // Receivable with nothing payable.
  checkCashFlow(100, 0, "good");
  // Equal and non-zero — balanced, not a warning.
  checkCashFlow(100, 100, "good");
  // Receivable below payables.
  checkCashFlow(50, 100, "warning");
  // Receivable above payables.
  checkCashFlow(100, 50, "good");

  console.log("\n=== Negative margin never shows green ===\n");

  let negativeChecked = 0;
  for (let margin = -100; margin < 0; margin += 0.5) {
    assert.ok(
      businessHealthProfitMarginStatus(margin) === "critical",
      `margin ${margin}%: negative margin must be "critical", got "${businessHealthProfitMarginStatus(margin)}"`,
    );
    negativeChecked++;
  }
  passed++;
  console.log(`  ✓ all ${negativeChecked} negative margins (-100 to -0.5): status is "critical", never "good"`);

  console.log("\n=== Live values: both rows unchanged today ===\n");

  // At the current live values the fix changes nothing visible: margin
  // 44.7% is positive (was "good", stays "good") and receivables
  // €187.72 < payables €9,475.86 (was "warning", stays "warning").
  checkMargin(44.7, "good");
  checkCashFlow(187.72, 9475.86, "warning");

  console.log(`\n${passed} passed, 0 failed`);
}

main();
