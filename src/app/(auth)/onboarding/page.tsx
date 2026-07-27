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
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="mx-auto grid w-[400px] gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One last step. What's your business called?
          </p>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="business-name" className="text-sm font-medium">
              Business Name
            </label>
            <input
              id="business-name"
              type="text"
              required
              placeholder="My Business"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Setting up..." : "Complete Setup"}
          </Button>
        </form>
      </div>
    </div>
  );
}
