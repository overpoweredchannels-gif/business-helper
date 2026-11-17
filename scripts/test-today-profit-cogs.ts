/**
 * Today's Profit COGS-0 slice (P1 Area B) — Unit Tests.
 *
 * Defect: page.tsx `todayProfitAmount` reduced today's sales lines as
 * `sum + revenue - (cogs ?? 0)`, where salesLineCogsInMainUnits returns
 * null when a line's cost is unknown (no purchase_price_snapshot > 0 and
 * no product.last_purchase_price > 0). An unknown-cost line therefore
 * contributed its FULL revenue as profit — Today's Profit was silently
 * overstated, with no disclosure.
 *
 * Fix: Today's Profit uses the same honest split BI already uses
 * (salesLineTotals): only lines with a known cost contribute profit
 * (costedRevenue - knownCogs); unknown-cost lines are excluded from the
 * figure and disclosed in the KPI definition line instead. With no
 * unknown-cost lines the figure is identical to the old formula and the
 * definition stays the plain base string.
 *
 * This test mirrors the page.tsx computation (salesLineCogsInMainUnits is
 * defined in page.tsx, so it is re-implemented here from its rules using
 * the same imported helpers) and the DashboardView definition composition.
 *
 * Run: npx tsx scripts/test-today-profit-cogs.ts
 */

import assert from "node:assert/strict";
import { quantityToMainUnits } from "../src/lib/tradeos/units";
import { safeNumber } from "../src/lib/tradeos/validators";
import { messages } from "../src/lib/regional/messages";

// ─── The page.tsx computation, mirrored ─────────────────────────────────────
//
// salesLineCogsInMainUnits (page.tsx:3452): unitCost is the purchase
// snapshot when > 0, else the product's last purchase price when > 0,
// else null (unknown cost). The quantity is normalised to main units.
type SalesItem = {
  quantity: number;
  selling_price: number;
  discount?: number;
  purchase_price_snapshot?: number | null;
  unit_mode?: string;
  product_id: string;
};
type Product = {
  id: string;
  last_purchase_price?: number | null;
  units_per_pack?: number | null;
};

const salesLineCogsInMainUnits = (item: SalesItem, product?: Product): number | null => {
  const quantity = safeNumber(item.quantity);
  const costSnapshot = safeNumber(item.purchase_price_snapshot);
  const fallbackCost = safeNumber(product?.last_purchase_price);
  const unitCost = costSnapshot > 0 ? costSnapshot : fallbackCost > 0 ? fallbackCost : null;
  if (unitCost === null) return null;
  const mainQuantity = quantityToMainUnits(quantity, (item.unit_mode ?? "main") as "main" | "subunit", product?.units_per_pack);
  return mainQuantity * unitCost;
};

// todayProfitTotals (page.tsx, after this slice): the BI salesLineTotals
// split — costed lines feed costedRevenue/knownCogs, unknown-cost lines
// feed unknownCostRevenue/unknownCostLines. Profit is costed-only.
const todayProfitTotals = (items: SalesItem[], products: Product[]) => {
  const totals = items.reduce(
    (acc, item) => {
      const product = products.find((p) => String(p.id) === String(item.product_id));
      const cogs = salesLineCogsInMainUnits(item, product);
      const revenue = safeNumber(item.quantity) * safeNumber(item.selling_price) - safeNumber(item.discount);
      if (cogs !== null) {
        acc.costedRevenue += revenue;
        acc.knownCogs += cogs;
      } else {
        acc.unknownCostRevenue += revenue;
        acc.unknownCostLines += 1;
      }
      return acc;
    },
    { costedRevenue: 0, knownCogs: 0, unknownCostRevenue: 0, unknownCostLines: 0 }
  );
  return { ...totals, profit: totals.costedRevenue - totals.knownCogs };
};

// The OLD formula, kept here only to prove the bug it carried.
const oldTodayProfit = (items: SalesItem[], products: Product[]): number =>
  items.reduce((sum, item) => {
    const product = products.find((p) => String(p.id) === String(item.product_id));
    const cogs = salesLineCogsInMainUnits(item, product);
    const revenue = safeNumber(item.quantity) * safeNumber(item.selling_price) - safeNumber(item.discount);
    return sum + revenue - (cogs ?? 0);
  }, 0);

// todayProfitDefinition (DashboardView): the exclusion note appears only
// when unknown-cost lines exist; otherwise the plain base string.
const BASE_DEFINITION = "Today · revenue less cost";
const todayProfitDefinition = (unknownCostLines: number, unknownCostAmount: string): string =>
  unknownCostLines > 0
    ? messages.en["kpi.definitionTodayProfitExcludesUnknownCost"]
        .replace("{amount}", unknownCostAmount)
        .replace("{count}", String(unknownCostLines))
    : messages.en["kpi.definitionTodayProfit"];

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Money is computed in raw floats (the production code does not round COGS),
// so compare money values within a tiny epsilon, not with exact ===.
function checkClose(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} (expected ${expected}, got ${actual})`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function main(): void {
  console.log("\n=== salesLineCogsInMainUnits cases ===\n");

  const costed = { id: "P1", last_purchase_price: 0.5, units_per_pack: 1 };
  const fallbackOnly = { id: "P2", last_purchase_price: 0.4, units_per_pack: 1 };
  const unknown = { id: "P3", last_purchase_price: null, units_per_pack: 1 };
  const noPriceField = { id: "P4", units_per_pack: 1 };

  // (a) Costed via purchase_price_snapshot.
  checkClose(
    salesLineCogsInMainUnits({ quantity: 2, selling_price: 1, purchase_price_snapshot: 0.6, product_id: "P1" }, costed) ?? -1,
    1.2,
    "(a) snapshot cost 0.60 x qty 2 = COGS 1.20",
  );
  // (b) Costed via fallback last_purchase_price (no snapshot).
  checkClose(
    salesLineCogsInMainUnits({ quantity: 3, selling_price: 1, product_id: "P2" }, fallbackOnly) ?? -1,
    1.2,
    "(b) fallback cost 0.40 x qty 3 = COGS 1.20",
  );
  // (c) Unknown cost: no snapshot, no last purchase price.
  check(
    salesLineCogsInMainUnits({ quantity: 2, selling_price: 1, product_id: "P3" }, unknown) === null,
    "(c) no snapshot and no last purchase price = unknown cost (null)",
  );
  check(
    salesLineCogsInMainUnits({ quantity: 2, selling_price: 1, product_id: "P4" }, noPriceField) === null,
    "(c2) no snapshot and no price field at all = unknown cost (null)",
  );
  // (d) Snapshot 0 falls back to the product price, not to null.
  checkClose(
    salesLineCogsInMainUnits({ quantity: 2, selling_price: 1, purchase_price_snapshot: 0, product_id: "P2" }, fallbackOnly) ?? -1,
    0.8,
    "(d) snapshot 0 falls back to last purchase price 0.40 x qty 2 = COGS 0.80",
  );
  // (e) Subunit quantity is normalised to main units before costing.
  checkClose(
    salesLineCogsInMainUnits(
      { quantity: 10, selling_price: 0.1, purchase_price_snapshot: 0.5, unit_mode: "subunit", product_id: "P5" },
      { id: "P5", last_purchase_price: 0.5, units_per_pack: 10 },
    ) ?? -1,
    0.5,
    "(e) subunit qty 10 / pack 10 = 1 main unit x cost 0.50 = COGS 0.50",
  );
  // (f) A snapshot beats a different fallback price.
  checkClose(
    salesLineCogsInMainUnits({ quantity: 1, selling_price: 2, purchase_price_snapshot: 0.9, product_id: "P1" }, costed) ?? -1,
    0.9,
    "(f) snapshot 0.90 wins over fallback 0.50",
  );

  console.log("\n=== todayProfitTotals on a mixed set ===\n");

  const products = [costed, fallbackOnly, unknown, noPriceField];
  // Line 1: costed via snapshot — revenue 2.00, COGS 1.20, profit 0.80.
  // Line 2: costed via fallback — revenue 3.00, COGS 1.20, profit 1.80.
  // Line 3: unknown cost — revenue 2.00, COGS null.
  // Line 4: unknown cost with a discount — revenue 1.00 - 0.20 = 0.80, COGS null.
  const mixed: SalesItem[] = [
    { quantity: 2, selling_price: 1, purchase_price_snapshot: 0.6, product_id: "P1" },
    { quantity: 3, selling_price: 1, product_id: "P2" },
    { quantity: 2, selling_price: 1, product_id: "P3" },
    { quantity: 1, selling_price: 1, discount: 0.2, product_id: "P4" },
  ];
  const totals = todayProfitTotals(mixed, products);
  checkClose(totals.costedRevenue, 5, "costed revenue is 5.00");
  checkClose(totals.knownCogs, 2.4, "known COGS is 2.40");
  checkClose(totals.profit, 2.6, "profit is costed-only 2.60");
  checkClose(totals.unknownCostRevenue, 2.8, "unknown-cost revenue is 2.80");
  check(totals.unknownCostLines === 2, `unknown-cost lines are 2 (got ${totals.unknownCostLines})`);
  checkClose(
    oldTodayProfit(mixed, products),
    5.4,
    "the old formula gave 5.40 on the same set — it counted the 2.80 unknown-cost revenue as pure profit (overstated by 2.80)",
  );

  console.log("\n=== Zero unknown-cost lines: identical to the old formula ===\n");

  const costedOnly: SalesItem[] = [
    { quantity: 2, selling_price: 1, purchase_price_snapshot: 0.6, product_id: "P1" },
    { quantity: 3, selling_price: 1, product_id: "P2" },
  ];
  const costedTotals = todayProfitTotals(costedOnly, products);
  checkClose(costedTotals.profit, oldTodayProfit(costedOnly, products), "profit is identical to the old formula when no line has unknown cost");
  check(costedTotals.unknownCostLines === 0, "unknown-cost lines are 0");
  check(costedTotals.unknownCostRevenue === 0, "unknown-cost revenue is 0");
  checkClose(costedTotals.profit, 2.6, "profit is 2.60");

  // Empty day: profit 0, nothing to disclose.
  const empty = todayProfitTotals([], products);
  check(empty.profit === 0 && empty.unknownCostLines === 0, "empty day: profit 0, no unknown-cost lines");

  console.log("\n=== Definition disclosure ===\n");

  check(
    todayProfitDefinition(0, "€0.00") === BASE_DEFINITION,
    "no unknown-cost lines: definition is exactly the base string",
  );
  check(
    todayProfitDefinition(2, "€2.80") ===
      "Today · revenue less cost · excludes €2.80 from 2 lines with unknown cost",
    "unknown-cost lines exist: definition discloses the excluded amount and line count",
  );
  check(
    todayProfitDefinition(1, "€1.13").includes("€1.13") && todayProfitDefinition(1, "€1.13").includes("1 lines"),
    "single unknown-cost line: definition carries its amount and count",
  );

  console.log("\n=== Exclusion key exists in all 4 locales ===\n");

  for (const language of ["en", "es", "it", "ur"] as const) {
    const text = messages[language]["kpi.definitionTodayProfitExcludesUnknownCost"];
    check(typeof text === "string" && text.length > 0, `key exists in ${language}`);
    check(text.includes("{amount}") && text.includes("{count}"), `key in ${language} carries both {amount} and {count} placeholders`);
  }
  check(
    messages.en["kpi.definitionTodayProfit"] === BASE_DEFINITION,
    "base definition key is unchanged",
  );

  console.log(`\n${passed} passed, 0 failed`);
}

main();
