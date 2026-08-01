import { SkillResult, SkillContext, HealthScoreOutput } from "../contracts/skills";
import { MemoryStore } from "../memory/business-memory";
import { SkillWarning } from "../contracts/common";

const VERSION = "1.0";
const SKILL_ID = "health_score";

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<HealthScoreOutput> {
  const startTime = performance.now();
  const warnings: SkillWarning[] = [];
  const mem = context.memory;

  if (mem.isEmpty) {
    return {
      skillId: SKILL_ID, version: VERSION, success: true,
      data: {
        score: 50, label: "Average",
        breakdown: { revenueHealth: 50, profitHealth: 50, inventoryHealth: 50, receivableHealth: 50, expenseHealth: 50, cashflowHealth: 50 },
        reasons: ["No business data loaded"],
        contributingFactors: [],
        trend: "stable", trendEvidence: "Insufficient data", lastCalculated: new Date().toISOString(),
      },
      error: null, warnings: [{ code: "MEMORY_EMPTY", message: "Business Memory is empty", severity: "warning", affectedData: "all" }],
      metrics: { executionTimeMs: performance.now() - startTime, inputSize: 0, outputSize: 1 },
    };
  }

  const sales = mem.sales;
  const expenses = mem.expenses;
  const customers = Array.from(mem.customers.values());
  const inv = mem.inventory;

  let revenueScore = 50;
  const thisMonthRev = sales.thisMonth.revenue;
  const prevMonthRev = sales.lastMonth.revenue;
  if (thisMonthRev > 0) {
    const changePct = prevMonthRev > 0 ? (thisMonthRev - prevMonthRev) / prevMonthRev : 0;
    revenueScore = 50 + changePct * 50;
    revenueScore = Math.max(0, Math.min(100, revenueScore));
  } else {
    revenueScore = 0;
    warnings.push({ code: "NO_SALES", message: "No sales recorded this month", severity: "warning", affectedData: "sales" });
  }

  let profitScore = 50;
  const margin = sales.thisMonth.profitMargin;
  if (margin !== null) {
    if (margin >= 30) profitScore = 100;
    else if (margin >= 20) profitScore = 80;
    else if (margin >= 10) profitScore = 60;
    else if (margin >= 5) profitScore = 40;
    else if (margin >= 0) profitScore = 20;
    else profitScore = 0;
  } else {
    warnings.push({ code: "NO_PROFIT_DATA", message: "Profit margin could not be calculated", severity: "info", affectedData: "sales.profit" });
  }

  let inventoryScore = 50;
  const total = inv.totalProducts;
  if (total > 0) {
    const oosRatio = inv.outOfStockCount / total;
    inventoryScore = 100 - oosRatio * 100 * 0.6 - (inv.lowStockCount / total) * 100 * 0.3;
    inventoryScore = Math.max(0, Math.min(100, inventoryScore));
  }

  let receivableScore = 100;
  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingBalance, 0);
  const totalOverdue = customers.reduce((s, c) => s + c.overdueAmount, 0);
  if (totalOutstanding > 0) {
    const overdueRatio = totalOverdue / totalOutstanding;
    receivableScore = overdueRatio <= 0.1 ? 85 : overdueRatio <= 0.25 ? 65 : overdueRatio <= 0.5 ? 40 : 15;
  }

  let expenseScore = 50;
  const thisMonthExp = expenses.thisMonth.totalAmount;
  if (thisMonthRev > 0 && thisMonthExp > 0) {
    const expRatio = thisMonthExp / thisMonthRev;
    expenseScore = expRatio <= 0.3 ? 100 : expRatio <= 0.5 ? 80 : expRatio <= 0.7 ? 60 : expRatio <= 1.0 ? 30 : 0;
  }

  let cashflowScore = 50;
  const totalReceivables = customers.reduce((s, c) => s + c.outstandingBalance, 0);
  const totalPayables = Array.from(mem.suppliers.values()).reduce((s, sup) => s + sup.payableAmount, 0);
  if (totalReceivables > 0 || totalPayables > 0) {
    const netFlow = totalReceivables - totalPayables;
    cashflowScore = netFlow > 0 ? 70 + Math.min(30, (netFlow / Math.max(totalReceivables, 1)) * 30) : Math.max(0, 50 + (netFlow / Math.max(totalPayables, 1)) * 50);
    cashflowScore = Math.max(0, Math.min(100, cashflowScore));
  }

  const score = Math.round(revenueScore * 0.25 + profitScore * 0.20 + inventoryScore * 0.20 + receivableScore * 0.15 + expenseScore * 0.10 + cashflowScore * 0.10);
  const label = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Average" : score >= 30 ? "Needs Attention" : "Critical";

  const reasons: string[] = [];
  if (revenueScore < 50) reasons.push("Low sales this month");
  if (profitScore < 50) reasons.push("Thin profit margins");
  if (inventoryScore < 50) reasons.push("Out-of-stock issues");
  if (receivableScore < 50) reasons.push("High overdue receivables");
  if (expenseScore < 50) reasons.push("High expense ratio");
  if (cashflowScore < 50) reasons.push("Negative cash flow");
  if (reasons.length === 0) reasons.push("All metrics are within healthy ranges");

  const trend = determineTrend(mem);

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: {
      score, label,
      breakdown: { revenueHealth: Math.round(revenueScore), profitHealth: Math.round(profitScore), inventoryHealth: Math.round(inventoryScore), receivableHealth: Math.round(receivableScore), expenseHealth: Math.round(expenseScore), cashflowHealth: Math.round(cashflowScore) },
      reasons: reasons.slice(0, 5),
      contributingFactors: [
        { factor: "Revenue", impact: revenueScore >= 50 ? "positive" : "negative", weight: 0.25, detail: `${Math.round(revenueScore)}/100` },
        { factor: "Profit", impact: profitScore >= 50 ? "positive" : "negative", weight: 0.20, detail: `${Math.round(profitScore)}/100` },
        { factor: "Inventory", impact: inventoryScore >= 50 ? "positive" : "negative", weight: 0.20, detail: `${Math.round(inventoryScore)}/100` },
        { factor: "Receivables", impact: receivableScore >= 50 ? "positive" : "negative", weight: 0.15, detail: `${Math.round(receivableScore)}/100` },
        { factor: "Expenses", impact: expenseScore >= 50 ? "positive" : "negative", weight: 0.10, detail: `${Math.round(expenseScore)}/100` },
        { factor: "Cash Flow", impact: cashflowScore >= 50 ? "positive" : "negative", weight: 0.10, detail: `${Math.round(cashflowScore)}/100` },
      ],
      trend: trend.trend,
      trendEvidence: trend.evidence,
      lastCalculated: new Date().toISOString(),
    },
    error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 6, outputSize: 1 },
  };
}

function determineTrend(mem: MemoryStore): { trend: "improving" | "declining" | "stable"; evidence: string } {
  const prev = mem.analytics.healthScore;
  if (!prev || prev.score === 0) return { trend: "stable", evidence: "No previous score for comparison" };
  const current = calculateSimpleScore(mem);
  const diff = current - prev.score;
  if (diff > 3) return { trend: "improving", evidence: `Score +${diff} since last calculation` };
  if (diff < -3) return { trend: "declining", evidence: `Score ${diff} since last calculation` };
  return { trend: "stable", evidence: `Score changed by ${diff} (normal range)` };
}

function calculateSimpleScore(mem: MemoryStore): number {
  const s = mem.sales;
  const inv = mem.inventory;
  let score = 50;
  if (s.thisMonth.revenue > 0) score += 10; else score -= 10;
  if (s.thisMonth.profit > 0) score += 20; else if (s.thisMonth.revenue > 0) score -= 15;
  if (inv.outOfStockCount > 0) score -= 20; else if (inv.lowStockCount > 0) score -= 10; else score += 10;
  return Math.max(0, Math.min(100, score));
}
