// TradeOS — Purchase History → Print Invoice preview rows.
//
// The purchase-invoice print preview is an HTML string built by page.tsx
// (rendered on screen in the print-preview dialog, then sent to the
// printer). Its quantity cell used to be the pre-glued `${quantity}
// ${unit}` string ("1Piece"). These rows apply the same shared semantics
// as the sales-invoice preview (src/lib/sales/sales-invoice-preview.ts):
// the Quantity column is the bare numeral (formatSalesInvoiceQuantity)
// and the unit is a small second line under the product name
// (the .unit-line style in the print-preview stylesheet).

import { escapeHtml } from "@/lib/tradeos/formatters";
import { formatSalesInvoiceQuantity } from "@/lib/sales/sales-invoice-service";

export interface PurchaseInvoicePreviewLine {
  productName: string;
  quantity: number;
  unit: string;
  /** Pre-formatted purchase price text (caller's currency formatter). */
  priceText: string;
  /** Pre-formatted line total text. */
  totalText: string;
  /** Batch number text, or the caller's placeholder. */
  batchText: string;
  /** Pre-formatted expiry date text, or the caller's placeholder. */
  expiryText: string;
}

/**
 * Build the `<tbody>` rows for the purchase-invoice preview table
 * (Product | Quantity | Purchase Price | Line Total | Batch | Expiry).
 * `emptyRowCells` supplies the six fallback cells shown when the invoice
 * has no line items.
 */
export function buildPurchaseInvoicePreviewRowsHtml(
  lines: PurchaseInvoicePreviewLine[],
  emptyRowCells: string[],
): string {
  if (lines.length === 0) {
    return `<tr>${emptyRowCells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
  }
  return lines
    .map((line) => {
      const unitLine = line.unit ? `<span class="unit-line">${escapeHtml(line.unit)}</span>` : "";
      return (
        `<tr><td>${escapeHtml(line.productName)}${unitLine}</td>` +
        `<td>${escapeHtml(formatSalesInvoiceQuantity(line.quantity))}</td>` +
        `<td>${escapeHtml(line.priceText)}</td>` +
        `<td>${escapeHtml(line.totalText)}</td>` +
        `<td>${escapeHtml(line.batchText)}</td>` +
        `<td>${escapeHtml(line.expiryText)}</td></tr>`
      );
    })
    .join("");
}
