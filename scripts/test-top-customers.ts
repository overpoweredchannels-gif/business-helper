/**
 * Top Customers card (P1 Area B) — Unit Tests.
 *
 * Defects: the card plotted `topCustomersBySales` with only a name and a
 * money value (`formatDashboardMoney(c.totalSales)`) — the `trend` prop
 * was never passed, so no arrow ever showed — and the card vanished
 * entirely when there was no data (DashboardView only included it when
 * the array was non-empty).
 *
 * Fix: each row now carries a trend arrow vs the previous equivalent
 * period (same length, immediately before the current BI range — the
 * same baseline the Top Products card uses), and the card is always on
 * the dashboard, showing its empty state when there is no data.
 *
 * The money value is unchanged by this fix: it is still the customer's
 * total sales for the BI period, formatted with the dashboard's money
 * formatter. The ranking (top 5 by total sales, BI range) is unchanged
 * too — except that customers with zero sales in the period never reach
 * the card, so a period with no buying customers shows the empty state
 * instead of five "€0.00" rows.
 *
 * This test imports the production helpers directly (no mirroring) and
 * asserts the exact trend, money formatting, row construction and
 * empty-state condition. The previous-period arithmetic itself lives in
 * `previousPeriodRange` (already covered by test-top-products.ts); this
 * test locks the shared dependency with one range check, because the
 * customer trend baseline comes from the same function.
 *
 * Run: npx tsx scripts/test-top-customers.ts
 */

import assert from "node:assert/strict";
import {
  buildTopCustomerRows,
  topCustomerTrend,
  topCustomersCardState,
  type TopCustomerRowInput,
} from "../src/lib/dashboard/top-customers";
import { previousPeriodRange } from "../src/lib/dashboard/top-products";
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

function row(
  overrides: Partial<TopCustomerRowInput> & { name: string },
): TopCustomerRowInput {
  return {
    totalSales: 0,
    previousTotalSales: 0,
    ...overrides,
  };
}

function main(): void {
  console.log("\n=== Trend: current vs previous equivalent period ===\n");

  check(topCustomerTrend(1200, 900) === "up", "€1,200 now vs €900 before -> up");
  check(topCustomerTrend(500, 800) === "down", "€500 now vs €800 before -> down");
  check(topCustomerTrend(750, 750) === "flat", "€750 now vs €750 before -> flat");
  check(topCustomerTrend(0, 0) === "flat", "€0 now vs €0 before -> flat");
  check(topCustomerTrend(250, 0) === "up", "€250 now vs no previous sales -> up");
  check(topCustomerTrend(0, 400) === "down", "€0 now vs €400 before -> down");
  check(topCustomerTrend(900, null) === "flat", "no previous period at all (all-time range) -> flat, never a guessed up");

  // Money is displayed to 2dp: a difference smaller than half a cent is
  // invisible rounding noise from floating-point sums, not a trend.
  check(topCustomerTrend(100, 100.004) === "flat", "€100.00 vs €100.004 (sub-cent dust) -> flat");
  check(topCustomerTrend(100.01, 100) === "up", "€100.01 now vs €100.00 before (a visible cent) -> up");
  check(topCustomerTrend(99.99, 100) === "down", "€99.99 now vs €100.00 before (a visible cent) -> down");
  check(topCustomerTrend(0.1 + 0.2, 0.3) === "flat", "0.1 + 0.2 vs 0.3 (float dust) -> flat");

  console.log("\n=== Previous period: same shared range as Top Products ===\n");

  const thirtyDays = previousPeriodRange({ start: "2026-10-19", end: "2026-11-17" });
  check(
    thirtyDays !== null && thirtyDays.start === "2026-09-19" && thirtyDays.end === "2026-10-18",
    "30-day range 2026-10-19..2026-11-17 -> previous 2026-09-19..2026-10-18 (shared with Top Products)",
  );
  check(
    previousPeriodRange({ start: "", end: "" }) === null,
    "all-time range (empty start/end) -> null, no previous period",
  );

  console.log("\n=== Row construction: money value unchanged, trend, ranking ===\n");

  setActiveBooksCurrency("EUR");
  try {
    // The money value is the customer's total sales, formatted exactly
    // as before — the fix adds the trend, it never changes the figure.
    const live = buildTopCustomerRows(
      [
        row({ name: "QA Shop A", totalSales: 1234.56, previousTotalSales: 900 }),
        row({ name: "Walk-in", totalSales: 240, previousTotalSales: 300 }),
        row({ name: "CHAUDHRY HAMZA ABID", totalSales: 67.5, previousTotalSales: 67.5 }),
      ],
      formatBooksMoney,
    );
    check(live.length === 3, "3 buying customers in -> 3 rows out");
    check(live[0].name === "QA Shop A", "rows ranked by total sales, QA Shop A first");
    check(live[0].value === "€1,234.56", 'QA Shop A value is "€1,234.56" — the money figure, unchanged by the fix');
    check(live[0].trend === "up", "QA Shop A €1,234.56 vs €900 before -> up");
    check(live[1].value === "€240.00" && live[1].trend === "down", "second row €240.00, down vs €300 before");
    check(live[2].value === "€67.50" && live[2].trend === "flat", "third row €67.50, flat vs €67.50 before");

    // Small totals keep their exact cents — the formatter is the same
    // one the dashboard already used for this card.
    const small = buildTopCustomerRows(
      [row({ name: "Tiny Buyer", totalSales: 0.81, previousTotalSales: 0 })],
      formatBooksMoney,
    );
    check(small[0].value === "€0.81", '€0.81 total formats as "€0.81"');
    check(small[0].trend === "up", "€0.81 now vs no previous sales -> up");

    // Zero-sales customers never reach the card: an all-zero input
    // yields no rows, so the card shows its empty state.
    const allZero = buildTopCustomerRows(
      [
        row({ name: "Dormant A", totalSales: 0, previousTotalSales: 500 }),
        row({ name: "Dormant B", totalSales: 0, previousTotalSales: 0 }),
      ],
      formatBooksMoney,
    );
    check(allZero.length === 0, "all-zero totals -> no rows (empty state, not five \"€0.00\" rows)");

    // Mixed input: zero rows are dropped before the top-5 cut, so a
    // buying customer ranked 6th still makes the card.
    const mixed = buildTopCustomerRows(
      [
        row({ name: "C1", totalSales: 100, previousTotalSales: 0 }),
        row({ name: "C2", totalSales: 90, previousTotalSales: 0 }),
        row({ name: "C3", totalSales: 80, previousTotalSales: 0 }),
        row({ name: "C4", totalSales: 70, previousTotalSales: 0 }),
        row({ name: "C5", totalSales: 60, previousTotalSales: 0 }),
        row({ name: "C6", totalSales: 50, previousTotalSales: 0 }),
        row({ name: "Zero", totalSales: 0, previousTotalSales: 0 }),
      ],
      formatBooksMoney,
    );
    check(mixed.length === 5, "7 in (one zero) -> top 5 out");
    check(
      mixed[4].name === "C5" && mixed.every((r) => r.value !== "€0.00"),
      "top 5 are the five largest buyers; the zero row never appears",
    );

    // All-time range: no previous period -> every trend is flat.
    const allTime = buildTopCustomerRows(
      [row({ name: "QA Shop A", totalSales: 1234.56, previousTotalSales: null })],
      formatBooksMoney,
    );
    check(allTime[0].trend === "flat", "all-time range (null previous) -> flat, never a guessed up");
    check(allTime[0].value === "€1,234.56", "all-time range -> money value still exact");

    // The builder re-sorts defensively: an unsorted input still ranks
    // by total sales, so the card never depends on caller order.
    const unsorted = buildTopCustomerRows(
      [
        row({ name: "Small", totalSales: 10, previousTotalSales: 0 }),
        row({ name: "Big", totalSales: 999, previousTotalSales: 0 }),
      ],
      formatBooksMoney,
    );
    check(unsorted[0].name === "Big", "unsorted input -> still ranked Big first");
  } finally {
    setActiveBooksCurrency("PKR");
  }

  console.log("\n=== Empty state: empty array -> message, not a vanished card ===\n");

  check(topCustomersCardState([]) === "empty", 'empty array -> card state is "empty"');
  check(
    topCustomersCardState([{ name: "QA Shop A", value: "€1,234.56", trend: "up" }]) === "list",
    'one row -> card state is "list"',
  );
  for (const language of ["en", "es", "it", "ur"] as const) {
    const noData = messages[language]["dashboard.topCustomersNoData"];
    check(
      typeof noData === "string" && noData.trim().length > 0,
      `empty-state text exists and is non-empty in ${language} ("${noData}")`,
    );
  }

  console.log(`\nAll ${passed} Top Customers checks passed.\n`);
}

main();
