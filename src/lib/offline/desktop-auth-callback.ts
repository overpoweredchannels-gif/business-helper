// Desktop deep-link auth (aankh://auth/callback) — pure parser +
// preload-bridge accessor. The parser is pure on purpose: the slice
// test covers it without a browser, a Supabase client, or Electron.
//
// Why a custom protocol: the desktop app serves itself from a local
// server on a RANDOM loopback port per launch, so no http(s) origin is
// stable enough for Supabase to redirect to. Google OAuth, email
// verification and password recovery all return through
// aankh://auth/callback instead. The URL must be allowlisted in the
// Supabase project (Authentication → URL Configuration → Redirect
// URLs): aankh://auth/callback

/** The deep-link target Supabase redirects to on desktop. */
export const DESKTOP_AUTH_CALLBACK_URL = "aankh://auth/callback";
/** The same target for password recovery (the callback page routes
 * `type=recovery` to /reset). */
export const DESKTOP_AUTH_RECOVERY_CALLBACK_URL =
  "aankh://auth/callback?type=recovery";

export type DesktopAuthCallbackResult =
  | { ok: true; mode: "code"; code: string; type: string | null }
  | {
      ok: true;
      mode: "tokens";
      accessToken: string;
      refreshToken: string;
      type: string | null;
    }
  | { ok: false; error: string };

/** True when the string is an aankh://auth/callback deep link. */
export function isDesktopAuthCallbackUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === DESKTOP_AUTH_CALLBACK_URL ||
      value.startsWith(`${DESKTOP_AUTH_CALLBACK_URL}?`) ||
      value.startsWith(`${DESKTOP_AUTH_CALLBACK_URL}#`))
  );
}

/**
 * Parse a deep-link callback URL. PKCE code links (`?code=…`) are the
 * normal case; implicit hash links (`#access_token=…&refresh_token=…`)
 * are accepted too. Supabase error links surface their message.
 */
export function parseDesktopAuthCallback(
  url: string,
): DesktopAuthCallbackResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That sign-in link is not valid." };
  }
  if (
    parsed.protocol !== "aankh:" ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback"
  ) {
    return { ok: false, error: "That sign-in link is not valid." };
  }
  const params = parsed.searchParams;
  const error = params.get("error");
  if (error) {
    return { ok: false, error: params.get("error_description") || error };
  }
  const type = params.get("type");
  const code = params.get("code");
  if (code) return { ok: true, mode: "code", code, type };
  const hash = new URLSearchParams(
    parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash,
  );
  const hashError = hash.get("error");
  if (hashError) {
    return { ok: false, error: hash.get("error_description") || hashError };
  }
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    return {
      ok: true,
      mode: "tokens",
      accessToken,
      refreshToken,
      type: type ?? hash.get("type"),
    };
  }
  return { ok: false, error: "That sign-in link has no sign-in code." };
}

/** The preload bridge's auth methods, or null outside the desktop shell. */
export type DesktopAuthBridge = {
  onAuthCallback(handler: (url: string) => void): () => void;
  getPendingAuthCallback(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
};

export function desktopAuthBridge(): DesktopAuthBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as unknown as { aankhDesktop?: { auth?: DesktopAuthBridge } }
  ).aankhDesktop;
  return bridge?.auth ?? null;
}
