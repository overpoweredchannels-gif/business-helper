import { formatBooksAmount } from "../books/format";
import { isCurrency, type Currency } from "../regional/settings";

/**
 * Books-currency money label for AI text (J1a, 2026-11-24).
 *
 * AI answers, brain context, confirmations and success messages quote
 * amounts that are denominated in the org's books currency, so they are
 * labelled with that currency — never converted, never relabelled.
 * Unknown or invalid currency falls back to the legacy PKR default
 * (the same default the brain loader and the memory writer use), and
 * never throws. Grouping follows "en-PK" (Western 1,234,567), matching
 * the existing AI text; the label is what changes, not the digits.
 */
export function resolveAiCurrency(currency: unknown): Currency {
  return isCurrency(currency) ? currency : "PKR";
}

export function formatAiMoney(amount: number, currency: unknown): string {
  return formatBooksAmount(amount, resolveAiCurrency(currency), "en-PK");
}
