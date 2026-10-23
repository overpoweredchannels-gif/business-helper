import { calculateSaleAmounts, calculateSaleLineTotal, roundMoney } from "@/lib/sales/sale-amounts";
import { formatDate, formatPKR } from "@/lib/tradeos/formatters";
import { DEFAULT_PRINT_TEMPLATES } from "./default-templates";
import type { PrintColumn, PrintTemplate } from "./print-template-types";

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

/** Normalize any stored paper-width value. A stored 58 stays 58 (number or
 * string form); 80 stays 80; anything missing/unknown falls back to the
 * historical 80mm default. */
export function normalizeReceiptWidthMm(value: unknown): 58 | 80 {
  return value === 58 || value === "58" ? 58 : 80;
}

export function getReceiptWidthMm(template: PrintTemplate): 58 | 80 {
  return normalizeReceiptWidthMm(template.receiptWidthMm);
}

/** Printable width per paper size. Thermal printers cannot print to the
 * paper edge: a 58mm roll exposes ~48mm and an 80mm roll ~72mm. Layouts must
 * be sized to the printable width, never the nominal paper width, or the
 * rightmost (totals) column is clipped mid-digit by the printer. */
export const RECEIPT_PRINTABLE_WIDTH_MM: Record<58 | 80, number> = { 58: 48, 80: 72 };

export function getReceiptPrintableWidthMm(template: PrintTemplate): number {
  return RECEIPT_PRINTABLE_WIDTH_MM[getReceiptWidthMm(template)];
}

/** The customer name seeded by POST /api/sales/walk-in. Receipts translate
 * it at print time only when the stored name is exactly this seeded default;
 * a renamed walk-in customer (or any real customer) prints as stored. */
export const SEEDED_WALK_IN_CUSTOMER_NAME = "Walk-in customer";

/** Localizable receipt "chrome": the template texts that ship as English
 * defaults (heading, date label, footnote, column labels) plus the seeded
 * walk-in customer name. Callers pass strings resolved in the active UI
 * language; template text the user customized is never overridden. */
export type ReceiptChromeLabels = {
  heading: string;
  dateLabel: string;
  footnote: string;
  walkInCustomer: string;
  columns: Partial<Record<string, string>>;
};

export const defaultReceiptChromeLabels: ReceiptChromeLabels = {
  heading: "Sales Receipt",
  dateLabel: "Date",
  footnote: "Thank you for your business.",
  walkInCustomer: SEEDED_WALK_IN_CUSTOMER_NAME,
  columns: { product: "Item", quantity: "Qty", price: "Rate", total: "Amount" },
};

export type ResolvedReceiptChrome = {
  headingText: string;
  dateLabel: string;
  footnoteText: string;
  columns: PrintColumn[];
};

/** Resolve the template chrome for one render: any field still equal to the
 * shipped English default is replaced by the active-language label; any
 * field the user customized is kept verbatim. */
export function resolveReceiptChrome(template: PrintTemplate, chrome: ReceiptChromeLabels = defaultReceiptChromeLabels): ResolvedReceiptChrome {
  const shipped = DEFAULT_PRINT_TEMPLATES.retail_receipt;
  return {
    headingText: template.header.headingText === shipped.header.headingText ? chrome.heading : template.header.headingText,
    dateLabel: template.header.dateLabel === shipped.header.dateLabel ? chrome.dateLabel : template.header.dateLabel,
    footnoteText: template.footer.footnoteText === shipped.footer.footnoteText ? chrome.footnote : template.footer.footnoteText,
    columns: template.columns.labels.map(column => {
      const shippedColumn = shipped.columns.labels.find(candidate => candidate.key === column.key);
      const localized = chrome.columns[column.key];
      return shippedColumn && localized && column.label === shippedColumn.label ? { ...column, label: localized } : column;
    }),
  };
}

/** The customer name to print: the seeded walk-in default is localized; any
 * other stored name prints exactly as stored. */
export function resolveReceiptCustomerName(customer: string, chrome: ReceiptChromeLabels = defaultReceiptChromeLabels): string {
  return customer === SEEDED_WALK_IN_CUSTOMER_NAME ? chrome.walkInCustomer : customer;
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

/** Column keys whose values are figures: they must never wrap or slice
 * mid-number, so their cells are marked `num` (white-space:nowrap). */
const NUMERIC_COLUMN_KEYS = new Set(["quantity", "price", "discount", "total"]);

export function buildPrintableReceiptHtml(receipt: Receipt, template: PrintTemplate, labels: ReceiptSummaryLabels = defaultReceiptSummaryLabels, chrome: ReceiptChromeLabels = defaultReceiptChromeLabels): string {
  const width = getReceiptWidthMm(template);
  const contentWidth = getReceiptPrintableWidthMm(template);
  const resolved = resolveReceiptChrome(template, chrome);
  // The 58mm profile is tight: shave the items-table type one step so the
  // columns keep air at printable width.
  const rowSizePx = width === 58 ? Math.max(8, Math.round(template.columns.rowSizePx * 0.9)) : template.columns.rowSizePx;
  const headerSizePx = width === 58 ? Math.max(8, Math.round(template.columns.headerSizePx * 0.9)) : template.columns.headerSizePx;
  const lineRows = getReceiptLineRows(receipt);
  const summaryRows = getReceiptSummaryRows(receipt, labels);
  const columns = resolved.columns.map(column =>
    `<th${NUMERIC_COLUMN_KEYS.has(column.key) ? ` class="num"` : ""} style="width:${column.widthPct}%;font-size:${headerSizePx}px">${escapeHtml(column.label)}</th>`,
  ).join("");
  const rows = lineRows.map(line => {
    const values: Record<string, string> = {
      quantity: line.quantity,
      price: formatPKR(Number(line.price)),
      discount: formatPKR(Number(line.discount || 0)),
      bonus: line.bonus ? `${line.bonus} ${line.unit}` : "",
      total: formatPKR(line.amount),
    };
    return `<tr data-receipt-line="">${resolved.columns.map(column => {
      // The Qty cell carries the numeral only; the unit rides as a small
      // second line under the product name, so a long unit word can never
      // wrap mid-word beneath the numeral in the narrow Qty column.
      const content = column.key === "product"
        ? `${escapeHtml(line.name)}${line.unit ? `<span class="line-unit">${escapeHtml(line.unit)}</span>` : ""}`
        : escapeHtml(values[column.key] ?? "");
      return `<td${NUMERIC_COLUMN_KEYS.has(column.key) ? ` class="num"` : ""} style="font-size:${rowSizePx}px">${content}</td>`;
    }).join("")}</tr>`;
  }).join("");
  const meta = [
    template.header.showInvoiceNo ? receipt.number : "",
    template.header.showDate ? `${resolved.dateLabel}: ${receipt.date}` : "",
    template.header.showCustomer ? resolveReceiptCustomerName(receipt.customer, chrome) : "",
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
    html{margin:0;padding:0;width:${width}mm;max-width:${width}mm}
    body{width:${contentWidth}mm;max-width:${contentWidth}mm;margin:0 auto;padding:2mm;font-family:${template.fontFamily};font-size:${rowSizePx}px;color:${template.page.ink};background:${template.page.background};overflow-wrap:anywhere;word-break:normal}
    h1{font-size:${template.header.orgNameSizePx}px;margin:0 0 2mm;overflow-wrap:anywhere}
    h2{font-size:${template.header.headingSizePx}px;margin:1mm 0;overflow-wrap:anywhere}
    p{font-size:${template.header.metaSizePx}px;margin:1mm 0;overflow-wrap:anywhere}
    table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:2mm}
    th,td{border-top:1px solid ${template.page.rule};padding:1mm 0.5mm;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:normal}
    th.num,td.num{white-space:nowrap;overflow-wrap:normal}
    .line-unit{display:block;font-size:${Math.max(8, rowSizePx - 1)}px;opacity:0.75}
    .summary{border-top:1px solid ${template.page.rule};margin-top:2mm;padding-top:1mm;font-size:${template.footer.labelSizePx}px}
    .summary-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1mm;margin:0.5mm 0}
    .summary-row span{overflow-wrap:anywhere}.summary-row strong{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:normal}
    .grand-total{border-top:1px solid ${template.page.rule};padding-top:1mm;font-size:${template.footer.valueSizePx}px}
    .footer{border-top:1px solid ${template.page.rule};margin-top:2mm;padding-top:1mm;font-size:${template.footer.footnoteSizePx}px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body data-receipt-paper-width="${width}mm" data-receipt-content-width="${contentWidth}mm">${template.header.showOrgName && template.header.orgNamePosition === "top" ? orgName : ""}<h2>${escapeHtml(resolved.headingText)}</h2><p>${meta}</p><table><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table><div class="summary">${summary}</div>${template.footer.showFootnote ? `<p class="footer">${escapeHtml(resolved.footnoteText)}</p>` : ""}${template.header.showOrgName && template.header.orgNamePosition === "bottom" ? orgName : ""}</body></html>`;
}
