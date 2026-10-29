import { currencies, isCurrency, type Currency } from "@/lib/regional/settings";

/**
 * Convert a PKR-based rate table (1 PKR = X units of the target) into the
 * app's display-rate convention: PKR per 1 unit of the target currency.
 * PKR itself is the identity (1). Unknown, zero, or negative entries yield
 * null — callers must never invent a conversion from a bad rate.
 */
export function pkrPerUnitFromBaseRates(
  rates: Record<string, unknown> | null | undefined,
  currency: Currency,
): number | null {
  if (!isCurrency(currency)) return null;
  if (currency === "PKR") return 1;
  if (!rates || typeof rates !== "object") return null;
  const perPkr = rates[currency];
  const parsed = typeof perPkr === "number" ? perPkr : Number.parseFloat(String(perPkr ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return 1 / parsed;
}

/**
 * Reduce a PKR-based upstream table to the app's 8 currencies as
 * per-PKR quotes (1 PKR = X units). PKR itself is always 1. Currencies
 * with a missing, zero, or negative quote are left out — callers must
 * check presence and never convert through a gap.
 */
export function perPkrMapFromBaseRates(
  rates: Record<string, unknown> | null | undefined,
): Partial<Record<Currency, number>> {
  const map: Partial<Record<Currency, number>> = { PKR: 1 };
  if (!rates || typeof rates !== "object") return map;
  for (const code of Object.keys(currencies) as Currency[]) {
    if (code === "PKR") continue;
    const raw = rates[code];
    const parsed = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
    if (Number.isFinite(parsed) && parsed > 0) map[code] = parsed;
  }
  return map;
}

/**
 * The books-switch rate in the convert route's convention:
 * "1 <from> = rate <to>". Same currency is the identity (1). Any gap
 * in the per-PKR map yields null — the switch must never run on a
 * guessed rate.
 */
export function conversionRatePerUnit(
  perPkr: Partial<Record<Currency, number>> | null | undefined,
  from: Currency,
  to: Currency,
): number | null {
  if (!isCurrency(from) || !isCurrency(to)) return null;
  if (from === to) return 1;
  if (!perPkr) return null;
  const fromQuote = perPkr[from];
  const toQuote = perPkr[to];
  if (
    typeof fromQuote !== "number" || !Number.isFinite(fromQuote) || fromQuote <= 0 ||
    typeof toQuote !== "number" || !Number.isFinite(toQuote) || toQuote <= 0
  ) {
    return null;
  }
  return toQuote / fromQuote;
}
