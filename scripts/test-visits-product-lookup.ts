import assert from "node:assert/strict";
import { rankSearchResults } from "../src/lib/products/search-rank";
import type { VisitProduct } from "../src/components/salesman/VisitProductLookup";

// The visits lookup re-ranks each API page client-side so exact SKU matches
// come before name matches, no matter which page (offset) the row came from.
function rankPage(rows: VisitProduct[], query: string) {
  return rankSearchResults(rows, query, (p) => ({ name: p.name, sku: p.sku ?? undefined }));
}

function row(id: string, name: string, sku?: string | null): VisitProduct {
  return { id, name, sku: sku ?? null, unit_type: "pcs", current_stock: 10, default_selling_price: 100 };
}

async function main() {
  // 1. Exact SKU match ranks first, even when it is not the first row returned.
  {
    const page = [
      row("p1", "Apple Juice 1L", "APL-J-1L"),
      row("p2", "Pineapple Cake", "PNA-CAKE"),
      row("p3", "Special SKU Item", "APL-J"),
    ];
    const ranked = rankPage(page, "APL-J");
    assert.equal(ranked[0].id, "p3", "exact SKU must rank first");
    console.log("✓ exact SKU ranks first on the page");
  }

  // 2. A product that only exists beyond offset 1000 ranks by relevance, not position.
  {
    const page = [
      row("p1201", "Zebra Widget 1200", "ZBW-1200"),
      row("p1199", "Widget Pro", "WGT-PRO"),
      row("p1205", "Widget 1200 Accessory", null),
    ];
    const ranked = rankPage(page, "ZBW-1200");
    assert.equal(ranked[0].id, "p1201", "exact SKU at deep offset must rank first");
    const ranked2 = rankPage(page, "widget 1200");
    // Both match every query word at the same rank; the deterministic
    // name-then-id tie-break orders "Widget 1200 Accessory" first.
    // "Widget Pro" matches no "1200" term and is excluded.
    assert.deepEqual(ranked2.map((r) => r.id), ["p1205", "p1201"]);
    console.log("✓ deep-offset rows rank by relevance, not by API position");
  }

  // 3. Name relevance ordering is preserved (exact name > prefix > word prefix).
  {
    const page = [
      row("a", "They Detergent"),
      row("b", "Hey Shampoo"),
      row("c", "Hey"),
    ];
    const ranked = rankPage(page, "Hey");
    assert.deepEqual(ranked.map((r) => r.id), ["c", "b", "a"]);
    console.log("✓ name relevance ordering preserved on API rows");
  }

  // 4. Rows without SKU are safe; non-matching rows are excluded.
  {
    const page = [row("a", "Plain Soap", null), row("b", "Other Item", "XYZ")];
    const ranked = rankPage(page, "soap");
    assert.deepEqual(ranked.map((r) => r.id), ["a"]);
    console.log("✓ null SKUs safe; non-matches excluded");
  }

  console.log("\nAll visits product lookup checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
