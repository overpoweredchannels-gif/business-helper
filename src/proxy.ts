import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase SSR session cookie names: `sb-<project-ref>-auth-token`,
 * chunked as `sb-<ref>-auth-token.0`, `.1`, … when the session is large.
 * Exported for the Slice 7 test.
 */
export const SESSION_COOKIE_RE = /^sb-[^-]+-auth-token(\.\d+)?$/;

/** True when any of the cookie names is a Supabase session cookie. */
export function hasSupabaseSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => SESSION_COOKIE_RE.test(name));
}

/**
 * Server-side network-error check (parity with the client matcher in
 * `src/lib/offline/identity-cache.ts` — `navigator` does not exist in
 * middleware, so this is a local copy). A fetch failure reaching
 * Supabase surfaces as `AuthRetryableFetchError` ("Failed to fetch" /
 * "fetch failed", undici cause codes like ECONNREFUSED) — never as an
 * auth error, which is what a revoked/expired token produces.
 */
export function isProxyNetworkError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AuthRetryableFetchError") return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { message?: unknown } | null)?.message ?? "");
  if (typeof message === "string" && message.length > 0) {
    if (
      /failed to fetch|fetch failed|network|econnrefused|econnreset|enotfound|eai_again|socket hang up|timeout|timed out|offline/i.test(
        message,
      )
    ) {
      return true;
    }
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    const causeMessage = (cause as { message?: unknown }).message;
    if (
      typeof causeCode === "string" &&
      /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE)$/.test(causeCode)
    ) {
      return true;
    }
    if (typeof causeMessage === "string" && /fetch failed|network|econnrefused/i.test(causeMessage)) {
      return true;
    }
  }
  return false;
}

/**
 * Slice 7 (HYBRID, offline cold start) — the proxy's pass-through
 * decision, pure for testing: pass through only when session validation
 * failed with a NETWORK error AND a session cookie exists. A network
 * failure is not proof of sign-out — the stored session is still valid,
 * only unreachable — so the app shell loads and the client restores the
 * cached identity (7-day grace) and re-validates on reconnect. Any
 * non-network failure (revoked/expired token) or a missing cookie still
 * redirects to /login.
 */
export function shouldPassThroughOnAuthError(error: unknown, hasSessionCookie: boolean): boolean {
  return isProxyNetworkError(error) && hasSessionCookie;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const publicPaths = ["/login", "/signup", "/onboarding", "/auth/callback", "/api/auth/provision", "/invite"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/aankh-") ||
    pathname.startsWith("/oppresso-monogram.png")
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Slice 7: `getUser()` returns `{ user: null, error }` on a network
  // failure (offline desktop server) and `_getUser` re-throws
  // non-AuthError exceptions, so both paths are handled. A network
  // failure with a session cookie passes through (see
  // `shouldPassThroughOnAuthError`); anything else keeps the old
  // redirect-to-/login behaviour.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let authError: unknown = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    authError = result.error;
  } catch (caught) {
    authError = caught;
  }

  if (authError) {
    if (
      shouldPassThroughOnAuthError(
        authError,
        hasSupabaseSessionCookie(request.cookies.getAll().map((c) => c.name)),
      )
    ) {
      return supabaseResponse;
    }
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json).*)"],
};
