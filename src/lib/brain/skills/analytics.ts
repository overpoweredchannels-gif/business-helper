import { SkillResult, SkillContext, SalesAnalyticsOutput } from "../contracts/skills";
import { SkillWarning, TrendPoint } from "../contracts/common";
import { MemoryStore } from "../memory/business-memory";

const VERSION = "1.0";
const SKILL_ID = "analytics";

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<SalesAnalyticsOutput> {
  const startTime = performance.now();
  const warnings: SkillWarning[] = [];
  const mem = context.memory;

  if (mem.isEmpty) {
    return {
      skillId: SKILL_ID, version: VERSION, success: false,
      data: null, error: { code: "MEMORY_EMPTY", message: "No business data loaded", detail: "", recoverable: true },
      warnings, metrics: { executionTimeMs: performance.now() - startTime, inputSize: 0, outputSize: 0 },
    };
  }

  const s = mem.sales;
  const products = Array.from(mem.products.values());
  const customers = Array.from(mem.customers.values());

  const topProducts = products
    .filter((p) => p.revenue30d > 0)
    .sort((a, b) => b.revenue30d - a.revenue30d)
    .slice(0, 10)
    .map((p) => ({
      productId: p.id, productName: p.name, quantitySold: p.totalSold30d,
      revenue: p.revenue30d, profit: p.profit30d,
      margin: p.profitMargin30d !== null ? Math.round(p.profitMargin30d * 100) / 100 : null,
    }));

  const topCustomerList = customers
    .filter((c) => c.totalSales30d > 0)
    .sort((a, b) => b.totalSales30d - a.totalSales30d)
    .slice(0, 10)
    .map((c) => ({
      customerId: c.id, customerName: c.name,
      revenue: c.totalSales30d, invoiceCount: c.invoiceCount30d, lastSaleDate: c.lastSaleDate,
    }));

  const dailyTrends: TrendPoint[] = s.daily.map((d) => ({
    label: d.date, value: d.revenue, comparisonValue: d.profit,
  }));

  const weeklyMap: Record<string, number> = {};
  for (const d of s.daily) {
    const week = getWeekLabel(d.date);
    weeklyMap[week] = (weeklyMap[week] || 0) + d.revenue;
  }
  const weeklyTrends: TrendPoint[] = Object.entries(weeklyMap).map(([label, value]) => ({ label, value }));

  const monthlyTrends: TrendPoint[] = s.monthly.map((m) => ({
    label: m.month, value: m.revenue, comparisonValue: m.profit,
  }));

  const changeVsLastPeriod = s.lastMonth.revenue > 0
    ? ((s.thisMonth.revenue - s.lastMonth.revenue) / s.lastMonth.revenue) * 100
    : null;

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: {
      overview: {
        totalRevenue: s.thisMonth.revenue,
        totalProfit: s.thisMonth.profit,
        profitMargin: s.thisMonth.profitMargin,
        invoiceCount: s.thisMonth.invoiceCount,
        averageSaleValue: s.thisMonth.averageSaleValue,
        byPaymentType: s.thisMonth.byPaymentType,
      },
      periods: {
        today: { revenue: s.today.revenue, profit: s.today.profit, invoiceCount: s.today.invoiceCount, averageValue: s.today.averageSaleValue },
        this_week: { revenue: s.thisWeek.revenue, profit: s.thisWeek.profit, invoiceCount: s.thisWeek.invoiceCount, averageValue: s.thisWeek.averageSaleValue },
        this_month: { revenue: s.thisMonth.revenue, profit: s.thisMonth.profit, invoiceCount: s.thisMonth.invoiceCount, averageValue: s.thisMonth.averageSaleValue },
        last_30_days: { revenue: s.last30Days.revenue, profit: s.last30Days.profit, invoiceCount: s.last30Days.invoiceCount, averageValue: s.last30Days.averageSaleValue },
        last_month: { revenue: s.lastMonth.revenue, profit: s.lastMonth.profit, invoiceCount: s.lastMonth.invoiceCount, averageValue: s.lastMonth.averageSaleValue },
      },
      trends: { daily: dailyTrends, weekly: weeklyTrends, monthly: monthlyTrends, changeVsLastPeriod },
      topProducts,
      topCustomers: topCustomerList,
      metadata: { periodCovered: "last30Days", hasCompleteData: s.transactionCount > 0, warnings: warnings.map((w) => w.message) },
    },
    error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 2, outputSize: 5 },
  };
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return start.toISOString().split("T")[0];
}
