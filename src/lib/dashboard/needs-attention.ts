/**
 * Needs Attention tiles (P1 Area B) — the ONE source of truth for where
 * each tile deep-links and which rows its count covers.
 *
 * Defects (tracker Area B line 59):
 *
 * (1) NO DEEP FILTER — the tile click handler sent "Collection Tasks",
 * "Customer Follow-ups" and "Expiring Stock Checks" all to
 * `setTaskFilter("all")` + Task Manager, so every tile landed on the
 * unfiltered task list. The Task Manager filter only supported status
 * values (all / pending / in_progress / completed / cancelled /
 * overdue / due_today / high_urgent) — there was no per-type filter
 * at all. Fix: three new type filter values (`taskFilterForNeedsAttentionTile`
 * + `taskMatchesTypeFilter`), wired into the Task Manager select and
 * into `filteredTasks`. Each tile now lands on its own type:
 * payment_collection / follow_ups (customer_follow_up OR
 * sales_follow_up — the same two types the tile counts) / expiry_check
 * (the Expiring Stock Checks tile's own structured type; it used to
 * land on stock_check, which was the pre-Option-A arrival).
 * The filter is a single select, so it filters by type only: the
 * tile's number is the PENDING count for that type while the arrival
 * list shows the type's tasks in every status. That is an honest
 * consequence of the one-dimensional filter, not a miscount — the
 * filter label names the type, and the pending tasks are the ones
 * still actionable on it.
 *
 * (2) UNPAID PURCHASES OVERSTATEMENT + NO DEEP LINK — `paymentsDue`
 * counted a purchase as due when `remainingPayableAmount` was finite
 * and > 0, but when there was NO allocation record at all it counted
 * it as due (`: true`). The allocation map is built by reducing over
 * ALL purchaseTransactions (page.tsx, `supplierPaymentAllocationByPurchaseTransaction`),
 * and `netPurchaseInvoiceAllocation` floors the remaining at 0 — so
 * every transaction HAS a finite record in normal operation and the
 * `: true` fallback could only fire on corrupt (non-finite) data.
 * Fix: `isUnpaidPurchase` — a missing or non-finite record is NOT
 * counted. The live count is unchanged (the map is complete), but the
 * rule no longer counts what it cannot see. The tile also had no
 * per-invoice deep link (it just opened supplier-payments, a
 * per-supplier payment form with no list). Fix: it now lands on
 * Purchase History with the new "outstanding" payment filter
 * (`matchesPurchasePaymentFilter`), which matches exactly the tile's
 * count rule — remaining > 0, i.e. badge "unpaid" OR "partially_paid"
 * (a partially paid purchase is still owed, so the plain "unpaid"
 * filter would have dropped it and the arrival list would not have
 * matched the count). The other filters are reset to their defaults
 * on arrival so nothing else narrows the list.
 *
 * (3) URGENT REORDERS NO FILTER + COUNT MISMATCH — the tile just did
 * `handleSectionChange("inventory")`, so the user landed on the
 * inventory dashboard with the reorder filter at "all" while the tile
 * showed the STRICT urgent count (2 live). Fix: the tile now sets the
 * reorder filter to "Urgent Reorder" (and the inventory tab to
 * "dashboard", clearing the search) on arrival. The filter value is
 * the same string the urgent count itself counts
 * (`recommendation.status === "Urgent Reorder"`), so the arrival list
 * is exactly the tile's set — proven by `reorderRecommendationMatchesFilter`,
 * which is the filter predicate the list itself uses. The count itself
 * is UNCHANGED (the strict urgent count was already correct after the
 * low-stock unification slice, cc2a1c3). "Low Stock Alerts" (KPI) gets
 * the same arrival: its value IS the urgent count.
 *
 * (4) EXPIRING STOCK CHECKS FRAGILE TITLE MATCH — DONE (Option A,
 * UMAIR-approved 2026-11-18): the count was `task_type ===
 * "stock_check" && title.toLowerCase().includes("expir")`, i.e.
 * derived from the task TITLE. Fix: a structured task type
 * "expiry_check" now exists in `taskTypes` (constants.ts), so the
 * manual task form offers it and stores it as a plain string — no DB
 * migration (task_type has no enum/check constraint anywhere; the
 * form already stores arbitrary taskTypes values). The count is
 * `countExpiringStockChecks` — pending tasks whose task_type is
 * "expiry_check", with NO title matching anywhere in the count path.
 * Existing stock_check tasks are NOT re-typed (including any with
 * "expir" in the title): they stay stock_check and simply do not
 * count. The Task Manager filter gained its own "expiry_check"
 * option (labelled Expiring Stock Checks) and the old "stock_check"
 * option is now honestly labelled "Stock Checks" (new key
 * `task.stockChecks` ×4); the tile deep-links to "expiry_check".
 * The filter still matches "stock_check" tasks when that value is
 * selected directly (`taskMatchesTypeFilter` keeps the case).
 *
 * Out of scope: "Pending Approvals" already deep-links to sales orders
 * pending_approval (unchanged); "Outstanding Payables" (KPI) keeps its
 * existing supplier-payments destination (unchanged); "Inventory Value"
 * (KPI) keeps its plain inventory destination (unchanged).
 */

export type NeedsAttentionTileKey =
  | "Pending Approvals"
  | "Collection Tasks"
  | "Unpaid Purchases"
  | "Urgent Reorders"
  | "Customer Follow-ups"
  | "Expiring Stock Checks";

/** Task Manager filter values the Needs Attention tiles deep-link to. */
export type NeedsAttentionTaskFilter =
  | "payment_collection"
  | "follow_ups"
  | "expiry_check";

/**
 * The Task Manager filter value a Needs Attention tile lands on, or
 * null when the tile does not go to the Task Manager at all
 * ("Pending Approvals" -> sales orders; "Unpaid Purchases" ->
 * Purchase History; "Urgent Reorders" -> inventory). Never "all":
 * every task tile lands on its own type.
 */
export function taskFilterForNeedsAttentionTile(
  tileKey: string,
): NeedsAttentionTaskFilter | null {
  switch (tileKey) {
    case "Collection Tasks":
      return "payment_collection";
    case "Customer Follow-ups":
      return "follow_ups";
    case "Expiring Stock Checks":
      return "expiry_check";
    default:
      return null;
  }
}

/**
 * Whether a task's type matches a Task Manager filter value. The type
 * values are the ones the Needs Attention tiles deep-link to plus the
 * "stock_check" value the Task Manager select still offers directly:
 * "payment_collection" matches only payment_collection tasks;
 * "follow_ups" matches customer_follow_up OR sales_follow_up (the same
 * two types the Customer Follow-ups tile counts); "expiry_check"
 * matches only expiry_check tasks (the Expiring Stock Checks tile's
 * set); "stock_check" matches only stock_check tasks. Any other
 * filter value (status values, "all", …) is NOT a type filter and
 * never matches here — the status branches of `filteredTasks` own
 * those.
 */
export function taskMatchesTypeFilter(
  taskType: string,
  filter: string,
): boolean {
  switch (filter) {
    case "payment_collection":
      return taskType === "payment_collection";
    case "follow_ups":
      return taskType === "customer_follow_up" || taskType === "sales_follow_up";
    case "expiry_check":
      return taskType === "expiry_check";
    case "stock_check":
      return taskType === "stock_check";
    default:
      return false;
  }
}

/**
 * The Expiring Stock Checks tile count: the number of PENDING tasks
 * whose structured type is "expiry_check". The caller passes the
 * pending-only list (page.tsx `pendingTasks`), so this helper checks
 * the type only — the status is already settled. There is NO title
 * matching here by design: a stock_check task whose title mentions
 * "expir" does NOT count, and an expiry_check task counts whatever
 * its title says. Existing stock_check tasks are never re-typed.
 */
export function countExpiringStockChecks(
  pendingTasks: ReadonlyArray<{ task_type: string }>,
): number {
  return (
    pendingTasks.filter((task) => task.task_type === "expiry_check")
      .length || 0
  );
}

/**
 * Whether a purchase is counted in the Unpaid Purchases tile: its
 * allocation record must exist AND its remaining payable must be a
 * finite number greater than 0. A missing record (no allocation entry
 * for the transaction) or a non-finite remaining (corrupt data) is
 * NOT counted — the old code counted both as due (`: true`), which
 * overstated the count. In normal operation every purchase
 * transaction has a record (the allocation map is built over all of
 * them) with the remaining floored at 0, so the live count is
 * unchanged — the rule just no longer counts what it cannot see.
 */
export function isUnpaidPurchase(
  remainingPayableAmount: number | null | undefined,
): boolean {
  return (
    typeof remainingPayableAmount === "number" &&
    Number.isFinite(remainingPayableAmount) &&
    remainingPayableAmount > 0
  );
}

export type PurchasePaymentStatus =
  | "paid"
  | "partially_paid"
  | "unpaid"
  | "returned";

/** The Purchase History payment filter value the Unpaid Purchases tile lands on. */
export const NEEDS_ATTENTION_OUTSTANDING_PAYMENT_FILTER = "outstanding";

/**
 * Whether a purchase's payment status matches a Purchase History
 * payment filter value. "all" matches everything; any other value
 * matches its own status — except "outstanding", which matches
 * "unpaid" OR "partially_paid": both still owe money (remaining > 0),
 * so both belong to the Unpaid Purchases tile's set. The plain
 * "unpaid" value would drop partially paid purchases and the arrival
 * list would not match the tile's count.
 */
export function matchesPurchasePaymentFilter(
  paymentStatus: PurchasePaymentStatus,
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === NEEDS_ATTENTION_OUTSTANDING_PAYMENT_FILTER) {
    return paymentStatus === "unpaid" || paymentStatus === "partially_paid";
  }
  return paymentStatus === filter;
}

/** The inventory reorder filter value the Urgent Reorders tile lands on. */
export const NEEDS_ATTENTION_URGENT_REORDER_FILTER = "Urgent Reorder";

/**
 * Whether a reorder recommendation row matches the inventory reorder
 * filter — the predicate the inventory list itself uses. "all" shows
 * everything; "missing-reorder-level" shows only rows with no reorder
 * level set; any other value matches the recommendation's status
 * exactly. In particular the tile's arrival value "Urgent Reorder"
 * shows exactly the rows whose status is "Urgent Reorder" — the same
 * set the tile's urgent count counts.
 */
export function reorderRecommendationMatchesFilter(
  recommendation: { status: string; missingReorderLevel: boolean },
  filter: string,
): boolean {
  return (
    filter === "all" ||
    (filter === "missing-reorder-level" && recommendation.missingReorderLevel) ||
    recommendation.status === filter
  );
}
