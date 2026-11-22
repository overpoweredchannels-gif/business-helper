/**
 * AI Insight card fallback (P1 Area B) — Unit Tests.
 *
 * Defect: the dashboard builder gated the low-stock fallback on
 * `businessIntelligenceAnalytics.insights.lowStockWarning`, a string
 * that ALWAYS has a value — out of stock -> "{count} product(s) are out
 * of stock.", low stock -> "{count} product(s) are at or below reorder
 * level.", otherwise -> "No urgent low-stock warning in this filtered
 * view." Because the string is always truthy, the fallback branch fired
 * whenever there was no AI alert, so the card showed the "no urgent low
 * stock" status string under the "AI Recommendation" heading with a
 * hardcoded 90% confidence, even when there was nothing to warn about.
 *
 * Fix: the branch is decided by `dashboardAiInsightKind` from the
 * underlying condition — the out-of-stock / low-stock counts the BI
 * builder itself uses — not from the always-truthy string. With no
 * alert and no stock problem the kind is "none" and the builder returns
 * undefined, so the card is hidden (DashboardView already omits it when
 * `aiInsight` is undefined).
 *
 * The BI `lowStockWarning` string itself is UNCHANGED: the "no urgent"
 * line stays in the BI insight list, where it is an honest status line
 * — it just never reaches this card any more. The helper takes no
 * string input at all (only the alert flag and the two counts), so it
 * cannot alter the warning text; the fallback branch passes
 * `insights.lowStockWarning` through verbatim.
 *
 * The card shows NO confidence % (Area J confidence slice): a
 * rule-based alert has no confidence to show, so both branches render
 * an "Updated X min ago" freshness label instead of the old hardcoded
 * 85 (alert) / 90 (fallback). The "AI Recommendation" heading is
 * unchanged, and the alert branch is still the rule-generated alert
 * title/summary, not LLM insight.
 *
 * This test imports the production helper directly (no mirroring) and
 * asserts the exact branch for every stock/alert combination, plus the
 * BI warning strings it gates on.
 *
 * Run: npx tsx scripts/test-ai-insight-fallback.ts
 */

import assert from "node:assert/strict";
import {
  dashboardAiInsightKind,
  type DashboardAiInsightInput,
} from "../src/lib/dashboard/ai-insight";
import { messages } from "../src/lib/regional/messages";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function input(
  overrides: Partial<DashboardAiInsightInput>,
): DashboardAiInsightInput {
  return {
    hasActiveAlert: false,
    outOfStockCount: 0,
    lowStockCount: 0,
    ...overrides,
  };
}

function main(): void {
  console.log("\n=== (a) No alert + no stock problem -> none (card hidden) ===\n");

  check(
    dashboardAiInsightKind(input({})) === "none",
    "no alert, 0 out of stock, 0 low stock -> none (card hidden, not a 'no urgent' status line)",
  );

  console.log("\n=== (b) No alert + low stock present -> fallback ===\n");

  check(
    dashboardAiInsightKind(input({ lowStockCount: 1 })) === "fallback",
    "no alert, 0 out of stock, 1 low stock -> fallback (at/below-reorder warning)",
  );
  check(
    dashboardAiInsightKind(input({ lowStockCount: 2 })) === "fallback",
    "no alert, 0 out of stock, 2 low stock -> fallback (live dashboard value)",
  );
  check(
    dashboardAiInsightKind(input({ lowStockCount: 47 })) === "fallback",
    "no alert, 47 low stock -> fallback",
  );

  console.log("\n=== (c) No alert + out of stock present -> fallback ===\n");

  check(
    dashboardAiInsightKind(input({ outOfStockCount: 1 })) === "fallback",
    "no alert, 1 out of stock, 0 low stock -> fallback (out-of-stock warning)",
  );
  check(
    dashboardAiInsightKind(input({ outOfStockCount: 18 })) === "fallback",
    "no alert, 18 out of stock, 0 low stock -> fallback (live dashboard value)",
  );
  check(
    dashboardAiInsightKind(input({ outOfStockCount: 18, lowStockCount: 2 })) === "fallback",
    "no alert, 18 out of stock + 2 low stock -> fallback (out-of-stock warning wins the string)",
  );

  console.log("\n=== (d) Alert present -> alert branch wins regardless of stock state ===\n");

  check(
    dashboardAiInsightKind(input({ hasActiveAlert: true })) === "alert",
    "alert present, 0 out of stock, 0 low stock -> alert (not none)",
  );
  check(
    dashboardAiInsightKind(input({ hasActiveAlert: true, lowStockCount: 2 })) === "alert",
    "alert present + low stock -> alert (not fallback)",
  );
  check(
    dashboardAiInsightKind(input({ hasActiveAlert: true, outOfStockCount: 18 })) === "alert",
    "alert present + out of stock -> alert (not fallback)",
  );
  check(
    dashboardAiInsightKind(
      input({ hasActiveAlert: true, outOfStockCount: 18, lowStockCount: 2 }),
    ) === "alert",
    "alert present + both stock problems -> alert (not fallback)",
  );

  console.log("\n=== (e) BI lowStockWarning string unchanged (BI list keeps its lines) ===\n");

  // The three strings the BI builder produces — the fallback gates on
  // the counts behind them, never on the strings themselves.
  for (const language of ["en", "es", "it", "ur"] as const) {
    const outOfStock = messages[language]["page.outOfStockProducts"];
    const atOrBelow = messages[language]["page.atOrBelowReorder"];
    const noUrgent = messages[language]["page.noUrgentLowStockFiltered"];
    check(
      typeof outOfStock === "string" && outOfStock.trim().length > 0,
      `out-of-stock warning exists and is non-empty in ${language} ("${outOfStock}")`,
    );
    check(
      typeof atOrBelow === "string" && atOrBelow.trim().length > 0,
      `at/below-reorder warning exists and is non-empty in ${language} ("${atOrBelow}")`,
    );
    check(
      typeof noUrgent === "string" && noUrgent.trim().length > 0,
      `no-urgent status line exists and is non-empty in ${language} ("${noUrgent}") — the BI list keeps it`,
    );
  }

  // English text, exactly as the BI builder uses it: the two warning
  // strings carry the {count} the builder replaces; the status line
  // carries no count — it is a different kind of string, and the card
  // must never show it.
  check(
    messages.en["page.outOfStockProducts"] === "{count} product(s) are out of stock.",
    'en out-of-stock warning is "{count} product(s) are out of stock."',
  );
  check(
    messages.en["page.atOrBelowReorder"] === "{count} product(s) are at or below reorder level.",
    'en at/below-reorder warning is "{count} product(s) are at or below reorder level."',
  );
  check(
    messages.en["page.noUrgentLowStockFiltered"] ===
      "No urgent low-stock warning in this filtered view.",
    'en no-urgent status line is "No urgent low-stock warning in this filtered view."',
  );
  check(
    !messages.en["page.noUrgentLowStockFiltered"].includes("{count}"),
    'no-urgent status line has no {count} — it is a status line, not a warning',
  );

  // The correspondence that makes the fix sound: the kind is "none"
  // exactly when both counts are 0 — exactly the state in which the BI
  // builder produces the "no urgent" string. So the "no urgent" string
  // can only ever be a BI-list line; it can never reach the card.
  check(
    dashboardAiInsightKind(input({ outOfStockCount: 0, lowStockCount: 0 })) === "none",
    '"none" exactly when both counts are 0 — the state that produces the "no urgent" BI string',
  );
  check(
    dashboardAiInsightKind(input({ outOfStockCount: 1, lowStockCount: 0 })) === "fallback" &&
      dashboardAiInsightKind(input({ outOfStockCount: 0, lowStockCount: 1 })) === "fallback",
    '"fallback" exactly when at least one count is > 0 — the states that produce a real warning string',
  );

  console.log(`\nAll ${passed} AI Insight fallback checks passed.\n`);
}

main();
