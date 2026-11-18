/**
 * Business Records Export (P1 Area B) — Unit Tests.
 *
 * Defect 1: the owner-only dashboard widget hid the whole export UI
 * behind a collapsed <details> element (page.tsx), so the user had to
 * discover and expand it. Fix: the widget renders
 * <BusinessRecordsExport /> directly; the separate "business-records"
 * section already rendered it directly and is unchanged.
 *
 * Defect 2: the export flow failed CLOSED when the browser blocked the
 * popup — `window.open` returned null, the component showed "Allow
 * popups" and the user got NO report at all. Fix: the delivery decision
 * lives in `runBusinessRecordsExport` (src/lib/dashboard/
 * business-records-export.ts) with the browser collaborators injected.
 * The popup stays the primary path; when `openPopup` returns null the
 * SAME fetched data and the SAME HTML are delivered as a file download,
 * so a blocked popup never loses the report. A failed fetch closes the
 * popup (when one was opened) and reports an error — no dangling blank
 * popup is ever left open.
 *
 * This test imports the production helper directly (no mirroring) and
 * drives it with fakes; the widget/section structure is asserted on the
 * real page.tsx source. The `records.allowPopups` key is gone (the
 * blocked-popup path no longer asks for popups) and
 * `records.reportDownloaded` (x4 locales) is the notice shown after a
 * fallback download.
 *
 * Run: npx tsx scripts/test-business-records-export.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  recordsExportFilename,
  runBusinessRecordsExport,
  type RecordsExportPopup,
} from "../src/lib/dashboard/business-records-export";
import {
  businessReportHtml,
  type ReportSection,
} from "../src/lib/print/business-report";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const LABELS = { preparingReport: "Preparing…", reportFailed: "Report failed" };
const FROM = "2026-11-18";
const TO = "2026-11-18";
const SECTIONS: ReportSection[] = [
  { title: "Sales", columns: ["invoice", "total"], rows: [{ invoice: "S-1", total: 10 }] },
];

class FakePopup implements RecordsExportPopup {
  opener: unknown = "window";
  popupClosed = false;
  documentClosed = false;
  opened = false;
  written: string[] = [];
  body = { textContent: null as string | null };
  document = {
    open: () => {
      this.opened = true;
    },
    write: (html: string) => {
      this.written.push(html);
    },
    close: () => {
      this.documentClosed = true;
    },
    body: this.body,
  };
  close(): void {
    this.popupClosed = true;
  }
}

interface Harness {
  popup: FakePopup | null;
  downloads: Array<{ filename: string; html: string }>;
  fetchCalls: Array<{ from: string; to: string }>;
  fetchResult: { ok: boolean; sections?: unknown; error?: string } | Error;
}

function makeHarness(popup: FakePopup | null, fetchResult: Harness["fetchResult"]): Harness {
  return { popup, downloads: [], fetchCalls: [], fetchResult };
}

async function run(harness: Harness) {
  return runBusinessRecordsExport(FROM, TO, {
    openPopup: () => harness.popup,
    fetchReport: async (from, to) => {
      harness.fetchCalls.push({ from, to });
      if (harness.fetchResult instanceof Error) throw harness.fetchResult;
      return harness.fetchResult;
    },
    buildHtml: (from, to, sections) =>
      businessReportHtml(from, to, sections as ReportSection[]),
    downloadHtml: (filename, html) => {
      harness.downloads.push({ filename, html });
    },
  }, LABELS);
}

async function main(): Promise<void> {
  // --- Popup allowed: the existing path is unchanged. ---

  {
    const popup = new FakePopup();
    const harness = makeHarness(popup, { ok: true, sections: SECTIONS });
    const result = await run(harness);
    check(result.delivered === "popup", "popup allowed: delivered via popup");
    check(harness.downloads.length === 0, "popup allowed: no download triggered");
    check(popup.opened, "popup allowed: popup document opened");
    check(popup.written.length === 1, "popup allowed: report HTML written once");
    check(
      popup.written[0].includes("<!doctype html>") && popup.written[0].includes(FROM),
      "popup allowed: written HTML is the built report for the range",
    );
    check(popup.documentClosed, "popup allowed: popup document closed after write");
    check(!popup.popupClosed, "popup allowed: popup itself not closed");
    check(popup.opener === null, "popup allowed: popup opener nulled");
    check(popup.body.textContent === LABELS.preparingReport, "popup allowed: preparing text set on popup body");
    check(
      harness.fetchCalls.length === 1 && harness.fetchCalls[0].from === FROM && harness.fetchCalls[0].to === TO,
      "popup allowed: report fetched for the selected range",
    );
  }

  // --- Popup blocked: the SAME report is delivered as a download. ---

  {
    const harness = makeHarness(null, { ok: true, sections: SECTIONS });
    const result = await run(harness);
    check(result.delivered === "download", "popup blocked: delivered via download");
    check(
      result.delivered === "download" &&
        result.filename === "business-records-2026-11-18_to_2026-11-18.html",
      "popup blocked: download filename carries the range",
    );
    check(harness.downloads.length === 1, "popup blocked: exactly one download triggered");
    check(
      harness.downloads[0].filename === "business-records-2026-11-18_to_2026-11-18.html",
      "popup blocked: download filename matches the result",
    );
    check(
      harness.downloads[0].html.includes("<!doctype html>") &&
        harness.downloads[0].html.includes("Sales"),
      "popup blocked: downloaded HTML is the SAME built report (same sections)",
    );
    check(harness.fetchCalls.length === 1, "popup blocked: report data still fetched before delivery");
  }

  {
    const harness = makeHarness(null, { ok: true, sections: SECTIONS });
    const result = await run(harness);
    check(
      result.delivered === "download" && result.filename.endsWith(".html"),
      "popup blocked: download filename is an HTML file",
    );
  }

  check(
    recordsExportFilename("2026-11-01", "2026-11-07") ===
      "business-records-2026-11-01_to_2026-11-07.html",
    "filename helper: range is embedded verbatim",
  );

  // --- Fetch failure: error, no dangling popup, no delivery. ---

  {
    const popup = new FakePopup();
    const harness = makeHarness(popup, { ok: false, error: "Report unavailable" });
    const result = await run(harness);
    check(
      result.delivered === "error" && result.message === "Report unavailable",
      "fetch failed (popup): error carries the payload message",
    );
    check(popup.popupClosed, "fetch failed (popup): blank popup closed, none left dangling");
    check(popup.written.length === 0, "fetch failed (popup): nothing written to the popup");
    check(harness.downloads.length === 0, "fetch failed (popup): no download triggered");
  }

  {
    const harness = makeHarness(null, new Error("network down"));
    const result = await run(harness);
    check(
      result.delivered === "error" && result.message === "network down",
      "fetch threw (popup blocked): error carries the thrown message",
    );
    check(harness.downloads.length === 0, "fetch threw (popup blocked): no download triggered");
  }

  {
    const popup = new FakePopup();
    const harness = makeHarness(popup, { ok: false });
    const result = await run(harness);
    check(
      result.delivered === "error" && result.message === LABELS.reportFailed,
      "fetch failed without an error string: falls back to the report-failed label (never empty)",
    );
    check(popup.popupClosed, "fetch failed without an error string: popup still closed");
  }

  {
    // Empty sections are a valid report (a day with no records), not an error.
    const popup = new FakePopup();
    const harness = makeHarness(popup, { ok: true, sections: [] });
    const result = await run(harness);
    check(result.delivered === "popup", "empty sections: still delivered via popup, not an error");
    check(popup.written.length === 1, "empty sections: report HTML written once");
  }

  // --- Widget / section structure on the real page.tsx source. ---

  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  const widgetStart = pageSource.indexOf("const businessRecordsExportWidget");
  assert.ok(widgetStart >= 0, "dashboard widget const exists in page.tsx");
  const widgetEnd = pageSource.indexOf("\n  ) : null;", widgetStart);
  assert.ok(widgetEnd > widgetStart, "dashboard widget const ends as expected");
  const widgetBlock = pageSource.slice(widgetStart, widgetEnd);
  check(
    widgetBlock.includes("<BusinessRecordsExport />"),
    "widget: export UI rendered in the dashboard widget",
  );
  check(
    !widgetBlock.includes("<details"),
    "widget: export UI is NOT hidden behind a collapsed <details> anymore",
  );
  check(
    widgetBlock.includes('currentProfile?.role === "owner"'),
    "widget: owner-only gating unchanged",
  );

  const sectionStart = pageSource.indexOf('activeSection === "business-records"');
  assert.ok(sectionStart >= 0, "business-records section exists in page.tsx");
  const sectionBlock = pageSource.slice(sectionStart, sectionStart + 800);
  check(
    sectionBlock.includes("<BusinessRecordsExport />"),
    "section: business-records section still renders the component directly",
  );
  check(
    !sectionBlock.includes("<details"),
    "section: business-records section has no <details> wrapper (unchanged)",
  );

  // --- Component wiring on the real component source. ---

  const componentSource = readFileSync(
    new URL("../src/components/dashboard/BusinessRecordsExport.tsx", import.meta.url),
    "utf8",
  );
  check(
    componentSource.includes("runBusinessRecordsExport"),
    "component: export click goes through the shared delivery helper",
  );
  check(
    !componentSource.includes("allowPopups"),
    "component: dead 'allow popups' error path is gone (blocked popups now download)",
  );
  check(
    componentSource.includes("records.reportDownloaded"),
    "component: download fallback shows the report-downloaded notice",
  );

  console.log(`\nAll ${passed} Business Records Export checks passed.`);
}

void main();
