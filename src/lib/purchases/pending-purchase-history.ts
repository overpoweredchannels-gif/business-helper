/**
 * Slice S6 — pending purchases in Purchase History (Offline Tier-1).
 *
 * A purchase saved offline has no server row yet, but the cashier
 * must see it in history immediately — with its provisional LP-number
 * and a pending marker, never looking like a confirmed invoice.
 * These pure helpers turn a queued purchase (`LocalPurchaseRow`)
 * into the shapes the history already renders
 * (`PurchaseTransaction` + `purchase_items` rows) and merge them
 * with the mirrored/live rows. Same discipline as the sales
 * equivalent (`src/lib/sales/pending-history.ts`):
 *
 * - The merge is HISTORY-SCOPED. `purchaseTransactions` state
 *   (dashboard, ledgers, payments) never sees a pending row — only
 *   the history display lists do.
 * - A pending purchase appears exactly once: it is dropped from the
 *   merge when a synced row carries the same `request_key` (the
 *   status check / the RPC result stores it). In practice the queue
 *   row is already gone by then (the drain removes a confirmed
 *   purchase before the refetch), so the dedupe is belt-and-braces
 *   for a crash between the two.
 * - Totals come from the lines exactly as the server computes them
 *   (`create_purchase_atomic`: line sum − discount + tax), so the
 *   pending row's total matches the server invoice that follows.
 *   A corrupt queue row must never crash history rendering: an
 *   unparseable total falls back to a plain line sum, and a purchase
 *   with no usable lines is skipped.
 * - Balances are never written here. A pending purchase has no
 *   supplier payment yet, so it owes its full total; the payment
 *   status function reads that from this row's lines.
 */

import type { LocalPurchaseRow } from "@/lib/offline/local-purchases";
import type { PurchaseTransaction } from "@/lib/tradeos/types";

/** Synthetic history id for a pending purchase: `pending:<requestKey>`. */
export const PENDING_PURCHASE_HISTORY_ID_PREFIX = "pending:";

export function pendingPurchaseHistoryId(requestKey: string): string {
  return `${PENDING_PURCHASE_HISTORY_ID_PREFIX}${requestKey}`;
}

/** True for a synthetic pending row (never a server row). */
export function isPendingPurchaseHistoryId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_PURCHASE_HISTORY_ID_PREFIX);
}

export interface PurchaseInputLine {
  product_id?: string | number | null;
  quantity?: number | string | null;
  purchase_price?: number | string | null;
  selling_price?: number | string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  unit_mode?: string | null;
}

/** The purchase input lines, or an empty list when they are unusable. */
export function purchaseInputLines(input: Record<string, unknown>): PurchaseInputLine[] {
  const lines = input.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (line): line is PurchaseInputLine =>
      !!line && typeof line === "object" && !Array.isArray(line),
  );
}

/** Total for one queued purchase, same math as the server RPC. */
export function pendingPurchaseTotal(input: Record<string, unknown>): number {
  try {
    const lines = purchaseInputLines(input);
    const lineSum = lines.reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.purchase_price || 0),
      0,
    );
    const discount = Number(input.discount_amount || 0);
    const tax = Number(input.tax_amount || 0);
    const total = lineSum - discount + tax;
    if (!Number.isFinite(total)) throw new Error("Non-finite purchase total");
    return Math.max(0, total);
  } catch {
    // A corrupt queue row must not crash history rendering: fall back
    // to a plain line sum (no discount, no tax).
    const lineSum = purchaseInputLines(input).reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.purchase_price || 0),
      0,
    );
    return Math.max(0, lineSum);
  }
}

/**
 * A queued purchase as the history row. `fallbackLabel` is shown as
 * the invoice number when the purchase has no provisional number yet
 * (SQLite rows always have one; a localStorage-fallback row may not).
 * Returns null when the input has no supplier or no lines.
 */
export function pendingPurchaseToTransaction(
  pending: LocalPurchaseRow,
  fallbackLabel = "",
): PurchaseTransaction | null {
  const input = pending.input;
  if (!input || typeof input.supplier_id !== "string" || input.supplier_id.length === 0) return null;
  const lines = purchaseInputLines(input);
  if (lines.length === 0) return null;
  return {
    id: pendingPurchaseHistoryId(pending.id),
    supplier_id: input.supplier_id,
    invoice_number: pending.provisionalNumber ?? fallbackLabel,
    created_at: pending.createdAt,
    purchase_date:
      typeof input.purchase_date === "string" && input.purchase_date.length > 0
        ? input.purchase_date
        : pending.createdAt.slice(0, 10),
    expense_review_status: "pending",
    expense_reviewed_at: null,
    total_amount: pendingPurchaseTotal(input),
    notes: typeof input.notes === "string" ? input.notes : null,
    // Not a server status: the row is pending, not confirmed. Nothing
    // in the history reads this field for a pending row (the badge
    // comes from the payment math, the marker from the id prefix).
    status: null,
    supplier_invoice_number:
      typeof input.supplier_invoice_number === "string" ? input.supplier_invoice_number : null,
  };
}

/** A queued purchase's lines as the history items table rows. */
export function pendingPurchaseToItems(pending: LocalPurchaseRow): Array<Record<string, unknown>> {
  const transactionId = pendingPurchaseHistoryId(pending.id);
  return purchaseInputLines(pending.input).map((line, index) => ({
    id: `${transactionId}:item:${index}`,
    purchase_transaction_id: transactionId,
    product_id: line.product_id,
    quantity: line.quantity,
    purchase_price: line.purchase_price,
    selling_price: line.selling_price,
    unit_mode: line.unit_mode ?? "main",
    batch_number: line.batch_number ?? null,
    expiry_date: line.expiry_date ?? null,
  }));
}

/**
 * Merge pending queue purchases into the history display lists.
 * Synced rows pass through untouched (same order); pending rows that
 * survive the dedupe come first — the history's own sort (date, then
 * supplier) orders the merged list for display. A pending row is
 * dropped when a synced row already carries its `request_key`, so one
 * purchase never renders twice.
 */
export function mergePendingPurchases(
  syncedTransactions: PurchaseTransaction[],
  syncedItems: Array<Record<string, unknown>>,
  pending: LocalPurchaseRow[],
  fallbackLabel = "",
): {
  transactions: PurchaseTransaction[];
  items: Array<Record<string, unknown>>;
} {
  const syncedRequestKeys = new Set(
    syncedTransactions
      .map((tx) => (typeof tx.request_key === "string" ? tx.request_key : ""))
      .filter((key) => key.length > 0),
  );
  const transactions: PurchaseTransaction[] = [];
  const items: Array<Record<string, unknown>> = [];
  for (const purchase of pending) {
    if (syncedRequestKeys.has(purchase.id)) continue;
    const transaction = pendingPurchaseToTransaction(purchase, fallbackLabel);
    if (!transaction) continue;
    transactions.push(transaction);
    items.push(...pendingPurchaseToItems(purchase));
  }
  return {
    transactions: [...transactions, ...syncedTransactions],
    items: [...items, ...syncedItems],
  };
}
