/**
 * Revenue Trend chart (P1 Area B) — Unit Tests.
 *
 * Defects: the card plotted `monthlySales.slice(-6)` — monthly totals
 * labelled with raw `YYYY-MM`, so on the default 30-day BI range it
 * typically showed 1-2 bars with unreadable labels. The shared BarChart
 * showed no values and no axis (values lived only in the SVG `<title>`,
 * screen-reader only), and the card vanished entirely when there was no
 * data (DashboardView only included it when the array was non-empty).
 *
 * Fix: the card now plots DAILY revenue — the last 14 days of
 * `dailyTrends` (whose entries already carry `sales`, the day's
 * revenue), parallel to the Profit Trend card; labels use the Profit
 * Trend's `MM-DD` style; the BarChart shows a formatted value above
 * each bar plus a max / half / 0 y-axis; and the Revenue card is always
 * on the dashboard, showing its empty state when there is no data.
 *
 * This test imports the production helpers directly (no mirroring) and
 * asserts the exact series, labels, axis ticks and empty-state
 * condition. The Profit Trend's data source and labels are untouched
 * by this slice, so there is nothing to assert for them here beyond
 * the shared helpers they do not use.
 *
 * Run: npx tsx scripts/test-revenue-trend.ts
 */

import assert from "node:assert/strict";
import {
  buildRevenueTrendData,
  revenueTrendCardState,
  trendAxisTicks,
  trendDayLabel,
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

function day(date: string, sales: number): { date: string; sales: number } {
  return { date, sales };
}

function main(): void {
  console.log("\n=== Day labels: readable, never YYYY-MM ===\n");

  check(trendDayLabel("2026-11-17") === "11-17", '"2026-11-17" labels as "11-17"');
  check(trendDayLabel("2026-01-05") === "01-05", '"2026-01-05" labels as "01-05"');
  check(!/^\d{4}-\d{2}$/.test(trendDayLabel("2026-11-17")), 'label is not a raw "YYYY-MM" month');

  console.log("\n=== Daily revenue series: last 14 days, sales values ===\n");

  // 20 days in -> only the last 14 come out, in date order.
  const twentyDays = Array.from({ length: 20 }, (_, i) =>
    day(`2026-10-${String(i + 1).padStart(2, "0")}`, (i + 1) * 10),
  );
  const series = buildRevenueTrendData(twentyDays);
  check(series.length === 14, "20 days in -> 14 points out");
  check(series[0].label === "10-07" && series[0].value === 70, "first point is day 7 (10-07, €70)");
  check(series[13].label === "10-20" && series[13].value === 200, "last point is day 20 (10-20, €200)");
  check(
    series.every((p) => !/^\d{4}-\d{2}$/.test(p.label)),
    "no point carries a raw YYYY-MM label",
  );

  // Fewer than 14 days -> all of them, unchanged order and values.
  const threeDays = [day("2026-11-15", 8.5), day("2026-11-16", 0), day("2026-11-17", 6.15)];
  const short = buildRevenueTrendData(threeDays);
  check(short.length === 3, "3 days in -> 3 points out");
  check(
    short[0].label === "11-15" && short[0].value === 8.5 &&
      short[1].label === "11-16" && short[1].value === 0 &&
      short[2].label === "11-17" && short[2].value === 6.15,
    "short series keeps every day's label and sales value (incl. a zero day)",
  );

  // Empty in -> empty out (the card then shows its empty state).
  check(buildRevenueTrendData([]).length === 0, "no days in -> no points out");

  console.log("\n=== Y-axis ticks: max / half / 0 from the data itself ===\n");

  check(
    JSON.stringify(trendAxisTicks([{ label: "11-15", value: 8.5 }, { label: "11-16", value: 0 }, { label: "11-17", value: 3.25 }])) ===
      JSON.stringify({ max: 8.5, mid: 4.25 }),
    "values [8.50, 0, 3.25] -> ticks { max: 8.50, mid: 4.25 }",
  );
  check(
    JSON.stringify(trendAxisTicks([])) === JSON.stringify({ max: 0, mid: 0 }),
    "no data -> ticks { max: 0, mid: 0 }",
  );
  check(
    JSON.stringify(trendAxisTicks([{ label: "11-15", value: 0 }, { label: "11-16", value: 0 }])) ===
      JSON.stringify({ max: 0, mid: 0 }),
    "all-zero data -> ticks { max: 0, mid: 0 }",
  );
  check(
    JSON.stringify(trendAxisTicks([{ label: "11-15", value: -5 }, { label: "11-16", value: -2 }])) ===
      JSON.stringify({ max: -2, mid: -1 }),
    "negative-only data (profit-style) -> top tick is the true max (-2), not a floored 1",
  );

  console.log("\n=== Bar values: formatted money, same formatter as the dashboard ===\n");

  // The BarChart's default formatter is formatBooksMoney; the dashboard
  // passes its formatDashboardMoney, which resolves to the same books
  // formatter once display equals books. Assert the exact strings.
  setActiveBooksCurrency("EUR");
  try {
    check(formatBooksMoney(8.5) === "€8.50", 'value 8.50 formats as "€8.50"');
    check(formatBooksMoney(0) === "€0.00", 'value 0 formats as "€0.00"');
    check(formatBooksMoney(1234.56) === "€1,234.56", 'value 1234.56 formats as "€1,234.56"');
    check(formatBooksMoney(-5) === "-€5.00", 'negative value -5 formats as "-€5.00"');
  } finally {
    setActiveBooksCurrency("PKR");
  }

  console.log("\n=== Empty state: empty array -> message, not a vanished card ===\n");

  check(revenueTrendCardState([]) === "empty", "empty array -> card state is \"empty\"");
  check(
    revenueTrendCardState([{ label: "11-17", value: 6.15 }]) === "chart",
    "one point -> card state is \"chart\"",
  );
  for (const language of ["en", "es", "it", "ur"] as const) {
    const text = messages[language]["dashboard.revenueTrendNoData"];
    check(
      typeof text === "string" && text.trim().length > 0,
      `empty-state text exists and is non-empty in ${language} ("${text}")`,
    );
  }

  console.log(`\nAll ${passed} Revenue Trend checks passed.\n`);
}

main();
