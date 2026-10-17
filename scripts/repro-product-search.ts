// Reproduction of the reported product-search relevance problem.
// Mirrors the CURRENT Products-page filter in src/app/page.tsx (filteredProducts)
// and the POS/invoice selector filter in ProductSearchSelect, over a synthetic
// catalog of several thousand SKUs. Run with: npx tsx scripts/repro-product-search.ts
import { mkCatalog, oldFilterProducts, oldFilterLabels } from "./fixtures/product-search-catalog";

const catalog = mkCatalog(5000);
const queries = ["Hey", "hey", "  HEY  ", "shampoo", "whey protein", "SKU-0042", "nonexistent-xyz"];

for (const q of queries) {
  const results = oldFilterProducts(catalog, q);
  const top = results.slice(0, 6).map((p) => p.name);
  console.log(`\nquery=${JSON.stringify(q)} -> ${results.length} matches (catalog order, alphabetical)`);
  console.log("  top 6:", JSON.stringify(top));
}

// POS/invoice selector path: label-based all-terms substring filter.
const labels = catalog.map((p) => ({ id: p.id, label: [p.name, p.sku, p.barcode].filter(Boolean).join(" — ") }));
const sel = oldFilterLabels(labels, "Hey");
console.log(`\nselector query="Hey" -> ${sel.length} matches; top 4 labels:`);
for (const m of sel.slice(0, 4)) console.log("  -", m.label);

// Where does the exact product "Hey" land in the old ordering?
const idx = oldFilterProducts(catalog, "Hey").findIndex((p) => p.name === "Hey");
console.log(`\nExact product "Hey" is at position ${idx + 1} of ${oldFilterProducts(catalog, "Hey").length} old-order results for query "Hey".`);
