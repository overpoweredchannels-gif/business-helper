import { SkillResult, SkillContext, KpiOutput } from "../contracts/skills";
import { SkillWarning } from "../contracts/common";
import { MemoryStore } from "../memory/business-memory";

const VERSION = "1.0";
const SKILL_ID = "kpi";

function fmt(v: number, u: string): string {
  if (u === "currency") return `PKR ${v.toLocaleString("en-PK")}`;
  if (u === "percentage") return `${Math.round(v * 100) / 100}%`;
  if (u === "count" || u === "rate") return String(Math.round(v));
  return String(v);
}

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<KpiOutput> {
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
  const e = mem.expenses;
  const inv = mem.inventory;
  const customers = Array.from(mem.customers.values());
  const suppliers = Array.from(mem.suppliers.values());

  const monthlyRevenue = s.thisMonth.revenue;
  const monthlySalesCount = s.thisMonth.invoiceCount;
  const avgSaleValue = s.thisMonth.averageSaleValue;
  const revenueGrowth = s.lastMonth.revenue > 0 ? ((monthlyRevenue - s.lastMonth.revenue) / s.lastMonth.revenue) * 100 : monthlyRevenue > 0 ? 100 : 0;
  const monthlyProfit = s.thisMonth.profit;
  const profitMargin = s.thisMonth.profitMargin;
  const profitGrowth = s.lastMonth.profit !== 0 ? s.lastMonth.profit > 0 ? ((monthlyProfit - s.lastMonth.profit) / Math.abs(s.lastMonth.profit)) * 100 : monthlyProfit > 0 ? 100 : 0 : monthlyProfit > 0 ? 100 : 0;
  const receivableTotal = customers.reduce((sum, c) => sum + c.outstandingBalance, 0);
  const overdueTotal = customers.reduce((sum, c) => sum + c.overdueAmount, 0);
  const overdueRatio = receivableTotal > 0 ? (overdueTotal / receivableTotal) * 100 : 0;
  const expenseRatio = monthlyRevenue > 0 ? (e.thisMonth.totalAmount / monthlyRevenue) * 100 : 0;
  const stockHealthPct = inv.totalProducts > 0 ? ((inv.totalProducts - inv.outOfStockCount - inv.lowStockCount) / inv.totalProducts) * 100 : 0;
  const payableTotal = suppliers.reduce((sum, sup) => sum + sup.payableAmount, 0);

  const kpiDefs = [
    { key: "monthly_revenue", label: "Monthly Revenue", category: "revenue", value: monthlyRevenue, unit: "currency" as const, change: revenueGrowth },
    { key: "monthly_sales", label: "Monthly Sales Count", category: "revenue", value: monthlySalesCount, unit: "count" as const, change: 0 },
    { key: "avg_sale_value", label: "Avg Sale Value", category: "revenue", value: avgSaleValue, unit: "currency" as const, change: 0 },
    { key: "monthly_profit", label: "Monthly Profit", category: "profitability", value: monthlyProfit, unit: "currency" as const, change: profitGrowth },
    { key: "profit_margin", label: "Profit Margin", category: "profitability", value: profitMargin ?? 0, unit: "percentage" as const, change: 0 },
    { key: "expense_ratio", label: "Expense Ratio", category: "efficiency", value: Math.round(expenseRatio * 100) / 100, unit: "percentage" as const, change: 0 },
    { key: "stock_health", label: "Stock Health", category: "efficiency", value: Math.round(stockHealthPct * 100) / 100, unit: "percentage" as const, change: 0 },
    { key: "receivables", label: "Outstanding Receivables", category: "liquidity", value: receivableTotal, unit: "currency" as const, change: 0 },
    { key: "overdue_ratio", label: "Overdue Ratio", category: "liquidity", value: Math.round(overdueRatio * 100) / 100, unit: "percentage" as const, change: 0 },
    { key: "payables", label: "Total Payables", category: "liquidity", value: payableTotal, unit: "currency" as const, change: 0 },
  ];

  const kpis = kpiDefs.map((k) => ({
    key: k.key, label: k.label, category: k.category, value: k.value, unit: k.unit,
    formatted: fmt(k.value, k.unit),
    change: Math.round(k.change * 100) / 100,
    changeLabel: (k.change > 0 ? "up" : k.change < 0 ? "down" : "flat") as "up" | "down" | "flat",
    confidence: "high" as const,
  }));

  const categories: KpiOutput["categories"] = {};
  for (const k of kpis) {
    if (!categories[k.category]) categories[k.category] = [];
    categories[k.category].push({ key: k.key, label: k.label, value: k.value, formatted: k.formatted, change: k.change });
  }

  if (!s.hasProfitData) {
    warnings.push({ code: "PROFIT_DATA_MISSING", message: "Profit data unavailable; margins are estimated", severity: "info", affectedData: "profit" });
  }

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: { kpis, categories }, error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 4, outputSize: kpis.length },
  };
}
