"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { buildPrintableReceiptHtml, getReceiptLineRows, getReceiptSummaryRows, getReceiptWidthMm, type Receipt } from "@/lib/print/retail-receipt";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";

export type { Receipt } from "@/lib/print/retail-receipt";

const money = (value: number) => new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

export function POSReceiptPreview({ receipt, template }: { receipt: Receipt; template: PrintTemplate }) {
  const lineRows = getReceiptLineRows(receipt);
  const summaryRows = getReceiptSummaryRows(receipt);
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
      {summaryRows.map(row => <div key={row.label} className={`flex justify-between gap-1 py-0.5 ${row.label === "Total" ? "border-t pt-1 font-bold" : ""}`} style={row.label === "Total" ? { borderColor: template.page.rule, fontSize: template.footer.valueSizePx } : undefined}>
        <span className="overflow-wrap-anywhere">{row.label}</span>
        <strong className="text-right tabular-nums" style={{ overflowWrap: "anywhere" }}>{money(row.amount)}</strong>
      </div>)}
    </div>
    {template.header.showOrgName && template.header.orgNamePosition === "bottom" && orgName}
    {template.footer.showFootnote && <p className="mt-2 border-t pt-1" style={{ borderColor: template.page.rule, fontSize: template.footer.footnoteSizePx }}>{template.footer.footnoteText}</p>}
  </div>;
}

export function POSReceipt({ receipt }: { receipt: Receipt }) {
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
  const printLock = useRef(false);
  const printStarted = useRef(false);

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

  useEffect(() => () => {
    if (!printStarted.current) {
      printFrame.current?.remove();
      printFrame.current = null;
    }
  }, []);

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
    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      frame.removeEventListener("load", onLoad);
      frame.contentWindow?.removeEventListener("afterprint", cleanup);
      window.removeEventListener("afterprint", cleanup);
      frame.remove();
      if (printFrame.current === frame) printFrame.current = null;
      printLock.current = false;
      printStarted.current = false;
      setPrinting(false);
    };
    const onLoad = async () => {
      try {
        const targetWindow = frame.contentWindow;
        const targetDocument = frame.contentDocument;
        if (!targetWindow || !targetDocument) throw new Error("Print frame did not load");
        await Promise.race([
          targetDocument.fonts.ready,
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Receipt fonts did not finish loading")), 20000)),
        ]);
        await new Promise<void>(resolve => targetWindow.requestAnimationFrame(() => targetWindow.requestAnimationFrame(() => resolve())));
        if (settled || !frame.isConnected) return;
        window.clearTimeout(fallbackTimer);
        fallbackTimer = window.setTimeout(cleanup, 10 * 60 * 1000);
        targetWindow.addEventListener("afterprint", cleanup, { once: true });
        window.addEventListener("afterprint", cleanup, { once: true });
        targetWindow.focus();
        printStarted.current = true;
        targetWindow.print();
        // Some browsers omit afterprint. Keep the frame alive long enough that
        // a slow physical printer or a delayed print dialog cannot be cut off.
      } catch {
        cleanup();
        setError("The receipt could not be prepared for printing. The preview is still available.");
      }
    };

    frame.addEventListener("load", onLoad, { once: true });
    frame.srcdoc = buildPrintableReceiptHtml(receipt, template);
    document.body.appendChild(frame);
    fallbackTimer = window.setTimeout(() => {
      if (!settled) {
        cleanup();
        setError("The receipt did not finish loading for printing. The preview is still available.");
      }
    }, 30000);
  }, [receipt, template, templateReady]);

  const preview = useMemo(() => <POSReceiptPreview receipt={receipt} template={activeTemplate} />, [receipt, activeTemplate]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {open && createPortal(
      <div data-context-help-skip role="dialog" aria-modal="true" aria-label={`Receipt ${receipt.number}`} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
        <div className="mx-auto max-w-md rounded-xl bg-white p-4 shadow-xl">
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setCustomizing(true)} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Edit POS receipt template</button>
            <button type="button" onClick={() => void print()} disabled={!templateReady || printing} className="min-h-11 min-w-11 rounded bg-primary px-3 py-2 text-sm text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{printing ? "Preparing receipt…" : "Print receipt"}</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Close</button>
          </div>
          {!templateReady && <p role="status" className="mb-2 text-sm">Loading receipt template…</p>}
          {preview}
        </div>
      </div>,
      document.body,
    )}
    {customizing && <TemplateCustomizer docType="retail_receipt" previewRenderer={next => <POSReceiptPreview receipt={receipt} template={next} />} onSaved={next => { setTemplate(next); setCustomizing(false); }} onClose={() => setCustomizing(false)} />}
  </>;
}
