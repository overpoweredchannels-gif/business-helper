"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OwnerFsmLayout from "@/components/salesman/OwnerFsmLayout";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2 } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notOwner, setNotOwner] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/staff/me");
        const data = await res.json();
        const role = data?.me?.profile?.role;
        if (role === "owner" || role === "admin") {
          setOrgName(data.me.organization?.name ?? null);
          setUserName(data.me.profile?.display_name || data.me.profile?.full_name || null);
        } else {
          setNotOwner(true);
        }
      } catch {
        setNotOwner(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (notOwner) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-card rounded-2xl border border-border p-8 text-center">
          <h1 className="font-heading font-bold text-xl text-foreground mb-2">Owner access required</h1>
          <p className="text-sm text-body mb-6">
            This area is for the business owner to manage field sales, approvals, and monitoring.
          </p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground font-medium"
          >
            Go to main app
          </button>
        </div>
      </div>
    );
  }

  return (
    <OwnerFsmLayout organizationName={orgName} userName={userName}>
      {children}
    </OwnerFsmLayout>
  );
}