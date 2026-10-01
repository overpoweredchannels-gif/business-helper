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
assert.equal(rankProductMatch(fields({ name: "Premium Hey Soap" }), q("hey")), 3, "word starts-with is rank 3");
assert.equal(rankProductMatch(fields({ name: "Whey Protein" }), q("hey")), 4, "single-word query is an all-words match (rank 4)");
assert.equal(rankProductMatch(fields({ name: "Heyday Shampoo 250ml" }), q("shampoo 250")), 4, "every query word present is rank 4");
assert.equal(rankProductMatch(fields({ name: "They Detergent" }), q("hey")), 4, "mid-word substring with all words present is rank 4");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", brandName: "Hey Foods" }), q("hey")), 5, "brand-only match is the lowest rank");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", categoryName: "Hey Care" }), q("hey")), 5, "category-only match is the lowest rank");
assert.equal(rankProductMatch(fields({ name: "Dawn Soap", brandName: "Dawn" }), q("hey")), null, "unrelated products are excluded");
assert.equal(rankProductMatch(fields({ name: "Hey" }), q("hye")), null, "no fuzzy matching: transposed query does not match");
assert.equal(rankProductMatch(fields({ name: "Hey Shampoo" }), q("")), null, "empty query matches nothing");

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
  3,
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
