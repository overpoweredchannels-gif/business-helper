/**
 * Smart Module cards (P1 Area B) — summary count and listed rows from ONE source.
 *
 * Defect (tracker Area B line 60): the Smart Module "Inventory" card
 * showed a summary count and a list that could disagree on the same
 * card. The summary counted `reorderRecommendationSummary.urgentReorderCount`
 * — the recommendations' "Urgent Reorder" set — while the listed items
 * came from `lowStockProducts` (built from `inventoryStats`). Both sides
 * classify with the same classifier (stockStatusFor, via
 * reorderTableStatusFor) and the same currentStock (product.current_stock),
 * but with a different reorder level:
 *
 * - reorderRecommendations: `reorder_level ?? minimum_stock_level ?? 0`
 * - inventoryStats: `reorder_level ?? 0` (no minimum_stock_level fallback)
 *
 * So a product with reorder_level null, minimum_stock_level set, and
 * stock at or below that level WAS counted in the summary but was NOT in
 * the listed items (inventoryStats classifies it "missing_reorder_level").
 * A second, independent mismatch on the same card: the summary counted
 * ALL urgent recommendations (unbounded) while the children showed
 * `slice(0, 10)` — with more than 10 urgent items the list silently
 * showed 10 while the summary said e.g. 15.
 *
 * Fix: the card derives its summary count AND its listed rows from this
 * one set — the recommendations' own urgent rows — via
 * `urgentReorderRows`. `inventoryStats` is deliberately UNCHANGED: its
 * reorderLevel feeds the low-stock KPI, the Health card, BI and other
 * surfaces, and changing it would move other counts.
 *
 * The sibling Sales / Purchases modules had the same summary-vs-listed
 * shape: their summaries counted all 10 recent invoices (the source
 * arrays are capped at 10) while their children showed only `slice(0, 5)`.
 * They use `smartModuleRows`, which returns the whole array with its
 * count, so the summary and the list can never disagree there either.
 * The children render behind the module's expand toggle, so listing the
 * whole set does not grow the collapsed card.
 */

/** A reorder-recommendation row, as built in page.tsx. */
export interface SmartModuleReorderRow {
  productId: string | number;
  productName: string;
  currentStock: number;
  status: string;
}

/**
 * The Smart Module Inventory set: the recommendations' own "Urgent
 * Reorder" rows, with the summary count taken from the same array.
 * An out-of-stock product (stock 0) is never in this set — the
 * classifier puts it under "Out of Stock" — and neither is a product
 * with no reorder level anywhere ("missing_reorder_level").
 */
export function urgentReorderRows<T extends SmartModuleReorderRow>(
  recommendations: readonly T[],
): { count: number; rows: T[] } {
  const rows = recommendations.filter((row) => row.status === "Urgent Reorder");
  return { count: rows.length, rows };
}

/**
 * The rows a Smart Module lists, with the summary count taken from the
 * same array. The whole array is returned — never a silent slice — so
 * the summary count and the listed rows always agree.
 */
export function smartModuleRows<T>(rows: readonly T[]): { count: number; rows: T[] } {
  return { count: rows.length, rows: [...rows] };
}
