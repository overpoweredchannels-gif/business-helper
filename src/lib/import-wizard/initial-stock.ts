/** Stock is stored in main units. Only the chosen TradeOS fields determine conversion. */
export function importedInitialStock(values: Record<string, unknown>): number {
  const number = (value: unknown) => value == null || value === "" ? 0 : Number(String(value).replace(/,/g, "").trim());
  const main = number(values.initial_stock);
  const pieces = number(values.initial_stock_subunit);
  if (!Number.isFinite(main) || main < 0 || !Number.isFinite(pieces) || pieces < 0) {
    throw new Error("Initial stock must be a valid non-negative quantity.");
  }
  if (pieces === 0) return main;
  const pack = number(values.units_per_pack);
  if (!Number.isInteger(pack) || pack <= 0) {
    throw new Error("Map Units Per Pack to a positive whole number when importing initial stock in pieces/subunits.");
  }
  const total = main + pieces / pack;
  if (!Number.isFinite(total)) throw new Error("Initial stock quantity is too large.");
  return total;
}
