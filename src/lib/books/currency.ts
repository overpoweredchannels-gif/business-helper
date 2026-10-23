/**
 * Books currency — the organization's real working currency.
 *
 * Amounts stored in TradeOS are denominated in the org's books currency
 * (organizations.books_currency). An exchange rate exists ONLY at the
 * switch moment: the owner picks a new currency, confirms the warning,
 * and enters "1 <old> = how much <new>?"; every stored amount is then
 * converted by that rate (see the SQL package
 * Books_Currency_Migration_2026-10-23.sql and POST /api/books/convert).
 *
 * This module is the app-side reference for that conversion: currency
 * resolution, rate validation, and the exact conversion arithmetic. The
 * arithmetic mirrors the SQL: amounts are handled as integer hundredths
 * (every monetary column is stored at 2dp scale), the rate as integer
 * micro-units (rate * 1e6, parsed exactly from the entered string), and
 * each converted value is round(value * rate, 2), half away from zero —
 * the same rule Postgres numeric rounding and src/lib/regional/money.ts
 * apply. No floating-point money math anywhere in this file.
 */
import { isCurrency, type Currency } from '../regional/settings';
import { parseRateToMicro } from '../money/currency';

export class BooksConversionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * The org's current effective books currency. First valid value wins:
 * the books_currency column, then the legacy settings model
 * (organizations.regional_preferences JSON "accountingCurrency", the
 * field the regional settings service writes), then 'PKR' — the legacy
 * default every existing amount is denominated in. This resolution is
 * also exactly what the migration's backfill writes into the column, so
 * pre- and post-migration reads agree.
 */
export function resolveBooksCurrency(columnValue: unknown, regionalPreferences: unknown): Currency {
  if (isCurrency(columnValue)) return columnValue;
  if (regionalPreferences && typeof regionalPreferences === 'object' && !Array.isArray(regionalPreferences)) {
    const fromPreferences = (regionalPreferences as Record<string, unknown>).accountingCurrency;
    if (isCurrency(fromPreferences)) return fromPreferences;
  }
  if (isCurrency(regionalPreferences)) return regionalPreferences;
  return 'PKR';
}

export interface ConversionRate {
  /** rate * 1e6 as an exact integer. */
  micro: bigint;
  /** The rate text, normalized (trimmed) as entered. */
  text: string;
}

/**
 * Validate an owner-entered switch rate: "1 <old> = rate <new>".
 * A decimal string, positive, at most 6 decimal places (the exact-parse
 * rule of src/lib/money/currency.ts, the codebase's only rate parser).
 * Anything else is books.invalidRate — a rate of 0, a negative rate, or
 * extra precision must never reach the conversion.
 */
export function parseConversionRate(input: unknown): ConversionRate {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw new BooksConversionError('books.invalidRate');
  try {
    return { micro: parseRateToMicro(text), text };
  } catch {
    throw new BooksConversionError('books.invalidRate');
  }
}

const MICRO = BigInt(1_000_000);

/** Half-away-from-zero division, mirroring src/lib/money/currency.ts. */
function divRound(num: bigint, den: bigint): bigint {
  const neg = num < BigInt(0);
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * BigInt(2) >= den ? q + BigInt(1) : q;
  return neg ? -rounded : rounded;
}

/**
 * Parse a stored amount (decimal string, any precision) to integer
 * hundredths, quantizing half away from zero — the same rule
 * decimalToMinor applies at the 2dp monetary boundary.
 */
export function amountToHundredths(value: string): bigint {
  if (typeof value !== 'string' || value.length > 120 || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new BooksConversionError('books.invalidAmount');
  }
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const [whole, fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  let hundredths = BigInt(whole) * BigInt(100) + BigInt(fraction.slice(0, 2).padEnd(2, '0') || '0');
  if (Number(fraction[2] ?? '0') >= 5) hundredths += BigInt(1);
  return negative && hundredths !== BigInt(0) ? -hundredths : hundredths;
}

/** Render integer hundredths back to a canonical 2dp decimal string. */
export function hundredthsToAmount(hundredths: bigint): string {
  const negative = hundredths < BigInt(0);
  const abs = negative ? -hundredths : hundredths;
  const whole = abs / BigInt(100);
  const fraction = (abs % BigInt(100)).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** converted = round(value * rate, 2), computed exactly. */
export function convertHundredths(hundredths: bigint, rateMicro: bigint): bigint {
  if (rateMicro <= BigInt(0)) throw new BooksConversionError('books.invalidRate');
  return divRound(hundredths * rateMicro, MICRO);
}

/** Convert one stored amount string at the switch rate. */
export function convertAmount(value: string, rateMicro: bigint): string {
  return hundredthsToAmount(convertHundredths(amountToHundredths(value), rateMicro));
}

// ---------------------------------------------------------------------------
// Control totals. A control is a named sum of converted values; "units"
// weights its rounding-error bound. The authoritative computation lives
// in SQL (books_conversion_control_totals) over the exact row sets the
// converter touches; this reference implementation covers the same
// contract for fixtures and for verifying a returned conversion event.
// ---------------------------------------------------------------------------

export interface ControlTotal {
  /** Decimal string, 2dp. */
  total: string;
  units: number;
}
export type ControlTotals = Record<string, ControlTotal>;

/** Sum each named group of amount strings into its control total. */
export function computeControlTotals(groups: Record<string, readonly string[]>): ControlTotals {
  const totals: ControlTotals = {};
  for (const [name, values] of Object.entries(groups)) {
    let sum = BigInt(0);
    for (const value of values) sum += amountToHundredths(value);
    totals[name] = { total: hundredthsToAmount(sum), units: values.length };
  }
  return totals;
}

/** Convert every value in every group at the switch rate. */
export function convertGroups(
  groups: Record<string, readonly string[]>,
  rateMicro: bigint,
): Record<string, string[]> {
  const converted: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(groups)) {
    converted[name] = values.map((value) => convertAmount(value, rateMicro));
  }
  return converted;
}

/**
 * Reconciliation rule (identical in SQL): for every control,
 *   |after - before * rate| <= 0.005 * units + 0.01
 * — each converted value may drift at most half a cent from exact, plus
 * one cent of absolute slack. Returns the names of failing controls;
 * an empty array means the conversion reconciles.
 */
export function verifyControlTotals(
  before: ControlTotals,
  after: ControlTotals,
  rateMicro: bigint,
): string[] {
  if (rateMicro <= BigInt(0)) throw new BooksConversionError('books.invalidRate');
  const violations: string[] = [];
  for (const name of Object.keys(before)) {
    const beforeEntry = before[name];
    const afterEntry = after[name];
    if (!afterEntry) {
      violations.push(name);
      continue;
    }
    const beforeHundredths = amountToHundredths(beforeEntry.total);
    const afterHundredths = amountToHundredths(afterEntry.total);
    // Work in micro-hundredths so the comparison stays exact.
    const diffMicro = afterHundredths * MICRO - beforeHundredths * rateMicro;
    const absDiff = diffMicro < BigInt(0) ? -diffMicro : diffMicro;
    const toleranceMicro = BigInt(beforeEntry.units) * BigInt(500_000) + BigInt(1_000_000);
    if (absDiff > toleranceMicro) violations.push(name);
  }
  return violations;
}
