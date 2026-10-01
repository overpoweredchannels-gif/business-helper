// Reproduction of the salesman visits 1,000-product discoverability limit.
//
// Mirrors the client logic in src/app/salesman/visits/[id]/page.tsx:
//   loadProducts: GET /api/products/list?limit=1000 (no offset, no search)
//   selector: products.filter(name/sku includes query).slice(0, 15)
// The API route (src/app/api/products/list/route.ts) orders by name ascending
// and caps limit at 1000, so products sorting past row 1,000 never reach the client.
// Run with: npx tsx scripts/repro-visits-product-limit.ts
import { mkCatalog } from "./fixtures/product-search-catalog";

const CATALOG_SIZE = 1500;
const LIMIT = 1000;
const catalog = mkCatalog(CATALOG_SIZE);
// mkCatalog already returns name-ascending order, like the API's .order("name").
const loaded = catalog.slice(0, LIMIT); // what the client fetches: first 1,000 only

// A product that exists in the catalog but sorts beyond the first 1,000 rows.
const hidden = catalog[LIMIT + 250];
console.log(`catalog=${catalog.length} products; client loads first ${LIMIT} (name-ascending, no offset/search)`);
console.log(`hidden product: ${JSON.stringify(hidden.name)} at catalog position ${LIMIT + 251}`);

const query = hidden.name.split(" ").slice(0, 2).join(" ");
const clientResults = loaded
  .filter((p) => (p.name + " " + (p.sku ?? "")).toLowerCase().includes(query.toLowerCase()))
  .slice(0, 15);

console.log(`query=${JSON.stringify(query)} -> client finds ${clientResults.length} result(s)`);
console.log(`server-side search candidates for the same query in the FULL catalog:`,
  catalog.filter((p) => (p.name + " " + (p.sku ?? "")).toLowerCase().includes(query.toLowerCase())).length);

if (!clientResults.some((p) => p.id === hidden.id)) {
  console.log("REPRODUCED: the product exists in the catalog but is undiscoverable in the visits selector.");
  process.exit(2);
} else {
  console.log("OK: product is discoverable.");
}
