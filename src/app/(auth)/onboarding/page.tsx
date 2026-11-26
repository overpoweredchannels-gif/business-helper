"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ensureOrganizationClaimInSession } from "@/lib/supabase/session-claim";
import { provisionViaCloud } from "@/lib/desktop/cloud-endpoint";
import { Button } from "@/components/ui/auth-fuse";
import { useRegional } from "@/components/regional/RegionalProvider";

export default function OnboardingPage() {
  const { t } = useRegional();
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // HYBRID must-have 2 (Slice 1): provision can succeed while the org claim
  // still fails to land in the session token — routing to the dashboard then
  // would show an empty zero dashboard (RLS reads the claim). Block instead.
  const [claimFailed, setClaimFailed] = useState(false);

  const submitOnboarding = useCallback(async () => {
    setError(null);
    setClaimFailed(false);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('auth.onboarding.notAuthenticated'));

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('auth.onboarding.noSession'));

      // Slice 1: the cloud endpoint (Vercel) provisions the workspace — the
      // desktop's local server has no service key and would 500.
      await provisionViaCloud({ accessToken: token, organizationName: businessName.trim() });

      // The token minted before provisioning has no organization_id claim.
      // Refresh and verify it landed before leaving this screen.
      const claimOk = await ensureOrganizationClaimInSession();
      if (!claimOk) {
        setClaimFailed(true);
        return;
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.onboarding.setupFailedFallback'));
    } finally {
      setLoading(false);
    }
  }, [businessName, router, t]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await submitOnboarding();
  }, [submitOnboarding]);

  if (claimFailed) {
    return (
      <div className="aankh-auth-card">
      <div className="text-center mb-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">Workspace setup incomplete</h1>
        <p className="text-body text-sm mt-1.5">
          Your workspace was created, but the organization claim could not be written to your session, so the dashboard cannot load your data yet. Nothing was lost — try again.
        </p>
      </div>
      <Button type="button" disabled={loading} size="lg" onClick={() => void submitOnboarding()}>
        {loading ? t('auth.onboarding.settingUp') : 'Try again'}
      </Button>
      </div>
    );
  }

  return (
    <div className="aankh-auth-card">
      <div className="text-center mb-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.onboarding.welcome')}</h1>
        <p className="text-body text-sm mt-1.5">
          {t('auth.onboarding.welcomePrompt')}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="business-name" className="text-sm font-medium text-foreground">
            {t('settings.businessName')}
          </label>
          <input
            id="business-name"
            type="text"
            required
            placeholder="My Business"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading} size="lg">
          {loading ? t('auth.onboarding.settingUp') : t('auth.onboarding.completeSetup')}
        </Button>
      </form>
    </div>
  );
}
