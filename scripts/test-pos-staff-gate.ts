import assert from "node:assert/strict";
import {
  parseSellMode,
  readSellMode,
  sellModeStorageKey,
  writeSellMode,
} from "../src/lib/sales/sell-mode";
import {
  parseStaffSalesMode,
  staffSaleOutcome,
} from "../src/lib/sales/staff-sale-gate";
import {
  HELD_SALES_LIMIT,
  heldSalesQuarantineKey,
  loadHeldSales,
  parseHeldSales,
  type HeldSale,
} from "../src/lib/sales/held-sales";

// ---------------------------------------------------------------------------
// Sell-mode persistence: keying, restore values, scope isolation.
// ---------------------------------------------------------------------------

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const PROFILE_1 = "33333333-3333-4333-8333-333333333333";
const PROFILE_2 = "44444444-4444-4444-8444-444444444444";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

assert.equal(
  sellModeStorageKey(ORG_A, PROFILE_1),
  `tradeos-sell-mode-v1:${ORG_A}:${PROFILE_1}`,
  "mode key is scoped by organization + profile",
);
assert.equal(parseSellMode("pos"), "pos");
assert.equal(parseSellMode("invoice"), "invoice");
assert.equal(parseSellMode(null), "invoice", "missing value restores the historical default (detailed form)");
assert.equal(parseSellMode("POS"), "invoice", "unknown values never restore POS");
assert.equal(parseSellMode(""), "invoice");

{
  const storage = fakeStorage();
  writeSellMode(storage, ORG_A, PROFILE_1, "pos");
  assert.equal(readSellMode(storage, ORG_A, PROFILE_1), "pos", "POS mode round-trips for its own scope");
  assert.equal(readSellMode(storage, ORG_A, PROFILE_2), "invoice", "another profile in the same org is unaffected");
  assert.equal(readSellMode(storage, ORG_B, PROFILE_1), "invoice", "another organization is unaffected");
  writeSellMode(storage, ORG_A, PROFILE_1, "invoice");
  assert.equal(readSellMode(storage, ORG_A, PROFILE_1), "invoice", "switching back to the form persists too");
}

{
  const broken = {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => { throw new Error("storage unavailable"); },
  };
  assert.equal(readSellMode(broken, ORG_A, PROFILE_1), "invoice", "unreadable storage falls back to the default mode");
  writeSellMode(broken, ORG_A, PROFILE_1, "pos"); // must not throw
}

// ---------------------------------------------------------------------------
// Staff-sale gate: role x setting matrix. "approval" is the default for
// every missing/unknown value; owners and admins are never gated.
// ---------------------------------------------------------------------------

assert.equal(parseStaffSalesMode("direct"), "direct");
assert.equal(parseStaffSalesMode("approval"), "approval");
assert.equal(parseStaffSalesMode(undefined), "approval");
assert.equal(parseStaffSalesMode(null), "approval");
assert.equal(parseStaffSalesMode("DIRECT"), "approval", "only the exact stored value opts in to direct");
assert.equal(parseStaffSalesMode({}), "approval");

for (const mode of ["direct", "approval", undefined, null, "junk"]) {
  assert.equal(staffSaleOutcome({ role: "owner", mode }), "unaffected", `owner is unaffected (mode=${String(mode)})`);
  assert.equal(staffSaleOutcome({ role: "admin", mode }), "unaffected", `admin is unaffected (mode=${String(mode)})`);
}
for (const role of ["staff", "employee", "salesman", null, undefined]) {
  assert.equal(staffSaleOutcome({ role, mode: "direct" }), "direct", `staff role ${String(role)} + direct setting saves directly`);
  assert.equal(staffSaleOutcome({ role, mode: "approval" }), "approval", `staff role ${String(role)} + approval setting uses the pipeline`);
  assert.equal(staffSaleOutcome({ role, mode: undefined }), "approval", `staff role ${String(role)} with no setting stored keeps today's behaviour`);
  assert.equal(staffSaleOutcome({ role, mode: "junk" }), "approval", `staff role ${String(role)} with a corrupt setting keeps today's behaviour`);
}

// ---------------------------------------------------------------------------
// Held sales: strict parse (writer-shaped fixtures), recovering load with
// quarantine. Fixtures mirror exactly what RetailPOS hold() persists:
// a CounterSale whose line fields are strings, keyed by scope.
// ---------------------------------------------------------------------------

const heldRow = (overrides: Partial<HeldSale> = {}): HeldSale => ({
  id: "55555555-5555-4555-8555-555555555555",
  savedAt: "2026-10-23T07:00:00.000Z",
  sale: {
    lines: [
      { product_id: "p1", quantity: "2", selling_price: "155", discount: "", unit_mode: "main" },
      { product_id: null, quantity: "1", selling_price: "0", discount: "5", bonus: "1", unit_mode: "subunit" },
    ],
    customerId: "c1",
    date: "2026-10-23",
    paymentType: "cash",
    discount: "",
    discountType: "flat",
    tax: "",
  },
  ...overrides,
});

const SCOPE_KEY = "tradeos-pos-held-v1:org:profile";

assert.deepEqual(parseHeldSales(null), [], "no stored value parses as an empty list");
assert.deepEqual(parseHeldSales(JSON.stringify([heldRow()])), [heldRow()], "a writer-shaped row parses");
assert.throws(() => parseHeldSales("{not json"), /Invalid held sales/, "corrupt JSON is rejected");
assert.throws(
  () => parseHeldSales(JSON.stringify([heldRow({ sale: { ...heldRow().sale, paymentType: "card" as never } })])),
  /Invalid held sales/,
  "an unknown payment type is rejected",
);
assert.throws(
  () => parseHeldSales(JSON.stringify(Array.from({ length: HELD_SALES_LIMIT + 1 }, () => heldRow()))),
  /Invalid held sales/,
  "an over-limit store is rejected",
);
assert.throws(
  () => parseHeldSales(JSON.stringify([{ id: "x", savedAt: "y", sale: { lines: [{ product_id: "p", quantity: 2, selling_price: "1", discount: "" }], customerId: null, date: "2026-10-23", paymentType: "cash", discount: "", discountType: "flat", tax: "" } }])),
  /Invalid held sales/,
  "a line with a non-string quantity is rejected",
);

{
  const storage = fakeStorage({ [SCOPE_KEY]: JSON.stringify([heldRow()]) });
  const loaded = loadHeldSales(storage, SCOPE_KEY);
  assert.equal(loaded.quarantined, false);
  assert.deepEqual(loaded.sales, [heldRow()]);
  assert.equal(storage.map.has(heldSalesQuarantineKey(SCOPE_KEY)), false, "a healthy store is never quarantined");
}

{
  const corrupt = "{corrupt held sales";
  const storage = fakeStorage({ [SCOPE_KEY]: corrupt });
  const loaded = loadHeldSales(storage, SCOPE_KEY);
  assert.deepEqual(loaded.sales, [], "a corrupt store loads as an empty list so Hold stays usable");
  assert.equal(loaded.quarantined, true);
  assert.equal(
    storage.map.get(heldSalesQuarantineKey(SCOPE_KEY)),
    corrupt,
    "the corrupt value is preserved under the quarantine key",
  );
  assert.equal(storage.map.get(SCOPE_KEY), corrupt, "the original value is left in place for diagnosis");
}

{
  const storage = fakeStorage();
  const loaded = loadHeldSales(storage, SCOPE_KEY);
  assert.deepEqual(loaded, { sales: [], quarantined: false }, "a first-run empty store is not a quarantine");
}

{
  // Quarantine write itself failing (storage full) must not break recovery.
  const storage = {
    getItem: () => "{corrupt",
    setItem: () => { throw new Error("quota"); },
  };
  const loaded = loadHeldSales(storage, SCOPE_KEY);
  assert.deepEqual(loaded.sales, []);
  assert.equal(loaded.quarantined, true);
}

console.log("POS staff-gate checks passed: sell-mode persistence keying/restore, staff-sale gate matrix, held-sales parse + quarantine recovery.");
