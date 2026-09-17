"use client";

import { useEffect, useRef, useState } from "react";
import { BarcodeInput } from "@/components/invoices/BarcodeInput";
import { ProductSearchSelect } from "@/components/invoices/ProductSearchSelect";
import type { BarcodeLine } from "@/lib/invoices/barcode";
import type { Product, Customer } from "@/lib/tradeos/types";

export type CounterSale = {
  lines: BarcodeLine[]; customerId: string | null; date: string;
  paymentType: "cash" | "credit"; discount: string; discountType: "flat" | "percent"; tax: string;
};
type HeldSale = { id: string; savedAt: string; sale: CounterSale };
const money = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(value);

export function RetailPOS({ scope, sale, products, customers, total, busy, owner, scanUnit, focusSignal, onScan, onAdd, onUnit, onCustomer, onLine, onRemove, onSave, onAdvanced, onRestore, onClear }: {
  scope: string; sale: CounterSale; products: Product[]; customers: Customer[]; total: number; busy: boolean; owner: boolean;
  scanUnit: "main" | "subunit"; focusSignal: number; onScan: (code: string) => void; onAdd: (id: string) => void;
  onUnit: (unit: "main" | "subunit") => void; onCustomer: (id: string) => void;
  onLine: (index: number, field: keyof BarcodeLine, value: string) => void; onRemove: (index: number) => void;
  onSave: () => void; onAdvanced: () => void; onRestore: (sale: CounterSale) => void; onClear: () => void;
}) {
  const [held, setHeld] = useState<HeldSale[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [received, setReceived] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const holdLock = useRef(false);
  const storageKey = `tradeos-pos-held-v1:${scope}`;
  const readHeld = (): HeldSale[] => {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(stored) || stored.length > 50 || stored.some(row => {
      const draft = row?.sale;
      return typeof row?.id !== "string" || typeof row?.savedAt !== "string" || !draft
        || !Array.isArray(draft.lines) || !["cash", "credit"].includes(draft.paymentType)
        || !["flat", "percent"].includes(draft.discountType)
        || ![draft.date, draft.discount, draft.tax].every(value => typeof value === "string")
        || (draft.customerId !== null && typeof draft.customerId !== "string")
        || draft.lines.some((line: Record<string, unknown>) => !line || ![line.quantity, line.selling_price, line.discount].every(value => typeof value === "string") || (line.product_id !== null && typeof line.product_id !== "string") || (line.bonus !== undefined && typeof line.bonus !== "string") || (line.unit_mode !== undefined && !["main", "subunit"].includes(String(line.unit_mode))));
    })) throw new Error("Invalid held sales");
    return stored;
  };
  useEffect(() => {
    try {
      const stored = readHeld();
      setHeld(stored); setStorageReady(true);
    } catch { setNotice("Held sales could not be loaded. Browser storage must be available to hold a sale."); }
    // The component is keyed by account and business; storage is loaded once per scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => { if (!sale.lines.length) { setReceived(""); holdLock.current = false; } }, [sale.lines.length]);
  useEffect(() => {
    if (!sale.lines.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sale.lines.length]);
  const persist = (rows: HeldSale[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(rows)); setHeld(rows); return true; }
    catch { setNotice("Browser storage is full or unavailable. Your current sale has been kept open."); return false; }
  };
  const hold = () => {
    if (holdLock.current || busy || !sale.lines.length || !storageReady) return;
    let latest: HeldSale[];
    try { latest = readHeld(); } catch { setNotice("Held sales could not be read. Your current sale is still open."); return; }
    if (latest.length >= 50) { setNotice("Resume a held sale first; this browser already has 50 held sales."); return; }
    holdLock.current = true;
    if (persist([...latest, { id: crypto.randomUUID(), savedAt: new Date().toISOString(), sale }])) { onClear(); setNotice("Sale held on this browser. It has not changed stock or payments."); }
    else holdLock.current = false;
  };
  const resume = (row: HeldSale) => {
    if (sale.lines.length || busy) return;
    try {
      const latest = readHeld();
      const saved = latest.find(item => item.id === row.id);
      if (!saved) { setHeld(latest); setNotice("This sale was already resumed in another window."); return; }
      if (persist(latest.filter(item => item.id !== row.id))) { onRestore(saved.sale); setReceived(""); setNotice("Sale resumed. Review its saved prices and quantities before saving."); }
    } catch { setNotice("Held sales could not be read. No sale has been changed."); }
  };
  const entered = received === "" ? total : Number(received);
  const shortCash = owner && sale.paymentType === "cash" && (!Number.isFinite(entered) || entered < total);
  return <div className="space-y-4" data-context-help-skip>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Scan or search • Check quantity • {owner ? "Pay and save" : "Send for approval"}</p>
      <button type="button" disabled={busy} onClick={onAdvanced} className="min-h-11 rounded-lg border px-4 text-sm font-medium">Full invoice / Advanced options</button>
    </div>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div><BarcodeInput compact label="Barcode" autoFocus disabled={busy} focusSignal={focusSignal} onScan={onScan} /></div>
      <div className="space-y-3"><label className="block text-sm font-medium">Find product</label><ProductSearchSelect key={searchKey} value="" products={products.map(p => ({ id: String(p.id), label: [p.name, p.sku, p.barcode].filter(Boolean).join(" — ") }))} onChange={id => { if (id) { onAdd(id); setSearchKey(key => key + 1); } }} />
        <label className="flex items-center gap-3 text-sm">Add one<select value={scanUnit} onChange={event => onUnit(event.target.value as "main" | "subunit")} className="min-h-11 rounded border bg-background px-3"><option value="subunit">Piece / sub-unit</option><option value="main">Box / main unit</option></select></label>
        <label className="block text-sm font-medium">Customer</label><ProductSearchSelect label="Customer" value={sale.customerId ?? ""} products={customers.map(c => ({ id: c.id, label: [c.customer_name, c.shop_name, c.phone].filter(Boolean).join(" — ") }))} onChange={onCustomer} />
      </div>
    </fieldset>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted text-left"><tr>{["Product", "Unit", "Quantity", "Price", "Discount", "Total", ""].map((text, index) => <th key={index} className="p-3">{text}</th>)}</tr></thead>
      <tbody>{sale.lines.map((line, index) => { const product = products.find(p => String(p.id) === line.product_id); return <tr key={index} className="border-t">
        <td className="p-3 font-medium">{product?.name ?? "Product unavailable"}{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}</td>
        <td className="p-2"><select aria-label={`Unit for ${product?.name ?? index + 1}`} value={line.unit_mode ?? "main"} disabled={busy} onChange={event => onLine(index, "unit_mode", event.target.value)} className="min-h-11 rounded border bg-background px-2"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></td>
        {(["quantity", "selling_price", "discount"] as const).map(field => <td key={field} className="p-2"><input aria-label={`${field === "selling_price" ? "Price" : field} for ${product?.name ?? index + 1}`} type="number" min={field === "quantity" ? "0.000001" : "0"} step="any" value={line[field]} disabled={busy} onChange={event => onLine(index, field, event.target.value)} className="min-h-11 w-24 rounded border bg-background px-2" /></td>)}
        <td className="p-3 font-medium">{money((Number(line.quantity) || 0) * (Number(line.selling_price) || 0) - (Number(line.discount) || 0))}</td>
        <td className="p-2"><button type="button" disabled={busy} aria-label={`Remove ${product?.name ?? "product"}`} onClick={() => onRemove(index)} className="min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove</button></td>
      </tr>; })}{!sale.lines.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</td></tr>}</tbody></table></div>
    <div className="sticky bottom-2 z-10 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-primary/30 bg-card p-4 shadow-lg">
      <div><span className="text-sm text-muted-foreground">Total payable · {sale.paymentType}</span><div className="text-3xl font-bold">{money(total)}</div>{(Number(sale.discount) > 0 || Number(sale.tax) > 0) && <small>Includes invoice discount / tax from advanced options.</small>}</div>
      {owner && sale.paymentType === "cash" && <div><label className="block text-sm">Cash received<input aria-label="Cash received" type="number" min="0" step="0.01" value={received} placeholder={String(total)} onChange={event => setReceived(event.target.value)} disabled={busy} className="mt-1 block min-h-11 w-40 rounded border bg-background px-3" /></label><p className="mt-1 text-sm">Change: {money(Math.max(0, entered - total) || 0)}</p></div>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !sale.lines.length || !storageReady} onClick={hold} className="min-h-12 rounded-lg border border-primary px-5 font-semibold disabled:opacity-40">Hold sale</button><button type="button" disabled={busy || !sale.lines.length || !sale.customerId || shortCash} onClick={onSave} className="min-h-12 rounded-lg bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : owner ? sale.paymentType === "credit" ? "Save credit sale" : "Pay & Save" : "Send for approval"}</button></div>
      {shortCash && <p className="w-full text-sm text-destructive">Enter enough cash to cover this sale, or use the full invoice for a credit sale.</p>}
    </div>
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Held sales ({held.length})</summary><p className="my-3 text-sm text-muted-foreground">Saved only on this browser for your account and business. Hold or finish the current sale before resuming another. Stock is checked again when saving.</p>
      {held.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><span>{customers.find(c => c.id === row.sale.customerId)?.customer_name ?? "Customer"} · {row.sale.lines.length} lines · {new Date(row.savedAt).toLocaleString()}</span><button type="button" disabled={busy || sale.lines.length > 0} onClick={() => resume(row)} className="min-h-11 rounded border border-primary px-4 text-primary disabled:opacity-40">Resume</button></div>)}
    </details>
  </div>;
}
