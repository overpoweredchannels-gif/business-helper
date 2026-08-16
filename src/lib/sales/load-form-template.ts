// TradeOS ERP — Load Form print template definition.
//
// A template is pure visual configuration: it describes HOW a Load FormSummary
// is rendered on the printed page. Data (brands, products, quantities, totals)
// lives separately in the summary and is never stored here. The default
// template reproduces the classic distributor load form (white page, black
// text, serif, compact) used as the reference.
//
// Templates are plain serializable objects so they can later be edited via a
// settings UI without touching the aggregation/render logic.

export interface LoadFormTemplate {
  id: string;
  name: string;
  description: string;

  /** Serif family used for the whole document. */
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
    /** Small location + contact line under the title. */
    showOrgAddress: boolean;
    showOrgPhone: boolean;
    contactSizePx: number;
    /** The centered "Load Form" heading. */
    headingText: string;
    headingSizePx: number;
    /** Compact meta line: salesman / customer / date. */
    metaSizePx: number;
    /** Show the Salesman field in the meta line. */
    showSalesman: boolean;
    /** Show the Customer field in the meta line. */
    showCustomer: boolean;
    /** Show the Date field in the meta line. */
    showDate: boolean;
    /** Label used for the date field (e.g. "Date:"). */
    dateLabel: string;
  };

  columns: {
    /** Column headers, left to right, uppercase on print. */
    labels: { key: "product" | "packing" | "cartons" | "pcs" | "bonus"; label: string; widthPct: number }[];
    headerSizePx: number;
    rowSizePx: number;
    /** Uppercase the column headers. */
    uppercaseHeaders: boolean;
  };

  groups: {
    /** Header style for each brand/customer group. */
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
    totalLabel: string;
    bonusLabel: string;
    netLabel: string;
    /** Suffix style used in the reference, e.g. "Total Value :-". */
    valueSuffix: string;
    /** Footnote under the totals block. */
    showFootnote: boolean;
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
}

export const loadFormTemplates: Record<string, LoadFormTemplate> = {
  default: {
    id: "default",
    name: "Default Load Form",
    description:
      "Classic distributor load form: white page, black serif text, brand-grouped products, Value/Bonus/Net footer. Reproduces the reference layout.",
    fontFamily: "'Times New Roman', Times, serif",

    page: {
      background: "#ffffff",
      ink: "#000000",
      rule: "#000000",
    },

    header: {
      showOrgName: true,
      orgNameSizePx: 22,
      showOrgAddress: true,
      showOrgPhone: true,
      contactSizePx: 10,
      headingText: "Load Form",
      headingSizePx: 14,
      metaSizePx: 10,
      showSalesman: true,
      showCustomer: true,
      showDate: true,
      dateLabel: "Date",
    },

    columns: {
      labels: [
        { key: "product", label: "Product Name", widthPct: 46 },
        { key: "packing", label: "Packing", widthPct: 14 },
        { key: "cartons", label: "Cartons", widthPct: 13 },
        { key: "pcs", label: "Pcs", widthPct: 13 },
        { key: "bonus", label: "Bns", widthPct: 14 },
      ],
      headerSizePx: 9,
      rowSizePx: 10,
      uppercaseHeaders: true,
    },

    groups: {
      groupSizePx: 12,
      showPrefix: true,
      showGroupTotal: true,
      groupTotalLabel: "Total",
    },

    salesman: {
      showSalesmanSection: true,
      sizePx: 11,
      label: "Salesman",
      showSalesmanTotal: true,
      salesmanTotalLabel: "Salesman Total",
    },

    footer: {
      showTotals: true,
      labelSizePx: 11,
      valueSizePx: 12,
      totalLabel: "Total Value",
      bonusLabel: "Bonus Value",
      netLabel: "Net Value",
      valueSuffix: " :-",
      showFootnote: true,
      footnoteText: "Generated by TradeOS",
      footnoteSizePx: 8,
    },

    spacing: {
      salesmanGapPx: 12,
      groupGapPx: 8,
      rowPadYPx: 1,
    },
  },
};

export function getLoadFormTemplate(id: string | null | undefined): LoadFormTemplate {
  return loadFormTemplates[id ?? "default"] ?? loadFormTemplates.default;
}