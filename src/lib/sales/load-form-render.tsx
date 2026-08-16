// TradeOS ERP — Load Form renderer.
//
// Pure presentational component: takes a LoadFormSummary (aggregated data) plus
// a LoadFormTemplate (visual configuration) and renders the printable document.
// No data is fetched here; the caller supplies everything.

import React from "react";
import type { LoadFormSummary, LoadFormCustomerGroup, LoadFormBrandGroup } from "./load-form-service";
import { getLoadFormTemplate } from "./load-form-template";

export interface LoadFormRenderProps {
  summary: LoadFormSummary;
  templateId?: string | null;
  customerLabels?: string;
  salesmanLabels?: string;
  rangeLabel?: string;
}

type Group = LoadFormCustomerGroup | LoadFormBrandGroup;

function groupName(g: Group): string {
  return "brand_name" in g ? g.brand_name : g.customer_name;
}

function groupKey(g: Group): string {
  return "brand_name" in g ? `b-${g.brand_id ?? "none"}` : `c-${g.customer_id ?? "none"}`;
}

function isBrand(g: Group): boolean {
  return "brand_name" in g;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

export function LoadFormDocument({
  summary,
  templateId,
  customerLabels = "",
  salesmanLabels = "",
  rangeLabel = "",
}: LoadFormRenderProps) {
  const t = getLoadFormTemplate(templateId);
  const page = t.page;
  const header = t.header;
  const cols = t.columns;
  const groups = t.groups;
  const salesman = t.salesman;
  const footer = t.footer;

  const rule = `1px solid ${page.rule}`;
  const metaLine = [
    header.showSalesman && {
      label: "Salesman",
      value: salesmanLabels || "(All salesmen)",
    },
    header.showCustomer && {
      label: "Customer",
      value: customerLabels || "(All customers)",
    },
    header.showDate && {
      label: header.dateLabel,
      value: rangeLabel || "—",
    },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div
      className="load-form-doc"
      style={{
        fontFamily: t.fontFamily,
        background: page.background,
        color: page.ink,
        width: "100%",
      }}
    >
      {/* ------------------------------ Header ------------------------------ */}
      <div style={{ textAlign: "center" }}>
        {header.showOrgName && summary.org_name && (
          <div style={{ fontSize: header.orgNameSizePx, fontWeight: 700, lineHeight: 1.15 }}>{summary.org_name}</div>
        )}
        <div style={{ fontSize: header.contactSizePx, lineHeight: 1.3 }}>
          {header.showOrgAddress && summary.org_address && <div>{summary.org_address}</div>}
          {header.showOrgPhone && summary.org_phone && <div>{summary.org_phone}</div>}
        </div>
        <div style={{ fontSize: header.headingSizePx, fontWeight: 700, marginTop: 4 }}>{header.headingText}</div>

        {metaLine.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: header.metaSizePx, marginTop: 6 }}>
            {metaLine.map((m) => (
              <div key={m.label}>
                <span style={{ fontWeight: 700 }}>{m.label}: </span>
                <span>{m.value}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderBottom: rule, marginTop: 6 }} />
      </div>

      {/* ---------------------------- Product body --------------------------- */}
      {summary.salesmen.map((sm) => (
        <div key={sm.salesman_id} style={{ marginTop: t.spacing.salesmanGapPx }}>
          {salesman.showSalesmanSection && (
            <div style={{ fontSize: salesman.sizePx, fontWeight: 700 }}>
              {salesman.label}: {sm.salesman_name}
            </div>
          )}

          {(summary.groupBy === "brand" ? sm.brands : sm.customers).map((grp) => (
            <div key={groupKey(grp)} style={{ marginTop: t.spacing.groupGapPx }}>
              <div style={{ fontSize: groups.groupSizePx, fontWeight: 700 }}>
                {groups.showPrefix ? (isBrand(grp) ? "Brand: " : "Customer: ") : ""}
                {groupName(grp)}
              </div>
              <div style={{ borderBottom: rule, marginTop: 1 }} />

              <div style={{ display: "flex", fontSize: cols.headerSizePx, fontWeight: 700, marginTop: 2 }}>
                {cols.labels.map((c) => (
                  <span
                    key={c.key}
                    style={{
                      width: `${c.widthPct}%`,
                      textAlign: c.key === "product" ? "left" : "right",
                    }}
                  >
                    {cols.uppercaseHeaders ? c.label.toUpperCase() : c.label}
                  </span>
                ))}
              </div>

              {grp.lines.map((line, i) => (
                <div
                  key={`${line.product_id}-${i}`}
                  style={{
                    display: "flex",
                    fontSize: cols.rowSizePx,
                    paddingTop: t.spacing.rowPadYPx,
                    paddingBottom: t.spacing.rowPadYPx,
                    lineHeight: 1.25,
                  }}
                >
                  <span style={{ width: `${cols.labels[0]!.widthPct}%` }}>{line.product_name}</span>
                  <span style={{ width: `${cols.labels[1]!.widthPct}%`, textAlign: "right" }}>{line.packing}</span>
                  <span style={{ width: `${cols.labels[2]!.widthPct}%`, textAlign: "right" }}>{trim(line.cartons)}</span>
                  <span style={{ width: `${cols.labels[3]!.widthPct}%`, textAlign: "right" }}>{trim(line.pcs)}</span>
                  <span style={{ width: `${cols.labels[4]!.widthPct}%`, textAlign: "right" }}>{trim(line.bonus)}</span>
                </div>
              ))}

              {groups.showGroupTotal && (
                <div
                  style={{
                    display: "flex",
                    fontSize: cols.rowSizePx,
                    fontWeight: 700,
                    borderTop: rule,
                    marginTop: 2,
                    paddingTop: 2,
                  }}
                >
                  <span style={{ width: `${cols.labels[0]!.widthPct}%` }}>{groups.groupTotalLabel}</span>
                  <span style={{ width: `${100 - cols.labels[0]!.widthPct}%`, textAlign: "right" }}>
                    {fmt(grp.total_value)}
                  </span>
                </div>
              )}
            </div>
          ))}

          {salesman.showSalesmanTotal && (
            <div style={{ display: "flex", fontSize: salesman.sizePx, fontWeight: 700, marginTop: 4 }}>
              <span style={{ width: `${cols.labels[0]!.widthPct}%` }}>{salesman.salesmanTotalLabel}</span>
              <span style={{ width: `${100 - cols.labels[0]!.widthPct}%`, textAlign: "right" }}>
                {fmt(sm.total_value)}
              </span>
            </div>
          )}
        </div>
      ))}

      {/* ----------------------------- Totals footer ------------------------- */}
      {footer.showTotals && (
        <div style={{ border: `1px solid ${page.rule}`, marginTop: 12, padding: "6px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: footer.labelSizePx, fontWeight: 700 }}>
            <span>
              {footer.totalLabel}
              {footer.valueSuffix}
            </span>
            <span>{fmt(summary.grand_total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: footer.labelSizePx, fontWeight: 700 }}>
            <span>
              {footer.bonusLabel}
              {footer.valueSuffix}
            </span>
            <span>{fmt(summary.grand_bonus)}</span>
          </div>
          <div style={{ borderTop: rule, marginTop: 2, paddingTop: 2 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: footer.valueSizePx,
                fontWeight: 700,
              }}
            >
              <span>
                {footer.netLabel}
                {footer.valueSuffix}
              </span>
              <span>{fmt(summary.grand_net)}</span>
            </div>
          </div>
        </div>
      )}

      {footer.showFootnote && (
        <div style={{ textAlign: "center", fontSize: footer.footnoteSizePx, marginTop: 6 }}>{footer.footnoteText}</div>
      )}
    </div>
  );
}