/**
 * Slice S4 — pending sales in Sales History (Offline Tier-1).
 *
 * A sale saved offline has no server row yet, but the cashier must see
 * it in history immediately — with its provisional L-number and a
 * pending marker, never looking like a confirmed invoice. These pure
 * helpers turn a queued sale (`PendingSale`) into the shapes the
 * history already renders (`SalesTransaction` + `sales_items` rows) and
 * merge them with the mirrored/live rows.
 *
 * Rules:
 * - The merge is HISTORY-SCOPED. `salesTransactions` state (dashboard,
 *   ledgers, payments, inventory) never sees a pending row — only the
 *   history display lists do.
 * - A pending sale appears exactly once: it is dropped from the merge
 *   when a synced row carries the same `request_id` (the RPC result
 *   stores it) or the same `provisional_receipt_number` (linked at
 *   sync). In practice the queue row is already gone by then (the
 *   drain removes a confirmed attempt before linking), so the dedupe
 *   is belt-and-braces for a crash between the two.
 * - Totals come from `calculateSaleAmounts` — the same math the save
 *   path uses — so the pending row's total matches the receipt and the
 *   server invoice that follows. A corrupt queue row must never crash
 *   history rendering: an unparseable total falls back to a plain line
 *   sum, and a sale with no usable lines is skipped.
 * - Balances are never written here. A pending credit sale simply owes
 *   its full total (no allocation row exists yet); the badge math in
 *   page.tsx reads that from this row's `total_amount`.
 */

import { calculateSaleAmounts } from "@/lib/sales/sale-amounts";
import type { AtomicSaleInput, PendingSale } from "@/lib/sales/atomic-sale-client";
import type { SalesTransaction } from "@/lib/tradeos/types";

/** Synthetic history id for a pending sale: `pending:<requestId>`. */
export const PENDING_HISTORY_ID_PREFIX = "pending:";

export function pendingHistoryId(requestId: string): string {
  return `${PENDING_HISTORY_ID_PREFIX}${requestId}`;
}

/** True for a synthetic pending row (never a server row). */
export function isPendingHistoryId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_HISTORY_ID_PREFIX);
}

/** Total / tax / invoice discount for one queued sale, same math as the save path. */
export function pendingSaleAmounts(input: AtomicSaleInput): {
  total: number;
  tax: number;
  invoiceDiscount: number;
} {
  try {
    const amounts = calculateSaleAmounts(
      input.lines.map((line) => ({
        quantity: line.quantity,
        sellingPrice: line.selling_price,
        discount: line.discount,
      })),
      {
        invoiceDiscount: input.invoice_discount,
        invoiceDiscountType: input.invoice_discount_type,
        taxRate: input.tax_rate,
      },
    );
    return { total: amounts.total, tax: amounts.tax, invoiceDiscount: amounts.invoiceDiscount };
  } catch {
    // A corrupt queue row must not crash history rendering: fall back
    // to a plain line sum (no invoice discount, no tax).
    const lineSubtotal = (input.lines ?? []).reduce(
      (sum, line) =>
        sum + Number(line.quantity || 0) * Number(line.selling_price || 0) - Number(line.discount || 0),
      0,
    );
    return { total: Math.max(0, lineSubtotal), tax: 0, invoiceDiscount: 0 };
  }
}

/**
 * A queued sale as the history row. `fallbackLabel` is shown as the
 * invoice number when the sale has no provisional number yet (desktop
 * rows always have one; a localStorage-fallback row may not).
 * Returns null when the input has no customer or no lines.
 */
export function pendingSaleToTransaction(
  pending: PendingSale,
  fallbackLabel = "",
): SalesTransaction | null {
  const input = pending.input;
  if (!input || typeof input.customer_id !== "string" || input.customer_id.length === 0) return null;
  if (!Array.isArray(input.lines) || input.lines.length === 0) return null;
  const amounts = pendingSaleAmounts(input);
  const total = amounts.total;
  const cashReceived = typeof input.cash_received === "number" ? input.cash_received : null;
  return {
    id: pendingHistoryId(pending.requestId),
    customer_id: input.customer_id,
    invoice_number: pending.provisionalNumber ?? fallbackLabel,
    created_at:
      typeof pending.createdAt === "string" && pending.createdAt.length > 0
        ? pending.createdAt
        : `${input.sale_date}T00:00:00`,
    sale_date: input.sale_date,
    payment_type: input.payment_type,
    credit_due_date: null,
    credit_limit_snapshot: null,
    credit_days_snapshot: null,
    total_amount: total,
    // Not a server status: the row is pending, not confirmed. Nothing in
    // the history reads this field for a pending row (the badge comes
    // from the payment math, the marker from the id prefix).
    status: null,
    discount_amount: amounts.invoiceDiscount,
    tax_rate: input.tax_rate,
    tax_amount: amounts.tax,
    cash_received: cashReceived,
    change_due:
      (input.payment_type === "cash" || input.payment_type === "card") && cashReceived !== null
        ? Math.max(0, cashReceived - total)
        : null,
    notes: input.notes ?? null,
  };
}

/** A queued sale's lines as the history items table rows. */
export function pendingSaleToItems(pending: PendingSale): Array<Record<string, unknown>> {
  const input = pending.input;
  if (!input || !Array.isArray(input.lines)) return [];
  const transactionId = pendingHistoryId(pending.requestId);
  return input.lines.map((line, index) => ({
    id: `${transactionId}:item:${index}`,
    sales_transaction_id: transactionId,
    product_id: line.product_id,
    quantity: line.quantity,
    selling_price: line.selling_price,
    discount: line.discount,
    unit_mode: line.unit_mode,
  }));
}

/**
 * Merge pending queue sales into the history display lists. Synced rows
 * pass through untouched (same order); pending rows that survive the
 * dedupe come first — the history's own sort (sale date, then created
 * time) orders the merged list for display. A pending row is dropped
 * when a synced row already carries its `request_id` or its provisional
 * number, so one sale never renders twice.
 */
export function mergePendingHistory(
  syncedTransactions: SalesTransaction[],
  syncedItems: Array<Record<string, unknown>>,
  pending: PendingSale[],
  fallbackLabel = "",
): {
  transactions: SalesTransaction[];
  items: Array<Record<string, unknown>>;
} {
  const syncedRequestIds = new Set(
    syncedTransactions
      .map((tx) => (typeof tx.request_id === "string" ? tx.request_id : ""))
      .filter((id) => id.length > 0),
  );
  const syncedProvisionalNumbers = new Set(
    syncedTransactions
      .map((tx) => (typeof tx.provisional_receipt_number === "string" ? tx.provisional_receipt_number : ""))
      .filter((number) => number.length > 0),
  );
  const transactions: SalesTransaction[] = [];
  const items: Array<Record<string, unknown>> = [];
  for (const sale of pending) {
    if (syncedRequestIds.has(sale.requestId)) continue;
    if (
      typeof sale.provisionalNumber === "string" &&
      sale.provisionalNumber.length > 0 &&
      syncedProvisionalNumbers.has(sale.provisionalNumber)
    ) {
      continue;
    }
    const transaction = pendingSaleToTransaction(sale, fallbackLabel);
    if (!transaction) continue;
    transactions.push(transaction);
    items.push(...pendingSaleToItems(sale));
  }
  return {
    transactions: [...transactions, ...syncedTransactions],
    items: [...items, ...syncedItems],
  };
}
