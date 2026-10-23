// TradeOS — Purchase Orders → Print preview rows.
//
// The purchase-order print preview is an HTML string built by page.tsx
// (rendered on screen in the print-preview dialog, then sent to the
// printer). Its quantity cell used to be the pre-glued `${quantity}
// ${unit}` string ("1Piece"). The table shape is identical to the
// sales-invoice preview (Product | Quantity | Price | Total), so the
// rows delegate to buildSalesInvoicePreviewRowsHtml, which renders
// the bare numeral (formatSalesInvoiceQuantity) in the Quantity
// column and the unit as a small second line under the product name
// (the .unit-line style in the print-preview stylesheet).

import { buildSalesInvoicePreviewRowsHtml } from "@/lib/sales/sales-invoice-preview";

export interface PurchaseOrderPreviewLine {
  productName: string;
  quantity: number;
  unit: string;
  /** Pre-formatted unit price text (caller's currency formatter). */
  priceText: string;
  /** Pre-formatted line total text. */
  totalText: string;
}

/**
 * Build the `<tbody>` rows for the purchase-order preview table
 * (Product | Quantity | Price | Total). `emptyRowCells` supplies the
 * four fallback cells shown when the order has no line items.
 */
export function buildPurchaseOrderPreviewRowsHtml(
  lines: PurchaseOrderPreviewLine[],
  emptyRowCells: string[],
): string {
  return buildSalesInvoicePreviewRowsHtml(lines, emptyRowCells);
}
