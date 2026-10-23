import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimatedDaysLeftFor } from "../src/lib/inventory/service";

// One shared days-left computation for every surface (QA regression
// 2026-10-23: BI Inventory Movement showed −30.0/−24.0 days for products
// sold below zero stock while the reorder table showed 0.0 — the BI
// surface rendered the raw stock ÷ daily-rate figure, the table clamped
// its own copy, and Products Insights ran a third formula entirely).

// Stocked out with velocity → exactly 0 days of cover.
assert.equal(estimatedDaysLeftFor(0, 2), 0);
// Sold BELOW zero stock (negative balance) → still 0, never negative.
assert.equal(estimatedDaysLeftFor(-60, 2), 0, "QA SCAN TEST case: −60 stock at 2/day read −30.0 in BI");
assert.equal(estimatedDaysLeftFor(-48, 2), 0, "QA-M1 Widget case: −48 stock at 2/day read −24.0 in BI");
// Healthy cover → stock ÷ daily rate.
assert.equal(estimatedDaysLeftFor(90, 3), 30);
// Slow mover → large but finite cover.
assert.equal(estimatedDaysLeftFor(5, 0.5), 10);
// No sales velocity → no estimate (surfaces show "no recent sales"),
// regardless of stock level.
assert.equal(estimatedDaysLeftFor(50, 0), null);
assert.equal(estimatedDaysLeftFor(0, 0), null);
assert.equal(estimatedDaysLeftFor(-10, 0), null);

// Unification guard: both page.tsx computations route through the shared
// function, and no inline stock ÷ daily-rate formula survives next to
// them (the two historical shapes are asserted absent).
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
assert.ok(pageSource.includes("estimatedDaysLeftFor(currentStock, dailyAverageSales)"), "reorder/BI computation must use the shared function");
assert.ok(pageSource.includes("estimatedDaysLeftFor(stock, daily)"), "Products Insights must use the shared function");
assert.ok(!pageSource.includes("daily > 0 ? stock / daily"), "the old Products Insights formula must be gone");
assert.ok(!pageSource.includes("dailyAverageSales > 0 ? currentStock / dailyAverageSales"), "the old reorder formula must be gone");

console.log("test-days-left: all assertions passed");
