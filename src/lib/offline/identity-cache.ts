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
 * and app updates. Slice S2 added the SQLite `identity_cache` table
 * (electron/store.ts) as the durable record behind the SAME exported
 * functions: every write is mirrored to SQLite on desktop (fire-and-forget
 * over IPC), and `readIdentityCacheAsync()` reads SQLite first — so the
 * identity survives even a wiped browser profile. The synchronous
 * `readIdentityCache()` keeps reading localStorage (the auth path needs a
 * sync read); the async cold-start paths in `src/app/page.tsx` use the
 * async read.
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

/** The preload bridge's identity methods (SQLite), or null outside the desktop shell. */
type DesktopIdentityBridge = {
  get(): Promise<CachedIdentity | null>;
  set(entry: CachedIdentity): Promise<void>;
  clear(): Promise<void>;
};

function desktopIdentityBridge(): DesktopIdentityBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { identity?: DesktopIdentityBridge } })
    .aankhDesktop;
  return bridge?.identity ?? null;
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
 * Slice S2 — async read of the cached identity. On desktop this reads the
 * SQLite `identity_cache` table first (the durable record), falling back
 * to the localStorage copy when the store is unavailable or empty; on web
 * it is the localStorage read. The async cold-start paths use this so a
 * wiped browser profile still restores from SQLite.
 */
export async function readIdentityCacheAsync(): Promise<CachedIdentity | null> {
  const bridge = desktopIdentityBridge();
  if (isDesktopApp() && bridge) {
    try {
      const entry = await bridge.get();
      if (isValidCachedIdentity(entry)) return normalize(entry);
    } catch {
      /* Store unreachable — fall through to the local copy below. */
    }
  }
  return readIdentityCache();
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
  // Slice S2: mirror the write to the durable SQLite record on desktop.
  // Fire-and-forget — a store failure must never break sign-in.
  const bridge = desktopIdentityBridge();
  if (isDesktopApp() && bridge) {
    void bridge.set(merged).catch(() => {
      /* Best-effort mirror; the localStorage copy is the fallback. */
    });
  }
}

/** Drop the cached identity (sign-out). A signed-out device must never restore the previous user offline. */
export function clearIdentityCache(): void {
  const store = storage();
  if (store) {
    try {
      store.removeItem(IDENTITY_CACHE_STORAGE_KEY);
    } catch {
      // Best-effort.
    }
  }
  // Slice S2: clear the durable SQLite record too, or a wiped profile
  // would resurrect the signed-out user at the next cold start.
  const bridge = desktopIdentityBridge();
  if (isDesktopApp() && bridge) {
    void bridge.clear().catch(() => {
      /* Best-effort. */
    });
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
