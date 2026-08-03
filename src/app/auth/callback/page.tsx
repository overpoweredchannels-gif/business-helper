"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ensureOrganizationClaimInSession } from "@/lib/supabase/session-claim";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      const token = session.access_token;
      try {
        const provisionRes = await fetch("/api/auth/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });

        if (!provisionRes.ok) {
          const body = await provisionRes.json().catch(() => ({}));
          if (body.code === "email_not_verified") {
            router.push("/login");
            return;
          }
          router.push("/login");
          return;
        }

        const provisionBody = await provisionRes.json();

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
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Completing sign in...</p>
    </div>
  );
}
