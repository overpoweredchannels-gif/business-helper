import { isCurrency, type Currency } from "@/lib/regional/settings";
import { currencyStampStatus, type CurrencyStampStatus } from "./currency-stamp";
import { HELD_SALE_NOTES_MAX_LENGTH, type HeldCounterSale } from "./held-sales";

/**
 * Mini-tabs browser storage for the sale screen (Phase D, user-visit UX).
 *
 * A mini-tab is one concurrent in-progress invoice. Each tab carries the
 * WHOLE counter sale — customer, lines, discount, tax, payment mode,
 * typed cash tender, scan-unit preference and notes — in the same shape
 * as a held sale, so switching tabs can never mix one customer's data
 * into another: the live sale is snapshotted into the outgoing tab and
 * the incoming tab's sale is restored exactly.
 *
 * Tabs live only in the browser (per account + business scope) and are
 * written back on every change, so a reload or a crash reopens the same
 * tabs. The stored shape is validated strictly on read: a corrupt value
 * is quarantined under a backup key and reported as an empty store
 * instead of wedging the sale screen. A tab stamped with a books
 * currency other than the current one must not be opened — its amounts
 * belong to the old currency and were never converted.
 */
export const MINI_TABS_LIMIT = 4;

export type MiniTab = {
  id: string;
  savedAt: string;
  /**
   * The org's books currency when the tab was last saved. See HeldSale
   * for why this stamp exists; a books conversion never touches browser
   * storage.
   */
  currency?: Currency;
  sale: HeldCounterSale;
};

export type MiniTabsStore = {
  tabs: MiniTab[];
  activeId: string | null;
};

export function miniTabsStorageKey(scope: string): string {
  return `tradeos-pos-tabs-v1:${scope}`;
}

export function miniTabsQuarantineKey(storageKey: string): string {
  return `${storageKey}:quarantined`;
}

function isValidSale(draft: unknown): draft is HeldCounterSale {
  if (!draft || typeof draft !== "object") return false;
  const sale = draft as Record<string, unknown>;
  return (
    Array.isArray(sale.lines) &&
    ["cash", "card", "credit"].includes(String(sale.paymentType)) &&
    ["flat", "percent"].includes(String(sale.discountType)) &&
    [sale.date, sale.discount, sale.tax].every((value) => typeof value === "string") &&
    (sale.cashReceived === undefined || typeof sale.cashReceived === "string") &&
    (sale.scanUnit === undefined || ["main", "subunit"].includes(String(sale.scanUnit))) &&
    (sale.notes === undefined ||
      (typeof sale.notes === "string" && sale.notes.length <= HELD_SALE_NOTES_MAX_LENGTH)) &&
    (sale.customerId === null || typeof sale.customerId === "string") &&
    (sale.lines as Array<Record<string, unknown>>).every(
      (line) =>
        line &&
        [line.quantity, line.selling_price, line.discount].every(
          (value) => typeof value === "string",
        ) &&
        (line.product_id === null || typeof line.product_id === "string") &&
        (line.bonus === undefined || typeof line.bonus === "string") &&
        (line.unit_mode === undefined || ["main", "subunit"].includes(String(line.unit_mode))),
    )
  );
}

function normalizeSale(sale: HeldCounterSale): HeldCounterSale {
  return {
    ...sale,
    cashReceived: sale.cashReceived ?? "",
    scanUnit: sale.scanUnit ?? "subunit",
    notes: sale.notes ?? "",
  };
}

export function parseMiniTabs(raw: string | null): MiniTabsStore {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '{"tabs":[],"activeId":null}');
  } catch {
    throw new Error("Invalid mini tabs");
  }
  if (!stored || typeof stored !== "object") throw new Error("Invalid mini tabs");
  const { tabs, activeId } = stored as Record<string, unknown>;
  if (!Array.isArray(tabs) || tabs.length > MINI_TABS_LIMIT) throw new Error("Invalid mini tabs");
  if (activeId !== null && typeof activeId !== "string") throw new Error("Invalid mini tabs");
  if (
    tabs.some((row) => {
      if (!row || typeof row !== "object") return true;
      const tab = row as Record<string, unknown>;
      return (
        typeof tab.id !== "string" ||
        typeof tab.savedAt !== "string" ||
        (tab.currency !== undefined && !isCurrency(tab.currency)) ||
        !isValidSale(tab.sale)
      );
    })
  ) {
    throw new Error("Invalid mini tabs");
  }
  const parsed = (tabs as MiniTab[]).map((tab) => ({ ...tab, sale: normalizeSale(tab.sale) }));
  return {
    tabs: parsed,
    activeId:
      activeId !== null && parsed.some((tab) => tab.id === activeId) ? (activeId as string) : null,
  };
}

type MiniTabsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type MiniTabsLoad = { store: MiniTabsStore; quarantined: boolean };

/**
 * Load mini-tabs for the sale mount. A value that fails validation is
 * copied to the quarantine key (best-effort) and reported via
 * `quarantined: true` with an empty store, so a corrupt store can no
 * longer disable the sale screen.
 */
export function loadMiniTabs(
  storage: MiniTabsStorage,
  storageKey: string,
): MiniTabsLoad {
  const raw = storage.getItem(storageKey);
  try {
    return { store: parseMiniTabs(raw), quarantined: false };
  } catch {
    if (raw !== null) {
      try {
        storage.setItem(miniTabsQuarantineKey(storageKey), raw);
      } catch {
        // Quarantine is best-effort; the empty store is the recovery.
      }
    }
    return { store: { tabs: [], activeId: null }, quarantined: true };
  }
}

/**
 * Currency guard for a tab — the shared stamp rule, under mini-tab
 * names. A "stale" tab (stamped with a currency other than the current
 * books currency) must not be opened: its amounts were never converted.
 */
export function miniTabCurrencyStatus(
  tab: MiniTab,
  booksCurrency: Currency,
): CurrencyStampStatus {
  return currencyStampStatus(tab, booksCurrency);
}

/** An empty sale for a fresh tab: no lines, no tender, no note. */
export function emptyMiniTabSale(
  customerId: string | null,
  scanUnit: "main" | "subunit",
  date: string,
): HeldCounterSale {
  return {
    lines: [],
    customerId,
    date,
    paymentType: "cash",
    discount: "",
    discountType: "flat",
    tax: "",
    cashReceived: "",
    scanUnit,
    notes: "",
  };
}

/** A new tab holding the given sale, stamped with the books currency. */
export function newMiniTab(sale: HeldCounterSale, currency: Currency): MiniTab {
  return {
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    currency,
    sale,
  };
}

/**
 * Heal tabs whose currency stamp is stale but which hold no amounts: an
 * empty tab has no lines, so its stamp means nothing and re-stamping it
 * to the current books currency can never mislabel an amount. Tabs with
 * lines are returned untouched — a stale stamp there is a real currency
 * switch and the guard must keep blocking them.
 *
 * This exists because the first Phase D build stamped the mount-seeded
 * tab with the books currency before the org had loaded (the module
 * default PKR), so a live EUR org left a PKR-stamped tab that could
 * never be opened again. New tabs are stamped only once the org is
 * loaded (see the page's load effect), so only those early empty tabs
 * need healing.
 */
export function restampEmptyMiniTabs(
  tabs: MiniTab[],
  booksCurrency: Currency,
): { tabs: MiniTab[]; restamped: boolean } {
  let restamped = false;
  const healed = tabs.map((tab) => {
    if (
      tab.sale.lines.length === 0 &&
      tab.currency !== undefined &&
      tab.currency !== booksCurrency
    ) {
      restamped = true;
      return { ...tab, currency: booksCurrency };
    }
    return tab;
  });
  return { tabs: healed, restamped };
}
