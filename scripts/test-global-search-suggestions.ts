// Unit tests for the global search suggestion panels.
// Run with: npm run test:global-search-suggestions
import assert from "node:assert/strict";
import { clampPopoverHeight, decideSuggestionPlacement } from "../src/components/search/useSuggestionPlacement";
import {
  buildCustomerSuggestionData,
  buildProductSuggestionData,
  pinSelectedFirst,
} from "../src/components/search/suggestion-items";
import { rankSearchResults } from "../src/lib/products/search-rank";

// --- popover placement: stays in the viewport, flips above when cramped ---
assert.equal(decideSuggestionPlacement(50, 400), "below", "ample space below stays below");
assert.equal(decideSuggestionPlacement(300, 100), "above", "cramped below flips above");
assert.equal(decideSuggestionPlacement(100, 100), "below", "tie keeps below");
assert.equal(decideSuggestionPlacement(0, 0), "below", "no space anywhere keeps below");
assert.equal(decideSuggestionPlacement(500, 179), "above", "just under the 180px threshold flips");
assert.equal(decideSuggestionPlacement(10, 180), "below", "exactly at the threshold stays below");

// --- product suggestion data: correct IDs, labels, prices ---
const brandNames = new Map<string | number, string>([["b1", "FreshCo"]]);
const categoryNames = new Map<string | number, string>([["c1", "Grocery"]]);
const price = (n: number) => `Rs ${n.toFixed(2)}`;
const productData = buildProductSuggestionData(
  [
    { id: 7, name: "Flour", sku: "FLR-001", barcode: "8901001", brand_id: "b1", category_id: "c1", default_selling_price: 120 },
    { id: "p2", name: "Sugar", sku: null, barcode: null, default_selling_price: null },
  ],
  brandNames,
  categoryNames,
  price,
);
assert.equal(productData.items.length, 2, "one item per product");
assert.equal(productData.items[0].id, "7", "numeric product id is stringified");
assert.equal(productData.items[0].label, "Flour", "label is the product name");
assert.equal(productData.items[0].detail, "FLR-001 · Rs 120.00", "detail carries SKU and price");
assert.equal(productData.items[1].detail, "", "no SKU and no price leaves an empty detail");
assert.deepEqual(productData.rankFields.get("7"), {
  name: "Flour",
  sku: "FLR-001",
  barcode: "8901001",
  brandName: "FreshCo",
  categoryName: "Grocery",
}, "product rank fields map every structured field");
assert.equal(productData.rankFields.get("p2")?.brandName, null, "missing brand maps to null");

// --- customer suggestion data: correct IDs and rank-field mapping ---
const customerData = buildCustomerSuggestionData([
  {
    id: "c1",
    customer_name: "Fahad",
    shop_name: "Fresh Mart",
    organization_name: "Fresh Org",
    contact_person: "Ali",
    phone: "03001234567",
    whatsapp: "03007654321",
    city: "Lahore",
    area: "DHA",
    address: "Street 5",
    shipping_address: null,
    customer_type: "retail",
  },
]);
assert.equal(customerData.items[0].id, "c1", "customer id preserved");
assert.equal(customerData.items[0].label, "Fahad", "label is the customer name");
assert.equal(customerData.items[0].detail, "Fresh Mart · 03001234567", "detail carries shop and phone");
const cFields = customerData.rankFields.get("c1");
assert.equal(cFields?.name, "Fahad", "name field");
assert.equal(cFields?.sku, "Fresh Mart", "shop name ranks as the code field");
assert.equal(cFields?.barcode, "03001234567", "phone ranks as the secondary code");
assert.ok(cFields?.brandName?.includes("Ali") && cFields?.brandName?.includes("retail"), "contact/org/type/whatsapp grouped mid-priority");
assert.ok(cFields?.categoryName?.includes("Lahore") && cFields?.categoryName?.includes("Street 5"), "city/area/address grouped lowest");

// --- single-character customer ranking: exact > prefix > shop-prefix > word-prefix > city ---
const customers = buildCustomerSuggestionData([
  { id: "city", customer_name: "Bilal", city: "Faisalabad" },
  { id: "word", customer_name: "Ahmed Faraz" },
  { id: "shop", customer_name: "Kamran", shop_name: "Fresh Mart" },
  { id: "exact", customer_name: "F" },
  { id: "prefix", customer_name: "Fahad" },
]);
const rankedF = rankSearchResults(customers.items, "F", (item) => customers.rankFields.get(item.id) ?? { name: item.label });
assert.deepEqual(
  rankedF.map((i) => i.id),
  ["exact", "prefix", "shop", "word", "city"],
  "F ranks: exact name, name prefix, shop prefix, word prefix, city",
);

// --- exact phone outranks name matches ---
const phones = buildCustomerSuggestionData([
  { id: "name-match", customer_name: "0300 Fan" },
  { id: "phone-exact", customer_name: "Zubair", phone: "03001234567" },
]);
const rankedPhone = rankSearchResults(phones.items, "03001234567", (item) => phones.rankFields.get(item.id) ?? { name: item.label });
assert.equal(rankedPhone[0]?.id, "phone-exact", "exact phone match keeps rank 0");

// --- single-character product ranking keeps exact SKU/barcode priority ---
const products = buildProductSuggestionData(
  [
    { id: "brand", name: "Dawn Soap", brand_id: "b1", default_selling_price: 50 },
    { id: "wordp", name: "Super Fine Flour", default_selling_price: 60 },
    { id: "code", name: "Sugar", sku: "F-001", default_selling_price: 70 },
    { id: "prefix", name: "Flour", default_selling_price: 80 },
  ],
  brandNames,
  categoryNames,
  price,
);
const rankedProducts = rankSearchResults(products.items, "f", (item) => products.rankFields.get(item.id) ?? { name: item.label });
assert.deepEqual(
  rankedProducts.map((i) => i.id),
  ["prefix", "code", "wordp", "brand"],
  "f ranks: name prefix, code prefix, word prefix, brand-only",
);

// --- empty query returns the input untouched (callers decide what empty shows) ---
assert.equal(rankSearchResults(products.items, "   ", (item) => products.rankFields.get(item.id) ?? { name: item.label }).length, 4, "empty query returns all items");

// --- popover height clamp: never larger than the available space, no enforced minimum ---
assert.equal(clampPopoverHeight(400), 256, "ample space uses the preferred max height");
assert.equal(clampPopoverHeight(200), 200, "tight space shrinks the popover");
assert.equal(clampPopoverHeight(80), 80, "cramped space (phone keyboard) keeps the popover inside the viewport");
assert.equal(clampPopoverHeight(0), 0, "no space clamps to zero instead of enforcing a minimum");

// --- selected record identity: duplicate names pin the chosen ID first ---
const twins = [
  { id: "p-twin-a", name: "Twin Widget" },
  { id: "p-twin-b", name: "Twin Widget" },
  { id: "p-other", name: "Other Thing" },
];
const pinned = pinSelectedFirst(twins, "p-twin-b", (t) => t.id);
assert.deepEqual(pinned.map((t) => t.id), ["p-twin-b", "p-twin-a", "p-other"], "chosen duplicate moves first, others keep order");
assert.deepEqual(pinSelectedFirst(twins, null, (t) => t.id).map((t) => t.id), ["p-twin-a", "p-twin-b", "p-other"], "no selection keeps the ranked order");
assert.deepEqual(pinSelectedFirst(twins, "p-twin-a", (t) => t.id).map((t) => t.id), ["p-twin-a", "p-twin-b", "p-other"], "already-first selection is a no-op");
assert.deepEqual(pinSelectedFirst(twins, "p-gone", (t) => t.id).map((t) => t.id), ["p-twin-a", "p-twin-b", "p-other"], "unknown id keeps the ranked order");

// --- name-prefix matches rank ahead of incidental name substrings ---
const tiered = buildProductSuggestionData(
  [
    { id: "substring", name: "Cart Wheels", default_selling_price: 10 },
    { id: "prefix", name: "Artisan Bread", default_selling_price: 20 },
    { id: "wordprefix", name: "Fine Art Supplies", default_selling_price: 30 },
  ],
  brandNames,
  categoryNames,
  price,
);
const rankedTier = rankSearchResults(tiered.items, "art", (item) => tiered.rankFields.get(item.id) ?? { name: item.label });
assert.deepEqual(
  rankedTier.map((i) => i.id),
  ["prefix", "wordprefix", "substring"],
  "name prefix > word prefix > incidental name substring",
);

console.log("test:global-search-suggestions — all assertions passed");
