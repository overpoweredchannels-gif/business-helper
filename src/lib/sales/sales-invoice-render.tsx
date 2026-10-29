// TradeOS ERP — Sales Invoice renderer.
//
// Pure presentational component: takes a SalesInvoiceDoc (data) plus a
// PrintTemplate (visual config) and renders the printable invoice. No data is
// fetched here; the caller supplies everything.

import React from "react";
import { getInvoicePaper, getInvoicePaperWidthMm, type PrintTemplate } from "@/lib/print/print-template-types";
import { formatSalesInvoiceQuantity, type SalesInvoiceDoc, type SalesInvoiceLine } from "./sales-invoice-service";

export interface SalesInvoiceDocumentProps {
  doc: SalesInvoiceDoc;
  template: PrintTemplate;
  rangeLabel?: string;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function columnValue(key: string, line: SalesInvoiceLine): string {
  switch (key) {
    case "product":
      return line.product_name;
    case "quantity":
      // Numeral only — the unit renders as its own line under the product
      // name (same separation as the POS receipt), never glued onto the
      // quantity ("1Piece").
      return formatSalesInvoiceQuantity(line.quantity);
    case "price":
      return trim(line.selling_price);
    case "discount":
      return line.discount > 0 ? trim(line.discount) : "-";
    case "total":
      return fmt(line.line_total);
    default:
      return "";
  }
}

/**
 * Stacked line detail for a thermal invoice: the name rides on its own row
 * (see the thermal branch below) and this is the second row, built only
 * from the columns the template actually shows — quantity × rate, minus
 * discount only when it is non-zero, equals amount. Money tokens use a
 * non-breaking space so a value wraps only between segments, never
 * mid-number.
 */
function thermalLineDetail(line: SalesInvoiceLine, columnKeys: Set<string>): string {
  const nbsp = (value: string) => value.replace(/ /g, " ");
  const parts: string[] = [];
  if (columnKeys.has("quantity")) parts.push(formatSalesInvoiceQuantity(line.quantity));
  if (columnKeys.has("price")) parts.push(nbsp(fmt(line.selling_price)));
  let detail = parts.join(" × ");
  if (columnKeys.has("discount") && line.discount > 0) {
    detail += ` − ${nbsp(trim(line.discount))}`;
  }
  if (columnKeys.has("total")) {
    detail += ` = ${nbsp(fmt(line.line_total))}`;
  }
  return detail;
}

export function SalesInvoiceDocument({ doc, template, rangeLabel = "" }: SalesInvoiceDocumentProps) {
  const t = template;
  const page = t.page;
  const header = t.header;
  const cols = t.columns;
  const footer = t.footer;

  // Thermal paper (40/58/80mm) renders the compact stacked layout at the
  // true paper width; A4 keeps the classic full-width table. Old saved
  // templates have no invoicePaper and stay on A4.
  const thermalWidthMm = getInvoicePaperWidthMm(t);
  const thermal = thermalWidthMm !== null;

  const rule = `1px solid ${page.rule}`;

  const partyLines: { label: string; value: string }[] = [];
  if (header.showSalesman) partyLines.push({ label: "Salesman", value: doc.salesman_name });
  if (header.showCustomer)
    partyLines.push({
      label: "Customer",
      value: doc.shop_name ? `${doc.customer_name} (${doc.shop_name})` : doc.customer_name,
    });
  if (header.showCustomerCity && doc.customer_city)
    partyLines.push({ label: "City", value: doc.customer_city });

  const rightLines: { label: string; value: string }[] = [];
  if (header.showInvoiceNo) rightLines.push({ label: "Invoice", value: doc.invoice_number });
  if (header.showDate)
    rightLines.push({ label: header.dateLabel, value: doc.sale_date ? String(doc.sale_date) : rangeLabel || "—" });

  const rows = Math.max(partyLines.length, rightLines.length);

  return (
    <div
      className="sales-invoice-doc"
      data-invoice-paper={thermal ? `${thermalWidthMm}mm` : getInvoicePaper(t)}
      style={{
        fontFamily: t.fontFamily,
        background: page.background,
        color: page.ink,
        width: thermal ? `${thermalWidthMm}mm` : "100%",
        maxWidth: "100%",
        margin: thermal ? "0 auto" : undefined,
        padding: thermal ? "2mm" : undefined,
        boxSizing: "border-box",
      }}
    >
      {/* ------------------------------ Header ------------------------------ */}
      <div style={{ textAlign: "center" }}>
        {header.orgNamePosition !== "bottom" && header.showOrgName && doc.org_name && (
          <div style={{ fontSize: header.orgNameSizePx, fontWeight: 700, lineHeight: 1.15 }}>
            {doc.org_name}
          </div>
        )}
        <div style={{ fontSize: header.contactSizePx, lineHeight: 1.3 }}>
          {header.showOrgAddress && doc.org_address && <div>{doc.org_address}</div>}
          {header.showOrgPhone && doc.org_phone && <div>{doc.org_phone}</div>}
        </div>
        <div style={{ fontSize: header.headingSizePx, fontWeight: 700, marginTop: 4 }}>{header.headingText}</div>
      </div>

      {/* ------------------------- Meta / party lines ------------------------ */}
      {/* Thermal: one stacked column — two columns would squeeze to
          unreadable widths on a 32–72mm printable strip. */}
      {thermal ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            fontSize: header.metaSizePx,
            marginTop: 8,
            borderBottom: rule,
            paddingBottom: 4,
          }}
        >
          {[...partyLines, ...rightLines].map((line, i) => (
            <div key={i}>
              <span style={{ fontWeight: 700 }}>{line.label}: </span>
              <span>{line.value}</span>
            </div>
          ))}
        </div>
      ) : (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: header.metaSizePx,
          marginTop: 8,
          borderBottom: rule,
          paddingBottom: 4,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {Array.from({ length: rows }).map((_, i) => {
            const line = partyLines[i];
            return (
              <div key={i}>
                {line ? (
                  <>
                    <span style={{ fontWeight: 700 }}>{line.label}: </span>
                    <span>{line.value}</span>
                  </>
                ) : (
                  ""
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right" }}>
          {Array.from({ length: rows }).map((_, i) => {
            const line = rightLines[i];
            return (
              <div key={i}>
                {line ? (
                  <>
                    <span style={{ fontWeight: 700 }}>{line.label}: </span>
                    <span>{line.value}</span>
                  </>
                ) : (
                  ""
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ------------------------------ Table ------------------------------- */}
      {thermal ? (
        doc.lines.length === 0 ? (
          <div style={{ fontSize: cols.rowSizePx, paddingTop: 6, paddingBottom: 6, borderBottom: rule }}>
            <span>No line items found</span>
          </div>
        ) : (
          doc.lines.map((line, i) => (
            <div
              key={`${line.product_id}-${i}`}
              data-thermal-line=""
              style={{
                fontSize: cols.rowSizePx,
                paddingTop: t.spacing.rowPadYPx,
                paddingBottom: t.spacing.rowPadYPx,
                borderBottom: rule,
                lineHeight: 1.25,
                fontWeight: t.boldBody ? 700 : undefined,
              }}
            >
              <span style={{ display: "block" }}>{line.product_name}</span>
              <span style={{ display: "block", fontSize: Math.max(8, cols.rowSizePx - 1), opacity: 0.75 }}>
                {line.unit_mode === "subunit" ? line.subunit_unit_label : line.main_unit_label}
              </span>
              <span style={{ display: "block" }}>
                {thermalLineDetail(line, new Set(cols.labels.map((c) => c.key)))}
              </span>
            </div>
          ))
        )
      ) : (
      <>
      <div style={{ display: "flex", fontSize: cols.headerSizePx, fontWeight: 700, marginTop: 6 }}>
        {cols.labels.map((c) => (
          <span
            key={c.key}
            style={{
              width: `${c.widthPct}%`,
              textAlign: c.key === "product" ? "left" : "right",
              borderBottom: rule,
              paddingBottom: 2,
            }}
          >
            {cols.uppercaseHeaders ? c.label.toUpperCase() : c.label}
          </span>
        ))}
      </div>

      {doc.lines.length === 0 ? (
        <div
          style={{
            display: "flex",
            fontSize: cols.rowSizePx,
            paddingTop: 6,
            paddingBottom: 6,
            borderBottom: rule,
          }}
        >
          <span>No line items found</span>
        </div>
      ) : (
        doc.lines.map((line, i) => (
          <div
            key={`${line.product_id}-${i}`}
            style={{
              display: "flex",
              fontSize: cols.rowSizePx,
              paddingTop: t.spacing.rowPadYPx,
              paddingBottom: t.spacing.rowPadYPx,
              borderBottom: rule,
              lineHeight: 1.25,
              fontWeight: t.boldBody ? 700 : undefined,
            }}
          >
            {cols.labels.map((c) => (
              <span
                key={c.key}
                style={{
                  width: `${c.widthPct}%`,
                  textAlign: c.key === "product" ? "left" : "right",
                  whiteSpace: "pre-wrap",
                }}
              >
                {c.key === "product" ? (
                  <>
                    <span style={{ display: "block" }}>{line.product_name}</span>
                    <span style={{ display: "block", fontSize: Math.max(8, cols.rowSizePx - 1), opacity: 0.75 }}>
                      {line.unit_mode === "subunit" ? line.subunit_unit_label : line.main_unit_label}
                    </span>
                  </>
                ) : (
                  columnValue(c.key, line)
                )}
              </span>
            ))}
          </div>
        ))
      )}
      </>
      )}

      {/* ------------------------------ Totals ------------------------------ */}
      {footer.showTotals && (
        <div style={{ display: "flex", justifyContent: thermal ? "stretch" : "flex-end", marginTop: 8 }}>
          <div style={thermal ? { width: "100%" } : { minWidth: "45%", maxWidth: "55%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: footer.labelSizePx,
                fontWeight: 700,
                paddingTop: 2,
              }}
            >
              <span>
                {footer.totalLabel}
                {footer.valueSuffix}
              </span>
              <span>{fmt(doc.grand_total)}</span>
            </div>
            {doc.discount_total > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: footer.labelSizePx,
                  fontWeight: 700,
                  paddingTop: 2,
                }}
              >
                <span>
                  {footer.bonusLabel}
                  {footer.valueSuffix}
                </span>
                <span>{fmt(doc.discount_total)}</span>
              </div>
            )}
            {doc.tax_total > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: footer.labelSizePx,
                  fontWeight: 700,
                  paddingTop: 2,
                }}
              >
                <span>
                  {footer.netLabel} ({doc.tax_rate}%)
                  {footer.valueSuffix}
                </span>
                <span>{fmt(doc.tax_total)}</span>
              </div>
            )}
            <div style={{ borderTop: rule, marginTop: 2, paddingTop: 2 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: footer.valueSizePx,
                  fontWeight: 700,
                }}
              >
                <span>Net Total{footer.valueSuffix}</span>
                <span>{fmt(doc.grand_total - doc.discount_total + doc.tax_total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------- Business name bottom --------------------- */}
      {header.orgNamePosition === "bottom" && header.showOrgName && doc.org_name && (
        <div
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: header.orgNameSizePx,
            fontWeight: 700,
          }}
        >
          {doc.org_name}
        </div>
      )}

      {/* ------------------------------ Footnote ---------------------------- */}
      {footer.showFootnote && (
        <div style={{ textAlign: "center", fontSize: footer.footnoteSizePx, marginTop: 8 }}>
          {footer.footnoteText}
        </div>
      )}
    </div>
  );
}