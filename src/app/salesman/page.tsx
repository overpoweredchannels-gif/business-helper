"use client";
import { hasSalesTool, type SalesAccess } from "@/lib/sales/access";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { EmployeeLiveTracking } from "@/components/dashboard";
import {
  AlertCircle, ArrowUpRight, BarChart3, Bell, Briefcase, CalendarDays, ChevronRight,
  CircleDollarSign, ClipboardList, Hash, Loader2, MapPin, Package, Plus,
  Route as RouteIcon, ShoppingBag, Store, User, Users,
} from "lucide-react";

type Workspace = {
  salesAccess?: SalesAccess;
  employee: {
    id: string; employee_id?: string | null; full_name: string; phone?: string | null;
    designation?: string | null; department?: string | null; joining_date?: string | null;
  };
  territory: { id?: string; name?: string; description?: string | null } | null;
  route: { id?: string; name?: string; description?: string | null; route_frequency?: string | null } | null;
  customers: Array<{
    id: string; customer_name: string; shop_name?: string | null; contact_person?: string | null;
    phone?: string | null; area?: string | null; city?: string | null; address?: string | null;
  }>;
  stops: Array<{ id: string; customer_id?: string | null; label?: string | null; stop_order?: number; address?: string | null }>;
  sales: {
    total: number; today: number; thisWeek: number; thisMonth: number; count: number;
    byDate: Array<{ date: string; total: number; count: number }>;
    byProduct: Array<{ product_id: string; name: string; quantity: number; total: number }>;
    byCustomer: Array<{ customer_id: string; name: string; total: number; count: number }>;
    recent: Array<{
      id: string; invoice_number: string; total_amount: number; status?: string | null;
      sale_date?: string | null; created_at: string;
      customers?: { customer_name?: string | null; shop_name?: string | null } | null;
    }>;
  };
};

type Visit = { id: string; visit_status: string };
type Draft = { id: string; status: string };
type NotificationItem = { id: string; title: string; body: string };

export default function SalesmanDashboard() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [dateRange, setDateRange] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const overviewResponse = await authorizedFetch("/api/identity/staff/overview");
      const overview = await overviewResponse.json();
      if (!overviewResponse.ok || !overview.ok) throw new Error(overview.error ?? "Could not load your workspace");
      const nextWorkspace = overview.workspace as Workspace;
      setWorkspace(nextWorkspace);

      const [visitsResponse, draftsResponse, notificationsResponse] = await Promise.all([
        authorizedFetch(`/api/visits/today?employeeId=${nextWorkspace.employee.id}`),
        authorizedFetch("/api/sales/drafts/mine"),
        authorizedFetch("/api/notifications?unread_only=true&limit=5"),
      ]);
      const [visitData, draftData, notificationData] = await Promise.all([
        visitsResponse.json(), draftsResponse.json(), notificationsResponse.json(),
      ]);
      if (visitData.ok) setVisits(visitData.visits ?? []);
      if (draftData.ok) setDrafts(draftData.drafts ?? []);
      if (notificationData.ok) setNotifications(notificationData.notifications ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleDates = useMemo(
    () => [...(workspace?.sales.byDate ?? [])].slice(0, dateRange).reverse(),
    [workspace?.sales.byDate, dateRange],
  );
  const maxDay = Math.max(1, ...visibleDates.map((row) => row.total));

  if (loading) {
    return <div className="flex flex-col items-center justify-center py-24 gap-3"><Loader2 className="size-8 text-primary animate-spin" /><p className="text-sm text-body">Loading your sales workspace…</p></div>;
  }
  if (error || !workspace) {
    return <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-5 text-sm text-destructive flex gap-2"><AlertCircle className="size-4 mt-0.5" />{error ?? "Employee workspace unavailable"}</div>;
  }

  const employee = workspace.employee;
  const sales = workspace.sales;
  const completedVisits = visits.filter((visit) => visit.visit_status === "completed").length;
  const pendingDrafts = drafts.filter((draft) => draft.status === "pending_approval").length;

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm text-body">Welcome back</p><h1 className="font-heading font-bold text-2xl text-foreground">{employee.full_name}</h1><p className="text-xs text-light-text mt-1">Your assigned customers, sales performance, route, and duty tracking.</p></div>
        {hasSalesTool(workspace.salesAccess ?? {}, "invoice") && <Link href="/#sales" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"><Plus className="size-5" /> New Sales Invoice</Link>}
      </header>

      <section className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="size-14 rounded-2xl bg-primary flex items-center justify-center font-heading font-bold text-xl text-primary-foreground">{employee.full_name.slice(0, 1).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="font-heading font-bold text-lg text-foreground">Complete profile</div>
          <div className="text-sm text-body capitalize">{String(employee.designation ?? "staff").replace(/_/g, " ")}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-light-text">
            {employee.employee_id && <span className="inline-flex items-center gap-1"><Hash className="size-3" />{employee.employee_id}</span>}
            {employee.department && <span className="inline-flex items-center gap-1"><Briefcase className="size-3" />{employee.department}</span>}
            {employee.phone && <span className="inline-flex items-center gap-1"><User className="size-3" />{employee.phone}</span>}
            {employee.joining_date && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />Joined {formatDate(employee.joining_date)}</span>}
          </div>
        </div>
        <Link href="/salesman/profile" className="text-sm text-primary hover:underline">View profile</Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Sales" value={money(sales.total)} detail={`${sales.count} confirmed invoices`} icon={CircleDollarSign} />
        <Stat label="Today" value={money(sales.today)} detail="Sales created today" icon={ShoppingBag} />
        <Stat label="This Week" value={money(sales.thisWeek)} detail="Current calendar week" icon={BarChart3} />
        <Stat label="This Month" value={money(sales.thisMonth)} detail="Current month" icon={CalendarDays} />
      </section>

      <section id="assignments" className="grid gap-4 md:grid-cols-3 scroll-mt-20">
        <AssignmentCard icon={MapPin} title="Territory assigned" value={workspace.territory?.name ?? "No territory assigned"} detail={workspace.territory?.description ?? "Ask your manager to assign a territory."} />
        <AssignmentCard icon={RouteIcon} title="Route assigned" value={workspace.route?.name ?? "No route assigned"} detail={workspace.route ? `${workspace.stops.length} stop(s) · ${workspace.route.route_frequency ?? "daily"}` : "Ask your manager to assign a route."} href={workspace.route?.id ? `/salesman/routes/${workspace.route.id}` : undefined} />
        <AssignmentCard icon={Users} title="Customers assigned" value={`${workspace.customers.length} customer(s)`} detail="Only these customers can be selected for a new sale." href="#customers" />
      </section>

      <section id="sales" className="grid gap-6 lg:grid-cols-2 scroll-mt-20">
        <Panel title="Sales by date" icon={CalendarDays} action={<div className="flex rounded-lg border border-border p-0.5">{([7, 30] as const).map((range) => <button key={range} onClick={() => setDateRange(range)} className={`rounded-md px-2.5 py-1 text-xs ${dateRange === range ? "bg-primary text-primary-foreground" : "text-body"}`}>{range} days</button>)}</div>}>
          {visibleDates.length === 0 ? <Empty text="No confirmed sales yet." /> : <div className="grid gap-3">{visibleDates.map((row) => <div key={row.date} className="grid grid-cols-[74px_1fr_auto] items-center gap-3 text-xs"><span className="text-body">{shortDate(row.date)}</span><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, row.total / maxDay * 100)}%` }} /></div><span className="font-medium text-foreground">{money(row.total)}</span></div>)}</div>}
        </Panel>
        <Panel title="Sales ranking by products" icon={Package}><Ranking rows={sales.byProduct.slice(0, 8).map((row) => ({ id: row.product_id, name: row.name, value: money(row.total), detail: `${row.quantity} units` }))} empty="No product sales yet." /></Panel>
        <Panel title="Sales by customer" icon={Store}><Ranking rows={sales.byCustomer.slice(0, 8).map((row) => ({ id: row.customer_id, name: row.name, value: money(row.total), detail: `${row.count} invoice(s)` }))} empty="No customer sales yet." /></Panel>
        <Panel title="Recent sales" icon={ShoppingBag} action={<Link href="/salesman/drafts" className="text-xs text-primary hover:underline">My drafts</Link>}>
          {sales.recent.length === 0 ? <Empty text="No confirmed sales yet." /> : <div className="divide-y divide-border">{sales.recent.slice(0, 8).map((sale) => <div key={sale.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="text-sm font-medium text-foreground truncate">{sale.invoice_number}</div><div className="text-xs text-body truncate">{sale.customers?.shop_name ?? sale.customers?.customer_name ?? "Customer"} · {formatDate(sale.sale_date ?? sale.created_at)}</div></div><span className="text-sm font-semibold text-foreground">{money(sale.total_amount)}</span></div>)}</div>}
        </Panel>
      </section>

      <section id="customers" className="rounded-2xl border border-border bg-card p-5 scroll-mt-20">
        <div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold text-foreground">My assigned customers</h2><p className="text-xs text-body mt-0.5">Direct assignments and customers tagged on your assigned route.</p></div><Link href="/salesman/drafts?new=1" className="inline-flex items-center gap-1 text-xs font-medium text-primary">New Sale <ArrowUpRight className="size-3" /></Link></div>
        {workspace.customers.length === 0 ? <Empty text="No customers assigned. Your manager must assign customers before you can create a sale." /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{workspace.customers.map((customer) => <div key={customer.id} className="rounded-xl border border-border p-4"><div className="font-medium text-sm text-foreground">{customer.shop_name ?? customer.customer_name}</div>{customer.shop_name && <div className="text-xs text-body">{customer.customer_name}</div>}<div className="text-xs text-light-text mt-2">{[customer.area, customer.city].filter(Boolean).join(", ") || customer.address || "No address"}</div>{customer.phone && <div className="text-xs text-light-text mt-1">{customer.phone}</div>}<Link href={`/salesman/drafts?new=1&customer=${customer.id}`} className="mt-3 inline-flex items-center gap-1 text-xs text-primary">Create sale <ChevronRight className="size-3" /></Link></div>)}</div>}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MiniAction href="/salesman/visits" icon={MapPin} title="Today's visits" detail={`${completedVisits}/${visits.length} completed`} />
        <MiniAction href="/salesman/drafts" icon={ClipboardList} title="Draft sales" detail={`${pendingDrafts} pending approval`} />
        <MiniAction href="/salesman/notifications" icon={Bell} title="Recent alerts" detail={`${notifications.length} unread`} />
      </section>

      <section id="tracking" className="scroll-mt-20"><div className="mb-3"><h2 className="font-heading font-bold text-lg text-foreground">Live tracking</h2><p className="text-xs text-body">Start or stop your duty location and review the current tracking state.</p></div><EmployeeLiveTracking /></section>
    </div>
  );
}

function Stat({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wide text-light-text">{label}</span><Icon className="size-4 text-primary" /></div><div className="mt-3 font-heading font-bold text-xl text-foreground">{value}</div><div className="text-xs text-body mt-1">{detail}</div></div>;
}
function AssignmentCard({ icon: Icon, title, value, detail, href }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string; detail: string; href?: string }) {
  const content = <><div className="flex items-center gap-2 text-xs text-light-text"><Icon className="size-4 text-primary" />{title}</div><div className="mt-3 font-semibold text-foreground">{value}</div><div className="mt-1 text-xs text-body">{detail}</div></>;
  return href ? <Link href={href} className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40">{content}</Link> : <div className="rounded-2xl border border-border bg-card p-5">{content}</div>;
}
function Panel({ title, icon: Icon, action, children }: { title: string; icon: React.ComponentType<{ className?: string }>; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between gap-3 mb-4"><h2 className="font-semibold text-foreground flex items-center gap-2"><Icon className="size-4 text-primary" />{title}</h2>{action}</div>{children}</div>;
}
function Ranking({ rows, empty }: { rows: Array<{ id: string; name: string; value: string; detail: string }>; empty: string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  return <div className="divide-y divide-border">{rows.map((row, index) => <div key={row.id} className="flex items-center gap-3 py-3"><div className="size-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{index + 1}</div><div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground truncate">{row.name}</div><div className="text-xs text-body">{row.detail}</div></div><div className="text-sm font-semibold text-foreground">{row.value}</div></div>)}</div>;
}
function MiniAction({ href, icon: Icon, title, detail }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; detail: string }) {
  return <Link href={href} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 hover:border-primary/40"><div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center"><Icon className="size-5 text-primary" /></div><div className="flex-1"><div className="text-sm font-medium text-foreground">{title}</div><div className="text-xs text-body">{detail}</div></div><ChevronRight className="size-4 text-light-text" /></Link>;
}
function Empty({ text }: { text: string }) { return <p className="py-5 text-center text-sm text-body">{text}</p>; }
function money(value: number) { return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatDate(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function shortDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
