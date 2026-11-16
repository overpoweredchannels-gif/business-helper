/**
 * Slice S1 — cached identity for offline cold start (Offline Tier-1).
 *
 * The desktop app must open without internet and land on the sales screen
 * signed in as the last user. The live profile/org selects cannot do that
 * offline, so the last successful online load is cached here and the auth
 * path in `src/app/page.tsx` restores from it when the network fails.
 *
 * Storage: localStorage for now — one small row, and the auth path needs a
 * synchronous read at cold start. In the Electron renderer this storage
 * lives in the `userData` Chromium profile on disk, so it survives restart
 * and app updates. Slice S2 migrates this backend to the SQLite
 * `identity_cache` table behind the SAME exported functions — callers must
 * only use the functions below, never the storage key directly.
 *
 * Safety rules (same discipline as the offline catalogue cache):
 * - Every function soft-fails when storage is unavailable or the stored
 *   JSON is corrupt/shapeless: reads return null, writes are no-ops.
 *   The app must never break because the cache failed.
 * - The cache is a fallback, never the source of truth: a live load
 *   always overwrites it, and it is only trusted when a stored session
 *   also exists (see checkAuthUser). It is cleared on sign-out.
 * - A cache written for a different user is never restored for the
 *   current user (see `identityCacheForUser`).
 */

import type { Currency } from "@/lib/regional/settings";

export interface CachedIdentity {
  /** profiles.id of the signed-in user. */
  profileId: string;
  /** organizations.id of the user's workspace. */
  organizationId: string;
  displayName: string | null;
  email: string | null;
  /** profiles.role, e.g. "owner" / "salesman". */
  role: string | null;
  /** Resolved books currency at cache time (from the org row). */
  booksCurrency: Currency | null;
  /** Full profile row as last loaded live (restores currentProfile). */
  profileRow: Record<string, unknown> | null;
  /** Full organization row as last loaded live (feeds populateBusinessSettings). */
  organizationRow: Record<string, unknown> | null;
  /** ISO timestamp of the last write. */
  cachedAt: string;
}

/** Storage key. Exported for tests/maintenance only — callers use the functions. */
export const IDENTITY_CACHE_STORAGE_KEY = "aankh:identity-cache:v1";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function storage(): StorageLike | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as { localStorage?: StorageLike; window?: { localStorage?: StorageLike } };
  return g.localStorage ?? g.window?.localStorage ?? null;
}

/** True when the app runs inside the installed desktop shell (or a desktop build). */
export function isDesktopApp(): boolean {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_DESKTOP === "1") return true;
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { aankhDesktop?: { isDesktop?: unknown } }).aankhDesktop;
  return bridge?.isDesktop === true;
}

/**
 * Is this auth failure a network failure? A network failure must never sign
 * the user out on desktop — the stored session is still valid, only
 * unreachable. A non-network auth error (invalid token, wrong credentials)
 * still signs out.
 *
 * `navigator.onLine === false` is the strongest signal: offline, every auth
 * failure is network-caused. Otherwise the error message decides — the
 * Supabase client surfaces fetch failures as "Failed to fetch" /
 * "Network request failed" / "fetch failed".
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { message?: unknown } | null)?.message ?? "");
  if (typeof message !== "string" || message.length === 0) return false;
  return /failed to fetch|fetch failed|network request failed|networkerror|network connection was lost|load failed|the internet connection appears to be offline|timeout|timed out|econnrefused|econnreset|enotfound|eai_again|offline/i.test(
    message,
  );
}

function isValidCachedIdentity(value: unknown): value is CachedIdentity {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.profileId === "string" &&
    entry.profileId.length > 0 &&
    typeof entry.organizationId === "string" &&
    entry.organizationId.length > 0 &&
    typeof entry.cachedAt === "string" &&
    entry.cachedAt.length > 0
  );
}

function normalize(entry: CachedIdentity): CachedIdentity {
  return {
    profileId: entry.profileId,
    organizationId: entry.organizationId,
    displayName: entry.displayName ?? null,
    email: entry.email ?? null,
    role: entry.role ?? null,
    booksCurrency: entry.booksCurrency ?? null,
    profileRow: entry.profileRow ?? null,
    organizationRow: entry.organizationRow ?? null,
    cachedAt: entry.cachedAt,
  };
}

/** Read the cached identity, or null when there is none / it is unusable. Never throws. */
export function readIdentityCache(): CachedIdentity | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(IDENTITY_CACHE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidCachedIdentity(parsed) ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Merge a partial write into the cached identity. The profile load writes
 * the profile part, the org load writes the org part; neither clobbers the
 * other. A write for a different user or organization resets the entry
 * first — a stale profile must never mix with a new org.
 */
export function saveIdentityCache(partial: Partial<CachedIdentity>): void {
  const store = storage();
  if (!store) return;
  const existing = readIdentityCache();
  const identitySwitched =
    existing !== null &&
    ((partial.profileId !== undefined && partial.profileId !== existing.profileId) ||
      (partial.organizationId !== undefined && partial.organizationId !== existing.organizationId));
  const base: CachedIdentity =
    existing !== null && !identitySwitched
      ? existing
      : {
          profileId: partial.profileId ?? "",
          organizationId: partial.organizationId ?? "",
          displayName: null,
          email: null,
          role: null,
          booksCurrency: null,
          profileRow: null,
          organizationRow: null,
          cachedAt: new Date().toISOString(),
        };
  const merged = normalize({ ...base, ...partial, cachedAt: new Date().toISOString() });
  if (!isValidCachedIdentity(merged)) return;
  try {
    store.setItem(IDENTITY_CACHE_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage full / unavailable — the cache is best-effort, never fatal.
  }
}

/** Drop the cached identity (sign-out). A signed-out device must never restore the previous user offline. */
export function clearIdentityCache(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(IDENTITY_CACHE_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * The cached identity for this user only. A cache written for a different
 * user (stale after an account switch, or a shared device) is never
 * restored for the current session user.
 */
export function identityCacheForUser(entry: CachedIdentity | null, userId: string | null): CachedIdentity | null {
  if (!entry || !userId) return null;
  return entry.profileId === userId ? entry : null;
}
