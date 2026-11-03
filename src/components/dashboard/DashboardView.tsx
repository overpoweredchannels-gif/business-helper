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
import { DEFAULT_DASHBOARD_ORDER } from "@/lib/preferences/dashboard-order";
import { DashboardWidget } from "./DashboardWidget";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";
import type { DashboardMetricKey, DashboardMetricStates, DashboardReadStatus } from "@/lib/dashboard/data-read-state";

interface SmartModuleConfig {
  id: string;
  title: string;
  summary: string;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
  onOpen?: () => void;
  children?: React.ReactNode;
  readStatus?: DashboardReadStatus;
  lastSuccessfulAt?: string;
}

interface DashboardViewProps {
  userName: string;
  setupContent?: React.ReactNode;
  quickSaleContent?: React.ReactNode;
  exportContent?: React.ReactNode;
  widgetOrder?: DashboardWidgetId[];
  onMoveWidget?: (id: DashboardWidgetId, direction: "up" | "down", visible: DashboardWidgetId[]) => void;
  metricReadStates?: DashboardMetricStates;
  metricLastSuccessfulAt?: Partial<Record<DashboardMetricKey, string>>;
  onRetryFailedReads?: () => void;
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
  healthReadStatus?: DashboardReadStatus;
  healthLastSuccessfulAt?: string;
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
  onQuickSale?: () => void;
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
  setupContent,
  quickSaleContent,
  exportContent,
  widgetOrder = DEFAULT_DASHBOARD_ORDER,
  onMoveWidget,
  metricReadStates,
  metricLastSuccessfulAt,
  onRetryFailedReads,
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
  healthReadStatus,
  healthLastSuccessfulAt,
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
  onQuickSale,
  onKPIClick,
  onViewAllActivity,
  hiddenWidgets = [],
  customizingWidgets = false,
  onRemoveWidget,
  onToggleCustomize,
  droppedCards = [],
}: DashboardViewProps) {
  const { t, ui, language } = useRegional();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? t('dashboard.greeting.morning') : hour < 17 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening');
  const locale = language === 'es' ? 'es-ES' : language === 'it' ? 'it-IT' : language === 'ur' ? 'ur-PK' : 'en-US';
  const dateStr = now.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const safeInventoryValue = inventoryValue?.value ?? "--";
  const safeReceivables = outstandingReceivables?.value ?? "--";
  const safePayables = outstandingPayables?.value ?? "--";
  const safeLowStock = lowStockAlerts?.count?.toString() ?? "0";

  const getMetricStatus = (metric: DashboardMetricKey): DashboardReadStatus => metricReadStates?.[metric] ?? "successful-populated";
  const isReadSuccessful = (status: DashboardReadStatus) => status === "successful-empty" || status === "successful-populated";
  const effectiveHealthReadStatus = healthReadStatus ?? getMetricStatus("business-health");
  // `key` is the stable English routing string passed to onKPIClick (page.tsx matches
  // on these); `label` is the translated display string. Never translate the key.
  const taskCandidates: Array<{ key: string; label: string; value: number; icon: typeof AlertTriangle; color: string; metric: DashboardMetricKey; status: DashboardReadStatus }> = [
    { key: "Pending Approvals", label: t('task.pendingApprovals'), value: pendingApprovals, icon: AlertTriangle, color: "text-warning", metric: "pending-approvals", status: getMetricStatus("pending-approvals") },
    { key: "Collection Tasks", label: t('task.collectionTasks'), value: invoicesDue, icon: Receipt, color: "text-destructive", metric: "collection-tasks", status: getMetricStatus("collection-tasks") },
    { key: "Unpaid Purchases", label: t('task.unpaidPurchases'), value: paymentsDue, icon: DollarSign, color: "text-warning", metric: "unpaid-purchases", status: getMetricStatus("unpaid-purchases") },
    { key: "Urgent Reorders", label: t('task.urgentReorders'), value: lowStockItems, icon: AlertTriangle, color: "text-warning", metric: "urgent-reorders", status: getMetricStatus("urgent-reorders") },
    { key: "Customer Follow-ups", label: t('task.customerFollowUps'), value: customersToFollowUp, icon: Users, color: "text-primary", metric: "customer-follow-ups", status: getMetricStatus("customer-follow-ups") },
    { key: "Expiring Stock Checks", label: t('task.expiringStockChecks'), value: expiringProducts, icon: Package, color: "text-destructive", metric: "expiring-stock-checks", status: getMetricStatus("expiring-stock-checks") },
  ];
  const taskList = taskCandidates.filter((task) => !isReadSuccessful(task.status) || task.value > 0);
  const allAlertReadsReady = taskList.length === 0 && [
    "pending-approvals", "collection-tasks", "unpaid-purchases", "urgent-reorders", "customer-follow-ups", "expiring-stock-checks",
  ].every((metric) => {
    const status = getMetricStatus(metric as DashboardMetricKey);
    return isReadSuccessful(status);
  });

  const widgetHidden = (id: DashboardWidgetId) => hiddenWidgets.includes(id);
  // Each key number is its own card so the user can keep only what they watch daily.
  const kpiCards: Array<{ id: DashboardWidgetId; node: React.ReactNode }> = [
    ...(todaySales ? [{
      id: "kpi-today-sales" as DashboardWidgetId,
      node: <KPICard tone="accent" title={t('kpi.todaySales')} value={todaySales.value} readStatus={getMetricStatus("today-sales")} lastSuccessfulAt={metricLastSuccessfulAt?.["today-sales"]} onRetry={onRetryFailedReads} trend={todaySales.trend} icon={<TrendingUp className="size-4" />} sparklineData={todaySales.sparkline} onClick={() => onKPIClick?.("Today's Sales")} />,
    }] : []),
    ...(todayProfit ? [{
      id: "kpi-today-profit" as DashboardWidgetId,
      node: <KPICard title={t('kpi.todayProfit')} value={todayProfit.value} readStatus={getMetricStatus("today-profit")} lastSuccessfulAt={metricLastSuccessfulAt?.["today-profit"]} onRetry={onRetryFailedReads} trend={todayProfit.trend} icon={<TrendingDown className="size-4" />} sparklineData={todayProfit.sparkline} onClick={() => onKPIClick?.("Today's Profit")} />,
    }] : []),
    ...(inventoryValue ? [{
      id: "kpi-inventory-value" as DashboardWidgetId,
      node: <KPICard title={t('kpi.inventoryValue')} value={safeInventoryValue} readStatus={getMetricStatus("inventory-value")} lastSuccessfulAt={metricLastSuccessfulAt?.["inventory-value"]} onRetry={onRetryFailedReads} trend={inventoryValue.trend} icon={<Package className="size-4" />} onClick={() => onKPIClick?.("Inventory Value")} />,
    }] : []),
    ...(outstandingReceivables ? [{
      id: "kpi-receivables" as DashboardWidgetId,
      node: <KPICard title={t('kpi.receivables')} value={safeReceivables} readStatus={getMetricStatus("receivables")} lastSuccessfulAt={metricLastSuccessfulAt?.receivables} onRetry={onRetryFailedReads} icon={<Users className="size-4" />} onClick={() => onKPIClick?.("Outstanding Receivables")} />,
    }] : []),
    ...(outstandingPayables ? [{
      id: "kpi-payables" as DashboardWidgetId,
      node: <KPICard title={t('kpi.payables')} value={safePayables} readStatus={getMetricStatus("payables")} lastSuccessfulAt={metricLastSuccessfulAt?.payables} onRetry={onRetryFailedReads} icon={<DollarSign className="size-4" />} onClick={() => onKPIClick?.("Outstanding Payables")} />,
    }] : []),
    ...(lowStockAlerts ? [{
      id: "kpi-low-stock" as DashboardWidgetId,
      node: <KPICard tone="warning" title={t('kpi.lowStock')} value={safeLowStock} readStatus={getMetricStatus("low-stock")} lastSuccessfulAt={metricLastSuccessfulAt?.["low-stock"]} onRetry={onRetryFailedReads} icon={<AlertTriangle className="size-4" />} onClick={() => onKPIClick?.("Low Stock Alerts")} />,
    }] : []),
    ...(!isReadSuccessful(getMetricStatus("pending-approvals")) || pendingApprovals > 0 ? [{
      id: "kpi-approvals" as DashboardWidgetId,
      node: <KPICard title={t('kpi.pendingApprovals')} value={String(pendingApprovals)} readStatus={getMetricStatus("pending-approvals")} lastSuccessfulAt={metricLastSuccessfulAt?.["pending-approvals"]} onRetry={onRetryFailedReads} icon={<AlertTriangle className="size-4" />} onClick={() => onKPIClick?.("Pending Approvals")} />,
    }] : []),
    ...(ordersToday ? [{
      id: "kpi-orders-today" as DashboardWidgetId,
      node: <KPICard title={t('kpi.ordersToday')} value={ordersToday.value} icon={<Receipt className="size-4" />} onClick={() => onKPIClick?.("Orders Today")} />,
    }] : []),
    ...(customersToday ? [{
      id: "kpi-customers-today" as DashboardWidgetId,
      node: <KPICard title={t('kpi.customersToday')} value={customersToday.value} icon={<Users className="size-4" />} onClick={() => onKPIClick?.("Customers Today")} />,
    }] : []),
  ].filter((card) => !widgetHidden(card.id));

  const chartCards: Array<{ id: DashboardWidgetId; node: React.ReactNode }> = [
    ...(revenueData && revenueData.length > 0 ? [{ id: "chart-revenue" as DashboardWidgetId, node: <RevenueTrendCard data={revenueData} /> }] : []),
    ...(profitData && profitData.length > 0 ? [{ id: "chart-profit" as DashboardWidgetId, node: <ProfitTrendCard data={profitData} /> }] : []),
    ...(topProducts && topProducts.length > 0 ? [{ id: "chart-top-products" as DashboardWidgetId, node: <TopProductsCard items={topProducts} /> }] : []),
    ...(topCustomers && topCustomers.length > 0 ? [{ id: "chart-top-customers" as DashboardWidgetId, node: <TopCustomersCard items={topCustomers} /> }] : []),
  ].filter((chart) => !widgetHidden(chart.id));


  type Card = { id: DashboardWidgetId; node: React.ReactNode; width: "full" | "half" | "metric"; label?: string };
  const cards: Card[] = [
    ...(setupContent ? [{ id: "setup-import" as const, node: setupContent, width: "full" as const }] : []),
    ...(quickSaleContent ? [{ id: "quick-sale" as const, node: quickSaleContent, width: "half" as const }] : []),
    ...(exportContent ? [{ id: "business-records-export" as const, node: exportContent, width: "half" as const }] : []),
    { id: "quick-actions", node: <QuickActions onAction={onQuickAction} />, width: "full" },
    ...kpiCards.map(card => ({ ...card, width: "metric" as const })),
    ...chartCards.map(card => ({ ...card, width: "half" as const })),
    ...(recentActivities.length ? [{ id: "recent-activity" as const, node: <RecentActivity activities={recentActivities} onViewAll={onViewAllActivity} />, width: "half" as const }] : []),
    ...(aiInsight ? [{ id: "ai-insight" as const, node: <AIInsightCard {...aiInsight} />, width: "half" as const }] : []),
    ...((taskList.length > 0 || allAlertReadsReady) ? [{ id: "needs-attention" as const, node: (<div className="aankh-card rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">{t('dashboard.needsAttention')}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{t('dashboard.needsAttentionHint')}</p>
            {taskList.length === 0 ? (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{t('dashboard.noAlerts')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {taskList.map((task) => {
                  const stateLabel = task.status === "failed" ? t('dashboard.unavailable') : task.status === "loading" ? ui('loading') : task.status === "not-loaded" ? t('dashboard.notLoaded') : String(task.value);
                  const TaskIcon = task.icon;
                  const content = <>
                    <TaskIcon className={cn("size-5", task.color)} />
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-foreground">{stateLabel}</p>
                      <p className="text-[11px] text-light-text">{task.label}</p>
                    </div>
                  </>;
                  return isReadSuccessful(task.status) ? (
                    <button
                      key={task.key}
                      type="button"
                      onClick={() => onKPIClick?.(task.key)}
                      className={cn("flex min-h-11 items-center gap-2.5 rounded-lg bg-muted p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", task.key === "Pending Approvals" ? "hover:bg-warning/10" : "hover:bg-primary/10")}
                    >{content}</button>
                  ) : (
                    <div key={task.key} className="flex min-h-11 items-center gap-2.5 rounded-lg bg-muted p-3 text-left">
                      {content}
                      {task.status === "failed" && onRetryFailedReads && <button type="button" onClick={onRetryFailedReads} className="min-h-11 rounded-md px-2 text-xs font-semibold text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('dashboard.retry')}</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>), width: "half" as const }] : []),
    { id: "business-health", node: <BusinessHealthCard score={healthScore} metrics={healthMetrics} readStatus={effectiveHealthReadStatus} lastSuccessfulAt={healthLastSuccessfulAt ?? metricLastSuccessfulAt?.["business-health"]} onRetry={onRetryFailedReads} />, width: "half" },
    ...(smartModules.length ? [{ id: "smart-modules" as const, node: (<div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{t('dashboard.businessOverview')}</h2>
            <div className="overview-grid">
              {smartModules.map((m) => (
                <SmartModule key={m.id} sectionId={m.id} title={m.title} summary={m.summary} badge={m.badge} badgeColor={m.badgeColor} onOpen={m.onOpen} readStatus={m.readStatus} lastSuccessfulAt={m.lastSuccessfulAt}>
                  {m.children}
                </SmartModule>
              ))}
            </div>
          </div>), width: "full" as const }] : []),
    ...droppedCards.map(card => ({ ...card, width: "half" as const })),
  ];
  const orderedCards = cards.filter(card => !widgetHidden(card.id)).toSorted((a, b) => {
    const rank = (id: DashboardWidgetId) => { const index = widgetOrder.indexOf(id); return index < 0 ? widgetOrder.length : index; };
    return rank(a.id) - rank(b.id);
  });
  const visibleIds = orderedCards.map(card => card.id);

  return (
    <div className="aankh-dashboard mx-auto w-full max-w-[1440px] space-y-5 px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-2 sm:items-center sm:gap-3">
        <DashboardWidget id="greeting" customizing={customizingWidgets} onRemove={onRemoveWidget} className="min-w-0 flex-1 basis-full sm:basis-auto">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight text-foreground font-heading">
            {greeting}, <span><bdi>{userName}</bdi></span>
          </h1>
          <p className="text-sm text-light-text mt-0.5">{dateStr}</p>
        </DashboardWidget>
        {onQuickSale && <button type="button" onClick={onQuickSale} className="aankh-action inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Receipt className="size-4" />{t('dashboard.quickSaleTitle')}</button>}
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
            {customizingWidgets ? t('dashboard.done') : t('dashboard.editHome')}
          </button>
        )}
      </header>
      <h2 id="dashboard-today-heading" className="sr-only">{t('dashboard.todayBalances')}</h2>
      <div className="dashboard-grid">
        {orderedCards.map((card, index) => <DashboardWidget key={card.id} id={card.id} label={card.label} customizing={customizingWidgets} onRemove={onRemoveWidget}
          onMove={onMoveWidget ? direction => onMoveWidget(card.id, direction, visibleIds) : undefined}
          moveUpDisabled={index === 0} moveDownDisabled={index === orderedCards.length - 1}
          className={`dashboard-cell dashboard-cell-${card.width}`}>{card.node}</DashboardWidget>)}
      </div>
    </div>
  );
}
