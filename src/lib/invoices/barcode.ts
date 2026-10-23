import { subunitPriceFromMain } from "@/lib/tradeos/units";

export type BarcodeProduct = { id: string | number; name: string; barcode?: string | null; is_active?: boolean | null; unit_type: string | null; subunit_type?: string | null; units_per_pack?: number | null; default_selling_price?: number | null };
export type BarcodeLine = { product_id: string | null; quantity: string; selling_price: string; discount: string; bonus?: string; unit_mode?: "main" | "subunit" };
export function findBarcodeProduct<T extends BarcodeProduct>(products: T[], raw: string): T {
  const code = raw.trim();
  if (!code || code.length > 200) throw new Error("Scan or enter a valid barcode.");
  
  // Normalized matching: case-insensitive, trim whitespace
  // This handles scanners that emit different case than stored
  const normalizedCode = code.toLowerCase();
  const matches = products.filter(product => {
    if (product.is_active === false) return false;
    const stored = product.barcode?.trim().toLowerCase();
    return stored === normalizedCode;
  });
  
  if (!matches.length) {
    // Provide diagnostic info for troubleshooting
    const sampleBarcodes = products
      .filter(p => p.is_active !== false && p.barcode)
      .slice(0, 3)
      .map(p => p.barcode);
    throw new Error(
      `No active product has barcode ${code}. Add it in Products first. ` +
      `(Scanned: "${code}" [${code.length} chars]. ` +
      `Sample stored: ${sampleBarcodes.join(', ') || 'none'})`
    );
  }
  if (matches.length > 1) throw new Error("This barcode belongs to more than one active product. Correct the duplicate barcodes before selling.");
  return matches[0];
}
export function addBarcodeLine<T extends BarcodeLine>(lines: T[], product: BarcodeProduct, requestedMode: "main" | "subunit", recent?: { last_selling_price: number; unit_mode: "main" | "subunit" }): (T | BarcodeLine)[] {
  const pack = Number(product.units_per_pack);
  const mode = requestedMode === "subunit" && Number.isFinite(pack) && pack > 0 ? "subunit" : "main";
  const matched = lines.findIndex(line => line.product_id === String(product.id) && (line.unit_mode ?? "main") === mode);
  if (matched >= 0) return lines.map((line, index) => index === matched ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) } : line);
  let price = Number(product.default_selling_price) || 0;
  if (mode === "subunit") price = subunitPriceFromMain(price, pack);
  if (recent && Number.isFinite(recent.last_selling_price) && recent.last_selling_price >= 0 && (recent.unit_mode === mode || (Number.isFinite(pack) && pack > 0))) {
    price = recent.last_selling_price;
    if (recent.unit_mode !== mode) price = mode === "subunit" ? subunitPriceFromMain(price, pack) : price * pack;
  }
  const next: BarcodeLine = { product_id: String(product.id), quantity: "1", selling_price: price > 0 && Number.isFinite(price) ? String(price) : "", discount: "", bonus: "", unit_mode: mode };
  const empty = lines.findIndex(line => !line.product_id && !line.quantity && !line.selling_price && !line.discount && !line.bonus);
  return empty < 0 ? [...lines, next] : lines.map((line, index) => index === empty ? next : line);
}
/**
 * Add one unit from a SCAN (BUG 1). Scan adds merge on the product alone:
 * the ambient "add one" unit mode is a cashier preference for the NEXT new
 * line, not part of a scanned product's identity — merging on
 * (product, mode) used to split one scanned product onto two lines whenever
 * the mode differed between scans. An existing line keeps its own mode and
 * just gains a unit; only a genuinely new product delegates to
 * addBarcodeLine (which applies the requested mode and pricing).
 */
export function addScannedLine<T extends BarcodeLine>(lines: T[], product: BarcodeProduct, requestedMode: "main" | "subunit", recent?: { last_selling_price: number; unit_mode: "main" | "subunit" }): (T | BarcodeLine)[] {
  const existing = lines.findIndex(line => line.product_id === String(product.id));
  if (existing >= 0) return lines.map((line, index) => index === existing ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) } : line);
  return addBarcodeLine(lines, product, requestedMode, recent);
}
