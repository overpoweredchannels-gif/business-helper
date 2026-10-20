import { calculateSaleAmounts, calculateSaleLineTotal, roundMoney } from "@/lib/sales/sale-amounts";
import { formatDate, formatPKR } from "@/lib/tradeos/formatters";
import type { PrintTemplate } from "./print-template-types";

export type ReceiptLine = {
  name: string;
  quantity: string;
  unit: string;
  price: string;
  discount: string;
  bonus?: string;
};

export type Receipt = {
  scope: string;
  business: string;
  number: string;
  date: string;
  customer: string;
  lineSubtotal: number;
  lineDiscount: number;
  subtotal: number;
  invoiceDiscount: number;
  tax: number;
  taxRate: number;
  total: number;
  received?: number;
  change?: number;
  payment: string;
  lines: ReceiptLine[];
};

export type ReceiptSummaryRow = { key: string; label: string; amount: number };
export type ReceiptLineRow = ReceiptLine & { amount: number };

/** Display labels for the receipt summary rows. Callers pass strings resolved
 * in the active UI language; the defaults keep the historical English output
 * for any caller that does not supply labels. `tax` is a template containing
 * `{rate}`, e.g. "Tax ({rate}%)". */
export type ReceiptSummaryLabels = {
  itemsSubtotal: string;
  lineDiscounts: string;
  subtotal: string;
  invoiceDiscount: string;
  tax: string;
  total: string;
  tendered: string;
  changeDue: string;
};

export const defaultReceiptSummaryLabels: ReceiptSummaryLabels = {
  itemsSubtotal: "Items subtotal",
  lineDiscounts: "Line discounts",
  subtotal: "Subtotal",
  invoiceDiscount: "Invoice discount",
  tax: "Tax ({rate}%)",
  total: "Total",
  tendered: "Tendered",
  changeDue: "Change due",
};

type AtomicSaleReceiptResult = {
  transaction: Record<string, unknown>;
  customer_name: string;
  items: Array<Record<string, unknown>>;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char] as string);

export function getReceiptLineRows(receipt: Receipt): ReceiptLineRow[] {
  return receipt.lines.map(line => ({
    ...line,
    amount: calculateSaleLineTotal({
      quantity: Number(line.quantity),
      sellingPrice: Number(line.price),
      discount: Number(line.discount || 0),
    }),
  }));
}

export function getReceiptSummaryRows(receipt: Receipt, labels: ReceiptSummaryLabels = defaultReceiptSummaryLabels): ReceiptSummaryRow[] {
  const rows: ReceiptSummaryRow[] = [
    { key: "itemsSubtotal", label: labels.itemsSubtotal, amount: receipt.lineSubtotal },
    { key: "lineDiscounts", label: labels.lineDiscounts, amount: receipt.lineDiscount },
    { key: "subtotal", label: labels.subtotal, amount: receipt.subtotal },
    { key: "invoiceDiscount", label: labels.invoiceDiscount, amount: receipt.invoiceDiscount },
    { key: "tax", label: labels.tax.replace("{rate}", String(receipt.taxRate)), amount: receipt.tax },
    { key: "total", label: labels.total, amount: receipt.total },
  ];
  if (receipt.payment === "cash") {
    rows.push(
      { key: "tendered", label: labels.tendered, amount: receipt.received ?? receipt.total },
      { key: "changeDue", label: labels.changeDue, amount: receipt.change ?? 0 },
    );
  }
  return rows;
}

export function getReceiptWidthMm(template: PrintTemplate): 58 | 80 {
  return template.receiptWidthMm === 58 ? 58 : 80;
}

export function buildAtomicSaleReceipt(
  result: AtomicSaleReceiptResult,
  details: { scope: string; business: string; fallbackDate: string; fallbackPayment: string },
): Receipt {
  const transaction = result.transaction;
  const lines: ReceiptLine[] = result.items.map(item => ({
    name: String(item.product_name ?? "Product"),
    quantity: String(item.quantity ?? "0"),
    unit: String(item.unit_mode === "subunit" ? item.subunit_type ?? "Pcs" : item.unit_type ?? "Units"),
    price: String(item.selling_price ?? "0"),
    discount: String(item.discount ?? "0"),
    bonus: String(item.bonus ?? "0"),
  }));
  const amounts = result.items.map(item => ({
    quantity: Number(item.quantity ?? 0),
    sellingPrice: Number(item.selling_price ?? 0),
    discount: Number(item.discount ?? 0),
  }));
  const calculated = calculateSaleAmounts(amounts);
  return {
    ...details,
    number: String(transaction.invoice_number ?? ""),
    // A sale date is a calendar day, not a UTC instant. Local midnight avoids
    // shifting date-only values to yesterday in browsers west of UTC.
    date: formatDate(String(transaction.sale_date ?? details.fallbackDate).replace(/^(\d{4}-\d{2}-\d{2})$/, "$1T00:00:00")),
    customer: result.customer_name || "Customer",
    lineSubtotal: calculated.lineSubtotal,
    lineDiscount: calculated.lineDiscount,
    subtotal: calculated.subtotal,
    invoiceDiscount: Number(transaction.discount_amount ?? 0),
    tax: Number(transaction.tax_amount ?? 0),
    taxRate: Number(transaction.tax_rate ?? 0),
    total: Number(transaction.total_amount ?? 0),
    received: Number(transaction.cash_received ?? 0),
    change: Number(transaction.change_due ?? 0),
    payment: String(transaction.payment_type ?? details.fallbackPayment),
    lines,
  };
}

export function buildPrintableReceiptHtml(receipt: Receipt, template: PrintTemplate, labels: ReceiptSummaryLabels = defaultReceiptSummaryLabels): string {
  const width = getReceiptWidthMm(template);
  const lineRows = getReceiptLineRows(receipt);
  const summaryRows = getReceiptSummaryRows(receipt, labels);
  const columns = template.columns.labels.map(column =>
    `<th style="width:${column.widthPct}%;font-size:${template.columns.headerSizePx}px">${escapeHtml(column.label)}</th>`,
  ).join("");
  const rows = lineRows.map(line => {
    const values: Record<string, string> = {
      product: line.name,
      quantity: `${line.quantity} ${line.unit}`,
      price: formatPKR(Number(line.price)),
      discount: formatPKR(Number(line.discount || 0)),
      bonus: line.bonus ? `${line.bonus} ${line.unit}` : "",
      total: formatPKR(line.amount),
    };
    return `<tr data-receipt-line="">${template.columns.labels.map(column =>
      `<td style="font-size:${template.columns.rowSizePx}px">${escapeHtml(values[column.key] ?? "")}</td>`,
    ).join("")}</tr>`;
  }).join("");
  const meta = [
    template.header.showInvoiceNo ? receipt.number : "",
    template.header.showDate ? `${template.header.dateLabel}: ${receipt.date}` : "",
    template.header.showCustomer ? receipt.customer : "",
  ].filter(Boolean).map(escapeHtml).join(" · ");
  const summary = summaryRows.map(row =>
    `<div class="summary-row${row.key === "total" ? " grand-total" : ""}"><span>${escapeHtml(row.label)}</span><strong>${formatPKR(roundMoney(row.amount))}</strong></div>`,
  ).join("");
  const orgName = template.header.showOrgName
    ? `<h1>${escapeHtml(receipt.business)}</h1>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(`${receipt.business} - ${receipt.number}`)}</title><style>
    @page{size:${width}mm auto;margin:0}
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;padding:0;width:${width}mm;max-width:${width}mm}
    body{padding:2mm;font-family:${template.fontFamily};font-size:${template.columns.rowSizePx}px;color:${template.page.ink};background:${template.page.background};overflow-wrap:anywhere;word-break:normal}
    h1{font-size:${template.header.orgNameSizePx}px;margin:0 0 2mm;overflow-wrap:anywhere}
    h2{font-size:${template.header.headingSizePx}px;margin:1mm 0;overflow-wrap:anywhere}
    p{font-size:${template.header.metaSizePx}px;margin:1mm 0;overflow-wrap:anywhere}
    table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:2mm}
    th,td{border-top:1px solid ${template.page.rule};padding:1mm 0.5mm;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:normal}
    .summary{border-top:1px solid ${template.page.rule};margin-top:2mm;padding-top:1mm;font-size:${template.footer.labelSizePx}px}
    .summary-row{display:flex;justify-content:space-between;gap:1mm;margin:0.5mm 0}
    .summary-row span{overflow-wrap:anywhere}.summary-row strong{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .grand-total{border-top:1px solid ${template.page.rule};padding-top:1mm;font-size:${template.footer.valueSizePx}px}
    .footer{border-top:1px solid ${template.page.rule};margin-top:2mm;padding-top:1mm;font-size:${template.footer.footnoteSizePx}px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body data-receipt-paper-width="${width}mm">${template.header.showOrgName && template.header.orgNamePosition === "top" ? orgName : ""}<h2>${escapeHtml(template.header.headingText)}</h2><p>${meta}</p><table><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table><div class="summary">${summary}</div>${template.footer.showFootnote ? `<p class="footer">${escapeHtml(template.footer.footnoteText)}</p>` : ""}${template.header.showOrgName && template.header.orgNamePosition === "bottom" ? orgName : ""}</body></html>`;
}
