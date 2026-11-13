"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Client-side fetch that attaches the current session's access token as a
 * Bearer header. TradeOS API routes require this header (they authenticate via
 * resolveActor / requireOwner / requirePermission).
 *
 * The session can be momentarily absent right after sign-in or a navigation
 * (the browser client is still restoring it from storage), so a bare
 * getSession() is not treated as "signed out": we re-read once after a short
 * pause and, if the token is still missing, attempt one refresh before the
 * request goes out. A request that still has no token goes out
 * unauthenticated and the API answers 401, exactly as before.
 */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  if (!token) {
    // Give the browser client a moment to restore the session from storage
    // (right after setSession + router.push the first read can race the
    // cookie write).
    await new Promise((resolve) => setTimeout(resolve, 150));
    token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  }
  if (!token) {
    // The stored session may be expired; one refresh can restore it. A
    // genuinely signed-out user has no refresh token, so this fails fast
    // and the request proceeds unauthenticated as before.
    try {
      const { data } = await supabase.auth.refreshSession();
      token = data.session?.access_token ?? null;
    } catch {
      // ignore — the request below will carry no token and the API 401s
    }
    if (!token) {
      token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    }
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}