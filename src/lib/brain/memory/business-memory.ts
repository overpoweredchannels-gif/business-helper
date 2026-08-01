import {
  MemorySections,
  ProductMemory,
  CustomerMemory,
  SupplierMemory,
  StaffMemory,
  SalesMemory,
  PurchasesMemory,
  ExpensesMemory,
  InventoryMemory,
  AnalyticsMemory,
  TaskMemory,
  AlertMemory,
  ConversationMemoryState,
  PreferencesSnapshot,
  PermissionsSnapshot,
  MemoryMeta,
  RecommendationItem,
  FuzzyMatchResult,
} from "../contracts/memory";
import { EntityIndex } from "./entity-index";

export class MemoryStore {
  private _sections: MemorySections;
  private _createdAt: number;
  private _lastRefreshedAt: number;
  private _entityIndex: EntityIndex;

  constructor() {
    this._sections = this.createEmptySections();
    this._createdAt = Date.now();
    this._lastRefreshedAt = 0;
    this._entityIndex = new EntityIndex();
  }

  // ─── Initialization ───

  initialize(sections: Partial<MemorySections>): void {
    if (sections.products) this._sections.products = sections.products;
    if (sections.customers) this._sections.customers = sections.customers;
    if (sections.suppliers) this._sections.suppliers = sections.suppliers;
    if (sections.staff) this._sections.staff = sections.staff;
    if (sections.sales) this._sections.sales = sections.sales;
    if (sections.purchases) this._sections.purchases = sections.purchases;
    if (sections.expenses) this._sections.expenses = sections.expenses;
    if (sections.inventory) this._sections.inventory = sections.inventory;
    if (sections.analytics) this._sections.analytics = sections.analytics;
    if (sections.recommendations) this._sections.recommendations = sections.recommendations;
    if (sections.conversations) this._sections.conversations = sections.conversations;
    if (sections.preferences) this._sections.preferences = sections.preferences;
    if (sections.permissions) this._sections.permissions = sections.permissions;
    if (sections.meta) this._sections.meta = sections.meta;
    if (sections.tasks) this._sections.tasks = sections.tasks;
    if (sections.alerts) this._sections.alerts = sections.alerts;

    this._entityIndex.buildIndex(
      this._sections.products,
      this._sections.customers,
      this._sections.suppliers,
      this._sections.staff
    );
    this._lastRefreshedAt = Date.now();
  }

  // ─── Section Accessors ───

  get sections(): MemorySections {
    return this._sections;
  }

  get products(): Map<string, ProductMemory> {
    return this._sections.products;
  }

  get customers(): Map<string, CustomerMemory> {
    return this._sections.customers;
  }

  get suppliers(): Map<string, SupplierMemory> {
    return this._sections.suppliers;
  }

  get staff(): Map<string, StaffMemory> {
    return this._sections.staff;
  }

  get sales(): SalesMemory {
    return this._sections.sales;
  }

  get purchases(): PurchasesMemory {
    return this._sections.purchases;
  }

  get expenses(): ExpensesMemory {
    return this._sections.expenses;
  }

  get inventory(): InventoryMemory {
    return this._sections.inventory;
  }

  get analytics(): AnalyticsMemory {
    return this._sections.analytics;
  }

  get recommendations(): { active: RecommendationItem[]; summary: { total: number; highPriority: number; mediumPriority: number; lowPriority: number; byCategory: Record<string, number> }; lastGenerated: string } {
    return this._sections.recommendations;
  }

  get conversations(): ConversationMemoryState {
    return this._sections.conversations;
  }

  get preferences(): PreferencesSnapshot {
    return this._sections.preferences;
  }

  get permissions(): PermissionsSnapshot {
    return this._sections.permissions;
  }

  get meta(): MemoryMeta {
    return this._sections.meta;
  }

  get tasks(): TaskMemory {
    return this._sections.tasks;
  }

  get alerts(): AlertMemory {
    return this._sections.alerts;
  }

  // ─── Entity Retrieval ───

  getProduct(id: string): ProductMemory | undefined {
    return this._sections.products.get(id);
  }

  getCustomer(id: string): CustomerMemory | undefined {
    return this._sections.customers.get(id);
  }

  getSupplier(id: string): SupplierMemory | undefined {
    return this._sections.suppliers.get(id);
  }

  getStaff(id: string): StaffMemory | undefined {
    return this._sections.staff.get(id);
  }

  // ─── Section Retrieval ───

  getSection<K extends keyof MemorySections>(key: K): MemorySections[K] {
    return this._sections[key] as MemorySections[K];
  }

  getSections(keys: (keyof MemorySections)[]): Partial<MemorySections> {
    const result: Partial<MemorySections> = {};
    for (const key of keys) {
      (result as Record<string, unknown>)[key] = this._sections[key];
    }
    return result;
  }

  // ─── Entity Search ───

  searchProducts(query: string, threshold?: number, maxResults?: number): FuzzyMatchResult<ProductMemory>[] {
    return this._entityIndex.searchProducts(query, threshold, maxResults);
  }

  searchCustomers(query: string, threshold?: number, maxResults?: number): FuzzyMatchResult<CustomerMemory>[] {
    return this._entityIndex.searchCustomers(query, threshold, maxResults);
  }

  searchSuppliers(query: string, threshold?: number, maxResults?: number): FuzzyMatchResult<SupplierMemory>[] {
    return this._entityIndex.searchSuppliers(query, threshold, maxResults);
  }

  searchStaff(query: string, threshold?: number, maxResults?: number): FuzzyMatchResult<StaffMemory>[] {
    return this._entityIndex.searchStaff(query, threshold, maxResults);
  }

  findExactProduct(name: string): ProductMemory | undefined {
    return this._entityIndex.findExactProduct(name);
  }

  findExactCustomer(name: string): CustomerMemory | undefined {
    return this._entityIndex.findExactCustomer(name);
  }

  findExactSupplier(name: string): SupplierMemory | undefined {
    return this._entityIndex.findExactSupplier(name);
  }

  // ─── Computed Retrieval ───

  getBusinessSummary(): string {
    const m = this._sections.meta;
    const inv = this._sections.inventory;
    const sales30 = this._sections.sales.last30Days;
    const cust = this._sections.customers;
    const supp = this._sections.suppliers;

    return [
      `Business: ${m.organizationName}`,
      `Owner: ${m.ownerName}`,
      `Date: ${m.currentDate}`,
      `Products: ${inv.totalProducts} (${inv.lowStockCount} low stock, ${inv.outOfStockCount} out of stock)`,
      `Sales (30d): PKR ${sales30.revenue.toLocaleString("en-PK")} (${sales30.invoiceCount} invoices)`,
      `Customers: ${cust.size}`,
      `Suppliers: ${supp.size}`,
    ].join(" | ");
  }

  getConversationContext(n: number): Array<{ role: "user" | "assistant"; text: string; timestamp: string }> {
    return this._sections.conversations.recentMessages
      .slice(-n)
      .map((m) => ({ role: m.role, text: m.text, timestamp: m.createdAt }));
  }

  // ─── Metadata ───

  get ageMs(): number {
    if (this._lastRefreshedAt === 0) return 0;
    return Date.now() - this._lastRefreshedAt;
  }

  get isStale(): boolean {
    return this.ageMs > 30 * 60 * 1000;
  }

  get byteSize(): number {
    try {
      const serialized = JSON.stringify(this.serialize());
      return new TextEncoder().encode(serialized).length;
    } catch {
      return 0;
    }
  }

  // ─── Serialization ───

  serialize(): Record<string, unknown> {
    return {
      schemaVersion: this._sections.meta.schemaVersion,
      sections: {
        meta: this._sections.meta,
        inventory: this._sections.inventory,
        tasks: this._sections.tasks,
        alerts: this._sections.alerts,
        analytics: this.stripMaps(this._sections.analytics),
        preferences: this._sections.preferences,
        permissions: this._sections.permissions,
        productCount: this._sections.products.size,
        customerCount: this._sections.customers.size,
        supplierCount: this._sections.suppliers.size,
        staffCount: this._sections.staff.size,
      },
      memory: {
        ageMs: this.ageMs,
        isStale: this.isStale,
        byteSize: this.byteSize,
        sections: Object.keys(this._sections).reduce(
          (acc, key) => {
            const section = key as keyof MemorySections;
            const value = this._sections[section];
            if (value instanceof Map) {
              (acc as Record<string, number>)[key] = (value as Map<string, unknown>).size;
            } else if (typeof value === "object" && value !== null) {
              (acc as Record<string, number>)[key] = 1;
            }
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    };
  }

  private stripMaps(obj: unknown): unknown {
    if (obj instanceof Map) {
      return Array.from(obj.entries());
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripMaps(item));
    }
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.stripMaps(value);
      }
      return result;
    }
    return obj;
  }

  // ─── Entity Index ───

  get entityIndex(): EntityIndex {
    return this._entityIndex;
  }

  // ─── Empty State ───

  get isEmpty(): boolean {
    return this._sections.products.size === 0 && this._sections.meta.organizationId === "";
  }

  // ─── Private ───

  private createEmptySections(): MemorySections {
    return {
      products: new Map(),
      customers: new Map(),
      suppliers: new Map(),
      staff: new Map(),
      sales: this.emptySales(),
      purchases: this.emptyPurchases(),
      expenses: this.emptyExpenses(),
      inventory: this.emptyInventory(),
      analytics: this.emptyAnalytics(),
      recommendations: { active: [], summary: { total: 0, highPriority: 0, mediumPriority: 0, lowPriority: 0, byCategory: {} }, lastGenerated: "" },
      conversations: {
        current: null,
        recentMessages: [],
        recentConversations: [],
        state: { pipelineStage: null, awaitingConfirmation: false, activeDraft: null },
      },
      preferences: {
        frequentTopics: {},
        preferredPeriod: null,
        preferredLanguage: "english",
        ignoredRecommendationTypes: [],
        topicFrequency7d: {},
        suggestedQuestions: [],
        version: 1,
        lastModified: "",
        totalInteractions: 0,
      },
      permissions: {
        ownerId: "", ownerProfileId: "", isOwner: true,
        aiEnabled: true, whatsappEnabled: false, voiceEnabled: false, marketIntelligenceEnabled: false,
      },
      meta: {
        organizationId: "", organizationName: "", ownerName: "",
        currentDate: "", currentTime: "", timezone: "Asia/Karachi",
        schemaVersion: 1, lastFullRefresh: "", sectionVersions: {},
      },
      tasks: { pending: 0, overdue: 0, completed: 0, byPriority: {}, byType: {} },
      alerts: { active: 0, critical: 0, byType: {}, recent: [] },
    };
  }

  private emptySales(): SalesMemory {
    const empty = () => ({ revenue: 0, profit: 0, profitMargin: null, invoiceCount: 0, averageSaleValue: 0, byPaymentType: {}, byStaff: {}, topProductId: null, topProductRevenue: 0, topProductQuantity: 0 });
    return {
      today: empty(), thisWeek: empty(), thisMonth: empty(), last30Days: empty(), lastMonth: empty(), allTime: empty(),
      daily: [], monthly: [], lastTransactionDate: "", transactionCount: 0, hasProfitData: false, profitConfidence: "low",
    };
  }

  private emptyPurchases(): PurchasesMemory {
    const empty = () => ({ totalAmount: 0, invoiceCount: 0, bySupplier: {}, byPaymentType: {} });
    return {
      today: empty(), thisWeek: empty(), thisMonth: empty(), last30Days: empty(), allTime: empty(),
      lastTransactionDate: "", transactionCount: 0,
    };
  }

  private emptyExpenses(): ExpensesMemory {
    const empty = () => ({ totalAmount: 0, count: 0, byCategory: {} });
    return {
      thisMonth: empty(), last30Days: empty(), lastMonth: empty(), allTime: empty(),
      byCategory: {}, daily30d: [], monthly12m: [], anomalies: [],
      totalExpenses: 0, expenseCount: 0, averageExpenseValue: 0, topCategory: null, topCategoryPct: null, hasCategoryData: false,
    };
  }

  private emptyInventory(): InventoryMemory {
    return {
      totalProducts: 0, totalStockValue: 0, totalStockCost: 0, activeProductCount: 0,
      outOfStockCount: 0, lowStockCount: 0, healthyCount: 0, overstockedCount: 0, urgentReorderCount: 0,
    };
  }

  private emptyAnalytics(): AnalyticsMemory {
    return {
      healthScore: { score: 50, label: "Average", breakdown: {}, reasons: [], contributingFactors: [], trend: "stable", trendEvidence: "", lastCalculated: "" },
      kpis: [], trends: { revenue: [], profit: [], expenses: [] }, forecasts: [], recommendations: [],
      needsAttention: false, attentionReasons: [],
    };
  }
}
