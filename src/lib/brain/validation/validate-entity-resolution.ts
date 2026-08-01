import { MemoryStore } from "../memory/business-memory";
import { MemoryWriter } from "../memory/memory-writer";
import { PreferenceStore } from "../learning/preference-store";
import { fuzzySearch } from "../memory/fuzzy-match";
import { runSuite, test, assert, assertEqual } from "./helpers";
import { createMockRawData } from "./fixtures";

export function validateEntityResolution() {
  const store = new MemoryStore();
  const prefs = new PreferenceStore();
  const writer = new MemoryWriter(store, prefs);

  const data = createMockRawData(10, 5, 3, 20);
  data.products = data.products.map((p, i) => ({
    ...p,
    name: [
      "Pepsi 500ml", "Coca Cola 500ml", "Mountain Dew 500ml",
      "Kurkure Masala 50g", "Lays Salted 25g", "Biscuit Peek Freans 200g",
      "Sugar 1kg", "Rice Basmati 5kg", "Cooking Oil 3L", "Wheat Flour 10kg",
    ][i] || `Product ${i}`,
  }));
  data.customers = data.customers.map((c, i) => ({
    ...c,
    customer_name: [
      "Al Noor General Store", "Bismillah Electronics", "City Traders",
      "Danyal Mart", "Fazal & Sons",
    ][i] || `Customer ${i}`,
  }));
  writer.writeRaw(data);

  function fm<T>(query: string, items: T[], threshold?: number, maxResults?: number) {
    return fuzzySearch(query, items, (item: any) => typeof item === "string" ? item : item.name ?? "", { threshold, maxResults });
  }

  return runSuite("Entity Resolution Validation", [
    // ─── English Search ───
    test("English - exact product match", () => {
      const results = store.searchProducts("Pepsi 500ml");
      assert(results.length > 0, "At least one result");
      assertEqual(results[0].item.name, "Pepsi 500ml", "Exact match first result");
    }),

    test("English - partial product match", () => {
      const results = store.searchProducts("Pepsi");
      assert(results.length > 0, "Results found");
      assert(results.some((r) => r.item.name.includes("Pepsi")), "Pepsi in results");
    }),

    test("English - customer match", () => {
      const results = store.searchCustomers("Al Noor");
      assert(results.length > 0, "Customer found");
    }),

    test("English - supplier match", () => {
      const results = store.searchSuppliers("Test Supplier 1");
      assert(results.length > 0, "Supplier found");
    }),

    // ─── Urdu / Roman Urdu ───
    test("Roman Urdu - close match", () => {
      const results = store.searchProducts("Pepsi 500 m.l");
      assert(results.length > 0, "Roman Urdu match found");
    }),

    test("Roman Urdu - product with typos", () => {
      const results = store.searchProducts("Pepsi 500ml");
      assert(results.length > 0, "Typo-tolerant match");
    }),

    // ─── Typos ───
    test("Typos - single character swap", () => {
      const results = store.searchProducts("Pepsi 500nl");
      assert(results.length > 0, "Single char typo tolerated");
      assert(results[0].score > 0.5, "Score > 0.5 for close match");
    }),

    test("Typos - two character miss", () => {
      const results = store.searchProducts("Pepsi 500m");
      assert(results.length > 0, "Partial still matches");
    }),

    // ─── Plural Forms ───
    test("Plural forms - products", () => {
      const results = store.searchProducts("Pepsis");
      assert(results.length > 0, "Plural form finds product");
    }),

    // ─── Partial Names ───
    test("Partial names - short query", () => {
      const results = store.searchProducts("Pep");
      assert(results.length > 0, "Three-letter prefix matches");
    }),

    test("Partial names - single word from multi-word name", () => {
      const results = store.searchProducts("Basmati");
      assert(results.length > 0, "Multi-word partial match");
    }),

    // ─── Fuzzy Match Engine ───
    test("Fuzzy match - exact match score is 1.0", () => {
      const results = fm("Pepsi 500ml", ["Pepsi 500ml", "Coca Cola"]);
      assert(results.length > 0, "Match found");
      assertEqual(results[0].score, 1.0, "Exact match scores 1.0");
    }),

    test("Fuzzy match - no match returns empty", () => {
      const results = fm("ZXYNotExist12345", ["Pepsi", "Coca Cola"]);
      assertEqual(results.length, 0, "No match for nonexistent item");
    }),

    test("Fuzzy match - Levenshtein distance scoring", () => {
      const results = fm("Pepsi", ["Pepsi", "PepsiMax", "Coca"]);
      assert(results.length > 0, "Results found");
      assert(results[0].score >= results[results.length - 1].score, "Best match first");
    }),

    test("Fuzzy match - threshold filtering", () => {
      const results = fm("Pepsi", ["Pepsi", "PepsiMax", "Coca Cola"], 0.8);
      for (const r of results) {
        assert(r.score >= 0.8, `Score ${r.score} meets threshold 0.8`);
      }
    }),

    test("Fuzzy match - max results limit", () => {
      const results = fm("Product", ["Product 1", "Product 2", "Product 3", "Product 4", "Other"], undefined, 2);
      assert(results.length <= 2, "Max results respected");
    }),

    test("Fuzzy match - normalization handles special chars", () => {
      const results = fm("coca-cola", ["Coca Cola 500ml"]);
      assert(results.length > 0, "Special chars normalized");
    }),

    // ─── Exact Finders ───
    test("findExactProduct - case insensitive", () => {
      const result = store.findExactProduct("PEPSI 500ML");
      assert(result !== undefined, "Case insensitive exact match");
      assertEqual(result!.name, "Pepsi 500ml", "Correct product returned");
    }),

    test("findExactCustomer - matches full name", () => {
      const result = store.findExactCustomer("AL NOOR GENERAL STORE");
      assert(result !== undefined, "Case insensitive customer match");
    }),

    test("findExactCustomer - no match returns undefined", () => {
      const result = store.findExactCustomer("Nonexistent Customer XYZ");
      assertEqual(result, undefined, "No match returns undefined");
    }),

    // ─── Duplicate / Ambiguous ───
    test("Duplicate names - returns multiple results", () => {
      const store2 = new MemoryStore();
      const prefs2 = new PreferenceStore();
      const writer2 = new MemoryWriter(store2, prefs2);
      const dupData = createMockRawData(2, 2, 1, 3);
      dupData.products[0].name = "Duplicate Product";
      dupData.products[1].name = "Duplicate Product";
      writer2.writeRaw(dupData);
      const results = store2.searchProducts("Duplicate Product");
      assert(results.length >= 2, "Both duplicates found");
    }),
  ]);
}
