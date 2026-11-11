import { isCurrency, type Currency } from "@/lib/regional/settings";

/**
 * Owner-entered FX rates: the single conversion authority.
 *
 * A stored rate is PKR per 1 unit of a currency, saved by the owner in
 * fx_quotes (see /api/fx/rates and the FxRatesPanel). Every conversion
 * in the app derives from these rates — the header switch, the display
 * formatter and the EUR documents. There is no live-rate source any
 * more: no fetch, no hint, no fallback. A missing rate is null, never
 * 1.0 and never a live quote, so callers must prompt or refuse rather
 * than convert on a guessed rate.
 */

/** Parse a stored rate (string from the API, or a number) to a finite rate > 0. */
export function parseStoredPkrPerUnit(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * PKR per 1 unit of the currency: PKR is the identity (1) and needs no
 * stored row; any other currency needs its stored rate — a missing rate
 * is null, never 1.
 */
export function pkrPerUnitFor(
  currency: Currency,
  storedRate: number | null,
): number | null {
  if (!isCurrency(currency)) return null;
  if (currency === "PKR") return 1;
  return storedRate;
}

/**
 * Books-switch rate: "1 <from> = rate <to>", from PKR-per-unit rates.
 * Null on any missing or invalid leg — the switch must never run on a
 * guessed rate.
 */
export function switchRateFromPkrPerUnit(
  fromPkrPerUnit: number | null,
  toPkrPerUnit: number | null,
): number | null {
  if (
    typeof fromPkrPerUnit !== "number" ||
    !Number.isFinite(fromPkrPerUnit) ||
    fromPkrPerUnit <= 0
  )
    return null;
  if (
    typeof toPkrPerUnit !== "number" ||
    !Number.isFinite(toPkrPerUnit) ||
    toPkrPerUnit <= 0
  )
    return null;
  return fromPkrPerUnit / toPkrPerUnit;
}

/**
 * Client-side shape check for a typed rate: the same shape the server
 * enforces (parseRateToMicro) — digits, up to 6 decimals, greater than
 * zero. The server re-validates; this only gives immediate feedback.
 */
export function isValidTypedRate(input: string): boolean {
  const trimmed = input.trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed);
  if (!m) return false;
  return Number.parseFloat(trimmed) > 0;
}
