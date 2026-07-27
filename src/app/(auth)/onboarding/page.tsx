"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/auth-fuse";

export default function OnboardingPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated.");

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No session.");

      const provisionRes = await fetch("/api/auth/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ organization_name: businessName.trim() }),
      });
      if (!provisionRes.ok) {
        const body = await provisionRes.json().catch(() => ({}));
        throw new Error(body.error || "Setup failed.");
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup.");
    } finally {
      setLoading(false);
    }
  }, [businessName, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="size-9 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-brand font-bold text-lg">T</span>
            </div>
            <span className="font-brand font-bold text-xl text-foreground">TradeOS</span>
          </div>
        </div>
        <div className="bg-card rounded-[18px] border border-border p-6 sm:p-8 shadow-[0_2px_12px_rgba(45,41,38,0.08)]">
          <div className="text-center mb-6">
            <h1 className="font-brand font-bold text-2xl text-foreground">Welcome!</h1>
            <p className="text-body text-sm mt-1.5">
              One last step. What&apos;s your business called?
            </p>
          </div>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="business-name" className="text-sm font-medium text-foreground">
                Business Name
              </label>
              <input
                id="business-name"
                type="text"
                required
                placeholder="My Business"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} size="lg">
              {loading ? "Setting up..." : "Complete Setup"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
