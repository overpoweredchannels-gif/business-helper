// TradeOS ERP — Main unit / subunit conversion helpers.
//
// Products carry a main unit (unit_type, e.g. "Cottons") and an optional
// subunit (subunit_type, e.g. "Pieces") with units_per_pack subunits per main
// unit (e.g. 20 pieces per cotton). Every product-line entry form lets the
// user choose the unit to buy/sell in via a `unit_mode` per line:
//   - "main": quantity is expressed in the main unit (e.g. 10 cottons)
//   - "subunit": quantity is expressed in the subunit (e.g. 25 pieces)
//
// Value math: quantity * price always works because the price entered for a
// line is per the selected unit. For subunit lines the unit price auto-derives
// as mainUnitPrice / units_per_pack (editable). Stock is normalized to main
// units by the inventory sync triggers in src/lib/migrations/add_unit_mode_subunit.sql.

export type UnitMode = "main" | "subunit";

export const UNIT_MODE_LABELS: Record<UnitMode, string> = {
  main: "Main unit",
  subunit: "Subunit",
};

export interface UnitAwareProduct {
  unit_type?: string | null;
  subunit_type?: string | null;
  units_per_pack?: number | null;
}

/** True when the product has a subunit (a pack size is defined). */
export const hasSubunit = (product: UnitAwareProduct | null | undefined): boolean =>
  Boolean(product && product.units_per_pack && product.units_per_pack > 0);

/** Display label for a unit mode given the product's stored unit names. */
export const unitLabelFor = (product: UnitAwareProduct | null | undefined, mode: UnitMode): string => {
  if (!product) return mode === "main" ? "Unit" : "Subunit";
  if (mode === "main") return product.unit_type?.trim() || "Unit";
  return product.subunit_type?.trim() || "Subunit";
};

/** Subunit price derived from a main-unit price (e.g. 200 / 20 = 10). */
export const subunitPriceFromMain = (mainPrice: number, unitsPerPack: number): number => {
  if (!unitsPerPack || unitsPerPack <= 0) return mainPrice;
  return mainPrice / unitsPerPack;
};

/** Convert a quantity expressed in a given mode to main units (for stock). */
export const quantityToMainUnits = (quantity: number, mode: UnitMode, unitsPerPack: number | null | undefined): number => {
  if (mode !== "subunit") return quantity;
  if (unitsPerPack && unitsPerPack > 0) return quantity / unitsPerPack;
  return quantity;
};