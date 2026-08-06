"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, ArrowLeft, TrendingUp, Target, MapPin, Banknote, Calendar, Clock, MessageSquareText, Users, Award } from "lucide-react";
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
    sales: Array<{ id: string; total_amount: number; created_at: string; status: string }>;
    visits: Array<{ id: string; status: string; created_at: string }>;
    collections: Array<{ id: string; amount: number; status: string; created_at: string }>;
  };
}

const METRIC_LABEL: Record<string, string> = {
  revenue: "Revenue",
  orders: "Orders",
  customers: "New Customers",
  products: "Products Sold",
  collections: "Collections",
};

export default function EmployeeLedgerPage() {
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
        setError(json.error || "Failed to load employee ledger");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading employee ledger...</p>
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
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error ?? "Employee not found"}
        </div>
      </div>
    );
  }

  const { employee, aggregates, recent } = data;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/manager/team")} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back
        </button>
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
        <StatCard icon={<TrendingUp className="size-5 text-primary" />} label="Total Sales" value={formatCurrency(aggregates.sales.total)} sublabel={`${aggregates.sales.count} orders`} />
        <StatCard icon={<Target className="size-5 text-warning" />} label="This Month" value={formatCurrency(aggregates.sales.thisMonth)} />
        <StatCard icon={<Banknote className="size-5 text-success" />} label="Collections" value={formatCurrency(aggregates.collections.amount)} sublabel={`${aggregates.collections.approved} approved`} />
        <StatCard icon={<MapPin className="size-5 text-info" />} label="Visits" value={`${aggregates.visits.completed}/${aggregates.visits.total}`} sublabel={`${aggregates.visits.missed} missed`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Calendar className="size-5 text-primary" />} label="Attendance Days" value={aggregates.attendance.days} sublabel={`${aggregates.attendance.present} present`} />
        <StatCard icon={<Clock className="size-5 text-warning" />} label="Late / Absent" value={`${aggregates.attendance.late} / ${aggregates.attendance.absent}`} sublabel={`${aggregates.attendance.leave} leave`} />
        <StatCard icon={<MessageSquareText className="size-5 text-success" />} label="Feedback" value={aggregates.feedback.total} sublabel={`${aggregates.feedback.open} open`} />
        <StatCard icon={<Award className="size-5 text-info" />} label="Total Hours" value={`${aggregates.attendance.totalHours}h`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Target className="size-5 text-primary" /> Targets</h3>
          {aggregates.targets.length === 0 ? (
            <p className="text-sm text-body">No targets set.</p>
          ) : (
            <div className="grid gap-3">
              {aggregates.targets.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-body capitalize">{METRIC_LABEL[t.metric] ?? t.metric} ({t.period})</span>
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
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Users className="size-5 text-primary" /> Profile</h3>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-body">Employee ID</dt><dd className="text-foreground font-medium">{employee.employee_id ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">Designation</dt><dd className="text-foreground font-medium capitalize">{employee.designation ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">Department</dt><dd className="text-foreground font-medium">{employee.department ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">Status</dt><dd className="text-foreground font-medium capitalize">{employee.status ?? "active"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">Joined</dt><dd className="text-foreground font-medium">{employee.joining_date ? formatDate(employee.joining_date) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-body">Phone</dt><dd className="text-foreground font-medium">{employee.phone ?? "—"}</dd></div>
          </dl>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <RecentPanel title="Recent Sales" icon={<TrendingUp className="size-4 text-primary" />} empty="No sales yet">
          {recent.sales.map((s) => (
            <div key={s.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground">{formatCurrency(s.total_amount)}</span>
              <span className="text-xs text-body">{formatDate(s.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
        <RecentPanel title="Recent Visits" icon={<MapPin className="size-4 text-warning" />} empty="No visits yet">
          {recent.visits.map((v) => (
            <div key={v.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground capitalize">{v.status}</span>
              <span className="text-xs text-body">{formatDate(v.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
        <RecentPanel title="Recent Collections" icon={<Banknote className="size-4 text-success" />} empty="No collections yet">
          {recent.collections.map((c) => (
            <div key={c.id} className="flex justify-between py-2 border-b border-border/40 last:border-0">
              <span className="text-sm text-foreground">{formatCurrency(c.amount)}</span>
              <span className="text-xs text-body">{formatDate(c.created_at)}</span>
            </div>
          ))}
        </RecentPanel>
      </div>
    </div>
  );
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
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">{icon} {title}</h4>
      {children || <p className="text-sm text-body">{empty}</p>}
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}