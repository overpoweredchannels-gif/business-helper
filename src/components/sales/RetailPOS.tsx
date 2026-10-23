"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarcodeInput } from "@/components/invoices/BarcodeInput";
import { ProductSearchSelect } from "@/components/invoices/ProductSearchSelect";
import { buildCustomerSuggestionData } from "@/components/search/suggestion-items";
import { type BarcodeLine } from "@/lib/invoices/barcode";
import { hasExactBarcodeMatch, isBarcodeShaped } from "@/lib/invoices/scan-submit";
import type { Product, Customer } from "@/lib/tradeos/types";
import type { SearchRankFields } from "@/lib/products/search-rank";
import { validateSaleDraft } from "@/lib/sales/sale-draft";
import { loadHeldSales, parseHeldSales, type HeldSale } from "@/lib/sales/held-sales";
import { DEFAULT_DRAWER_SETTINGS, readDrawerSettings, writeDrawerSettings, type DrawerSettings } from "@/lib/print/drawer-settings";
import { hasDrawerSerial, hasDrawerUsb } from "@/lib/print/drawer-transport";
import { isNoSaleReasonValid, NO_SALE_REASON_CODES, type NoSaleReasonCode } from "@/lib/sales/drawer-gate";
import type { MessageKey } from "@/lib/regional/messages";
import { useRegional } from "@/components/regional/RegionalProvider";
import { formatBooksMoney } from "@/lib/tradeos/formatters";

export type CounterSale = {
  lines: BarcodeLine[]; customerId: string | null; date: string;
  paymentType: "cash" | "card" | "credit"; discount: string; discountType: "flat" | "percent"; tax: string;
};
type BasketTemplate = { id: string; name: string; sale: CounterSale; savedAt: string };

const NO_SALE_REASON_KEYS: Record<NoSaleReasonCode, MessageKey> = {
  "making-change": "drawer.reasonMakingChange",
  "counting-drawer": "drawer.reasonCounting",
  "pay-in": "drawer.reasonPayIn",
  "pay-out": "drawer.reasonPayOut",
  "other": "drawer.reasonOther",
};

export function RetailPOS({ scope, sale, products, customers, busy, owner, staffDirectSale = false, walkInState = "idle", onRetryWalkIn, scanUnit, cashReceived, focusSignal, onScan, onAdd, onUnit, onCustomer, onLine, onRemove, onSave, onCashReceived, onDiscount, onDiscountType, onAdvanced, onRestore, onClear, onPaymentType, drawerNoSaleAllowed = false, onDrawerNoSale, onDrawerTestOpen, onDrawerConnect }: {
  scope: string; sale: CounterSale; products: Product[]; customers: Customer[]; busy: boolean; owner: boolean;
  /** Staff sale under the owner's "direct" setting: saves like an owner
   * sale instead of going to the approval pipeline, so the primary action
   * is labelled Pay & Save. Owner/admin sales never need this flag. */
  staffDirectSale?: boolean;
  /** Walk-in customer preparation state from the parent. When it failed,
   * the payment bar explains the blocked save and offers a retry instead
   * of leaving Pay & Save silently disabled. */
  walkInState?: "idle" | "preparing" | "failed";
  onRetryWalkIn?: () => void;
  scanUnit: "main" | "subunit"; cashReceived: string; focusSignal: number; onScan: (code: string, options?: { reportNotFound?: boolean }) => string | null; onAdd: (id: string) => void;
  onUnit: (unit: "main" | "subunit") => void; onCustomer: (id: string) => void;
  onLine: (index: number, field: keyof BarcodeLine, value: string) => void; onRemove: (index: number) => void;
  onSave: () => void; onCashReceived: (amount: string) => void;
  onDiscount: (amount: string) => void; onDiscountType: (type: "flat" | "percent") => void;
  onAdvanced: () => void; onRestore: (sale: CounterSale) => void; onClear: () => void;
  /** Tender switch for the payment bar: Cash / Card. Credit stays
   * selectable in the full invoice form and is shown as the active
   * tender here when it is already chosen. */
  onPaymentType: (type: "cash" | "card" | "credit") => void;
  /** Cash drawer: whether this user may open the drawer outside a sale
   * (owner/admin always; staff only with the owner's setting — the
   * parent computes the gate). The Open drawer button renders only
   * when onDrawerNoSale is provided. */
  drawerNoSaleAllowed?: boolean;
  onDrawerNoSale?: (reason: { reasonCode: NoSaleReasonCode; reasonNote: string | null }) => void;
  /** Test Open from the till's drawer settings (setup diagnostics;
   * recorded as a test event, never counted as a No Sale). */
  onDrawerTestOpen?: () => void;
  /** Pair the direct-route printer (user gesture). Resolves false when
   * pairing was cancelled or is unavailable on this browser. */
  onDrawerConnect?: (route: "serial" | "usb") => Promise<boolean>;
}) {
  const [held, setHeld] = useState<HeldSale[]>([]);
  const [templates, setTemplates] = useState<BasketTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [storedSearch, setStoredSearch] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [notice, setNotice] = useState("");
  // Cash drawer, per till: settings persist in browser storage keyed by
  // scope (drawer-settings seam); the parent reads the same store when
  // a cash event completes, so this state only drives the settings UI.
  const [drawerSettings, setDrawerSettings] = useState<DrawerSettings>(DEFAULT_DRAWER_SETTINGS);
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState<NoSaleReasonCode>("making-change");
  const [noSaleNote, setNoSaleNote] = useState("");
  const [drawerDirectAvailable, setDrawerDirectAvailable] = useState(false);
  const [drawerConnectState, setDrawerConnectState] = useState<"idle" | "connected" | "failed">("idle");
  const [searchKey, setSearchKey] = useState(0);
  const [focusQuantityFor, setFocusQuantityFor] = useState<number | null>(null);
  // Product selector options + rank fields, built in one pass and memoized so
  // the selector neither rebuilds nor re-ranks on parent renders.
  const productOptions = useMemo(
    () => products.map((p) => ({ id: String(p.id), label: [p.name, p.sku, p.barcode].filter(Boolean).join(" — ") })),
    [products]
  );
  const productRankFields = useMemo(() => {
    const map = new Map<string, SearchRankFields>();
    for (const p of products) map.set(String(p.id), { name: p.name, sku: p.sku, barcode: p.barcode });
    return map;
  }, [products]);
  // Customer picker rank fields: shop name ranks as the code field, phone
  // second, contact person / city lowest — same shared contract as products.
  const customerRankFields = useMemo(
    () => buildCustomerSuggestionData(customers).rankFields,
    [customers],
  );
  // Memoized: the customer option array must keep its identity across
  // unrelated parent rerenders, or the picker's "Show more" expansion
  // collapses when the parent re-renders.
  const customerOptions = useMemo(
    () => customers.map((c) => ({ id: c.id, label: [c.customer_name, c.shop_name, c.phone].filter(Boolean).join(" — ") })),
    [customers],
  );
  const { t } = useRegional();
  useEffect(() => {
    try { setDrawerSettings(readDrawerSettings(localStorage, scope)); } catch { setDrawerSettings(DEFAULT_DRAWER_SETTINGS); }
    // Loaded once per scope, like the held-sales store above.
  }, [scope]);
  useEffect(() => {
    setDrawerDirectAvailable(drawerSettings.route === "serial" ? hasDrawerSerial() : hasDrawerUsb());
    setDrawerConnectState("idle");
  }, [drawerSettings.route]);
  const updateDrawerSettings = (next: DrawerSettings) => {
    setDrawerSettings(next);
    try { writeDrawerSettings(localStorage, scope, next); } catch { /* in-session settings still apply */ }
  };
  const openNoSaleDialog = () => {
    if (!drawerNoSaleAllowed) { setNotice(t("drawer.notAllowed")); return; }
    setNoSaleReason("making-change");
    setNoSaleNote("");
    setNoSaleOpen(true);
  };
  const confirmNoSale = () => {
    if (!isNoSaleReasonValid({ reasonCode: noSaleReason, reasonNote: noSaleNote })) return;
    onDrawerNoSale?.({ reasonCode: noSaleReason, reasonNote: noSaleNote.trim() || null });
    setNoSaleOpen(false);
  };
  const connectDrawer = async () => {
    if (!onDrawerConnect || drawerSettings.route === "print") return;
    setDrawerConnectState("idle");
    const ok = await onDrawerConnect(drawerSettings.route);
    setDrawerConnectState(ok ? "connected" : "failed");
  };
  const holdLock = useRef(false);
  const storageKey = `tradeos-pos-held-v1:${scope}`;
  const templateStorageKey = `tradeos-pos-baskets-v1:${scope}`;
  // Strict read for the hold/resume write paths: corruption there must
  // refuse, never guess. The mount load below uses the recovering loader.
  const readHeld = (): HeldSale[] => parseHeldSales(localStorage.getItem(storageKey));
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
    // A corrupt held-sales value must not brick Hold for this browser
    // profile: the loader quarantines it under a backup key and starts
    // from an empty list. Whatever happens — including storage being
    // unavailable at all — storageReady is set, so the Hold button is
    // never silently disabled forever; a genuine storage failure then
    // surfaces through the hold action's own notice.
    let heldFailed = false;
    try {
      const loaded = loadHeldSales(localStorage, storageKey);
      setHeld(loaded.sales);
      heldFailed = loaded.quarantined;
    } catch { heldFailed = true; setHeld([]); }
    try { setTemplates(readTemplates()); } catch { setTemplates([]); }
    if (heldFailed) setNotice("Held sales could not be loaded. Browser storage must be available to hold a sale.");
    setStorageReady(true);
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
  // One scan path for every way a barcode can arrive (barcode box, global
  // scanner capture, find-product Enter): the parent adds the line through
  // the shared scan choke point, then focus moves to that line's quantity
  // field. Scan adds merge on the product alone, so the line lookup is by
  // product only — the line a scan landed on may carry a different unit
  // mode than the ambient scanUnit.
  const handleScannedCode = (code: string, options?: { reportNotFound?: boolean }): boolean => {
    const productId = onScan(code, options);
    if (!productId) return false;
    const lineIndex = sale.lines.findIndex(line => String(line.product_id) === productId);
    setFocusQuantityFor(lineIndex >= 0 ? lineIndex : sale.lines.length);
    return true;
  };
  // Scanner-wedge capture. A wedge scanner "types" the code with inhumanly
  // even, tiny gaps and finishes with Enter. When focus sits somewhere that
  // does not consume characters as free text (bare page, a button, a
  // checkbox, or a quantity field), a rapid burst ending in Enter is a
  // scan: route it through the scan handler instead of letting the digits
  // land in the focused field or the Enter activate the focused button.
  // Once a burst is under way its characters are consumed here (never typed
  // into a quantity field); its first character may still land, so a
  // quantity field's value is snapshotted and restored when the scan
  // completes. The listener runs in the capture phase so a detected scan
  // Enter is consumed before the section's entry-navigation handler can
  // treat it as "advance / run the primary action". Human-speed typing
  // never builds a burst (any gap >= 50ms resets it) and is left completely
  // untouched, as are text inputs, textareas and selects other than the
  // quantity fields.
  const scanBurst = useRef("");
  const scanLastKeyAt = useRef(0);
  const scanQuantitySnapshot = useRef<{ index: number; value: string } | null>(null);
  const scanLatest = useRef({ busy, onLine, handleScannedCode });
  useEffect(() => { scanLatest.current = { busy, onLine, handleScannedCode }; });
  useEffect(() => {
    const GAP_MS = 50;
    const resetBurst = () => { scanBurst.current = ""; scanQuantitySnapshot.current = null; };
    const onKeyDown = (event: KeyboardEvent) => {
      const latest = scanLatest.current;
      const dialogOpen = Array.from(document.querySelectorAll('[role="dialog"]')).some(el => el.getClientRects().length > 0);
      if (latest.busy || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || dialogOpen) { resetBurst(); return; }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const quantityIndex = target instanceof HTMLInputElement ? target.dataset.posQuantity : undefined;
      const capturable = target !== null && (
        target === document.body ||
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLInputElement && (target.type === "checkbox" || quantityIndex !== undefined))
      );
      if (!capturable) { resetBurst(); return; }
      const now = Date.now();
      if (event.key === "Enter") {
        const code = scanBurst.current;
        const snapshot = scanQuantitySnapshot.current;
        resetBurst();
        // Any Enter terminating a >= 4-char burst belongs to the scan path,
        // however long the scanner paused before sending it: some wedges
        // delay the terminating Enter past the inter-key gap, and letting
        // it through used to hand it to entry navigation, which can run
        // the primary action (Pay & Save) mid-scan. A surviving burst is
        // rapid by construction — a slow keystroke resets it below — so
        // the final gap no longer decides.
        if (code.length >= 4) {
          event.preventDefault();
          event.stopPropagation();
          // Restore the quantity value the burst typed over, then add the
          // scanned line through the normal scan path.
          if (snapshot) latest.onLine(snapshot.index, "quantity", snapshot.value);
          latest.handleScannedCode(code);
        }
        return;
      }
      if (event.key === "Shift") return;
      if (event.key.length !== 1) { resetBurst(); return; }
      if (scanBurst.current && now - scanLastKeyAt.current >= GAP_MS) resetBurst();
      if (!scanBurst.current && quantityIndex !== undefined && target instanceof HTMLInputElement) {
        scanQuantitySnapshot.current = { index: Number(quantityIndex), value: target.value };
      }
      if (scanBurst.current) {
        // A burst is already in progress (this character arrived within
        // the gap of the previous one): it is a captured scan character,
        // so consume it here instead of letting it type into the focused
        // quantity field and corrupt the quantity keystroke by keystroke.
        // Only the burst's first character can still land — at that point
        // it is indistinguishable from human typing — and the snapshot
        // above restores the field when the scan completes.
        event.preventDefault();
        event.stopPropagation();
      }
      scanBurst.current += event.key;
      scanLastKeyAt.current = now;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
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
  const draftResult = validateSaleDraft({
    lines: sale.lines,
    invoiceDiscount: sale.discount,
    invoiceDiscountType: sale.discountType,
    taxRate: sale.tax,
    paymentType: sale.paymentType,
    cashReceived,
    validateCash: owner,
    allowInvoiceAdjustments: owner,
  });
  const total = draftResult.amounts?.total ?? null;
  const fieldIssue = (field: "quantity" | "selling_price" | "discount" | "bonus", lineIndex: number) => draftResult.issues.find(issue => issue.field === field && issue.lineIndex === lineIndex)?.message;
  const bonusIssue = (lineIndex: number) => draftResult.issues.find(issue => issue.field === "bonus" && issue.lineIndex === lineIndex)?.message;
  const getSaleTotal = (draft: CounterSale) => validateSaleDraft({
    lines: draft.lines,
    invoiceDiscount: draft.discount,
    invoiceDiscountType: draft.discountType,
    taxRate: draft.tax,
    paymentType: draft.paymentType,
    allowInvoiceAdjustments: true,
  }).amounts?.total ?? null;
  const saleRows = sale.lines.map((line, index) => {
    const product = products.find(item => String(item.id) === line.product_id);
    const lineTotal = draftResult.lineTotals[index];
    return { line, index, product, lineTotal, productName: product?.name ?? "Product unavailable" };
  });
  const quickCashPresets = total === null ? [] : [
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
    const summary = [customerName, productNames, row.sale.paymentType, new Date(row.savedAt).toLocaleDateString(), getSaleTotal(row.sale) === null ? "unavailable" : String(getSaleTotal(row.sale)), row.id].join(" ").toLowerCase();
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
  // Why Pay & Save is unavailable, when the reason is not already printed
  // by the draft issues above: a failed or in-flight walk-in preparation
  // used to leave the button silently disabled (its customerId never
  // arrives), and an empty basket gave no hint at all. Draft-validation
  // blocks keep their specific messages and get no generic hint.
  const saveDisabled = busy || !sale.lines.length || !sale.customerId || !draftResult.valid;
  const saveHint = !saveDisabled ? null
    : walkInState === "failed" ? t("pos.saveBlockedWalkInFailed")
    : walkInState === "preparing" ? t("pos.saveBlockedWalkInPreparing")
    : !sale.lines.length ? t("pos.saveBlockedEmptyBasket")
    : !sale.customerId ? t("pos.saveBlockedNoCustomer")
    : null;
  return <div className="space-y-4" data-context-help-skip>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Scan or search • Check quantity • {owner || staffDirectSale ? "Pay and save" : "Send for approval"}</p>
      <button type="button" disabled={busy} onClick={onAdvanced} className="min-h-11 rounded-lg border px-4 text-sm font-medium">Full invoice / Advanced options</button>
      {onDrawerNoSale && <button type="button" disabled={busy} onClick={openNoSaleDialog} className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-40">{t("drawer.openDrawer")}</button>}
    </div>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div><BarcodeInput compact label="Barcode" autoFocus disabled={busy} focusSignal={focusSignal} onScan={handleScannedCode} canAutoSubmit={code => hasExactBarcodeMatch(products, code)} /></div>
      <div className="space-y-3"><label className="block text-sm font-medium">Find product</label><ProductSearchSelect key={searchKey} value="" products={productOptions} rankedFields={productRankFields} onBarcodeEnter={text => {
        // Every Enter text is offered to the shared scan choke point
        // first: an exact saved barcode adds through the scan path instead
        // of needing a dropdown pick. Plain search text reports no error
        // and returns false, keeping the normal suggestion behavior;
        // barcode-shaped text that matches nothing reports the not-found
        // error there, and ProductSearchSelect blocks its fuzzy fallback
        // so a near-match stranger is never added instead.
        return handleScannedCode(text, { reportNotFound: isBarcodeShaped(text) });
      }} onChange={id => { if (id) { setFocusQuantityFor(sale.lines.length); onAdd(id); setSearchKey(key => key + 1); } }} />
        <label className="flex items-center gap-3 text-sm">Add one<select value={scanUnit} onChange={event => onUnit(event.target.value as "main" | "subunit")} className="min-h-11 rounded border border-input bg-background px-3"><option value="subunit">Piece / sub-unit</option><option value="main">Box / main unit</option></select></label>
        <label className="block text-sm font-medium">Customer</label><ProductSearchSelect label="Customer" value={sale.customerId ?? ""} rankedFields={customerRankFields} products={customerOptions} onChange={onCustomer} />
      </div>
    </fieldset>
    <div data-pos-desktop-table className="hidden overflow-x-auto rounded-xl border bg-card sm:block"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted text-left"><tr>{["Product", "Unit", "Quantity", "Price", "Discount", "Total", ""].map((text, index) => <th key={index} className="p-3">{text}</th>)}</tr></thead>
      <tbody>{saleRows.map(({ line, index, product, lineTotal, productName }) => <tr key={index} className="border-t">
        <td className="p-3 font-medium">{productName}{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}{bonusIssue(index) && <small className="block text-destructive" role="alert">{bonusIssue(index)}</small>}</td>
        <td className="p-2"><select aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onChange={event => onLine(index, "unit_mode", event.target.value)} className="min-h-11 rounded border border-input bg-background px-2"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></td>
        {(["quantity", "selling_price", "discount"] as const).map(field => <td key={field} className="p-2"><input data-pos-quantity={field === "quantity" ? index : undefined} aria-label={`${field === "selling_price" ? "Price" : field} for ${productName}`} type="text" inputMode="decimal" value={line[field]} disabled={busy} onChange={event => onLine(index, field, event.target.value)} className="min-h-11 w-24 rounded border border-input bg-background px-2 tabular-nums" />{fieldIssue(field, index) && <span className="block max-w-32 text-xs text-destructive" role="alert">{fieldIssue(field, index)}</span>}</td>)}
        <td className="p-3 font-medium tabular-nums">{lineTotal === null ? <span className="text-muted-foreground">Unavailable</span> : formatBooksMoney(lineTotal)}</td>
        <td className="p-2"><button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove</button></td>
      </tr>)}{!sale.lines.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</td></tr>}</tbody></table></div>
    <div data-pos-mobile-basket className="space-y-3 sm:hidden" aria-label="Basket">
      {saleRows.map(({ line, index, product, lineTotal, productName }) => <article data-pos-mobile-row key={index} className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{productName}</p>{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}{bonusIssue(index) && <small className="block text-destructive" role="alert">{bonusIssue(index)}</small>}</div><p className="shrink-0 font-semibold tabular-nums">{lineTotal === null ? <span className="text-muted-foreground">Unavailable</span> : formatBooksMoney(lineTotal)}</p></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs font-medium">Quantity<input data-pos-quantity={index} aria-label={`Quantity for ${productName}`} type="text" inputMode="decimal" value={line.quantity} disabled={busy} onChange={event => onLine(index, "quantity", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" />{fieldIssue("quantity", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("quantity", index)}</span>}</label>
          <label className="min-w-0 text-xs font-medium">Unit<select aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onChange={event => onLine(index, "unit_mode", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></label>
          <details className="col-span-2">
            <summary className="flex min-h-11 cursor-pointer items-center rounded border border-border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Price, discount & removal</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium">Price<input aria-label={`Price for ${productName}`} type="text" inputMode="decimal" value={line.selling_price} disabled={busy} onChange={event => onLine(index, "selling_price", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" />{fieldIssue("selling_price", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("selling_price", index)}</span>}</label>
              <label className="text-xs font-medium">Discount<input aria-label={`Discount for ${productName}`} type="text" inputMode="decimal" value={line.discount} disabled={busy} onChange={event => onLine(index, "discount", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" />{fieldIssue("discount", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("discount", index)}</span>}</label>
              <button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="col-span-2 min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove product</button>
            </div>
          </details>
        </div>
      </article>)}
      {!sale.lines.length && <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</p>}
    </div>
    {owner && <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="pos-invoice-discount" className="text-sm font-medium">Sale discount</label>
        <select aria-label="Sale discount type" value={sale.discountType} disabled={busy} onChange={event => onDiscountType(event.target.value as "flat" | "percent")} className="min-h-11 rounded border border-input bg-background px-3 text-base">
          <option value="flat">Amount</option><option value="percent">Percentage (%)</option>
        </select>
        <input id="pos-invoice-discount" aria-label={sale.discountType === "percent" ? "Sale discount percentage" : "Sale discount amount"} type="text" inputMode="decimal" value={sale.discount} disabled={busy} onChange={event => onDiscount(event.target.value)} placeholder={sale.discountType === "percent" ? "0–100" : "0.00"} className="min-h-11 w-32 rounded border border-input bg-background px-3 text-base tabular-nums" />
      </div>
      {draftResult.amounts && Number(sale.discount) > 0 && <p className="mt-2 text-sm tabular-nums">Discount before tax: {formatBooksMoney(draftResult.amounts.invoiceDiscount)}</p>}
    </div>}
    {draftResult.issues.filter(issue => issue.field === "invoice_discount").map(issue => <p key={issue.message} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{issue.message}</p>)}
    <div data-pos-payment-bar className="sticky bottom-4 z-20 flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-4 shadow-lg">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" role="group" aria-label={t("sell.paymentType")}>
        {(["cash", "card"] as const).map(type => <button key={type} type="button" disabled={busy} aria-pressed={sale.paymentType === type} onClick={() => onPaymentType(type)} className={`min-h-12 flex-1 rounded-lg px-5 font-semibold disabled:opacity-40 ${sale.paymentType === type ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}>{type === "cash" ? t("sell.paymentCash") : t("sell.paymentCard")}</button>)}
        {sale.paymentType === "credit" && <span className="text-sm font-medium text-muted-foreground">{t("sell.paymentCredit")}</span>}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><span className="text-sm text-muted-foreground">Total payable · {sale.paymentType === "card" ? t("sell.paymentCard") : sale.paymentType === "credit" ? t("sell.paymentCredit") : t("sell.paymentCash")}</span><div className="text-3xl font-bold tabular-nums">{total === null ? <span className="text-lg text-muted-foreground">Unavailable</span> : formatBooksMoney(total)}</div>{total === null && <p className="mt-1 text-sm text-destructive">Complete or correct the highlighted sale fields to calculate the total.</p>}{draftResult.issues.filter(issue => issue.lineIndex === undefined && issue.field !== "cash_received" && issue.field !== "invoice_discount").map(issue => <p key={issue.field + issue.message} className="mt-1 text-sm text-destructive" role="alert">{issue.message}</p>)}{Number(sale.tax) > 0 && <small>Includes tax from advanced options.</small>}</div>
      {owner && sale.paymentType === "cash" && <div className="sm:min-w-52"><label className="block text-sm">Cash received<input aria-label="Cash received" type="text" inputMode="decimal" value={cashReceived} placeholder={total === null ? "Sale total unavailable" : String(total)} onChange={event => onCashReceived(event.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded border border-input bg-background px-3 tabular-nums sm:w-40" /></label><div className="mt-2 flex flex-wrap gap-2">{quickCashPresets.map(preset => <button key={preset.label} type="button" disabled={busy} className="min-h-11 rounded border px-2 text-xs disabled:opacity-40" onClick={() => onCashReceived(String(preset.value))}>{preset.label}</button>)}</div>{draftResult.issues.filter(issue => issue.field === "cash_received").map(issue => <p key={issue.message} className="mt-2 text-sm text-destructive" role="alert">{draftResult.cashSummary?.status === "cash-short" ? <>Cash short by <span className="tabular-nums">{formatBooksMoney(draftResult.cashSummary.shortfall)}</span>.</> : issue.message}</p>)}{!draftResult.issues.some(issue => issue.field === "cash_received") && (cashReceived.trim() === "" ? <p className="mt-2 text-sm text-muted-foreground">Leave blank to use the exact sale total.</p> : draftResult.cashSummary ? <p className="mt-2 text-sm">Change due: <span className="tabular-nums">{formatBooksMoney(draftResult.cashSummary.change)}</span></p> : <p className="mt-2 text-sm text-muted-foreground">Cash summary unavailable until the sale total is valid.</p>)}</div>}
      <div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={busy || !sale.lines.length || !storageReady} onClick={hold} className="min-h-12 rounded-lg border border-primary px-5 font-semibold disabled:opacity-40">Hold sale</button><button data-entry-add type="button" disabled={busy || !sale.lines.length || !sale.customerId || !draftResult.valid} onClick={onSave} className="min-h-12 w-full rounded-lg bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-40 sm:w-auto">{busy ? "Saving…" : owner || staffDirectSale ? sale.paymentType === "credit" ? "Save credit sale" : "Pay & Save" : "Send for approval"}</button></div>
      </div>
      {saveHint && <p data-pos-save-hint role="status" className="text-sm text-muted-foreground">{saveHint}{walkInState === "failed" && onRetryWalkIn && <button type="button" onClick={onRetryWalkIn} className="ml-3 min-h-11 rounded border border-input px-3 font-medium text-foreground">{t("pos.retry")}</button>}</p>}
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
      {visibleHeld.length === 0 ? <p className="text-sm text-muted-foreground">No held sales match this filter.</p> : visibleHeld.map(row => { const heldTotal = getSaleTotal(row.sale); return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><span>{customers.find(c => c.id === row.sale.customerId)?.customer_name ?? "Customer"} · {row.sale.lines.length} lines · {new Date(row.savedAt).toLocaleString()} · {heldTotal === null ? "Total unavailable" : formatBooksMoney(heldTotal)}</span><button type="button" disabled={busy || sale.lines.length > 0} onClick={() => resume(row)} className="min-h-11 rounded border border-primary px-4 text-primary disabled:opacity-40">Resume</button></div>; })}
    </details>
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">{t("drawer.settingsTitle")}</summary>
      <div className="mt-3 space-y-3">
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={drawerSettings.enabled} onChange={event => updateDrawerSettings({ ...drawerSettings, enabled: event.target.checked })} className="h-5 w-5 shrink-0" />{t("drawer.enabled")}</label>
        <label className="block text-sm font-medium">{t("drawer.routeLabel")}<select value={drawerSettings.route} onChange={event => updateDrawerSettings({ ...drawerSettings, route: event.target.value as DrawerSettings["route"] })} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base"><option value="print">{t("drawer.routePrint")}</option><option value="serial">{t("drawer.routeSerial")}</option><option value="usb">{t("drawer.routeUsb")}</option></select></label>
        <label className="block text-sm font-medium">{t("drawer.pinLabel")}<select value={drawerSettings.pin} onChange={event => updateDrawerSettings({ ...drawerSettings, pin: event.target.value === "5" ? 5 : 2 })} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base"><option value="2">{t("drawer.pinOption").replace("{pin}", "2")}</option><option value="5">{t("drawer.pinOption").replace("{pin}", "5")}</option></select></label>
        {drawerSettings.route !== "print" && (drawerDirectAvailable
          ? <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void connectDrawer()} className="min-h-11 rounded border px-4 text-sm font-medium">{t("drawer.connectPrinter")}</button>{drawerConnectState === "connected" && <span role="status" className="text-sm">{t("drawer.connected")}</span>}{drawerConnectState === "failed" && <span role="alert" className="text-sm text-destructive">{t("drawer.connectFailed")}</span>}</div>
          : <p className="text-sm text-muted-foreground">{t("drawer.directUnavailable")}</p>)}
        {onDrawerTestOpen && <button type="button" disabled={!drawerSettings.enabled} onClick={onDrawerTestOpen} className="min-h-11 rounded border border-primary px-4 text-sm font-medium text-primary disabled:opacity-40">{t("drawer.testOpen")}</button>}
      </div>
    </details>
    {noSaleOpen && createPortal(
      <div data-context-help-skip role="dialog" aria-modal="true" aria-label={t("drawer.noSaleTitle")} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
        <div className="mx-auto max-w-md space-y-4 rounded-xl bg-card p-4 shadow-xl">
          <h3 className="font-semibold">{t("drawer.noSaleTitle")}</h3>
          <label className="block text-sm font-medium">{t("drawer.reasonLabel")}<select value={noSaleReason} onChange={event => setNoSaleReason(event.target.value as NoSaleReasonCode)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base">{NO_SALE_REASON_CODES.map(code => <option key={code} value={code}>{t(NO_SALE_REASON_KEYS[code])}</option>)}</select></label>
          <label className="block text-sm font-medium">{t("drawer.reasonNoteLabel")}<input type="text" value={noSaleNote} onChange={event => setNoSaleNote(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base" /></label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setNoSaleOpen(false)} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("common.cancel")}</button>
            <button type="button" disabled={!isNoSaleReasonValid({ reasonCode: noSaleReason, reasonNote: noSaleNote })} onClick={confirmNoSale} className="min-h-11 min-w-11 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{t("drawer.confirmOpen")}</button>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </div>;
}
