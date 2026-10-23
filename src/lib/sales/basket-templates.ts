import { isCurrency, type Currency } from "@/lib/regional/settings";
import { currencyStampStatus, stampLegacyRows, type CurrencyStampStatus } from "./currency-stamp";
import type { HeldCounterSale } from "./held-sales";

/**
 * Basket-template browser storage for Retail POS (tradeos-pos-baskets-v1).
 *
 * A template is a reusable counter sale: its line prices are denominated
 * in the org's books currency at the moment it was saved, and a books
 * conversion never touches browser storage — the same risk class as
 * held sales, so templates carry the same currency stamp and obey the
 * shared stamp rule (src/lib/sales/currency-stamp.ts): stamp at save,
 * backfill legacy rows at load, and block applying a "stale" template
 * (kept exactly as stored, never silently relabelled).
 *
 * The sale shape is the shared counter-sale shape (HeldCounterSale):
 * RetailPOS's CounterSale is structurally identical.
 */
export type BasketTemplate = {
  id: string;
  name: string;
  sale: HeldCounterSale;
  savedAt: string;
  /** The org's books currency at save time; absent on pre-stamping rows. */
  currency?: Currency;
};

/**
 * Parse the stored template list. Mirrors the reader RetailPOS used
 * inline: invalid JSON or a non-array value throws (the mount load
 * recovers to an empty list), structurally invalid rows are filtered
 * out. One tightening: a row whose currency stamp is present but not a
 * real currency is dropped — its amounts' denomination is unknowable,
 * so it must never be applied under any label.
 */
export function parseBasketTemplates(raw: string | null): BasketTemplate[] {
  const stored: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(stored)) throw new Error("Invalid basket templates");
  return stored.filter((row): row is BasketTemplate =>
    Boolean(row) && typeof row === "object"
    && typeof (row as BasketTemplate).id === "string"
    && typeof (row as BasketTemplate).name === "string"
    && !!(row as BasketTemplate).sale
    && ((row as BasketTemplate).currency === undefined || isCurrency((row as BasketTemplate).currency)),
  );
}

export type BasketTemplateCurrencyStatus = CurrencyStampStatus;

export function basketTemplateCurrencyStatus(
  row: BasketTemplate,
  booksCurrency: Currency,
): BasketTemplateCurrencyStatus {
  return currencyStampStatus(row, booksCurrency);
}

/**
 * Backfill the currency stamp onto unstamped (legacy) templates with
 * the books currency in force at load. Returns the original array
 * identity when nothing needed stamping, so callers can skip the
 * storage write.
 */
export function stampLegacyBasketTemplates(
  rows: BasketTemplate[],
  booksCurrency: Currency,
): { rows: BasketTemplate[]; stamped: boolean } {
  return stampLegacyRows(rows, booksCurrency);
}
