"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type Receipt = { scope: string; business: string; number: string; date: string; customer: string; total: number; received?: number; change?: number; returnAmount?: number; payment: string; lines: Array<{ name: string; quantity: string; unit: string; price: string; discount: string; bonus?: string }> };
export function POSReceipt({ receipt }: { receipt: Receipt }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const money = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(value);
  const printedReceipt = useRef("");
  const cashReceived = Number.isFinite(receipt.received ?? 0) ? Number(receipt.received ?? 0) : 0;
  const returnAmount = Number.isFinite(receipt.returnAmount ?? receipt.change ?? 0) ? Number(receipt.returnAmount ?? receipt.change ?? 0) : 0;
  useEffect(() => {
    if (printedReceipt.current === receipt.number || !dialog.current) return;
    printedReceipt.current = receipt.number;
    dialog.current.showModal();
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [receipt.number]);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()} className="min-h-11 rounded-lg border border-primary px-4 font-medium text-primary">Receipt for {receipt.number}</button>
    {createPortal(<dialog ref={dialog} data-pos-receipt data-context-help-skip className="m-auto max-h-[90dvh] w-[min(420px,95vw)] overflow-auto rounded-xl border bg-white p-6 text-black shadow-xl backdrop:bg-black/40">
      <style>{"@media print {body:has([data-pos-receipt][open]) > :not([data-pos-receipt]){display:none!important} [data-pos-receipt][open]{position:static!important;display:block!important;max-height:none!important;width:100%!important;margin:0!important;border:0!important;box-shadow:none!important} [data-pos-receipt]::backdrop{display:none}}"}</style>
      <h2 className="text-xl font-bold">{receipt.business}</h2><p className="font-semibold">Sales receipt</p><p>{receipt.number} · {receipt.date}</p><p className="mb-4">{receipt.customer}</p>
      {receipt.lines.map((line, index) => <div key={index} className="border-t py-2 text-sm"><strong>{line.name}</strong><div className="flex justify-between gap-3"><span>{line.quantity} {line.unit} × {money(Number(line.price))}</span><span>{money(Number(line.quantity) * Number(line.price) - Number(line.discount || 0))}</span></div>{Number(line.bonus) > 0 && <small className="block">Free units: {line.bonus} {line.unit}</small>}{Number(line.discount) > 0 && <small>Discount: {money(Number(line.discount))}</small>}</div>)}
      <div className="mt-3 space-y-1 border-t pt-3 text-sm"><div className="flex justify-between"><span>Total amount</span><strong>{money(receipt.total)}</strong></div>{receipt.payment === "cash" && <><div className="flex justify-between"><span>Cash received</span><strong>{money(cashReceived || receipt.total)}</strong></div><div className="flex justify-between text-lg font-bold"><span>Return to customer</span><span>{money(returnAmount)}</span></div></>}</div><p className="text-sm">{receipt.payment === "cash" ? "Paid in cash" : receipt.payment === "unreconciled" ? "Payment needs reconciliation" : "Credit sale"} · Total includes invoice adjustments.</p>
      <div className="mt-5 flex gap-3 print:hidden"><button type="button" onClick={() => window.print()} className="min-h-11 rounded bg-primary px-5 text-primary-foreground">Print receipt</button><button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded border px-5">Close</button></div>
    </dialog>, document.body)}
  </>;
}
