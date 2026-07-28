"use client";

import {
  KPICard,
  AIInsightCard,
  BusinessHealthCard,
  QuickActions,
  SmartModule,
  RecentActivity,
  ChartsSection,
} from "./widgets";
import { TrendingUp, TrendingDown, DollarSign, Package, Users, Receipt, AlertTriangle, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SmartModuleConfig {
  id: string;
  title: string;
  summary: string;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
  onOpen?: () => void;
  children?: React.ReactNode;
}

interface LowStockItem {
  productName: string;
  currentStock: number;
  reorderLevel: number;
}

interface DashboardViewProps {
  userName: string;
  todaySales?: { value: string; trend?: { value: number; label: string }; sparkline?: number[] };
  todayProfit?: { value: string; trend?: { value: number; label: string }; sparkline?: number[] };
  inventoryValue?: { value: string; trend?: { value: number; label: string } };
  outstandingReceivables?: { value: string };
  outstandingPayables?: { value: string };
  lowStockAlerts?: { value: string; count: number };
  ordersToday?: { value: string };
  customersToday?: { value: string };
  aiInsight?: {
    insight: string;
    confidence: number;
    action?: string;
    reason?: string;
    onLearnMore?: () => void;
  };
  healthScore?: number;
  healthMetrics?: Array<{ label: string; value: string; status: "good" | "warning" | "critical" }>;
  recentActivities?: Array<{
    id: string;
    type: "sale" | "purchase" | "payment" | "stock" | "customer" | "task";
    description: string;
    time: string;
    amount?: string;
  }>;
  pendingTasks?: Array<{ id: string; title: string; priority: string; dueDate?: string }>;
  invoicesDue?: number;
  paymentsDue?: number;
  lowStockItems?: number;
  customersToFollowUp?: number;
  expiringProducts?: number;
  smartModules?: SmartModuleConfig[];
  revenueData?: Array<{ label: string; value: number }>;
  profitData?: Array<{ label: string; value: number }>;
  topProducts?: Array<{ name: string; value: string; trend?: "up" | "down" | "flat" }>;
  topCustomers?: Array<{ name: string; value: string; trend?: "up" | "down" | "flat" }>;
  onQuickAction?: (label: string) => void;
  onKPIClick?: (title: string) => void;
}

export function DashboardView({
  userName,
  todaySales,
  todayProfit,
  inventoryValue,
  outstandingReceivables,
  outstandingPayables,
  lowStockAlerts,
  ordersToday,
  customersToday,
  aiInsight,
  healthScore = 75,
  healthMetrics = [],
  recentActivities = [],
  pendingTasks = [],
  invoicesDue = 0,
  paymentsDue = 0,
  lowStockItems = 0,
  customersToFollowUp = 0,
  expiringProducts = 0,
  smartModules = [],
  revenueData,
  profitData,
  topProducts,
  topCustomers,
  onQuickAction,
  onKPIClick,
}: DashboardViewProps) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const safeInventoryValue = inventoryValue?.value ?? "--";
  const safeReceivables = outstandingReceivables?.value ?? "--";
  const safePayables = outstandingPayables?.value ?? "--";
  const safeLowStock = lowStockAlerts?.count?.toString() ?? "0";

  const taskList = [
    { label: "Invoices Due", value: invoicesDue, icon: Receipt, color: "text-destructive" },
    { label: "Payments Due", value: paymentsDue, icon: DollarSign, color: "text-warning" },
    { label: "Low Stock Items", value: lowStockItems, icon: AlertTriangle, color: "text-warning" },
    { label: "Customers to Follow Up", value: customersToFollowUp, icon: Users, color: "text-primary" },
    { label: "Expiring Products", value: expiringProducts, icon: Package, color: "text-destructive" },
  ].filter((t) => t.value > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-heading">
            {greeting}, <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-sm text-light-text mt-0.5">{dateStr}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {todaySales && (
          <KPICard
            title="Today's Sales"
            value={todaySales.value}
            trend={todaySales.trend}
            icon={<TrendingUp className="size-4" />}
            sparklineData={todaySales.sparkline}
            onClick={() => onKPIClick?.("Today's Sales")}
          />
        )}
        {todayProfit && (
          <KPICard
            title="Today's Profit"
            value={todayProfit.value}
            trend={todayProfit.trend}
            icon={<TrendingDown className="size-4" />}
            sparklineData={todayProfit.sparkline}
            onClick={() => onKPIClick?.("Today's Profit")}
          />
        )}
        {inventoryValue && (
          <KPICard
            title="Inventory Value"
            value={safeInventoryValue}
            trend={inventoryValue.trend}
            icon={<Package className="size-4" />}
            onClick={() => onKPIClick?.("Inventory Value")}
          />
        )}
        {outstandingReceivables && (
          <KPICard
            title="Outstanding Receivables"
            value={safeReceivables}
            icon={<Users className="size-4" />}
            onClick={() => onKPIClick?.("Outstanding Receivables")}
          />
        )}
        {outstandingPayables && (
          <KPICard
            title="Outstanding Payables"
            value={safePayables}
            icon={<DollarSign className="size-4" />}
            onClick={() => onKPIClick?.("Outstanding Payables")}
          />
        )}
        {lowStockAlerts && (
          <KPICard
            title="Low Stock Alerts"
            value={safeLowStock}
            icon={<AlertTriangle className="size-4" />}
            onClick={() => onKPIClick?.("Low Stock Alerts")}
          />
        )}
        {ordersToday && (
          <KPICard
            title="Orders Today"
            value={ordersToday.value}
            icon={<Receipt className="size-4" />}
            onClick={() => onKPIClick?.("Orders Today")}
          />
        )}
        {customersToday && (
          <KPICard
            title="Customers Today"
            value={customersToday.value}
            icon={<Users className="size-4" />}
            onClick={() => onKPIClick?.("Customers Today")}
          />
        )}
      </div>

      {/* AI Insight */}
      {aiInsight && (
        <AIInsightCard
          insight={aiInsight.insight}
          confidence={aiInsight.confidence}
          action={aiInsight.action}
          reason={aiInsight.reason}
          onLearnMore={aiInsight.onLearnMore}
        />
      )}

      {/* Business Health + Quick Actions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <BusinessHealthCard score={healthScore} metrics={healthMetrics} />
        </div>
        <div>
          <QuickActions onAction={onQuickAction} />
        </div>
      </div>

      {/* Smart Modules */}
      {smartModules.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Business Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {smartModules.map((m) => (
              <SmartModule key={m.id} title={m.title} summary={m.summary} badge={m.badge} badgeColor={m.badgeColor} onOpen={m.onOpen}>
                {m.children}
              </SmartModule>
            ))}
          </div>
        </div>
      )}

      {/* Pending Tasks */}
      {taskList.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Needs Your Attention</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {taskList.map((t) => (
              <div key={t.label} className="flex items-center gap-2.5 p-3 rounded-lg bg-muted">
                <t.icon className={cn("size-5", t.color)} />
                <div>
                  <p className="text-lg font-semibold text-foreground">{t.value}</p>
                  <p className="text-[10px] text-light-text">{t.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      {(revenueData || profitData || topProducts || topCustomers) && (
        <ChartsSection
          revenueData={revenueData}
          profitData={profitData}
          topProducts={topProducts}
          topCustomers={topCustomers}
        />
      )}

      {/* Recent Activity */}
      {recentActivities.length > 0 && (
        <RecentActivity activities={recentActivities} />
      )}
    </div>
  );
}
