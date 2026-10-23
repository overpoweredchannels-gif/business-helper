// Order/return print preview rows (purchase order, purchase return,
// sales order, sales return): the Quantity column must be the bare
// numeral and the unit a separate line under the product name — never
// the glued "1Piece" string the old string[][] row builders produced.
// All four tables share the sales-invoice shape (Product | Quantity |
// Price | Total); each document has its own builder entry point.
import assert from "node:assert/strict";
import { buildPurchaseOrderPreviewRowsHtml } from "../src/lib/purchases/purchase-order-preview";
import { buildPurchaseReturnPreviewRowsHtml } from "../src/lib/purchases/purchase-return-preview";
import { buildSalesOrderPreviewRowsHtml } from "../src/lib/sales/sales-order-preview";
import { buildSalesReturnPreviewRowsHtml } from "../src/lib/sales/sales-return-preview";

type RowsBuilder = (
  lines: { productName: string; quantity: number; unit: string; priceText: string; totalText: string }[],
  emptyRowCells: string[],
) => string;

const builders: { name: string; build: RowsBuilder }[] = [
  { name: "purchase order", build: buildPurchaseOrderPreviewRowsHtml },
  { name: "purchase return", build: buildPurchaseReturnPreviewRowsHtml },
  { name: "sales order", build: buildSalesOrderPreviewRowsHtml },
  { name: "sales return", build: buildSalesReturnPreviewRowsHtml },
];

for (const { name, build } of builders) {
  const rowsHtml = build(
    [
      { productName: "Cooking Oil 1L", quantity: 1, unit: "Piece", priceText: "Rs 450", totalText: "Rs 450" },
      { productName: "Sugar 50kg", quantity: 2.5, unit: "Bag", priceText: "Rs 6,000", totalText: "Rs 15,000" },
    ],
    ["No line items", "-", "-", "-"],
  );

  // Bare numerals in the Quantity column.
  assert.ok(rowsHtml.includes("<td>1</td>"), `${name}: quantity cell is the bare numeral`);
  assert.ok(rowsHtml.includes("<td>2.5</td>"), `${name}: fractional quantities keep up to 3dp, zeros trimmed`);
  // The unit renders as its own line under the product name.
  assert.ok(
    rowsHtml.includes('Cooking Oil 1L<span class="unit-line">Piece</span>'),
    `${name}: unit is a .unit-line under the product name`,
  );
  assert.ok(
    rowsHtml.includes('Sugar 50kg<span class="unit-line">Bag</span>'),
    `${name}: second line's unit is a .unit-line under the product name`,
  );
  // No glued quantity+unit anywhere.
  assert.ok(!rowsHtml.includes("1 Piece"), `${name}: no glued '1 Piece' in the quantity cell`);
  assert.ok(!rowsHtml.includes("1Piece"), `${name}: no glued '1Piece' anywhere`);
  assert.ok(!rowsHtml.includes("2.5 Bag"), `${name}: no glued fractional quantity+unit`);
  // Remaining columns survive intact: four cells per row, price and total present.
  assert.equal((rowsHtml.match(/<tr>/g) ?? []).length, 2, `${name}: one row per line`);
  assert.equal((rowsHtml.match(/<td>/g) ?? []).length, 8, `${name}: four columns per row`);
  assert.ok(rowsHtml.includes("<td>Rs 450</td>"), `${name}: price column preserved`);
  assert.ok(rowsHtml.includes("<td>Rs 15,000</td>"), `${name}: line total column preserved`);

  // Escaping is owned by the builder.
  const escaped = build(
    [{ productName: "Oil <b>1L</b>", quantity: 2, unit: "Piece", priceText: "Rs 1", totalText: "Rs 2" }],
    ["-", "-", "-", "-"],
  );
  assert.ok(escaped.includes("Oil &lt;b&gt;1L&lt;/b&gt;"), `${name}: product names are HTML-escaped`);
  assert.ok(!escaped.includes("<b>1L</b>"), `${name}: raw markup never reaches the preview`);

  // Empty state: one row with the four caller-supplied fallback cells.
  const emptyHtml = build([], ["No line items", "-", "-", "-"]);
  assert.equal((emptyHtml.match(/<td>/g) ?? []).length, 4, `${name}: empty state renders four fallback cells`);
  assert.ok(emptyHtml.includes("No line items"), `${name}: empty state keeps its fallback text`);
}

console.log("test-order-return-previews: all assertions passed");
