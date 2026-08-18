// TradeOS ERP — Sales Invoice renderer.
//
// Pure presentational component: takes a SalesInvoiceDoc (data) plus a
// PrintTemplate (visual config) and renders the printable invoice. No data is
// fetched here; the caller supplies everything.

import React from "react";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import type { SalesInvoiceDoc, SalesInvoiceLine } from "./sales-invoice-service";

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
      return line.quantity_text;
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

export function SalesInvoiceDocument({ doc, template, rangeLabel = "" }: SalesInvoiceDocumentProps) {
  const t = template;
  const page = t.page;
  const header = t.header;
  const cols = t.columns;
  const footer = t.footer;

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
      style={{
        fontFamily: t.fontFamily,
        background: page.background,
        color: page.ink,
        width: "100%",
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

      {/* ------------------------------ Table ------------------------------- */}
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
                {columnValue(c.key, line)}
              </span>
            ))}
          </div>
        ))
      )}

      {/* ------------------------------ Totals ------------------------------ */}
      {footer.showTotals && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <div style={{ minWidth: "45%", maxWidth: "55%" }}>
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