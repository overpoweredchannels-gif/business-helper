"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle } from "lucide-react";

interface MeResponse {
  ok: boolean;
  me?: {
    profile: any;
    employee: any;
    organization: { name?: string | null };
  };
  error?: string;
}

export default function SupervisorProfilePage() {
  const [me, setMe] = useState<MeResponse["me"] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/staff/me");
      const data: MeResponse = await res.json();
      if (data.ok) setMe(data.me);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading profile...</p>
      </div>
    );
  }

  const emp = me?.employee;
  const profile = me?.profile;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">My Profile</h1>
        <p className="text-sm text-body mt-1">Supervisor account details.</p>
      </div>

      {!emp && !profile ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" /> Could not load profile.
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <div className="size-16 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-2xl text-primary">
              {(emp?.full_name || profile?.full_name || "S").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="font-heading font-bold text-xl text-foreground">{emp?.full_name || profile?.full_name || "Supervisor"}</div>
              <div className="text-sm text-body capitalize">{emp?.designation ?? "supervisor"}</div>
            </div>
          </div>
          <dl className="grid gap-3 text-sm">
            <Row label="Employee ID" value={emp?.employee_id} />
            <Row label="Phone" value={emp?.phone} />
            <Row label="Email" value={profile?.email || emp?.email} />
            <Row label="Department" value={emp?.department} />
            <Row label="Status" value={emp?.status ?? profile?.role} />
            <Row label="Organization" value={me?.organization?.name} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-body">{label}</dt>
      <dd className="text-foreground font-medium text-right">{value ?? "—"}</dd>
    </div>
  );
}