"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { EmployeeLiveTracking } from "@/components/dashboard";
import {
  MapPin, ClipboardList, Route as RouteIcon, Bell, Users, Loader2,
  CheckCircle2, XCircle, Clock as ClockIcon, ChevronRight, TrendingUp, Banknote,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Visit {
  id: string;
  customer_id: string;
  visit_status: string;
  started_at?: string;
  ended_at?: string;
  customers?: { customer_name?: string; shop_name?: string };
}

interface Draft {
  id: string;
  so_number: string;
  status: string;
  total_amount: number;
  customers?: { customer_name?: string };
}

interface RouteItem {
  id: string;
  name: string;
  assigned_salesman_id?: string | null;
}

interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export default function SalesmanDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [meLoadError, setMeLoadError] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const loadMe = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/staff/me");
      const data = await res.json();
      if (data.ok && data.me?.employee) {
        setEmployeeId(data.me.employee.id);
      } else {
        setMeLoadError(true);
      }
    } catch {
      setMeLoadError(true);
    }
  }, []);

  const loadAll = useCallback(async (empId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [visitsRes, draftsRes, routesRes, notifRes] = await Promise.all([
        authorizedFetch(`/api/visits/today?employeeId=${empId}`),
        authorizedFetch("/api/sales/drafts/mine"),
        authorizedFetch("/api/routes"),
        authorizedFetch("/api/notifications?unread_only=true&limit=5"),
      ]);
      const visitsData = await visitsRes.json();
      const draftsData = await draftsRes.json();
      const routesData = await routesRes.json();
      const notifData = await notifRes.json();

      if (visitsData.ok) setVisits(visitsData.visits ?? []);
      if (draftsData.ok) setDrafts(draftsData.drafts ?? []);
      if (Array.isArray(routesData.routes)) {
        const mine = routesData.routes.filter((r: RouteItem) => r.assigned_salesman_id === empId);
        setRoutes(mine);
      }
      if (notifData.ok) setNotifications(notifData.notifications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (meLoadError) {
      setLoading(false);
      return;
    }
    if (employeeId) {
      loadAll(employeeId);
    }
  }, [employeeId, meLoadError, loadAll]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading your day...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive bg-destructive-bg p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const activeVisit = visits.find((v) => v.visit_status === "in_progress");
  const completedCount = visits.filter((v) => v.visit_status === "completed").length;
  const upcomingCount = visits.filter((v) => v.visit_status === "planned").length;
  const missedCount = visits.filter((v) => v.visit_status === "missed").length;
  const pendingDrafts = drafts.filter((d) => d.status === "pending_approval").length;
  const unreadCount = notifications.length;

  const statCard = (label: string, value: string | number, sub?: string, Icon?: React.ComponentType<{ className?: string }>) => (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-light-text uppercase tracking-wide">{label}</span>
        {Icon && <Icon className="size-4 text-primary" />}
      </div>
      <div className="font-heading font-bold text-2xl text-foreground">{value}</div>
      {sub && <div className="text-xs text-body mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Field Dashboard</h1>
        <p className="text-sm text-body mt-1">{today}</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCard("Visits completed", completedCount, `${upcomingCount} planned remaining`, CheckCircle2)}
        {statCard("Pending drafts", pendingDrafts, `${drafts.length} total`, ClipboardIcon)}
        {statCard("Missed visits", missedCount, "mark on time", AlertCircle)}
        {statCard("Unread alerts", unreadCount, "", Bell)}
      </div>

      {/* Active visit callout */}
      {activeVisit && (
        <div className="rounded-2xl border border-primary/30 bg-primary-light p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full size-3 bg-primary" />
            </span>
            <div>
              <div className="font-medium text-foreground">Visit in progress</div>
              <div className="text-xs text-body">
                {activeVisit.customers?.shop_name || activeVisit.customers?.customer_name || "Customer"} — started{" "}
                {activeVisit.started_at ? new Date(activeVisit.started_at).toLocaleTimeString() : ""}
              </div>
            </div>
          </div>
          <Link
            href={`/salesman/visits/${activeVisit.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Continue visit <ChevronRight className="size-4" />
          </Link>
        </div>
      )}

      {/* Live tracking */}
      <EmployeeLiveTracking />

      {/* Quick actions */}
      <div>
        <h2 className="font-heading font-bold text-lg text-foreground mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction href="/salesman/visits" icon={MapPin} label="Today's Visits" />
          <QuickAction href="/salesman/routes" icon={RouteIcon} label="My Routes" />
          <QuickAction href="/salesman/drafts" icon={ClipboardIcon} label="New Draft Sale" />
          <QuickAction href="/salesman/collections" icon={Banknote} label="Record Collection" />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Assigned routes */}
        <Section title="My assigned routes" href="/salesman/routes">
          {routes.length === 0 ? (
            <Empty text="No routes assigned yet. Ask your manager to assign one." />
          ) : (
            <ul className="divide-y divide-border">
              {routes.map((r) => (
                <li key={r.id}>
                  <Link href={`/salesman/routes/${r.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40 rounded-lg px-2 -mx-2">
                    <div className="flex items-center gap-3">
                      <RouteIcon className="size-4.5 text-primary" />
                      <div>
                        <div className="text-sm font-medium text-foreground">{r.name}</div>
                        <div className="text-xs text-body">View stops & navigate</div>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-light-text" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Recent alerts" href="/salesman/notifications">
          {notifications.length === 0 ? (
            <Empty text="No unread notifications." />
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className="py-3 flex gap-3">
                  <Bell className="size-4.5 text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                    <div className="text-xs text-body line-clamp-2">{n.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Drafts summary */}
      <Section title="My draft sales" href="/salesman/drafts">
        {drafts.length === 0 ? (
          <Empty text="No drafts yet. Create one from a visit." />
        ) : (
          <ul className="divide-y divide-border">
            {drafts.slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{d.so_number}</div>
                  <div className="text-xs text-body">{d.customers?.customer_name}</div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <span className="text-sm font-semibold text-foreground">{fmt(d.total_amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
      <Icon className="size-5 text-primary" />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <Link href={href} className="text-xs text-primary hover:underline">View all</Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-body py-4 text-center">{text}</p>;
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_approval: "bg-warning/10 text-warning",
    approved: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
    converted: "bg-primary/10 text-primary",
    draft: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    pending_approval: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    converted: "Converted",
    draft: "Draft",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", styles[status] ?? "bg-muted text-muted-foreground")}>
      {label[status] ?? status}
    </span>
  );
}

const ClipboardIcon = ({ className }: { className?: string }) => <ClipboardList className={className} />;