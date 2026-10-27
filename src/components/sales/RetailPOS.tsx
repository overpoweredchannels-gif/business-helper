"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { BarcodeInput } from "@/components/invoices/BarcodeInput";
import { useScannerCapture } from "@/components/invoices/scanner-capture";
import { ProductSearchSelect } from "@/components/invoices/ProductSearchSelect";
import { buildCustomerSuggestionData } from "@/components/search/suggestion-items";
import { type BarcodeLine } from "@/lib/invoices/barcode";
import { hasExactBarcodeMatch, isBarcodeShaped } from "@/lib/invoices/scan-submit";
import type { Product, Customer } from "@/lib/tradeos/types";
import type { SearchRankFields } from "@/lib/products/search-rank";
import { validateSaleDraft } from "@/lib/sales/sale-draft";
import { heldSaleCurrencyStatus, loadHeldSales, parseHeldSales, stampLegacyHeldSales, type HeldSale } from "@/lib/sales/held-sales";
import { basketTemplateCurrencyStatus, parseBasketTemplates, stampLegacyBasketTemplates, type BasketTemplate } from "@/lib/sales/basket-templates";
import { DEFAULT_DRAWER_SETTINGS, readDrawerSettings, writeDrawerSettings, type DrawerSettings } from "@/lib/print/drawer-settings";
import { hasDrawerSerial, hasDrawerUsb } from "@/lib/print/drawer-transport";
import { isNoSaleReasonValid, NO_SALE_REASON_CODES, type NoSaleReasonCode } from "@/lib/sales/drawer-gate";
import type { MessageKey } from "@/lib/regional/messages";
import { useRegional } from "@/components/regional/RegionalProvider";
import { initKeyboardModality, wasLastInputKeyboard } from "@/lib/keyboard-modality";
import { formatBooksMoney, getActiveBooksCurrency } from "@/lib/tradeos/formatters";
import { hasSubunit, subunitPriceFromMain } from "@/lib/tradeos/units";

export type CounterSale = {
  lines: BarcodeLine[]; customerId: string | null; date: string;
  paymentType: "cash" | "card" | "credit"; discount: string; discountType: "flat" | "percent"; tax: string;
};


const NO_SALE_REASON_KEYS: Record<NoSaleReasonCode, MessageKey> = {
  "making-change": "drawer.reasonMakingChange",
  "counting-drawer": "drawer.reasonCounting",
  "pay-in": "drawer.reasonPayIn",
  "pay-out": "drawer.reasonPayOut",
  "other": "drawer.reasonOther",
};

export function RetailPOS({ scope, sale, products, customers, busy, owner, productNameFallback, staffDirectSale = false, walkInState = "idle", onRetryWalkIn, scanUnit, cashReceived, focusSignal, clearSignal = 0, onScan, onAdd, onUnit, onCustomer, onLine, onRemove, onSave, onCashReceived, onDiscount, onDiscountType, onAdvanced, onRestore, onClear, onPaymentType, drawerNoSaleAllowed = false, onDrawerNoSale, onDrawerTestOpen, onDrawerConnect }: {
  scope: string; sale: CounterSale; products: Product[]; customers: Customer[]; busy: boolean; owner: boolean;
  /** Names of products scanned/added while the products list was stale:
   * a line whose product is missing from `products` shows its scanned
   * name instead of "Product unavailable". */
  productNameFallback?: Record<string, string>;
  /** Staff sale under the owner's "direct" setting: saves like an owner
   * sale instead of going to the approval pipeline, so the primary action
   * is labelled Pay & Save. Owner/admin sales never need this flag. */
  staffDirectSale?: boolean;
  /** Walk-in customer preparation state from the parent. When it failed,
   * the payment bar explains the blocked save and offers a retry instead
   * of leaving Pay & Save silently disabled. */
  walkInState?: "idle" | "preparing" | "failed";
  onRetryWalkIn?: () => void;
  scanUnit: "main" | "subunit"; cashReceived: string; focusSignal: number; /** Bumped by the parent when a receipt closes, so the barcode box erases for the next sale. */
  clearSignal?: number; onScan: (code: string, options?: { reportNotFound?: boolean }) => string | null; onAdd: (id: string) => void;
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
  // Barcode auto-focus must survive the walk-in preparation: the barcode
  // box mounts disabled while the walk-in customer is being prepared, so
  // the mount-time autoFocus can never land, and nothing refocused it
  // afterwards — the cashier had to click Barcode before scanning. When
  // preparation finishes (preparing → idle), focus the barcode box so
  // Sales opens scan-ready, as the keyboard chain requires.
  const prevWalkInState = useRef(walkInState);
  useEffect(() => {
    const prev = prevWalkInState.current;
    prevWalkInState.current = walkInState;
    if (prev !== "preparing" || walkInState !== "idle") return;
    const box = document.querySelector("[data-pos-barcode-box] input");
    if (box instanceof HTMLInputElement) { box.focus(); box.select(); }
  }, [walkInState]);
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
  const readTemplates = (): BasketTemplate[] => parseBasketTemplates(localStorage.getItem(templateStorageKey));
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
      // Stamp pre-stamping (legacy) rows with the books currency in
      // force now — the currency their amounts are denominated in —
      // so a later books switch marks them stale instead of letting
      // them resume under the new currency. Best-effort persist: the
      // in-memory stamps still guard this session if storage refuses.
      const backfill = stampLegacyHeldSales(loaded.sales, getActiveBooksCurrency());
      if (backfill.stamped) {
        try { localStorage.setItem(storageKey, JSON.stringify(backfill.rows)); } catch { /* in-memory stamps still apply */ }
      }
      setHeld(backfill.rows);
      heldFailed = loaded.quarantined;
    } catch { heldFailed = true; setHeld([]); }
    try {
      // Same stamp backfill as held sales above: a pre-stamping
      // template's prices are denominated in the books currency in
      // force now, so stamp it at load — a later books switch then
      // marks it stale instead of letting it load under the new label.
      const templateBackfill = stampLegacyBasketTemplates(readTemplates(), getActiveBooksCurrency());
      if (templateBackfill.stamped) {
        try { localStorage.setItem(templateStorageKey, JSON.stringify(templateBackfill.rows)); } catch { /* in-memory stamps still apply */ }
      }
      setTemplates(templateBackfill.rows);
    } catch { setTemplates([]); }
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
  // Scan-focus for two-unit products: the unit select is the first stop
  // after a scan (it auto-opens on keyboard focus, like the discount-type
  // selects), and picking the unit advances to Quantity. One-unit
  // products skip it and land on Quantity directly.
  const [focusUnitFor, setFocusUnitFor] = useState<number | null>(null);
  useEffect(() => {
    if (focusUnitFor === null) return;
    const frame = requestAnimationFrame(() => {
      const field = Array.from(document.querySelectorAll<HTMLSelectElement>(`[data-pos-unit="${focusUnitFor}"]`)).find(select => select.getClientRects().length > 0);
      if (field) { field.focus(); setFocusUnitFor(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusUnitFor, sale.lines.length]);
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
    const targetIndex = lineIndex >= 0 ? lineIndex : sale.lines.length;
    // Unit-first scan focus: a two-unit product stops at its Unit select
    // (which pops open on keyboard focus); a one-unit product skips it
    // and lands on Quantity directly.
    const product = products.find(item => String(item.id) === productId);
    if (product && hasSubunit(product)) setFocusUnitFor(targetIndex);
    else setFocusQuantityFor(targetIndex);
    return true;
  };
  // Scanner-wedge capture, shared with the detailed invoice form (see
  // scanner-capture.ts). A wedge scanner "types" the code with inhumanly
  // even, tiny gaps and finishes with Enter. When focus sits on a sale
  // line field (quantity, price, discount value, discount type), on bare
  // page, a button, or a checkbox, a rapid burst ending in Enter is a
  // scan: it is routed through the scan handler instead of landing in
  // the focused field, and focus then moves to the new line's quantity
  // — so a cashier can scan product after product without clicking.
  // Previously only quantity fields were covered, so a scan arriving
  // after Quantity Enter (focus in Price, discount type, or discount
  // value) typed the barcode into that field and added nothing.
  useScannerCapture({
    disabled: busy,
    identifyField: (target) => {
      if (target instanceof HTMLInputElement) {
        if (target.dataset.posQuantity !== undefined) return { kind: "quantity", index: Number(target.dataset.posQuantity) };
        if (target.dataset.posPrice !== undefined) return { kind: "price", index: Number(target.dataset.posPrice) };
        if (target.dataset.posDiscountValue !== undefined) return { kind: "discount", index: Number(target.dataset.posDiscountValue) };
        if (target.dataset.posCashReceived !== undefined) return { kind: "cashReceived" };
        if (target.dataset.posInvoiceDiscount !== undefined) return { kind: "invoiceDiscount" };
      }
      if (target instanceof HTMLSelectElement) {
        if (target.dataset.posUnit !== undefined) return { kind: "unit", index: Number(target.dataset.posUnit) };
        if (target.dataset.posDiscountType !== undefined) return { kind: "discountType", index: Number(target.dataset.posDiscountType) };
        if (target.dataset.posInvoiceDiscountType !== undefined) return { kind: "invoiceDiscountType" };
        if (target.dataset.posScanUnit !== undefined) return { kind: "scanUnit" };
      }
      return null;
    },
    restoreField: (field, value) => {
      switch (field.kind) {
        case "quantity":
        case "price":
        case "discount":
        case "discountType":
        case "unit":
          onLine(field.index ?? 0, field.kind === "price" ? "selling_price" : field.kind === "discountType" ? "discount_type" : field.kind === "unit" ? "unit_mode" : field.kind, value);
          return;
        case "cashReceived":
          onCashReceived(value);
          return;
        case "invoiceDiscount":
          onDiscount(value);
          return;
        case "invoiceDiscountType":
          onDiscountType(value as "flat" | "percent");
          return;
        case "scanUnit":
          onUnit(value as "main" | "subunit");
          return;
        default:
          return;
      }
    },
    handleScan: handleScannedCode,
  });
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
    if (persist([...latest, { id: crypto.randomUUID(), savedAt: new Date().toISOString(), currency: getActiveBooksCurrency(), sale }])) { onClear(); setNotice("Sale held on this browser. It has not changed stock or payments."); }
    else holdLock.current = false;
  };
  const resume = (row: HeldSale) => {
    if (sale.lines.length || busy) return;
    try {
      const latest = readHeld();
      const saved = latest.find(item => item.id === row.id);
      if (!saved) { setHeld(latest); setNotice("This sale was already resumed in another window."); return; }
      // Currency guard: a sale held before a books-currency switch is
      // denominated in the old currency (browser storage is never
      // converted). Block the resume and keep the row untouched —
      // resuming would book old-currency amounts under the new label.
      if (heldSaleCurrencyStatus(saved, getActiveBooksCurrency()) === "stale") {
        setNotice(t("pos.heldCurrencyMismatch").replace("{held}", String(saved.currency)).replace("{books}", getActiveBooksCurrency()));
        return;
      }
      if (persist(latest.filter(item => item.id !== row.id))) { onRestore(saved.sale); setNotice("Sale resumed. Review its saved prices and quantities before saving."); }
    } catch { setNotice("Held sales could not be read. No sale has been changed."); }
  };
  const draftResult = validateSaleDraft({
    lines: sale.lines,
    invoiceDiscount: sale.discount,
    invoiceDiscountType: sale.discountType,
    taxRate: sale.tax,
    paymentType: sale.paymentType,
    currency: getActiveBooksCurrency(),
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
  // Price transparency (Bug 2): when a line's price is exactly the
  // subunit price derived from its product's main price, say so under
  // the Price field — 1500 ÷ 10 per pack explains a "150" that is not
  // a truncation. An edited price no longer matches the derivation, so
  // the caption disappears rather than mislead.
  const subunitPriceCaption = (line: BarcodeLine, product: Product | undefined): string | null => {
    if (line.unit_mode !== "subunit" || !product) return null;
    const pack = Number(product.units_per_pack);
    const main = Number(product.default_selling_price);
    if (!(pack > 0) || !(main > 0)) return null;
    if (String(subunitPriceFromMain(main, pack)) !== line.selling_price.trim()) return null;
    return `${formatBooksMoney(main)} ÷ ${pack} per pack`;
  };
  const saleRows = sale.lines.map((line, index) => {
    const product = products.find(item => String(item.id) === line.product_id);
    const lineTotal = draftResult.lineTotals[index];
    const fallbackName = line.product_id ? productNameFallback?.[line.product_id] : undefined;
    return { line, index, product, lineTotal, productName: product?.name ?? fallbackName ?? "Product unavailable", subunitCaption: subunitPriceCaption(line, product) };
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
    const next = [{ id: crypto.randomUUID(), name, sale, savedAt: new Date().toISOString(), currency: getActiveBooksCurrency() }, ...existing.filter(item => item.name !== name)].slice(0, 10);
    if (persistTemplates(next)) {
      setTemplateName("");
      setNotice(`Saved basket “${name}”. You can load it again from the basket library.`);
    }
  };
  const applyTemplate = (basket: BasketTemplate) => {
    if (sale.lines.length) return;
    // Currency guard, same rule as held-sale resume: re-read so a
    // template changed in another window is judged as stored, and
    // block a stale one — its prices belong to the old books currency
    // and were never converted. The template is kept exactly as stored.
    let current = basket;
    try { current = readTemplates().find(item => item.id === basket.id) ?? basket; } catch { /* judge the loaded row */ }
    if (basketTemplateCurrencyStatus(current, getActiveBooksCurrency()) === "stale") {
      setNotice(t("pos.basketCurrencyMismatch").replace("{held}", String(current.currency)).replace("{books}", getActiveBooksCurrency()));
      return;
    }
    onRestore(current.sale);
    setNotice(`Loaded basket “${current.name}”. Review lines before saving.`);
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
  // True while a discount-type select's popup was opened by the walk's
  // showPicker call (see the no-change commit note below).
  const posPickerOpenRef = useRef(false);
  useEffect(() => { initKeyboardModality(); }, []);

  // Keyboard-only sale flow. Every handler here stops propagation so the
  // section-level entry navigation (which advances through ALL visible
  // inputs and only then clicks Pay & Save) cannot double-fire behind
  // it — that is what used to walk Enter on Cash Received into the
  // basket, held-sale and drawer fields instead of saving.
  const focusVisible = (selector: string) => {
    const field = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(el => el.getClientRects().length > 0);
    if (field) {
      field.focus();
      if (field instanceof HTMLInputElement) field.select();
    }
    return field;
  };
  const focusFirstIssueField = () => {
    const issue = draftResult.issues[0];
    if (issue?.lineIndex !== undefined) {
      if (focusVisible(`[data-pos-quantity="${issue.lineIndex}"]`)) return;
    }
    focusVisible("#pos-invoice-discount");
  };
  const attemptSave = () => {
    if (saveDisabled) { focusFirstIssueField(); return; }
    onSave();
  };
  const handleLineDiscountKeyDown = (index: number, event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    // Next line's Quantity, or the Total Bill Discount TYPE select on the
    // last line: the cashier picks Amount/% there first (changing the
    // select auto-advances to the value field), then Enter on the value
    // moves to the Cash/Card selector.
    if (!focusVisible(`[data-pos-quantity="${index + 1}"]`)) focusVisible("#pos-invoice-discount-type");
  };
  // Keyboard-only sale flow, discount-type step (2026-10-26): Enter on a
  // line's Price goes to that line's discount TYPE select first (it
  // auto-opens, see openSelectPicker), not straight to the discount
  // value. Picking the type then lands on the discount value input.
  const handleLinePriceKeyDown = (index: number, event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (!focusVisible(`[data-pos-discount-type="${index}"]`)) focusVisible(`[data-pos-discount-value="${index}"]`);
  };
  const handleLineDiscountTypeChange = (index: number, event: ReactChangeEvent<HTMLSelectElement>) => {
    // Stop here on purpose: the section-level entry navigation would
    // otherwise advance past the discount value to the next line. The
    // cashier types the discount amount next, so land there instead.
    event.stopPropagation();
    onLine(index, "discount_type", event.target.value);
    const target = event.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === target) focusVisible(`[data-pos-discount-value="${index}"]`);
    });
  };
  // Unit pick advance, mirroring the discount-type select: picking the
  // unit lands on Quantity next, completing the scan → unit → quantity
  // chain with no click. The no-change Enter case is covered by the
  // shared select key handler on the unit select itself.
  const handleLineUnitChange = (index: number, event: ReactChangeEvent<HTMLSelectElement>) => {
    event.stopPropagation();
    onLine(index, "unit_mode", event.target.value);
    const target = event.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === target) focusVisible(`[data-pos-quantity="${index}"]`);
    });
  };
  // Dropdown auto-open (2026-10-26): when a discount-type select gains
  // focus through the keyboard walk, open its options at once so the
  // cashier picks with arrows and confirms with Enter — no click.
  // showPicker is Chromium-only; elsewhere the call is ignored and the
  // cashier opens the list with Enter/Space as before. Keyboard focus
  // only: a mouse/touch focus keeps native click behaviour (showPicker
  // during a click would make the click close the popup it opened).
  const openSelectPicker = (event: { currentTarget: HTMLSelectElement }) => {
    if (!wasLastInputKeyboard()) return;
    try {
      (event.currentTarget as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
      posPickerOpenRef.current = true;
    } catch {
      // Popup already open, or the browser has no showPicker — ignore.
    }
  };
  const clearPosPickerOpen = () => { posPickerOpenRef.current = false; };
  // No-change commit (2026-10-26): picking the already-selected option
  // fires no change event, so the walk would stall on the select (the
  // next Enter would just reopen it). An open popup's Enter commits
  // without reaching page handlers, so an Enter that DOES reach here
  // means the popup just closed after a no-change commit — advance to
  // the next field instead of reopening. Escape clears the flag so a
  // later Enter reopens natively.
  const handleDiscountTypeSelectKeyDown = (nextSelector: string, event: ReactKeyboardEvent<HTMLSelectElement>) => {
    if (event.key === "Escape") { posPickerOpenRef.current = false; return; }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (!posPickerOpenRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    posPickerOpenRef.current = false;
    focusVisible(nextSelector);
  };
  const handleTotalBillDiscountKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    focusVisible(`[data-pos-payment-method="${sale.paymentType === "credit" ? "cash" : sale.paymentType}"]`);
  };
  const handlePaymentKeyDown = (type: "cash" | "card", event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    // Arrow keys move the selection; Enter confirms the CURRENT
    // selection. Pressing Enter on a button that is not yet selected
    // only selects it (a second Enter then confirms) — the save must
    // never run against the previous payment type.
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next = type === "cash" ? "card" : "cash";
      onPaymentType(next);
      // Focus follows the new selection on the next paint, once the
      // parent has applied it; the button itself stays focusable.
      requestAnimationFrame(() => focusVisible(`[data-pos-payment-method="${next}"]`));
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (sale.paymentType !== type) {
      onPaymentType(type);
      // The Cash Received field only renders once the parent has
      // applied the new payment type, so focus it on the next paint.
      if (type === "cash") requestAnimationFrame(() => focusVisible("#pos-cash-received"));
      return;
    }
    if (type === "cash") focusVisible("#pos-cash-received");
    else attemptSave();
  };
  const handleCashReceivedKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    attemptSave();
  };
  return <div className="space-y-4" data-context-help-skip>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Scan or search • Check quantity • {owner || staffDirectSale ? "Pay and save" : "Send for approval"}</p>
      <button type="button" disabled={busy} onClick={onAdvanced} className="min-h-11 rounded-lg border px-4 text-sm font-medium">Wholesale / Distributor Invoicing</button>
      {onDrawerNoSale && <button type="button" disabled={busy} onClick={openNoSaleDialog} className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-40">{t("drawer.openDrawer")}</button>}
    </div>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div data-pos-barcode-box><BarcodeInput compact label="Barcode" autoFocus disabled={busy} focusSignal={focusSignal} clearSignal={clearSignal} onScan={handleScannedCode} canAutoSubmit={code => hasExactBarcodeMatch(products, code)} /></div>
      <div className="space-y-3"><label className="block text-sm font-medium">Find product</label><ProductSearchSelect key={searchKey} value="" products={productOptions} rankedFields={productRankFields} onBarcodeEnter={text => {
        // Every Enter text is offered to the shared scan choke point
        // first: an exact saved barcode adds through the scan path instead
        // of needing a dropdown pick. Plain search text reports no error
        // and returns false, keeping the normal suggestion behavior;
        // barcode-shaped text that matches nothing reports the not-found
        // error there, and ProductSearchSelect blocks its fuzzy fallback
        // so a near-match stranger is never added instead.
        return handleScannedCode(text, { reportNotFound: isBarcodeShaped(text) });
      }} onChange={id => { if (id) { const picked = products.find(item => String(item.id) === id); if (picked && hasSubunit(picked)) setFocusUnitFor(sale.lines.length); else setFocusQuantityFor(sale.lines.length); onAdd(id); setSearchKey(key => key + 1); } }} />
        <label className="flex items-center gap-3 text-sm">Add one<select data-pos-scan-unit value={scanUnit} onChange={event => onUnit(event.target.value as "main" | "subunit")} className="min-h-11 rounded border border-input bg-background px-3"><option value="subunit">Piece / sub-unit</option><option value="main">Box / main unit</option></select></label>
        <label className="block text-sm font-medium">Customer</label><ProductSearchSelect label="Customer" value={sale.customerId ?? ""} rankedFields={customerRankFields} products={customerOptions} onChange={onCustomer} />
      </div>
    </fieldset>
    <div data-pos-desktop-table className="hidden overflow-x-auto rounded-xl border bg-card sm:block"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted text-left"><tr>{["Product", "Unit", "Quantity", "Price", "Discount", "Total", ""].map((text, index) => <th key={index} className="p-3">{text}</th>)}</tr></thead>
      <tbody>{saleRows.map(({ line, index, product, lineTotal, productName, subunitCaption }) => <tr key={index} className="border-t">
        <td className="p-3 font-medium">{productName}{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}{bonusIssue(index) && <small className="block text-destructive" role="alert">{bonusIssue(index)}</small>}</td>
        <td className="p-2"><select data-pos-unit={index} aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onFocus={openSelectPicker} onBlur={clearPosPickerOpen} onKeyDown={event => handleDiscountTypeSelectKeyDown(`[data-pos-quantity="${index}"]`, event)} onChange={event => handleLineUnitChange(index, event)} className="min-h-11 rounded border border-input bg-background px-2"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></td>
        {(["quantity", "selling_price", "discount"] as const).map(field => <td key={field} className="p-2">
          <div className="flex items-center gap-2">
            <input data-pos-quantity={field === "quantity" ? index : undefined} data-pos-price={field === "selling_price" ? index : undefined} data-pos-discount-value={field === "discount" ? index : undefined} aria-label={`${field === "selling_price" ? "Price" : field} for ${productName}`} type="text" inputMode="decimal" value={line[field]} disabled={busy} onChange={event => onLine(index, field, event.target.value)} onKeyDown={field === "discount" ? event => handleLineDiscountKeyDown(index, event) : field === "selling_price" ? event => handleLinePriceKeyDown(index, event) : undefined} className="min-h-11 w-24 rounded border border-input bg-background px-2 tabular-nums" />
            {field === "discount" && <select data-pos-discount-type={index} aria-label={`Discount type for ${productName}`} value={line.discount_type ?? "flat"} disabled={busy} onFocus={openSelectPicker} onBlur={clearPosPickerOpen} onKeyDown={event => handleDiscountTypeSelectKeyDown(`[data-pos-discount-value="${index}"]`, event)} onChange={event => handleLineDiscountTypeChange(index, event)} className="min-h-11 rounded border border-input bg-background px-2 text-sm"><option value="flat">Amount</option><option value="percent">%</option></select>}
          </div>
          {field === "selling_price" && subunitCaption && <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{subunitCaption}</span>}
          {fieldIssue(field, index) && <span className="block max-w-32 text-xs text-destructive" role="alert">{fieldIssue(field, index)}</span>}
        </td>)}
        <td className="p-3 font-medium tabular-nums">{lineTotal === null ? <span className="text-muted-foreground">Unavailable</span> : formatBooksMoney(lineTotal)}</td>
        <td className="p-2"><button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove</button></td>
      </tr>)}{!sale.lines.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</td></tr>}</tbody></table></div>
    <div data-pos-mobile-basket className="space-y-3 sm:hidden" aria-label="Basket">
      {saleRows.map(({ line, index, product, lineTotal, productName, subunitCaption }) => <article data-pos-mobile-row key={index} className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{productName}</p>{Number(line.bonus) > 0 && <small className="block">+ {line.bonus} free</small>}{bonusIssue(index) && <small className="block text-destructive" role="alert">{bonusIssue(index)}</small>}</div><p className="shrink-0 font-semibold tabular-nums">{lineTotal === null ? <span className="text-muted-foreground">Unavailable</span> : formatBooksMoney(lineTotal)}</p></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs font-medium">Quantity<input data-pos-quantity={index} aria-label={`Quantity for ${productName}`} type="text" inputMode="decimal" value={line.quantity} disabled={busy} onChange={event => onLine(index, "quantity", event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" />{fieldIssue("quantity", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("quantity", index)}</span>}</label>
          <label className="min-w-0 text-xs font-medium">Unit<select data-pos-unit={index} aria-label={`Unit for ${productName}`} value={line.unit_mode ?? "main"} disabled={busy} onFocus={openSelectPicker} onBlur={clearPosPickerOpen} onKeyDown={event => handleDiscountTypeSelectKeyDown(`[data-pos-quantity="${index}"]`, event)} onChange={event => handleLineUnitChange(index, event)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm"><option value="main">{product?.unit_type || "Main"}</option>{Number(product?.units_per_pack) > 0 && <option value="subunit">{product?.subunit_type || "Piece"}</option>}</select></label>
          <details className="col-span-2">
            <summary className="flex min-h-11 cursor-pointer items-center rounded border border-border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Price, discount & removal</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium">Price<input data-pos-price={index} aria-label={`Price for ${productName}`} type="text" inputMode="decimal" value={line.selling_price} disabled={busy} onChange={event => onLine(index, "selling_price", event.target.value)} onKeyDown={event => handleLinePriceKeyDown(index, event)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" />{subunitCaption && <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{subunitCaption}</span>}{fieldIssue("selling_price", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("selling_price", index)}</span>}</label>
              <div className="text-xs font-medium"><span>Discount</span><div className="mt-1 flex gap-2"><input data-pos-discount-value={index} aria-label={`Discount for ${productName}`} type="text" inputMode="decimal" value={line.discount} disabled={busy} onChange={event => onLine(index, "discount", event.target.value)} onKeyDown={event => handleLineDiscountKeyDown(index, event)} className="min-h-11 w-full rounded border border-input bg-background px-2 text-sm tabular-nums" /><select data-pos-discount-type={index} aria-label={`Discount type for ${productName}`} value={line.discount_type ?? "flat"} disabled={busy} onFocus={openSelectPicker} onBlur={clearPosPickerOpen} onKeyDown={event => handleDiscountTypeSelectKeyDown(`[data-pos-discount-value="${index}"]`, event)} onChange={event => handleLineDiscountTypeChange(index, event)} className="min-h-11 rounded border border-input bg-background px-2 text-sm"><option value="flat">Amount</option><option value="percent">%</option></select></div>{fieldIssue("discount", index) && <span className="mt-1 block text-xs text-destructive" role="alert">{fieldIssue("discount", index)}</span>}</div>
              <button type="button" disabled={busy} aria-label={`Remove ${productName}`} onClick={() => onRemove(index)} className="col-span-2 min-h-11 rounded border border-destructive/40 px-3 text-destructive">Remove product</button>
            </div>
          </details>
        </div>
      </article>)}
      {!sale.lines.length && <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Ready for the next customer. Scan a product to begin.</p>}
    </div>
    {draftResult.issues.filter(issue => issue.field === "invoice_discount").map(issue => <p key={issue.message} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{issue.message}</p>)}
    <div data-pos-payment-bar className="sticky bottom-4 z-20 flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-4 shadow-lg">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" role="group" aria-label={t("sell.paymentType")}>
        {(["cash", "card"] as const).map(type => <button key={type} type="button" data-pos-payment-method={type} disabled={busy} aria-pressed={sale.paymentType === type} onClick={() => onPaymentType(type)} onKeyDown={event => handlePaymentKeyDown(type, event)} className={`min-h-12 flex-1 rounded-lg px-5 font-semibold disabled:opacity-40 ${sale.paymentType === type ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}>{type === "cash" ? t("sell.paymentCash") : t("sell.paymentCard")}</button>)}
        {sale.paymentType === "credit" && <span className="text-sm font-medium text-muted-foreground">{t("sell.paymentCredit")}</span>}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><span className="text-sm text-muted-foreground">Total payable · {sale.paymentType === "card" ? t("sell.paymentCard") : sale.paymentType === "credit" ? t("sell.paymentCredit") : t("sell.paymentCash")}</span><div className="text-3xl font-bold tabular-nums">{total === null ? <span className="text-lg text-muted-foreground">Unavailable</span> : formatBooksMoney(total)}</div>{total === null && <p className="mt-1 text-sm text-destructive">Complete or correct the highlighted sale fields to calculate the total.</p>}{draftResult.issues.filter(issue => issue.lineIndex === undefined && issue.field !== "cash_received" && issue.field !== "invoice_discount").map(issue => <p key={issue.field + issue.message} className="mt-1 text-sm text-destructive" role="alert">{issue.message}</p>)}{Number(sale.tax) > 0 && <small>Includes tax from wholesale / distributor invoicing.</small>}
      {owner && <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor="pos-invoice-discount" className="text-sm font-medium">{t("sell.totalBillDiscount")}</label>
        <select id="pos-invoice-discount-type" data-pos-invoice-discount-type aria-label="Total Bill Discount type" value={sale.discountType} disabled={busy} onFocus={openSelectPicker} onBlur={clearPosPickerOpen} onKeyDown={event => handleDiscountTypeSelectKeyDown("#pos-invoice-discount", event)} onChange={event => onDiscountType(event.target.value as "flat" | "percent")} className="min-h-11 rounded border border-input bg-background px-3 text-base">
          <option value="flat">Amount</option><option value="percent">Percentage (%)</option>
        </select>
        <input id="pos-invoice-discount" data-pos-invoice-discount aria-label={sale.discountType === "percent" ? "Total Bill Discount percentage" : "Total Bill Discount amount"} type="text" inputMode="decimal" value={sale.discount} disabled={busy} onChange={event => onDiscount(event.target.value)} onKeyDown={handleTotalBillDiscountKeyDown} placeholder={sale.discountType === "percent" ? "0–100" : "0.00"} className="min-h-11 w-32 rounded border border-input bg-background px-3 text-base tabular-nums" />
      </div>}
      {owner && draftResult.amounts && Number(sale.discount) > 0 && <p className="mt-2 text-sm tabular-nums">Discount before tax: {formatBooksMoney(draftResult.amounts.invoiceDiscount)}</p>}</div>
      {owner && sale.paymentType === "cash" && <div className="sm:min-w-52"><label className="block text-sm">Cash received<input id="pos-cash-received" data-pos-cash-received aria-label="Cash received" type="text" inputMode="decimal" value={cashReceived} placeholder={total === null ? "Sale total unavailable" : String(total)} onChange={event => onCashReceived(event.target.value)} onKeyDown={handleCashReceivedKeyDown} disabled={busy} className="mt-1 block min-h-11 w-full rounded border border-input bg-background px-3 tabular-nums sm:w-40" /></label><div className="mt-2 flex flex-wrap gap-2">{quickCashPresets.map(preset => <button key={preset.label} type="button" disabled={busy} className="min-h-11 rounded border px-2 text-xs disabled:opacity-40" onClick={() => onCashReceived(String(preset.value))}>{preset.label}</button>)}</div>{draftResult.issues.filter(issue => issue.field === "cash_received").map(issue => <p key={issue.message} className="mt-2 text-sm text-destructive" role="alert">{draftResult.cashSummary?.status === "cash-short" ? <>Cash short by <span className="tabular-nums">{formatBooksMoney(draftResult.cashSummary.shortfall)}</span>.</> : issue.message}</p>)}{!draftResult.issues.some(issue => issue.field === "cash_received") && (cashReceived.trim() === "" ? <p className="mt-2 text-sm text-muted-foreground">Leave blank to use the exact sale total.</p> : draftResult.cashSummary ? <p className="mt-2 text-sm">Change due: <span className="tabular-nums">{formatBooksMoney(draftResult.cashSummary.change)}</span></p> : <p className="mt-2 text-sm text-muted-foreground">Cash summary unavailable until the sale total is valid.</p>)}</div>}
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
