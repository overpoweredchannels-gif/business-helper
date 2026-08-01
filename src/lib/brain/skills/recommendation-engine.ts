import { SkillResult, SkillContext, RecommendationOutput } from "../contracts/skills";
import { SkillWarning } from "../contracts/common";
import { MemoryStore } from "../memory/business-memory";

const VERSION = "1.0";
const SKILL_ID = "recommendation_engine";

const CATEGORIES = ["inventory", "customers", "finances", "staff", "general"] as const;

export function execute(input: { categories?: typeof CATEGORIES[number][] }, context: SkillContext): SkillResult<RecommendationOutput> {
  const startTime = performance.now();
  const warnings: SkillWarning[] = [];
  const mem = context.memory;
  const categories: typeof CATEGORIES[number][] = input.categories || [...CATEGORIES];

  if (mem.isEmpty) {
    return {
      skillId: SKILL_ID, version: VERSION, success: false,
      data: null, error: { code: "MEMORY_EMPTY", message: "No business data loaded", detail: "", recoverable: true },
      warnings, metrics: { executionTimeMs: performance.now() - startTime, inputSize: 0, outputSize: 0 },
    };
  }

  const allRecs: RecommendationOutput["recommendations"] = [];

  if (categories.includes("inventory")) {
    const inv = mem.inventory;
    if (inv.outOfStockCount > 0) {
      allRecs.push({ id: `rec_inv_1_${Date.now()}`, type: "reorder", category: "inventory", priority: "high", title: `${inv.outOfStockCount} products out of stock`, description: "Out-of-stock products are causing lost revenue. Prioritize reordering.", expectedImpact: "Revenue recovery", actionLink: "/products?filter=oos", sourceSkill: SKILL_ID });
    }
    if (inv.lowStockCount > 5) {
      allRecs.push({ id: `rec_inv_2_${Date.now()}`, type: "reorder", category: "inventory", priority: "medium", title: `${inv.lowStockCount} products low in stock`, description: "Review low-stock items and create a reorder plan.", expectedImpact: "Prevent stockouts", actionLink: "/products?filter=low", sourceSkill: SKILL_ID });
    }
    if (inv.overstockedCount > 5) {
      allRecs.push({ id: `rec_inv_3_${Date.now()}`, type: "reorder", category: "inventory", priority: "low", title: `${inv.overstockedCount} products overstocked`, description: "Overstocked items tie up capital. Consider promotions.", expectedImpact: "Free up working capital", actionLink: "/products?filter=overstocked", sourceSkill: SKILL_ID });
    }
  }

  if (categories.includes("customers")) {
    const customers = Array.from(mem.customers.values());
    const overdue = customers.filter((c) => c.overdueAmount > 0);
    if (overdue.length > 0) {
      const totalOverdue = overdue.reduce((s, c) => s + c.overdueAmount, 0);
      allRecs.push({ id: `rec_cust_1_${Date.now()}`, type: "follow_up", category: "customers", priority: "high", title: `${overdue.length} customers overdue (PKR ${totalOverdue.toLocaleString("en-PK")})`, description: "Follow up on overdue payments to improve cash flow.", expectedImpact: "Cash flow improvement", actionLink: "/customers?filter=overdue", sourceSkill: SKILL_ID });
    }
    const topCustomer = [...customers].sort((a, b) => b.totalSales30d - a.totalSales30d)[0];
    if (topCustomer && topCustomer.totalSales30d > 0) {
      allRecs.push({ id: `rec_cust_2_${Date.now()}`, type: "follow_up", category: "customers", priority: "low", title: `Top customer: ${topCustomer.name}`, description: `Revenue PKR ${topCustomer.totalSales30d.toLocaleString("en-PK")}. Consider loyalty program.`, expectedImpact: "Customer retention", actionLink: "/customers", sourceSkill: SKILL_ID });
    }
  }

  if (categories.includes("finances")) {
    const e = mem.expenses;
    const s = mem.sales;
    if (e.anomalies.length > 0) {
      const high = e.anomalies.filter((a) => a.severity === "high");
      if (high.length > 0) {
        allRecs.push({ id: `rec_fin_1_${Date.now()}`, type: "expense_review", category: "finances", priority: "high", title: `${high.length} unusual expense(s) detected`, description: "Unusual expense patterns may indicate errors.", expectedImpact: "Cost control", actionLink: "/expenses?view=anomalies", sourceSkill: SKILL_ID });
      }
    }
    if (s.thisMonth.profitMargin !== null && s.thisMonth.profitMargin < 10) {
      allRecs.push({ id: `rec_fin_2_${Date.now()}`, type: "expense_review", category: "finances", priority: "medium", title: `Low profit margin (${Math.round(s.thisMonth.profitMargin)}%)`, description: "Review pricing and costs to improve margins.", expectedImpact: "Profitability improvement", actionLink: "/analytics", sourceSkill: SKILL_ID });
    }
  }

  if (categories.includes("general")) {
    const hs = mem.analytics.healthScore;
    if (hs.score < 50) {
      allRecs.push({ id: `rec_gen_1_${Date.now()}`, type: "health_alert", category: "general", priority: "high", title: `Business health: ${hs.score}/100`, description: hs.reasons[0] || "Multiple areas need attention.", expectedImpact: "Business stability", actionLink: "/analytics", sourceSkill: SKILL_ID });
    }
    if (hs.score >= 85) {
      allRecs.push({ id: `rec_gen_2_${Date.now()}`, type: "health_alert", category: "general", priority: "low", title: `Excellent health (${hs.score}/100)`, description: "Business is performing well. Maintain current trends.", expectedImpact: "Sustained growth", actionLink: "/analytics", sourceSkill: SKILL_ID });
    }
  }

  const sorted = allRecs.sort((a, b) => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2);
  });

  const byCategory: Record<string, number> = {};
  for (const r of sorted) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  }

  const pCount = { high: 0, medium: 0, low: 0 };
  for (const r of sorted) {
    pCount[r.priority as keyof typeof pCount]++;
  }

  const skillsConsulted = [...new Set(sorted.map((r) => r.sourceSkill))];

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: {
      recommendations: sorted.slice(0, 20),
      summary: { total: sorted.length, highPriority: pCount.high, mediumPriority: pCount.medium, lowPriority: pCount.low, byCategory },
      metadata: { skillsConsulted, warnings: warnings.map((w) => w.message) },
    },
    error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 1, outputSize: sorted.length + 1 },
  };
}
