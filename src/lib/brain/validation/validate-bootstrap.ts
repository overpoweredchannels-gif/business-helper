import { MemoryStore } from "../memory/business-memory";
import { MemoryWriter } from "../memory/memory-writer";
import { PreferenceStore } from "../learning/preference-store";
import { initializeBusinessBrain, getBusinessBrain } from "../bootstrap";
import type { MemoryWriterRawData } from "../contracts/memory";
import { runSuite, test, assert, assertEqual } from "./helpers";
import { createMockRawData } from "./fixtures";

export function validateBootstrap() {
  return runSuite("Bootstrap Validation", [
    test("MemoryStore initializes empty correctly", () => {
      const store = new MemoryStore();
      assert(store.isEmpty, "Fresh store should be empty");
      assertEqual(store.products.size, 0, "No products initially");
      assertEqual(store.customers.size, 0, "No customers initially");
      assert(!store.isStale, "Fresh store should not be stale yet (ageMs=0)");
    }),

    test("MemoryStore initializes with data", () => {
      const store = new MemoryStore();
      store.initialize({
        products: createMockRawData(1).products.reduce((map, p) => {
          map.set(String(p.id), {
            id: String(p.id),
            name: p.name,
            brand: null,
            category: null,
            sku: null,
            barcode: null,
            defaultSellingPrice: p.default_selling_price ?? 0,
            lastPurchasePrice: p.last_purchase_price ?? 0,
            defaultCostPrice: p.last_purchase_price ?? 0,
            currentStock: 10,
            reorderLevel: 5,
            minimumStockLevel: 2,
            stockStatus: "healthy",
            estimatedDaysLeft: null,
            totalSold30d: 0,
            totalPurchased30d: 0,
            dailySalesVelocity: 0,
            revenue30d: 0,
            profit30d: 0,
            profitMargin30d: null,
            averageSellingPrice30d: 0,
            lastSaleDate: null,
            lastPurchaseDate: null,
            createdAt: "",
            updatedAt: "",
            trackBatch: false,
            trackExpiry: false,
            isActive: true,
            isFastMoving: false,
            isSlowMoving: false,
            needsReorder: false,
          });
          return map;
        }, new Map()),
      } as any);
      assert(!store.isEmpty, "Store should not be empty after initialization");
      assertEqual(store.products.size, 1, "One product loaded");
    }),

    test("MemoryWriter writes raw data correctly", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      const data = createMockRawData(3);
      writer.writeRaw(data);
      assert(!store.isEmpty, "Store populated after writeRaw");
      assert(store.products.size > 0, "Products written");
      assert(store.customers.size > 0, "Customers written");
      assert(store.suppliers.size > 0, "Suppliers written");
      assert(store.sales.transactionCount > 0, "Sales written");
      assert(store.purchases.transactionCount > 0, "Purchases written");
    }),

    test("MemoryWriter builds entity index", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      writer.writeRaw(createMockRawData(5));
      const results = store.searchProducts("Test");
      assert(results.length > 0, "Entity index returns results for product search");
    }),

    test("MemoryWriter computes period aggregates", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      writer.writeRaw(createMockRawData(10));
      const sales = store.sales;
      assert(sales.today.revenue >= 0, "today revenue computed");
      assert(sales.thisMonth.revenue >= 0, "thisMonth revenue computed");
      assert(sales.last30Days.revenue >= 0, "last30Days revenue computed");
      assert(sales.allTime.revenue >= 0, "allTime revenue computed");
      assert(sales.daily.length > 0, "Daily breakdown computed");
      assert(sales.monthly.length > 0, "Monthly breakdown computed");
    }),

    test("MemoryWriter computes stock levels", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      writer.writeRaw(createMockRawData(5));
      const inv = store.inventory;
      assert(inv.totalProducts > 0, "Total products counted");
      assert(inv.totalStockValue > 0, "Stock value computed");
      assert(inv.activeProductCount > 0, "Active products counted");
    }),

    test("MemoryWriter computes expense analytics", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      writer.writeRaw(createMockRawData(8));
      const exp = store.expenses;
      assert(exp.totalExpenses >= 0, "Total expenses computed");
      assert(exp.thisMonth.totalAmount >= 0, "Monthly expenses computed");
      assert(exp.daily30d.length >= 0, "Daily expenses computed");
      assert(exp.hasCategoryData, "Category data computed");
    }),

    test("Duplicate initialization is idempotent", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      const data = createMockRawData(3);
      writer.writeRaw(data);
      const firstCount = store.products.size;
      writer.writeRaw(data);
      assertEqual(store.products.size, firstCount, "Products not duplicated on second writeRaw");
    }),

    test("Memory survives clear + reinit", () => {
      const store = new MemoryStore();
      const prefs = new PreferenceStore();
      const writer = new MemoryWriter(store, prefs);
      writer.writeRaw(createMockRawData(3));
      assert(!store.isEmpty, "Has data after first write");
      writer.clear();
      assert(store.isEmpty, "Empty after clear");
      writer.writeRaw(createMockRawData(5));
      assertEqual(store.products.size, 5, "Data restored after clear + reinit");
    }),

    test("Singleton bootstrap initializes once", () => {
      const instance1 = initializeBusinessBrain(createMockRawData(3));
      assert(instance1 !== null, "First bootstrap returns instance");
      const snapshot1 = instance1.getMemorySnapshot();
      const instance2 = getBusinessBrain();
      assert(instance2 !== null, "Singleton accessible via getBusinessBrain()");
      const snapshot2 = instance2!.getMemorySnapshot();
      assertEqual(snapshot2.organizationId, snapshot1.organizationId, "Singleton points to same memory");
    }),

    test("Bootstrap initializes preferences", () => {
      const brain = initializeBusinessBrain(createMockRawData(2));
      const prefs = brain.getPreferences();
      assert(prefs !== null, "Preferences exist");
      assertEqual(prefs.preferredLanguage, "english", "Default language is english");
      assert(prefs.totalInteractions >= 0, "Interaction count initialized");
    }),

    test("BusinessBrain.getContext() returns data", () => {
      const brain = initializeBusinessBrain(createMockRawData(5));
      const ctx = brain.getContext();
      assert(ctx !== null, "Context returned");
      assert(ctx.businessSummary.length > 0, "Business summary is non-empty");
      assert(ctx.healthScore.score >= 0, "Health score present");
      assert(ctx.topKpis.length >= 0, "KPIs present");
      assert(ctx.currentPeriod.revenue >= 0, "Current period revenue present");
    }),

    test("BusinessBrain.getMemorySnapshot() returns correct shape", () => {
      const brain = initializeBusinessBrain(createMockRawData(4));
      const snap = brain.getMemorySnapshot();
      assert(snap.organizationId !== "", "Organization ID present");
      assert(snap.productCount > 0, "Product count > 0");
      assert(snap.healthScore.score >= 0, "Health score present");
      assert(typeof snap.byteSize === "number", "Byte size is a number");
      assert(typeof snap.isStale === "boolean", "isStale is boolean");
    }),

    test("Memory age tracking works", () => {
      const store = new MemoryStore();
      assert(store.ageMs >= 0, "ageMs is non-negative");
      assert(!store.isStale, "Not stale immediately");
    }),
  ]);
}
