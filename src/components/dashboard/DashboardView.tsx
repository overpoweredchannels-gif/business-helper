"use client";

import {
  KPICard,
  AIInsightCard,
  BusinessHealthCard,
  QuickActions,
  SmartModule,
  RecentActivity,
  RevenueTrendCard,
  ProfitTrendCard,
  TopProductsCard,
  TopCustomersCard,
} from "./widgets";
import { TrendingUp, TrendingDown, DollarSign, Package, Users, Receipt, AlertTriangle, Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardWidget } from "./DashboardWidget";
import type { DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";

interface SmartModuleConfig {
  id: string;
  title: string;
  summary: string;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
  onOpen?: () => void;
  children?: React.ReactNode;
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
  pendingApprovals?: number;
  smartModules?: SmartModuleConfig[];
  revenueData?: Array<{ label: string; value: number }>;
  profitData?: Array<{ label: string; value: number }>;
  topProducts?: Array<{ name: string; value: string; trend?: "up" | "down" | "flat" }>;
  topCustomers?: Array<{ name: string; value: string; trend?: "up" | "down" | "flat" }>;
  onQuickAction?: (label: string) => void;
  onKPIClick?: (title: string) => void;
  onViewAllActivity?: () => void;
  /** Which home-dashboard cards the user has removed (see DashboardCustomizeBar). */
  hiddenWidgets?: DashboardWidgetId[];
  /** True while the user is arranging the dashboard. */
  customizingWidgets?: boolean;
  onRemoveWidget?: (id: DashboardWidgetId) => void;
  onToggleCustomize?: () => void;
  /** Summary cards the user dropped onto the dashboard from the sidebar. */
  droppedCards?: Array<{ id: DashboardWidgetId; label: string; node: React.ReactNode }>;
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
  invoicesDue = 0,
  paymentsDue = 0,
  lowStockItems = 0,
  customersToFollowUp = 0,
  expiringProducts = 0,
  pendingApprovals = 0,
  smartModules = [],
  revenueData,
  profitData,
  topProducts,
  topCustomers,
  onQuickAction,
  onKPIClick,
  onViewAllActivity,
  hiddenWidgets = [],
  customizingWidgets = false,
  onRemoveWidget,
  onToggleCustomize,
  droppedCards = [],
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
    ...(pendingApprovals > 0 ? [{ label: "Pending Approvals", value: pendingApprovals, icon: AlertTriangle, color: "text-warning" }] : []),
    { label: "Collection Tasks", value: invoicesDue, icon: Receipt, color: "text-destructive" },
    { label: "Unpaid Purchases", value: paymentsDue, icon: DollarSign, color: "text-warning" },
    { label: "Urgent Reorders", value: lowStockItems, icon: AlertTriangle, color: "text-warning" },
    { label: "Customer Follow-ups", value: customersToFollowUp, icon: Users, color: "text-primary" },
    { label: "Expiring Stock Checks", value: expiringProducts, icon: Package, color: "text-destructive" },
  ].filter((t) => t.value > 0);

  const widgetHidden = (id: DashboardWidgetId) => hiddenWidgets.includes(id);
  // Each key number is its own card so the user can keep only what they watch daily.
  const kpiCards: Array<{ id: DashboardWidgetId; node: React.ReactNode }> = [
    ...(todaySales ? [{
      id: "kpi-today-sales" as DashboardWidgetId,
      node: <KPICard title="Today's Sales" value={todaySales.value} trend={todaySales.trend} icon={<TrendingUp className="size-4" />} sparklineData={todaySales.sparkline} onClick={() => onKPIClick?.("Today's Sales")} />,
    }] : []),
    ...(todayProfit ? [{
      id: "kpi-today-profit" as DashboardWidgetId,
      node: <KPICard title="Today's Profit" value={todayProfit.value} trend={todayProfit.trend} icon={<TrendingDown className="size-4" />} sparklineData={todayProfit.sparkline} onClick={() => onKPIClick?.("Today's Profit")} />,
    }] : []),
    ...(inventoryValue ? [{
      id: "kpi-inventory-value" as DashboardWidgetId,
      node: <KPICard title="Inventory Value" value={safeInventoryValue} trend={inventoryValue.trend} icon={<Package className="size-4" />} onClick={() => onKPIClick?.("Inventory Value")} />,
    }] : []),
    ...(outstandingReceivables ? [{
      id: "kpi-receivables" as DashboardWidgetId,
      node: <KPICard title="Outstanding Receivables" value={safeReceivables} icon={<Users className="size-4" />} onClick={() => onKPIClick?.("Outstanding Receivables")} />,
    }] : []),
    ...(outstandingPayables ? [{
      id: "kpi-payables" as DashboardWidgetId,
      node: <KPICard title="Outstanding Payables" value={safePayables} icon={<DollarSign className="size-4" />} onClick={() => onKPIClick?.("Outstanding Payables")} />,
    }] : []),
    ...(lowStockAlerts ? [{
      id: "kpi-low-stock" as DashboardWidgetId,
      node: <KPICard title="Low Stock Alerts" value={safeLowStock} icon={<AlertTriangle className="size-4" />} onClick={() => onKPIClick?.("Low Stock Alerts")} />,
    }] : []),
    ...(pendingApprovals > 0 ? [{
      id: "kpi-approvals" as DashboardWidgetId,
      node: <KPICard title="Pending Approvals" value={String(pendingApprovals)} icon={<AlertTriangle className="size-4" />} onClick={() => onKPIClick?.("Pending Approvals")} />,
    }] : []),
    ...(ordersToday ? [{
      id: "kpi-orders-today" as DashboardWidgetId,
      node: <KPICard title="Orders Today" value={ordersToday.value} icon={<Receipt className="size-4" />} onClick={() => onKPIClick?.("Orders Today")} />,
    }] : []),
    ...(customersToday ? [{
      id: "kpi-customers-today" as DashboardWidgetId,
      node: <KPICard title="Customers Today" value={customersToday.value} icon={<Users className="size-4" />} onClick={() => onKPIClick?.("Customers Today")} />,
    }] : []),
  ].filter((card) => !widgetHidden(card.id));

  const chartCards: Array<{ id: DashboardWidgetId; node: React.ReactNode }> = [
    ...(revenueData && revenueData.length > 0 ? [{ id: "chart-revenue" as DashboardWidgetId, node: <RevenueTrendCard data={revenueData} /> }] : []),
    ...(profitData && profitData.length > 0 ? [{ id: "chart-profit" as DashboardWidgetId, node: <ProfitTrendCard data={profitData} /> }] : []),
    ...(topProducts && topProducts.length > 0 ? [{ id: "chart-top-products" as DashboardWidgetId, node: <TopProductsCard items={topProducts} /> }] : []),
    ...(topCustomers && topCustomers.length > 0 ? [{ id: "chart-top-customers" as DashboardWidgetId, node: <TopCustomersCard items={topCustomers} /> }] : []),
  ].filter((chart) => !widgetHidden(chart.id));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-8 pt-3 sm:px-6 sm:pt-4 lg:px-8 space-y-5">
      {/* Welcome Section */}
      <header className="flex flex-wrap items-start justify-between gap-2 sm:items-center sm:gap-3">
        <DashboardWidget id="greeting" customizing={customizingWidgets} onRemove={onRemoveWidget} className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight text-foreground font-heading">
            {greeting}, <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-sm text-light-text mt-0.5">{dateStr}</p>
        </DashboardWidget>
        {onToggleCustomize && (
          <button
            type="button"
            onClick={onToggleCustomize}
            aria-pressed={customizingWidgets}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              customizingWidgets
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {customizingWidgets ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
            {customizingWidgets ? "Done" : "Edit home"}
          </button>
        )}
      </header>

      {!widgetHidden("quick-actions") && <DashboardWidget id="quick-actions" customizing={customizingWidgets} onRemove={onRemoveWidget}>
        <QuickActions onAction={onQuickAction} />
      </DashboardWidget>}

      {/* KPI Cards */}
      {kpiCards.length > 0 && (
        <section aria-labelledby="dashboard-today-heading" className="space-y-3">
          <div>
            <h2 id="dashboard-today-heading" className="text-sm font-semibold text-foreground">Today and current balances</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Today’s sales and estimated profit use invoices dated or recorded today. Inventory, receivables and payables are current balances.
            </p>
          </div>
          <div className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", customizingWidgets ? "gap-6" : "gap-3 sm:gap-4")}>
            {kpiCards.map((card) => (
              <DashboardWidget key={card.id} id={card.id} customizing={customizingWidgets} onRemove={onRemoveWidget}>
                {card.node}
              </DashboardWidget>
            ))}
          </div>
        </section>
      )}

      {/* AI Insight */}
      {aiInsight && (
        <DashboardWidget id="ai-insight" customizing={customizingWidgets} onRemove={onRemoveWidget}>
          <AIInsightCard
            insight={aiInsight.insight}
            confidence={aiInsight.confidence}
            action={aiInsight.action}
            reason={aiInsight.reason}
            onLearnMore={aiInsight.onLearnMore}
          />
        </DashboardWidget>
      )}

      {/* Pending Tasks */}
      {taskList.length > 0 && !widgetHidden("needs-attention") && (
        <DashboardWidget id="needs-attention" customizing={customizingWidgets} onRemove={onRemoveWidget}>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Needs Your Attention</h2>
            <p className="mb-3 text-xs text-muted-foreground">Open a current pending task, unpaid purchase, or stock alert to review it.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {taskList.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => onKPIClick?.(t.label)}
                  className={cn("flex min-h-11 items-center gap-2.5 rounded-lg bg-muted p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", t.label === "Pending Approvals" ? "hover:bg-warning/10" : "hover:bg-primary/10")}
                >
                  <t.icon className={cn("size-5", t.color)} />
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-foreground">{t.value}</p>
                    <p className="text-[11px] text-light-text">{t.label}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DashboardWidget>
      )}

      {!widgetHidden("business-health") && <DashboardWidget id="business-health" customizing={customizingWidgets} onRemove={onRemoveWidget}>
        <BusinessHealthCard score={healthScore} metrics={healthMetrics} />
      </DashboardWidget>}

      {/* Smart Modules */}
      {smartModules.length > 0 && !widgetHidden("smart-modules") && (
        <DashboardWidget id="smart-modules" customizing={customizingWidgets} onRemove={onRemoveWidget}>
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
        </DashboardWidget>
      )}

      {/* Charts */}
      {chartCards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {chartCards.map((chart) => (
            <DashboardWidget key={chart.id} id={chart.id} customizing={customizingWidgets} onRemove={onRemoveWidget}>
              {chart.node}
            </DashboardWidget>
          ))}
        </div>
      )}

      {/* Recent Activity */}
      {recentActivities.length > 0 && (
        <DashboardWidget id="recent-activity" customizing={customizingWidgets} onRemove={onRemoveWidget}>
          <RecentActivity activities={recentActivities} onViewAll={onViewAllActivity} />
        </DashboardWidget>
      )}

      {/* Cards dropped here from the sidebar */}
      {droppedCards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {droppedCards.map((card) => (
            <DashboardWidget key={card.id} id={card.id} label={card.label} customizing={customizingWidgets} onRemove={onRemoveWidget}>
              {card.node}
            </DashboardWidget>
          ))}
        </div>
      )}
    </div>
  );
}
