import type { BarcodeLine } from "@/lib/invoices/barcode";
import { isCurrency, type Currency } from "@/lib/regional/settings";
import { currencyStampStatus, stampLegacyRows, type CurrencyStampStatus } from "./currency-stamp";

/**
 * Held-sales browser storage for Retail POS.
 *
 * Held sales live only in the browser (per account + business scope). The
 * stored shape is validated strictly on read: a corrupt or legacy value
 * must never wedge the POS. `loadHeldSales` quarantines an unreadable
 * value under a backup key and reports an empty list instead of throwing,
 * so the Hold control stays usable; the strict `parseHeldSales` remains
 * for the write paths (hold/resume re-read and refuse on corruption).
 */
export type HeldCounterSale = {
  lines: BarcodeLine[];
  customerId: string | null;
  date: string;
  paymentType: "cash" | "card" | "credit";
  discount: string;
  discountType: "flat" | "percent";
  tax: string;
};
export type HeldSale = {
  id: string;
  savedAt: string;
  /**
   * The org's books currency at the moment the sale was held. Line
   * prices and totals in a held sale are denominated in it, and a books
   * conversion never touches browser storage — so after a currency
   * switch a held sale's amounts belong to the OLD currency and must
   * not be resumed (and silently relabelled) under the new one.
   * Optional because rows written before stamping existed carry no
   * stamp; see heldSaleCurrencyStatus for how those are treated.
   */
  currency?: Currency;
  sale: HeldCounterSale;
};

export const HELD_SALES_LIMIT = 50;

export function heldSalesQuarantineKey(storageKey: string): string {
  return `${storageKey}:quarantined`;
}

export function parseHeldSales(raw: string | null): HeldSale[] {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? "[]");
  } catch {
    throw new Error("Invalid held sales");
  }
  if (!Array.isArray(stored) || stored.length > HELD_SALES_LIMIT || stored.some(row => {
    const draft = row?.sale;
    return typeof row?.id !== "string" || typeof row?.savedAt !== "string" || !draft
      || (row.currency !== undefined && !isCurrency(row.currency))
      || !Array.isArray(draft.lines) || !["cash", "card", "credit"].includes(draft.paymentType)
      || !["flat", "percent"].includes(draft.discountType)
      || ![draft.date, draft.discount, draft.tax].every(value => typeof value === "string")
      || (draft.customerId !== null && typeof draft.customerId !== "string")
      || draft.lines.some((line: Record<string, unknown>) => !line || ![line.quantity, line.selling_price, line.discount].every(value => typeof value === "string") || (line.product_id !== null && typeof line.product_id !== "string") || (line.bonus !== undefined && typeof line.bonus !== "string") || (line.unit_mode !== undefined && !["main", "subunit"].includes(String(line.unit_mode))));
  })) throw new Error("Invalid held sales");
  return stored as HeldSale[];
}

type HeldSalesStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type HeldSalesLoad = { sales: HeldSale[]; quarantined: boolean };

/**
 * Load held sales for the POS mount. A value that fails validation is
 * copied to the quarantine key (best-effort) and reported via
 * `quarantined: true` with an empty list, so a corrupt store can no
 * longer disable Hold for the whole browser profile.
 */
export function loadHeldSales(storage: HeldSalesStorage, storageKey: string): HeldSalesLoad {
  const raw = storage.getItem(storageKey);
  try {
    return { sales: parseHeldSales(raw), quarantined: false };
  } catch {
    if (raw !== null) {
      try {
        storage.setItem(heldSalesQuarantineKey(storageKey), raw);
      } catch {
        // Quarantine is best-effort; the empty list is the recovery.
      }
    }
    return { sales: [], quarantined: true };
  }
}

/**
 * Currency guard for held sales — the shared stamp rule in
 * src/lib/sales/currency-stamp.ts, under held-sale names. A "stale"
 * row (stamped with a currency other than the current books currency)
 * must not resume: its amounts were never converted.
 */
export type HeldSaleCurrencyStatus = CurrencyStampStatus;

export function heldSaleCurrencyStatus(row: HeldSale, booksCurrency: Currency): HeldSaleCurrencyStatus {
  return currencyStampStatus(row, booksCurrency);
}

/**
 * Backfill the currency stamp onto unstamped (legacy) rows with the
 * books currency in force at load. Returns the original array identity
 * when nothing needed stamping, so callers can skip the storage write.
 */
export function stampLegacyHeldSales(
  rows: HeldSale[],
  booksCurrency: Currency,
): { rows: HeldSale[]; stamped: boolean } {
  return stampLegacyRows(rows, booksCurrency);
}
