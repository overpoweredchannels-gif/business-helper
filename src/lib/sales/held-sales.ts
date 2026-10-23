import type { BarcodeLine } from "@/lib/invoices/barcode";

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
  paymentType: "cash" | "credit";
  discount: string;
  discountType: "flat" | "percent";
  tax: string;
};
export type HeldSale = { id: string; savedAt: string; sale: HeldCounterSale };

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
      || !Array.isArray(draft.lines) || !["cash", "credit"].includes(draft.paymentType)
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
