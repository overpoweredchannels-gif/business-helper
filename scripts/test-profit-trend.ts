/**
 * Profit Trend chart (P1 Area B) — Unit Tests.
 *
 * Defects: the card plotted `dailyTrends` profit built from GROSS
 * revenue (line discounts ignored) while the Today's Profit KPI
 * subtracts them, so the chart overstated profit; lines with an
 * unknown cost contributed 0 profit, silently understating it
 * (the KPI's honest pattern excludes them and discloses them);
 * the card vanished entirely when there was no data (DashboardView
 * only included it when the array was non-empty); and the shared
 * BarChart's value labels truncated the longest values to "€13…" /
 * "€14…" (`min-w-0 flex-1 truncate`).
 *
 * Fix: the daily profit is built by profitLineContribution — net of
 * the line discount, costed lines only, unknown-cost lines excluded
 * and counted for disclosure — exactly like the KPI (todayProfitTotals)
 * and the BI line totals (salesLineTotals). The Profit card is always
 * on the dashboard, showing its empty state when there is no data,
 * and the value-label cells never truncate.
 *
 * This test imports the production helpers directly (no mirroring) and
 * asserts the exact per-line split, series, disclosure totals,
 * empty-state condition and label logic. The Revenue Trend's data
 * (gross sales) is untouched by this slice — only that the profit
 * helper still returns gross revenue unchanged for it.
 *
 * Run: npx tsx scripts/test-profit-trend.ts
 */

import assert from "node:assert/strict";
import {
  buildProfitTrendData,
  CHART_VALUE_LABEL_CLASS,
  profitLineContribution,
  profitTrendCardState,
  trendDayLabel,
  trendValueLabelFits,
  trendValueLabelWidthPx,
} from "../src/lib/dashboard/trends";
import {
  formatBooksMoney,
  setActiveBooksCurrency,
} from "../src/lib/tradeos/formatters";
import { messages } from "../src/lib/regional/messages";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function day(
  date: string,
  profit: number,
  unknownCostRevenue = 0,
  unknownCostLines = 0,
): { date: string; profit: number; unknownCostRevenue: number; unknownCostLines: number } {
  return { date, profit, unknownCostRevenue, unknownCostLines };
}

function main(): void {
  console.log("\n=== Per-line split: net of discount, costed vs unknown cost ===\n");

  // Discounted costed line: 2 x €10.00, €3.00 discount, €12.00 cost
  // -> gross €20.00, net €17.00, profit €5.00. The old code used
  // gross revenue (profit €8.00) — the €3.00 overstatement.
  const discounted = profitLineContribution({
    quantity: 2,
    sellingPrice: 10,
    discount: 3,
    cogs: 12,
  });
  check(approx(discounted.grossRevenue, 20), "discounted line: gross revenue €20.00 (Revenue Trend unchanged)");
  check(approx(discounted.netRevenue, 17), "discounted line: net revenue €17.00 (discount subtracted)");
  check(approx(discounted.profitContribution, 5), "discounted line: profit €5.00 = net €17.00 - cost €12.00");
  check(
    approx(discounted.unknownCostRevenue, 0) && discounted.unknownCostLines === 0,
    "discounted costed line: nothing unknown",
  );

  // Undiscounted costed line: 1 x €6.15, no discount, €5.00 cost.
  const plain = profitLineContribution({
    quantity: 1,
    sellingPrice: 6.15,
    discount: 0,
    cogs: 5,
  });
  check(approx(plain.profitContribution, 1.15), "plain line: profit €1.15 = €6.15 - €5.00");

  // Unknown-cost line (the Aylo case): 1 x €6.15, no discount, no cost.
  // The old code counted €0 profit silently; the honest split counts
  // the €6.15 as excluded revenue, not as profit.
  const unknown = profitLineContribution({
    quantity: 1,
    sellingPrice: 6.15,
    discount: 0,
    cogs: null,
  });
  check(approx(unknown.grossRevenue, 6.15), "unknown-cost line: gross revenue still €6.15");
  check(approx(unknown.netRevenue, 6.15), "unknown-cost line: net revenue €6.15");
  check(approx(unknown.profitContribution, 0), "unknown-cost line: profit contribution €0.00");
  check(
    approx(unknown.unknownCostRevenue, 6.15) && unknown.unknownCostLines === 1,
    "unknown-cost line: €6.15 / 1 line counted for disclosure, not lost",
  );

  // Unknown-cost line WITH a discount: the excluded revenue is net.
  const unknownDiscounted = profitLineContribution({
    quantity: 2,
    sellingPrice: 10,
    discount: 4,
    cogs: null,
  });
  check(
    approx(unknownDiscounted.unknownCostRevenue, 16) && unknownDiscounted.unknownCostLines === 1,
    "unknown-cost discounted line: excluded revenue is NET €16.00 (€20.00 - €4.00)",
  );

  console.log("\n=== Daily profit series: last 14 days, disclosure totals ===\n");

  // 20 days in -> only the last 14 come out, in date order; the
  // disclosure totals cover ONLY the plotted window.
  const twentyDays = Array.from({ length: 20 }, (_, i) =>
    day(`2026-10-${String(i + 1).padStart(2, "0")}`, (i + 1) * 0.5, i === 5 ? 6.15 : 0, i === 5 ? 1 : 0),
  );
  const series = buildProfitTrendData(twentyDays);
  check(series.points.length === 14, "20 days in -> 14 points out");
  check(
    series.points[0].label === "10-07" && approx(series.points[0].value, 3.5),
    "first point is day 7 (10-07, €3.50)",
  );
  check(
    series.points[13].label === "10-20" && approx(series.points[13].value, 10),
    "last point is day 20 (10-20, €10.00)",
  );
  check(
    series.points.every((p) => !/^\d{4}-\d{2}$/.test(p.label)),
    "no point carries a raw YYYY-MM label",
  );
  check(
    series.unknownCostLines === 0 && approx(series.unknownCostRevenue, 0),
    "unknown-cost day 6 is OUTSIDE the plotted window -> not disclosed",
  );

  // Unknown-cost lines inside the window are disclosed.
  const withUnknown = [
    day("2026-11-15", 2.22),
    day("2026-11-16", 5.92),
    day("2026-11-17", 0.53, 6.15, 1),
  ];
  const disclosed = buildProfitTrendData(withUnknown);
  check(disclosed.points.length === 3, "3 days in -> 3 points out");
  check(
    disclosed.points[2].label === "11-17" && approx(disclosed.points[2].value, 0.53),
    "11-17 point is the costed-only profit €0.53 (unknown €6.15 excluded)",
  );
  check(
    disclosed.unknownCostLines === 1 && approx(disclosed.unknownCostRevenue, 6.15),
    "disclosure totals: 1 line / €6.15 in the plotted window",
  );

  // Empty in -> empty out, zero totals (the card shows its empty state).
  const empty = buildProfitTrendData([]);
  check(empty.points.length === 0, "no days in -> no points out");
  check(
    empty.unknownCostLines === 0 && approx(empty.unknownCostRevenue, 0),
    "no days in -> zero disclosure totals",
  );

  // Labels reuse the Revenue Trend's readable style.
  check(trendDayLabel("2026-11-17") === "11-17", '"2026-11-17" labels as "11-17"');

  console.log("\n=== Empty state: empty array -> message, not a vanished card ===\n");

  check(profitTrendCardState([]) === "empty", "empty array -> card state is \"empty\"");
  check(
    profitTrendCardState([{ label: "11-17", value: 0.53 }]) === "chart",
    "one point -> card state is \"chart\"",
  );
  for (const language of ["en", "es", "it", "ur"] as const) {
    const noData = messages[language]["dashboard.profitTrendNoData"];
    check(
      typeof noData === "string" && noData.trim().length > 0,
      `empty-state text exists and is non-empty in ${language} ("${noData}")`,
    );
    const excludes = messages[language]["dashboard.profitTrendExcludesUnknownCost"];
    check(
      typeof excludes === "string" &&
        excludes.includes("{amount}") &&
        excludes.includes("{count}"),
      `exclusion note exists with {amount} + {count} placeholders in ${language} ("${excludes}")`,
    );
  }

  console.log("\n=== Value labels: full values, never truncated ===\n");

  check(
    !CHART_VALUE_LABEL_CLASS.includes("truncate"),
    "value-label cell class has no truncation",
  );
  check(
    CHART_VALUE_LABEL_CLASS.includes("whitespace-nowrap"),
    "value-label cell class keeps the value on one line",
  );
  check(
    CHART_VALUE_LABEL_CLASS.includes("flex-1"),
    "value-label cell still takes its even flex-1 slot",
  );

  // The exact formatted strings of the largest live values.
  setActiveBooksCurrency("EUR");
  try {
    check(formatBooksMoney(14.24) === "€14.24", 'largest live value 14.24 formats as "€14.24"');
    check(formatBooksMoney(13.73) === "€13.73", 'second-largest live value 13.73 formats as "€13.73"');
    check(formatBooksMoney(0.53) === "€0.53", 'today\'s profit 0.53 formats as "€0.53"');
  } finally {
    setActiveBooksCurrency("PKR");
  }

  // Width estimate against the BarChart's 48-unit bar slot: the two
  // values that clipped live ("€13…" / "€14…") fit once the cell is
  // no longer truncated.
  check(trendValueLabelWidthPx("€14.24") === 42, '"€14.24" estimates to 42px wide');
  check(trendValueLabelFits("€14.24"), '"€14.24" fits the 48-unit bar slot');
  check(trendValueLabelFits("€13.73"), '"€13.73" fits the 48-unit bar slot');
  check(trendValueLabelFits("€0.53"), '"€0.53" fits the 48-unit bar slot');
  check(
    !trendValueLabelFits("€1,234.56"),
    '"€1,234.56" (10 chars) does not fit a 48-unit slot — documented limit, needs a wider card',
  );

  console.log(`\nAll ${passed} Profit Trend checks passed.\n`);
}

main();
