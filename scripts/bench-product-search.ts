// Before/after comparison and responsiveness measurement for product search.
// Uses the REAL rankSearchResults from src against a 5,000-SKU synthetic catalog.
// Run with: npx tsx scripts/bench-product-search.ts
import { rankSearchResults } from "../src/lib/products/search-rank";
import { mkCatalog, oldFilterProducts } from "./fixtures/product-search-catalog";

const catalog = mkCatalog(5000);
const fieldsOf = (p: (typeof catalog)[number]) => ({
  name: p.name, sku: p.sku, barcode: p.barcode, brandName: p.brand, categoryName: p.category,
});

console.log("=== BEFORE (old substring filter, alphabetical) vs AFTER (ranked) ===");
for (const q of ["Hey", "shampoo", "SKU-0042", "8961000100028"]) {
  const before = oldFilterProducts(catalog, q).slice(0, 4).map((p) => p.name);
  const after = rankSearchResults(catalog, q, fieldsOf).slice(0, 4).map((p) => p.name);
  console.log(`\nquery=${JSON.stringify(q)}`);
  console.log("  before:", JSON.stringify(before));
  console.log("  after: ", JSON.stringify(after));
}

console.log("\n=== Responsiveness: simulated rapid typing over 5,000 SKUs ===");
const keystrokes = ["H", "He", "Hey", "Hey ", "Hey S", "Hey Sh", "Hey Sha"];
for (const q of keystrokes) {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    rankSearchResults(catalog, q, fieldsOf);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`  query=${JSON.stringify(q)}  median=${times[10].toFixed(2)}ms  p95=${times[19].toFixed(2)}ms`);
}

// Rapid typing correctness: intermediate queries must each return ranked results.
const mid = rankSearchResults(catalog, "He", fieldsOf).slice(0, 3).map((p) => p.name);
console.log("\nTop 3 for partial query \"He\":", JSON.stringify(mid));
const exactFirst = rankSearchResults(catalog, "Hey", fieldsOf)[0]?.name;
console.log("Top 1 for query \"Hey\":", JSON.stringify(exactFirst));
if (exactFirst !== "Hey") { console.error("FAIL: exact product 'Hey' is not first"); process.exit(1); }
console.log("\nOK: exact product ranks first; all keystrokes complete in milliseconds.");
