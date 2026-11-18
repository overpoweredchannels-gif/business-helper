/**
 * Top Products card (P1 Area B) — Unit Tests.
 *
 * Defects: the card plotted `topSellingProducts`, an ALL-TIME ranking
 * whose value was the raw summed quantity as a bare string
 * (`String(p.quantitySold)` — e.g. "373", no unit, no money), and whose
 * quantities mixed main units and subunits (sales items carry
 * `unit_mode: "main" | "subunit"` and the sum never normalised them).
 * The `trend` prop was never passed, so no arrow ever showed, and the
 * card vanished entirely when there was no data (DashboardView only
 * included it when the array was non-empty).
 *
 * Fix: the card plots the current BI period (the same range the
 * Revenue/Profit trend cards and the Top Customers card use), ranked by
 * quantity sold in MAIN units. Each row shows the quantity WITH its
 * unit (the product's `unit_type`) and the product's revenue net of
 * line discounts, and a trend arrow vs the previous equivalent period
 * (same length, immediately before the current range). The card is
 * always on the dashboard, showing its empty state when there is no
 * data.
 *
 * This test imports the production helpers directly (no mirroring) and
 * asserts the exact per-line revenue, quantity formatting, trend,
 * previous-period arithmetic, row construction and empty-state
 * condition. The main-unit normalisation itself lives in
 * `quantityToMainUnits` (already used by the BI product analytics);
 * this test asserts the builder receives and displays main-unit
 * quantities with the main unit.
 *
 * Run: npx tsx scripts/test-top-products.ts
 */

import assert from "node:assert/strict";
import {
  buildTopProductRows,
  formatTopProductQuantity,
  previousPeriodRange,
  topProductLineNetRevenue,
  topProductTrend,
  topProductsCardState,
  type TopProductRowInput,
} from "../src/lib/dashboard/top-products";
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

function row(
  overrides: Partial<TopProductRowInput> & { name: string },
): TopProductRowInput {
  return {
    unitType: "CARTON",
    quantitySold: 0,
    netRevenue: 0,
    previousQuantitySold: 0,
    ...overrides,
  };
}

function main(): void {
  console.log("\n=== Per-line net revenue: discounts subtracted, like the KPI ===\n");

  // Discounted line: 2 x €10.00, €3.00 discount -> net €17.00. The
  // old card showed no money at all; the revenue it now shows must be
  // net, or a discounted line would overstate what the product earned.
  check(
    approx(topProductLineNetRevenue({ quantity: 2, sellingPrice: 10, discount: 3 }), 17),
    "discounted line: net revenue €17.00 (€20.00 - €3.00)",
  );
  check(
    approx(topProductLineNetRevenue({ quantity: 1, sellingPrice: 6.15, discount: 0 }), 6.15),
    "undiscounted line: net revenue €6.15",
  );
  check(
    approx(topProductLineNetRevenue({ quantity: 3, sellingPrice: 5, discount: 15 }), 0),
    "fully-discounted line: net revenue €0.00 (€15.00 - €15.00)",
  );

  console.log("\n=== Quantity formatting: integers plain, fractions to 2dp ===\n");

  check(formatTopProductQuantity(373) === "373", 'integer 373 formats as "373"');
  check(formatTopProductQuantity(0) === "0", 'zero formats as "0"');
  check(formatTopProductQuantity(0.5) === "0.5", 'half a main unit formats as "0.5"');
  check(formatTopProductQuantity(73.333332) === "73.33", "73.333332 rounds to \"73.33\"");
  check(formatTopProductQuantity(1 / 24) === "0.04", "1 subunit of a 24-pack (1/24) rounds to \"0.04\"");

  console.log("\n=== Trend: current vs previous equivalent period ===\n");

  check(topProductTrend(10, 5) === "up", "10 now vs 5 before -> up");
  check(topProductTrend(3, 8) === "down", "3 now vs 8 before -> down");
  check(topProductTrend(7, 7) === "flat", "7 now vs 7 before -> flat");
  check(topProductTrend(0, 0) === "flat", "0 now vs 0 before -> flat");
  check(topProductTrend(4, 0) === "up", "4 now vs no previous sales -> up");
  check(topProductTrend(0, 6) === "down", "0 now vs 6 before -> down");
  check(topProductTrend(9, null) === "flat", "no previous period at all (all-time range) -> flat, never a guessed up");

  console.log("\n=== Previous period: same length, immediately before ===\n");

  const thirtyDays = previousPeriodRange({ start: "2026-10-19", end: "2026-11-17" });
  check(
    thirtyDays !== null && thirtyDays.start === "2026-09-19" && thirtyDays.end === "2026-10-18",
    "30-day range 2026-10-19..2026-11-17 -> previous 2026-09-19..2026-10-18",
  );
  const oneDay = previousPeriodRange({ start: "2026-11-17", end: "2026-11-17" });
  check(
    oneDay !== null && oneDay.start === "2026-11-16" && oneDay.end === "2026-11-16",
    "1-day range (today) -> previous day",
  );
  const monthBoundary = previousPeriodRange({ start: "2026-11-01", end: "2026-11-30" });
  check(
    monthBoundary !== null && monthBoundary.start === "2026-10-02" && monthBoundary.end === "2026-10-31",
    "30-day November range -> previous crosses the month boundary to October",
  );
  check(
    previousPeriodRange({ start: "", end: "" }) === null,
    "all-time range (empty start/end) -> null, no previous period",
  );
  check(
    previousPeriodRange({ start: "2026-11-17", end: "2026-11-01" }) === null,
    "end before start -> null",
  );
  check(
    previousPeriodRange({ start: "not-a-date", end: "2026-11-17" }) === null,
    "malformed start -> null",
  );

  console.log("\n=== Row construction: quantity + unit, revenue, trend, ranking ===\n");

  setActiveBooksCurrency("EUR");
  try {
    // The live case: pepsi 500ml, 373 main units, revenue net of
    // discounts, up vs the previous period.
    const live = buildTopProductRows(
      [
        row({ name: "pepsi 500ml", quantitySold: 373, netRevenue: 1234.56, previousQuantitySold: 300 }),
        row({ name: "DAIRY MILK 20", quantitySold: 120, netRevenue: 240, previousQuantitySold: 150 }),
        row({ name: "Fanta 500 ml", quantitySold: 45, netRevenue: 67.5, previousQuantitySold: 45 }),
      ],
      formatBooksMoney,
    );
    check(live.length === 3, "3 selling products in -> 3 rows out");
    check(live[0].name === "pepsi 500ml", "rows ranked by quantity sold, pepsi first");
    check(live[0].value === "373 CARTON", 'pepsi value is "373 CARTON" — quantity WITH its unit, not a bare number');
    check(live[0].detail === "€1,234.56", 'pepsi detail is the net revenue "€1,234.56"');
    check(live[0].trend === "up", "pepsi 373 vs 300 before -> up");
    check(live[1].value === "120 CARTON" && live[1].trend === "down", "second row 120 CARTON, down vs 150 before");
    check(live[2].value === "45 CARTON" && live[2].trend === "flat", "third row 45 CARTON, flat vs 45 before");

    // No unit on the product -> bare number, still with revenue + trend.
    const noUnit = buildTopProductRows(
      [row({ name: "Loose Item", unitType: null, quantitySold: 12, netRevenue: 9.99, previousQuantitySold: 0 })],
      formatBooksMoney,
    );
    check(noUnit[0].value === "12", "null unit -> bare number, no dangling space");
    check(noUnit[0].detail === "€9.99", "null unit -> revenue detail still present");
    check(noUnit[0].trend === "up", "null unit -> trend still computed (12 vs 0 before)");

    // Fractional main-unit quantity (subunit sales normalised upstream).
    const fractional = buildTopProductRows(
      [row({ name: "Milo", quantitySold: 0.5, netRevenue: 0.22, previousQuantitySold: 1 })],
      formatBooksMoney,
    );
    check(fractional[0].value === "0.5 CARTON", 'half a main unit shows as "0.5 CARTON"');
    check(fractional[0].trend === "down", "0.5 now vs 1 before -> down");

    // Zero-quantity products never reach the card: an all-zero input
    // yields no rows, so the card shows its empty state.
    const allZero = buildTopProductRows(
      [
        row({ name: "Dead Stock A", quantitySold: 0, netRevenue: 0, previousQuantitySold: 5 }),
        row({ name: "Dead Stock B", quantitySold: 0, netRevenue: 0, previousQuantitySold: 0 }),
      ],
      formatBooksMoney,
    );
    check(allZero.length === 0, "all-zero quantities -> no rows (empty state, not five \"0\" rows)");

    // Mixed input: zero rows are dropped before the top-5 cut, so a
    // selling product ranked 6th still makes the card.
    const mixed = buildTopProductRows(
      [
        row({ name: "P1", quantitySold: 100, netRevenue: 100, previousQuantitySold: 0 }),
        row({ name: "P2", quantitySold: 90, netRevenue: 90, previousQuantitySold: 0 }),
        row({ name: "P3", quantitySold: 80, netRevenue: 80, previousQuantitySold: 0 }),
        row({ name: "P4", quantitySold: 70, netRevenue: 70, previousQuantitySold: 0 }),
        row({ name: "P5", quantitySold: 60, netRevenue: 60, previousQuantitySold: 0 }),
        row({ name: "P6", quantitySold: 50, netRevenue: 50, previousQuantitySold: 0 }),
        row({ name: "Zero", quantitySold: 0, netRevenue: 0, previousQuantitySold: 0 }),
      ],
      formatBooksMoney,
    );
    check(mixed.length === 5, "7 in (one zero) -> top 5 out");
    check(
      mixed[4].name === "P5" && mixed.every((r) => r.value !== "0 CARTON"),
      "top 5 are the five largest sellers; the zero row never appears",
    );

    // All-time range: no previous period -> every trend is flat.
    const allTime = buildTopProductRows(
      [row({ name: "pepsi 500ml", quantitySold: 373, netRevenue: 1234.56, previousQuantitySold: null })],
      formatBooksMoney,
    );
    check(allTime[0].trend === "flat", "all-time range (null previous) -> flat, never a guessed up");
  } finally {
    setActiveBooksCurrency("PKR");
  }

  console.log("\n=== Empty state: empty array -> message, not a vanished card ===\n");

  check(topProductsCardState([]) === "empty", 'empty array -> card state is "empty"');
  check(
    topProductsCardState([{ name: "pepsi 500ml", value: "373 CARTON", detail: "€1,234.56", trend: "up" }]) === "list",
    'one row -> card state is "list"',
  );
  for (const language of ["en", "es", "it", "ur"] as const) {
    const noData = messages[language]["dashboard.topProductsNoData"];
    check(
      typeof noData === "string" && noData.trim().length > 0,
      `empty-state text exists and is non-empty in ${language} ("${noData}")`,
    );
  }

  console.log(`\nAll ${passed} Top Products checks passed.\n`);
}

main();
