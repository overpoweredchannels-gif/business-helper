import assert from "node:assert/strict";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import {
  buildPrintableReceiptHtml,
  getReceiptPrintableWidthMm,
  normalizeReceiptWidthMm,
  resolveReceiptChrome,
  type Receipt,
  type ReceiptChromeLabels,
} from "../src/lib/print/retail-receipt";
import { translate } from "../src/lib/regional/messages";

// BUG 3 regression gate: receipts must be laid out to the PRINTABLE width of
// the paper (58mm roll -> 48mm, 80mm roll -> 72mm), values must never slice
// mid-digit, shipped-default template chrome must localize at print time,
// and the Qty cell must carry the numeral only (unit under the item name).

const receipt: Receipt = {
  scope: "test-org:test-owner",
  business: "KM SUPERMARKET",
  number: "S-100004",
  date: "20 Oct 2026",
  customer: "Walk-in customer",
  lineSubtotal: 1.3,
  lineDiscount: 0,
  subtotal: 1.3,
  invoiceDiscount: 0,
  tax: 0,
  taxRate: 0,
  total: 1.3,
  received: 2,
  change: 0.7,
  payment: "cash",
  lines: [{ name: "Orbit Menta", quantity: "1", unit: "alimentación", price: "1.30", discount: "0" }],
};

const template58 = cloneDefaultTemplate("retail_receipt");
template58.receiptWidthMm = 58;
const template80 = cloneDefaultTemplate("retail_receipt");
template80.receiptWidthMm = 80;

// --- Paper-width normalization: a stored 58 stays 58. ---
assert.equal(normalizeReceiptWidthMm(58), 58);
assert.equal(normalizeReceiptWidthMm("58"), 58);
assert.equal(normalizeReceiptWidthMm(80), 80);
assert.equal(normalizeReceiptWidthMm(undefined), 80);
assert.equal(getReceiptPrintableWidthMm(template58), 48);
assert.equal(getReceiptPrintableWidthMm(template80), 72);

// --- Printable-width sizing: @page keeps the true paper size, the layout
// body is sized to the printable width and centered. ---
const html58 = buildPrintableReceiptHtml(receipt, template58);
assert.match(html58, /@page\{size:58mm auto;margin:0\}/, "58 profile keeps the true 58mm page size");
assert.match(html58, /body\{width:48mm;max-width:48mm;margin:0 auto/, "58 profile body is sized to the 48mm printable width");
assert.doesNotMatch(html58, /body\{width:58mm/, "58 profile body must not be sized to the nominal paper width");
assert.match(html58, /data-receipt-content-width="48mm"/);

const html80 = buildPrintableReceiptHtml(receipt, template80);
assert.match(html80, /@page\{size:80mm auto;margin:0\}/, "80 profile keeps the true 80mm page size");
assert.match(html80, /body\{width:72mm;max-width:72mm;margin:0 auto/, "80 profile body is sized to the 72mm printable width");
assert.doesNotMatch(html80, /body\{width:80mm/, "80 profile body must not be sized to the nominal paper width");
assert.match(html80, /data-receipt-content-width="72mm"/);

// --- Values never slice mid-digit: summary values and numeric cells carry a
// nowrap rule, and the summary row may wrap as a unit instead. ---
assert.match(html58, /\.summary-row strong\{[^}]*white-space:nowrap/, "summary values are nowrap");
assert.match(html58, /\.summary-row\{[^}]*flex-wrap:wrap/, "summary rows wrap as a unit");
assert.match(html58, /th\.num,td\.num\{white-space:nowrap/, "numeric table cells are nowrap");

// --- Qty cell: numeral only; the unit appears under the item name. ---
assert.doesNotMatch(html58, /1 alimentación/, "quantity cell no longer glues the unit to the numeral");
assert.match(html58, /<td class="num" style="[^"]*">1<\/td>/, "quantity cell contains the numeral alone");
assert.match(html58, /Orbit Menta<span class="line-unit">alimentación<\/span>/, "unit renders as a second line under the product name");

// --- Chrome localization: with Spanish labels and the default template, the
// printed HTML is Spanish and contains none of the English defaults. ---
const esChrome: ReceiptChromeLabels = {
  heading: translate("es", "receipt.heading"),
  dateLabel: translate("es", "receipt.dateLabel"),
  footnote: translate("es", "receipt.footnote"),
  walkInCustomer: translate("es", "receipt.walkInCustomer"),
  columns: {
    product: translate("es", "receipt.columnItem"),
    quantity: translate("es", "receipt.columnQty"),
    price: translate("es", "receipt.columnRate"),
    total: translate("es", "receipt.columnAmount"),
  },
};
const htmlEs = buildPrintableReceiptHtml(receipt, template58, undefined, esChrome);
for (const expected of ["Recibo de venta", "Fecha:", "Artículo", "Cant.", "Precio", "Importe", "Gracias por su compra.", "Cliente ocasional"]) {
  assert.ok(htmlEs.includes(expected), `Spanish receipt includes ${expected}`);
}
for (const forbidden of ["Sales Receipt", "Thank you for your business.", "Walk-in customer", ">Item<", ">Qty<", ">Rate<", ">Amount<"]) {
  assert.ok(!htmlEs.includes(forbidden), `Spanish receipt must not include the English default ${forbidden}`);
}

// --- Customized template text is never overridden by localization. ---
const customTemplate = cloneDefaultTemplate("retail_receipt");
customTemplate.receiptWidthMm = 58;
customTemplate.header.headingText = "Nota de venta";
customTemplate.header.dateLabel = "Día";
customTemplate.footer.footnoteText = "Custom closing note.";
customTemplate.columns.labels = customTemplate.columns.labels.map(column =>
  column.key === "product" ? { ...column, label: "Producto" } : column);
const resolvedCustom = resolveReceiptChrome(customTemplate, esChrome);
assert.equal(resolvedCustom.headingText, "Nota de venta");
assert.equal(resolvedCustom.dateLabel, "Día");
assert.equal(resolvedCustom.footnoteText, "Custom closing note.");
assert.equal(resolvedCustom.columns.find(column => column.key === "product")?.label, "Producto");
assert.equal(resolvedCustom.columns.find(column => column.key === "quantity")?.label, "Cant.", "untouched default column labels still localize");
const htmlCustom = buildPrintableReceiptHtml(receipt, customTemplate, undefined, esChrome);
assert.ok(htmlCustom.includes("Nota de venta"), "custom heading prints verbatim");
assert.ok(htmlCustom.includes("Custom closing note."), "custom footnote prints verbatim");
assert.ok(!htmlCustom.includes("Recibo de venta"), "custom heading is not replaced by the localized default");

// --- A renamed walk-in customer is data, not chrome: it prints as stored. ---
const renamedHtml = buildPrintableReceiptHtml({ ...receipt, customer: "Cliente Mostrador" }, template58, undefined, esChrome);
assert.ok(renamedHtml.includes("Cliente Mostrador"), "renamed walk-in customer prints as stored");
assert.ok(!renamedHtml.includes("Cliente ocasional"), "renamed walk-in customer is not force-localized");


// --- 40mm profile (2026-10-29): normalize + printable width + stacked lines. ---
assert.equal(normalizeReceiptWidthMm(40), 40);
assert.equal(normalizeReceiptWidthMm("40"), 40);
const template40 = cloneDefaultTemplate("retail_receipt");
template40.receiptWidthMm = 40;
assert.equal(getReceiptPrintableWidthMm(template40), 32);
const html40 = buildPrintableReceiptHtml(receipt, template40);
assert.match(html40, /@page\{size:40mm auto;margin:0\}/, "40 profile keeps the true 40mm page size");
assert.match(html40, /body\{width:32mm;max-width:32mm;margin:0 auto/, "40 profile body is sized to the 32mm printable width");
assert.doesNotMatch(html40, /<table>/, "40 profile must not render the table (it would clip)");
assert.ok(html40.includes("data-receipt-line"), "40 profile renders stacked lines");
assert.ok(html40.includes("1 \u00d7 Rs\u00a01.30 = Rs\u00a01.30"), "40 stacked detail composes qty x rate = amount with unbroken money tokens");
const discountReceipt = { ...receipt, lines: [{ name: "Orbit Menta", quantity: "2", unit: "Pcs", price: "1.30", discount: "0.30" }] };
// The default receipt template has no discount column, so the segment is
// omitted there; a template WITH a discount column shows it.
const html40Discount = buildPrintableReceiptHtml(discountReceipt, template40);
assert.ok(html40Discount.includes("2 \u00d7 Rs\u00a01.30 = Rs\u00a02.30"), "40 stacked detail omits the discount segment when the template has no discount column");
const template40Discount = cloneDefaultTemplate("retail_receipt");
template40Discount.receiptWidthMm = 40;
template40Discount.columns.labels.push({ key: "discount", label: "Disc", widthPct: 10 });
const html40DiscountCol = buildPrintableReceiptHtml(discountReceipt, template40Discount);
assert.ok(html40DiscountCol.includes("2 \u00d7 Rs\u00a01.30 \u2212 Rs\u00a00.30 = Rs\u00a02.30"), "40 stacked detail shows the discount segment when the template has a discount column");

// Field palette (2026-10-29): a template WITH a bonus column shows the bonus
// segment/cell; the default template (no bonus column) never invents one.
// This is the receipt half of the palette — discount is covered above.
const bonusReceipt = { ...receipt, total: 2.6, lines: [{ name: "Orbit Menta", quantity: "2", unit: "Pcs", price: "1.30", discount: "0", bonus: "1" }] };
const template40Bonus = cloneDefaultTemplate("retail_receipt");
template40Bonus.receiptWidthMm = 40;
template40Bonus.columns.labels.push({ key: "bonus", label: "Bonus", widthPct: 10 });
const html40BonusCol = buildPrintableReceiptHtml(bonusReceipt, template40Bonus);
assert.ok(html40BonusCol.includes("+ 1 Pcs"), "40 stacked detail shows the bonus segment when the template has a bonus column");
const html40BonusDefault = buildPrintableReceiptHtml(bonusReceipt, template40);
assert.ok(!html40BonusDefault.includes("+ 1 Pcs"), "40 stacked detail omits the bonus segment when the template has no bonus column");

console.log("POS receipt layout tests passed: printable-width sizing (48/72mm), nowrap values, Spanish default chrome, custom chrome preserved, qty numeral + unit line.");
