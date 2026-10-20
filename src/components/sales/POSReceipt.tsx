"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { buildPrintableReceiptHtml, getReceiptLineRows, getReceiptSummaryRows, getReceiptWidthMm, type Receipt, type ReceiptSummaryLabels } from "@/lib/print/retail-receipt";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";
import { useRegional } from "@/components/regional/RegionalProvider";

export type { Receipt } from "@/lib/print/retail-receipt";

const money = (value: number) => new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

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

export function POSReceiptPreview({ receipt, template }: { receipt: Receipt; template: PrintTemplate }) {
  const labels = useReceiptSummaryLabels();
  const lineRows = getReceiptLineRows(receipt);
  const summaryRows = getReceiptSummaryRows(receipt, labels);
  const meta = [
    template.header.showInvoiceNo ? receipt.number : "",
    template.header.showDate ? `${template.header.dateLabel}: ${receipt.date}` : "",
    template.header.showCustomer ? receipt.customer : "",
  ].filter(Boolean);
  const orgName = template.header.showOrgName
    ? <h2 className="mb-1 font-bold" style={{ fontSize: template.header.orgNameSizePx }}>{receipt.business}</h2>
    : null;

  return <div
    data-receipt-paper-width={`${getReceiptWidthMm(template)}mm`}
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
    {template.header.showOrgName && template.header.orgNamePosition === "top" && orgName}
    <p className="font-semibold" style={{ fontSize: template.header.headingSizePx }}>{template.header.headingText}</p>
    <p className="mb-2" style={{ fontSize: template.header.metaSizePx }}>{meta.join(" · ")}</p>
    <table className="w-full table-fixed border-collapse text-left"><thead><tr>{template.columns.labels.map(column =>
      <th key={column.key} className="border-y py-1 pr-1 align-top" style={{ width: `${column.widthPct}%`, borderColor: template.page.rule, fontSize: template.columns.headerSizePx }}>
        {template.columns.uppercaseHeaders ? column.label.toUpperCase() : column.label}
      </th>,
    )}</tr></thead><tbody>{lineRows.map((line, index) => <tr key={`${line.name}-${index}`}>
      {template.columns.labels.map(column => {
        const values: Record<string, string> = {
          product: line.name,
          quantity: `${line.quantity} ${line.unit}`,
          price: money(Number(line.price)),
          discount: money(Number(line.discount || 0)),
          bonus: line.bonus ? `${line.bonus} ${line.unit}` : "",
          total: money(line.amount),
        };
        return <td key={column.key} className="border-b py-1 pr-1 align-top" style={{ borderColor: template.page.rule, fontSize: template.columns.rowSizePx, fontWeight: template.boldBody ? 700 : 400, overflowWrap: "anywhere" }}>{values[column.key] ?? ""}</td>;
      })}
    </tr>)}</tbody></table>
    <div className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.labelSizePx }}>
      {summaryRows.map(row => <div key={row.key} className={`flex justify-between gap-1 py-0.5 ${row.key === "total" ? "border-t pt-1 font-bold" : ""}`} style={row.key === "total" ? { borderColor: template.page.rule, fontSize: template.footer.valueSizePx } : undefined}>
        <span className="overflow-wrap-anywhere">{row.label}</span>
        <strong className="text-right tabular-nums" style={{ overflowWrap: "anywhere" }}>{money(row.amount)}</strong>
      </div>)}
    </div>
    {template.header.showOrgName && template.header.orgNamePosition === "bottom" && orgName}
    {template.footer.showFootnote && <p className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.footnoteSizePx }}>{template.footer.footnoteText}</p>}
  </div>;
}

export function POSReceipt({ receipt }: { receipt: Receipt }) {
  const labels = useReceiptSummaryLabels();
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [loadedScope, setLoadedScope] = useState("");
  const defaultTemplate = useMemo(() => cloneDefaultTemplate("retail_receipt"), []);
  const [template, setTemplate] = useState<PrintTemplate>(() => cloneDefaultTemplate("retail_receipt"));
  const templateReady = loadedScope === receipt.scope;
  const activeTemplate = templateReady ? template : defaultTemplate;
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  const printCleanup = useRef<(() => void) | null>(null);
  const printLock = useRef(false);

  useEffect(() => {
    let live = true;
    const scope = receipt.scope;
    authorizedFetch("/api/print-templates?doc_type=retail_receipt")
      .then(response => response.json())
      .then(data => {
        const selected = data?.templates?.find((item: { is_default?: boolean; config?: PrintTemplate }) => item.is_default);
        if (!live) return;
        if (selected?.config) {
          setTemplate({ ...defaultTemplate, ...selected.config, receiptWidthMm: selected.config.receiptWidthMm === 58 ? 58 : 80 });
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
    printCleanup.current?.();
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
      frame.srcdoc = buildPrintableReceiptHtml(receipt, template, labels);
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
  }, [receipt, template, templateReady, labels]);

  const preview = useMemo(() => <POSReceiptPreview receipt={receipt} template={activeTemplate} />, [receipt, activeTemplate]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>
    {error && !open && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {open && createPortal(
      <div data-context-help-skip role="dialog" aria-modal="true" aria-label={`Receipt ${receipt.number}`} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
        <div className="mx-auto max-w-md rounded-xl bg-white p-4 shadow-xl">
          <div className="mb-3 flex flex-wrap justify-end gap-2">
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
