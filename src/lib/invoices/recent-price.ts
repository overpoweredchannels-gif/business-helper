type UnitMode = "main" | "subunit";
export function applyRecentLinePrice<T extends { unit_mode?: UnitMode; selling_price: string }>(
  line: T,
  product: { units_per_pack?: number | null } | undefined,
  recent: { last_selling_price: number; unit_mode: UnitMode } | undefined,
): T {
  if (!product || !recent || !Number.isFinite(recent.last_selling_price) || recent.last_selling_price < 0) return line;
  const mode = line.unit_mode ?? "main";
  let price = recent.last_selling_price;
  if (mode !== recent.unit_mode) {
    const pack = Number(product.units_per_pack);
    if (!Number.isFinite(pack) || pack <= 0) return line;
    price = mode === "subunit" ? price / pack : price * pack;
  }
  return Number.isFinite(price) ? { ...line, selling_price: String(price) } : line;
}
