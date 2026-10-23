// Purchase-invoice print preview rows: the Quantity column must be the
// bare numeral and the unit a separate line under the product name —
// never the glued "1Piece" string the old row builder produced.
import assert from "node:assert/strict";
import { buildPurchaseInvoicePreviewRowsHtml } from "../src/lib/purchases/purchase-invoice-preview";

const rowsHtml = buildPurchaseInvoicePreviewRowsHtml(
  [
    {
      productName: "Cooking Oil 1L",
      quantity: 1,
      unit: "Piece",
      priceText: "Rs 450",
      totalText: "Rs 450",
      batchText: "B-9",
      expiryText: "31-Dec-2027",
    },
    {
      productName: "Sugar 50kg",
      quantity: 1.5,
      unit: "Bag",
      priceText: "Rs 6,000",
      totalText: "Rs 9,000",
      batchText: "-",
      expiryText: "-",
    },
  ],
  ["No line items", "-", "Rs 0", "Rs 0", "-", "-"],
);

// Bare numerals in the Quantity column.
assert.ok(rowsHtml.includes("<td>1</td>"), "quantity cell is the bare numeral");
assert.ok(rowsHtml.includes("<td>1.5</td>"), "fractional quantities keep up to 3dp, zeros trimmed");
// The unit renders as its own line under the product name.
assert.ok(
  rowsHtml.includes('Cooking Oil 1L<span class="unit-line">Piece</span>'),
  "unit is a .unit-line under the product name",
);
// No glued quantity+unit anywhere.
assert.ok(!rowsHtml.includes("1 Piece"), "no glued '1 Piece' in the quantity cell");
assert.ok(!rowsHtml.includes("1Piece"), "no glued '1Piece' anywhere");
assert.ok(!rowsHtml.includes("1.5 Bag"), "no glued fractional quantity+unit");
// Remaining columns survive intact.
assert.ok(rowsHtml.includes("<td>B-9</td>"), "batch column preserved");
assert.ok(rowsHtml.includes("<td>31-Dec-2027</td>"), "expiry column preserved");

// Escaping is owned by the builder.
const escaped = buildPurchaseInvoicePreviewRowsHtml(
  [{ productName: "Oil <b>1L</b>", quantity: 2, unit: "Piece", priceText: "Rs 1", totalText: "Rs 2", batchText: "-", expiryText: "-" }],
  ["-", "-", "-", "-", "-", "-"],
);
assert.ok(escaped.includes("Oil &lt;b&gt;1L&lt;/b&gt;"), "product names are HTML-escaped");
assert.ok(!escaped.includes("<b>1L</b>"), "raw markup never reaches the preview");

// Empty state: one row with the six caller-supplied fallback cells.
const emptyHtml = buildPurchaseInvoicePreviewRowsHtml([], ["No line items", "-", "Rs 0", "Rs 0", "-", "-"]);
assert.equal((emptyHtml.match(/<td>/g) ?? []).length, 6, "empty state renders six fallback cells");
assert.ok(emptyHtml.includes("No line items"));

console.log("test-purchase-invoice-render: all assertions passed");
