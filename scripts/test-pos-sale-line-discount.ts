import assert from "node:assert/strict";
import { addBarcodeLine, addScannedLine } from "../src/lib/invoices/barcode";
import { calculateSaleAmounts, calculateSaleLineDiscountAmount } from "../src/lib/sales/sale-amounts";
import { validateSaleDraft } from "../src/lib/sales/sale-draft";

// BUG-2 REPRO MATRIX (run before any behaviour change):
// A product priced 1500, scanned in subunit mode.
const noPack = { id: "np", name: "No pack product", unit_type: "Unit", units_per_pack: null, default_selling_price: 1500 };
const pack10 = { id: "p10", name: "Pack product", unit_type: "Box", subunit_type: "Piece", units_per_pack: 10, default_selling_price: 1500 };

const scannedNoPack = addScannedLine([], noPack, "subunit");
assert.equal(scannedNoPack[0]?.selling_price, "1500", "No-pack product scanned in subunit mode must keep the full 1500 (no pack to divide by)");
assert.equal(scannedNoPack[0]?.unit_mode, "main", "No-pack product falls back to main mode");

const scannedPack = addScannedLine([], pack10, "subunit");
assert.equal(scannedPack[0]?.selling_price, "150", "Pack-10 product scanned in subunit mode divides 1500 by 10 (documented piece pricing)");
assert.equal(scannedPack[0]?.unit_mode, "subunit");

const scannedMain = addBarcodeLine([], pack10, "main");
assert.equal(scannedMain[0]?.selling_price, "1500", "Pack product scanned in main mode keeps the full 1500");

console.log("Barcode price matrix passed: no-pack 1500, pack-10 subunit 150, main 1500.");

// PER-LINE DISCOUNT TYPE: qty 2 × 36.
const line = (discount: string, discount_type?: "flat" | "percent") => ({ quantity: "2", sellingPrice: "36", discount, discountType: discount_type });
assert.equal(calculateSaleAmounts([line("5", "percent")]).total, 68.40, "2 × 36 with 5% line discount = 68.40");
assert.equal(calculateSaleAmounts([line("5", "flat")]).total, 67.00, "2 × 36 with flat 5 line discount = 67.00");
assert.equal(calculateSaleAmounts([line("0.5", "flat")]).total, 71.50, "2 × 36 with flat 0.5 line discount = 71.50");
assert.equal(calculateSaleLineDiscountAmount(line("5", "percent")), 3.60, "5% of 72.00 converts to a 3.60 amount for saving");
assert.throws(() => calculateSaleAmounts([line("100.01", "percent")]), /between 0 and 100/, "Percent over 100 is invalid");
assert.throws(() => calculateSaleAmounts([line("72.01", "flat")]), /cannot exceed/, "Flat over the line gross is invalid");

// Trailing "%" parses as percent, and a legacy line without
// discount_type defaults to flat — both through the draft validator.
const draft = (discount: string, discount_type?: "flat" | "percent") => validateSaleDraft({
  lines: [{ product_id: "p", quantity: "2", selling_price: "36", discount, discount_type }],
  invoiceDiscount: "", invoiceDiscountType: "flat", taxRate: "",
});
assert.equal(draft("5%").valid, true, "Typed 5% validates");
assert.equal(draft("5%").lineTotals[0], 68.40, "Typed 5% computes as percent");
assert.equal(draft("5").lineTotals[0], 67.00, "Legacy line without discount_type stays flat");
assert.equal(draft("101", "percent").valid, false, "Percent over 100 is an inline issue, never a throw");
assert.equal(draft("101", "percent").issues.some(issue => issue.field === "discount"), true);
assert.equal(draft("73", "flat").valid, false, "Flat over gross is an inline issue");

// Invoice (total-bill) percent math is unchanged.
assert.equal(calculateSaleAmounts(
  [{ quantity: "2", sellingPrice: "36", discount: "0" }],
  { invoiceDiscount: 10, invoiceDiscountType: "percent" },
).total, 64.80, "10% total-bill discount on 72.00 = 64.80");

console.log("Per-line discount tests passed: 5% → 68.40, flat 5 → 67.00, flat 0.5 → 71.50, %-parse, legacy flat default, bounds, total-bill percent unchanged.");
