/**
 * Business Records Export delivery (P1 Area B).
 *
 * Defect 2 of the slice: the export flow failed CLOSED when the browser
 * blocked the popup — `window.open` returned null, the component showed
 * "Allow popups" and the user got NO report at all.
 *
 * Fix: the delivery path is decided here, with the browser collaborators
 * injected so the flow is unit-testable without a DOM. The popup stays the
 * primary path (it is the working flow when popups are allowed); when
 * `openPopup` returns null the SAME fetched data and the SAME HTML built
 * by `businessReportHtml` are delivered as a file download instead, so a
 * blocked popup never loses the report. The fetch runs in both paths; a
 * failed fetch closes the popup (when one was opened) and reports an
 * error — no dangling blank popup is ever left open.
 *
 * The dashboard widget itself (page.tsx) previously hid this whole UI
 * behind a collapsed <details> element (defect 1); it now renders the
 * component directly.
 */

import { formatDateTime } from "@/lib/tradeos/formatters";
import { activityDay, inDashboardRange, type DashboardRange } from "./period";

type ActivityInvoice = {
  organization_id?: string;
  created_at: string;
  invoice_number: string;
  total_amount?: number | null;
};

export function buildDashboardActivityCsvRows({ sales, purchases, customerNames, supplierNames, org, timeZone, range, currency }: {
  sales: readonly (ActivityInvoice & { customer_id: string })[];
  purchases: readonly (ActivityInvoice & { supplier_id: string })[];
  customerNames: ReadonlyMap<string, string>;
  supplierNames: ReadonlyMap<string, string>;
  org: string;
  timeZone: string | null;
  range: DashboardRange;
  currency: string;
}) {
  const entries = [
    ...sales.map(tx => ({ tx, type: "sale", party: customerNames.get(tx.customer_id) ?? "" })),
    ...purchases.map(tx => ({ tx, type: "purchase", party: supplierNames.get(tx.supplier_id) ?? "" })),
  ].filter(({ tx }) => (!tx.organization_id || tx.organization_id === org)
    && inDashboardRange(activityDay(tx.created_at, timeZone), range))
    .sort((a, b) => Date.parse(b.tx.created_at) - Date.parse(a.tx.created_at))
    .slice(0, 10_000);
  return entries.map(({ tx, type, party }) => [
    formatDateTime(tx.created_at), type, tx.invoice_number, party, tx.total_amount ?? "", currency,
  ]);
}

export interface RecordsExportPopup {
  document: {
    open(): void;
    write(html: string): void;
    close(): void;
    // Nullable like the DOM Document.body, so `Window` is assignable here.
    body: { textContent: string | null } | null;
  };
  opener: unknown;
  close(): void;
}

export interface RecordsExportDeps {
  /** Opens the report popup; returns null when the browser blocks it. */
  openPopup: () => RecordsExportPopup | null;
  /** Fetches the report payload; `ok` is false when the request or the payload failed. */
  fetchReport: (from: string, to: string) => Promise<{
    ok: boolean;
    sections?: unknown;
    error?: string;
  }>;
  /** Builds the printable report HTML from the fetched sections. */
  buildHtml: (from: string, to: string, sections: unknown) => string;
  /** Delivers the report HTML as a file download. */
  downloadHtml: (filename: string, html: string) => void;
}

export type RecordsExportResult =
  | { delivered: "popup" }
  | { delivered: "download"; filename: string }
  | { delivered: "error"; message: string };

export function recordsExportFilename(from: string, to: string): string {
  return `business-records-${from}_to_${to}.html`;
}

export function downloadBusinessRecordsFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportBusinessActivityCsv(from: string, to: string, rows: readonly (readonly (string | number)[])[]) {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const columns = ["date-time", "type", "reference", "party", "amount", "currency"];
  const csv = [columns, ...rows.slice(0, 10_000)].map(row => row.map(cell).join(",")).join("\r\n");
  downloadBusinessRecordsFile(`business-activity-${from}_to_${to}.csv`, "\uFEFF" + csv, "text/csv;charset=utf-8");
}

export async function runBusinessRecordsExport(
  from: string,
  to: string,
  deps: RecordsExportDeps,
  labels: { preparingReport: string; reportFailed: string },
): Promise<RecordsExportResult> {
  const popup = deps.openPopup();
  if (popup) {
    popup.opener = null;
    if (popup.document.body) popup.document.body.textContent = labels.preparingReport;
  }
  let report: { ok: boolean; sections?: unknown; error?: string };
  try {
    report = await deps.fetchReport(from, to);
    if (!report.ok || report.sections === undefined) {
      throw new Error(report.error ?? labels.reportFailed);
    }
  } catch (err) {
    if (popup) popup.close();
    return {
      delivered: "error",
      message: err instanceof Error ? err.message : labels.reportFailed,
    };
  }
  const html = deps.buildHtml(from, to, report.sections);
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    return { delivered: "popup" };
  }
  const filename = recordsExportFilename(from, to);
  deps.downloadHtml(filename, html);
  return { delivered: "download", filename };
}
