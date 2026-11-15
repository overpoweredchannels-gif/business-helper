import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRecentActivities, RECENT_ACTIVITY_LIMIT } from "../src/lib/dashboard/recent-activity";

// Dashboard Recent Activity slice.
//
// Rule under test: the feed is the 5 most recent activities across sales
// AND purchases, newest first — purchases compete fairly on recency instead
// of being appended after the sales and cut off by the widget's 5-row cap.
// The raw `createdAt` timestamp is a sort key only and never leaks into the
// rendered entry.

const entry = (id: string, type: "sale" | "purchase", createdAt: string) => ({
  id,
  type,
  description: id,
  time: createdAt,
  amount: "Rs100.00",
  createdAt,
});

function main() {
  assert.equal(RECENT_ACTIVITY_LIMIT, 5);

  // 1. Mixed recency: a purchase newer than every sale comes first, and the
  // list is a single time-ordered merge — not sales-first then purchases.
  assert.deepEqual(
    buildRecentActivities([
      entry("sale-old", "sale", "2026-11-10T10:00:00.000Z"),
      entry("purchase-new", "purchase", "2026-11-12T09:00:00.000Z"),
      entry("sale-mid", "sale", "2026-11-11T10:00:00.000Z"),
      entry("purchase-mid", "purchase", "2026-11-11T12:00:00.000Z"),
    ]).map((e) => e.id),
    ["purchase-new", "purchase-mid", "sale-mid", "sale-old"],
  );

  // 2. The old bug, reproduced as a regression case: 5 recent sales plus a
  // newer purchase — the purchase must survive the cap (the old feed built
  // "5 sales then purchases" and the widget's slice(0, 5) dropped it).
  const fiveSalesPlusNewPurchase = buildRecentActivities([
    entry("sale-1", "sale", "2026-11-12T08:01:00.000Z"),
    entry("sale-2", "sale", "2026-11-12T08:02:00.000Z"),
    entry("sale-3", "sale", "2026-11-12T08:03:00.000Z"),
    entry("sale-4", "sale", "2026-11-12T08:04:00.000Z"),
    entry("sale-5", "sale", "2026-11-12T08:05:00.000Z"),
    entry("purchase-newest", "purchase", "2026-11-12T09:00:00.000Z"),
  ]);
  assert.equal(fiveSalesPlusNewPurchase.length, 5);
  assert.equal(fiveSalesPlusNewPurchase[0]?.id, "purchase-newest");
  assert.equal(fiveSalesPlusNewPurchase[0]?.type, "purchase");
  // Newest first: purchase-newest, sale-5, sale-4, sale-3, sale-2 — sale-1
  // is the one pushed out by the cap.
  assert.equal(fiveSalesPlusNewPurchase[4]?.id, "sale-2");

  // 3. More than 5 entries across both types: exactly the 5 newest survive.
  assert.equal(
    buildRecentActivities([
      entry("sale-1", "sale", "2026-11-12T08:01:00.000Z"),
      entry("purchase-1", "purchase", "2026-11-12T08:02:00.000Z"),
      entry("sale-2", "sale", "2026-11-12T08:03:00.000Z"),
      entry("purchase-2", "purchase", "2026-11-12T08:04:00.000Z"),
      entry("sale-3", "sale", "2026-11-12T08:05:00.000Z"),
      entry("purchase-3", "purchase", "2026-11-12T08:06:00.000Z"),
      entry("sale-4", "sale", "2026-11-12T08:07:00.000Z"),
    ]).length,
    5,
  );

  // 4. Single-type lists pass through unchanged (newest first, capped).
  assert.deepEqual(
    buildRecentActivities([
      entry("purchase-1", "purchase", "2026-11-12T08:01:00.000Z"),
      entry("purchase-2", "purchase", "2026-11-12T08:02:00.000Z"),
    ]).map((e) => e.id),
    ["purchase-2", "purchase-1"],
  );
  assert.deepEqual(buildRecentActivities([]), []);

  // 5. The sort key never leaks into the rendered entry, and the input
  // array is not mutated.
  const input = [entry("sale-1", "sale", "2026-11-12T08:01:00.000Z")];
  const [only] = buildRecentActivities(input);
  assert.equal("createdAt" in (only as Record<string, unknown>), false);
  assert.equal(only?.amount, "Rs100.00");
  assert.equal(input[0]?.id, "sale-1");

  // 6. Regression guard for the dashboard purchase amount (15 Nov 2026):
  // the Recent Activity feed renders a purchase's amount from
  // `total_amount` (the invoice total), the same field sales use. The
  // `fetchPurchaseTransactions` query that fills the purchase list MUST
  // select total_amount — when it was missing, every purchase rendered
  // €0.00 (safeNumber(undefined) = 0) while its invoice total was €1.00
  // (live QA, P-50032). This reads the page source and asserts the
  // select includes it, so a future edit that drops the column fails
  // this test instead of silently zeroing every purchase amount.
  {
    const pagePath = fileURLToPath(new URL("../src/app/page.tsx", import.meta.url));
    const pageSource = readFileSync(pagePath, "utf8");
    const purchaseSelect = pageSource.match(
      /\.from\("purchase_transactions"\)\s*\.select\("([^"]*)"\)/,
    );
    assert.ok(purchaseSelect, "fetchPurchaseTransactions must select from purchase_transactions");
    const columns = (purchaseSelect[1] ?? "").split(",").map((c) => c.trim());
    assert.ok(
      columns.includes("total_amount"),
      "fetchPurchaseTransactions must select total_amount so the dashboard shows the purchase invoice total",
    );
  }

  console.log("Dashboard Recent Activity tests passed: merged recency order, purchases survive the 5-row cap, createdAt never leaks.");
}

main();
