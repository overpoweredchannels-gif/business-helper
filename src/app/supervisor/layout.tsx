"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SupervisorLayout from "@/components/salesman/SupervisorLayout";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2 } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";

interface MeResponse {
  ok: boolean;
  me?: {
    profile: any;
    employee: any;
    organization: { name?: string | null };
  };
  error?: string;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse["me"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notSupervisor, setNotSupervisor] = useState(false);
  const { t } = useRegional();

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/staff/me");
        const data: MeResponse = await res.json();
        const role = data?.me?.profile?.role;
        if (data.ok && data.me && role === "supervisor") {
          setMe(data.me);
        } else {
          setNotSupervisor(true);
        }
      } catch {
        setNotSupervisor(true);
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
          <p className="text-sm text-body">{t('supervisor.gate.loading')}</p>
        </div>
      </div>
    );
  }

  if (notSupervisor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-card rounded-2xl border border-border p-8 text-center">
          <h1 className="font-heading font-bold text-xl text-foreground mb-2">{t('supervisor.gate.noAccess')}</h1>
          <p className="text-sm text-body mb-6">
            {t('supervisor.gate.noAccessHint')}
          </p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground font-medium"
          >
            {t('supervisor.gate.goMain')}
          </button>
        </div>
      </div>
    );
  }

  const name = me?.employee?.full_name || me?.profile?.full_name || me?.profile?.display_name || null;

  return (
    <SupervisorLayout organizationName={me?.organization?.name} userName={name}>
      {children}
    </SupervisorLayout>
  );
}