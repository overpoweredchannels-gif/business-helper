import type { MemoryStore } from "../brain/memory/business-memory";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { detectQueryLanguage } from "@/lib/ai/business-intelligence";

export type ExecutiveReportType = "morning" | "daily" | "weekly" | "monthly";

export interface ExecutiveReport {
  reportType: ExecutiveReportType;
  timestamp: string;
  organizationId: string;
  executiveName?: string;
  language: "english" | "urdu" | "roman_urdu";
  summary: {
    healthScore: number;
    revenue: number;
    profit: number;
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
  value: number;
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

export function generateExecutiveReport(
  store: MemoryStore,
  data: MemoryWriterRawData,
  reportType: ExecutiveReportType,
  organizationId: string,
  language: "english" | "urdu" | "roman_urdu" = detectQueryLanguage("")
): ExecutiveReport {
  const payload = calculateBusinessIntelligence(store, data);

  const report: ExecutiveReport = {
    reportType,
    timestamp: new Date().toISOString(),
    organizationId,
    language,
    summary: {
      healthScore: payload.businessHealth.score,
      revenue: payload.salesForecasting.tomorrow,
      profit: payload.salesForecasting.tomorrow * 0.15,
      keyAlerts: generateExecutiveAlerts(data),
      priorityActions: generatePriorityActions(payload),
    },
    detailedReports: {
      morningBriefing: generateMorningBriefing(payload, language),
      dailySummary: generateDailySummary(payload, language),
      weeklyInsights: generateWeeklyInsights(payload, language),
      monthlyForecast: generateMonthlyForecast(payload, language),
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

  payload.smartReorder.forEach((reorder: any, index: number) => {
    if (reorder.urgency === "critical") {
      alerts.push({
        alertId: `critical-reorder-${index}`,
        alertType: "critical",
        category: "inventory_shortage",
        title: "Critical Stock Outage Alert",
        description: `${reorder.productName} is at ${reorder.currentStock} units. Reorder level is ${reorder.reorderLevel}. Estimated days left: ${reorder.estimatedDaysLeft || "Unknown"}.`,
        severity: "urgent",
        actionRequired: "Immediately source from alternate supplier or increase order quantity.",
        affectedArea: "Inventory",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  payload.customerIntelligence.churnRisk.forEach((customer: any, index: number) => {
    if (customer.riskScore > 0.8) {
      alerts.push({
        alertId: `churn-risk-${index}`,
        alertType: "high",
        category: "customer_churn_risk",
        title: "High Customer Churn Risk Alert",
        description: `${customer.customerName} has last purchase ${customer.daysSinceLastPurchase} days ago. Risk score: ${Math.round(customer.riskScore * 100)}%. Current balance: ${customer.outstandingBalance}.`,
        severity: "warning",
        actionRequired: "Contact customer for win-back offer or credit review.",
        affectedArea: "Customer Relations",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  payload.supplierIntelligence.delayed.forEach((supplier: any, index: number) => {
    if (supplier.deliveryDays > 7) {
      alerts.push({
        alertId: `supplier-delay-${index}`,
        alertType: "medium",
        category: "supplier_delay",
        title: "Supplier Delivery Delay Alert",
        description: `${supplier.supplierName} is delayed by ${supplier.deliveryDays} days. Expected delivery: ${supplier.expectedDelivery}. Current status: ${supplier.status}.`,
        severity: "warning",
        actionRequired: "Consider alternate supplier or negotiate new terms.",
        affectedArea: "Supply Chain",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  payload.expenses?.forEach?.((expense: any, index: number) => {
    if (expense.severity === "high") {
      alerts.push({
        alertId: `expense-anomaly-${index}`,
        alertType: "medium",
        category: "expense_anomaly",
        title: "Expense Anomaly Alert",
        description: `${expense.expenseType} expense of ${expense.amount} on ${expense.expenseDate} exceeds normal pattern. Reason: ${expense.reason}.`,
        severity: "info",
        actionRequired: "Review expense with finance team.",
        affectedArea: "Finance",
        timestamp: new Date().toISOString(),
        organizationId,
        status: "active",
      });
    }
  });

  return alerts;
}

export function explainKPI(
  store: MemoryStore,
  data: MemoryWriterRawData,
  kpiType: string,
  organizationId: string,
  language: "english" | "urdu" | "roman_urdu" = detectQueryLanguage("")
): KPIExplanation {
  const payload = calculateBusinessIntelligence(store, data);

  let value = 0;
  let previousValue = 0;
  let trend: "up" | "down" | "stable" = "stable";

  switch (kpiType) {
    case "health_score":
      value = payload.businessHealth.score;
      previousValue = (data as any).analytics?.previousHealthScore || value - 5;
      trend = value > previousValue ? "up" : value < previousValue ? "down" : "stable";
      break;

    case "revenue":
      value = payload.salesForecasting.tomorrow;
      previousValue = payload.salesForecasting.weekly * 7;
      trend = value > previousValue ? "up" : value < previousValue ? "down" : "stable";
      break;

    case "profit":
      value = payload.salesForecasting.tomorrow * 0.15;
      previousValue = payload.salesForecasting.weekly * 0.15 * 7;
      trend = value > previousValue ? "up" : value < previousValue ? "down" : "stable";
      break;

    case "inventory_turnover":
      value = calculateInventoryTurnover(data);
      previousValue = calculatePreviousInventoryTurnover(data);
      trend = value > previousValue ? "up" : value < previousValue ? "down" : "stable";
      break;

    default:
      value = 0;
      previousValue = 0;
  }

  let explanation = "";
  let recommendations: string[] = [];
  let impactAssessment = "";

  switch (kpiType) {
    case "health_score":
      explanation = language === "urdu"
        ? `صحت کا اسکور ${value} ہے، جو گزشتہ ${previousValue} سے ${trend === "up" ? "بہتر" : trend === "down" ? "خراب" : "مستحکم"} ہے۔`
        : language === "roman_urdu"
          ? `Health score ${value} hai, previous ${previousValue} se ${trend === "up" ? "better" : trend === "down" ? "worse" : "stable"}.`
          : `Health score is ${value}, which is ${trend === "up" ? "better" : trend === "down" ? "worse" : "stable"} than previous value of ${previousValue}.`;
      recommendations = language === "urdu"
        ? ["ہر مصنوعے کی وضاحت کی جانچ پڑتال کریں جس کی ساکھ سکور کم ہے۔", "کاٹی ہوئی مصنوعات کی فہرست میں شامل مصنوعات کی دوبارہ تشخیص کریں۔", "کریڈٹ کے اداروں کے ساتھ تعلقات کو برقرار رکھنے کے لیے فروخت کے بعد سروس کالیں کریں۔"]
        : language === "roman_urdu"
          ? ["Audit product explanations of low health score items.", "Re-evaluate products in write-off list.", "Post-sale service calls for customer relations."]
          : ["Audit products with low health scores.", "Re-evaluate write-off list products.", "Post-sale service calls for customer relationships."];
      impactAssessment = trend === "up"
        ? language === "urdu"
          ? "کاروبار کی مجموعی صحت بہتر ہو رہی ہے، جو برآمدات اور منافع میں اضافے کی جانب اشارہ کرتا ہے۔"
          : language === "roman_urdu"
            ? "Business health improving, indicating growth in exports and profits."
            : "Business health is improving, indicating growth in revenue and profit."
        : trend === "down"
          ? language === "urdu"
            ? "کاروبار کی صحت گر رہی ہے، جو فوری توجہ کی ضرورت ہے کیونکہ یہ منافع کو متاثر کر سکتا ہے۔"
            : language === "roman_urdu"
              ? "Business health declining, requires immediate attention as it may affect profits."
              : "Business health is declining, requiring immediate attention as it may affect profits."
          : language === "urdu"
            ? "کاروبار کی صحت مستحکم ہے، جو اچھی ہے لیکن بہتری کے لیے بہتر حکمت عملی کی ضرورت ہو سکتی ہے۔"
            : language === "roman_urdu"
              ? "Business health stable, which is good but improvement strategies may be needed."
              : "Business health is stable, which is good but improvement strategies may be needed.";
      break;

    case "revenue":
      explanation = language === "urdu"
        ? `آج کی متوقع فروخت ${formatRs(value)} ہے، جو گزشتہ دورانیہ سے ${trend === "up" ? "زیادہ" : trend === "down" ? "کم" : "برابر"} ہے۔`
        : language === "roman_urdu"
          ? `Tomorrow's expected sales are ${formatRs(value)}, which is ${trend === "up" ? "more" : trend === "down" ? "less" : "same as"} than previous period.`
          : `Tomorrow's expected sales are ${formatRs(value)}, which is ${trend === "up" ? "more" : trend === "down" ? "less" : "the same as"} than previous period.`;
      recommendations = language === "urdu"
        ? ["بلند منافع والے مصنوعات کے لیے فروخت کی حکمت عملی میں ترمیم کریں۔", "سب سے زیادہ فروخت والے مصنوعات کے لیے فروخت کے بعد کی خدمات کو بہتر بنائیں۔", "کھڑے ہونے والی نقد رقم میں اضافہ کے لیے کسٹمر کریڈٹ کی حدود کی تشخیص کریں۔"]
        : language === "roman_urdu"
          ? ["Revise sales strategy for high-margin products.", "Improve post-sale service for best-sellers.", "Evaluate customer credit limits for outstanding growth."]
          : ["Revise sales strategy for high-margin products.", "Improve post-sale service for best-sellers.", "Evaluate customer credit limits for outstanding growth."];
      impactAssessment = trend === "up"
        ? language === "urdu"
          ? "یہ برآمدات میں اضافے کی جانب اشارہ کرتا ہے اور آمدنی میں بہتری لے کر آتا ہے۔"
          : language === "roman_urdu"
            ? "It indicates growth in exports and brings revenue improvement."
            : "This indicates revenue growth and brings income improvement."
        : trend === "down"
          ? language === "urdu"
            ? "اس سے برآمدات میں کمی آئے گی اور منافع متاثر ہوں گے۔"
            : language === "roman_urdu"
              ? "It will reduce exports and affect profits."
              : "This will reduce revenue and affect profits."
          : language === "urdu"
            ? "آمدنی مستحکم ہے، گزشتہ دورانیہ کے برابر ہے۔"
            : language === "roman_urdu"
              ? "Revenue stable hai, previous period ke barabar hai."
              : "Revenue is stable, consistent with the previous period.";
      break;

    default:
      explanation = `${kpiType} is ${value}.`;
      recommendations = ["Monitor this KPI regularly for trend analysis."];
      impactAssessment = "This KPI provides insights into overall business performance.";
  }

  return {
    kpiType,
    value,
    previousValue: previousValue > 0 ? previousValue : undefined,
    trend,
    explanation,
    recommendations,
    impactAssessment,
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

  payload.recommendations.forEach((rec: any, index: number) => {
    if (!prioritized.find(p => p.title === rec.title)) {
      prioritized.push({
        recommendationId: `rec-dashboard-${index}`,
        priority: "high",
        category: "revenue_growth",
        title: rec.title,
        description: rec.description,
        potentialImpact: {
          revenueImpact: Math.round((data.salesTransactions as any[])?.reduce((sum, s) => sum + s.amount, 0) * 0.03),
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

function calculateBusinessIntelligence(
  store: MemoryStore,
  data: MemoryWriterRawData
): any {
  return store.getBusinessSummary();
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

function generatePriorityActions(payload: any): string[] {
  const actions: string[] = [];

  if (payload.smartReorder.some((r: any) => r.urgency === "critical")) {
    actions.push("Immediate inventory procurement needed");
  }

  if (payload.customerIntelligence.churnRisk.some((c: any) => c.riskScore > 0.7)) {
    actions.push("Customer retention campaigns required");
  }

  if (payload.supplierIntelligence.delayed.some((s: any) => s.deliveryDays > 7)) {
    actions.push("Supplier performance review needed");
  }

  return actions;
}

function generateMorningBriefing(
  payload: any,
  language: "english" | "urdu" | "roman_urdu"
): string {
  if (language === "urdu") {
    return `صبحانہ بریفنگ:\n` +
      `- صحت کا اسکور: ${payload.businessHealth.score}\n` +
      `- آج کی متوقع فروخت: ${formatRs(payload.salesForecasting.tomorrow)}\n` +
      `- کلیدی انتباہات: ${generateExecutiveAlerts({} as MemoryWriterRawData).join(", ")}\n` +
      `- فوری کاروائی: ${generatePriorityActions(payload).join(", ")}`;
  } else if (language === "roman_urdu") {
    return `Morning briefing:\n` +
      `- Health score: ${payload.businessHealth.score}\n` +
      `- Today's expected sales: ${formatRs(payload.salesForecasting.tomorrow)}\n` +
      `- Key alerts: ${generateExecutiveAlerts({} as MemoryWriterRawData).join(", ")}\n` +
      `- Immediate actions: ${generatePriorityActions(payload).join(", ")}`;
  } else {
    return `Morning Briefing:\n` +
      `- Health Score: ${payload.businessHealth.score}\n` +
      `- Today's Expected Sales: ${formatRs(payload.salesForecasting.tomorrow)}\n` +
      `- Key Alerts: ${generateExecutiveAlerts({} as MemoryWriterRawData).join(", ")}\n` +
      `- Immediate Actions: ${generatePriorityActions(payload).join(", ")}`;
  }
}

function generateDailySummary(
  payload: any,
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
  payload: any,
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
  payload: any,
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

function formatRs(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
}
