import assert from "node:assert/strict";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import { buildAtomicSaleReceipt, buildOfflineSaleReceipt, buildPrintableReceiptHtml, getReceiptSummaryRows, type Receipt } from "../src/lib/print/retail-receipt";
import { formatAvailableStock } from "../src/lib/products/stock-display";

const confirmedReceipt = buildAtomicSaleReceipt({
  customer_name: "Walk-in",
  transaction: {
    invoice_number: "S-100126", sale_date: "2026-09-26", payment_type: "cash",
    discount_amount: "5.00", tax_rate: "10.00", tax_amount: "12.00",
    total_amount: "131.99", cash_received: "135.00", change_due: "3.01",
  },
  items: [{ product_name: "Small Pack", quantity: "0.125", selling_price: "1000.00", discount: "0.01", bonus: "0.000", unit_mode: "main", unit_type: "Case" }],
}, { scope: "org:owner", business: "Corner Shop", fallbackDate: "today", fallbackPayment: "credit" });
assert.equal(confirmedReceipt.lines[0]?.quantity, "0.125");
assert.equal(confirmedReceipt.date, "26-Sept-2026", "saved sale dates use the app's Pakistan date format");
assert.equal(confirmedReceipt.lineSubtotal, 125);
assert.equal(confirmedReceipt.lineDiscount, 0.01);
assert.equal(confirmedReceipt.subtotal, 124.99);
assert.deepEqual(getReceiptSummaryRows(confirmedReceipt).map(row => row.amount), [125, 0.01, 124.99, 5, 12, 131.99, 135, 3.01]);

const shortReceipt: Receipt = {
  scope: "test-org:test-owner",
  business: "Corner Shop",
  number: "S-100125",
  date: "26 Sep 2026",
  customer: "Walk-in",
  lineSubtotal: 150,
  lineDiscount: 5,
  subtotal: 145,
  invoiceDiscount: 10,
  tax: 12.15,
  taxRate: 9,
  total: 147.15,
  received: 200,
  change: 52.85,
  payment: "cash",
  lines: [{ name: "Cooking Oil 1L", quantity: "3", unit: "Bottle", price: "50", discount: "5", bonus: "1" }],
};

const summary = getReceiptSummaryRows(shortReceipt);
assert.deepEqual(summary.map(row => row.label), [
  "Items subtotal", "Line discounts", "Subtotal", "Invoice discount", "Tax (9%)", "Total", "Tendered", "Change due",
]);
assert.equal(summary.find(row => row.label === "Total")?.amount, 147.15);
assert.equal(summary.find(row => row.label === "Change due")?.amount, 52.85);
assert.equal(formatAvailableStock(0), "0", "available stock keeps explicit zero visible");
assert.equal(formatAvailableStock(0.125), "0.125", "available stock keeps fractional quantity visible");
assert.equal(formatAvailableStock(null), "0", "missing stock uses the existing zero fallback");
assert.equal(formatAvailableStock("0.125"), "0.125");
assert.equal(formatAvailableStock(-0.125), "-0.125");
assert.equal(formatAvailableStock(Number.NaN), "0");
assert.equal(formatAvailableStock(Infinity), "0");

const smallTemplate = cloneDefaultTemplate("retail_receipt");
smallTemplate.receiptWidthMm = 58;
const smallHtml = buildPrintableReceiptHtml(shortReceipt, smallTemplate);
const fractionalSmallHtml = buildPrintableReceiptHtml(confirmedReceipt, smallTemplate);
assert.match(smallHtml, /@page\{size:58mm auto;margin:0\}/);
assert.match(smallHtml, /data-receipt-paper-width="58mm"/);
for (const value of ["Items subtotal", "Line discounts", "Invoice discount", "Tax (9%)", "Tendered", "Change due", "Rs"]){
  assert.ok(smallHtml.includes(value), `Printed receipt includes ${value}`);
}
assert.match(smallHtml, /Cooking Oil 1L/);
assert.match(fractionalSmallHtml, />0\.125</, "58mm receipt quantity cell preserves the three-decimal quantity numeral");
assert.ok(fractionalSmallHtml.includes("Case"), "58mm receipt shows the unit under the product name");
assert.doesNotMatch(fractionalSmallHtml, /0\.125 Case/, "58mm receipt quantity cell no longer glues the unit to the numeral");
assert.doesNotMatch(smallHtml, /window\.onload|window\.print/);

const longReceipt: Receipt = {
  ...shortReceipt,
  business: "The Very Long Neighborhood Wholesale and Retail Grocery Trading Company Limited",
  customer: "Customer With A Long Name For A Large Invoice",
  lineSubtotal: 9876543210.75,
  lineDiscount: 3210.75,
  subtotal: 9876540000,
  invoiceDiscount: 123456.78,
  tax: 987654.32,
  taxRate: 10,
  total: 9877404197.54,
  received: 10000000000,
  change: 122595802.46,
  lines: Array.from({ length: 40 }, (_, index) => ({
    name: `Long Product Name ${index + 1} With Extra Packaging Details And Variant Description`,
    quantity: "0.125",
    unit: "Small Consumer Pack",
    price: "1000.00",
    discount: "0.25",
  })),
};
const wideTemplate = cloneDefaultTemplate("retail_receipt");
wideTemplate.receiptWidthMm = 80;
const longHtml = buildPrintableReceiptHtml(longReceipt, wideTemplate);
const fractionalWideHtml = buildPrintableReceiptHtml(confirmedReceipt, wideTemplate);
assert.match(longHtml, /@page\{size:80mm auto;margin:0\}/);
assert.match(longHtml, /data-receipt-paper-width="80mm"/);
assert.equal((longHtml.match(/<tr data-receipt-line=/g) ?? []).length, 40, "Long receipts keep every product line");
assert.match(longHtml, /overflow-wrap:anywhere/);
assert.match(fractionalWideHtml, />0\.125</, "80mm receipt quantity cell preserves the three-decimal quantity numeral");
assert.ok(fractionalWideHtml.includes("Case"), "80mm receipt shows the unit under the product name");
assert.doesNotMatch(fractionalWideHtml, /0\.125 Case/, "80mm receipt quantity cell no longer glues the unit to the numeral");
assert.match(longHtml, /Rs 9,877,404,197\.54|Rs 9,877,404,197\.54/);

const creditRows = getReceiptSummaryRows({ ...shortReceipt, payment: "credit" });
assert.equal(creditRows.some(row => row.label === "Tendered" || row.label === "Change due"), false);

// --- Organization footer note + payment terms (2026-11-12): the
// receipt renderers printed only the template's footnote — what the
// owner set in Business Settings never appeared. The receipt now
// carries both, rendered after the template footnote in the same
// footer zone and style; each renders only when set.
const orgReceipt: Receipt = {
  ...shortReceipt,
  footerNote: "Thank you, please visit again.",
  paymentTerms: "Due on receipt",
};
const orgHtml = buildPrintableReceiptHtml(orgReceipt, smallTemplate);
assert.ok(orgHtml.includes("Thank you for your business."), "template footnote still renders first");
assert.ok(orgHtml.includes("Payment Terms:"), "payment terms label renders");
assert.ok(orgHtml.includes("Due on receipt"), "payment terms render exactly as set");
assert.ok(orgHtml.includes("Thank you, please visit again."), "footer note renders exactly as set");
assert.ok(orgHtml.indexOf("Thank you for your business.") < orgHtml.indexOf("Payment Terms:"), "template footnote precedes the org lines");
// Unset: the receipt renders exactly as before — no empty block, no
// "Payment Terms:" line.
assert.ok(!smallHtml.includes("Payment Terms:"), "unset terms render nothing");
assert.ok(!smallHtml.includes("Thank you, please visit again."), "unset footer note renders nothing");
// Org lines are org settings, not template content: turning the
// template footnote off must not silently drop what the owner set.
const noFootnoteReceiptTemplate = cloneDefaultTemplate("retail_receipt");
noFootnoteReceiptTemplate.footer.showFootnote = false;
const noFootnoteReceiptHtml = buildPrintableReceiptHtml(orgReceipt, noFootnoteReceiptTemplate);
assert.ok(!noFootnoteReceiptHtml.includes("Thank you for your business."), "template footnote off hides the template text");
assert.ok(noFootnoteReceiptHtml.includes("Due on receipt"), "org terms still render with the template footnote off");
assert.ok(noFootnoteReceiptHtml.includes("Thank you, please visit again."), "org footer note still renders with the template footnote off");
// Both receipt builders carry the fields through.
const orgConfirmed = buildAtomicSaleReceipt({
  customer_name: "Walk-in",
  transaction: {
    invoice_number: "S-100126", sale_date: "2026-09-26", payment_type: "cash",
    discount_amount: "5.00", tax_rate: "10.00", tax_amount: "12.00",
    total_amount: "131.99", cash_received: "135.00", change_due: "3.01",
  },
  items: [{ product_name: "Small Pack", quantity: "0.125", selling_price: "1000.00", discount: "0.01", bonus: "0.000", unit_mode: "main", unit_type: "Case" }],
}, { scope: "org:owner", business: "Corner Shop", fallbackDate: "today", fallbackPayment: "credit", footerNote: "Thank you, please visit again.", paymentTerms: "Due on receipt" });
assert.equal(orgConfirmed.footerNote, "Thank you, please visit again.");
assert.equal(orgConfirmed.paymentTerms, "Due on receipt");
const orgOffline = buildOfflineSaleReceipt(
  { customer_id: "c1", sale_date: "2026-09-26", payment_type: "cash", invoice_discount: 0, invoice_discount_type: "flat", tax_rate: 0, cash_received: 200, credit_override_confirmed: false, lines: [{ product_id: "p1", quantity: 1, selling_price: 100, discount: 0, bonus: 0, unit_mode: "main" }] },
  { scope: "org:owner", business: "Corner Shop", pendingLabel: "Pending sync", customerName: "Walk-in", footerNote: "Thank you, please visit again.", paymentTerms: "Due on receipt", productById: () => ({ name: "Sample", unit_type: "Pcs" }) },
);
assert.equal(orgOffline.footerNote, "Thank you, please visit again.");
assert.equal(orgOffline.paymentTerms, "Due on receipt");

console.log("POS receipt tests passed: confirmed amounts, 58mm/80mm layouts, wrapping, short/long content, tender/change, and org footer note + payment terms.");
