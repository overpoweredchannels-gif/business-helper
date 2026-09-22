export type DashboardBannerId = "setup-import" | "quick-sale" | "business-records-export" | "greeting";

const STORAGE_PREFIX = "tradeos_dashboard_banners_";

/** Fired after a banner folded state changes so every mounted banner stays in sync. */
export const DASHBOARD_BANNER_CHANGE_EVENT = "tradeos:dashboard-banner-change";

export interface DashboardBannerChange {
  profileId?: string | null;
  id: DashboardBannerId;
  collapsed: boolean;
}

export function dashboardBannerStorageKey(profileId?: string | null) {
  return `${STORAGE_PREFIX}${profileId ?? "anon"}`;
}

export function readCollapsedBanners(profileId?: string | null): Partial<Record<DashboardBannerId, boolean>> {
  try {
    const raw = localStorage.getItem(dashboardBannerStorageKey(profileId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<Record<DashboardBannerId, boolean>>) : {};
  } catch {
    return {};
  }
}

export function writeCollapsedBanner(profileId: string | null | undefined, id: DashboardBannerId, collapsed: boolean) {
  try {
    const next = { ...readCollapsedBanners(profileId), [id]: collapsed };
    localStorage.setItem(dashboardBannerStorageKey(profileId), JSON.stringify(next));
  } catch {
    // Browser storage may be unavailable; the banner still collapses for this session.
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DashboardBannerChange>(DASHBOARD_BANNER_CHANGE_EVENT, { detail: { profileId, id, collapsed } }));
}
