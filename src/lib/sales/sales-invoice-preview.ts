// TradeOS — Sales History → Print Invoice preview rows.
//
// The Sales History print preview is an HTML string built by page.tsx
// (rendered on screen in the print-preview dialog, then sent to the
// printer) — it does NOT go through SalesInvoiceDocument. Its quantity
// cell used to be the pre-glued `${quantity} ${unit}` string ("1Piece"),
// which is why the 0fc905e fix to the A4 renderer never reached it.
// These rows apply the same shared semantics as the print renderer:
// the Quantity column is the bare numeral (formatSalesInvoiceQuantity)
// and the unit is a small second line under the product name
// (the .unit-line style in the print-preview stylesheet).

import { escapeHtml } from "@/lib/tradeos/formatters";
import { formatSalesInvoiceQuantity } from "./sales-invoice-service";

export interface SalesInvoicePreviewLine {
  productName: string;
  quantity: number;
  unit: string;
  /** Pre-formatted selling price text (caller's currency formatter). */
  priceText: string;
  /** Pre-formatted line total text, including any discount note. */
  totalText: string;
}

/**
 * Build the `<tbody>` rows for the sales-invoice preview table
 * (Product | Quantity | Price | Total). `emptyRowCells` supplies the
 * four fallback cells shown when the invoice has no line items.
 */
export function buildSalesInvoicePreviewRowsHtml(
  lines: SalesInvoicePreviewLine[],
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
        `<td>${escapeHtml(line.totalText)}</td></tr>`
      );
    })
    .join("");
}
