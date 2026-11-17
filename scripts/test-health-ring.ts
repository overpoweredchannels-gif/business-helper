/**
 * Business Health ring vs label bands (P1 Area B) — Unit Tests.
 *
 * Defect: the label bands (page.tsx getBusinessHealthScore) said
 * >= 85 Excellent / >= 70 Good / >= 50 Average / >= 30 Needs Attention /
 * else Critical, while the ring in BusinessHealthCard coloured
 * >= 80 green / >= 60 amber / else red. At 72 the ring was amber under a
 * "Good" label; at 50-59 it was red under an "Average" label; at 80-84
 * it was green under a "Good" label. Ring and label contradicted each
 * other on the same card.
 *
 * Fix: the ring thresholds now match the label bands — green for Good or
 * better (>= 70), amber for Average (50-69), red for Needs Attention or
 * Critical (< 50). Both the label and the ring read from the one shared
 * helper (src/lib/dashboard/health.ts), so they cannot drift apart again.
 * The colour values are the design-system tokens, unchanged from before;
 * only the thresholds moved.
 *
 * This test imports the production helper directly (no mirroring) and
 * asserts the exact label and the exact ring colour token at every
 * band boundary, plus a full 0-100 agreement sweep: green only ever
 * pairs with Good/Excellent, amber only with Average, red only with
 * Needs Attention/Critical.
 *
 * Run: npx tsx scripts/test-health-ring.ts
 */

import assert from "node:assert/strict";
import {
  businessHealthLabel,
  businessHealthRingColor,
  type BusinessHealthLabel,
} from "../src/lib/dashboard/health";

const GREEN = "var(--color-success)";
const AMBER = "var(--color-warning-text)";
const RED = "var(--color-destructive)";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function checkBand(score: number, expectedLabel: BusinessHealthLabel, expectedRing: string): void {
  check(
    businessHealthLabel(score) === expectedLabel,
    `score ${score}: label is "${expectedLabel}"`,
  );
  check(
    businessHealthRingColor(score) === expectedRing,
    `score ${score}: ring is ${expectedRing === GREEN ? "green" : expectedRing === AMBER ? "amber" : "red"}`,
  );
}

function main(): void {
  console.log("\n=== Band boundaries: exact label + exact ring colour ===\n");

  // Critical / red — below 30.
  checkBand(0, "Critical", RED);
  checkBand(29, "Critical", RED);
  // Needs Attention / red — 30-49.
  checkBand(30, "Needs Attention", RED);
  checkBand(49, "Needs Attention", RED);
  // Average / amber — 50-69.
  checkBand(50, "Average", AMBER);
  checkBand(69, "Average", AMBER);
  // Good / green — 70-84.
  checkBand(70, "Good", GREEN);
  checkBand(84, "Good", GREEN);
  // Excellent / green — 85+.
  checkBand(85, "Excellent", GREEN);
  checkBand(100, "Excellent", GREEN);

  console.log("\n=== The three mismatches the fix removes ===\n");

  // 72 was amber under a "Good" label; now green.
  check(businessHealthRingColor(72) === GREEN, "score 72 (Good): ring is now green, was amber");
  check(businessHealthLabel(72) === "Good", "score 72: label is still Good");
  // 50-59 was red under an "Average" label; now amber.
  check(businessHealthRingColor(55) === AMBER, "score 55 (Average): ring is now amber, was red");
  check(businessHealthLabel(55) === "Average", "score 55: label is still Average");
  // 80-84 was green under a "Good" label; still green, and now consistent
  // because green means Good-or-better rather than Excellent-only.
  check(businessHealthRingColor(82) === GREEN, "score 82 (Good): ring is green");
  check(businessHealthLabel(82) === "Good", "score 82: label is Good — green now means Good-or-better");

  console.log("\n=== Agreement sweep: every score 0-100 ===\n");

  let sweepChecked = 0;
  for (let score = 0; score <= 100; score++) {
    const label = businessHealthLabel(score);
    const ring = businessHealthRingColor(score);
    if (ring === GREEN) {
      assert.ok(
        label === "Good" || label === "Excellent",
        `score ${score}: green ring must pair with Good/Excellent, got "${label}"`,
      );
    } else if (ring === AMBER) {
      assert.ok(label === "Average", `score ${score}: amber ring must pair with Average, got "${label}"`);
    } else {
      assert.ok(
        label === "Needs Attention" || label === "Critical",
        `score ${score}: red ring must pair with Needs Attention/Critical, got "${label}"`,
      );
    }
    sweepChecked++;
  }
  passed++;
  console.log(`  ✓ all ${sweepChecked} scores 0-100: ring colour and label never contradict each other`);

  console.log("\n=== Colour values are the design-system tokens (no hex) ===\n");

  for (const score of [0, 50, 70, 100]) {
    check(
      !businessHealthRingColor(score).startsWith("#"),
      `score ${score}: ring colour is a token, not a hardcoded hex value`,
    );
  }

  console.log(`\n${passed} passed, 0 failed`);
}

main();
