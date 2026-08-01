import { SkillResult, SkillContext, ReorderAdviceOutput } from "../contracts/skills";
import { SkillWarning } from "../contracts/common";
import { MemoryStore } from "../memory/business-memory";

const VERSION = "1.0";
const SKILL_ID = "reorder_advice";

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<ReorderAdviceOutput> {
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

  const products = Array.from(mem.products.values()).filter((p) => p.isActive);
  const recs = products
    .filter((p) => p.currentStock <= p.reorderLevel)
    .slice(0, 20)
    .map((p) => {
      const status = p.currentStock <= 0 ? "out_of_stock"
        : p.currentStock <= p.reorderLevel * 0.5 ? "urgent"
        : "low";
      const suggestedQty = Math.max(p.reorderLevel * 2 - p.currentStock, p.reorderLevel);
      return {
        productId: p.id, productName: p.name, currentStock: p.currentStock,
        reorderLevel: p.reorderLevel, status,
        dailySalesVelocity: p.dailySalesVelocity,
        estimatedDaysLeft: p.estimatedDaysLeft,
        suggestedOrderQuantity: suggestedQty,
        suggestedSupplier: p.lastPurchaseDate ? "last supplier" : null,
        lastPurchasePrice: p.lastPurchasePrice,
        estimatedCost: suggestedQty * p.lastPurchasePrice,
        priority: p.currentStock <= 0 ? "critical" : p.currentStock <= p.reorderLevel * 0.5 ? "high" : "medium",
        reason: p.currentStock <= 0 ? "Out of stock" : `Below reorder level (${p.reorderLevel})`,
      };
    })
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3 };
      return (rank[a.priority as keyof typeof rank] ?? 3) - (rank[b.priority as keyof typeof rank] ?? 3);
    });

  const urgent = recs.filter((r) => r.priority === "critical" || r.priority === "high");
  const totalQty = recs.reduce((s, r) => s + r.suggestedOrderQuantity, 0);
  const totalCost = recs.reduce((s, r) => s + r.estimatedCost, 0);

  if (recs.length === 0) {
    warnings.push({ code: "NO_REORDER_NEEDED", message: "All products are adequately stocked", severity: "info", affectedData: "inventory" });
  }

  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: {
      recommendations: recs,
      summary: {
        totalUrgent: urgent.length,
        totalRecommended: recs.length,
        totalItemsToOrder: totalQty,
        estimatedCost: totalCost,
      },
      metadata: {
        hasReorderLevelData: products.some((p) => p.reorderLevel > 0),
        hasSalesVelocity: products.some((p) => p.dailySalesVelocity > 0),
        warnings: warnings.map((w) => w.message),
      },
    },
    error: null, warnings,
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 1, outputSize: 2 },
  };
}
