"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { buildPrintableReceiptHtml, getReceiptLineRows, getReceiptPrintableWidthMm, getReceiptSummaryRows, getReceiptWidthMm, normalizeReceiptWidthMm, resolveReceiptChrome, resolveReceiptCustomerName, type Receipt, type ReceiptChromeLabels, type ReceiptSummaryLabels } from "@/lib/print/retail-receipt";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";
import { useRegional } from "@/components/regional/RegionalProvider";
import { formatPKR } from "@/lib/tradeos/formatters";

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
          price: formatPKR(Number(line.price)),
          discount: formatPKR(Number(line.discount || 0)),
          bonus: line.bonus ? `${line.bonus} ${line.unit}` : "",
          total: formatPKR(line.amount),
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
        <strong className="text-right tabular-nums" style={{ overflowWrap: "normal", whiteSpace: "nowrap" }}>{formatPKR(row.amount)}</strong>
      </div>)}
    </div>
    {template.header.showOrgName && template.header.orgNamePosition === "bottom" && orgName}
    {template.footer.showFootnote && <p className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.footnoteSizePx }}>{chrome.footnoteText}</p>}
    </div>
  </div>;
}

export function POSReceipt({ receipt, autoPrint = false }: { receipt: Receipt; autoPrint?: boolean }) {
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
  const printCleanup = useRef<(() => void) | null>(null);
  const printLock = useRef(false);
  // Whether an auto-opened preview is still waiting for its template
  // before printing. A ref (not state) so StrictMode's double effect
  // invocation cannot print the same receipt twice.
  const autoPrintPending = useRef(false);

  useEffect(() => {
    let live = true;
    const scope = receipt.scope;
    authorizedFetch("/api/print-templates?doc_type=retail_receipt")
      .then(response => response.json())
      .then(data => {
        const selected = data?.templates?.find((item: { is_default?: boolean; config?: PrintTemplate }) => item.is_default);
        if (!live) return;
        if (selected?.config) {
          setTemplate({ ...defaultTemplate, ...selected.config, receiptWidthMm: normalizeReceiptWidthMm(selected.config.receiptWidthMm) });
        } else setTemplate(defaultTemplate);
        setLoadedScope(scope);
      })
      .catch(() => {
        if (live) {
          setTemplate(defaultTemplate);
          setLoadedScope(scope);
        }
      });
    return () => { live = false; };
  }, [defaultTemplate, receipt.scope]);

  const dismissReceipt = useCallback(() => {
    // A dismissed preview must not print later when its template arrives.
    autoPrintPending.current = false;
    printCleanup.current?.();
    // Force-release the print state: if the browser's print dialog was
    // cancelled without firing afterprint, cleanup may never run and the
    // modal would otherwise be stuck on "Preparing receipt…" forever.
    printLock.current = false;
    setPrinting(false);
    setOpen(false);
  }, []);

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

  const print = useCallback(async () => {
    if (!templateReady || printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    setError("");
    const frame = document.createElement("iframe");
    frame.title = `Print receipt ${receipt.number}`;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    printFrame.current?.remove();
    printFrame.current = frame;

    let settled = false;
    let fallbackTimer = 0;
    let printWindow: Window | null = null;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cleanup();
      setOpen(false);
    };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      frame.removeEventListener("load", onLoad);
      printWindow?.removeEventListener("afterprint", cleanup);
      printWindow?.removeEventListener("keydown", onEscape);
      window.removeEventListener("afterprint", cleanup);
      frame.remove();
      if (printFrame.current === frame) printFrame.current = null;
      if (printCleanup.current === cleanup) printCleanup.current = null;
      printLock.current = false;
      setPrinting(false);
    };
    printCleanup.current = cleanup;
    const onLoad = async () => {
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
        await waitWithTimeout(targetDocument.fonts?.ready ?? Promise.resolve(), "Receipt fonts did not finish loading", 20000);
        if (settled || !frame.isConnected) return;
        await waitWithTimeout(new Promise<void>(resolve => targetWindow.requestAnimationFrame(() => targetWindow.requestAnimationFrame(() => resolve()))), "Receipt layout did not finish preparing", 5000);
        if (settled || !frame.isConnected) return;
        window.clearTimeout(fallbackTimer);
        targetWindow.addEventListener("keydown", onEscape);
        targetWindow.addEventListener("afterprint", cleanup, { once: true });
        window.addEventListener("afterprint", cleanup, { once: true });
        targetWindow.focus();
        if (typeof targetWindow.print !== "function") throw new Error("Browser printing is unavailable");
        targetWindow.print();
        // print() returns when its native dialog closes. Some browsers omit
        // afterprint, so use its return as the completion signal in that case.
        if (!settled) fallbackTimer = window.setTimeout(cleanup, 1500);
      } catch {
        if (settled) return;
        cleanup();
        setError("The receipt could not be prepared for printing. The preview is still available.");
      }
    };

    try {
      frame.addEventListener("load", onLoad, { once: true });
      frame.srcdoc = buildPrintableReceiptHtml(receipt, template, labels, chromeLabels);
      document.body.appendChild(frame);
      fallbackTimer = window.setTimeout(() => {
        if (!settled) {
          cleanup();
          setError("The receipt did not finish loading for printing. The preview is still available.");
        }
      }, 30000);
    } catch {
      cleanup();
      setError("The receipt could not be prepared for printing. The preview is still available.");
    }
  }, [receipt, template, templateReady, labels, chromeLabels]);

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
    void print();
  }, [open, templateReady, print]);

  // Paper width is the single most-missed receipt setting (a 58mm printer
  // fed an 80mm layout clips the totals column), so it is switchable right
  // here and persisted through the same template save path the customizer
  // uses — no separate storage.
  const changePaperWidth = useCallback(async (nextWidth: 58 | 80) => {
    if (!templateReady || savingWidth || getReceiptWidthMm(template) === nextWidth) return;
    const previous = template;
    const next = { ...template, receiptWidthMm: nextWidth };
    setTemplate(next);
    setSavingWidth(true);
    setError("");
    try {
      const response = await authorizedFetch("/api/print-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_type: "retail_receipt", name: template.name, description: template.description ?? null, config: next }),
      });
      const data = await response.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to save template");
      if (data.template?.config) {
        setTemplate({ ...next, ...data.template.config, receiptWidthMm: normalizeReceiptWidthMm(data.template.config.receiptWidthMm) });
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
          {preview}
        </div>
      </div>,
      document.body,
    )}
    {customizing && <TemplateCustomizer docType="retail_receipt" previewRenderer={next => <POSReceiptPreview receipt={receipt} template={next} />} onSaved={next => { setTemplate(next); setCustomizing(false); }} onClose={() => setCustomizing(false)} />}
  </>;
}
