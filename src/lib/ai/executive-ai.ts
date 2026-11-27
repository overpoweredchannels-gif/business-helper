import type { MemoryStore } from "../brain/memory/business-memory";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { calculateBusinessIntelligence, detectQueryLanguage, formatRs } from "./business-intelligence";

import { buildAssistantKpiBlock, buildDefaultAssistantKpiInputs } from "./assistant-kpi-block";
import { getBusinessHealthScore, type DashboardHealthOverview } from "../dashboard/health";

type BusinessIntelligencePayload = ReturnType<typeof calculateBusinessIntelligence>;

export type ExecutiveReportType = "morning" | "daily" | "weekly" | "monthly";

export interface ExecutiveReport {
  reportType: ExecutiveReportType;
  timestamp: string;
  organizationId: string;
  executiveName?: string;
  language: "english" | "urdu" | "roman_urdu";
  summary: {
    healthScore: number | null;
    period: { start: string; end: string };
    cashFlow: number | null;
    revenue: number | null;
    profit: number | null;
    keyAlerts: string[];
    priorityActions: string[];
  };
  detailedReports: {
    morningBriefing: string;
    dailySummary: string;
    weeklyInsights: string;
    monthlyForecast: string;
  };
}

export interface ProactiveAlert {
  alertId: string;
  alertType: "critical" | "high" | "medium" | "low";
  category:
    | "inventory_shortage"
    | "cash_flow_risk"
    | "customer_churn_risk"
    | "supplier_delay"
    | "staff_issue"
    | "expense_anomaly";
  title: string;
  description: string;
  severity: "urgent" | "warning" | "info";
  actionRequired?: string;
  affectedArea: string;
  timestamp: string;
  organizationId: string;
  status: "active" | "acknowledged" | "resolved";
}

export interface KPIExplanation {
  kpiType: string;
  value: number | null;
  previousValue?: number;
  trend: "up" | "down" | "stable";
  explanation: string;
  recommendations: string[];
  impactAssessment: string;
}

export interface PrioritizedRecommendation {
  recommendationId: string;
  priority: "critical" | "high" | "medium" | "low";
  category:
    | "inventory_optimization"
    | "pricing_strategy"
    | "customer_relationship"
    | "supplier_management"
    | "expense_control"
    | "revenue_growth";
  title: string;
  description: string;
  potentialImpact: {
    revenueImpact?: number;
    costSavings?: number;
    profitImprovement?: number;
    timeToImplement?: string;
  };
  implementationComplexity: "simple" | "moderate" | "complex";
  estimatedROI?: number;
}

export interface ConversationContext {
  sessionId: string;
  organizationId: string;
  userProfile: {
    role: "executive" | "manager" | "staff";
    name?: string;
    language: "english" | "urdu" | "roman_urdu";
  };
  currentFocus: "briefing" | "alerts" | "kpi" | "recommendations" | "general";
  conversationHistory: {
    timestamp: string;
    role: "user" | "assistant";
    message: string;
  }[];
  lastActivity: string;
  preferredReportFrequency: "daily" | "weekly" | "monthly";
}

function executiveMetrics(data: MemoryWriterRawData, now = new Date()) {
  const input = buildDefaultAssistantKpiInputs(data, now);
  const currency = data.assistantKpiCurrency === undefined ? data.currency : data.assistantKpiCurrency;
  const kpis = data.assistantKpiReady === false ? null : buildAssistantKpiBlock(input, currency, data.timezone, now);
  return { input, kpis };
}

function describeHealth(overview: DashboardHealthOverview): string {
  const { baseScore, components } = getBusinessHealthScore(overview);
  const points = Object.entries(components).map(([name, value]) => `${name} ${value >= 0 ? "+" : ""}${value}`);
  return `Dashboard formula: starts at ${baseScore}; ${points.join(", ")}. The final score is bounded to 0–100.`;
}

export function executiveQuestionType(message: string) {
  if (/\b(?:executive\s+(?:report|summary|briefing)|morning\s+briefing)\b/i.test(message)) return "report";
  if (/\bcash\s*flow\b/i.test(message)) return "cash_flow";
  if (/\b(?:business health|health score|health kpi)\b/i.test(message)) return "health_score";
  if (/\b(?:period profit|executive profit)\b/i.test(message)) return "profit";
  if (/\b(?:forecast|predict(?:ed|ion)?)\b/i.test(message) && /\btomorrow\b/i.test(message)) return "tomorrow_forecast";
  return null;
}

export function formatExecutiveOverview(data: MemoryWriterRawData, now = new Date()): string {
  const { input, kpis } = executiveMetrics(data, now);
  if (!kpis) return "Executive figures are unavailable because the business data could not be read completely.";
  const { start, end } = input.period;
  const money = (amount: number) => formatRs(amount, kpis.booksCurrency);
  return [
    `**Period:** ${start} to ${end} (BI Last 30 Days, inclusive, organization time)`,
    `**Period Revenue:** ${money(input.health.totalSalesAmount)}`,
    `**Estimated Net Profit:** ${money(input.health.estimatedNetProfit)} (${money(input.health.totalSalesAmount)} revenue minus ${money(input.knownCogs)} known line costs and ${money(input.health.expensesTotal)} expenses)`,
    `**Business Health Score:** ${kpis.health.score}/100 (${kpis.health.label})`,
    describeHealth(input.health),
    `**Inventory Value:** ${money(kpis.inventoryValue)}`,
    `**Receivables:** ${money(kpis.receivables)} (${kpis.customersOwing} customers)`,
    `**Payables:** ${money(kpis.payables)}`,
    `**Cash Flow:** ${money(kpis.cashFlow)} (dashboard metric: receivables minus payables)`,
  ].join("\n");
}

export function generateExecutiveReport(
  store: MemoryStore,
  data: MemoryWriterRawData,
  reportType: ExecutiveReportType,
  organizationId: string,
  language: "english" | "urdu" | "roman_urdu" = detectQueryLanguage("")
): ExecutiveReport {
  const payload = calculateBusinessIntelligence(store, data);

  const { input, kpis } = executiveMetrics(data);
  const report: ExecutiveReport = {
    reportType,
    timestamp: new Date().toISOString(),
    organizationId,
    language,
    summary: {
      healthScore: kpis?.health.score ?? null,
      period: input.period,
      cashFlow: kpis?.cashFlow ?? null,
      revenue: kpis ? input.health.totalSalesAmount : null,
      profit: kpis ? input.health.estimatedNetProfit : null,
      keyAlerts: generateExecutiveAlerts(data),
      priorityActions: generatePriorityActions(payload),
    },
    detailedReports: {
      morningBriefing: generateMorningBriefing(payload, language, data),
      dailySummary: generateDailySummary(language),
      weeklyInsights: generateWeeklyInsights(language),
      monthlyForecast: generateMonthlyForecast(language),
    },
  };

  return report;
}

export function analyzeProactiveAlerts(
  store: MemoryStore,
  data: MemoryWriterRawData,
  organizationId: string
): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  const payload = calculateBusinessIntelligence(store, data);

  payload.smartReorder.forEach((reorder, index) => {
    if (reorder.urgency === "critical") {
      alerts.push({
        alertId: `critical-reorder-${index}`,
        alertType: "critical",
        category: "inventory_shortage",
        title: "Critical Stock Outage Alert",
        description: `${reorder.name} is at ${reorder.currentStock} units. Recommended reorder quantity: ${reorder.reorderQuantity}.`,
        severity: "urgent",
        actionRequired: "Immediately source from alternate supplier or increase order quantity.",
        affectedArea: "Inventory",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  payload.customerIntelligence.churnRisk.forEach((customer, index) => {
    if (customer.riskScore > 80) {
      alerts.push({
        alertId: `churn-risk-${index}`,
        alertType: "high",
        category: "customer_churn_risk",
        title: "High Customer Churn Risk Alert",
        description: `${customer.name} has a churn risk score of ${Math.round(customer.riskScore)}%.`,
        severity: "warning",
        actionRequired: "Contact customer for win-back offer or credit review.",
        affectedArea: "Customer Relations",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  payload.supplierIntelligence.delayed.forEach((supplier, index) => {
    alerts.push({
      alertId: `supplier-delay-${index}`,
      alertType: "medium",
      category: "supplier_delay",
      title: "Supplier Overdue Payable Alert",
      description: `${supplier.name} has an overdue payable.`,
      severity: "warning",
      actionRequired: "Review the overdue payable with the supplier.",
      affectedArea: "Supply Chain",
      timestamp: new Date().toISOString(),
      organizationId,
      status: "active",
    });
  });

  return alerts;
}

export function explainKPI(
  _store: MemoryStore | null,
  data: MemoryWriterRawData,
  kpiType: string,
  organizationId: string,
  language: "english" | "urdu" | "roman_urdu" = detectQueryLanguage("")
): KPIExplanation {
  const { input, kpis } = executiveMetrics(data);
  const scope = `BI Last 30 Days (${input.period.start} to ${input.period.end})`;
  if (["health_score", "revenue", "profit", "cash_flow"].includes(kpiType)) {
    const value = !kpis ? null : kpiType === "health_score" ? kpis.health.score
      : kpiType === "revenue" ? input.health.totalSalesAmount
      : kpiType === "profit" ? input.health.estimatedNetProfit : kpis.cashFlow;
    const explanation = value === null || !kpis ? "The live KPI is unavailable."
      : kpiType === "health_score" ? `Health score is ${value}/100 for ${scope}. ${describeHealth(input.health)}`
      : kpiType === "cash_flow" ? `Cash Flow is ${formatRs(value, kpis.booksCurrency)} (receivables minus payables, as of ${input.period.end}).`
      : `${kpiType === "profit" ? "Estimated net profit" : "Revenue"} is ${formatRs(value, kpis.booksCurrency)} for ${scope}.`;
    return { kpiType, value, trend: "stable", explanation, recommendations: [], impactAssessment: "" };
  }

  let value = 0;
  let previousValue = 0;
  let trend: KPIExplanation["trend"] = "stable";
  switch (kpiType) {
    case "inventory_turnover":
      value = calculateInventoryTurnover(data);
      previousValue = calculatePreviousInventoryTurnover(data);
      trend = value > previousValue ? "up" : value < previousValue ? "down" : "stable";
      break;

    default:
      value = 0;
      previousValue = 0;
  }

  return {
    kpiType,
    value,
    previousValue: previousValue > 0 ? previousValue : undefined,
    trend,
    explanation: `${kpiType} is ${value}.`,
    recommendations: ["Monitor this KPI regularly for trend analysis."],
    impactAssessment: "This KPI provides insights into overall business performance.",
  };
}

export function prioritizeAIRecommendations(
  store: MemoryStore,
  data: MemoryWriterRawData,
  organizationId: string
): PrioritizedRecommendation[] {
  const allRecommendations = (data as any).recommendations || [];
  const payload = calculateBusinessIntelligence(store, data);

  const prioritized: PrioritizedRecommendation[] = [];

  allRecommendations.forEach((rec: any, index: number) => {
    let priority: PrioritizedRecommendation["priority"] = "low";
    let category: PrioritizedRecommendation["category"] = "expense_control";

    if (rec.priority === "critical") {
      priority = "critical";
      category = "inventory_optimization";
    } else if (rec.priority === "high") {
      priority = "high";
      category = rec.category === "revenue_generation" ? "revenue_growth" : "customer_relationship";
    } else if (rec.priority === "medium") {
      priority = "medium";
      category = "expense_control";
    }

    let impact: PrioritizedRecommendation["potentialImpact"] = {};
    let complexity: PrioritizedRecommendation["implementationComplexity"] = "simple";
    let estimatedROI: number | undefined;

    switch (rec.category) {
      case "inventory_optimization":
        impact = {
          costSavings: Math.round((data.products as any[])?.reduce((sum, p) => sum + (p.reorderLevel * 100), 0) || 0),
          timeToImplement: "1-3 days",
        };
        complexity = "simple";
        estimatedROI = 25;
        break;

      case "revenue_growth":
        impact = {
          revenueImpact: Math.round((data.salesTransactions as any[])?.reduce((sum, s) => sum + s.amount, 0) * 0.05),
          timeToImplement: "2-4 weeks",
        };
        complexity = "moderate";
        estimatedROI = 40;
        break;

      case "customer_relationship":
        impact = {
          revenueImpact: Math.round((data.customers as any[])?.reduce((sum, c) => sum + (c.outstandingBalance * 0.1), 0) || 0),
          timeToImplement: "1-2 weeks",
        };
        complexity = "moderate";
        estimatedROI = 35;
        break;

      case "supplier_management":
        impact = {
          costSavings: Math.round((data.suppliers as any[])?.reduce((sum, s) => sum + (s.creditLimit * 0.05), 0) || 0),
          timeToImplement: "3-5 days",
        };
        complexity = "simple";
        estimatedROI = 20;
        break;

      case "expense_control":
        impact = {
          costSavings: Math.round((data.expenses as any[])?.reduce((sum, e) => sum + (e.amount * 0.15), 0) || 0),
          timeToImplement: "1 week",
        };
        complexity = "simple";
        estimatedROI = 30;
        break;

      default:
        impact = { timeToImplement: "2-4 weeks" };
        complexity = "moderate";
        estimatedROI = 15;
    }

    prioritized.push({
      recommendationId: `rec-${index}`,
      priority,
      category,
      title: rec.title,
      description: rec.description,
      potentialImpact: impact,
      implementationComplexity: complexity,
      estimatedROI,
    });
  });

  const recordedRevenue = data.salesTransactions.reduce((sum, sale) => sum + (Number(sale.total_amount) || 0), 0);
  payload.recommendations.forEach((rec, index) => {
    if (!prioritized.find(p => p.title === rec.title)) {
      prioritized.push({
        recommendationId: `rec-dashboard-${index}`,
        priority: "high",
        category: "revenue_growth",
        title: rec.title,
        description: rec.description,
        potentialImpact: {
          revenueImpact: Math.round(recordedRevenue * 0.03),
          timeToImplement: "2-3 weeks",
        },
        implementationComplexity: "moderate",
        estimatedROI: 25,
      });
    }
  });

  prioritized.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return prioritized.slice(0, 10);
}

function generateExecutiveAlerts(data: MemoryWriterRawData): string[] {
  const alerts: string[] = [];

  if ((data.products as any[])?.some(p => p.currentStock <= 0)) {
    alerts.push("Critical inventory shortage detected");
  }

  if ((data.customers as any[])?.some(c => c.creditDays > 90 && c.outstandingBalance > c.creditLimit * 0.8)) {
    alerts.push("High-risk customers with overdue balances");
  }

  if ((data.suppliers as any[])?.some(s => s.deliveryDays > 10)) {
    alerts.push("Supplier delivery delays affecting operations");
  }

  if ((data.expenses as any[])?.some(e => e.severity === "high")) {
    alerts.push("Unusual expense patterns detected");
  }

  return alerts;
}

function generatePriorityActions(payload: BusinessIntelligencePayload): string[] {
  const actions: string[] = [];

  if (payload.smartReorder.some((r) => r.urgency === "critical")) {
    actions.push("Immediate inventory procurement needed");
  }

  if (payload.customerIntelligence.churnRisk.some((c) => c.riskScore > 70)) {
    actions.push("Customer retention campaigns required");
  }

  if (payload.supplierIntelligence.delayed.length > 0) {
    actions.push("Supplier performance review needed");
  }

  return actions;
}

function generateMorningBriefing(
  payload: BusinessIntelligencePayload,
  language: "english" | "urdu" | "roman_urdu",
  data: MemoryWriterRawData,
): string {
  const title = language === "urdu" ? "صبحانہ بریفنگ" : "Morning Briefing";
  return `${title}\n${formatExecutiveOverview(data)}\n- Immediate Actions: ${generatePriorityActions(payload).join(", ")}`;
}

function generateDailySummary(
  language: "english" | "urdu" | "roman_urdu"
): string {
  return language === "urdu"
    ? `روزانہ خلاصہ:\n` +
      `- کل کے اہم واقعات\n` +
      `- کارکردگی کا تجزیہ\n` +
      `- اگلے دن کی ترجیحات`
    : language === "roman_urdu"
      ? `Daily Summary:\n` +
        `- Today's key events\n` +
        `- Performance analysis\n` +
        `- Tomorrow's priorities`
      : `Daily Summary:\n` +
        `- Today's key events\n` +
        `- Performance analysis\n` +
        `- Tomorrow's priorities`;
}

function generateWeeklyInsights(
  language: "english" | "urdu" | "roman_urdu"
): string {
  return language === "urdu"
    ? `ہفتہ وار بصیرت:\n` +
      `- موسم کے رجحانات\n` +
      `- مصنوعات کی کارکردگی\n` +
      `- کسٹمر اور سپلائر رجحانات`
    : language === "roman_urdu"
      ? `Weekly Insights:\n` +
        `- Seasonal trends\n` +
        `- Product performance\n` +
        `- Customer and supplier trends`
      : `Weekly Insights:\n` +
        `- Seasonal trends\n` +
        `- Product performance\n` +
        `- Customer and supplier trends`;
}

function generateMonthlyForecast(
  language: "english" | "urdu" | "roman_urdu"
): string {
  return language === "urdu"
    ? `ماہانہ پیشن گوئی:\n` +
      `- سالانہ رجحانات\n` +
      `- تین مہینہ کی پیشن گوئی\n` +
      `- سرمایہ کاری کی ترجیحات`
    : language === "roman_urdu"
      ? `Monthly Forecast:\n` +
        `- Annual trends\n` +
        `- Three-month forecast\n` +
        `- Investment priorities`
      : `Monthly Forecast:\n` +
        `- Annual trends\n` +
        `- Three-month forecast\n` +
        `- Investment priorities`;
}

function calculateInventoryTurnover(data: MemoryWriterRawData): number {
  const totalCost = (data.products as any[])?.reduce((sum, p) => sum + (p.lastPurchasePrice * p.currentStock), 0) || 0;
  const averageInventory = (data.products as any[])?.reduce((sum, p) => sum + p.currentStock, 0) / (data.products?.length || 1);
  return averageInventory > 0 ? totalCost / averageInventory : 0;
}

function calculatePreviousInventoryTurnover(data: MemoryWriterRawData): number {
  return Math.max(0, calculateInventoryTurnover(data) - 1);
}
