import { type Currency } from "@/lib/regional/settings";

/**
 * Books-currency stamps for browser-stored sale data (held sales,
 * basket templates).
 *
 * Rows kept in localStorage carry prices and totals denominated in the
 * org's books currency at the moment they were saved, and a books
 * conversion never touches browser storage. Each row therefore carries
 * a `currency` stamp, and one shared status rule decides what may
 * happen to it under the books currency in force now:
 *
 * - "current": stamped with the current books currency — use normally.
 * - "legacy": no stamp. The row predates stamping, so it was
 *   necessarily saved before the books-switch flow could ever have run
 *   against this browser's org (the switch and the stamp shipped in
 *   the same model); its amounts are denominated in the books currency
 *   in force when it was saved — the current one. It may be used, and
 *   callers backfill the stamp at load (stampLegacyRows) so any FUTURE
 *   switch turns the row "stale" instead.
 * - "stale": stamped with a different currency — a books conversion
 *   happened after the row was saved and its amounts were not
 *   converted. Using it would book old-currency amounts under the new
 *   currency's label, so the caller must block the use and keep the
 *   row exactly as stored.
 */
export type CurrencyStampStatus = "current" | "legacy" | "stale";

export function currencyStampStatus(
  row: { currency?: Currency },
  booksCurrency: Currency,
): CurrencyStampStatus {
  if (row.currency === undefined) return "legacy";
  return row.currency === booksCurrency ? "current" : "stale";
}

/**
 * Backfill the currency stamp onto unstamped (legacy) rows with the
 * books currency in force at load. Returns the original array identity
 * when nothing needed stamping, so callers can skip the storage write.
 */
export function stampLegacyRows<T extends { currency?: Currency }>(
  rows: T[],
  booksCurrency: Currency,
): { rows: T[]; stamped: boolean } {
  if (!rows.some(row => row.currency === undefined)) return { rows, stamped: false };
  return {
    rows: rows.map(row => (row.currency === undefined ? { ...row, currency: booksCurrency } : row)),
    stamped: true,
  };
}
