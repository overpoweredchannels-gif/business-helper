import { formatBooksAmount } from "../books/format";
import { isCurrency, type Currency } from "../regional/settings";

/**
 * Books-currency money label for AI text (J1a, 2026-11-24; fallback
 * corrected 2026-11-24 per Claude msg 48).
 *
 * AI answers, brain context, confirmations and success messages quote
 * amounts that are denominated in the org's books currency, so they are
 * labelled with that currency — never converted, never relabelled.
 *
 * A currency that is present but NOT in the reviewed table renders with
 * its ISO code as a prefix ("XYZ 9,440"); a missing currency renders the
 * bare number ("9,440"). Both cases are logged. NEVER silently fall back
 * to PKR — that is the same bug J1a fixed (an unknown EUR org would read
 * as PKR). Known currencies use the books formatter exactly
 * (formatBooksAmount, "en-PK" grouping, currency-specific digits), so AI
 * output equals the dashboard books string.
 *
 * Unknown/missing numbers use plain en-PK grouping with no forced
 * fraction digits, so 9,440 renders as "9,440" and 9,440.5 as "9,440.5"
 * (no invented precision, no lossy rounding). Only a 3-letter code gets
 * the ISO prefix; anything else (empty string, "EURO", a number) counts
 * as missing. A lowercase code ("eur") is normalised to its known
 * currency rather than flagged unknown.
 */
export type AiCurrencyResolution =
  | { kind: "known"; currency: Currency }
  | { kind: "unknown"; code: string }
  | { kind: "missing" };

export function resolveAiCurrency(currency: unknown): AiCurrencyResolution {
  if (typeof currency === "string") {
    const trimmed = currency.trim();
    if (isCurrency(trimmed)) return { kind: "known", currency: trimmed };
    const upper = trimmed.toUpperCase();
    if (isCurrency(upper)) return { kind: "known", currency: upper };
    if (/^[A-Z]{3}$/.test(upper)) return { kind: "unknown", code: upper };
  }
  return { kind: "missing" };
}

function formatBareNumber(amount: number): string {
  return new Intl.NumberFormat("en-PK").format(amount);
}

export function formatAiMoney(amount: number, currency: unknown): string {
  const resolved = resolveAiCurrency(currency);
  switch (resolved.kind) {
    case "known":
      return formatBooksAmount(amount, resolved.currency, "en-PK");
    case "unknown":
      console.warn(
        `[ai-money] unknown books currency "${resolved.code}" — ISO code prefix, not PKR`,
      );
      return `${resolved.code} ${formatBareNumber(amount)}`;
    case "missing":
      console.warn("[ai-money] missing books currency — bare number, not PKR");
      return formatBareNumber(amount);
  }
}

/**
 * The currency line for the business-query direct prompt, from the same
 * resolution: a known or unknown code is named ("Use EUR currency
 * formatting." / "Use XYZ currency formatting."); a missing currency
 * never invents PKR — the model is told to render bare numbers.
 */
export function aiCurrencyPromptLine(currency: unknown): string {
  const resolved = resolveAiCurrency(currency);
  switch (resolved.kind) {
    case "known":
      return `Use ${resolved.currency} currency formatting.`;
    case "unknown":
      return `Use ${resolved.code} currency formatting.`;
    case "missing":
      return "Currency unknown — render amounts as bare numbers with no currency label.";
  }
}
