import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OFFLINE_IDENTITY_GRACE_MS,
  identityCacheForUser,
  isIdentityCacheExpired,
  type CachedIdentity,
} from "../src/lib/offline/identity-cache";
import {
  hasSupabaseSessionCookie,
  shouldPassThroughOnAuthError,
} from "../src/proxy";

/**
 * Slice 7 (HYBRID) — offline cold start (proxy trusts cached session).
 * Rules:
 *  1. Proxy: when session validation fails with a NETWORK error and a
 *     session cookie exists, pass through (no /login redirect). Any
 *     non-network failure, or no cookie, still redirects to /login.
 *  2. Grace: a cached identity is trusted for 7 days after its last
 *     live write (`cachedAt`); past that, the user must sign in again.
 *     Enforced in `identityCacheForUser` and at the getSession-error
 *     restore site, so every restore path is gated the same way.
 *  3. checkAuthUser: the getSession-error branch restores from cache
 *     ONLY on a network error; a non-network failure (refresh actually
 *     failed while online) signs out cleanly — cached identity dropped
 *     too, so a later offline launch cannot resurrect the dead session.
 *  4. A definitively missing session (no session, no error) also drops
 *     the cached identity; a non-network getUser error does the same.
 *  5. Token expired >1h offline still opens the dashboard inside the
 *     grace window: gotrue returns the refresh error from getSession
 *     (network-caused when offline) → rule 3 restores from cache.
 */

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(cachedAt: string, profileId = "profile-1"): CachedIdentity {
  return {
    profileId,
    organizationId: "org-1",
    displayName: "Test Owner",
    email: "owner@example.com",
    role: "owner",
    booksCurrency: "EUR",
    profileRow: null,
    organizationRow: null,
    cachedAt,
  };
}

function sectionAfter(source: string, marker: string, length: number): string {
  const index = source.indexOf(marker);
  assert.ok(index >= 0, `expected marker ${marker}`);
  return source.slice(index, index + length);
}

function networkError(): Error {
  const error = new Error("Failed to fetch") as Error & { name: string };
  error.name = "AuthRetryableFetchError";
  return error;
}

function authError(): Error {
  const error = new Error("Invalid login credentials") as Error & { name: string };
  error.name = "AuthApiError";
  return error;
}

async function main() {
  // Rule 2 — the grace constant and the expiry truth table.
  assert.equal(
    OFFLINE_IDENTITY_GRACE_MS,
    7 * DAY_MS,
    "the offline grace period is exactly 7 days (hardening rule 5)",
  );
  assert.equal(
    isIdentityCacheExpired(entry(new Date(NOW - 60 * 60 * 1000).toISOString()), NOW),
    false,
    "cached 1h ago is fresh",
  );
  assert.equal(
    isIdentityCacheExpired(entry(new Date(NOW - (7 * DAY_MS - 1000)).toISOString()), NOW),
    false,
    "cached 7 days minus 1s ago is still fresh",
  );
  assert.equal(
    isIdentityCacheExpired(entry(new Date(NOW - 7 * DAY_MS).toISOString()), NOW),
    false,
    "cached exactly 7 days ago is fresh — expired only once the grace has elapsed",
  );
  assert.equal(
    isIdentityCacheExpired(entry(new Date(NOW - (7 * DAY_MS + 1)).toISOString()), NOW),
    true,
    "cached 7 days + 1ms ago is expired — login is required",
  );
  assert.equal(
    isIdentityCacheExpired(entry(new Date(NOW - 30 * DAY_MS).toISOString()), NOW),
    true,
    "cached 30 days ago is expired",
  );
  assert.equal(
    isIdentityCacheExpired(entry("not-a-date"), NOW),
    true,
    "an unparseable cachedAt is never trusted",
  );
  assert.equal(isIdentityCacheExpired(null, NOW), true, "no entry is expired");

  // Rule 2 — the per-user guard enforces the grace too.
  const fresh = entry(new Date(NOW - 60 * 60 * 1000).toISOString());
  const stale = entry(new Date(NOW - 8 * DAY_MS).toISOString());
  assert.equal(
    identityCacheForUser(fresh, "profile-1", NOW),
    fresh,
    "own user + fresh cache restores",
  );
  assert.equal(
    identityCacheForUser(stale, "profile-1", NOW),
    null,
    "own user + expired cache does NOT restore — login is required",
  );
  assert.equal(
    identityCacheForUser(fresh, "profile-2", NOW),
    null,
    "another user never gets the entry, fresh or not",
  );
  assert.equal(identityCacheForUser(null, "profile-1", NOW), null, "no entry, no restore");

  // Rule 1 — the proxy pass-through decision.
  assert.equal(
    shouldPassThroughOnAuthError(networkError(), true),
    true,
    "network error + session cookie → pass through, no /login redirect",
  );
  assert.equal(
    shouldPassThroughOnAuthError(new Error("Failed to fetch"), true),
    true,
    "a bare fetch failure is a network error",
  );
  assert.equal(
    shouldPassThroughOnAuthError(
      Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      true,
    ),
    true,
    "a refused connection (undici cause code) is a network error",
  );
  assert.equal(
    shouldPassThroughOnAuthError(networkError(), false),
    false,
    "network error but NO session cookie → still redirect to /login",
  );
  assert.equal(
    shouldPassThroughOnAuthError(authError(), true),
    false,
    "an auth error (revoked/expired token) + cookie → redirect, never pass through",
  );
  assert.equal(
    shouldPassThroughOnAuthError(new Error("JWT expired"), true),
    false,
    "an expired token is an auth error, not a network error",
  );
  assert.equal(
    shouldPassThroughOnAuthError(null, true),
    false,
    "no error at all → no pass-through decision",
  );

  // Rule 1 — session-cookie detection (plain + chunked names).
  assert.equal(
    hasSupabaseSessionCookie(["sb-rtfowunsyrdygyvubnvs-auth-token"]),
    true,
    "the plain session cookie is detected",
  );
  assert.equal(
    hasSupabaseSessionCookie(["sb-rtfowunsyrdygyvubnvs-auth-token.0", "sb-rtfowunsyrdygyvubnvs-auth-token.1"]),
    true,
    "chunked session cookies are detected",
  );
  assert.equal(
    hasSupabaseSessionCookie(["sb-lhqmtgrstvwtysfjjmhz-auth-token", "other-cookie"]),
    true,
    "any project ref counts — the cookie proves a stored session",
  );
  assert.equal(
    hasSupabaseSessionCookie(["theme", "aankh:identity-cache:v1"]),
    false,
    "unrelated cookies are not a session",
  );
  assert.equal(hasSupabaseSessionCookie([]), false, "no cookies → no session");

  // Rule 1 — wiring: the proxy uses the decision on a getUser failure.
  const proxySource = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.ok(proxySource.includes("await supabase.auth.getUser()"), "the proxy validates the session via getUser()");
  assert.ok(
    proxySource.includes("shouldPassThroughOnAuthError"),
    "the proxy consults the pass-through decision on an auth error",
  );
  assert.ok(proxySource.includes("catch (caught)"), "a throwing getUser() is caught, not a 500");
  assert.ok(
    proxySource.includes('url.pathname = "/login"'),
    "the /login redirect is preserved for every non-passthrough case",
  );

  // Rules 3 + 4 — wiring in checkAuthUser.
  const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const sessionErrorBranch = sectionAfter(page, "if (sessionError) {", 2200);
  assert.ok(
    sessionErrorBranch.includes("isNetworkError(sessionError)"),
    "the getSession-error restore happens ONLY on a network error",
  );
  assert.ok(
    sessionErrorBranch.includes("isIdentityCacheExpired(cached)"),
    "the getSession-error restore is grace-gated",
  );
  assert.ok(
    sessionErrorBranch.includes("clearIdentityCache()"),
    "a dead session drops the cached identity — clean sign-out",
  );
  assert.doesNotMatch(
    sessionErrorBranch,
    /if \(isDesktopApp\(\)\) \{\s*\n\s*const cached = await readIdentityCacheAsync\(\);/,
    "the old unconditional desktop restore is gone",
  );
  const noSessionBranch = sectionAfter(page, "if (!sessionData?.session) {", 900);
  assert.ok(
    noSessionBranch.includes("clearIdentityCache()"),
    "a definitively missing session drops the cached identity too",
  );
  const getUserErrorBranch = sectionAfter(page, "getUser error:", 2000);
  assert.ok(
    getUserErrorBranch.includes("identityCacheForUser"),
    "the getUser-error restore still goes through the per-user guard",
  );
  assert.ok(
    getUserErrorBranch.includes("clearIdentityCache()"),
    "a non-network getUser error drops the cached identity too",
  );

  // Rule 2 — wiring: the per-user guard enforces the grace centrally.
  const cacheSource = readFileSync(
    new URL("../src/lib/offline/identity-cache.ts", import.meta.url),
    "utf8",
  );
  const guard = sectionAfter(cacheSource, "export function identityCacheForUser", 700);
  assert.ok(
    guard.includes("isIdentityCacheExpired(entry, now)"),
    "identityCacheForUser returns null for an expired cache",
  );

  console.log(
    "Slice 7 offline cold start passed: proxy passes through on network error + session cookie, 7-day grace enforced on every restore, refresh failure online signs out cleanly (cache dropped), missing session drops the cache.",
  );
}

void main();
