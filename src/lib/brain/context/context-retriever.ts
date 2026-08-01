import { MemoryStore } from "../memory/business-memory";

export interface ContextBundle {
  businessSummary: string;
  recentConversations: Array<{ role: "user" | "assistant"; text: string; timestamp: string }>;
  healthScore: { score: number; label: string };
  topKpis: Array<{ key: string; label: string; value: number; unit: string }>;
  currentPeriod: {
    revenue: number;
    profit: number;
    invoiceCount: number;
    expenseRatio: string;
  };
  inventoryAlerts: string[];
  customerAlerts: string[];
  activeRecommendations: Array<{ title: string; priority: string }>;
  preferences: {
    language: string;
    frequentTopics: Array<{ topic: string; count: number }>;
  };
}

export class ContextRetriever {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  getFullContext(): ContextBundle {
    const s = this.store.sales;
    const e = this.store.expenses;
    const inv = this.store.inventory;
    const hs = this.store.analytics.healthScore;
    const kpis = this.store.analytics.kpis.slice(0, 5);
    const prefs = this.store.preferences;
    const recs = this.store.recommendations.active.slice(0, 5);

    // Top frequent topics
    const frequentTopics = Object.entries(prefs.frequentTopics)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));

    // Inventory alerts
    const inventoryAlerts: string[] = [];
    if (inv.outOfStockCount > 0) inventoryAlerts.push(`${inv.outOfStockCount} product(s) out of stock`);
    if (inv.lowStockCount > 0) inventoryAlerts.push(`${inv.lowStockCount} product(s) low in stock`);
    if (inv.urgentReorderCount > 0) inventoryAlerts.push(`${inv.urgentReorderCount} product(s) need urgent reorder`);

    // Customer alerts
    const customerAlerts: string[] = [];
    const overdueCount = Array.from(this.store.customers.values()).filter((c) => c.overdueAmount > 0).length;
    if (overdueCount > 0) customerAlerts.push(`${overdueCount} customer(s) with overdue balances`);

    const expenseRatio = s.thisMonth.revenue > 0
      ? `${((e.thisMonth.totalAmount / s.thisMonth.revenue) * 100).toFixed(1)}%`
      : "N/A";

    return {
      businessSummary: this.store.getBusinessSummary(),
      recentConversations: this.store.getConversationContext(5),
      healthScore: { score: hs.score, label: hs.label },
      topKpis: kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, unit: k.unit })),
      currentPeriod: {
        revenue: s.thisMonth.revenue,
        profit: s.thisMonth.profit,
        invoiceCount: s.thisMonth.invoiceCount,
        expenseRatio,
      },
      inventoryAlerts,
      customerAlerts,
      activeRecommendations: recs.map((r) => ({ title: r.title, priority: r.priority })),
      preferences: {
        language: prefs.preferredLanguage,
        frequentTopics,
      },
    };
  }

  getMinimalContext(): ContextBundle {
    const full = this.getFullContext();
    return {
      ...full,
      recentConversations: full.recentConversations.slice(-3),
      topKpis: full.topKpis.slice(0, 3),
      activeRecommendations: full.activeRecommendations.slice(0, 2),
      inventoryAlerts: full.inventoryAlerts.slice(0, 2),
      customerAlerts: full.customerAlerts.slice(0, 1),
    };
  }

  getBusinessContext(): string {
    const ctx = this.getFullContext();
    const lines: string[] = [
      ctx.businessSummary,
      "",
      `Health Score: ${ctx.healthScore.score}/100 (${ctx.healthScore.label})`,
      `Period Revenue: PKR ${ctx.currentPeriod.revenue.toLocaleString("en-PK")}`,
      `Period Profit: PKR ${ctx.currentPeriod.profit.toLocaleString("en-PK")}`,
      `Invoices: ${ctx.currentPeriod.invoiceCount}`,
      `Expense Ratio: ${ctx.currentPeriod.expenseRatio}`,
    ];

    if (ctx.inventoryAlerts.length > 0) {
      lines.push("", "Inventory Alerts:", ...ctx.inventoryAlerts.map((a) => `  - ${a}`));
    }
    if (ctx.customerAlerts.length > 0) {
      lines.push("", "Customer Alerts:", ...ctx.customerAlerts.map((a) => `  - ${a}`));
    }

    return lines.join("\n");
  }
}
