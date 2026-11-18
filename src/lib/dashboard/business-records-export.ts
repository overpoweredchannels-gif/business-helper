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
