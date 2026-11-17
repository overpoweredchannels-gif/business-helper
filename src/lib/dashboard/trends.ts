/**
 * Revenue Trend chart data (P1 Area B) — the ONE source of truth for what
 * the dashboard Revenue Trend card plots.
 *
 * Defects: the card plotted `monthlySales.slice(-6)` — monthly totals
 * labelled with raw `YYYY-MM` (page.tsx built the label with
 * `dateValue.slice(0, 7)`), so on the default 30-day BI range the chart
 * typically showed 1-2 bars with unreadable labels. The shared BarChart
 * also showed no values and no axis (values lived only in the SVG
 * `<title>`, screen-reader only), and the card vanished entirely when
 * there was no data (DashboardView only included it when the array was
 * non-empty).
 *
 * Fix: the card now plots DAILY revenue — the last 14 days of
 * `dailyTrends` (whose entries already carry `sales`, the day's revenue),
 * parallel to the Profit Trend card which plots the last 14 days of
 * `dailyTrends` profit. Labels use the Profit Trend's style (`MM-DD`,
 * via trendDayLabel below) — never raw `YYYY-MM`. The y-axis ticks and
 * the empty-state condition live here too, so the slice test can assert
 * them without a browser.
 */

export type TrendPoint = { label: string; value: number };

export type DailyTrendPoint = { date: string; sales: number };

/** Readable day label for a trend bar: "2026-11-17" -> "11-17". */
export function trendDayLabel(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}

/**
 * Daily revenue series for the Revenue Trend card: the last 14 days of
 * daily trends, each point the day's revenue (`sales`). Input is the
 * date-sorted `dailyTrends` array (page.tsx builds it sorted); output
 * keeps that order. Fewer than 14 days in -> all of them out; empty in
 * -> empty out (the card then shows its empty state, it never vanishes).
 */
export function buildRevenueTrendData(
  dailyTrends: DailyTrendPoint[],
): TrendPoint[] {
  return dailyTrends
    .slice(-14)
    .map((d) => ({ label: trendDayLabel(d.date), value: d.sales }));
}

/**
 * Y-axis ticks for the shared BarChart: the top tick is the largest
 * plotted value (0 when there is no data), the middle tick is half of
 * it, and the bottom tick is always 0. The chart's bar scaling still
 * floors at 1 (a zero-data chart would divide by zero otherwise); the
 * ticks report the data itself, so they can never claim a larger max
 * than the bars show.
 */
export function trendAxisTicks(data: TrendPoint[]): {
  max: number;
  mid: number;
} {
  const max = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 0;
  return { max, mid: max / 2 };
}

/**
 * What the Revenue Trend card renders for a data array: the chart when
 * there is at least one point, the "no revenue data" empty state when
 * the array is empty. The card itself is always on the dashboard — an
 * empty period shows the message, it never removes the card.
 */
export function revenueTrendCardState(
  data: TrendPoint[],
): "chart" | "empty" {
  return data.length === 0 ? "empty" : "chart";
}
