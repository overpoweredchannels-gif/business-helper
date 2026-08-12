"use client";

import { TrendingUp, DollarSign, Users, Package, ClipboardList, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { KPICard } from "./widgets";

interface MyCustomer {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  creditLimit: string | null;
}

interface TopEntry {
  name: string;
  value: string;
  detail?: string;
}

interface StaffDashboardViewProps {
  userName: string;
  designation?: string | null;
  mySalesCount: number;
  mySalesTotal: string;
  todaySalesCount: number;
  todaySalesTotal: string;
  myCustomersCount: number;
  pendingTasksCount: number;
  myProductsCount: number;
  myTopProducts: TopEntry[];
  myTopCustomers: TopEntry[];
  myCustomers: MyCustomer[];
  myRecentSales: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    total: string;
    date: string;
  }>;
  myPendingTasks: Array<{
    id: string;
    title: string;
    priority: string;
    dueDate?: string;
  }>;
  onQuickAction?: (label: string) => void;
  onKPIClick?: (title: string) => void;
}

export function StaffDashboardView({
  userName,
  designation,
  mySalesCount,
  mySalesTotal,
  todaySalesCount,
  todaySalesTotal,
  myCustomersCount,
  pendingTasksCount,
  myProductsCount,
  myTopProducts,
  myTopCustomers,
  myCustomers,
  myRecentSales,
  myPendingTasks,
  onQuickAction,
  onKPIClick,
}: StaffDashboardViewProps) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-heading">
            {greeting}, <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-sm text-light-text mt-0.5">
            {dateStr}
            {designation ? ` · ${designation}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <KPICard
          title="My Sales"
          value={String(mySalesCount)}
          trend={{ value: todaySalesCount, label: `${todaySalesCount} today` }}
          icon={<TrendingUp className="size-4" />}
          onClick={() => onKPIClick?.("My Sales")}
        />
        <KPICard
          title="My Sales Total"
          value={mySalesTotal}
          trend={{ value: 1, label: `${todaySalesTotal} today` }}
          icon={<DollarSign className="size-4" />}
          onClick={() => onKPIClick?.("My Sales Total")}
        />
        <KPICard
          title="My Customers"
          value={String(myCustomersCount)}
          icon={<Users className="size-4" />}
          onClick={() => onKPIClick?.("My Customers")}
        />
        <KPICard
          title="Pending Tasks"
          value={String(pendingTasksCount)}
          icon={<ClipboardList className="size-4" />}
          onClick={() => onKPIClick?.("Pending Tasks")}
        />
        <KPICard
          title="My Products Sold"
          value={String(myProductsCount)}
          icon={<Package className="size-4" />}
          onClick={() => onKPIClick?.("My Products Sold")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">My Sales by Product</h3>
            <span className="text-[10px] text-light-text uppercase tracking-wider">Top {myTopProducts.length}</span>
          </div>
          {myTopProducts.length === 0 ? (
            <p className="text-sm text-light-text">No sales yet.</p>
          ) : (
            <div className="space-y-2.5">
              {myTopProducts.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground/90 truncate">{p.name}</span>
                  <span className="text-sm font-medium text-foreground shrink-0">
                    {p.value}
                    {p.detail ? <span className="text-light-text font-normal ml-1.5">{p.detail}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">My Sales by Customer</h3>
            <span className="text-[10px] text-light-text uppercase tracking-wider">Top {myTopCustomers.length}</span>
          </div>
          {myTopCustomers.length === 0 ? (
            <p className="text-sm text-light-text">No sales yet.</p>
          ) : (
            <div className="space-y-2.5">
              {myTopCustomers.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground/90 truncate">{c.name}</span>
                  <span className="text-sm font-medium text-foreground shrink-0">{c.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">My Recent Sales</h3>
            <span className="text-[10px] text-light-text uppercase tracking-wider">{myRecentSales.length} invoices</span>
          </div>
          {myRecentSales.length === 0 ? (
            <p className="text-sm text-light-text">No recent sales.</p>
          ) : (
            <div className="space-y-2">
              {myRecentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground/90 truncate">
                      <span className="text-light-text">#{s.invoiceNumber}</span> · {s.customerName}
                    </p>
                    <p className="text-[10px] text-light-text">{s.date}</p>
                  </div>
                  <span className="font-medium text-foreground shrink-0">{s.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">My Customers</h3>
            <span className="text-[10px] text-light-text uppercase tracking-wider">{myCustomers.length} assigned</span>
          </div>
          {myCustomers.length === 0 ? (
            <p className="text-sm text-light-text">No assigned customers.</p>
          ) : (
            <div className="space-y-2">
              {myCustomers.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground/90 truncate">{c.name}</p>
                    <p className="text-[10px] text-light-text truncate">
                      {[c.phone, c.city].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  {c.creditLimit ? (
                    <span className="text-xs text-light-text shrink-0">Credit {c.creditLimit}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">My Tasks</h3>
          <span className="text-[10px] text-light-text uppercase tracking-wider">{myPendingTasks.length} pending</span>
        </div>
        {myPendingTasks.length === 0 ? (
          <p className="text-sm text-light-text">No pending tasks.</p>
        ) : (
          <div className="space-y-2">
            {myPendingTasks.slice(0, 8).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground/90 truncate">{t.title}</span>
                <span className="shrink-0 flex items-center gap-2">
                  {t.dueDate ? <span className="text-[10px] text-light-text">Due {t.dueDate}</span> : null}
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full",
                      t.priority === "high"
                        ? "bg-destructive/10 text-destructive"
                        : t.priority === "low"
                          ? "bg-muted text-light-text"
                          : "bg-warning/10 text-warning",
                    )}
                  >
                    {t.priority}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onQuickAction && (
          <button
            onClick={() => onQuickAction?.("New Sale")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            New Sale <ArrowUpRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
