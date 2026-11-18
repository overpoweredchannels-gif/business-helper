/**
 * Dashboard AI Insight card (P1 Area B) — the ONE source of truth for
 * which branch of the card renders.
 *
 * Defect: the dashboard builder gated the low-stock fallback on
 * `businessIntelligenceAnalytics.insights.lowStockWarning`, a string
 * that ALWAYS has a value — out of stock -> "{count} product(s) are out
 * of stock.", low stock -> "{count} product(s) are at or below reorder
 * level.", otherwise -> "No urgent low-stock warning in this filtered
 * view." (page.tsx, inside `buildBusinessIntelligenceAnalytics`).
 * Because the string is always truthy, the fallback branch fired
 * whenever there was no AI alert — so the card showed the "no urgent
 * low stock" status string under the "AI Recommendation" heading with a
 * hardcoded 90% confidence, even when there was nothing to warn about.
 *
 * Fix: the branch is decided from the underlying condition — the
 * out-of-stock / low-stock counts the BI builder itself uses — not from
 * the always-truthy string. With no active alert and no stock problem
 * the kind is "none" and the builder returns undefined, so the card is
 * hidden (DashboardView already omits it when `aiInsight` is
 * undefined). The BI `lowStockWarning` string itself is UNCHANGED:
 * the "no urgent" line stays in the BI insight list, where it is an
 * honest status line — it just never reaches this card any more.
 *
 * Out of scope (separate Area J tracker item): the confidence values
 * (85 for the alert branch, 90 for the fallback) are still hardcoded
 * and the "AI Recommendation" heading is unchanged. The alert branch
 * itself is also still the rule-generated alert title/summary, not LLM
 * insight — this slice only fixes which branch fires.
 */

export type DashboardAiInsightKind = "alert" | "fallback" | "none";

export type DashboardAiInsightInput = {
  /** Whether an active/new AI alert exists (the latest one wins). */
  hasActiveAlert: boolean;
  /** Products with current stock <= 0 — the BI builder's condition. */
  outOfStockCount: number;
  /** Products at or below their reorder level — the BI builder's condition. */
  lowStockCount: number;
};

/**
 * Which branch of the AI Insight card renders. An active alert always
 * wins, whatever the stock state. Otherwise the low-stock fallback
 * fires only on a REAL stock problem (out of stock or at/below
 * reorder). With no alert and no stock problem the kind is "none" —
 * the card is hidden, never a "no urgent low stock" status line under
 * an "AI Recommendation" heading.
 */
export function dashboardAiInsightKind(
  input: DashboardAiInsightInput,
): DashboardAiInsightKind {
  if (input.hasActiveAlert) return "alert";
  if (input.outOfStockCount > 0 || input.lowStockCount > 0) return "fallback";
  return "none";
}
