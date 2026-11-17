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

export type ProfitDailyTrendPoint = {
  date: string;
  profit: number;
  unknownCostRevenue: number;
  unknownCostLines: number;
};

/**
 * One sales line's contribution to the daily profit, computed exactly
 * like the Today's Profit KPI (todayProfitTotals in page.tsx) and the
 * BI line totals (salesLineTotals): revenue is NET of the line
 * discount (quantity x selling price - discount), and only lines with
 * a known cost contribute profit. A line whose cost is unknown
 * (cogs === null) contributes nothing to profit and is counted in
 * unknownCostRevenue / unknownCostLines instead of silently counting
 * as zero profit — the same honest split as the KPI, so the Profit
 * Trend can neither overstate (gross revenue, discounts ignored) nor
 * silently understate (unknown cost as zero) the day's profit.
 *
 * `grossRevenue` is returned unchanged for the Revenue Trend, which
 * plots gross daily sales — the caller keeps `group.sales` on gross
 * revenue and only the profit side uses the net figure.
 */
export function profitLineContribution(line: {
  quantity: number;
  sellingPrice: number;
  discount: number;
  cogs: number | null;
}): {
  grossRevenue: number;
  netRevenue: number;
  profitContribution: number;
  unknownCostRevenue: number;
  unknownCostLines: number;
} {
  const grossRevenue = line.quantity * line.sellingPrice;
  const netRevenue = grossRevenue - line.discount;
  if (line.cogs === null) {
    return {
      grossRevenue,
      netRevenue,
      profitContribution: 0,
      unknownCostRevenue: netRevenue,
      unknownCostLines: 1,
    };
  }
  return {
    grossRevenue,
    netRevenue,
    profitContribution: netRevenue - line.cogs,
    unknownCostRevenue: 0,
    unknownCostLines: 0,
  };
}

export type ProfitTrendData = {
  points: TrendPoint[];
  unknownCostLines: number;
  unknownCostRevenue: number;
};

/**
 * Daily profit series for the Profit Trend card: the last 14 days of
 * daily trends, each point the day's profit (net of line discounts,
 * costed lines only — unknown-cost lines are excluded here and counted
 * in the totals below so the card can disclose them, exactly like the
 * Today's Profit KPI does). Input is the date-sorted `dailyTrends`
 * array; output keeps that order. The totals cover only the plotted
 * window, so a day outside the last 14 is never disclosed on this card.
 */
export function buildProfitTrendData(
  dailyTrends: ProfitDailyTrendPoint[],
): ProfitTrendData {
  const window = dailyTrends.slice(-14);
  return {
    points: window.map((d) => ({
      label: trendDayLabel(d.date),
      value: d.profit,
    })),
    unknownCostLines: window.reduce((sum, d) => sum + d.unknownCostLines, 0),
    unknownCostRevenue: window.reduce(
      (sum, d) => sum + d.unknownCostRevenue,
      0,
    ),
  };
}

/**
 * What the Profit Trend card renders for a data array: the chart when
 * there is at least one point, the "no profit data" empty state when
 * the array is empty. The card itself is always on the dashboard — an
 * empty period shows the message, it never removes the card.
 */
export function profitTrendCardState(
  data: TrendPoint[],
): "chart" | "empty" {
  return data.length === 0 ? "empty" : "chart";
}

/**
 * The BarChart value-label cell class. A bar's formatted value must
 * never truncate: at the widths the dashboard renders at, the longest
 * live values ("€13.73", "€14.24") were clipped to "€13…" / "€14…"
 * by `min-w-0 flex-1 truncate`. The cell keeps its even flex-1 slot
 * (same geometry as the date labels below) but the text never
 * truncates and never wraps — a value a pixel or two wider than its
 * slot still reads in full instead of losing its last digits.
 */
export const CHART_VALUE_LABEL_CLASS =
  "flex-1 whitespace-nowrap text-center text-[11px] tabular-nums text-foreground";

/**
 * Rough rendered width, in px, of a formatted money string at 11px
 * tabular-nums (about 7px per character — digits, "€", "." and ","
 * are all ~0.6em wide). Used only to assert a label fits the
 * BarChart's 48-unit bar slot; it is an estimate, not a measurement.
 */
export function trendValueLabelWidthPx(formatted: string): number {
  return formatted.length * 7;
}

/** True when a formatted value fits the BarChart's per-bar slot. */
export function trendValueLabelFits(
  formatted: string,
  slotWidthPx = 48,
): boolean {
  return trendValueLabelWidthPx(formatted) <= slotWidthPx;
}
