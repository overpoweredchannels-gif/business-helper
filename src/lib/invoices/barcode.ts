export type BarcodeProduct = { id: string | number; name: string; barcode?: string | null; is_active?: boolean | null; unit_type: string | null; subunit_type?: string | null; units_per_pack?: number | null; default_selling_price?: number | null };
export type BarcodeLine = { product_id: string | null; quantity: string; selling_price: string; discount: string; bonus?: string; unit_mode?: "main" | "subunit" };
export function findBarcodeProduct<T extends BarcodeProduct>(products: T[], raw: string): T {
  const code = raw.trim();
  if (!code || code.length > 200) throw new Error("Scan or enter a valid barcode.");
  const matches = products.filter(product => product.is_active !== false && product.barcode?.trim() === code);
  if (!matches.length) throw new Error(`No active product has barcode ${code}. Add it in Products first.`);
  if (matches.length > 1) throw new Error("This barcode belongs to more than one active product. Correct the duplicate barcodes before selling.");
  return matches[0];
}
export function addBarcodeLine<T extends BarcodeLine>(lines: T[], product: BarcodeProduct, requestedMode: "main" | "subunit", recent?: { last_selling_price: number; unit_mode: "main" | "subunit" }): (T | BarcodeLine)[] {
  const pack = Number(product.units_per_pack);
  const mode = requestedMode === "subunit" && product.subunit_type && Number.isFinite(pack) && pack > 0 ? "subunit" : "main";
  const matched = lines.findIndex(line => line.product_id === String(product.id) && (line.unit_mode ?? "main") === mode);
  if (matched >= 0) return lines.map((line, index) => index === matched ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) } : line);
  let price = Number(product.default_selling_price) || 0;
  if (mode === "subunit") price /= pack;
  if (recent && Number.isFinite(recent.last_selling_price)) {
    price = recent.last_selling_price;
    if (recent.unit_mode !== mode) price = mode === "subunit" ? price / pack : price * pack;
  }
  const next: BarcodeLine = { product_id: String(product.id), quantity: "1", selling_price: price > 0 && Number.isFinite(price) ? String(price) : "", discount: "", bonus: "", unit_mode: mode };
  const empty = lines.findIndex(line => !line.product_id && !line.quantity && !line.selling_price && !line.discount && !line.bonus);
  return empty < 0 ? [...lines, next] : lines.map((line, index) => index === empty ? next : line);
}
