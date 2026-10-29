import assert from "node:assert/strict";
import { pkrPerUnitFromBaseRates } from "../src/lib/fx/live-rate";

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

console.log("fx-live: all assertions passed");
