// Unit tests for the shared product-search ranking contract.
// Run with: npm run test:product-search
import assert from "node:assert/strict";
import {
  highlightSearchMatches,
  normalizeSearchText,
  rankProductMatch,
  rankSearchResults,
  type SearchRankFields,
} from "../src/lib/products/search-rank";

const fields = (overrides: Partial<SearchRankFields> & { name: string }): SearchRankFields => ({
  sku: null, barcode: null, brandName: null, categoryName: null, ...overrides,
});
const names = <T extends { name: string }>(items: T[]): string[] => items.map((i) => i.name);

// --- normalization ---
assert.equal(normalizeSearchText("  HEY\tShampoo\n"), "hey shampoo", "case and whitespace are normalized");

// --- rank contract, one product at a time ---
const q = (s: string) => normalizeSearchText(s);
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo", sku: "HEY-002" }), q("HEY-002")), 0, "exact SKU match is rank 0");
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo", barcode: "8961000100028" }), q("8961000100028")), 0, "exact barcode match is rank 0");
assert.equal(rankProductMatch(fields({ name: "Hey", sku: "HEY-001" }), q("hey")), 1, "exact name match is rank 1");
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo" }), q("hey")), 2, "name starts-with is rank 2");
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo", sku: "HEY-002" }), q("hey-00")), 3, "code prefix is rank 3");
assert.equal(rankProductMatch(fields({ name: "Premium Hey Soap" }), q("hey")), 4, "word starts-with is rank 4");
assert.equal(rankProductMatch(fields({ name: "Premium Soap", sku: "PRM-HEY-9" }), q("hey-9")), 5, "code substring is rank 5");
assert.equal(rankProductMatch(fields({ name: "Whey Protein" }), q("hey")), 6, "single-word query is an all-words-in-name match (rank 6)");
assert.equal(rankProductMatch(fields({ name: "Heyday Shampoo 250ml" }), q("shampoo 250")), 4, "every query word present is rank 4");
assert.equal(rankProductMatch(fields({ name: "They Detergent" }), q("hey")), 6, "mid-word substring with all words present is rank 6");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", brandName: "Hey Foods" }), q("hey")), 7, "brand-only match is the lowest rank");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", categoryName: "Hey Care" }), q("hey")), 7, "category-only match is the lowest rank");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", brandName: "Dawn" }), q("hey")), null, "unrelated products are excluded");
assert.equal(rankProductMatch(fields({ name: "Hey" }), q("hye")), null, "no fuzzy matching: transposed query does not match");
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo" }), q("")), null, "empty query matches nothing");

// --- partial SKU/barcode matching when the name does not contain the code ---
assert.equal(rankProductMatch(fields({ name: "Premium Soap", sku: "HEY-001" }), q("HEY-001")), 0, "exact code keeps highest priority even when the name lacks the code");
assert.equal(rankProductMatch(fields({ name: "Premium Soap", sku: "HEY-001" }), q("hey-00")), 3, "code prefix matches when the name does not contain the code");
assert.equal(rankProductMatch(fields({ name: "Premium Soap", sku: "HEY-001" }), q("00")), 5, "code substring matches when the name does not contain the code");
assert.equal(rankProductMatch(fields({ name: "Premium Soap", barcode: "8961000100011" }), q("0011")), 5, "barcode substring matches when the name does not contain the code");
assert.equal(rankProductMatch(fields({ name: "Premium Soap", sku: "HEY-001" }), q("hey-0")), 3, "code prefix beats a mid-word name substring: name ranks keep their order");
assert.deepEqual(
  names(rankSearchResults(
    [
      fields({ name: "Hey", sku: "HEY-001" }),
      fields({ name: "Hey Shampoo", sku: "HEY-002" }),
      fields({ name: "Code Only Soap", sku: "HEY-999" }),
      fields({ name: "Premium Hey Soap", sku: "PRM-HEY-9" }),
    ],
    "Hey",
    (p) => p,
  )),
  ["Hey", "Hey Shampoo", "Code Only Soap", "Premium Hey Soap"],
  "exact name (1) > name prefix (2) > code prefix (3) > word prefix (4) for one query",
);

// --- multiword searches combining name, brand, and SKU (legacy combined-label parity) ---
assert.equal(rankProductMatch(fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), q("sufi 5l")), 4, "name word + SKU substring both match across fields");
assert.equal(rankProductMatch(fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), q("oil suf-oil-5l")), 0, "name word + exact SKU ranks at the top");
assert.equal(rankProductMatch(fields({ name: "Hey", sku: "HEY-001" }), q("hey hey-001")), 0, "exact code word in a multiword query keeps rank 0");
assert.equal(rankProductMatch(fields({ name: "Cooking Oil", brandName: "Sufi" }), q("sufi oil")), 4, "brand word + name word match across fields");
assert.equal(rankProductMatch(fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), q("sufi xyz")), null, "a query word matching no field excludes the product");
assert.deepEqual(
  names(rankSearchResults(
    [fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), fields({ name: "Dawn Soap", sku: "DAWN-1" })],
    "sufi 5l",
    (p) => p,
  )),
  ["Sufi Cooking Oil"],
  "multiword name+SKU search finds the product the old combined label matched",
);

// --- the reported "Hey" example, end to end ---
const heyCatalog = [
  fields({ name: "Whey Protein", sku: "WHEY-500" }),
  fields({ name: "Premium Hey Soap", sku: "PRM-HEY-9" }),
  fields({ name: "They Detergent", sku: "THEY-1" }),
  fields({ name: "Hey Shampoo", sku: "HEY-002" }),
  fields({ name: "Hey", sku: "HEY-001" }),
  fields({ name: "Dawn Detergent", sku: "DAWN-1" }),
];
assert.deepEqual(
  names(rankSearchResults(heyCatalog, "Hey", (p) => p)),
  ["Hey", "Hey Shampoo", "Premium Hey Soap", "They Detergent", "Whey Protein"],
  "Hey ranks before Hey Shampoo before Premium Hey Soap before Whey Protein; unrelated excluded",
);

// --- determinism and variants ---
const dupes = [
  { ...fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), id: "p-oil-a" },
  { ...fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-1L" }), id: "p-oil-b" },
  { ...fields({ name: "Sufi Cooking Oil", sku: "SUF-OIL-5L" }), id: "p-oil-c" },
];
const rankedDupes = rankSearchResults(dupes, "sufi", (p) => p);
assert.equal(rankedDupes.length, 3, "duplicate names are preserved as distinct variants");
assert.deepEqual(
  rankedDupes.map((p) => p.id),
  ["p-oil-a", "p-oil-b", "p-oil-c"],
  "within a rank, ordering is deterministic by name then id",
);
assert.deepEqual(
  names(rankSearchResults(heyCatalog, "  hEY ", (p) => p)),
  names(rankSearchResults(heyCatalog, "Hey", (p) => p)),
  "surrounding whitespace and case do not change ranking",
);

// --- punctuation ---
assert.equal(
  rankProductMatch(fields({ name: "Shan's Biryani Mix (50g) - Special" }), q("biryani")),
  4,
  "punctuation does not break word-prefix matching",
);

// --- empty query returns input untouched ---
assert.deepEqual(
  rankSearchResults(heyCatalog, "   ", (p) => p),
  heyCatalog,
  "empty query preserves the caller's ordering",
);

// --- safe highlighting ---
const segments = highlightSearchMatches("Premium Hey Soap", "hey");
assert.deepEqual(
  segments,
  [{ text: "Premium ", match: false }, { text: "Hey", match: true }, { text: " Soap", match: false }],
  "matched text is split into segments without HTML",
);
assert.deepEqual(
  segments.map((s) => s.text).join(""),
  "Premium Hey Soap",
  "segments round-trip to the original text",
);
const injection = highlightSearchMatches("Athey's <img src=x> (Hey) Soap", "hey");
assert.equal(
  injection.map((s) => s.text).join(""),
  "Athey's <img src=x> (Hey) Soap",
  "angle brackets survive as literal segment text; callers render segments as plain strings so React escapes them",
);
assert.ok(
  injection.some((s) => !s.match && s.text.includes("<img src=x>")),
  "HTML-looking content stays inside a non-highlighted plain-text segment",
);
const multi = highlightSearchMatches("Hey Shampoo 250ml", "shampoo 250");
assert.equal(multi.filter((s) => s.match).length, 2, "each query word is highlighted");
assert.deepEqual(highlightSearchMatches("Hey", ""), [{ text: "Hey", match: false }], "empty query highlights nothing");
assert.equal(highlightSearchMatches("Athey's (Hey) Soap", "hey").filter((s) => s.match).length, 2, "regex characters in names are safe");

console.log("Product search ranking: contract ranks, determinism, variants, punctuation, and safe highlighting verified.");
