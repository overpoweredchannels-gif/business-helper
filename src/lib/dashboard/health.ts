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
 */

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
