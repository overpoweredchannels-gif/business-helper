import assert from "node:assert/strict";
import { buildRetailDrawerSummary } from "../src/lib/sales/retail-summary";

const blank = buildRetailDrawerSummary({ total: 100, received: "" });
assert.equal(blank.received, 100);
assert.equal(blank.status, "cash-ready");
assert.equal(blank.shortfall, 0);
assert.equal(blank.change, 0);

const zero = buildRetailDrawerSummary({ total: 100, received: "0" });
assert.equal(zero.received, 0);
assert.equal(zero.status, "cash-short");
assert.equal(zero.shortfall, 100);
assert.equal(zero.returnAmount, 0);
assert.equal(zero.change, 0);

const insufficient = buildRetailDrawerSummary({ total: 100, received: 65 });
assert.equal(insufficient.status, "cash-short");
assert.equal(insufficient.shortfall, 35);
assert.equal(insufficient.returnAmount, 0);
assert.equal(insufficient.change, 0);

const exact = buildRetailDrawerSummary({ total: 100, received: 100 });
assert.equal(exact.status, "cash-ready");
assert.equal(exact.shortfall, 0);
assert.equal(exact.change, 0);

const exactRoundedTotal = buildRetailDrawerSummary({ total: 100.004, received: 100 });
assert.equal(exactRoundedTotal.expected, 100);
assert.equal(exactRoundedTotal.status, "cash-ready");

const excess = buildRetailDrawerSummary({ total: 100, received: "125" });
assert.equal(excess.status, "cash-ready");
assert.equal(excess.shortfall, 0);
assert.equal(excess.returnAmount, 25);
assert.equal(excess.change, 25);

console.log("Retail cash summary tests passed: blank, zero, insufficient, exact, and excess.");
