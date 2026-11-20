/**
 * Email-link auth helpers (HYBRID Slice 1b).
 *
 * Why this exists: an email link opens in the DEFAULT browser (or on a
 * phone), where no PKCE code_verifier was ever stored. Supabase's default
 * `{{ .ConfirmationURL }}` link therefore only completes in the browser
 * that requested it. The token_hash flow below needs no stored verifier:
 * the emailed link carries `token_hash` + `type`, and the callback redeems
 * it with `verifyOtp`. The PKCE `?code=` path is kept only as a fallback
 * for links minted before the email templates were updated, and its
 * failure is shown as a clear error screen, never a silent bounce to
 * /login.
 *
 * Security notes:
 * - Token material (`token_hash`, `code`) is read from the URL, redeemed
 *   once, and stripped from the address bar before any async work. It is
 *   never written to a log, console output, error message or server.log.
 * - `next` is allow-listed to fixed same-origin paths. Anything else
 *   falls back to `/`. No open redirect.
 * - The recovery-session check is a UI gate only. The password update
 *   itself is authorized by the session; a signed-in user can always
 *   change their own password. The gate only decides whether the /reset
 *   form is shown or the expired-link screen.
 */
import type { EmailOtpType } from "@supabase/supabase-js";

/** Email-link types this app sends. Anything else is rejected. */
export const EMAIL_LINK_TYPES = ["email", "recovery"] as const;

export function isEmailLinkType(value: string | null): value is EmailOtpType {
  return value === "email" || value === "recovery";
}

/**
 * Paths an email link may redirect to after verification. Absolute URLs
 * are accepted only when they are on this app's own origin.
 */
export const SAFE_NEXT_PATHS = ["/", "/onboarding", "/reset", "/auth/callback"] as const;

/**
 * Resolve a `next` value to a safe same-origin path, or the fallback.
 * Rejects cross-origin URLs, protocol-relative URLs, backslashes and any
 * path outside the allow-list. Returns only the pathname, never a query
 * string, so no extra parameters survive the redirect.
 */
export function resolveSafeNext(raw: string | null, fallback = "/"): string {
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin) return fallback;
  if (!(SAFE_NEXT_PATHS as readonly string[]).includes(url.pathname)) return fallback;
  return url.pathname;
}

/** URL parameters that carry token material or auth routing state. */
const EMAIL_LINK_URL_PARAMS = [
  "token_hash",
  "code",
  "type",
  "next",
  "error",
  "error_code",
  "error_description",
] as const;

/**
 * Strip token material and auth routing state from the address bar
 * without reloading, so a refresh cannot replay the link. Runs before any
 * async work in the callback. The hash is dropped too: it can carry
 * implicit-flow tokens, and the auth client has already consumed whatever
 * it needed by the time this runs.
 */
export function stripEmailLinkParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  EMAIL_LINK_URL_PARAMS.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * Marker the callback sets after a successful recovery verification, so
 * the /reset page can tell a recovery session from an ordinary signed-in
 * session in the same tab. A user id is not a credential. The marker is
 * sessionStorage, so it never survives a new tab: a refresh on /reset
 * falls back to the token `amr` check below.
 */
const RECOVERY_SESSION_KEY = "aankh:recovery-session";

export function markRecoverySession(userId: string): void {
  try {
    window.sessionStorage.setItem(RECOVERY_SESSION_KEY, userId);
  } catch {
    // Storage unavailable: the amr check still applies.
  }
}

export function readRecoverySession(): string | null {
  try {
    return window.sessionStorage.getItem(RECOVERY_SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearRecoverySession(): void {
  try {
    window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * True when the access token was minted by an OTP verification (the
 * email-link recovery flow). Supabase records the method in the JWT `amr`
 * claim, either as plain strings (`["otp"]`) or as entries
 * (`[{ "method": "otp", "timestamp": ... }]`). A password sign-in carries
 * `password` instead, and an OAuth sign-in carries `oauth`.
 */
export function isRecoverySession(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  const payload = decodeTokenPayload(accessToken);
  if (!payload) return false;
  const amr = payload.amr as unknown;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === "string") return entry === "otp";
    if (entry && typeof entry === "object") {
      return (entry as Record<string, unknown>).method === "otp";
    }
    return false;
  });
}
