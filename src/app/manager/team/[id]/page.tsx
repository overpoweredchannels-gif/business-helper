"use client";

import { Children, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { formatBooksMoney, formatDate as formatSharedDate } from "@/lib/tradeos/formatters";
import { Loader2, AlertCircle, ArrowLeft, TrendingUp, Target, MapPin, Banknote, Calendar, Clock, MessageSquareText, Users, Award, KeyRound, Route as RouteIcon, Store, Package, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  full_name: string;
  designation?: string;
  employee_id?: string;
  phone?: string;
  status?: string;
  photo_url?: string | null;
  department?: string;
  joining_date?: string;
  assigned_route_id?: string | null;
  assigned_territory_id?: string | null;
}

interface Aggregates {
  sales: { total: number; today: number; thisWeek: number; thisMonth: number; count: number };
  visits: { total: number; completed: number; missed: number; pending: number; today: number };
  collections: { total: number; approved: number; pending: number; amount: number };
  attendance: { days: number; present: number; late: number; absent: number; leave: number; totalHours: number };
  targets: Array<{ id: string; period: string; metric: string; target_value: number; start_date: string; end_date: string }>;
  feedback: { total: number; open: number; resolved: number };
}

interface LedgerData {
  employee: Employee;
  aggregates: Aggregates;
  recent: {
    sales: Array<{ id: string; invoice_number?: string; total_amount: number; created_at: string; sale_date?: string | null; status: string; customers?: { customer_name?: string | null; shop_name?: string | null } | null }>;
    visits: Array<{ id: string; visit_status: string; created_at: string }>;
    collections: Array<{ id: string; amount: number; status: string; created_at: string }>;
  };
  assignment: {
    territory: { id?: string; name?: string; description?: string | null } | null;
    route: { id?: string; name?: string; route_frequency?: string | null } | null;
    stops: Array<{ id: string; label?: string | null; customer_id?: string | null }>;
    customers: Array<{ id: string; customer_name: string; shop_name?: string | null; phone?: string | null; area?: string | null; city?: string | null }>;
  };
  analytics: {
    byDate: Array<{ date: string; total: number; count: number }>;
    byProduct: Array<{ product_id: string; name: string; quantity: number; total: number }>;
    byCustomer: Array<{ customer_id: string; name: string; count: number; total: number }>;
  };
}

export default function EmployeeLedgerPage() {
  const { t } = useRegional();
  const metricLabel = (m: string) => {
    const labels: Record<string, string> = {
      revenue: t('team.metricRevenue'),
      orders: t('team.metricOrders'),
      customers: t('team.metricCustomers'),
      products: t('team.metricProducts'),
      collections: t('team.metricCollections'),
    };
    return labels[m] ?? m;
  };
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const employeeId = params.id;

  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch(`/api/identity/employees/${employeeId}/ledger`);
      const json = await res.json();
      if (json.ok) {
        setData(json);
      } else {
        setError(json.error || t('team.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    } finally {
      setLoading(false);
    }
  }, [employeeId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Books amounts, formatted in the org's books currency (resolved by
  // the manager layout from the identity payload) — never a hardcoded
  // currency, which would mislabel every figure for a non-PKR org.
  const formatCurrency = (n: number) => formatBooksMoney(n);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">{t('team.loading')}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid gap-4">
        <button onClick={() => router.push("/manager/team")} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to Team
        </button>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error ?? t('team.notFound')}
        </div>
      </div>
    );
  }

  const { employee, aggregates, recent, assignment, analytics } = data;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/manager/team")} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back
        </button>
        <button onClick={() => router.push("/manager/live")} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Radar className="size-4" /> Live Tracking</button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-2xl text-primary">
              {employee.full_name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-heading font-bold text-2xl text-foreground truncate">{employee.full_name}</div>
              <div className="flex flex-wrap gap-2 mt-1 text-sm text-body">
                <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
                  {employee.designation ?? "staff"}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize">
                  {employee.status ?? "active"}
                </span>
                {employee.employee_id && <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">ID: {employee.employee_id}</span>}
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-light-text">
                {employee.phone && <span>📞 {employee.phone}</span>}
                {employee.department && <span>🏢 {employee.department}</span>}
                {employee.joining_date && <span>📅 Since {formatDate(employee.joining_date)}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<TrendingUp className="size-5 text-primary" />} label={t('team.totalSales')} value={formatCurrency(aggregates.sales.total)} sublabel={t('team.ordersCount').replace('{count}', String(aggregates.sales.count))} />
        <StatCard icon={<Target className="size-5 text-warning" />} label={t('team.thisMonth')} value={formatCurrency(aggregates.sales.thisMonth)} />
        <StatCard icon={<Banknote className="size-5 text-success" />} label={t('team.metricCollections')} value={formatCurrency(aggregates.collections.amount)} sublabel={t('team.approvedCount').replace('{count}', String(aggregates.collections.approved))} />
        <StatCard icon={<MapPin className="size-5 text-info" />} label={t('team.visits')} value={`${aggregates.visits.completed}/${aggregates.visits.total}`} sublabel={t('team.visitsMissed').replace('{count}', String(aggregates.visits.missed))} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <AssignmentSummary icon={<MapPin className="size-5 text-primary" />} label={t('team.territoryAssigned')} value={assignment.territory?.name ?? t('team.noTerritory')} detail={assignment.territory?.description ?? t('team.noTerritoryDetail')} />
        <AssignmentSummary icon={<RouteIcon className="size-5 text-primary" />} label={t('team.routeAssigned')} value={assignment.route?.name ?? t('team.noRoute')} detail={assignment.route ? t('team.routeDetail').replace('{stops}', String(assignment.stops.length)).replace('{period}', assignment.route.route_frequency ?? "daily") : t('team.noRouteDetail')} />
        <AssignmentSummary icon={<Users className="size-5 text-primary" />} label={t('team.customersAssigned')} value={t('team.customersCount').replace('{count}', String(assignment.customers.length))} detail={t('team.customersDetail')} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Calendar className="size-5 text-primary" />} label={t('team.attendanceDays')} value={aggregates.attendance.days} sublabel={t('team.presentCount').replace('{count}', String(aggregates.attendance.present))} />
        <StatCard icon={<Clock className="size-5 text-warning" />} label={t('team.lateAbsent')} value={t('team.lateAbsentValue').replace('{late}', String(aggregates.attendance.late)).replace('{absent}', String(aggregates.attendance.absent))} sublabel={t('team.leaveCount').replace('{count}', String(aggregates.attendance.leave))} />
        <StatCard icon={<MessageSquareText className="size-5 text-success" />} label={t('team.feedback')} value={aggregates.feedback.total} sublabel={t('team.openCount').replace('{count}', String(aggregates.feedback.open))} />
        <StatCard icon={<Award className="size-5 text-info" />} label={t('team.totalHours')} value={t('team.hoursValue').replace('{count}', String(aggregates.attendance.totalHours))} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Target className="size-5 text-primary" /> {t('team.targets')}</h3>
          {aggregates.targets.length === 0 ? (
            <p className="text-sm text-body">{t('team.noTargets')}</p>
          ) : (
            <div className="grid gap-3">
              {aggregates.targets.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-body capitalize">{metricLabel(t.metric)} ({t.period})</span>
                    <span className="font-medium text-foreground">{t.target_value}</span>
                  </div>
                  <div className="text-xs text-light-text mt-0.5">
                    {formatDate(t.start_date)} → {formatDate(t.end_date)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Users className="size-5 text-primary" /> {t('team.profile')}</h3>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-body">{t('team.employeeId')}</dt><dd className="text-foreground font-medium">{employee.employee_id ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">{t('team.designation')}</dt><dd className="text-foreground font-medium capitalize">{employee.designation ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">{t('team.department')}</dt><dd className="text-foreground font-medium">{employee.department ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">{t('team.status')}</dt><dd className="text-foreground font-medium capitalize">{employee.status ?? "active"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">{t('team.joined')}</dt><dd className="text-foreground font-medium">{employee.joining_date ? formatDate(employee.joining_date) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">{t('team.phone')}</dt><dd className="text-foreground font-medium">{employee.phone ?? "—"}</dd></div>
          </dl>
        </div>

        <ResetPasswordCard employeeId={employeeId} employeeName={employee.full_name} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <RecentPanel title={t('team.recentSales')} icon={<TrendingUp className="size-4 text-primary" />} empty={t('team.noSalesYet')}>
          {recent.sales.map((s) => (
            <div key={s.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground"><span className="block font-medium">{s.invoice_number ?? formatCurrency(s.total_amount)}</span><span className="text-xs text-body">{s.customers?.shop_name ?? s.customers?.customer_name ?? t('pos.customer')}</span></span>
              <span className="text-xs text-body text-right"><span className="block font-medium text-foreground">{formatCurrency(s.total_amount)}</span>{formatDate(s.sale_date ?? s.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
        <RecentPanel title={t('team.recentVisits')} icon={<MapPin className="size-4 text-warning" />} empty={t('team.noVisitsYet')}>
          {recent.visits.map((v) => (
            <div key={v.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground capitalize">{v.visit_status.replaceAll("_", " ")}</span>
              <span className="text-xs text-body">{formatDate(v.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
        <RecentPanel title={t('team.recentCollections')} icon={<Banknote className="size-4 text-success" />} empty={t('team.noCollectionsYet')}>
          {recent.collections.map((c) => (
            <div key={c.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground">{formatCurrency(c.amount)}</span>
              <span className="text-xs text-body">{formatDate(c.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalyticsPanel title={t('team.salesRanking')} icon={<Package className="size-4 text-primary" />} rows={analytics.byProduct.slice(0, 10).map((row) => ({ id: row.product_id, name: row.name, detail: t('team.unitsDetail').replace('{count}', String(row.quantity)), value: formatCurrency(row.total) }))} />
        <AnalyticsPanel title={t('team.salesByCustomer')} icon={<Store className="size-4 text-primary" />} rows={analytics.byCustomer.slice(0, 10).map((row) => ({ id: row.customer_id, name: row.name, detail: t('team.invoicesDetail').replace('{count}', String(row.count)), value: formatCurrency(row.total) }))} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2"><Users className="size-5 text-primary" /> {t('team.assignedCustomers')}</h3>
        <p className="text-xs text-body mb-4">{t('team.availableNote')}</p>
        {assignment.customers.length === 0 ? <p className="text-sm text-body py-4 text-center">{t('team.noCustomersAssigned')}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{assignment.customers.map((customer) => <div key={customer.id} className="rounded-xl border border-border p-4"><div className="text-sm font-medium text-foreground">{customer.shop_name ?? customer.customer_name}</div>{customer.shop_name && <div className="text-xs text-body">{customer.customer_name}</div>}<div className="text-xs text-light-text mt-2">{[customer.area, customer.city].filter(Boolean).join(", ") || t('team.noArea')}</div>{customer.phone && <div className="text-xs text-light-text mt-1">{customer.phone}</div>}</div>)}</div>}
      </div>
    </div>
  );
}

function AssignmentSummary({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-2 text-xs text-body">{icon}{label}</div><div className="font-semibold text-foreground mt-3">{value}</div><div className="text-xs text-light-text mt-1">{detail}</div></div>;
}

function AnalyticsPanel({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<{ id: string; name: string; detail: string; value: string }> }) {
  const { t } = useRegional();
  return <div className="rounded-2xl border border-border bg-card p-5"><h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">{icon}{title}</h3>{rows.length === 0 ? <p className="text-sm text-body py-4 text-center">{t('team.analyticsEmpty')}</p> : <div className="divide-y divide-border">{rows.map((row, index) => <div key={row.id} className="flex items-center gap-3 py-3"><div className="size-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{index + 1}</div><div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground truncate">{row.name}</div><div className="text-xs text-body">{row.detail}</div></div><div className="text-sm font-semibold text-foreground">{row.value}</div></div>)}</div>}</div>;
}

function StatCard({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg bg-primary/10">{icon}</div>
      </div>
      <div className="mt-3">
        <div className="font-heading font-bold text-xl text-foreground">{value}</div>
        <div className="text-xs text-body mt-0.5">{label}</div>
        {sublabel && <div className="text-xs text-light-text mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}

function RecentPanel({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  const hasContent = Children.count(children) > 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">{icon} {title}</h4>
      {hasContent ? children : <p className="text-sm text-body">{empty}</p>}
    </div>
  );
}

function formatDate(d: string) {
  // Date-only values (joining_date, target ranges, sale_date) are stored
  // calendar dates: the shared formatter renders the exact day in every
  // timezone. Timestamps keep this page's weekday rendering.
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return formatSharedDate(d);
  return new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function ResetPasswordCard({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const { t } = useRegional();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const submit = async () => {
    if (!password) {
      setMessage({ type: "error", text: t('team.enterPassword') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await authorizedFetch(`/api/identity/employees/${employeeId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, newPassword: password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t('team.resetFailed'));
      setMessage({ type: "ok", text: t('team.resetSuccess').replace('{name}', employeeName) });
      setPassword("");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('team.resetFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><KeyRound className="size-5 text-warning" /> {t('team.resetPassword')}</h3>
      <p className="text-sm text-body mb-3">{t('team.resetIntro').replace('{name}', employeeName)}</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('team.resetPlaceholder')}
        className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        onClick={submit}
        disabled={saving}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {saving ? t('team.resetting') : t('team.resetPassword')}
      </button>
      {message && (
        <div className={cn("mt-3 text-sm", message.type === "ok" ? "text-success" : "text-destructive")}>
          {message.text}
        </div>
      )}
    </div>
  );
}
