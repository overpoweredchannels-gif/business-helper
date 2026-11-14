import assert from "node:assert/strict";
import type { HeldCounterSale } from "../src/lib/sales/held-sales";
import {
  MINI_TABS_LIMIT,
  emptyMiniTabSale,
  loadMiniTabs,
  miniTabCurrencyStatus,
  miniTabsQuarantineKey,
  miniTabsStorageKey,
  newMiniTab,
  parseMiniTabs,
  type MiniTab,
  type MiniTabsStore,
} from "../src/lib/sales/mini-tabs";

// Phase D (mini-tabs for concurrent invoices): each tab carries the whole
// counter sale — customer, lines, discount, tax, payment mode, typed cash
// tender, scan-unit preference and notes — so switching tabs can never mix
// one customer's data into another, and a reload reopens the same tabs.

const SCOPE_KEY = "tradeos-pos-tabs-v1:org:profile";

const tabSaleA: HeldCounterSale = {
  lines: [
    { product_id: "p1", quantity: "2", selling_price: "155", discount: "10", discount_type: "percent", unit_mode: "main" },
  ],
  customerId: "c1",
  date: "2026-11-14",
  paymentType: "cash",
  discount: "5",
  discountType: "flat",
  tax: "10",
  cashReceived: "500",
  scanUnit: "main",
  notes: "Deliver after 5pm",
};

const tabSaleB: HeldCounterSale = {
  lines: [
    { product_id: "p2", quantity: "1", selling_price: "80.60", discount: "", bonus: "1", unit_mode: "subunit" },
  ],
  customerId: "c2",
  date: "2026-11-14",
  paymentType: "credit",
  discount: "2",
  discountType: "percent",
  tax: "",
  cashReceived: "",
  scanUnit: "subunit",
  notes: "Call before dispatch",
};

const tabA = (overrides: Partial<MiniTab> = {}): MiniTab => ({
  id: "11111111-1111-4111-8111-111111111111",
  savedAt: "2026-11-14T07:00:00.000Z",
  currency: "EUR",
  sale: { ...tabSaleA },
  ...overrides,
});
const tabB = (overrides: Partial<MiniTab> = {}): MiniTab => ({
  id: "22222222-2222-4222-8222-222222222222",
  savedAt: "2026-11-14T07:05:00.000Z",
  currency: "EUR",
  sale: { ...tabSaleB },
  ...overrides,
});

const store = (overrides: Partial<MiniTabsStore> = {}): MiniTabsStore => ({
  tabs: [tabA(), tabB()],
  activeId: tabA().id,
  ...overrides,
});

const fakeStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

// 1. A two-tab store round-trips, active tab preserved.
assert.deepEqual(
  parseMiniTabs(JSON.stringify(store())),
  store(),
  "two tabs round-trip with the active tab preserved",
);

// 2. Isolation: each tab keeps its own customer, items, discount, payment
// mode and notes — nothing leaks from one tab into the other.
const parsed = parseMiniTabs(JSON.stringify(store()));
assert.equal(parsed.tabs[0].sale.customerId, "c1", "tab A keeps its own customer");
assert.equal(parsed.tabs[1].sale.customerId, "c2", "tab B keeps its own customer");
assert.equal(parsed.tabs[0].sale.paymentType, "cash", "tab A keeps Cash");
assert.equal(parsed.tabs[1].sale.paymentType, "credit", "tab B keeps Credit");
assert.equal(parsed.tabs[0].sale.discount, "5", "tab A keeps its flat discount");
assert.equal(parsed.tabs[1].sale.discount, "2", "tab B keeps its percent discount");
assert.equal(parsed.tabs[0].sale.notes, "Deliver after 5pm", "tab A keeps its note");
assert.equal(parsed.tabs[1].sale.notes, "Call before dispatch", "tab B keeps its note");
assert.equal(parsed.tabs[0].sale.cashReceived, "500", "tab A keeps its typed tender");
assert.equal(parsed.tabs[1].sale.cashReceived, "", "tab B keeps its empty tender");
assert.deepEqual(
  parsed.tabs.map((tab) => tab.sale.lines.map((line) => line.product_id)),
  [["p1"], ["p2"]],
  "each tab keeps only its own lines",
);

// 3. The limit is 4: a fifth tab is rejected, never silently dropped.
const fiveTabs = Array.from({ length: MINI_TABS_LIMIT + 1 }, (_, i) =>
  tabA({ id: `00000000-0000-4000-8000-00000000000${i}` }),
);
assert.equal(MINI_TABS_LIMIT, 4, "the tab limit is 4");
assert.throws(
  () => parseMiniTabs(JSON.stringify({ tabs: fiveTabs, activeId: fiveTabs[0].id })),
  /Invalid mini tabs/,
  "a fifth tab is rejected at parse time",
);

// 4. Strict validation: a bad payment type, discount type, over-long note
// or malformed line rejects the whole store instead of wedging the sale.
assert.throws(
  () =>
    parseMiniTabs(
      JSON.stringify(store({ tabs: [tabA({ sale: { ...tabSaleA, paymentType: "barter" as never } })] })),
    ),
  /Invalid mini tabs/,
  "an unknown payment type rejects the store",
);
assert.throws(
  () =>
    parseMiniTabs(
      JSON.stringify(store({ tabs: [tabA({ sale: { ...tabSaleA, discountType: "half" as never } })] })),
    ),
  /Invalid mini tabs/,
  "an unknown discount type rejects the store",
);
assert.throws(
  () =>
    parseMiniTabs(
      JSON.stringify(store({ tabs: [tabA({ sale: { ...tabSaleA, notes: "x".repeat(501) } })] })),
    ),
  /Invalid mini tabs/,
  "a note over 500 characters rejects the store",
);
assert.throws(
  () =>
    parseMiniTabs(
      JSON.stringify(
        store({ tabs: [tabA({ sale: { ...tabSaleA, lines: [{ product_id: "p1", quantity: 2 }] } as never })] }),
      ),
    ),
  /Invalid mini tabs/,
  "a malformed line rejects the store",
);

// 5. An active id that names no tab normalizes to null instead of throwing.
assert.equal(
  parseMiniTabs(JSON.stringify(store({ activeId: "99999999-9999-4999-8999-999999999999" }))).activeId,
  null,
  "an unknown active id becomes null, not a crash",
);

// 6. Legacy normalization: rows written without the Phase A fields read
// back as the empty-sale defaults instead of undefined.
const legacy = parseMiniTabs(
  JSON.stringify(
    store({
      tabs: [
        tabA({
          sale: {
            lines: [],
            customerId: null,
            date: "2026-11-14",
            paymentType: "cash",
            discount: "",
            discountType: "flat",
            tax: "",
          } as never,
        }),
      ],
    }),
  ),
);
assert.equal(legacy.tabs[0].sale.cashReceived, "", "a missing tender normalizes to empty");
assert.equal(legacy.tabs[0].sale.scanUnit, "subunit", "a missing scan unit normalizes to subunit");
assert.equal(legacy.tabs[0].sale.notes, "", "a missing note normalizes to empty");

// 7. A corrupt store is quarantined and loads as empty, so the sale
// screen keeps working.
const corruptRaw = "{not json";
const storage = fakeStorage({ [SCOPE_KEY]: corruptRaw });
const loaded = loadMiniTabs(storage, SCOPE_KEY);
assert.deepEqual(loaded.store, { tabs: [], activeId: null }, "a corrupt store loads as empty");
assert.equal(loaded.quarantined, true, "a corrupt store reports quarantined");
assert.equal(
  storage.map.get(miniTabsQuarantineKey(SCOPE_KEY)),
  corruptRaw,
  "the corrupt value is kept under the quarantine key",
);

// 8. Currency guard: a tab stamped with another currency is stale and
// must not open; the same currency is current; no stamp is legacy.
assert.equal(miniTabCurrencyStatus(tabA(), "EUR"), "current", "same-currency tab is current");
assert.equal(miniTabCurrencyStatus(tabA(), "PKR"), "stale", "other-currency tab is stale");
assert.equal(
  miniTabCurrencyStatus(tabA({ currency: undefined }), "PKR"),
  "legacy",
  "an unstamped tab is legacy, not stale",
);

// 9. Builders: a fresh tab is empty, stamped, and uniquely identified;
// a new tab holds the sale it was given.
const empty = emptyMiniTabSale(null, "subunit", "2026-11-14");
assert.deepEqual(
  empty,
  {
    lines: [],
    customerId: null,
    date: "2026-11-14",
    paymentType: "cash",
    discount: "",
    discountType: "flat",
    tax: "",
    cashReceived: "",
    scanUnit: "subunit",
    notes: "",
  },
  "a fresh tab starts as an empty sale",
);
const built = newMiniTab({ ...tabSaleA }, "EUR");
assert.equal(built.sale, built.sale, "a new tab holds the given sale");
assert.equal(built.currency, "EUR", "a new tab is stamped with the books currency");
assert.notEqual(built.id, newMiniTab({ ...tabSaleA }, "EUR").id, "each new tab gets a unique id");
assert.equal(miniTabsStorageKey("org:profile"), SCOPE_KEY, "the storage key is scoped per org + profile");

console.log(
  "Mini-tabs Phase D checks passed: two-tab round-trip with active tab, per-tab isolation (customer, lines, discount, payment mode, notes, tender), 4-tab limit, strict validation, legacy normalization, corrupt-store quarantine, currency guard, empty/new tab builders.",
);
