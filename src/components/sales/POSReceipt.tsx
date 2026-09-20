"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Receipt = { scope: string; business: string; number: string; date: string; customer: string; total: number; received?: number; change?: number; returnAmount?: number; payment: string; lines: Array<{ name: string; quantity: string; unit: string; price: string; discount: string; bonus?: string }> };
export function POSReceipt({ receipt }: { receipt: Receipt }) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [template, setTemplate] = useState({ business: receipt.business, title: "Sales receipt", footer: "Thank you for your business." });
  const money = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(value);
  const printedReceipt = useRef("");
  const cashReceived = Number.isFinite(receipt.received ?? 0) ? Number(receipt.received ?? 0) : 0;
  const returnAmount = Number.isFinite(receipt.returnAmount ?? receipt.change ?? 0) ? Number(receipt.returnAmount ?? receipt.change ?? 0) : 0;
  const templateStorageKey = `tradeos-receipt-template-v1:${receipt.scope}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(templateStorageKey) ?? "null");
      if (saved && typeof saved === "object") {
        setTemplate({
          business: typeof saved.business === "string" ? saved.business : receipt.business,
          title: typeof saved.title === "string" ? saved.title : "Sales receipt",
          footer: typeof saved.footer === "string" ? saved.footer : "Thank you for your business.",
        });
      }
    } catch { /* use the default receipt template */ }
  }, [receipt.business, templateStorageKey]);
  const updateTemplate = (field: keyof typeof template, value: string) => {
    const next = { ...template, [field]: value };
    setTemplate(next);
    try { localStorage.setItem(templateStorageKey, JSON.stringify(next)); } catch { /* printing still works without browser storage */ }
  };
  useEffect(() => {
    if (printedReceipt.current === receipt.number) return;
    printedReceipt.current = receipt.number;
    setOpen(true);
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [receipt.number]);
  return <>
    <button type="button" onClick={() => { setOpen(true); window.setTimeout(() => window.print(), 100); }} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>
    {open && createPortal(<div ref={receiptRef} data-pos-receipt data-context-help-skip role="dialog" aria-label={`Receipt ${receipt.number}`} className="fixed inset-0 z-[100] overflow-auto bg-white p-6 text-black">
      <style>{"@media screen { [data-pos-receipt]{margin:auto;max-width:420px;max-height:90dvh;border:1px solid #ddd;border-radius:12px;box-shadow:0 10px 30px #0002} } @media print { body > :not([data-pos-receipt]){display:none!important} [data-pos-receipt]{position:static!important;display:block!important;width:100%!important;min-height:0!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;overflow:visible!important} [data-pos-receipt] .print-hidden{display:none!important} }"}</style>
      <div className="print-hidden mb-4 flex justify-end"><button type="button" onClick={() => setEditingTemplate(value => !value)} className="rounded border px-3 py-2 text-sm">{editingTemplate ? "Done editing template" : "Edit receipt template"}</button></div>
      {editingTemplate && <div className="print-hidden mb-4 grid gap-2 rounded border bg-gray-50 p-3 text-sm"><label>Business details<input value={template.business} onChange={event => updateTemplate("business", event.target.value)} className="mt-1 min-h-10 w-full rounded border bg-white px-2" /></label><label>Receipt heading<input value={template.title} onChange={event => updateTemplate("title", event.target.value)} className="mt-1 min-h-10 w-full rounded border bg-white px-2" /></label><label>Footer message<input value={template.footer} onChange={event => updateTemplate("footer", event.target.value)} className="mt-1 min-h-10 w-full rounded border bg-white px-2" /></label></div>}
      <h2 className="text-xl font-bold">{template.business}</h2><p className="font-semibold">{template.title}</p><p>{receipt.number} · {receipt.date}</p><p className="mb-4">{receipt.customer}</p>
      {receipt.lines.map((line, index) => <div key={index} className="border-t py-2 text-sm"><strong>{line.name}</strong><div className="flex justify-between gap-3"><span>{line.quantity} {line.unit} × {money(Number(line.price))}</span><span>{money(Number(line.quantity) * Number(line.price) - Number(line.discount || 0))}</span></div>{Number(line.bonus) > 0 && <small className="block">Free units: {line.bonus} {line.unit}</small>}{Number(line.discount) > 0 && <small>Discount: {money(Number(line.discount))}</small>}</div>)}
      <div className="mt-3 space-y-1 border-t pt-3 text-sm"><div className="flex justify-between"><span>Total amount</span><strong>{money(receipt.total)}</strong></div>{receipt.payment === "cash" && <><div className="flex justify-between"><span>Cash received</span><strong>{money(cashReceived || receipt.total)}</strong></div><div className="flex justify-between text-lg font-bold"><span>Return to customer</span><span>{money(returnAmount)}</span></div></>}</div><p className="text-sm">{receipt.payment === "cash" ? "Paid in cash" : receipt.payment === "unreconciled" ? "Payment needs reconciliation" : "Credit sale"} · Total includes invoice adjustments.</p><p className="mt-4 border-t pt-3 text-sm">{template.footer}</p>
      <div className="print-hidden mt-5 flex gap-3"><button type="button" onClick={() => window.print()} className="min-h-11 rounded bg-primary px-5 text-primary-foreground">Print receipt</button><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded border px-5">Close</button></div>
    </div>, document.body)}
  </>;
}
