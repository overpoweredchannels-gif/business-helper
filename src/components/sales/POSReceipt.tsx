"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";

export type Receipt = { scope: string; business: string; number: string; date: string; customer: string; total: number; received?: number; change?: number; returnAmount?: number; payment: string; lines: Array<{ name: string; quantity: string; unit: string; price: string; discount: string; bonus?: string }> };
const money = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number.isFinite(value) ? value : 0);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);

export function POSReceiptPreview({ receipt, template }: { receipt: Receipt; template: PrintTemplate }) {
  const returned = Number(receipt.returnAmount ?? receipt.change ?? 0);
  const received = Number(receipt.received ?? receipt.total);
  const meta = [template.header.showInvoiceNo ? receipt.number : "", template.header.showDate ? `${template.header.dateLabel}: ${receipt.date}` : "", template.header.showCustomer ? receipt.customer : ""].filter(Boolean);
  return <div className="bg-white p-4 text-black" style={{ fontFamily: template.fontFamily, color: template.page.ink, background: template.page.background }}>
    {template.header.showOrgName && template.header.orgNamePosition === "top" && <h2 className="font-bold" style={{ fontSize: template.header.orgNameSizePx }}>{receipt.business}</h2>}
    <p className="font-semibold" style={{ fontSize: template.header.headingSizePx }}>{template.header.headingText}</p><p className="mb-3" style={{ fontSize: template.header.metaSizePx }}>{meta.join(" · ")}</p>
    <table className="w-full border-collapse text-left"><thead><tr>{template.columns.labels.map(column => <th key={column.key} className="border-y py-1 pr-1" style={{ width: `${column.widthPct}%`, borderColor: template.page.rule, fontSize: template.columns.headerSizePx }}>{template.columns.uppercaseHeaders ? column.label.toUpperCase() : column.label}</th>)}</tr></thead><tbody>{receipt.lines.map((line, index) => <tr key={index}>{template.columns.labels.map(column => { const values: Record<string, string> = { product: line.name, quantity: `${line.quantity} ${line.unit}`, price: money(Number(line.price)), discount: money(Number(line.discount || 0)), bonus: line.bonus ? `${line.bonus} ${line.unit}` : "", total: money(Number(line.quantity) * Number(line.price) - Number(line.discount || 0)) }; return <td key={column.key} className="border-b py-1 pr-1 align-top" style={{ borderColor: template.page.rule, fontSize: template.columns.rowSizePx, fontWeight: template.boldBody ? 700 : 400 }}>{values[column.key] ?? ""}</td>; })}</tr>)}</tbody></table>
    {template.footer.showTotals && <div className="mt-3 border-t pt-2" style={{ borderColor: template.page.rule, fontSize: template.footer.labelSizePx }}><div className="flex justify-between"><span>{template.footer.totalLabel}</span><strong style={{ fontSize: template.footer.valueSizePx }}>{money(receipt.total)}{template.footer.valueSuffix}</strong></div>{receipt.payment === "cash" && <><div className="flex justify-between"><span>{template.footer.bonusLabel}</span><span>{money(received)}</span></div><div className="flex justify-between"><span>{template.footer.netLabel}</span><strong>{money(returned)}</strong></div></>}</div>}
    {template.header.showOrgName && template.header.orgNamePosition === "bottom" && <p className="mt-3 font-bold" style={{ fontSize: template.header.orgNameSizePx }}>{receipt.business}</p>}{template.footer.showFootnote && <p className="mt-3 border-t pt-2" style={{ borderColor: template.page.rule, fontSize: template.footer.footnoteSizePx }}>{template.footer.footnoteText}</p>}
  </div>;
}

function printableHtml(receipt: Receipt, template: PrintTemplate) {
  const columns = template.columns.labels.map(column => `<th style="width:${column.widthPct}%;font-size:${template.columns.headerSizePx}px">${escapeHtml(column.label)}</th>`).join("");
  const rows = receipt.lines.map(line => { const values: Record<string, string> = { product: line.name, quantity: `${line.quantity} ${line.unit}`, price: money(Number(line.price)), discount: money(Number(line.discount || 0)), bonus: line.bonus ? `${line.bonus} ${line.unit}` : "", total: money(Number(line.quantity) * Number(line.price) - Number(line.discount || 0)) }; return `<tr>${template.columns.labels.map(column => `<td style="font-size:${template.columns.rowSizePx}px">${escapeHtml(values[column.key] ?? "")}</td>`).join("")}</tr>`; }).join("");
  const meta = [template.header.showInvoiceNo ? receipt.number : "", template.header.showDate ? `${template.header.dateLabel}: ${receipt.date}` : "", template.header.showCustomer ? receipt.customer : ""].filter(Boolean).map(escapeHtml).join(" · ");
  const cash = receipt.payment === "cash" ? `<div><span>${escapeHtml(template.footer.bonusLabel)}</span><span>${money(Number(receipt.received ?? receipt.total))}</span></div><div><span>${escapeHtml(template.footer.netLabel)}</span><strong>${money(Number(receipt.returnAmount ?? receipt.change ?? 0))}</strong></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(`${receipt.business} - ${receipt.number}`)}</title><style>@page{margin:7mm}body{font-family:${template.fontFamily};color:${template.page.ink};background:${template.page.background};max-width:80mm;margin:auto}h1{font-size:${template.header.orgNameSizePx}px;margin:0}h2{font-size:${template.header.headingSizePx}px;margin:4px 0}p{font-size:${template.header.metaSizePx}px;margin:3px 0}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-top:1px solid ${template.page.rule};padding:3px 1px;text-align:left;vertical-align:top}.total{border-top:1px solid ${template.page.rule};margin-top:8px;padding-top:4px;font-size:${template.footer.labelSizePx}px}.total div{display:flex;justify-content:space-between}.footer{border-top:1px solid ${template.page.rule};margin-top:8px;padding-top:4px;font-size:${template.footer.footnoteSizePx}px}</style></head><body>${template.header.showOrgName && template.header.orgNamePosition === "top" ? `<h1>${escapeHtml(receipt.business)}</h1>` : ""}<h2>${escapeHtml(template.header.headingText)}</h2><p>${meta}</p><table><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table>${template.footer.showTotals ? `<div class="total"><div><span>${escapeHtml(template.footer.totalLabel)}</span><strong>${money(receipt.total)}</strong></div>${cash}</div>` : ""}${template.footer.showFootnote ? `<p class="footer">${escapeHtml(template.footer.footnoteText)}</p>` : ""}${template.header.showOrgName && template.header.orgNamePosition === "bottom" ? `<h1>${escapeHtml(receipt.business)}</h1>` : ""}<script>window.onload=()=>window.print()</script></body></html>`;
}

export function POSReceipt({ receipt }: { receipt: Receipt }) {
  const [open, setOpen] = useState(false); const [customizing, setCustomizing] = useState(false); const [error, setError] = useState("");
  const [template, setTemplate] = useState<PrintTemplate>(() => cloneDefaultTemplate("retail_receipt"));
  useEffect(() => { let live = true; authorizedFetch("/api/print-templates?doc_type=retail_receipt").then(response => response.json()).then(data => { const selected = data?.templates?.find((item: { is_default?: boolean }) => item.is_default); if (live && selected?.config) setTemplate(selected.config); }).catch(() => undefined); return () => { live = false; }; }, [receipt.scope]);
  const print = () => {
    setError("");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
    frame.onload = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000); }
      catch { frame.remove(); setError("The receipt is ready below. Use Print receipt after allowing browser printing."); }
    };
    frame.srcdoc = printableHtml(receipt, template);
    document.body.appendChild(frame);
  };
  useEffect(() => { setOpen(true); const timer = window.setTimeout(print, 250); return () => window.clearTimeout(timer); }, [receipt.number]);
  const preview = useMemo(() => <POSReceiptPreview receipt={receipt} template={template} />, [receipt, template]);
  return <><button type="button" onClick={() => { setOpen(true); print(); }} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}{open && createPortal(<div data-context-help-skip role="dialog" aria-label={`Receipt ${receipt.number}`} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4"><div className="mx-auto max-w-md rounded-xl bg-white p-4 shadow-xl"><div className="mb-3 flex justify-end gap-2"><button type="button" onClick={() => setCustomizing(true)} className="rounded border px-3 py-2 text-sm">Edit POS receipt template</button><button type="button" onClick={print} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">Print receipt</button><button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-2 text-sm">Close</button></div>{preview}</div></div>, document.body)}{customizing && <TemplateCustomizer docType="retail_receipt" previewRenderer={next => <POSReceiptPreview receipt={receipt} template={next} />} onSaved={next => { setTemplate(next); setCustomizing(false); }} onClose={() => setCustomizing(false)} />}</>;
}
