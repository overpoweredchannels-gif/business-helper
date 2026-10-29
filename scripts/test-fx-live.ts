import assert from "node:assert/strict";
import {
  conversionRatePerUnit,
  perPkrMapFromBaseRates,
  pkrPerUnitFromBaseRates,
} from "../src/lib/fx/live-rate";

// Live feed values verified 2026-10-29: 1 PKR = 0.003239 EUR.
const rates = { EUR: 0.003239, USD: 0.003611, GBP: 0.002712, JPY: 0.570031 };

// PKR is the identity — no upstream division.
assert.equal(pkrPerUnitFromBaseRates(rates, "PKR"), 1);

// Direction: PKR per unit must be the reciprocal of the per-PKR quote.
const eur = pkrPerUnitFromBaseRates(rates, "EUR");
assert.ok(eur !== null && Math.abs(eur - 308.737) < 0.01, `EUR rate ${eur}`);
const jpy = pkrPerUnitFromBaseRates(rates, "JPY");
assert.ok(jpy !== null && Math.abs(jpy - 1.7543) < 0.001, `JPY rate ${jpy}`);

// Bad data never invents a conversion.
assert.equal(pkrPerUnitFromBaseRates(rates, "AED"), null);
assert.equal(pkrPerUnitFromBaseRates({ EUR: 0 }, "EUR"), null);
assert.equal(pkrPerUnitFromBaseRates({ EUR: -1 }, "EUR"), null);
assert.equal(pkrPerUnitFromBaseRates(null, "EUR"), null);
assert.equal(pkrPerUnitFromBaseRates(undefined, "EUR"), null);
assert.equal(pkrPerUnitFromBaseRates(rates, "XXX" as never), null);

// Per-PKR map: PKR is always 1; bad quotes are dropped, never invented.
const map = perPkrMapFromBaseRates(rates);
assert.equal(map.PKR, 1);
assert.equal(map.EUR, 0.003239);
assert.equal(map.GBP, 0.002712);
assert.equal(map.AED, undefined);
assert.equal(perPkrMapFromBaseRates({ EUR: 0 }).EUR, undefined);
assert.equal(perPkrMapFromBaseRates(null).PKR, 1);

// Books-switch rate: "1 <from> = rate <to>", from the per-PKR quotes.
const pkrEur = conversionRatePerUnit(map, "PKR", "EUR");
assert.ok(pkrEur !== null && Math.abs(pkrEur - 0.003239) < 1e-9, `PKR->EUR ${pkrEur}`);
const eurGbp = conversionRatePerUnit(map, "EUR", "GBP");
assert.ok(eurGbp !== null && Math.abs(eurGbp - 0.002712 / 0.003239) < 1e-9, `EUR->GBP ${eurGbp}`);
const eurPkr = conversionRatePerUnit(map, "EUR", "PKR");
assert.ok(eurPkr !== null && Math.abs(eurPkr - 1 / 0.003239) < 0.01, `EUR->PKR ${eurPkr}`);
assert.equal(conversionRatePerUnit(map, "EUR", "EUR"), 1);
assert.equal(conversionRatePerUnit(map, "PKR", "AED"), null);
assert.equal(conversionRatePerUnit(map, "AED", "EUR"), null);
assert.equal(conversionRatePerUnit(null, "PKR", "EUR"), null);

console.log("fx-live: all assertions passed");
