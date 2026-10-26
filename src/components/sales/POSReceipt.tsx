"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { buildPrintableReceiptHtml, getReceiptLineRows, getReceiptPrintableWidthMm, getReceiptSummaryRows, getReceiptWidthMm, resolveReceiptChrome, resolveReceiptCustomerName, type Receipt, type ReceiptChromeLabels, type ReceiptSummaryLabels } from "@/lib/print/retail-receipt";
import { loadReceiptTemplate } from "@/lib/print/receipt-template-loader";
import { saveReceiptTemplate } from "@/lib/print/receipt-template-save";
import { awaitPrintStage, dispatchNativePrint, PRINT_STAGE_ABORTED, PrintRunController, PrintRunUiLock, waitForLayoutSettle, type PrintRunToken } from "@/lib/print/print-run";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";
import { useRegional } from "@/components/regional/RegionalProvider";
import { formatBooksMoney } from "@/lib/tradeos/formatters";

export type { Receipt } from "@/lib/print/retail-receipt";

/** Receipts (scope + number) that have already been auto-printed this
 * session. Module-level on purpose: the sales section unmounts when the
 * user switches tabs, so a component ref would forget and re-print the
 * last receipt when they come back. */
const autoPrintedReceiptKeys = new Set<string>();

/** Receipt summary labels resolved in the active UI language. */
function useReceiptSummaryLabels(): ReceiptSummaryLabels {
  const { t } = useRegional();
  return {
    itemsSubtotal: t("receipt.itemsSubtotal"),
    lineDiscounts: t("sell.lineDiscounts"),
    subtotal: t("common.subtotal"),
    invoiceDiscount: t("sell.invoiceDiscountRow"),
    tax: `${t("common.tax")} ({rate}%)`,
    total: t("common.total"),
    tendered: t("receipt.tendered"),
    changeDue: t("receipt.changeDue"),
    paidByCard: t("receipt.paidByCard"),
  };
}

/** Receipt chrome labels (heading, date label, footnote, column labels,
 * walk-in customer) resolved in the active UI language. They replace the
 * template's shipped English defaults at render time only; customized
 * template text is kept verbatim (see resolveReceiptChrome). */
function useReceiptChromeLabels(): ReceiptChromeLabels {
  const { t } = useRegional();
  return {
    heading: t("receipt.heading"),
    dateLabel: t("receipt.dateLabel"),
    footnote: t("receipt.footnote"),
    walkInCustomer: t("receipt.walkInCustomer"),
    columns: {
      product: t("receipt.columnItem"),
      quantity: t("receipt.columnQty"),
      price: t("receipt.columnRate"),
      total: t("receipt.columnAmount"),
    },
  };
}

export function POSReceiptPreview({ receipt, template }: { receipt: Receipt; template: PrintTemplate }) {
  const labels = useReceiptSummaryLabels();
  const chromeLabels = useReceiptChromeLabels();
  const chrome = resolveReceiptChrome(template, chromeLabels);
  const lineRows = getReceiptLineRows(receipt);
  const summaryRows = getReceiptSummaryRows(receipt, labels);
  const meta = [
    template.header.showInvoiceNo ? receipt.number : "",
    template.header.showDate ? `${chrome.dateLabel}: ${receipt.date}` : "",
    template.header.showCustomer ? resolveReceiptCustomerName(receipt.customer, chromeLabels) : "",
  ].filter(Boolean);
  const orgName = template.header.showOrgName
    ? <h2 className="mb-1 font-bold" style={{ fontSize: template.header.orgNameSizePx }}>{receipt.business}</h2>
    : null;

  return <div
    data-receipt-paper-width={`${getReceiptWidthMm(template)}mm`}
    data-receipt-content-width={`${getReceiptPrintableWidthMm(template)}mm`}
    className="mx-auto bg-white p-2 text-black"
    style={{
      width: `${getReceiptWidthMm(template)}mm`,
      maxWidth: "100%",
      boxSizing: "border-box",
      fontFamily: template.fontFamily,
      color: template.page.ink,
      background: template.page.background,
      overflowWrap: "anywhere",
    }}
  >
    {/* Content is constrained to the printable width and centered on the
        paper, mirroring the printed sheet. */}
    <div className="mx-auto w-full" style={{ maxWidth: `${getReceiptPrintableWidthMm(template)}mm` }}>
    {template.header.showOrgName && template.header.orgNamePosition === "top" && orgName}
    <p className="font-semibold" style={{ fontSize: template.header.headingSizePx }}>{chrome.headingText}</p>
    <p className="mb-2" style={{ fontSize: template.header.metaSizePx }}>{meta.join(" · ")}</p>
    <table className="w-full table-fixed border-collapse text-left"><thead><tr>{chrome.columns.map(column =>
      <th key={column.key} className="border-y py-1 pr-1 align-top" style={{ width: `${column.widthPct}%`, borderColor: template.page.rule, fontSize: template.columns.headerSizePx }}>
        {template.columns.uppercaseHeaders ? column.label.toUpperCase() : column.label}
      </th>,
    )}</tr></thead><tbody>{lineRows.map((line, index) => <tr key={`${line.name}-${index}`}>
      {chrome.columns.map(column => {
        const values: Record<string, string> = {
          quantity: line.quantity,
          price: formatBooksMoney(Number(line.price)),
          discount: formatBooksMoney(Number(line.discount || 0)),
          bonus: line.bonus ? `${line.bonus} ${line.unit}` : "",
          total: formatBooksMoney(line.amount),
        };
        const numeric = column.key === "quantity" || column.key === "price" || column.key === "discount" || column.key === "total";
        return <td key={column.key} className="border-b py-1 pr-1 align-top" style={{ borderColor: template.page.rule, fontSize: template.columns.rowSizePx, fontWeight: template.boldBody ? 700 : 400, overflowWrap: numeric ? "normal" : "anywhere", whiteSpace: numeric ? "nowrap" : undefined }}>
          {column.key === "product"
            ? <>{line.name}{line.unit ? <span className="block" style={{ fontSize: Math.max(8, template.columns.rowSizePx - 1), opacity: 0.75 }}>{line.unit}</span> : null}</>
            : values[column.key] ?? ""}
        </td>;
      })}
    </tr>)}</tbody></table>
    <div className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.labelSizePx }}>
      {summaryRows.map(row => <div key={row.key} className={`flex flex-wrap justify-between gap-1 py-0.5 ${row.key === "total" ? "border-t pt-1 font-bold" : ""}`} style={row.key === "total" ? { borderColor: template.page.rule, fontSize: template.footer.valueSizePx } : undefined}>
        <span className="overflow-wrap-anywhere">{row.label}</span>
        <strong className="text-right tabular-nums" style={{ overflowWrap: "normal", whiteSpace: "nowrap" }}>{formatBooksMoney(row.amount)}</strong>
      </div>)}
    </div>
    {template.header.showOrgName && template.header.orgNamePosition === "bottom" && orgName}
    {template.footer.showFootnote && <p className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.footnoteSizePx }}>{chrome.footnoteText}</p>}
    </div>
  </div>;
}

export function POSReceipt({ receipt, autoPrint = false, onDone }: { receipt: Receipt; autoPrint?: boolean; /** Runs once when the dialog closes, by any path (printed, closed, or escaped), so the parent can clear the printed receipt and reset the sale screen for the next customer. */
  onDone?: () => void }) {
  const labels = useReceiptSummaryLabels();
  const chromeLabels = useReceiptChromeLabels();
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [savingWidth, setSavingWidth] = useState(false);
  const [loadedScope, setLoadedScope] = useState("");
  const defaultTemplate = useMemo(() => cloneDefaultTemplate("retail_receipt"), []);
  const [template, setTemplate] = useState<PrintTemplate>(() => cloneDefaultTemplate("retail_receipt"));
  const templateReady = loadedScope === receipt.scope;
  const activeTemplate = templateReady ? template : defaultTemplate;
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  const printCleanup = useRef<((trigger?: string) => void) | null>(null);
  // The "Preparing receipt…" UI state, owned per print run and held
  // only until the run dispatches its native print dialog (PrintRunUiLock).
  const [printUiLock] = useState(() => new PrintRunUiLock());
  // Cancellation authority for the in-flight print pipeline. Dismissing
  // the dialog aborts the active run's token FIRST, so every staged
  // continuation of print() becomes a no-op even if the stored cleanup
  // was already replaced or a stage promise never settles.
  const [printRuns] = useState(() => new PrintRunController());
  // Whether an auto-opened preview is still waiting for its template
  // before printing. A ref (not state) so StrictMode's double effect
  // invocation cannot print the same receipt twice.
  const autoPrintPending = useRef(false);
  // Temporary diagnostic instrumentation (2026-10-24): with
  // ?receiptdebug=1 in the page URL, the dialog renders the print
  // pipeline's current stage so a screenshot shows where a run parks.
  // Read once at mount; without the flag nothing renders and the stage
  // state never updates — zero UI or behaviour change.
  const [receiptDebug] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("receiptdebug") === "1");
  const [debugStage, setDebugStage] = useState("init");
  const markStage = useCallback((stage: string) => {
    if (!receiptDebug) return;
    setDebugStage(stage);
  }, [receiptDebug]);

  useEffect(() => {
    if (open) markStage("dialog-open");
  }, [open, markStage]);

  // Next-sale reset (2026-10-26): the parent clears the printed receipt
  // only when this dialog actually closes, whichever path closed it.
  // Tracking the transition (not each close call) means no path can
  // fire it twice, and a close that never happened fires nothing.
  const wasReceiptOpen = useRef(false);
  useEffect(() => {
    if (wasReceiptOpen.current && !open) onDone?.();
    wasReceiptOpen.current = open;
  }, [open, onDone]);

  useEffect(() => {
    let live = true;
    const scope = receipt.scope;
    markStage("template-loading");
    // The loader ALWAYS resolves in bounded time (saved template, or the
    // built-in default on empty / error / timeout), so templateReady can
    // never wait on a stalled fetch again — the previous chain awaited
    // getSession() + fetch with no timeout and could hang the dialog on
    // "Loading receipt template…" indefinitely.
    void loadReceiptTemplate({
      defaultTemplate,
      fetchJson: (signal) =>
        authorizedFetch("/api/print-templates?doc_type=retail_receipt", { signal }).then(response => response.json()),
    }).then(result => {
      if (!live) return;
      setTemplate(result.template);
      setLoadedScope(scope);
      markStage(`template-ready scope-match=${scope === receipt.scope}`);
    });
    return () => { live = false; };
  }, [defaultTemplate, receipt.scope, markStage]);

  const dismissReceipt = useCallback(() => {
    // A dismissed preview must not print later when its template arrives.
    autoPrintPending.current = false;
    // Abort the in-flight print run before anything else: from this
    // instant its staged continuations are no-ops, whatever stage they
    // are parked in. Cleanup below then releases the state synchronously.
    printRuns.abortCurrent();
    try {
      printCleanup.current?.("dismiss");
    } finally {
      // Force-release the print state: if the browser's print dialog was
      // cancelled without firing afterprint, cleanup may never run and the
      // modal would otherwise be stuck on "Preparing receipt…" forever.
      // In a finally block so Close ALWAYS dismisses, even if the stored
      // cleanup itself throws.
      printUiLock.releaseAll();
      setPrinting(false);
      setOpen(false);
    }
  }, [printRuns, printUiLock]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismissReceipt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissReceipt, open]);

  useEffect(() => () => printCleanup.current?.(), []);

  const print = useCallback(async (kind: "auto" | "manual" = "manual") => {
    if (!templateReady || printUiLock.isHeld()) return;
    markStage(`print-entered ${kind}`);
    setPrinting(true);
    setError("");
    // One token per print run. Beginning this run aborts any previous
    // run's parked continuations; dismissing the dialog aborts this one.
    const runToken: PrintRunToken = printRuns.begin();
    printUiLock.acquire(runToken);
    const frame = document.createElement("iframe");
    frame.title = `Print receipt ${receipt.number}`;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    printFrame.current?.remove();
    printFrame.current = frame;
    markStage("iframe-created");

    let settled = false;
    let fallbackTimer = 0;
    // One watchdog bounds the WHOLE print operation and is cleared only
    // inside cleanup — the staged fallback timer below is cleared and
    // re-armed mid-flight, so it cannot be the only guarantee that the
    // "Preparing receipt…" state settles.
    let watchdogTimer = 0;
    let printWindow: Window | null = null;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cleanup("dismiss");
      setOpen(false);
    };
    // Release this run's "Preparing receipt…" state. Normally this
    // already happened at dispatch (below); cleanup calls it again for
    // runs that never dispatched, and the lock ignores the call when a
    // newer run owns the state — a stale cleanup tail can never clear
    // a live run's state.
    const releaseUiState = () => {
      printUiLock.release(runToken);
      if (!printUiLock.isHeld()) setPrinting(false);
    };
    const cleanup = (trigger: string = "abort") => {
      if (settled) return;
      settled = true;
      markStage(`cleanup trigger=${trigger}`);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(watchdogTimer);
      frame.removeEventListener("load", onLoad);
      printWindow?.removeEventListener("afterprint", onAfterprint);
      printWindow?.removeEventListener("keydown", onEscape);
      window.removeEventListener("afterprint", onAfterprint);
      frame.remove();
      if (printFrame.current === frame) printFrame.current = null;
      if (printCleanup.current === cleanup) printCleanup.current = null;
      releaseUiState();
    };
    function onAfterprint() {
      cleanup("afterprint");
    }
    printCleanup.current = cleanup;
    const onLoad = async () => {
      markStage("iframe-load-fired");
      try {
        const targetWindow = frame.contentWindow;
        const targetDocument = frame.contentDocument;
        if (!targetWindow || !targetDocument) throw new Error("Print frame did not load");
        printWindow = targetWindow;
        const waitWithTimeout = async (promise: Promise<unknown>, message: string, milliseconds: number) => {
          let timeout = 0;
          try {
            await Promise.race([
              promise,
              new Promise<never>((_, reject) => {
                timeout = window.setTimeout(() => reject(new Error(message)), milliseconds);
              }),
            ]);
          } finally {
            window.clearTimeout(timeout);
          }
        };
        // Each staged wait races the run token: if the dialog was
        // dismissed (or a newer run began) while a wait was parked, the
        // pipeline unwinds HERE as a no-op — dismiss already released
        // the print state synchronously, so nothing is cleaned up twice
        // and no error is raised for a print the user cancelled.
        markStage("fonts-wait");
        const fontsStage = await awaitPrintStage(runToken, waitWithTimeout(targetDocument.fonts?.ready ?? Promise.resolve(), "Receipt fonts did not finish loading", 20000));
        if (fontsStage === PRINT_STAGE_ABORTED || settled) return;
        markStage("fonts-done");
        // A disconnected frame means the print can never proceed; route
        // through cleanup instead of returning bare (the old bare return
        // left `printing` and the print lock set forever).
        if (!frame.isConnected) { cleanup("abort"); return; }
        markStage("layout-wait");
        // The settle runs on the PARENT window's timers, never on the
        // frame's requestAnimationFrame: the print frame is a hidden
        // 1×1 iframe whose rendering may be frozen, and a double-rAF
        // wait on it parked this pipeline at this stage indefinitely
        // (instrumented QA, 2026-10-24). window.print() lays the frame
        // document out itself before printing, and the fonts stage
        // above already covers font settling — see waitForLayoutSettle.
        const layoutStage = await awaitPrintStage(runToken, waitWithTimeout(waitForLayoutSettle(), "Receipt layout did not finish preparing", 5000));
        if (layoutStage === PRINT_STAGE_ABORTED || settled) return;
        markStage("layout-done");
        if (!frame.isConnected) { cleanup("abort"); return; }
        window.clearTimeout(fallbackTimer);
        markStage("fallback-cleared");
        targetWindow.addEventListener("keydown", onEscape);
        targetWindow.addEventListener("afterprint", onAfterprint, { once: true });
        window.addEventListener("afterprint", onAfterprint, { once: true });
        targetWindow.focus();
        if (typeof targetWindow.print !== "function") throw new Error("Browser printing is unavailable");
        if (runToken.isAborted() || settled) return;
        // Dispatch: the "Preparing receipt…" state is COMMITTED before
        // the native call is entered, not after it returns — window.print()
        // blocks the main thread for as long as the browser's print UI
        // is up, and the fallback/watchdog timers and Close/Escape
        // handlers all live on that thread, so a release sequenced
        // after the call can be outlived indefinitely (production,
        // 2026-10-23: dialog frozen on "Preparing receipt…", Close and
        // Escape dead, only a reload cleared it). The dispatch yields
        // one macrotask after releasing so React actually flushes the
        // queued state update before the thread parks, and re-checks
        // the run token after the yield — a run dismissed in that
        // window never opens the native dialog. From the dispatch the
        // user's interaction is with the OS dialog; the cleanup tail
        // below keeps running and still owns the frame and timers.
        await dispatchNativePrint(targetWindow, releaseUiState, runToken, markStage);
        // print() returns when its native dialog closes. Some browsers omit
        // afterprint, so use its return as the completion signal in that case.
        if (!settled && !runToken.isAborted()) fallbackTimer = window.setTimeout(() => cleanup("fallback"), 1500);
      } catch {
        if (settled || runToken.isAborted()) return;
        cleanup("abort");
        setError("The receipt could not be prepared for printing. The preview is still available.");
      }
    };

    try {
      frame.addEventListener("load", onLoad, { once: true });
      frame.srcdoc = buildPrintableReceiptHtml(receipt, template, labels, chromeLabels);
      document.body.appendChild(frame);
      watchdogTimer = window.setTimeout(() => {
        if (!settled && !runToken.isAborted()) {
          markStage("watchdog45-fired");
          cleanup("watchdog");
          setError("The receipt did not finish loading for printing. The preview is still available.");
        }
      }, 45000);
      markStage("watchdog45-armed");
      fallbackTimer = window.setTimeout(() => {
        if (!settled && !runToken.isAborted()) {
          markStage("fallback30-fired");
          cleanup("fallback");
          setError("The receipt did not finish loading for printing. The preview is still available.");
        }
      }, 30000);
      markStage("fallback30-armed");
    } catch {
      if (!runToken.isAborted()) {
        cleanup("abort");
        setError("The receipt could not be prepared for printing. The preview is still available.");
      }
    }
  }, [receipt, template, templateReady, labels, chromeLabels, printRuns, printUiLock, markStage]);

  // Auto-print (POS quick sale): open the preview for each new receipt and
  // print it as soon as its template is ready. The receipt key is recorded
  // before opening so a re-render or StrictMode double-effect cannot queue
  // the same receipt twice; the manual button and modal remain the fallback
  // when printing is blocked, fails, or is dismissed.
  useEffect(() => {
    if (!autoPrint) return;
    const key = `${receipt.scope}:${receipt.number}`;
    if (autoPrintedReceiptKeys.has(key)) return;
    autoPrintedReceiptKeys.add(key);
    autoPrintPending.current = true;
    setOpen(true);
  }, [autoPrint, receipt.scope, receipt.number]);

  useEffect(() => {
    if (!open || !templateReady || !autoPrintPending.current) return;
    autoPrintPending.current = false;
    void print("auto");
  }, [open, templateReady, print]);

  // Paper width is the single most-missed receipt setting (a 58mm printer
  // fed an 80mm layout clips the totals column), so it is switchable right
  // here and persisted through the same template save path the customizer
  // uses — no separate storage. The save goes through saveReceiptTemplate,
  // which always settles within 8s: the old chain awaited authorizedFetch
  // with no timeout, so a stalled POST left savingWidth set — and this
  // select disabled — forever.
  const changePaperWidth = useCallback(async (nextWidth: 58 | 80) => {
    if (!templateReady || savingWidth || getReceiptWidthMm(template) === nextWidth) return;
    const previous = template;
    const next = { ...template, receiptWidthMm: nextWidth };
    setTemplate(next);
    setSavingWidth(true);
    setError("");
    try {
      const result = await saveReceiptTemplate({
        post: async (signal) => {
          const response = await authorizedFetch("/api/print-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doc_type: "retail_receipt", name: template.name, description: template.description ?? null, config: next }),
            signal,
          });
          const data = await response.json();
          if (!data?.ok) throw new Error(data?.error || "Failed to save template");
          return (data.template?.config as PrintTemplate | undefined) ?? null;
        },
      });
      if (result.status === "failed") throw new Error(`Template save ${result.reason}`);
      if (result.config) {
        setTemplate({ ...next, ...result.config });
      }
    } catch {
      setTemplate(previous);
      setError("The paper width could not be saved, so the previous width was restored. You can also set it in the receipt template editor.");
    } finally {
      setSavingWidth(false);
    }
  }, [savingWidth, template, templateReady]);

  const preview = useMemo(() => <POSReceiptPreview receipt={receipt} template={activeTemplate} />, [receipt, activeTemplate]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>
    {error && !open && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {open && createPortal(
      <div data-context-help-skip role="dialog" aria-modal="true" aria-label={`Receipt ${receipt.number}`} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
        <div className="mx-auto max-w-md rounded-xl bg-white p-4 shadow-xl">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <label className="mr-auto flex min-h-11 items-center gap-2 text-sm">
              <span>Paper width</span>
              <select
                aria-label="Receipt paper width"
                value={getReceiptWidthMm(activeTemplate)}
                disabled={!templateReady || savingWidth}
                onChange={event => void changePaperWidth(event.target.value === "58" ? 58 : 80)}
                className="min-h-11 min-w-11 rounded border px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
              </select>
            </label>
            <button type="button" onClick={() => setCustomizing(true)} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Edit POS receipt template</button>
            <button type="button" onClick={() => void print()} disabled={!templateReady || printing} className="min-h-11 min-w-11 rounded bg-primary px-3 py-2 text-sm text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{printing ? "Preparing receipt…" : "Print receipt"}</button>
            <button type="button" onClick={dismissReceipt} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Close</button>
          </div>
          {!templateReady && <p role="status" className="mb-2 text-sm">Loading receipt template…</p>}
          {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
          {receiptDebug && <p data-receipt-debug="1" role="status" className="mb-2 text-sm tabular-nums">stage: {debugStage} printing={String(printing)} ready={String(templateReady)} saving={String(savingWidth)}</p>}
          {preview}
        </div>
      </div>,
      document.body,
    )}
    {customizing && <TemplateCustomizer docType="retail_receipt" previewRenderer={next => <POSReceiptPreview receipt={receipt} template={next} />} onSaved={next => { setTemplate(next); setCustomizing(false); }} onClose={() => setCustomizing(false)} />}
  </>;
}
