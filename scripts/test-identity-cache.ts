import assert from "node:assert/strict";
import {
  IDENTITY_CACHE_STORAGE_KEY,
  clearIdentityCache,
  identityCacheForUser,
  isDesktopApp,
  isNetworkError,
  readIdentityCache,
  saveIdentityCache,
  type CachedIdentity,
} from "../src/lib/offline/identity-cache";

// Slice S1 — cached identity for offline cold start. The cache is only
// trusted when a stored session also exists (see checkAuthUser), so these
// tests cover the storage contract itself: round-trip + merge, identity
// switches, soft failure on corrupt/unavailable storage, the per-user
// guard, and the network-error vs auth-error distinction that decides
// whether a failed getUser() signs the user out or restores from cache.

type StorageStub = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function installStorageStub(stub: StorageStub): void {
  (globalThis as unknown as Record<string, unknown>).localStorage = stub;
}

function mapStorage(values: Map<string, string>): StorageStub {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const throwingStorage: StorageStub = {
  getItem: () => {
    throw new Error("storage unavailable");
  },
  setItem: () => {
    throw new Error("storage unavailable");
  },
  removeItem: () => {
    throw new Error("storage unavailable");
  },
};

const PROFILE: CachedIdentity = {
  profileId: "profile-1",
  organizationId: "org-1",
  displayName: "Umair",
  email: "owner@example.com",
  role: "owner",
  booksCurrency: "EUR",
  profileRow: { id: "profile-1", organization_id: "org-1", display_name: "Umair", role: "owner" },
  organizationRow: null,
  cachedAt: new Date().toISOString(),
};

const ORG_ROW = {
  id: "org-1",
  name: "OP TRADERS",
  books_currency: "EUR",
  regional_preferences: { language: "en" },
};

async function main(): Promise<void> {
  // 1. Storage throws on every call → every function soft-fails, none throws.
  {
    installStorageStub(throwingStorage);
    assert.equal(readIdentityCache(), null, "unavailable storage reads as no cache");
    saveIdentityCache(PROFILE);
    assert.equal(readIdentityCache(), null, "unavailable storage never persists a write");
    clearIdentityCache();
  }

  const values = new Map<string, string>();
  installStorageStub(mapStorage(values));

  // 2. Empty cache → null.
  assert.equal(readIdentityCache(), null, "no cached identity before any save");

  // 3. Round-trip: profile part saves and reads back whole, with a fresh timestamp.
  {
    const before = new Date().toISOString();
    saveIdentityCache(PROFILE);
    const cached = readIdentityCache();
    assert.ok(cached, "saved identity reads back");
    assert.equal(cached?.profileId, "profile-1");
    assert.equal(cached?.organizationId, "org-1");
    assert.equal(cached?.displayName, "Umair");
    assert.equal(cached?.email, "owner@example.com");
    assert.equal(cached?.role, "owner");
    assert.equal(cached?.booksCurrency, "EUR");
    assert.deepEqual(cached?.profileRow, PROFILE.profileRow);
    assert.ok(cached && cached.cachedAt >= before, "cachedAt is stamped at write time");
  }

  // 4. Merge: saving the org part keeps the profile part.
  {
    saveIdentityCache({ organizationId: "org-1", organizationRow: ORG_ROW, booksCurrency: "EUR" });
    const cached = readIdentityCache();
    assert.equal(cached?.profileId, "profile-1", "org write keeps the profile part");
    assert.equal(cached?.displayName, "Umair");
    assert.deepEqual(cached?.organizationRow, ORG_ROW, "org row is stored");
    assert.equal(cached?.booksCurrency, "EUR");
  }

  // 5. Identity switch (different profile) resets the entry — a stale
  // profile must never mix with a new account.
  {
    saveIdentityCache({
      profileId: "profile-2",
      organizationId: "org-1",
      displayName: "Second User",
      email: null,
      role: "salesman",
      profileRow: { id: "profile-2", organization_id: "org-1" },
    });
    const cached = readIdentityCache();
    assert.equal(cached?.profileId, "profile-2");
    assert.equal(cached?.displayName, "Second User");
    assert.equal(cached?.organizationRow, null, "org part from the old identity is dropped");
  }

  // 6. Org switch (different organization, complete write) resets the
  // entry the same way — the old profile row never mixes with the new org.
  // (An org-only write for a different org cannot form a valid identity
  // on its own, so it is a no-op by design.)
  {
    saveIdentityCache({ profileId: "profile-2", organizationId: "org-2", displayName: "Second User" });
    saveIdentityCache({ organizationId: "org-3", organizationRow: { id: "org-3", name: "Other Org" } });
    const stillOld = readIdentityCache();
    assert.equal(stillOld?.organizationId, "org-2", "an org-only write for a new org cannot form an identity");
    saveIdentityCache({
      profileId: "profile-9",
      organizationId: "org-3",
      displayName: "Third User",
      profileRow: { id: "profile-9", organization_id: "org-3" },
      organizationRow: { id: "org-3", name: "Other Org" },
    });
    const cached = readIdentityCache();
    assert.equal(cached?.organizationId, "org-3");
    assert.equal(cached?.profileId, "profile-9");
    assert.equal(cached?.displayName, "Third User");
    assert.deepEqual(cached?.organizationRow, { id: "org-3", name: "Other Org" });
    clearIdentityCache();
  }

  // 7. Clear → null.
  {
    saveIdentityCache(PROFILE);
    assert.ok(readIdentityCache(), "entry present before clear");
    clearIdentityCache();
    assert.equal(readIdentityCache(), null, "clear drops the entry");
  }

  // 8. Corrupt JSON → null, no throw.
  {
    values.set(IDENTITY_CACHE_STORAGE_KEY, "{not json");
    assert.equal(readIdentityCache(), null, "corrupt JSON reads as no cache");
  }

  // 9. Wrong shape → null, no throw.
  {
    values.set(IDENTITY_CACHE_STORAGE_KEY, JSON.stringify({}));
    assert.equal(readIdentityCache(), null, "an empty object is not an identity");
    values.set(
      IDENTITY_CACHE_STORAGE_KEY,
      JSON.stringify({ profileId: 123, organizationId: "org-1", cachedAt: "2026-11-17T00:00:00.000Z" }),
    );
    assert.equal(readIdentityCache(), null, "a non-string profile id is not an identity");
    values.delete(IDENTITY_CACHE_STORAGE_KEY);
  }

  // 10. Per-user guard: the cache is only restored for its own user.
  {
    saveIdentityCache(PROFILE);
    const cached = readIdentityCache();
    assert.equal(identityCacheForUser(cached, "profile-1"), cached, "own user gets the entry");
    assert.equal(identityCacheForUser(cached, "profile-2"), null, "another user never gets a stale entry");
    assert.equal(identityCacheForUser(cached, null), null, "no user id, no entry");
    assert.equal(identityCacheForUser(null, "profile-1"), null, "no entry, no restore");
    clearIdentityCache();
  }

  // 11. Network-error vs auth-error distinction. In this Node process
  // navigator is undefined, so the onLine branch is skipped and the
  // message alone decides — the browser adds the onLine signal on top.
  {
    assert.equal(isNetworkError(new TypeError("Failed to fetch")), true, "fetch failure is a network error");
    assert.equal(isNetworkError(new Error("Network request failed")), true);
    assert.equal(isNetworkError(new Error("fetch failed")), true);
    assert.equal(isNetworkError(new Error("Load failed")), true);
    assert.equal(isNetworkError(new Error("The network connection was lost.")), true);
    assert.equal(isNetworkError(new Error("Invalid login credentials")), false, "wrong credentials is an auth error");
    assert.equal(isNetworkError(new Error("JWT expired")), false, "expired token is an auth error");
    assert.equal(isNetworkError(new Error("User not found")), false);
    assert.equal(isNetworkError({ message: "Email not confirmed" }), false, "plain objects with a message are read");
    assert.equal(isNetworkError(null), false);
    assert.equal(isNetworkError(undefined), false);
    assert.equal(isNetworkError(""), false);
  }

  // 12. Desktop detection: false with neither signal, true with each.
  {
    delete process.env.NEXT_PUBLIC_DESKTOP;
    delete (globalThis as unknown as Record<string, unknown>).window;
    assert.equal(isDesktopApp(), false, "no bridge and no env flag is not the desktop app");
    process.env.NEXT_PUBLIC_DESKTOP = "1";
    assert.equal(isDesktopApp(), true, "the build-time desktop flag counts");
    delete process.env.NEXT_PUBLIC_DESKTOP;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aankhDesktop: { isDesktop: true, platform: "win32" } },
    });
    assert.equal(isDesktopApp(), true, "the Electron preload bridge counts");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    assert.equal(isDesktopApp(), false, "a window without the bridge is not the desktop app");
  }

  console.log("test-identity-cache: all assertions passed");
}

void main();
