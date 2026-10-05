// Browser lab harness for the global search suggestion panels.
// Bundled by scripts/browser-global-search-suggestions.mjs and driven with
// Playwright against synthetic fixtures (5,000 products, 12 customers).
// Not part of the shipped app.
"use client";

import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchSuggestField } from "@/components/search/SearchSuggestField";
import { buildCustomerSuggestionData, buildProductSuggestionData } from "@/components/search/suggestion-items";
import { ProductSearchSelect } from "@/components/invoices/ProductSearchSelect";
import { Header } from "@/components/dashboard/Header";
import { rankSearchResults } from "@/lib/products/search-rank";

interface FixtureProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand_id: string | null;
  category_id: string | null;
  default_selling_price: number;
}

function buildProducts(): FixtureProduct[] {
  const list: FixtureProduct[] = [
    { id: "p-fortune", name: "Fortune Biscuits", sku: "FTB-100", barcode: null, brand_id: null, category_id: null, default_selling_price: 250 },
    { id: "p-fresh", name: "Fresh Milk", sku: "FM-200", barcode: null, brand_id: null, category_id: null, default_selling_price: 120 },
    { id: "p-wordprefix", name: "Super Fresh Juice", sku: null, barcode: null, brand_id: null, category_id: null, default_selling_price: 90 },
    { id: "p-sku-only", name: "Zebra Cakes", sku: "FZ-999", barcode: null, brand_id: null, category_id: null, default_selling_price: 60 },
    { id: "p-barcode-only", name: "Yogurt Cup", sku: null, barcode: "8961000999999", brand_id: null, category_id: null, default_selling_price: 45 },
    { id: "p-brand-only", name: "Plain Water", sku: null, barcode: null, brand_id: "b-freshco", category_id: null, default_selling_price: 30 },
    { id: "p-xss", name: "Evil <img src=x onerror=alert(1)>", sku: null, barcode: null, brand_id: null, category_id: null, default_selling_price: 10 },
  ];
  for (let i = 0; i < 4993; i++) {
    list.push({
      id: `p-bulk-${i}`,
      name: `Bulk Item ${i}`,
      sku: `BLK-${String(i).padStart(5, "0")}`,
      barcode: null,
      brand_id: null,
      category_id: null,
      default_selling_price: 5 + (i % 100),
    });
  }
  // Twenty "Fresh Bulk" products so single-character queries exceed the
  // panel cap and exercise truncation.
  for (let i = 0; i < 20; i++) {
    list.push({
      id: `p-fbulk-${i}`,
      name: `Fresh Bulk ${i}`,
      sku: `FB-${String(i).padStart(4, "0")}`,
      barcode: null,
      brand_id: null,
      category_id: null,
      default_selling_price: 10 + i,
    });
  }
  return list;
}

const CUSTOMERS = [
  { id: "c-fahad", customer_name: "Fahad", shop_name: "Fresh Mart", organization_name: null, contact_person: "Ali", phone: "03001112222", whatsapp: null, city: "Lahore", area: null, address: null, shipping_address: null, customer_type: "retail" },
  { id: "c-farhan", customer_name: "Farhan", shop_name: "Farhan Traders", organization_name: null, contact_person: null, phone: "03003334444", whatsapp: null, city: "Karachi", area: null, address: null, shipping_address: null, customer_type: "wholesale" },
  { id: "c-phone", customer_name: "Zubair", shop_name: "Zed Store", organization_name: null, contact_person: null, phone: "03001234567", whatsapp: null, city: "Islamabad", area: null, address: null, shipping_address: null, customer_type: "retail" },
  { id: "c-word", customer_name: "Ahmed Faraz", shop_name: null, organization_name: null, contact_person: null, phone: null, whatsapp: null, city: "Multan", area: null, address: null, shipping_address: null, customer_type: null },
  { id: "c-city", customer_name: "Bilal", shop_name: null, organization_name: null, contact_person: null, phone: null, whatsapp: null, city: "Faisalabad", area: null, address: null, shipping_address: null, customer_type: null },
  { id: "c-a1", customer_name: "Adeel", shop_name: "Adeel Store", organization_name: null, contact_person: null, phone: "03005556666", whatsapp: null, city: "Lahore", area: null, address: null, shipping_address: null, customer_type: null },
  { id: "c-a2", customer_name: "Usman", shop_name: "Usman Mart", organization_name: null, contact_person: null, phone: "03007778888", whatsapp: null, city: "Karachi", area: null, address: null, shipping_address: null, customer_type: null },
];

const NAV_SECTIONS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "products", label: "Products" },
  { id: "customers", label: "Customers" },
  { id: "sales", label: "Sales" },
];

const fmtPrice = (n: number) => `Rs ${n.toFixed(2)}`;

declare global {
  interface Window {
    __labReady?: boolean;
    __labNav?: { section: string; prefill?: string } | null;
  }
}

export function SuggestLab() {
  const products = useMemo(() => buildProducts(), []);
  const brandNames = useMemo(() => new Map<string, string>([["b-freshco", "FreshCo"]]), []);
  const categoryNames = useMemo(() => new Map<string, string>(), []);
  const productData = useMemo(
    () => buildProductSuggestionData(products, brandNames, categoryNames, fmtPrice),
    [products, brandNames, categoryNames],
  );

  // --- Products section simulation: filter text + ranked list below ---
  const [productQuery, setProductQuery] = useState("");
  const [rerenderCount, setRerenderCount] = useState(0);
  const topRankedIds = useMemo(
    () =>
      rankSearchResults(products, productQuery, (p) => productData.rankFields.get(p.id) ?? { name: p.name })
        .slice(0, 3)
        .map((p) => p.id),
    [products, productQuery, productData],
  );

  // --- Customers section simulation ---
  const [customerQuery, setCustomerQuery] = useState("");
  const customerData = useMemo(() => buildCustomerSuggestionData(CUSTOMERS), []);

  // --- POS-style selector: id + price readout after selection ---
  const [posSelected, setPosSelected] = useState("");
  const posOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: [p.name, p.sku, p.barcode].filter(Boolean).join(" — ") })),
    [products],
  );
  const posRankFields = useMemo(() => {
    const map = new Map<string, { name: string; sku: string | null; barcode: string | null }>();
    for (const p of products) map.set(p.id, { name: p.name, sku: p.sku, barcode: p.barcode });
    return map;
  }, [products]);
  const posSelectedProduct = products.find((p) => p.id === posSelected);

  // --- Header global search ---
  const headerSearchChange = (query: string) => {
    const q = query.trim().replace(/&/g, " and ");
    if (!q) return [];
    const sections = rankSearchResults(
      NAV_SECTIONS.map((item) => ({ id: `section-${item.id}`, label: item.label, section: item.id, type: "action" as const })),
      q,
      (s) => ({ name: s.label }),
    ).slice(0, 5);
    const prods = rankSearchResults(products, q, (p) => productData.rankFields.get(p.id) ?? { name: p.name })
      .slice(0, 3)
      .map((p) => ({
        id: `product-${p.id}`,
        label: p.name,
        detail: [p.sku, fmtPrice(p.default_selling_price)].filter(Boolean).join(" · "),
        section: "products",
        type: "product" as const,
        prefill: p.name,
      }));
    return [...sections, ...prods];
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-4">
      <section data-testid="lab-products">
        <h2 className="mb-2 text-lg font-semibold">Products section field</h2>
        <div className="flex items-center gap-2">
          <SearchSuggestField
            label="Lab products search"
            placeholder="Search by name, SKU, barcode, brand, category..."
            value={productQuery}
            onChange={setProductQuery}
            items={productData.items}
            rankedFields={productData.rankFields}
            inputClassName="w-full rounded border border-border px-3 py-2 focus:border-ring focus:outline-none"
          />
          <button type="button" data-testid="lab-products-clear" onClick={() => setProductQuery("")} className="rounded border px-3 py-2">
            Clear
          </button>
          <button type="button" data-testid="lab-products-rerender" onClick={() => setRerenderCount((c) => c + 1)} className="rounded border px-3 py-2">
            Rerender {rerenderCount}
          </button>
        </div>
        <p data-testid="lab-products-top" className="mt-2 text-sm text-muted-foreground">
          top: {topRankedIds.join(",") || "none"}
        </p>
      </section>

      <section data-testid="lab-products-loading">
        <h2 className="mb-2 text-lg font-semibold">Loading state</h2>
        <SearchSuggestField
          label="Lab products loading"
          value={productQuery}
          onChange={setProductQuery}
          items={[]}
          status="loading"
        />
      </section>

      <section data-testid="lab-products-error">
        <h2 className="mb-2 text-lg font-semibold">Error state (stale results)</h2>
        <SearchSuggestField
          label="Lab products error"
          value={productQuery}
          onChange={setProductQuery}
          items={productData.items.slice(0, 50)}
          rankedFields={productData.rankFields}
          status="error"
        />
      </section>

      <section data-testid="lab-customers">
        <h2 className="mb-2 text-lg font-semibold">Customers section field</h2>
        <SearchSuggestField
          label="Lab customers search"
          placeholder="Search by name, shop, or phone"
          value={customerQuery}
          onChange={setCustomerQuery}
          items={customerData.items}
          rankedFields={customerData.rankFields}
        />
        <p data-testid="lab-customers-query" className="mt-2 text-sm text-muted-foreground">
          query: {customerQuery || "none"}
        </p>
      </section>

      <section data-testid="lab-pos">
        <h2 className="mb-2 text-lg font-semibold">POS product selector</h2>
        <ProductSearchSelect
          label="Lab POS product"
          value={posSelected}
          onChange={setPosSelected}
          products={posOptions}
          rankedFields={posRankFields}
        />
        <p data-testid="lab-pos-selected" className="mt-2 text-sm text-muted-foreground">
          selected: {posSelected || "none"} price: {posSelectedProduct ? fmtPrice(posSelectedProduct.default_selling_price) : "none"}
        </p>
      </section>

      <section data-testid="lab-header">
        <h2 className="mb-2 text-lg font-semibold">Header global search</h2>
        <Header
          userName="Lab User"
          organizationName="Lab Org"
          onSearchChange={headerSearchChange}
          onSearchSubmit={(section, prefill) => {
            window.__labNav = { section, prefill };
          }}
        />
        <p data-testid="lab-header-nav" className="mt-2 text-sm text-muted-foreground">
          nav: {window.__labNav ? `${window.__labNav.section}|${window.__labNav.prefill ?? ""}` : "none"}
        </p>
      </section>
    </div>
  );
}

// --- mount ---
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<SuggestLab />);
  window.__labReady = true;
}
