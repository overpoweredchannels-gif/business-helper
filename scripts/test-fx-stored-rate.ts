import assert from "node:assert/strict";
import {
  isValidTypedRate,
  parseStoredPkrPerUnit,
  pkrPerUnitFor,
  switchRateFromPkrPerUnit,
} from "../src/lib/fx/stored-rate";

// Stored rates are PKR per 1 unit, as saved by the owner (e.g. 1 EUR = 312.45 PKR).
assert.equal(parseStoredPkrPerUnit("312.45"), 312.45);
assert.equal(parseStoredPkrPerUnit(312.45), 312.45);
assert.equal(parseStoredPkrPerUnit("280"), 280);

// A missing or bad stored rate is null — never 1.0, never invented.
assert.equal(parseStoredPkrPerUnit(null), null);
assert.equal(parseStoredPkrPerUnit(undefined), null);
assert.equal(parseStoredPkrPerUnit(""), null);
assert.equal(parseStoredPkrPerUnit("abc"), null);
assert.equal(parseStoredPkrPerUnit(0), null);
assert.equal(parseStoredPkrPerUnit(-5), null);
assert.equal(parseStoredPkrPerUnit("0"), null);

// PKR is the identity and needs no stored row, even when none exists.
assert.equal(pkrPerUnitFor("PKR", null), 1);
assert.equal(pkrPerUnitFor("PKR", 312.45), 1);

// Any other currency needs its stored rate; a missing one stays null.
assert.equal(pkrPerUnitFor("EUR", 312.45), 312.45);
assert.equal(pkrPerUnitFor("EUR", null), null);
assert.equal(pkrPerUnitFor("XXX" as never, 312.45), null);

// Books-switch rate: "1 <from> = rate <to>".
const pkrEur = switchRateFromPkrPerUnit(1, 312.45);
assert.ok(pkrEur !== null && Math.abs(pkrEur - 1 / 312.45) < 1e-12, `PKR->EUR ${pkrEur}`);
const eurPkr = switchRateFromPkrPerUnit(312.45, 1);
assert.ok(eurPkr !== null && Math.abs(eurPkr - 312.45) < 1e-9, `EUR->PKR ${eurPkr}`);
const eurUsd = switchRateFromPkrPerUnit(312.45, 280.1);
assert.ok(eurUsd !== null && Math.abs(eurUsd - 312.45 / 280.1) < 1e-9, `EUR->USD ${eurUsd}`);
assert.equal(switchRateFromPkrPerUnit(312.45, 312.45), 1);

// Any missing or invalid leg blocks the switch — no guessed rate.
assert.equal(switchRateFromPkrPerUnit(null, 312.45), null);
assert.equal(switchRateFromPkrPerUnit(1, null), null);
assert.equal(switchRateFromPkrPerUnit(0, 312.45), null);
assert.equal(switchRateFromPkrPerUnit(1, 0), null);
assert.equal(switchRateFromPkrPerUnit(-1, 312.45), null);

// Typed rates: digits, up to 6 decimals, greater than zero (server shape).
assert.equal(isValidTypedRate("312.45"), true);
assert.equal(isValidTypedRate("312.123456"), true);
assert.equal(isValidTypedRate(" 312.45 "), true);
assert.equal(isValidTypedRate("280"), true);
assert.equal(isValidTypedRate("312.1234567"), false);
assert.equal(isValidTypedRate("0"), false);
assert.equal(isValidTypedRate("0.00"), false);
assert.equal(isValidTypedRate("-5"), false);
assert.equal(isValidTypedRate("abc"), false);
assert.equal(isValidTypedRate(""), false);
assert.equal(isValidTypedRate("312,45"), false);

console.log("fx-stored-rate: all assertions passed");
