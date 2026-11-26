"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ensureOrganizationClaimInSession } from "@/lib/supabase/session-claim";
import { provisionViaCloud } from "@/lib/desktop/cloud-endpoint";
import { isDesktopApp } from "@/lib/offline/identity-cache";
import { resolveDesktopCallbackRoute, shouldRunProvision } from "@/lib/offline/desktop-provision";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      if (new URLSearchParams(window.location.search).get("type") === "recovery") {
        router.replace("/reset");
        return;
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
  }, [router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-card px-4">
      <p role="status" className="aankh-auth-card w-full max-w-[380px] text-center text-sm text-muted-foreground">Completing sign in...</p>
    </main>
  );
}
