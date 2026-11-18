/**
 * Smart Module Inventory (P1 Area B) — Unit Tests.
 *
 * Defect: the Smart Module "Inventory" card showed a summary count and
 * a list that could disagree on the same card. The summary counted
 * `reorderRecommendationSummary.urgentReorderCount` — the reorder
 * recommendations' "Urgent Reorder" set — while the listed items came
 * from `lowStockProducts` (built from `inventoryStats`). Both sides
 * classify with the same classifier (stockStatusFor, via
 * reorderTableStatusFor) and the same currentStock, but with a different
 * reorder level:
 *
 * - reorderRecommendations: `reorder_level ?? minimum_stock_level ?? 0`
 * - inventoryStats: `reorder_level ?? 0` (no minimum_stock_level fallback)
 *
 * So a product with reorder_level null, minimum_stock_level set, and
 * stock at or below that level WAS counted in the summary but was NOT
 * in the listed items. A second, independent mismatch on the same card:
 * the summary counted ALL urgent recommendations (unbounded) while the
 * children showed `slice(0, 10)`.
 *
 * Fix: the card derives its summary count AND its listed rows from one
 * set — the recommendations' own urgent rows — via `urgentReorderRows`.
 * `inventoryStats` is deliberately UNCHANGED (it feeds the low-stock
 * KPI, the Health card, BI and other surfaces). The sibling Sales /
 * Purchases modules had the same summary-vs-listed shape (summaries
 * counted all 10 recent invoices, children showed only `slice(0, 5)`)
 * and now use `smartModuleRows`, which returns the whole array with its
 * count. The children render behind the module's expand toggle, so
 * listing the whole set does not grow the collapsed card.
 *
 * This test imports the production helpers directly (no mirroring) and
 * reproduces the two classification paths with the production
 * classifiers, so the divergence case is proven against the real rules.
 *
 * Run: npx tsx scripts/test-smart-module-inventory.ts
 */

import assert from "node:assert/strict";
import {
  smartModuleRows,
  urgentReorderRows,
  type SmartModuleReorderRow,
} from "../src/lib/dashboard/smart-modules";
import {
  reorderTableStatusFor,
  stockStatusFor,
} from "../src/lib/inventory/service";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

interface FixtureProduct {
  name: string;
  currentStock: number;
  reorderLevel: number | null;
  minimumStockLevel: number | null;
}

/** A recommendation row, built exactly the way page.tsx builds it. */
function recommendationRow(product: FixtureProduct): SmartModuleReorderRow {
  return {
    productId: product.name,
    productName: product.name,
    currentStock: product.currentStock,
    status: reorderTableStatusFor(
      product.currentStock,
      product.reorderLevel ?? product.minimumStockLevel ?? 0,
    ),
  };
}

/** Whether the OLD listed-items source (lowStockProducts, from
 * inventoryStats) would have included this product. */
function inOldLowStockList(product: FixtureProduct): boolean {
  return (
    stockStatusFor(product.currentStock, product.reorderLevel ?? 0).status ===
    "urgent_reorder"
  );
}

function main(): void {
  console.log("Smart Module Inventory — checks:\n");

  // (a) The divergence case: reorder_level null, minimum_stock_level
  // set, stock at or below that level.
  const divergent: FixtureProduct = {
    name: "Divergent Widget",
    currentStock: 4,
    reorderLevel: null,
    minimumStockLevel: 5,
  };
  const divergentRow = recommendationRow(divergent);
  check(
    divergentRow.status === "Urgent Reorder",
    "(a) divergence product: recommendation path (minimum_stock_level fallback) classifies it Urgent Reorder",
  );
  check(
    inOldLowStockList(divergent) === false,
    "(a) divergence product: OLD list source (inventoryStats, no fallback) classifies it missing_reorder_level, NOT urgent",
  );
  const divergentModule = urgentReorderRows([divergentRow]);
  check(
    divergentModule.count === 1 && divergentModule.rows.length === 1,
    "(a) divergence product: NEW module counts it AND lists it — summary and list agree",
  );
  check(
    divergentModule.rows[0]?.productName === "Divergent Widget",
    "(a) divergence product: the listed row is the divergent product itself",
  );

  // (b) A product with reorder_level set behaves identically in both.
  const levelSet: FixtureProduct = {
    name: "Level Set Widget",
    currentStock: 4,
    reorderLevel: 5,
    minimumStockLevel: null,
  };
  check(
    recommendationRow(levelSet).status === "Urgent Reorder",
    "(b) level-set product: recommendation path classifies it Urgent Reorder",
  );
  check(
    inOldLowStockList(levelSet) === true,
    "(b) level-set product: OLD list source also classifies it urgent (both agreed here)",
  );
  const levelSetModule = urgentReorderRows([recommendationRow(levelSet)]);
  check(
    levelSetModule.count === 1 && levelSetModule.rows.length === 1,
    "(b) level-set product: NEW module counts it AND lists it",
  );

  // (c) An out-of-stock product is in NEITHER the summary nor the list.
  const outOfStock: FixtureProduct = {
    name: "Out Of Stock Widget",
    currentStock: 0,
    reorderLevel: 5,
    minimumStockLevel: 5,
  };
  check(
    recommendationRow(outOfStock).status === "Out of Stock",
    "(c) out-of-stock product: recommendation path classifies it Out of Stock, not Urgent Reorder",
  );
  check(
    inOldLowStockList(outOfStock) === false,
    "(c) out-of-stock product: OLD list source also excludes it",
  );
  const outOfStockModule = urgentReorderRows([recommendationRow(outOfStock)]);
  check(
    outOfStockModule.count === 0 && outOfStockModule.rows.length === 0,
    "(c) out-of-stock product: NEW module counts 0 and lists nothing",
  );

  // (d) A missing-reorder-level product (stock > 0, no level anywhere)
  // is in NEITHER.
  const missingLevel: FixtureProduct = {
    name: "Missing Level Widget",
    currentStock: 3,
    reorderLevel: null,
    minimumStockLevel: null,
  };
  check(
    recommendationRow(missingLevel).status === "Missing Reorder Level",
    "(d) missing-level product: recommendation path classifies it Missing Reorder Level",
  );
  check(
    inOldLowStockList(missingLevel) === false,
    "(d) missing-level product: OLD list source also excludes it",
  );
  const missingLevelModule = urgentReorderRows([recommendationRow(missingLevel)]);
  check(
    missingLevelModule.count === 0 && missingLevelModule.rows.length === 0,
    "(d) missing-level product: NEW module counts 0 and lists nothing",
  );

  // A healthy product is in NEITHER either.
  const healthy: FixtureProduct = {
    name: "Healthy Widget",
    currentStock: 50,
    reorderLevel: 5,
    minimumStockLevel: 5,
  };
  check(
    recommendationRow(healthy).status === "Healthy",
    "healthy product: recommendation path classifies it Healthy",
  );
  const healthyModule = urgentReorderRows([recommendationRow(healthy)]);
  check(
    healthyModule.count === 0 && healthyModule.rows.length === 0,
    "healthy product: NEW module counts 0 and lists nothing",
  );

  // Mixed set: summary count always equals the listed rows.
  const mixed: FixtureProduct[] = [divergent, levelSet, outOfStock, missingLevel, healthy];
  const mixedModule = urgentReorderRows(mixed.map(recommendationRow));
  check(
    mixedModule.count === 2,
    "mixed set: summary counts exactly the 2 urgent products (divergent + level-set)",
  );
  check(
    mixedModule.rows.length === 2 && mixedModule.count === mixedModule.rows.length,
    "mixed set: summary count equals the listed rows (2 = 2)",
  );
  check(
    mixedModule.rows.map((r) => r.productName).sort().join(",") ===
      "Divergent Widget,Level Set Widget",
    "mixed set: the listed rows are exactly the 2 urgent products, no other status leaks in",
  );

  // (e) More than 10 urgent items: no silent cap — the summary count
  // equals the urgent set size and every row is listed.
  const twelveUrgent: FixtureProduct[] = Array.from({ length: 12 }, (_, i) => ({
    name: `Urgent ${i + 1}`,
    currentStock: 1,
    reorderLevel: 5,
    minimumStockLevel: null,
  }));
  const twelveModule = urgentReorderRows(twelveUrgent.map(recommendationRow));
  check(
    twelveModule.count === 12,
    "(e) 12 urgent items: summary counts all 12 (previously the list silently showed 10)",
  );
  check(
    twelveModule.rows.length === 12 && twelveModule.count === twelveModule.rows.length,
    "(e) 12 urgent items: all 12 rows are listed — summary count equals listed rows",
  );
  check(
    twelveModule.rows.every((r) => r.status === "Urgent Reorder"),
    "(e) 12 urgent items: every listed row is an Urgent Reorder row",
  );

  // (f) Sibling modules: the whole recent array is listed, with the
  // count taken from the same array — previously the summary counted
  // all 10 recent invoices while the children showed only slice(0, 5).
  const tenInvoices = Array.from({ length: 10 }, (_, i) => ({
    id: `INV-${i + 1}`,
    invoice_number: `S-1000${i + 1}`,
  }));
  const tenModule = smartModuleRows(tenInvoices);
  check(
    tenModule.count === 10,
    "(f) siblings: 10 recent invoices — summary counts all 10",
  );
  check(
    tenModule.rows.length === 10 && tenModule.count === tenModule.rows.length,
    "(f) siblings: 10 recent invoices — all 10 rows are listed (previously only 5 were shown)",
  );
  check(
    tenModule.rows[9]?.invoice_number === "S-100010",
    "(f) siblings: the 10th (previously cut-off) invoice is listed",
  );
  const threeModule = smartModuleRows(tenInvoices.slice(0, 3));
  check(
    threeModule.count === 3 && threeModule.rows.length === 3,
    "(f) siblings: 3 recent invoices — count 3, rows 3",
  );
  const emptyModule = smartModuleRows([]);
  check(
    emptyModule.count === 0 && emptyModule.rows.length === 0,
    "(f) siblings: no recent invoices — count 0, rows 0",
  );
  const emptyUrgent = urgentReorderRows([]);
  check(
    emptyUrgent.count === 0 && emptyUrgent.rows.length === 0,
    "no recommendations at all — inventory module counts 0 and lists nothing",
  );

  console.log(`\nAll ${passed} Smart Module Inventory checks passed.\n`);
}

main();
