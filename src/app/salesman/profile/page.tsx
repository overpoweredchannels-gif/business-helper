"use client";

import { MySalesPerformance } from "@/components/salesman/MySalesPerformance";
import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { formatDate } from "@/lib/tradeos/formatters";
import { EmployeeLiveTracking } from "@/components/dashboard";
import { User, Briefcase, Phone, Calendar, Hash, Building2, Loader2, AlertCircle } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { renderDeferred, type DeferredMessage } from "@/lib/regional/deferred";

export default function ProfilePage() {
  const { t } = useRegional();
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | DeferredMessage | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/staff/me");
        const data = await res.json();
        if (data.ok && data.me) setMe(data.me);
        else setError(data.error || { key: 'salesman.profile.loadError' });
      } catch (err) {
        setError(err instanceof Error ? err.message : { key: 'salesman.att.networkError' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">{t('salesman.profile.loading')}</p>
      </div>
    );
  }

  if (error) {
    return <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive"><AlertCircle className="size-4 mt-0.5 shrink-0" /> {typeof error === "string" ? error : renderDeferred(t, error)}</div>;
  }

  const profile = me?.profile ?? {};
  const employee = me?.employee ?? {};

  const row = (label: string, value: string | undefined | null, Icon: React.ComponentType<{ className?: string }>) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-sm text-body">
        <Icon className="size-4 text-primary" /> {label}
      </div>
      <div className="text-sm font-medium text-foreground text-end"><bdi>{value || "—"}</bdi></div>
    </div>
  );

  return (
    <div className="grid gap-6 max-w-2xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('salesman.profile.title')}</h1>
        <p className="text-sm text-body mt-1">{t('salesman.profile.subtitle')}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 flex items-center gap-4">
        <div className="size-16 rounded-2xl bg-primary flex items-center justify-center font-heading font-bold text-2xl text-primary-foreground">
          {(employee.full_name || profile.display_name || "S").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="font-heading font-bold text-xl text-foreground"><bdi>{employee.full_name || profile.display_name}</bdi></div>
          <div className="text-sm text-body capitalize">{(employee.designation ?? profile.role ?? "staff").replace(/_/g, " ")}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card px-6 py-2">
        {row(t('salesman.profile.fullName'), employee.full_name || profile.full_name, User)}
        {row(t('salesman.profile.profileId'), profile.login_id, Hash)}
        {row(t('salesman.profile.designation'), employee.designation, Briefcase)}
        {row(t('salesman.profile.mobile'), employee.phone || profile.phone, Phone)}
        {row(t('salesman.profile.organization'), me?.organization?.name, Building2)}
        {row(t('salesman.profile.joiningDate'), employee.joining_date ? formatDate(employee.joining_date) : null, Calendar)}
        {row(t('salesman.profile.employeeCode'), employee.employee_id, Hash)}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold text-foreground mb-3">{t('salesman.profile.dutyHours')}</h2>
        {me?.organization?.working_hours ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-light-text">{t('salesman.profile.dutyStart')}</div>
              <div className="font-medium text-foreground"><bdi>{me.organization.working_hours.duty_start ?? "08:00"}</bdi></div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-light-text">{t('salesman.profile.dutyEnd')}</div>
              <div className="font-medium text-foreground"><bdi>{me.organization.working_hours.duty_end ?? "16:00"}</bdi></div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-body">{t('salesman.profile.noDutyHours')}</p>
        )}
      </div>

      <div id="my-sales"><MySalesPerformance /></div>
      <EmployeeLiveTracking />
    </div>
  );
}
