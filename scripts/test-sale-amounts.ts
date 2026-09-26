import assert from "node:assert/strict";
import { calculateSaleAmounts, hasAllowedPrecision } from "../src/lib/sales/sale-amounts";
import { addBarcodeLine } from "../src/lib/invoices/barcode";
import { subunitPriceFromMain } from "../src/lib/tradeos/units";

const simpleFraction = calculateSaleAmounts([
  { quantity: 0.125, sellingPrice: 1000, discount: 0 },
]);
assert.equal(simpleFraction.subtotal, 125, "0.125 × 1000 must remain 125.00");
assert.equal(simpleFraction.total, 125);

const adjusted = calculateSaleAmounts([
  { quantity: 0.125, sellingPrice: 1000, discount: 0.01 },
  { quantity: 0.333, sellingPrice: 0.05, discount: 0 },
], { invoiceDiscount: 5, invoiceDiscountType: "percent", taxRate: 10 });
assert.equal(adjusted.lineSubtotal, 125.02, "Line subtotals round to cents before being added");
assert.equal(adjusted.lineDiscount, 0.01);
assert.equal(adjusted.subtotal, 125.01);
assert.equal(adjusted.invoiceDiscount, 6.25);
assert.equal(adjusted.tax, 11.88);
assert.equal(adjusted.total, 130.64);

const flatDiscount = calculateSaleAmounts([
  { quantity: 1, sellingPrice: 10, discount: 1.25 },
], { invoiceDiscount: 0.25, invoiceDiscountType: "flat", taxRate: 8.5 });
assert.equal(flatDiscount.subtotal, 8.75);
assert.equal(flatDiscount.invoiceDiscount, 0.25);
assert.equal(flatDiscount.tax, 0.72);
assert.equal(flatDiscount.total, 9.22);

assert.equal(hasAllowedPrecision("0.125", 3), true);
assert.equal(hasAllowedPrecision("1.2300", 2), true, "Trailing zeros do not change the entered value");
assert.equal(hasAllowedPrecision("0.1251", 3), false);
assert.equal(hasAllowedPrecision("1.005", 2), false);
assert.equal(hasAllowedPrecision("1e-3", 3), false, "Scientific notation is outside the cashier entry contract");
assert.equal(subunitPriceFromMain(10, 3), 3.33, "Derived sub-unit prices stay within the two-decimal money contract");
const scannedSubunit = addBarcodeLine([], { id: "1", name: "Case", unit_type: "Case", units_per_pack: 3, default_selling_price: 10 }, "subunit");
assert.equal(scannedSubunit[0]?.selling_price, "3.33", "Scanned products use the same rounded sub-unit price");

console.log("Sale amount precision tests passed: fractional quantities, subunit values, discounts, tax, and rounding.");
