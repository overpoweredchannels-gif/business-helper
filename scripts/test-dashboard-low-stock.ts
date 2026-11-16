/**
 * Dashboard low-stock unification slice (P1 Area B) — Unit Tests.
 *
 * M1 decision 2 (UMAIR-approved 2026-10-22): stockStatusFor is the ONE
 * stock-health classifier. The dashboard Inventory Health count ran its own
 * inline rule (`currentStock <= reorderLevel` on inventoryStats), and
 * inventoryStats defaults a missing reorder level to 0 — so an out-of-stock
 * product with no level set (0 <= 0) was counted as "low stock". Live: the
 * Health count showed 20 while the Low Stock Alerts KPI (already on the
 * classifier via reorderRecommendationSummary.urgentReorderCount) showed 2.
 *
 * This test proves: the classifier puts each boundary case in exactly one
 * bucket, the dashboard Health count now equals the KPI urgentReorderCount
 * on a fixture catalogue, and the BI alignment changes nothing (the old BI
 * rule was already equivalent to "urgent_reorder").
 *
 * Run: npx tsx scripts/test-dashboard-low-stock.ts
 */

import assert from "node:assert/strict";
import { reorderTableStatusFor, stockStatusFor } from "../src/lib/inventory/service";

// ─── The dashboard + KPI computations, mirrored from src/app/page.tsx ──────
//
// Dashboard Health (page.tsx, after this slice): inventoryStats items carry
// `reorderLevel: product.reorder_level ?? 0`, and lowStockProducts keeps
// only items whose stockStatusFor status is "urgent_reorder".
const dashboardLowStockCount = (
  items: Array<{ currentStock: number; reorderLevel: number }>
): number =>
  items.filter((item) => stockStatusFor(item.currentStock, item.reorderLevel).status === "urgent_reorder")
    .length;

// The OLD dashboard rule, kept here only to prove the bug it carried.
const oldDashboardLowStockCount = (
  items: Array<{ currentStock: number; reorderLevel: number }>
): number =>
  items.filter((item) => typeof item.reorderLevel === "number" && item.currentStock <= item.reorderLevel)
    .length;

// Low Stock Alerts KPI (page.tsx): reorderRecommendations are built with
// reorderTableStatusFor (a stockStatusFor wrapper) and the KPI counts the
// "Urgent Reorder" rows.
const kpiUrgentReorderCount = (
  items: Array<{ currentStock: number; reorderLevel: number }>
): number =>
  items.filter((item) => reorderTableStatusFor(item.currentStock, item.reorderLevel) === "Urgent Reorder")
    .length;

// BI low stock (page.tsx): the OLD inline rule, kept here to prove the
// alignment changed nothing.
const oldBiLowStockCount = (
  items: Array<{ currentStock: number; reorderLevel: number }>
): number =>
  items.filter((product) => product.currentStock > 0 && product.currentStock <= product.reorderLevel).length;

const biLowStockCount = (
  items: Array<{ currentStock: number; reorderLevel: number }>
): number =>
  items.filter((product) => stockStatusFor(product.currentStock, product.reorderLevel).status === "urgent_reorder")
    .length;

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function main(): void {
  console.log("\n=== stockStatusFor boundary cases ===\n");

  // (a) No reorder level set (0) and zero stock → out of stock, NOT low.
  check(
    stockStatusFor(0, 0).status === "out_of_stock",
    "(a) stock 0, level 0 is out of stock, not low stock",
  );
  // (b) No reorder level set (0) with stock on hand → missing level, NOT low.
  check(
    stockStatusFor(5, 0).status === "missing_reorder_level",
    "(b) stock 5, level 0 is missing reorder level, not low stock",
  );
  // (c) Zero stock with a level set → out of stock, NOT low.
  check(
    stockStatusFor(0, 10).status === "out_of_stock",
    "(c) stock 0, level 10 is out of stock, not low stock",
  );
  // (d) Stock above zero, at or below the level → low stock.
  check(
    stockStatusFor(5, 10).status === "urgent_reorder",
    "(d) stock 5, level 10 IS low stock (urgent reorder)",
  );
  // (e) Stock above the level → healthy, NOT low.
  check(
    stockStatusFor(15, 10).status === "healthy",
    "(e) stock 15, level 10 is healthy, not low stock",
  );
  // Boundary: stock exactly at the level is still low stock.
  check(
    stockStatusFor(10, 10).status === "urgent_reorder",
    "stock exactly at the level (10/10) IS low stock",
  );
  // A null level behaves like a missing level, never low stock.
  check(
    stockStatusFor(3, null).status === "missing_reorder_level",
    "stock 3, level null is missing reorder level, not low stock",
  );
  check(
    stockStatusFor(0, null).status === "out_of_stock",
    "stock 0, level null is out of stock, not low stock",
  );

  console.log("\n=== Dashboard Health count == KPI urgentReorderCount ===\n");

  // Fixture catalogue: two genuinely low-stock products (D, F) plus the
  // bug cases the old rule miscounted (A, C) and healthy / no-level ones.
  const catalogue = [
    { name: "A no-level zero stock", currentStock: 0, reorderLevel: 0 },
    { name: "B no-level stocked", currentStock: 5, reorderLevel: 0 },
    { name: "C zero stock with level", currentStock: 0, reorderLevel: 10 },
    { name: "D low stock", currentStock: 5, reorderLevel: 10 },
    { name: "E healthy", currentStock: 15, reorderLevel: 10 },
    { name: "F at the level", currentStock: 10, reorderLevel: 10 },
    { name: "G no-level stocked", currentStock: 3, reorderLevel: 0 },
    { name: "H no-level zero stock", currentStock: 0, reorderLevel: 0 },
  ];

  const dashboardCount = dashboardLowStockCount(catalogue);
  const kpiCount = kpiUrgentReorderCount(catalogue);
  check(dashboardCount === 2, `dashboard Health count is 2 on the fixture (got ${dashboardCount})`);
  check(kpiCount === 2, `KPI urgentReorderCount is 2 on the fixture (got ${kpiCount})`);
  check(
    dashboardCount === kpiCount,
    "(f) dashboard Health count and KPI urgentReorderCount agree",
  );
  check(
    oldDashboardLowStockCount(catalogue) === 5,
    "the old inline rule counted 5 on the same fixture (three out-of-stock items miscounted as low)",
  );

  console.log("\n=== BI alignment changes nothing ===\n");

  check(
    oldBiLowStockCount(catalogue) === 2,
    `old BI rule counted 2 on the fixture (got ${oldBiLowStockCount(catalogue)})`,
  );
  check(
    biLowStockCount(catalogue) === oldBiLowStockCount(catalogue),
    "BI count is unchanged by aligning to the classifier",
  );

  console.log(`\n${passed} passed, 0 failed`);
}

main();
