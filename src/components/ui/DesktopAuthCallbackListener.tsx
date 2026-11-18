"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { isDesktopApp } from "@/lib/offline/identity-cache";
import {
  desktopAuthBridge,
  isDesktopAuthCallbackUrl,
  parseDesktopAuthCallback,
} from "@/lib/offline/desktop-auth-callback";

// Desktop deep-link auth listener. Mounted once in the root layout so
// it is alive on every route — including /login, where the user waits
// after starting Google sign-in or an email verification in the system
// browser. When the aankh://auth/callback link returns, the code (or
// hash tokens) is exchanged for a session HERE, and the app routes to
// /auth/callback, which reuses its existing flow (provision, org-claim
// refresh, /onboarding or /). A failure is shown in the app, never a
// silent return to the login page.
export default function DesktopAuthCallbackListener() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const handledUrls = useRef(new Set<string>());

  useEffect(() => {
    if (!isDesktopApp()) return;
    const bridge = desktopAuthBridge();
    if (!bridge) return;
    let cancelled = false;
    const handleUrl = async (url: string): Promise<void> => {
      if (!isDesktopAuthCallbackUrl(url)) return;
      // The same link can arrive twice (cold start + second instance);
      // exchanging a PKCE code twice fails, so each URL runs once.
      if (handledUrls.current.has(url)) return;
      handledUrls.current.add(url);
      const result = parseDesktopAuthCallback(url);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        if (result.mode === "code") {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(result.code);
          if (exchangeError) throw exchangeError;
        } else {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          });
          if (sessionError) throw sessionError;
        }
        if (cancelled) return;
        router.replace(
          result.type === "recovery"
            ? "/auth/callback?type=recovery"
            : "/auth/callback",
        );
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Sign-in failed. Please try again.",
        );
      }
    };
    // Cold start: the app was closed when the link was clicked.
    void bridge.getPendingAuthCallback().then((pending) => {
      if (!cancelled && pending) void handleUrl(pending);
    });
    // Live: the app was already running when the link was clicked.
    const unsubscribe = bridge.onAuthCallback((url) => {
      void handleUrl(url);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-start justify-center px-4 pt-4"
    >
      <div className="flex w-full max-w-xl items-start gap-3 rounded-[12px] border border-destructive bg-card p-4 shadow-overlay">
        <p className="flex-1 text-sm text-foreground">{error}</p>
        <button
          type="button"
          onClick={() => setError(null)}
          aria-label="Dismiss"
          className="min-h-11 min-w-11 shrink-0 rounded-[8px] px-3 py-2 text-sm font-medium text-primary hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
