import { SkillResult, SkillContext, ForecastOutput } from "../contracts/skills";
import { SkillWarning } from "../contracts/common";
import { MemoryStore } from "../memory/business-memory";

const VERSION = "1.0";
const SKILL_ID = "forecast";

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<ForecastOutput> {
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

  const dailySales = mem.sales.daily;
  const monthlySales = mem.sales.monthly;
  const dailyExpenses = mem.expenses.daily30d;

  const revenue30 = dailySales.slice(-30).map((d) => d.revenue);
  const last7 = dailySales.slice(-7).map((d) => d.revenue);
  const lastWeekAvg = last7.length > 0 ? last7.reduce((s, v) => s + v, 0) / last7.length : 0;
  const prev7 = dailySales.slice(-14, -7).map((d) => d.revenue);
  const prevWeekAvg = prev7.length > 0 ? prev7.reduce((s, v) => s + v, 0) / prev7.length : 0;
  const revTrend = prevWeekAvg > 0 ? (lastWeekAvg - prevWeekAvg) / prevWeekAvg : 0;
  const expAvg = dailyExpenses.length > 0 ? dailyExpenses.reduce((s, d) => s + d.total, 0) / dailyExpenses.length : 0;

  const now = new Date();
  const targetDate30 = new Date(now);
  targetDate30.setDate(targetDate30.getDate() + 30);

  const forecasts = [
    {
      metric: "revenue", period: "30d", targetDate: targetDate30.toISOString().split("T")[0],
      predictedValue: Math.round(lastWeekAvg * 30 * (1 + revTrend)),
      confidence: Math.min(0.85, 0.3 + revenue30.length / 90 * 0.5),
      range: {
        lower: Math.round(lastWeekAvg * 30 * (1 + revTrend) * 0.85),
        upper: Math.round(lastWeekAvg * 30 * (1 + revTrend) * 1.15),
      },
      basedOn: `Last ${Math.min(dailySales.length, 30)} days of sales data`,
      trend: revTrend > 0.03 ? "up" : revTrend < -0.03 ? "down" : "stable",
      changePct: Math.round(revTrend * 100 * 100) / 100,
    },
    {
      metric: "expenses", period: "30d", targetDate: targetDate30.toISOString().split("T")[0],
      predictedValue: Math.round(expAvg * 30),
      confidence: 0.6,
      range: {
        lower: Math.round(expAvg * 30 * 0.9),
        upper: Math.round(expAvg * 30 * 1.1),
      },
      basedOn: `Last ${Math.min(dailyExpenses.length, 30)} days of expense data`,
      trend: "stable",
      changePct: 1,
    },
    {
      metric: "profit", period: "30d", targetDate: targetDate30.toISOString().split("T")[0],
      predictedValue: Math.round(lastWeekAvg * 30 * (1 + revTrend) - expAvg * 30),
      confidence: Math.min(0.7, 0.25 + revenue30.length / 90 * 0.4),
      range: (() => {
        const pv = lastWeekAvg * 30 * (1 + revTrend) - expAvg * 30;
        const lower = Math.round(pv < 0 ? pv * 1.2 : pv * 0.8);
        const upper = Math.round(pv < 0 ? pv * 0.8 : pv * 1.2);
        return { lower: Math.min(lower, upper), upper: Math.max(lower, upper) };
      })(),
      basedOn: "Revenue forecast minus expense forecast",
      trend: revTrend > 0.03 ? "up" : revTrend < -0.03 ? "down" : "stable",
      changePct: Math.round(revTrend * 100 * 100) / 100,
    },
  ];

  const conf = determineConfidence(dailySales.length, mem.products.size);
  if (conf < 0.4) {
    warnings.push({ code: "LOW_FORECAST_CONFIDENCE", message: "Limited historical data reduces forecast reliability", severity: "warning", affectedData: "forecast" });
  }

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: {
      forecasts,
      metadata: {
        method: "Linear projection with moving average",
        periodsAnalyzed: Math.min(dailySales.length, 30),
        confidence: conf >= 0.7 ? "high" : conf >= 0.4 ? "medium" : "low",
        warnings: warnings.map((w) => w.message),
      },
    },
    error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 2, outputSize: forecasts.length },
  };
}

function determineConfidence(salesDays: number, productCount: number): number {
  let c = 0;
  c += Math.min(salesDays / 90, 1) * 0.5;
  c += Math.min(productCount / 50, 1) * 0.5;
  return Math.round(c * 100) / 100;
}
