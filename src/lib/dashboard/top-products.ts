/**
 * Top Products card (P1 Area B) — the ONE source of truth for what the
 * dashboard Top Products card plots.
 *
 * Defects: the card plotted `topSellingProducts`, an ALL-TIME ranking
 * whose value was the raw summed quantity as a bare string
 * (`String(p.quantitySold)` — e.g. "373", no unit, no money), and whose
 * quantities mixed main units and subunits (sales items carry
 * `unit_mode: "main" | "subunit"` and the sum never normalised them).
 * The `trend` prop was never passed, so no arrow ever showed, and the
 * card vanished entirely when there was no data (DashboardView only
 * included it when the array was non-empty).
 *
 * Fix: the card now plots the current BI period (the same range the
 * Revenue/Profit trend cards and the Top Customers card use), ranked by
 * quantity sold in MAIN units (via `quantityToMainUnits`, exactly like
 * the BI product analytics). Each row shows the quantity WITH its unit
 * (the product's `unit_type`, e.g. "373 CARTON") and the product's
 * revenue net of line discounts, and a trend arrow vs the previous
 * equivalent period (same length, immediately before the current
 * range). The card itself is always on the dashboard — an empty period
 * shows the message, it never removes the card.
 *
 * Ranking basis note: the old card ranked ALL-TIME top sellers while
 * every sibling card on the dashboard is period-based. Aligning the
 * ranking to the BI range is what makes the trend comparison
 * like-for-like; with an all-time ranking there is no "previous
 * equivalent period" to compare against at all.
 */

export type TopProductTrend = "up" | "down" | "flat";

export type TopProductRowInput = {
  name: string;
  /** The product's main unit (its `unit_type`), null when it has none. */
  unitType: string | null;
  /** Quantity sold in the current period, in main units. */
  quantitySold: number;
  /** Revenue in the current period, net of line discounts. */
  netRevenue: number;
  /**
   * Quantity sold in the previous equivalent period, in main units.
   * null when there is no previous period to compare against (the
   * all-time range) — the trend is then "flat", never a guessed "up".
   */
  previousQuantitySold: number | null;
};

export type TopProductRow = {
  name: string;
  /** Quantity with its unit, e.g. "373 CARTON" (bare number when no unit). */
  value: string;
  /** Revenue as formatted dashboard money, e.g. "€123.45". */
  detail?: string;
  trend?: TopProductTrend;
};

/**
 * Net revenue of one sales line: quantity × selling price, less the line
 * discount — exactly like the Today's Profit KPI (todayProfitTotals).
 * The old Top Products value never showed money at all; the revenue the
 * card now shows must be net, or it would overstate what the product
 * actually earned whenever a line was discounted.
 */
export function topProductLineNetRevenue(line: {
  quantity: number;
  sellingPrice: number;
  discount: number;
}): number {
  return line.quantity * line.sellingPrice - line.discount;
}

/**
 * Quantity as displayed: integers plain, fractions to 2dp with trailing
 * zeros trimmed ("373", "0.5", "73.33"). Main-unit quantities come from
 * `quantityToMainUnits`, which can produce long fractions (e.g.
 * 73.333332); the display rounds to 2dp — the underlying value stays
 * exact for sorting and trend comparison.
 */
export function formatTopProductQuantity(quantity: number): string {
  const rounded = Math.round((quantity + Number.EPSILON) * 100) / 100;
  return String(rounded);
}

/**
 * Trend arrow for one product: current-period quantity vs the previous
 * equivalent period. No previous sales + current sales is "up"; equal
 * quantities (including both zero) is "flat"; no previous period at all
 * (null) is "flat" — there is no baseline to rise against.
 */
export function topProductTrend(
  currentQuantity: number,
  previousQuantity: number | null,
): TopProductTrend {
  if (previousQuantity === null) return "flat";
  if (currentQuantity > previousQuantity) return "up";
  if (currentQuantity < previousQuantity) return "down";
  return "flat";
}

function parseDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

function formatDay(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The previous equivalent period: same length (inclusive days),
 * immediately before the current range — its end is the day before the
 * current start. Returns null for an open-ended range (the all-time
 * range has an empty start/end and therefore no previous period), and
 * for a malformed range.
 */
export function previousPeriodRange(range: { start: string; end: string }): {
  start: string;
  end: string;
} | null {
  if (!range.start || !range.end) return null;
  const start = parseDay(range.start);
  const end = parseDay(range.end);
  if (start === null || end === null || end < start) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((end - start) / dayMs) + 1;
  const prevEnd = start - dayMs;
  const prevStart = prevEnd - (days - 1) * dayMs;
  return { start: formatDay(prevStart), end: formatDay(prevEnd) };
}

/**
 * Top Products rows for the card: only products that actually sold in
 * the period (quantitySold > 0), ranked by quantity sold descending,
 * top `limit` (default 5). Each row carries the quantity with its unit
 * as the value, the revenue as the detail, and the trend vs the previous
 * equivalent period. An all-zero input yields no rows — the card then
 * shows its empty state instead of five "0" rows.
 */
export function buildTopProductRows(
  items: TopProductRowInput[],
  formatMoney: (value: number) => string,
  limit = 5,
): TopProductRow[] {
  return items
    .filter((item) => item.quantitySold > 0)
    .slice()
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit)
    .map((item) => {
      const quantity = formatTopProductQuantity(item.quantitySold);
      return {
        name: item.name,
        value: item.unitType ? `${quantity} ${item.unitType}` : quantity,
        detail: formatMoney(item.netRevenue),
        trend: topProductTrend(item.quantitySold, item.previousQuantitySold),
      };
    });
}

/**
 * What the Top Products card renders for a row array: the list when
 * there is at least one selling product, the "no top products" empty
 * state when the array is empty. The card itself is always on the
 * dashboard — an empty period shows the message, it never removes the
 * card.
 */
export function topProductsCardState(items: TopProductRow[]): "list" | "empty" {
  return items.length === 0 ? "empty" : "list";
}
