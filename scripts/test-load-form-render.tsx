import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import {
  COLUMN_PALETTE,
  getInvoicePaper,
  getInvoiceSheetWidthMm,
  normalizeInvoicePaper,
} from "../src/lib/print/print-template-types";
import { LoadFormDocument } from "../src/lib/sales/load-form-render";
import type { LoadFormSummary } from "../src/lib/sales/load-form-service";

// Paper model + thermal load-form layout (2026-10-29): A3/A4 sheets and
// thermal rolls are all selectable papers for invoice and load-form
// templates; thermal load forms stack their lines like thermal invoices
// instead of squeezing the table, and old templates stay on A4.

assert.equal(normalizeInvoicePaper("a3"), "a3");
assert.equal(normalizeInvoicePaper("a4"), "a4");
assert.equal(normalizeInvoicePaper(80), 80);
assert.equal(normalizeInvoicePaper(undefined), "a4");
assert.equal(normalizeInvoicePaper("letter"), "a4");

const a3Template = cloneDefaultTemplate("load_form");
a3Template.invoicePaper = "a3";
assert.equal(getInvoicePaper(a3Template), "a3");
assert.equal(getInvoiceSheetWidthMm(a3Template), 297);
const a4Template = cloneDefaultTemplate("load_form");
assert.equal(getInvoicePaper(a4Template), "a4");
assert.equal(getInvoiceSheetWidthMm(a4Template), 210);

const summary: LoadFormSummary = {
  org_name: "QA Org",
  org_address: "Main Bazaar",
  org_phone: "0300-1234567",
  groupBy: "brand",
  groupBySalesman: true,
  salesmen: [
    {
      salesman_id: "s1",
      salesman_name: "Mohammad Aslam",
      customers: [],
      brands: [
        {
          brand_id: "b1",
          brand_name: "QA Brand",
          lines: [
            {
              product_id: "p1",
              product_name: "QA Widget",
              units_per_pack: null,
              unit_type: "Cotton",
              subunit_type: "Boxes",
              main_qty: 2,
              subunit_qty: 3,
              bonus_main_qty: 0,
              bonus_subunit_qty: 1,
              total_value: 300,
              bonus_value: 50,
            },
          ],
          total_value: 300,
          bonus_value: 50,
        },
      ],
      total_value: 300,
      bonus_value: 50,
    },
  ],
  grand_total: 300,
  grand_bonus: 50,
  grand_net: 350,
};

const thermalTemplate = cloneDefaultTemplate("load_form");
thermalTemplate.invoicePaper = 80;
const thermalHtml = renderToStaticMarkup(
  <LoadFormDocument summary={summary} template={thermalTemplate} />,
);
assert.ok(thermalHtml.includes('data-invoice-paper="80mm"'), "thermal load form marks its paper size");
assert.ok(thermalHtml.includes("width:80mm"), "thermal load form renders at the true paper width");
assert.ok(thermalHtml.includes("data-thermal-line"), "thermal load form stacks its lines");
assert.ok(thermalHtml.includes("QA Widget"), "thermal load form keeps the product name");
assert.doesNotMatch(thermalHtml, />PRODUCT NAME</, "thermal load form drops the wide table header");

const sheetHtml = renderToStaticMarkup(
  <LoadFormDocument summary={summary} template={a4Template} />,
);
assert.ok(sheetHtml.includes('data-invoice-paper="a4"'), "a template without invoicePaper stays on A4");
assert.ok(sheetHtml.includes(">PRODUCT NAME<"), "A4 load form keeps the classic table header");

// Field palette (2026-10-29): every key the palette offers must be a key the
// renderer understands, and the new load-form split columns must render the
// main and subunit quantities as separate cells, not the combined label.
assert.deepEqual(
  COLUMN_PALETTE.load_form.map((c) => c.key),
  ["quantity", "bonus", "main_qty", "subunit_qty"],
);
assert.deepEqual(
  COLUMN_PALETTE.retail_receipt.map((c) => c.key),
  ["quantity", "price", "discount", "bonus", "total"],
);
assert.ok(!COLUMN_PALETTE.sales_invoice.some((c) => c.key === "bonus"), "invoices have no bonus line data, so no bonus key");

const splitTemplate = cloneDefaultTemplate("load_form");
splitTemplate.columns.labels = [
  { key: "product", label: "Product Name", widthPct: 40 },
  { key: "main_qty", label: "Main Qty", widthPct: 30 },
  { key: "subunit_qty", label: "Subunit Qty", widthPct: 30 },
];
const splitHtml = renderToStaticMarkup(
  <LoadFormDocument summary={summary} template={splitTemplate} />,
);
assert.ok(splitHtml.includes("2 Cotton"), "split columns render the main quantity");
assert.ok(splitHtml.includes("3 Boxes"), "split columns render the subunit quantity");
assert.ok(!splitHtml.includes("2 Cotton + 3 Boxes"), "split columns never render the combined quantity label");

console.log("test-load-form-render: all assertions passed");
