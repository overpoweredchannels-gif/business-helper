export type DashboardBannerId = "setup-import" | "quick-sale" | "business-records-export";

const STORAGE_PREFIX = "tradeos_dashboard_banners_";

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
}
