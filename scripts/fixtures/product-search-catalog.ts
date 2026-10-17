// Shared synthetic catalog for product-search reproduction and tests.
// Realistic FMCG-style names with variants, sizes, packs, duplicates,
// punctuation, SKUs and barcodes. Deterministic via a small LCG.
export interface SynthProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  unit_type: string | null;
  subunit_type?: string | null;
  units_per_pack?: number | null;
  current_stock?: number | null;
  default_selling_price?: number | null;
  is_active?: boolean | null;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const BRANDS = ["Hey", "Dawn", "Sufi", "Kashmir", "Mezan", "Dalda", "Shan", "National", "Tapal", "Lipton", "Nestle", "Unilever"];
const CATEGORIES = ["Cooking Oil", "Ghee", "Sugar", "Flour", "Rice", "Pulses", "Spices", "Beverages", "Dairy", "Soap"];
const BASES = ["Cooking Oil", "Banaspati Ghee", "Sugar", "Wheat Flour", "Basmati Rice", "Red Lentils", "Chana Dal", "Turmeric Powder", "Red Chili", "Tea", "Milk Powder", "Bathing Soap", "Detergent", "Shampoo", "Toothpaste", "Biscuits", "Noodles", "Salt", "Vinegar", "Ketchup"];
const SIZES = ["250ml", "500ml", "1L", "2L", "5L", "100g", "250g", "500g", "1kg", "5kg", "10kg", "12pc", "24pc"];
const UNITS: Array<[string, string | null, number | null]> = [
  ["Bottle", "ml", null], ["Pack", "Piece", 12], ["Carton", "Piece", 24], ["Bag", null, null], ["Tin", null, null],
];

export function mkCatalog(count: number): SynthProduct[] {
  const rand = lcg(20261002);
  const products: SynthProduct[] = [
    // The reported family, plus near-misses.
    { id: "p-hey-exact", name: "Hey", sku: "HEY-001", barcode: "8961000100011", brand: "Hey", category: "Beverages", unit_type: "Bottle", current_stock: 40, default_selling_price: 120, is_active: true },
    { id: "p-hey-shampoo", name: "Hey Shampoo", sku: "HEY-002", barcode: "8961000100028", brand: "Hey", category: "Soap", unit_type: "Bottle", current_stock: 25, default_selling_price: 350, is_active: true },
    { id: "p-hey-shampoo-250", name: "Hey Shampoo 250ml", sku: "HEY-002-S", barcode: null, brand: "Hey", category: "Soap", unit_type: "Bottle", subunit_type: "ml", units_per_pack: 250, current_stock: 60, default_selling_price: 180, is_active: true },
    { id: "p-premium-hey", name: "Premium Hey Soap", sku: "PRM-HEY-9", barcode: "8961000190099", brand: "Dawn", category: "Soap", unit_type: "Pack", subunit_type: "Piece", units_per_pack: 3, current_stock: 100, default_selling_price: 220, is_active: true },
    { id: "p-whey", name: "Whey Protein", sku: "WHEY-500", barcode: "8961000500001", brand: "Nestle", category: "Dairy", unit_type: "Tin", current_stock: 12, default_selling_price: 4500, is_active: true },
    { id: "p-they", name: "They Detergent", sku: "THEY-1", barcode: null, brand: "Unilever", category: "Soap", unit_type: "Pack", current_stock: 200, default_selling_price: 95, is_active: true },
    // Duplicate names with different variants (must stay distinguishable).
    { id: "p-oil-a", name: "Sufi Cooking Oil", sku: "SUF-OIL-5L", barcode: "8961001000055", brand: "Sufi", category: "Cooking Oil", unit_type: "Tin", current_stock: 30, default_selling_price: 2850, is_active: true },
    { id: "p-oil-b", name: "Sufi Cooking Oil", sku: "SUF-OIL-1L", barcode: "8961001000017", brand: "Sufi", category: "Cooking Oil", unit_type: "Bottle", current_stock: 80, default_selling_price: 620, is_active: true },
    // Punctuation-heavy names.
    { id: "p-punct", name: "Shan's Biryani Mix (50g) - Special", sku: "SHN-BIR-50", barcode: null, brand: "Shan", category: "Spices", unit_type: "Pack", current_stock: 150, default_selling_price: 85, is_active: true },
  ];
  for (let i = products.length; i < count; i++) {
    const brand = BRANDS[Math.floor(rand() * BRANDS.length)];
    const base = BASES[Math.floor(rand() * BASES.length)];
    const size = SIZES[Math.floor(rand() * SIZES.length)];
    const [unit, subunit, perPack] = UNITS[Math.floor(rand() * UNITS.length)];
    // Names starting with "A"/digits sort alphabetically BEFORE "Hey", burying exact matches in the old ordering.
    const prefix = rand() < 0.4 ? "A" : rand() < 0.2 ? String(100 + Math.floor(rand() * 900)) : "";
    products.push({
      id: `p-fill-${i}`,
      name: `${prefix}${prefix ? " " : ""}${brand} ${base} ${size}`.trim(),
      sku: `SKU-${String(i).padStart(4, "0")}`,
      barcode: rand() < 0.7 ? `8961${String(100000000 + i).slice(0, 9)}` : null,
      brand, category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
      unit_type: unit, subunit_type: subunit, units_per_pack: perPack,
      current_stock: Math.floor(rand() * 500), default_selling_price: Math.floor(rand() * 5000) + 10,
      is_active: rand() < 0.95,
    });
  }
  // Old UI loads products ordered by name, then id.
  return products.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Exact copy of the CURRENT Products-page filter (src/app/page.tsx filteredProducts).
export function oldFilterProducts(products: SynthProduct[], search: string): SynthProduct[] {
  const query = search.trim().toLowerCase();
  if (!query) return products;
  return products.filter((p) =>
    p.name.toLowerCase().includes(query) ||
    (p.sku ?? "").toLowerCase().includes(query) ||
    (p.barcode ?? "").toLowerCase().includes(query) ||
    (p.brand ?? "").toLowerCase().includes(query) ||
    (p.category ?? "").toLowerCase().includes(query),
  );
}

// Exact copy of the CURRENT selector filter (ProductSearchSelect matches).
export function oldFilterLabels(items: Array<{ id: string; label: string }>, query: string): Array<{ id: string; label: string }> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => terms.every((term) => item.label.toLocaleLowerCase().includes(term)));
}
