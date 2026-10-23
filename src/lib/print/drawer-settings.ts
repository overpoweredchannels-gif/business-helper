/**
 * Per-till cash drawer settings.
 *
 * Drawer hardware belongs to the TILL, not the organization: the same
 * business can run one counter on a printer-driver drawer and another
 * on a direct serial connection, with different kick pins. Settings are
 * therefore kept in browser storage keyed by the POS scope
 * (`{organizationId}:{profileId}`), exactly like the held-sales store —
 * never in the organizations row.
 *
 * Defaults are the Spain-class till: drawer present, kicking through
 * the receipt printer driver (Route 1, Document Bottom) on pin 2.
 */
import type { DrawerPin, DrawerRoute } from "./drawer";

export interface DrawerSettings {
  enabled: boolean;
  route: DrawerRoute;
  pin: DrawerPin;
}

export const DEFAULT_DRAWER_SETTINGS: DrawerSettings = {
  enabled: true,
  route: "print",
  pin: 2,
};

export function drawerSettingsStorageKey(scope: string): string {
  return `tradeos-drawer-v1:${scope}`;
}

export function parseDrawerSettings(raw: string | null): DrawerSettings {
  if (!raw) return { ...DEFAULT_DRAWER_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DRAWER_SETTINGS };
    const value = parsed as Partial<DrawerSettings>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_DRAWER_SETTINGS.enabled,
      route: value.route === "serial" || value.route === "usb" || value.route === "print"
        ? value.route
        : DEFAULT_DRAWER_SETTINGS.route,
      pin: value.pin === 5 ? 5 : 2,
    };
  } catch {
    return { ...DEFAULT_DRAWER_SETTINGS };
  }
}

type DrawerSettingsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readDrawerSettings(
  storage: DrawerSettingsStorage,
  scope: string,
): DrawerSettings {
  try {
    return parseDrawerSettings(storage.getItem(drawerSettingsStorageKey(scope)));
  } catch {
    return { ...DEFAULT_DRAWER_SETTINGS };
  }
}

export function writeDrawerSettings(
  storage: DrawerSettingsStorage,
  scope: string,
  settings: DrawerSettings,
): void {
  try {
    storage.setItem(drawerSettingsStorageKey(scope), JSON.stringify(settings));
  } catch {
    // Best-effort, like the sell-mode seam: a browser without storage
    // simply keeps the in-session settings.
  }
}
