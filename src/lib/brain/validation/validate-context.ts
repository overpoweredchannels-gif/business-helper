import { MemoryStore } from "../memory/business-memory";
import { MemoryWriter } from "../memory/memory-writer";
import { PreferenceStore } from "../learning/preference-store";
import { ContextRetriever } from "../context/context-retriever";
import { runSuite, test, assert, assertEqual } from "./helpers";
import { createMockRawData } from "./fixtures";

export function validateContext() {
  const store = new MemoryStore();
  const prefs = new PreferenceStore();
  const writer = new MemoryWriter(store, prefs);
  writer.writeRaw(createMockRawData(8, 5, 3, 25));
  const retriever = new ContextRetriever(store);

  return runSuite("Context Validation", [
    test("Full context contains business summary", () => {
      const ctx = retriever.getFullContext();
      assert(ctx !== null, "Full context returned");
      assert(ctx.businessSummary.length > 0, "Business summary present");
      assert(ctx.businessSummary.includes("Test Business"), "Org name in summary");
      assert(ctx.businessSummary.includes("PKR"), "Currency format in summary");
    }),

    test("Full context contains health score", () => {
      const ctx = retriever.getFullContext();
      assert(ctx.healthScore.score >= 0, "Health score present");
      assert(ctx.healthScore.label.length > 0, "Health label present");
    }),

    test("Full context contains KPIs", () => {
      const ctx = retriever.getFullContext();
      assert(ctx.topKpis.length > 0, "KPIs present");
      for (const k of ctx.topKpis) {
        assert(k.key.length > 0, "KPI key defined");
        assert(k.label.length > 0, "KPI label defined");
        assert(typeof k.value === "number", "KPI value is number");
      }
    }),

    test("Full context contains current period data", () => {
      const ctx = retriever.getFullContext();
      assert(ctx.currentPeriod.revenue >= 0, "Period revenue");
      assert(ctx.currentPeriod.invoiceCount >= 0, "Period invoice count");
    }),

    test("Full context contains inventory alerts", () => {
      const ctx = retriever.getFullContext();
      assert(Array.isArray(ctx.inventoryAlerts), "Inventory alerts is array");
    }),

    test("Full context contains customer alerts", () => {
      const ctx = retriever.getFullContext();
      assert(Array.isArray(ctx.customerAlerts), "Customer alerts is array");
    }),

    test("Full context contains recommendations", () => {
      const ctx = retriever.getFullContext();
      assert(Array.isArray(ctx.activeRecommendations), "Recommendations is array");
    }),

    test("Full context contains preferences", () => {
      const ctx = retriever.getFullContext();
      assert(ctx.preferences.language.length > 0, "Language present");
      assert(Array.isArray(ctx.preferences.frequentTopics), "Frequent topics present");
    }),

    test("Minimal context is smaller than full context", () => {
      const full = retriever.getFullContext();
      const minimal = retriever.getMinimalContext();
      assert(full.recentConversations.length >= minimal.recentConversations.length, "Minimal has fewer conversations");
      assert(full.topKpis.length >= minimal.topKpis.length, "Minimal has fewer KPIs");
      assert(full.activeRecommendations.length >= minimal.activeRecommendations.length, "Minimal has fewer recommendations");
    }),

    test("Minimal context still contains essential data", () => {
      const ctx = retriever.getMinimalContext();
      assert(ctx.businessSummary.length > 0, "Business summary present");
      assert(ctx.healthScore.score >= 0, "Health score present");
      assert(ctx.currentPeriod.revenue >= 0, "Period revenue present");
      assert(ctx.preferences.language.length > 0, "Language present");
    }),

    test("Business context string is formatted", () => {
      const ctx = retriever.getBusinessContext();
      assert(ctx.length > 0, "Business context is non-empty");
      assert(ctx.includes("Health Score"), "Contains health score");
      assert(ctx.includes("PKR"), "Contains currency amounts");
    }),

    test("Business context respects org boundaries (single org test)", () => {
      const ctx = retriever.getBusinessContext();
      assert(!ctx.includes("Acme Corp"), "No cross-org data in business context");
      assert(ctx.includes("Test Business"), "Only test org data present");
    }),

    test("Context does not leak raw memory internals", () => {
      const ctx = retriever.getFullContext();
      const serialized = JSON.stringify(ctx);
      assert(!serialized.includes("MemoryStore"), "No MemoryStore leak");
      assert(!serialized.includes("MemoryWriter"), "No MemoryWriter leak");
      assert(!serialized.includes("EntityIndex"), "No EntityIndex leak");
    }),

    test("Context bundle has no undefined values", () => {
      const ctx = retriever.getFullContext();
      const walk = (obj: unknown, path: string): void => {
        if (obj === null || obj === undefined) return;
        if (typeof obj !== "object") return;
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          if (value === undefined) throw new Error(`Undefined value at ${path}.${key}`);
          if (Array.isArray(value)) {
            value.forEach((item, i) => walk(item, `${path}.${key}[${i}]`));
          } else if (typeof value === "object" && value !== null) {
            walk(value, `${path}.${key}`);
          }
        }
      };
      walk(ctx, "context");
    }),

    test("Org isolation: two stores do not share data", () => {
      const store1 = new MemoryStore();
      const prefs1 = new PreferenceStore();
      const writer1 = new MemoryWriter(store1, prefs1);
      writer1.writeRaw(createMockRawData(3, 2, 1, 5));

      const store2 = new MemoryStore();
      const prefs2 = new PreferenceStore();
      const writer2 = new MemoryWriter(store2, prefs2);
      writer2.writeRaw(createMockRawData(10, 8, 5, 30));

      assert(store1.products.size < store2.products.size, "Store 1 has fewer products than store 2");
      assert(store1.customers.size < store2.customers.size, "Store 1 has fewer customers");
      assert(!store2.isEmpty, "Store 2 is populated");
    }),
  ]);
}
