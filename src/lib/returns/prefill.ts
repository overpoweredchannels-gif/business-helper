// Return prefill: remaining returnable quantity per invoice line.
//
// One helper for both return forms (sales + purchase), so the two prefills
// can never drift apart again. The rule, mirroring the server-side quantity
// guards (POST /api/sales/returns, POST /api/purchases/returns):
//   - sold and already-returned quantities are normalized to MAIN units
//     before subtracting (a subunit line and a main-unit return of the same
//     product must never be subtracted raw);
//   - the remaining quantity is converted BACK into the invoice line's own
//     unit mode, so the user sees a familiar number;
//   - returns whose parent is cancelled never count — a cancelled return
//     restores the returnable quantity in full.
//
// The sales prefill used to subtract raw quantities (page.tsx, pre-2026-11-12):
// an invoice line of 24 subunits with a prior return of 1 main (12/pack)
// prefilled 23 subunits instead of 12, and an invoice line of 2 main with a
// prior return of 12 subunits prefilled 0 instead of 1 main. The purchase
// prefill was fixed to normalize on 2026-08-18; this helper is that exact
// logic, extracted verbatim, plus the cancelled exclusion both prefills
// were missing.

import { quantityToMainUnits, type UnitMode } from "@/lib/tradeos/units";
import { safeNumber } from "@/lib/tradeos/validators";

export interface PrefillInvoiceLine {
  product_id: string | number;
  quantity: number | string;
  unit_mode?: UnitMode | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface PrefillReturnedItem {
  product_id: string | number;
  quantity: number | string;
  unit_mode?: UnitMode | null;
  /** True when the parent return's status is 'cancelled'. */
  cancelled: boolean;
}

export interface PrefillProduct {
  id: string | number;
  units_per_pack?: number | null;
}

export interface PrefillLine {
  product_id: string;
  quantity: string;
  unit_mode: UnitMode;
  batch_number: string;
  expiry_date: string;
}

export function buildReturnPrefillLines(args: {
  invoiceItems: readonly PrefillInvoiceLine[];
  returnedItems: readonly PrefillReturnedItem[];
  products: readonly PrefillProduct[];
}): PrefillLine[] {
  const { invoiceItems, returnedItems, products } = args;
  const unitsPerPackByProduct = new Map<string, number>(
    products.map((product) => [String(product.id), Number(product.units_per_pack ?? 0)])
  );
  const toMainUnits = (productId: string | number, quantity: number | string, mode: UnitMode | null | undefined) =>
    quantityToMainUnits(safeNumber(quantity), mode ?? "main", unitsPerPackByProduct.get(String(productId)));

  // Already-returned quantities, normalized to main units. Cancelled
  // returns never count — cancelling one restores the full returnable
  // quantity, exactly as the server guard computes it.
  const returnedByProduct = new Map<string, number>();
  for (const item of returnedItems) {
    if (item.cancelled) continue;
    const key = String(item.product_id);
    returnedByProduct.set(
      key,
      (returnedByProduct.get(key) ?? 0) + toMainUnits(item.product_id, item.quantity, item.unit_mode ?? "main")
    );
  }

  return invoiceItems.map((item) => {
    const key = String(item.product_id);
    const product = products.find((p) => String(p.id) === key);
    const alreadyReturned = returnedByProduct.get(key) ?? 0;
    const soldMain = toMainUnits(item.product_id, item.quantity, item.unit_mode ?? "main");
    const remainingMain = Math.max(0, soldMain - alreadyReturned);
    // Prefill in the line's own unit mode so the user sees a familiar number.
    const pack = Number(product?.units_per_pack ?? 0);
    const remaining =
      item.unit_mode === "subunit" && pack > 0 ? remainingMain * pack : remainingMain;
    return {
      product_id: key,
      quantity: String(remaining),
      unit_mode: item.unit_mode ?? "main",
      batch_number: item.batch_number ?? "",
      expiry_date: item.expiry_date ?? "",
    };
  });
}
