/**
 * Business Health bands (P1 Area B) — the ONE source of truth for the
 * dashboard Health score's label and ring colour.
 *
 * Defect: the label bands (page.tsx getBusinessHealthScore) said
 * >= 85 Excellent / >= 70 Good / >= 50 Average / >= 30 Needs Attention /
 * else Critical, while the ring in BusinessHealthCard coloured
 * >= 80 green / >= 60 amber / else red. At 72 the ring was amber under a
 * "Good" label; at 50-59 it was red under an "Average" label; at 80-84
 * it was green under a "Good" label. Ring and label contradicted each
 * other on the same card.
 *
 * Fix: the ring now uses the label bands directly — green for Good or
 * better (>= 70), amber for Average (50-69), red for Needs Attention or
 * Critical (< 50). The colour values are the design-system tokens
 * (never hex — repo AGENTS.md), unchanged from before; only the
 * thresholds moved. Both the label (page.tsx) and the ring
 * (BusinessHealthCard) read from this file, so they cannot drift apart
 * again.
 *
 * P1 Area B, metric-row statuses: the Business Health card's metric rows
 * also derived their statuses here, because two of them were wrong —
 * Profit Margin was hardcoded "good" (a negative margin showed a green
 * dot) and Cash Flow showed "warning" when receivables and payables were
 * both 0 (0 > 0 is false, so empty data looked unhealthy). Both now
 * derive from their values (businessHealthProfitMarginStatus and
 * businessHealthCashFlowStatus below), so a row's dot can never
 * contradict its value.
 */

import type { MessageKey } from "../regional/messages";

export type DashboardHealthOverview = {
  totalSalesAmount: number;
  estimatedNetProfit: number;
  outOfStockCount: number;
  lowStockCount: number;
  customerCollectionsTotal: number;
  expensesTotal: number;
};

export function getBusinessHealthScore(
  overview: DashboardHealthOverview,
  translate: (key: MessageKey) => string = (key) => key,
) {
  let score = 50;
  const reasons: string[] = [];
  if (overview.totalSalesAmount > 0) {
    score += 10;
    reasons.push(translate('page.salesRecordedInPeriod'));
  } else {
    score -= 10;
    reasons.push(translate('page.noSalesInPeriod'));
  }
  if (overview.estimatedNetProfit > 0) {
    score += 20;
    reasons.push(translate('page.netProfitPositive'));
  } else if (overview.totalSalesAmount > 0) {
    score -= 15;
    reasons.push(translate('page.netProfitNotPositive'));
  }
  if (overview.outOfStockCount > 0) {
    score -= 20;
    reasons.push(translate('page.outOfStockProducts').replace('{count}', String(overview.outOfStockCount)));
  } else if (overview.lowStockCount > 0) {
    score -= 10;
    reasons.push(translate('page.lowStockProducts').replace('{count}', String(overview.lowStockCount)));
  } else {
    score += 10;
    reasons.push(translate('page.noUrgentLowStockView'));
  }
  if (overview.customerCollectionsTotal >= overview.totalSalesAmount * 0.5 || overview.totalSalesAmount === 0) {
    score += 10;
    reasons.push(translate('page.collectionsReasonable'));
  } else {
    score -= 10;
    reasons.push(translate('page.collectionsLow'));
  }
  if (overview.expensesTotal > overview.totalSalesAmount && overview.totalSalesAmount > 0) {
    score -= 15;
    reasons.push(translate('page.expensesHigher'));
  } else {
    score += 5;
    reasons.push(translate('page.expensesNotHigher'));
  }
  const boundedScore = Math.max(0, Math.min(100, score));
  const label = businessHealthLabel(boundedScore);
  return { score: boundedScore, label, reasons };
}

export type BusinessHealthLabel =
  | "Excellent"
  | "Good"
  | "Average"
  | "Needs Attention"
  | "Critical";

export function businessHealthLabel(score: number): BusinessHealthLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Average";
  if (score >= 30) return "Needs Attention";
  return "Critical";
}

export type BusinessHealthRingColor =
  | "var(--color-success)"
  | "var(--color-warning-text)"
  | "var(--color-destructive)";

/** Ring colour token for a Health score, aligned to the label bands. */
export function businessHealthRingColor(score: number): BusinessHealthRingColor {
  if (score >= 70) return "var(--color-success)";
  if (score >= 50) return "var(--color-warning-text)";
  return "var(--color-destructive)";
}

export type BusinessHealthMetricStatus = "good" | "warning" | "critical";

/**
 * Status dot for the Profit Margin metric row, derived from the margin
 * percentage ((estimatedNetProfit / totalSalesAmount) * 100, or 0 when
 * there are no sales). A negative margin is a loss, so it is "critical"
 * and must never show a green dot; zero margin is "warning"; a positive
 * margin is "good".
 */
export function businessHealthProfitMarginStatus(marginPercent: number): BusinessHealthMetricStatus {
  if (marginPercent < 0) return "critical";
  if (marginPercent === 0) return "warning";
  return "good";
}

/**
 * Status dot for the Cash Flow metric row, derived from outstanding
 * receivables vs payables. Receivables at or above payables is "good" —
 * that includes both being 0, which means nothing is outstanding and
 * must not look unhealthy. Receivables below payables is "warning".
 */
export function businessHealthCashFlowStatus(
  receivables: number,
  payables: number,
): BusinessHealthMetricStatus {
  if (receivables >= payables) return "good";
  return "warning";
}
