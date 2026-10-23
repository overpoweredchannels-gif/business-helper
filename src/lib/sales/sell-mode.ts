/**
 * Sell-surface mode persistence (Retail POS vs detailed invoice form).
 *
 * The chosen mode is remembered per organization + profile in browser
 * storage, so a counter that works in Retail POS reopens in Retail POS
 * instead of resetting to the detailed form on every page load. Anything
 * unreadable or unknown falls back to "invoice" — the historical default.
 */
export type SellMode = "pos" | "invoice";

export function sellModeStorageKey(organizationId: string, profileId: string): string {
  return `tradeos-sell-mode-v1:${organizationId}:${profileId}`;
}

export function parseSellMode(raw: string | null): SellMode {
  return raw === "pos" ? "pos" : "invoice";
}

type SellModeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readSellMode(
  storage: SellModeStorage,
  organizationId: string,
  profileId: string,
): SellMode {
  try {
    return parseSellMode(storage.getItem(sellModeStorageKey(organizationId, profileId)));
  } catch {
    return "invoice";
  }
}

export function writeSellMode(
  storage: SellModeStorage,
  organizationId: string,
  profileId: string,
  mode: SellMode,
): void {
  try {
    storage.setItem(sellModeStorageKey(organizationId, profileId), mode);
  } catch {
    // Persistence is best-effort: a browser without storage simply keeps
    // the in-session mode, exactly as before this seam existed.
  }
}
