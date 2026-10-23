/**
 * The books money formatter: formats an amount that is KNOWN to be in
 * the books currency, in that currency, with the locale's rules.
 *
 * It never converts and never relabels: no FX rate is consulted, so a
 * stored 312.45 in a EUR-books org renders as €312.45 — exactly the
 * amount on the books. (The display-currency formatter formatPKR, by
 * contrast, divides by the display FX rate or silently relabels 1:1;
 * surfaces migrate here as the books model rolls out.)
 *
 * Fraction digits come from the reviewed currency table
 * (src/lib/regional/settings.ts): 2 for PKR/EUR/USD/…, 0 for JPY,
 * 3 for KWD.
 */
import { currencies, isCurrency, type Currency } from '../regional/settings';

export function formatBooksAmount(value: number, currency: Currency, locale: string): string {
  if (!isCurrency(currency)) throw new Error('regional.currencyInvalid');
  const digits = currencies[currency].digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
