"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { ensureOrganizationClaimInSession } from "@/lib/supabase/session-claim";
import { provisionViaCloud } from "@/lib/desktop/cloud-endpoint";
import { isDesktopApp } from "@/lib/offline/identity-cache";
import { resolveDesktopCallbackRoute, shouldRunProvision } from "@/lib/offline/desktop-provision";
import {
  isDesktopOrigin,
  isEmailLinkType,
  isRecoverySession,
  markRecoverySession,
  readRecoverySession,
  stripEmailLinkParams,
} from "@/lib/supabase/email-link-auth";

// Slice 1b: the callback exchanges the email-link token itself instead of
// trusting a single getSession() call. The old code bounced every email
// verification and every password recovery back to /login with no message:
// the PKCE code arrived with no browser-side verifier to exchange it
// against, and the /reset screen never appeared. Error copy below is
// hardcoded English, matching the file's pre-existing "Completing sign
// in..." string. No token, code or token_hash is ever logged.
type CallbackError = {
  title: string;
  body: string;
};

const LINK_EXPIRED: CallbackError = {
  title: "This link has expired",
  body: "Email links work once and expire after an hour. Request a new link from the sign-in page and open the newest email.",
};

const LINK_EXPIRED_RECOVERY: CallbackError = {
  title: "This reset link has expired",
  body: "Password reset links work once and expire after an hour. Request a new reset link from the sign-in page and open the newest email.",
};

const LINK_UNSUPPORTED: CallbackError = {
  title: "This link isn't supported",
  body: "Request a new link from the sign-in page and open the newest email.",
};

const PKCE_OTHER_BROWSER: CallbackError = {
  title: "This link can't be used in this browser",
  body: "This sign-in link was opened in a different browser from the one that requested it, or it has expired. Request a new link from the sign-in page and open it in the same browser.",
};

const PKCE_OTHER_BROWSER_RECOVERY: CallbackError = {
  title: "This link can't be used in this browser",
  body: "This password-reset link was opened in a different browser from the one that requested it, or it has expired. Request a new reset link from the sign-in page and open it in the same browser.",
};

/**
 * Read the current session, waiting briefly for the auth client to finish
 * persisting a session it just minted (verifyOtp / code exchange). Returns
 * null when no session appears within the window.
 */
async function waitForSession(timeoutMs: number): Promise<Session | null> {
  const started = Date.now();
  for (;;) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    if (Date.now() - started > timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<CallbackError | null>(null);
  const [desktopVerified, setDesktopVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fail = (next: CallbackError) => {
      if (!cancelled) setError(next);
    };

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const rawType = params.get("type");
      const code = params.get("code");
      const linkOrigin = params.get("origin");
      const urlError = params.get("error");

      // Strip token material from the address bar before any async work,
      // so a refresh cannot replay the link.
      stripEmailLinkParams();

      // Supabase rejected the link itself (expired / already used).
      if (urlError) {
        fail(rawType === "recovery" ? LINK_EXPIRED_RECOVERY : LINK_EXPIRED);
        return;
      }

      let session: Session | null = null;

      if (tokenHash) {
        // Slice 1b primary path: token_hash + verifyOtp needs no stored
        // PKCE verifier, so the link works in any browser or device.
        if (!isEmailLinkType(rawType)) {
          fail(LINK_UNSUPPORTED);
          return;
        }
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: rawType,
        });
        if (verifyError || !data.session) {
          fail(rawType === "recovery" ? LINK_EXPIRED_RECOVERY : LINK_EXPIRED);
          return;
        }
        session = await waitForSession(4000);
        if (!session) {
          fail(rawType === "recovery" ? LINK_EXPIRED_RECOVERY : LINK_EXPIRED);
          return;
        }
        if (rawType === "recovery") {
          markRecoverySession(session.user.id);
          router.replace("/reset");
          return;
        }
        // Round 2: a desktop-origin signup was verified in the DEFAULT
        // browser, not in the app — the browser session cannot be handed
        // to the app, and the app provisions on its own sign-in. Show the
        // desktop message and stop here instead of routing to onboarding
        // or the dashboard in this browser. `origin` is the signup's
        // RedirectTo carried by the email template; only the token_hash
        // path can carry it (legacy PKCE links were minted with `next`,
        // not `origin`).
        if (rawType === "email" && isDesktopOrigin(linkOrigin)) {
          if (!cancelled) setDesktopVerified(true);
          return;
        }
      } else if (code) {
        // PKCE fallback, kept for links minted before the email templates
        // were updated to token_hash. The browser client may already have
        // exchanged the code during init (Google sign-in does this), so a
        // session is checked first and the explicit exchange runs only
        // when none appears; a second exchange attempt after that is
        // still checked, because the auto-exchange can land in between.
        session = await waitForSession(2000);
        if (!session) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (!exchangeError && data.session) session = data.session;
          if (!session) session = await waitForSession(1500);
        }
        if (!session) {
          fail(rawType === "recovery" ? PKCE_OTHER_BROWSER_RECOVERY : PKCE_OTHER_BROWSER);
          return;
        }
        if (rawType === "recovery") {
          markRecoverySession(session.user.id);
          router.replace("/reset");
          return;
        }
      } else {
        // No token to redeem: a session may already exist (the client
        // auto-exchanged a code before this effect ran). Anything else is
        // a stale or pasted link, shown as an error, never a silent
        // bounce to /login.
        const { data } = await supabase.auth.getSession();
        session = data.session;
        if (!session) {
          fail(LINK_EXPIRED);
          return;
        }
        if (rawType === "recovery") {
          if (
            isRecoverySession(session.access_token) ||
            readRecoverySession() === session.user.id
          ) {
            markRecoverySession(session.user.id);
            router.replace("/reset");
            return;
          }
          fail(LINK_EXPIRED_RECOVERY);
          return;
        }
      }

      const token = session.access_token;

      // Desktop (2026-11-19): the local server has no SUPABASE_SERVICE_ROLE_KEY,
      // so POST /api/auth/provision always 500s there and the old code bounced
      // every completed Google sign-in / email verification back to /login.
      // Skip the provision POST on desktop and route by reading the user's own
      // profile row with the browser client instead (user JWT, no service key).
      // Web behaviour below is exactly unchanged.
      if (
        !shouldRunProvision({
          isDesktop: isDesktopApp(),
          isOnline: typeof navigator === "undefined" || navigator.onLine,
        })
      ) {
        // Client-side token refresh only (getSession / refreshSession via the
        // browser client) — needs no service key, so it stays in the desktop
        // path. Harmless if the claim is absent: routing here reads the
        // profile row, not the claim.
        await ensureOrganizationClaimInSession();

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, organization_id")
          .eq("id", session.user.id)
          .maybeSingle();

        if (profileError) {
          // The session is valid — a profile-read failure must not bounce the
          // user to /login. Route home and let checkAuthUser / loadProfile
          // resolve the session.
          console.warn(
            "Desktop auth callback: profile read failed, routing home:",
            profileError.message,
          );
          router.push("/");
          return;
        }

        router.push(resolveDesktopCallbackRoute(Boolean(profile?.organization_id)));
        return;
      }

      try {
        // Slice 1: provision runs on the cloud endpoint via the helper —
        // on desktop the local server has no service key and the relative
        // URL would 500; on web the helper keeps the relative URL.
        const provisionBody = await provisionViaCloud({ accessToken: token });

        // The token minted during the OAuth exchange predates provisioning.
        // Force a refresh so the browser session immediately carries the
        // organization_id claim required by RLS.
        await ensureOrganizationClaimInSession();

        // Round 2: no `next` from the link — the destination comes from
        // the link type and the provision result. Fresh user → onboarding,
        // existing user → home.
        if (provisionBody.needsOnboarding) {
          router.push("/onboarding");
        } else {
          router.push("/");
        }
      } catch {
        router.push("/login");
      }
    };

    handleCallback();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-panel p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary-light">
            <AlertCircle className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">{error.title}</h1>
          <p className="mt-2 text-sm text-body">{error.body}</p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-all hover:shadow-md"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (desktopVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-panel p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary-light">
            <CheckCircle2 className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Email verify ho gayi, ab Aankh app mein sign in karein.</h1>
          <p className="mt-2 text-sm text-body">Your email is verified. Open the Aankh app on your PC and sign in with your email and password.</p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-all hover:shadow-md"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Completing sign in...</p>
    </div>
  );
}
