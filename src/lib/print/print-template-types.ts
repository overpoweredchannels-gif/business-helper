// TradeOS ERP — Shared print template system.
//
// A print template is a serializable description of HOW a printable document
// (sales invoice or load form) is laid out: font family, per-zone font sizes,
// bold toggles, which header/footer fields to show, and the table column set.
// It contains NO document data — the renderer combines a template with a
// document's data at render time.
//
// Both the Sales Invoice and the Load Form use this same type so a single
// customizer UI can edit either document. Templates are persisted per
// organization (print_templates table, config jsonb).

export type PrintDocumentType = "sales_invoice" | "load_form" | "retail_receipt";

/** A single table column definition. */
export interface PrintColumn {
  /** Stable key understood by the renderer for this doc type. */
  key: string;
  /** Header label shown on the printed sheet. */
  label: string;
  /** Fractional width (0-100), all columns should sum to ~100. */
  widthPct: number;
}

export interface PrintTemplate {
  id: string;
  name: string;
  description?: string;
  docType: PrintDocumentType;

  /** Thermal receipt paper width. Ignored for non-receipt documents. */
  receiptWidthMm?: 40 | 58 | 80;

  /**
   * Document paper for invoice and load-form templates: "a3" / "a4"
   * sheets for big printers, or a thermal roll width. Ignored for
   * receipts (they use receiptWidthMm) and other documents. Old saved
   * templates have no value and render as "a4".
   */
  invoicePaper?: "a3" | "a4" | 40 | 58 | 80;

  /** Serif/sans family applied to the whole document. */
  fontFamily: string;

  page: {
    /** Background behind the printed sheet (white for print). */
    background: string;
    /** Ink color for body text (black for print). */
    ink: string;
    /** Color for rules / borders (black for print). */
    rule: string;
  };

  header: {
    /** Show the organization name as a large bold title. */
    showOrgName: boolean;
    orgNameSizePx: number;
    /** Show the business name at the BOTTOM instead of the top. */
    orgNamePosition: "top" | "bottom";
    /** Small location + contact line under the title. */
    showOrgAddress: boolean;
    showOrgPhone: boolean;
    contactSizePx: number;
    /** The centered heading, e.g. "Sales Invoice" / "Load Form". */
    headingText: string;
    headingSizePx: number;
    /** Compact meta line (salesman / customer / city / date / invoice no). */
    metaSizePx: number;
    /** Show the Salesman field in the meta line. */
    showSalesman: boolean;
    /** Show the Customer field in the meta line. */
    showCustomer: boolean;
    /** Show the customer city in the meta line. */
    showCustomerCity: boolean;
    /** Show the Date field in the meta line. */
    showDate: boolean;
    /** Show the invoice number field in the meta line. */
    showInvoiceNo: boolean;
    /** Label used for the date field (e.g. "Date"). */
    dateLabel: string;
    /** Order of header sections for drag-and-drop reordering. */
    headerOrder?: string[];
  };

  columns: {
    /** Column headers, left to right. Keys are renderer-specific. */
    labels: PrintColumn[];
    headerSizePx: number;
    rowSizePx: number;
    /** Uppercase the column headers. */
    uppercaseHeaders: boolean;
  };

  groups: {
    /** Header style for each brand/customer/group section. */
    groupSizePx: number;
    /** Show a "Brand:" / "Customer:" prefix on the group header. */
    showPrefix: boolean;
    /** Show the group subtotal line (Total Value) after each group. */
    showGroupTotal: boolean;
    /** Label for the group subtotal row, e.g. "Total". */
    groupTotalLabel: string;
  };

  salesman: {
    /** Show a "Salesman: Name" section title. */
    showSalesmanSection: boolean;
    sizePx: number;
    label: string;
    /** Show a salesman subtotal at the end of each salesman section. */
    showSalesmanTotal: boolean;
    salesmanTotalLabel: string;
  };

  footer: {
    /** Show the bordered totals block. */
    showTotals: boolean;
    labelSizePx: number;
    valueSizePx: number;
    /** Primary total label (e.g. "Total Value" / "Grand Total"). */
    totalLabel: string;
    /** Secondary total label (e.g. "Bonus Value" / "Discount"). */
    bonusLabel: string;
    /** Tertiary total label (e.g. "Net Value" / "Tax"). */
    netLabel: string;
    /** Suffix style used by the reference template, e.g. " :-". */
    valueSuffix: string;
    /** Show a footnote / disclaimer under the totals block. */
    showFootnote: boolean;
    /** Free-text disclaimer or closing note. */
    footnoteText: string;
    footnoteSizePx: number;
  };

  spacing: {
    /** Space between salesman sections. */
    salesmanGapPx: number;
    /** Space between brand/customer groups. */
    groupGapPx: number;
    /** Vertical padding inside each product row. */
    rowPadYPx: number;
  };

  /** Common font weight: true = bold body text (default off). */
  boldBody?: boolean;
}

export interface PrintTemplateRow {
  id: string;
  organization_id: string;
  doc_type: PrintDocumentType;
  name: string;
  description: string | null;
  config: PrintTemplate;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Print-safe fonts that render identically in the browser and on paper. */
export const PRINT_FONTS: { id: string; name: string; family: string }[] = [
  { id: "times", name: "Times New Roman", family: "'Times New Roman', Times, serif" },
  { id: "arial", name: "Arial", family: "Arial, Helvetica, sans-serif" },
  { id: "helvetica", name: "Helvetica", family: "Helvetica, Arial, sans-serif" },
  { id: "calibri", name: "Calibri", family: "Calibri, 'Segoe UI', sans-serif" },
  { id: "georgia", name: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { id: "garamond", name: "Garamond", family: "Garamond, 'EB Garamond', Georgia, serif" },
  { id: "courier", name: "Courier New", family: "'Courier New', Courier, monospace" },
  { id: "verdana", name: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", name: "Tahoma", family: "Tahoma, Verdana, sans-serif" },
  { id: "trebuchet", name: "Trebuchet MS", family: "'Trebuchet MS', 'Segoe UI', sans-serif" },
];

/** Thermal paper widths and what a printer can actually print on each.
 * Printers cannot print to the paper edge, so layouts must be sized to the
 * printable width, never the nominal paper width, or the rightmost column
 * is clipped mid-digit. A 40mm roll exposes ~32mm by the same margin rule
 * as 58mm (~48mm) and 80mm (~72mm). */
export const THERMAL_PRINTABLE_WIDTH_MM: Record<40 | 58 | 80, number> = { 40: 32, 58: 48, 80: 72 };

export type InvoicePaper = "a3" | "a4" | 40 | 58 | 80;

/** Normalize any stored invoice-paper value. "a3"/"a4" stay themselves; a
 * thermal width stays itself (number or string form); anything
 * missing/unknown falls back to the historical "a4" default, so old saved
 * templates keep rendering exactly as before. */
export function normalizeInvoicePaper(value: unknown): InvoicePaper {
  if (value === "a3") return "a3";
  if (value === "a4") return "a4";
  if (value === 40 || value === "40") return 40;
  if (value === 58 || value === "58") return 58;
  if (value === 80 || value === "80") return 80;
  return "a4";
}

export function getInvoicePaper(template: PrintTemplate): InvoicePaper {
  return normalizeInvoicePaper(template.invoicePaper);
}

/** Thermal roll width for an invoice/load-form template, or null for a
 * sheet layout (A3/A4). */
export function getInvoicePaperWidthMm(template: PrintTemplate): 40 | 58 | 80 | null {
  const paper = getInvoicePaper(template);
  return paper === "a3" || paper === "a4" ? null : paper;
}

/** Sheet width for an invoice/load-form template (A3 297mm, A4 210mm),
 * or null for a thermal roll layout. */
export function getInvoiceSheetWidthMm(template: PrintTemplate): 210 | 297 | null {
  const paper = getInvoicePaper(template);
  return paper === "a3" ? 297 : paper === "a4" ? 210 : null;
}

/** Printable width for an invoice template, or null for the A4 layout. */
export function getInvoicePrintableWidthMm(template: PrintTemplate): number | null {
  const width = getInvoicePaperWidthMm(template);
  return width === null ? null : THERMAL_PRINTABLE_WIDTH_MM[width];
}

export function fontFamilyById(id: string | null | undefined): string {
  const font = PRINT_FONTS.find((f) => f.id === id);
  return font?.family ?? PRINT_FONTS[0]!.family;
}
