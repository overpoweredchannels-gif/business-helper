/**
 * Needs Attention tiles (P1 Area B) — Unit Tests.
 *
 * Defects (tracker Area B line 59):
 *
 * (1) NO DEEP FILTER — the tile click handler sent "Collection Tasks",
 * "Customer Follow-ups" and "Expiring Stock Checks" all to
 * `setTaskFilter("all")` + Task Manager, so every tile landed on the
 * unfiltered task list. The Task Manager filter only supported status
 * values; there was no per-type filter at all. Fix: three new type
 * filter values, wired into the Task Manager select and into
 * `filteredTasks` via `taskMatchesTypeFilter`. Each tile now lands on
 * its own type (payment_collection / follow_ups / stock_check).
 *
 * (2) UNPAID PURCHASES OVERSTATEMENT + NO DEEP LINK — `paymentsDue`
 * counted a purchase as due when its remaining payable was finite and
 * > 0, but when there was NO allocation record it counted it as due
 * (`: true`). The allocation map covers every purchase transaction
 * (built by reducing over all of them) with the remaining floored at
 * 0, so the fallback could only fire on corrupt data — but the rule
 * was wrong. Fix: `isUnpaidPurchase` — a missing or non-finite record
 * is NOT counted. The tile also just opened supplier-payments (a
 * per-supplier payment form, no list). Fix: it now lands on Purchase
 * History with the new "outstanding" payment filter, which matches
 * exactly the tile's count rule (remaining > 0 = unpaid OR
 * partially_paid).
 *
 * (3) URGENT REORDERS NO FILTER + COUNT MISMATCH — the tile just did
 * `handleSectionChange("inventory")`, so the user landed on the
 * inventory dashboard with the reorder filter at "all" while the tile
 * showed the STRICT urgent count. Fix: the tile sets the reorder
 * filter to "Urgent Reorder" on arrival — the same string the urgent
 * count itself counts — so the arrival list is exactly the tile's set.
 * The count itself is unchanged (the strict urgent count was already
 * correct after the low-stock unification slice, cc2a1c3).
 *
 * (4) EXPIRING STOCK CHECKS FRAGILE TITLE MATCH — BUILT in the
 * expiry-check-type slice (Option A, UMAIR-approved 2026-11-18) and
 * covered by scripts/test-expiry-check-type.ts: the count was
 * `task_type === "stock_check" && title.toLowerCase().includes("expir")`.
 * A structured task type "expiry_check" now exists (taskTypes), the
 * count is `countExpiringStockChecks` (pending tasks of that type, no
 * title matching), and the tile deep-links to "expiry_check" (see the
 * updated assertion below). No DB migration was needed: task_type is
 * a plain string with no enum/check constraint.
 *
 * This test imports the production helpers directly (no mirroring).
 *
 * Run: npx tsx scripts/test-needs-attention-filters.ts
 */

import assert from "node:assert/strict";
import {
  isUnpaidPurchase,
  matchesPurchasePaymentFilter,
  NEEDS_ATTENTION_OUTSTANDING_PAYMENT_FILTER,
  NEEDS_ATTENTION_URGENT_REORDER_FILTER,
  reorderRecommendationMatchesFilter,
  taskFilterForNeedsAttentionTile,
  taskMatchesTypeFilter,
  type PurchasePaymentStatus,
} from "../src/lib/dashboard/needs-attention";
import { messages } from "../src/lib/regional/messages";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function main(): void {
  console.log("\n=== (a) Each task tile maps to its OWN Task Manager filter (never 'all') ===\n");

  check(
    taskFilterForNeedsAttentionTile("Collection Tasks") === "payment_collection",
    '"Collection Tasks" -> "payment_collection" (not "all")',
  );
  check(
    taskFilterForNeedsAttentionTile("Customer Follow-ups") === "follow_ups",
    '"Customer Follow-ups" -> "follow_ups" (not "all")',
  );
  check(
    taskFilterForNeedsAttentionTile("Expiring Stock Checks") === "expiry_check",
    '"Expiring Stock Checks" -> "expiry_check" (not "all")',
  );
  check(
    taskFilterForNeedsAttentionTile("Pending Approvals") === null,
    '"Pending Approvals" -> null (goes to sales orders, not the Task Manager)',
  );
  check(
    taskFilterForNeedsAttentionTile("Unpaid Purchases") === null,
    '"Unpaid Purchases" -> null (goes to Purchase History, not the Task Manager)',
  );
  check(
    taskFilterForNeedsAttentionTile("Urgent Reorders") === null,
    '"Urgent Reorders" -> null (goes to inventory, not the Task Manager)',
  );
  check(
    taskFilterForNeedsAttentionTile("Something Else") === null,
    'unknown tile -> null (never a made-up filter value)',
  );

  console.log("\n=== (b) taskMatchesTypeFilter: the type values match only their own type ===\n");

  check(
    taskMatchesTypeFilter("payment_collection", "payment_collection") === true,
    '"payment_collection" filter matches a payment_collection task',
  );
  check(
    taskMatchesTypeFilter("customer_follow_up", "payment_collection") === false,
    '"payment_collection" filter does NOT match a customer_follow_up task',
  );
  check(
    taskMatchesTypeFilter("customer_follow_up", "follow_ups") === true,
    '"follow_ups" filter matches a customer_follow_up task',
  );
  check(
    taskMatchesTypeFilter("sales_follow_up", "follow_ups") === true,
    '"follow_ups" filter matches a sales_follow_up task (the tile counts both types)',
  );
  check(
    taskMatchesTypeFilter("payment_collection", "follow_ups") === false,
    '"follow_ups" filter does NOT match a payment_collection task',
  );
  check(
    taskMatchesTypeFilter("stock_check", "follow_ups") === false,
    '"follow_ups" filter does NOT match a stock_check task',
  );
  check(
    taskMatchesTypeFilter("stock_check", "stock_check") === true,
    '"stock_check" filter matches a stock_check task',
  );
  check(
    taskMatchesTypeFilter("general", "stock_check") === false,
    '"stock_check" filter does NOT match a general task',
  );
  check(
    taskMatchesTypeFilter("payment_collection", "all") === false,
    '"all" is NOT a type filter — the status branches own it',
  );
  check(
    taskMatchesTypeFilter("payment_collection", "pending") === false,
    '"pending" is NOT a type filter — the status branches own it',
  );
  check(
    taskMatchesTypeFilter("payment_collection", "overdue") === false,
    '"overdue" is NOT a type filter — the status branches own it',
  );

  console.log("\n=== (c) isUnpaidPurchase: only a finite remaining > 0 counts ===\n");

  check(isUnpaidPurchase(10) === true, "remaining 10 -> counted");
  check(isUnpaidPurchase(0.01) === true, "remaining 0.01 -> counted");
  check(isUnpaidPurchase(0) === false, "remaining 0 (fully paid) -> NOT counted");
  check(isUnpaidPurchase(-5) === false, "remaining -5 -> NOT counted");
  check(
    isUnpaidPurchase(undefined) === false,
    "NO allocation record (undefined) -> NOT counted (the old `: true` fallback is gone)",
  );
  check(
    isUnpaidPurchase(null) === false,
    "NO allocation record (null) -> NOT counted",
  );
  check(
    isUnpaidPurchase(NaN) === false,
    "non-finite remaining (NaN, corrupt data) -> NOT counted",
  );
  check(
    isUnpaidPurchase(Infinity) === false,
    "non-finite remaining (Infinity) -> NOT counted",
  );

  // The tile count rule on a synthetic ledger: exactly the rows with a
  // finite remaining > 0 — the missing-record row is no longer counted.
  const ledger: Array<{ id: string; remaining: number | undefined }> = [
    { id: "P-1", remaining: 100 },
    { id: "P-2", remaining: 0 },
    { id: "P-3", remaining: 0.5 },
    { id: "P-4", remaining: undefined },
    { id: "P-5", remaining: 25 },
  ];
  check(
    ledger.filter((tx) => isUnpaidPurchase(tx.remaining)).map((tx) => tx.id).join(",") ===
      "P-1,P-3,P-5",
    "synthetic ledger: count is P-1, P-3, P-5 (3) — P-2 paid, P-4 no record",
  );

  console.log("\n=== (d) matchesPurchasePaymentFilter: 'outstanding' is unpaid OR partially paid ===\n");

  const statuses: PurchasePaymentStatus[] = ["paid", "partially_paid", "unpaid", "returned"];
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "all")).length === 4,
    '"all" matches all four payment statuses',
  );
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "outstanding")).join(",") ===
      "partially_paid,unpaid",
    '"outstanding" matches exactly partially_paid + unpaid (both still owe money)',
  );
  check(
    matchesPurchasePaymentFilter("paid", "outstanding") === false,
    '"outstanding" does NOT match a paid purchase',
  );
  check(
    matchesPurchasePaymentFilter("returned", "outstanding") === false,
    '"outstanding" does NOT match a fully returned purchase (remaining 0)',
  );
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "unpaid")).join(",") === "unpaid",
    '"unpaid" still matches only unpaid (unchanged behaviour)',
  );
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "partially_paid")).join(",") ===
      "partially_paid",
    '"partially_paid" still matches only partially_paid (unchanged behaviour)',
  );
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "paid")).join(",") === "paid",
    '"paid" still matches only paid (unchanged behaviour)',
  );
  check(
    statuses.filter((s) => matchesPurchasePaymentFilter(s, "returned")).join(",") === "returned",
    '"returned" still matches only returned (unchanged behaviour)',
  );
  check(
    NEEDS_ATTENTION_OUTSTANDING_PAYMENT_FILTER === "outstanding",
    'the tile\'s arrival filter value is exactly "outstanding"',
  );

  // The count correspondence that makes the deep link sound: on the
  // same synthetic ledger, the tile count (remaining > 0) and the
  // "outstanding" filter select the same rows.
  const purchaseRows: Array<{ id: string; status: PurchasePaymentStatus; remaining: number | undefined }> = [
    { id: "P-1", status: "unpaid", remaining: 100 },
    { id: "P-2", status: "paid", remaining: 0 },
    { id: "P-3", status: "partially_paid", remaining: 0.5 },
    { id: "P-4", status: "returned", remaining: 0 },
    { id: "P-5", status: "unpaid", remaining: 25 },
  ];
  const tileCounted = purchaseRows.filter((row) => isUnpaidPurchase(row.remaining)).map((row) => row.id);
  const filterShown = purchaseRows
    .filter((row) => matchesPurchasePaymentFilter(row.status, "outstanding"))
    .map((row) => row.id);
  check(
    tileCounted.join(",") === filterShown.join(",") && tileCounted.join(",") === "P-1,P-3,P-5",
    'tile count (remaining > 0) and "outstanding" filter select the same rows: P-1, P-3, P-5',
  );
  check(
    purchaseRows
      .filter((row) => matchesPurchasePaymentFilter(row.status, "unpaid"))
      .map((row) => row.id)
      .join(",") === "P-1,P-5",
    'the plain "unpaid" filter would have DROPPED the partially paid P-3 — that is why the tile needs "outstanding"',
  );

  console.log("\n=== (e) reorderRecommendationMatchesFilter: 'Urgent Reorder' selects exactly the urgent set ===\n");

  check(
    NEEDS_ATTENTION_URGENT_REORDER_FILTER === "Urgent Reorder",
    'the tile\'s arrival filter value is exactly "Urgent Reorder" (the status the count counts)',
  );
  const rec = (status: string, missingReorderLevel = false) => ({ status, missingReorderLevel });
  check(
    reorderRecommendationMatchesFilter(rec("Urgent Reorder"), "Urgent Reorder") === true,
    '"Urgent Reorder" filter matches an Urgent Reorder row',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Out of Stock"), "Urgent Reorder") === false,
    '"Urgent Reorder" filter does NOT match an Out of Stock row (the tile is strict, not loose)',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Healthy"), "Urgent Reorder") === false,
    '"Urgent Reorder" filter does NOT match a Healthy row',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Missing Reorder Level", true), "Urgent Reorder") === false,
    '"Urgent Reorder" filter does NOT match a Missing Reorder Level row',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Urgent Reorder"), "all") === true &&
      reorderRecommendationMatchesFilter(rec("Out of Stock"), "all") === true &&
      reorderRecommendationMatchesFilter(rec("Healthy"), "all") === true,
    '"all" still matches every row (unchanged behaviour)',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Out of Stock"), "Out of Stock") === true,
    '"Out of Stock" filter still matches only Out of Stock rows (unchanged behaviour)',
  );
  check(
    reorderRecommendationMatchesFilter(rec("Missing Reorder Level", true), "missing-reorder-level") === true &&
      reorderRecommendationMatchesFilter(rec("Healthy", false), "missing-reorder-level") === false,
    '"missing-reorder-level" still matches only rows with no reorder level (unchanged behaviour)',
  );

  // The count correspondence: on a synthetic recommendation list, the
  // urgent count (status === "Urgent Reorder") and the tile's arrival
  // filter select the same rows — including the live dashboard values
  // (2 urgent out of 18 out of stock + the rest).
  const recommendations = [
    rec("Out of Stock"),
    rec("Out of Stock"),
    rec("Urgent Reorder"),
    rec("Urgent Reorder"),
    rec("Healthy"),
    rec("Missing Reorder Level", true),
  ];
  const urgentCounted = recommendations.filter((r) => r.status === "Urgent Reorder");
  const filterShownRecs = recommendations.filter((r) =>
    reorderRecommendationMatchesFilter(r, NEEDS_ATTENTION_URGENT_REORDER_FILTER),
  );
  check(
    urgentCounted.length === 2 && filterShownRecs.length === 2,
    "synthetic list: urgent count is 2 and the arrival filter shows exactly those 2 rows",
  );

  console.log("\n=== (f) New translation key buy.statusOutstanding exists in all 4 locales ===\n");

  for (const language of ["en", "es", "it", "ur"] as const) {
    const value = messages[language]["buy.statusOutstanding"];
    check(
      typeof value === "string" && value.trim().length > 0,
      `"buy.statusOutstanding" exists and is non-empty in ${language} ("${value}")`,
    );
  }
  check(
    messages.en["buy.statusOutstanding"] === "Outstanding",
    'en "buy.statusOutstanding" is "Outstanding"',
  );

  console.log(`\nAll ${passed} Needs Attention filter checks passed.\n`);
}

main();
