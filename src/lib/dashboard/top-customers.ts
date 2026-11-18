/**
 * Top Customers card (P1 Area B) — the ONE source of truth for what the
 * dashboard Top Customers card plots.
 *
 * Defects: the card plotted `topCustomersBySales` with only a name and a
 * money value (`formatDashboardMoney(c.totalSales)`) — the `trend` prop
 * was never passed, so no arrow ever showed — and the card vanished
 * entirely when there was no data (DashboardView only included it when
 * the array was non-empty).
 *
 * Fix: each row now carries a trend arrow vs the previous equivalent
 * period (same length, immediately before the current BI range — the
 * same baseline the Top Products card uses, via `previousPeriodRange`
 * in `./top-products`), and the card itself is always on the
 * dashboard — an empty period shows the message, it never removes the
 * card.
 *
 * The money value is unchanged by this fix: it is still the customer's
 * total sales for the BI period, formatted with the dashboard's money
 * formatter. The ranking (top 5 by total sales, BI range) is unchanged
 * too — except that customers with zero sales in the period never reach
 * the card, so a period with no selling customers shows the empty state
 * instead of five "€0.00" rows.
 */

export type TopCustomerTrend = "up" | "down" | "flat";

export type TopCustomerRowInput = {
  name: string;
  /** Total sales in the current period (gross, exactly like `totalSales`). */
  totalSales: number;
  /**
   * Total sales in the previous equivalent period, computed the same way
   * (gross, same filters). null when there is no previous period to
   * compare against (the all-time range) — the trend is then "flat",
   * never a guessed "up".
   */
  previousTotalSales: number | null;
};

export type TopCustomerRow = {
  name: string;
  /** Total sales as formatted dashboard money, e.g. "€1,234.56". */
  value: string;
  trend?: TopCustomerTrend;
};

/**
 * Half a cent: money is displayed to 2dp, so a difference smaller than
 * this is invisible rounding noise from floating-point sums, not a real
 * rise or fall. Two periods whose totals differ by less than half a cent
 * are "flat".
 */
const TREND_EPSILON = 0.005;

/**
 * Trend arrow for one customer: current-period total sales vs the
 * previous equivalent period. No previous sales + current sales is "up";
 * equal totals (including both zero, and totals within half a cent) is
 * "flat"; no previous period at all (null) is "flat" — there is no
 * baseline to rise against.
 */
export function topCustomerTrend(
  currentTotalSales: number,
  previousTotalSales: number | null,
): TopCustomerTrend {
  if (previousTotalSales === null) return "flat";
  if (currentTotalSales - previousTotalSales > TREND_EPSILON) return "up";
  if (previousTotalSales - currentTotalSales > TREND_EPSILON) return "down";
  return "flat";
}

/**
 * Top Customers rows for the card: only customers that actually bought
 * in the period (totalSales > 0), ranked by total sales descending,
 * top `limit` (default 5). Each row carries the total sales as formatted
 * money and the trend vs the previous equivalent period. An all-zero
 * input yields no rows — the card then shows its empty state instead of
 * five "€0.00" rows.
 */
export function buildTopCustomerRows(
  items: TopCustomerRowInput[],
  formatMoney: (value: number) => string,
  limit = 5,
): TopCustomerRow[] {
  return items
    .filter((item) => item.totalSales > 0)
    .slice()
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, limit)
    .map((item) => ({
      name: item.name,
      value: formatMoney(item.totalSales),
      trend: topCustomerTrend(item.totalSales, item.previousTotalSales),
    }));
}

/**
 * What the Top Customers card renders for a row array: the list when
 * there is at least one buying customer, the "no top customers" empty
 * state when the array is empty. The card itself is always on the
 * dashboard — an empty period shows the message, it never removes the
 * card.
 */
export function topCustomersCardState(items: TopCustomerRow[]): "list" | "empty" {
  return items.length === 0 ? "empty" : "list";
}
