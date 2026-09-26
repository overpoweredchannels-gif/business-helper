"use client";

import { useEffect, useRef, useState } from "react";
import { BarcodeInput } from "@/components/invoices/BarcodeInput";
import { ProductSearchSelect } from "@/components/invoices/ProductSearchSelect";
import type { BarcodeLine } from "@/lib/invoices/barcode";
import type { Product, Customer } from "@/lib/tradeos/types";
import { buildRetailDrawerSummary } from "@/lib/sales/retail-summary";

export type CounterSale = {
  lines: BarcodeLine[]; customerId: string | null; date: string;
  paymentType: "cash" | "credit"; discount: string; discountType: "flat" | "percent"; tax: string;
};
type HeldSale = { id: string; savedAt: string; sale: CounterSale };
type BasketTemplate = { id: string; name: string; sale: CounterSale; savedAt: string };
const money = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(value);

export function RetailPOS({ scope, sale, products, customers, total, busy, owner, scanUnit, cashReceived, focusSignal, onScan, onAdd, onUnit, onCustomer, onLine, onRemove, onSave, onCashReceived, onAdvanced, onRestore, onClear }: {
  scope: string; sale: CounterSale; products: Product[]; customers: Customer[]; total: number; busy: boolean; owner: boolean;
  scanUnit: "main" | "subunit"; cashReceived: string; focusSignal: number; onScan: (code: string) => string | null; onAdd: (id: string) => void;
  onUnit: (unit: "main" | "subunit") => void; onCustomer: (id: string) => void;
  onLine: (index: number, field: keyof BarcodeLine, value: string) => void; onRemove: (index: number) => void;
  onSave: () => void; onCashReceived: (amount: string) => void; onAdvanced: () => void; onRestore: (sale: CounterSale) => void; onClear: () => void;
}) {
  const [held, setHeld] = useState<HeldSale[]>([]);
  const [templates, setTemplates] = useState<BasketTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [storedSearch, setStoredSearch] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [focusQuantityFor, setFocusQuantityFor] = useState<number | null>(null);
  const holdLock = useRef(false);
  const storageKey = `tradeos-pos-held-v1:${scope}`;
  const templateStorageKey = `tradeos-pos-baskets-v1:${scope}`;
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
  const readTemplates = (): BasketTemplate[] => {
    const stored: unknown = JSON.parse(localStorage.getItem(templateStorageKey) ?? "[]");
    if (!Array.isArray(stored)) throw new Error("Invalid basket templates");
    return stored.filter((row): row is BasketTemplate => Boolean(row) && typeof row === "object" && typeof (row as BasketTemplate).id === "string" && typeof (row as BasketTemplate).name === "string" && !!(row as BasketTemplate).sale);
  };
  const persistTemplates = (next: BasketTemplate[]) => {
    try {
      localStorage.setItem(templateStorageKey, JSON.stringify(next));
      setTemplates(next);
      return true;
    } catch {
      setNotice("Basket templates could not be saved on this browser.");
      return false;
    }
  };
  useEffect(() => {
    try {
      const stored = readHeld();
      const savedTemplates = readTemplates();
      setHeld(stored); setTemplates(savedTemplates); setStorageReady(true);
    } catch { setNotice("Held sales could not be loaded. Browser storage must be available to hold a sale."); }
    // The component is keyed by account and business; storage is loaded once per scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => { if (!sale.lines.length) { onCashReceived(""); holdLock.current = false; } }, [sale.lines.length, onCashReceived]);
  useEffect(() => {
    if (focusQuantityFor === null) return;
    const frame = requestAnimationFrame(() => {
      const field = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-pos-quantity="${focusQuantityFor}"]`)).find(input => input.getClientRects().length > 0);
      if (field) { field.focus(); field.select(); setFocusQuantityFor(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusQuantityFor, sale.lines.length]);
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
      if (persist(latest.filter(item => item.id !== row.id))) { onRestore(saved.sale); setNotice("Sale resumed. Review its saved prices and quantities before saving."); }
    } catch { setNotice("Held sales could not be read. No sale has been changed."); }
  };
  const drawerSummary = buildRetailDrawerSummary({ total, received: cashReceived, paymentType: sale.paymentType });
  const shortCash = owner && sale.paymentType === "cash" && drawerSummary.status === "cash-short";
  const saleRows = sale.lines.map((line, index) => {
    const product = products.find(item => String(item.id) === line.product_id);
    const lineTotal = (Number(line.quantity) || 0) * (Number(line.selling_price) || 0) - (Number(line.discount) || 0);
    return { line, index, product, lineTotal, productName: product?.name ?? "Product unavailable" };
  });
  const quickCashPresets = [
    { label: "Exact", value: total },
    { label: "Round +100", value: Math.ceil(total / 100) * 100 },
    { label: "Add 500", value: total + 500 },
    { label: "Add 1000", value: total + 1000 },
  ];
  const visibleHeld = held.filter(row => {
    const query = storedSearch.trim().toLowerCase();
    if (!query) return true;
    const customerName = customers.find(c => c.id === row.sale.customerId)?.customer_name ?? "Walk-in customer";
    const productNames = row.sale.lines.map(line => products.find(p => String(p.id) === line.product_id)?.name ?? "").filter(Boolean).join(" ");
    const summary = [customerName, productNames, row.sale.paymentType, new Date(row.savedAt).toLocaleDateString(), String(row.sale.lines.reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.selling_price) || 0) - (Number(line.discount) || 0)), 0)), row.id].join(" ").toLowerCase();
    return summary.includes(query);
  });
  const saveBasket = () => {
    if (!sale.lines.length) return;
    const name = templateName.trim() || `Basket ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const existing = readTemplates();
    const next = [{ id: crypto.randomUUID(), name, sale, savedAt: new Date().toISOString() }, ...existing.filter(item => item.name !== name)].slice(0, 10);
    if (persistTemplates(next)) {
      setTemplateName("");
      setNotice(`Saved basket “${name}”. You can load it again from the basket library.`);
    }
  };
  const applyTemplate = (basket: BasketTemplate) => {
    if (sale.lines.length) return;
    onRestore(basket.sale);
    setNotice(`Loaded basket “${basket.name}”. Review lines before saving.`);
  };
  return <div className="space-y-4" data-context-help-skip>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Scan or search • Check quantity • {owner ? "Pay and save" : "Send for approval"}</p>
      <button type="button" disabled={busy} onClick={onAdvanced} className="min-h-11 rounded-lg border px-4 text-sm font-medium">Full invoice / Advanced options</button>
    </div>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div><BarcodeInput compact label="Barcode" autoFocus disabled={busy} focusSignal={focusSignal} onScan={code => { const productId = onScan(code); if (!productId) return; const lineIndex = sale.lines.findIndex(line => String(line.product_id) === productId && (line.unit_mode ?? "main") === scanUnit); setFocusQuantityFor(lineIndex >= 0 ? lineIndex : sale.lines.length); }} /></div>
      <div className="space-y-3"><label className="block text-sm font-medium">Find product</label><ProductSearchSelect key={searchKey} value="" products={products.map(p => ({ id: String(p.id), label: [p.name, p.sku, p.barcode].filter(Boolean).join(" — ") }))} onChange={id => { if (id) { setFocusQuantityFor(sale.lines.length); onAdd(id); setSearchKey(key => key + 1); } }} />
        <label className="flex items-center gap-3 text-sm">Add one<select value={scanUnit} onChange={event => onUnit(event.target.value as "main" | "subunit")} className="min-h-11 rounded border border-input bg-background px-3"><option value="subunit">Piece / sub-unit</option><option value="main">Box / main unit</option></select></label>
        <label className="block text-sm font-medium">Customer</label><ProductSearchSelect label="Customer" value={sale.customerId ?? ""} products={customers.map(c => ({ id: c.id, label: [c.customer_name, c.shop_name, c.phone].filter(Boolean).join(" — ") }))} onChange={onCustomer} />
      </div>
    </fieldset>
    <div data-pos-desktop-table className="hidden overflow-x-auto rounded-xl border bg-card sm:block"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted text-left"><tr>{["Product", "Unit", "Quantity", "Price", "Discount", "Total", ""].map((text, index) => <th key={index} className="p-3">{text}</th>)}</tr></thead>
      <tbody>{saleRows.map(({ line, index, product, lineTotal, productName }) => <tr key={index} className="border-t">
        <td className="p-3 font-medium">{productName}{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}</td>
        <td className="p-2"><select aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onChange={event => onLine(index, "unit_mode", event.target.value)} className="min-h-11 rounded border border-input bg-background px-2"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></td>
        {(["quantity", "selling_price", "discount"] as const).map(field => <td key={field} className="p-2"><input data-pos-quantity={field === "quantity" ? index : undefined} aria-label={`${field === "selling_price" ? "Price" : field} for ${productName}`} type="number" min={field === "quantity" ? "0.000001" : "0"} step="any" value={line[field]} disabled={busy} onChange={event => onLine(index, field, event.target.value)} className="min-h-11 w-24 rounded border border-input bg-background px-2 tabular-nums" /></td>)}
        <td className="p-3 font-medium tabular-nums">{money(lineTotal)}</td>
        <td className="p-2"><button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove</button></td>
      </tr>)}{!sale.lines.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</td></tr>}</tbody></table></div>
    <div data-pos-mobile-basket className="space-y-3 sm:hidden" aria-label="Basket">
      {saleRows.map(({ line, index, product, lineTotal, productName }) => <article data-pos-mobile-row key={index} className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{productName}</p>{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}</div><p className="shrink-0 font-semibold tabular-nums">{money(lineTotal)}</p></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs font-medium">Quantity<input data-pos-quantity={index} aria-label={`Quantity for ${productName}`} type="number" min="0.000001" step="any" value={line.quantity} disabled={busy} onChange={event => onLine(index, "quantity", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" /></label>
          <label className="min-w-0 text-xs font-medium">Unit<select aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onChange={event => onLine(index, "unit_mode", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></label>
          <details className="col-span-2">
            <summary className="flex min-h-11 cursor-pointer items-center rounded border border-border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Price, discount & removal</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium">Price<input aria-label={`Price for ${productName}`} type="number" min="0" step="any" value={line.selling_price} disabled={busy} onChange={event => onLine(index, "selling_price", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" /></label>
              <label className="text-xs font-medium">Discount<input aria-label={`Discount for ${productName}`} type="number" min="0" step="any" value={line.discount} disabled={busy} onChange={event => onLine(index, "discount", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" /></label>
              <button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="col-span-2 min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove product</button>
            </div>
          </details>
        </div>
      </article>)}
      {!sale.lines.length && <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</p>}
    </div>
    <div data-pos-payment-bar className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-4 shadow-lg sm:flex-row sm:items-end sm:justify-between">
      <div><span className="text-sm text-muted-foreground">Total payable · {sale.paymentType}</span><div className="text-3xl font-bold tabular-nums">{money(total)}</div>{(Number(sale.discount) > 0 || Number(sale.tax) > 0) && <small>Includes invoice discount / tax from advanced options.</small>}</div>
      {owner && sale.paymentType === "cash" && <div className="sm:min-w-52"><label className="block text-sm">Cash received<input aria-label="Cash received" type="number" min="0" step="0.01" value={cashReceived} placeholder={String(total)} onChange={event => onCashReceived(event.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded border border-input bg-background px-3 tabular-nums sm:w-40" /></label><div className="mt-2 flex flex-wrap gap-2">{quickCashPresets.map(preset => <button key={preset.label} type="button" className="min-h-11 rounded border px-2 text-xs" onClick={() => onCashReceived(String(preset.value))}>{preset.label}</button>)}</div>{drawerSummary.status === "cash-short" ? <p className="mt-2 text-sm text-destructive">Cash short by <span className="tabular-nums">{money(drawerSummary.shortfall)}</span>.</p> : <p className="mt-2 text-sm">Change due: <span className="tabular-nums">{money(drawerSummary.change)}</span></p>}</div>}
      <div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={busy || !sale.lines.length || !storageReady} onClick={hold} className="min-h-12 rounded-lg border border-primary px-5 font-semibold disabled:opacity-40">Hold sale</button><button data-entry-add type="button" disabled={busy || !sale.lines.length || !sale.customerId || shortCash} onClick={onSave} className="min-h-12 w-full rounded-lg bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-40 sm:w-auto">{busy ? "Saving…" : owner ? sale.paymentType === "credit" ? "Save credit sale" : "Pay & Save" : "Send for approval"}</button></div>
    </div>
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Saved retail baskets ({templates.length})</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="Basket name" className="min-h-11 rounded border border-input bg-background px-3" />
        <button type="button" disabled={busy || !sale.lines.length} onClick={saveBasket} className="min-h-11 rounded border px-4 text-sm">Save current basket</button>
      </div>
      <div className="mt-3 space-y-2">
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">No saved retail baskets yet.</p> : templates.map(template => <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-2"><div><p className="font-medium">{template.name}</p><p className="text-xs text-muted-foreground">{new Date(template.savedAt).toLocaleString()} · {template.sale.lines.length} lines</p></div><button type="button" disabled={busy || sale.lines.length > 0} onClick={() => applyTemplate(template)} className="min-h-11 rounded border border-primary px-4 text-sm text-primary disabled:opacity-40">Load</button></div>)}
      </div>
    </details>
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Held sales ({held.length})</summary><p className="my-3 text-sm text-muted-foreground">Saved only on this browser for your account and business. Hold or finish the current sale before resuming another. Stock is checked again when saving.</p>
      <label className="mb-3 block text-sm">Search held sales<input type="search" value={storedSearch} onChange={event => setStoredSearch(event.target.value)} placeholder="Customer, product, amount, date" className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3" /></label>
      {visibleHeld.length === 0 ? <p className="text-sm text-muted-foreground">No held sales match this filter.</p> : visibleHeld.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><span>{customers.find(c => c.id === row.sale.customerId)?.customer_name ?? "Customer"} · {row.sale.lines.length} lines · {new Date(row.savedAt).toLocaleString()} · {money(row.sale.lines.reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.selling_price) || 0) - (Number(line.discount) || 0)), 0))}</span><button type="button" disabled={busy || sale.lines.length > 0} onClick={() => resume(row)} className="min-h-11 rounded border border-primary px-4 text-primary disabled:opacity-40">Resume</button></div>)}
    </details>
  </div>;
}
