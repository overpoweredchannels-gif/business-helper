import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import { SalesInvoiceDocument } from "../src/lib/sales/sales-invoice-render";
import { buildSalesInvoicePreviewRowsHtml } from "../src/lib/sales/sales-invoice-preview";
import type { SalesInvoiceDoc } from "../src/lib/sales/sales-invoice-service";

// The A4 sales invoice must separate quantity and unit the way the POS
// receipt does: numeral alone in the Qty column, unit as its own line
// under the product name — never glued ("1Piece", QA regression
// 2026-10-23). The doc's quantity_text still carries the combined
// string, so the renderer must not use it for the quantity cell.

const doc: SalesInvoiceDoc = {
  transaction_id: "tx-1",
  invoice_number: "S-100001",
  sale_date: "2026-10-23",
  payment_type: "cash",
  total_amount: 300,
  discount_amount: 0,
  tax_rate: 0,
  tax_amount: 0,
  credit_due_date: null,
  customer_id: "c1",
  customer_name: "QA Customer",
  shop_name: null,
  customer_city: null,
  customer_area: null,
  customer_phone: null,
  salesman_id: null,
  salesman_name: "",
  org_name: "QA Org",
  org_address: "",
  org_phone: "",
  grand_total: 300,
  discount_total: 0,
  tax_total: 0,
  lines: [
    {
      product_id: "p1",
      product_name: "QA Widget",
      unit_type: "Piece",
      subunit_type: "Box",
      main_unit_label: "Piece",
      subunit_unit_label: "Box",
      unit_mode: "main",
      quantity: 1,
      quantity_text: "1 Piece",
      selling_price: 100,
      discount: 0,
      line_total: 100,
    },
    {
      product_id: "p2",
      product_name: "QA Gadget",
      unit_type: "Piece",
      subunit_type: "Box",
      main_unit_label: "Piece",
      subunit_unit_label: "Box",
      unit_mode: "subunit",
      quantity: 2.5,
      quantity_text: "2.5 Box",
      selling_price: 80,
      discount: 0,
      line_total: 200,
    },
  ],
};

const html = renderToStaticMarkup(<SalesInvoiceDocument doc={doc} template={cloneDefaultTemplate("sales_invoice")} />);

assert.ok(!html.includes("1Piece"), "quantity and unit must never render glued");
assert.ok(!html.includes("1 Piece"), "the combined quantity_text must not appear in the quantity cell");
assert.ok(!html.includes("2.5 Box"), "subunit quantity_text must not appear glued either");
assert.ok(html.includes("QA Widget"), "product name renders");
assert.ok(html.includes(">Piece<"), "unit renders as its own element under the product name");
assert.ok(html.includes(">Box<"), "subunit label renders as its own element");
assert.ok(html.includes(">1<"), "quantity numeral renders on its own");
assert.ok(html.includes(">2.5<"), "fractional quantity numeral renders on its own");

// ---- Sales History → Print Invoice PREVIEW surface ----
// The preview is a separate HTML-string renderer (page.tsx's
// handlePrintSalesInvoice → print-preview dialog), NOT
// SalesInvoiceDocument — the original fix never reached it and the
// preview kept gluing "1Piece" (QA regression 2026-10-23, round 2).
// Its rows come from buildSalesInvoicePreviewRowsHtml and must follow
// the same separation: bare numeral cell, unit as a .unit-line span
// under the product name.
const previewHtml = buildSalesInvoicePreviewRowsHtml(
  [
    { productName: "QA Widget", quantity: 1, unit: "Piece", priceText: "Rs 100", totalText: "Rs 100" },
    { productName: "QA Gadget", quantity: 2.5, unit: "Box", priceText: "Rs 80", totalText: "Rs 200" },
  ],
  ["No line items found", "-", "Rs 0", "Rs 0"],
);
assert.ok(!previewHtml.includes("1Piece"), "preview: quantity and unit must never render glued");
assert.ok(!previewHtml.includes("1 Piece"), "preview: the combined quantity string must not appear");
assert.ok(!previewHtml.includes("2.5 Box"), "preview: subunit quantity must not appear glued either");
assert.ok(previewHtml.includes("<td>1</td>"), "preview: quantity numeral is its own cell");
assert.ok(previewHtml.includes("<td>2.5</td>"), "preview: fractional quantity numeral is its own cell");
assert.ok(
  previewHtml.includes('QA Widget<span class="unit-line">Piece</span>'),
  "preview: unit renders as a small second line under the product name",
);
assert.ok(
  previewHtml.includes('QA Gadget<span class="unit-line">Box</span>'),
  "preview: subunit label renders as a small second line under the product name",
);

const emptyPreviewHtml = buildSalesInvoicePreviewRowsHtml([], ["No line items found", "-", "Rs 0", "Rs 0"]);
assert.ok(emptyPreviewHtml.includes("No line items found"), "preview: empty invoice keeps its fallback row");

console.log("test-sales-invoice-render: all assertions passed");
