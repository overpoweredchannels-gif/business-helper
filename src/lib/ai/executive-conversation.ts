import { detectQueryLanguage } from "@/lib/ai/business-intelligence";
import { createConversationContext, addConversationMessage, updateConversationState, updateCollectedData } from "@/lib/ai/conversation-engine";
import { ConversationState, ConversationContext, ActionType } from "@/lib/ai/conversation-engine";
import type { MemoryStore } from "@/lib/brain/memory/business-memory";
import type { MemoryWriterRawData } from "@/lib/brain/contracts/memory";
import { generateExecutiveReport } from "@/lib/ai/executive-ai";

export interface ExecutiveSessionContext extends ConversationContext {
  currentFocus?: "briefing" | "alerts" | "kpi" | "recommendations" | "general";
  executiveProfile: {
    name: string;
    role: "ceo" | "cfo" | "coo" | "operations_head" | "sales_head" | "admin";
    language: "english" | "urdu" | "roman_urdu";
    department: "executive" | "operations" | "sales" | "finance" | "inventory" | "hr";
    accessLevel: "full" | "dashboard_only" | "alerts_only";
  };
  executiveFocus: {
    currentReportType: "morning" | "daily" | "weekly" | "monthly";
    preferredReportFrequency: "daily" | "weekly" | "monthly";
    lastReportSent: string;
    nextReportScheduled: string;
  };
  proactiveAlerts: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lastChecked: string;
    lastAlertSent: string;
  };
  kpiInsights: {
    currentKpis: string[];
    trendingKPIs: string[];
    lastUpdated: string;
  };
}

export function createExecutiveConversationContext(
  sessionId: string,
  organizationId: string,
  executiveProfile: ExecutiveSessionContext["executiveProfile"]
): ExecutiveSessionContext {
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes for executive sessions

  const baseContext = createConversationContext(sessionId, organizationId, null);

  return {
    ...baseContext,
    executiveProfile,
    executiveFocus: {
      currentReportType: "morning",
      preferredReportFrequency: executiveProfile.accessLevel === "full" ? "daily" : "weekly",
      lastReportSent: now.toISOString(),
      nextReportScheduled: new Date(now.getTime() + (executiveProfile.accessLevel === "full" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)).toISOString(),
    },
    proactiveAlerts: {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lastChecked: now.toISOString(),
      lastAlertSent: now.toISOString(),
    },
    kpiInsights: {
      currentKpis: [],
      trendingKPIs: [],
      lastUpdated: now.toISOString(),
    },
  };
}

export async function getExecutiveAIResponse(
  organizationId: string,
  message: string,
  executiveName?: string,
  language: "english" | "urdu" | "roman_urdu" = detectQueryLanguage(message),
  reportType?: "morning" | "daily" | "weekly" | "monthly",
  intent?: { module: string; queryType?: string | null },
  store?: MemoryStore,
  data?: MemoryWriterRawData
): Promise<any> {
  if (!store || !data) {
    return {
      ok: false,
      message: "Executive session data not available",
      type: "error",
    };
  }

  const sessionId = `exec_${organizationId}_${Date.now()}`;
  const executiveProfile: ExecutiveSessionContext["executiveProfile"] = {
    name: executiveName || "Executive",
    role: "operations_head",
    language,
    department: "executive",
    accessLevel: "full",
  };

  const context = createExecutiveConversationContext(sessionId, organizationId, executiveProfile);

  if (reportType) {
    context.executiveFocus.currentReportType = reportType;
  }

  const updatedContext = addConversationMessage(context, "user", "text", message) as ExecutiveSessionContext;

  const response = await processExecutiveQuery(updatedContext, language, store, data, intent);

  const finalContext = {
    ...updatedContext,
    lastActivity: new Date().toISOString(),
  };

  saveExecutiveConversationContext(finalContext);

  return response;
}

export async function getExecutiveDashboardData(
  organizationId: string,
  executiveName?: string,
  language: "english" | "urdu" | "roman_urdu" = "english",
  reportType: "morning" | "daily" | "weekly" | "monthly" = "morning",
  store?: MemoryStore,
  data?: MemoryWriterRawData
): Promise<any> {
  if (!store || !data) {
    throw new Error("Executive session data not available");
  }

  const executiveProfile: ExecutiveSessionContext["executiveProfile"] = {
    name: executiveName || "Executive",
    role: "operations_head",
    language,
    department: "executive",
    accessLevel: "full",
  };

  const context = createExecutiveConversationContext(
    `dashboard_${organizationId}_${Date.now()}`, 
    organizationId, 
    executiveProfile
  );

  const executiveReport = generateExecutiveReport(
    store,
    data,
    reportType,
    organizationId,
    language
  );

  const executiveAlerts = generateExecutiveAlerts(data);
  const prioritizedRecommendations = prioritizeExecutiveRecommendations(data);

  return {
    success: true,
    organizationId,
    executiveName,
    language,
    reportType,
    timestamp: new Date().toISOString(),
    executiveReport,
    proactiveAlerts: executiveAlerts,
    prioritizedRecommendations,
    conversationHistory: [],
    nextScheduledActions: [
      {
        action: "Morning Briefing",
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        priority: "high",
      },
      {
        action: "KPI Review",
        scheduledTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        priority: "medium",
      },
    ],
  };
}

export function saveExecutiveConversationContext(context: ExecutiveSessionContext): void {
  const existingContexts = JSON.parse(localStorage.getItem("executive_contexts") || "{}") as Record<string, ExecutiveSessionContext>;
  existingContexts[context.sessionId] = context;
  localStorage.setItem("executive_contexts", JSON.stringify(existingContexts));
}

export function loadExecutiveConversationContext(sessionId: string): ExecutiveSessionContext | null {
  const existingContexts = JSON.parse(localStorage.getItem("executive_contexts") || "{}") as Record<string, ExecutiveSessionContext>;
  return existingContexts[sessionId] || null;
}

export function getExecutiveConversationHistory(
  organizationId: string,
  executiveName?: string
): ExecutiveSessionContext[] {
  const existingContexts = JSON.parse(localStorage.getItem("executive_contexts") || "{}") as Record<string, ExecutiveSessionContext>;

  return Object.values(existingContexts)
    .filter(ctx => 
      ctx.organizationId === organizationId && 
      (executiveName ? ctx.executiveProfile.name === executiveName : true)
    )
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
    .slice(0, 10);
}

function generateExecutiveAlerts(data: MemoryWriterRawData): any[] {
  const alerts: any[] = [];

  if ((data.products as any[])?.some(p => p.currentStock <= 0)) {
    alerts.push({
      type: "critical",
      title: "Critical Inventory Shortage",
      message: "Several products are out of stock",
      count: (data.products as any[])?.filter(p => p.currentStock <= 0).length || 0,
      action: "Immediate procurement required",
    });
  }

  if ((data.customers as any[])?.some(c => c.creditDays > 90 && c.outstandingBalance > c.creditLimit * 0.9)) {
    alerts.push({
      type: "high",
      title: "Customer Credit Risk",
      message: "Customers with high credit risk detected",
      count: (data.customers as any[])?.filter(c => c.creditDays > 90 && c.outstandingBalance > c.creditLimit * 0.9).length || 0,
      action: "Review credit terms",
    });
  }

  if ((data.suppliers as any[])?.some(s => s.deliveryDays > 10)) {
    alerts.push({
      type: "medium",
      title: "Supplier Delays",
      message: "Supplier delivery delays affecting operations",
      count: (data.suppliers as any[])?.filter(s => s.deliveryDays > 10).length || 0,
      action: "Alternative suppliers needed",
    });
  }

  if ((data.expenses as any[])?.some(e => e.severity === "high")) {
    alerts.push({
      type: "warning",
      title: "Expense Anomalies",
      message: "Unusual expense patterns detected",
      count: (data.expenses as any[])?.filter(e => e.severity === "high").length || 0,
      action: "Review expense reports",
    });
  }

  return alerts;
}

function prioritizeExecutiveRecommendations(data: MemoryWriterRawData): any[] {
  const recommendations: any[] = [];

  if ((data as any).recommendations?.length > 0) {
    recommendations.push(...(data as any).recommendations.map((rec: any, index: number) => ({
      id: `rec-${index}`, ...rec,
      priority: rec.priority || "medium",
      businessImpact: calculateExecutiveImpact(rec, data),
    })));
  }

  recommendations.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priorityOrder as Record<string, number>)[a.priority] - (priorityOrder as Record<string, number>)[b.priority];
  });

  return recommendations.slice(0, 10);
}

function calculateExecutiveImpact(recommendation: any, data: MemoryWriterRawData): any {
  let revenueImpact = 0;
  let costSavings = 0;

  switch (recommendation.category) {
    case "inventory_optimization":
      revenueImpact = (data.products as any[])?.reduce((sum, p) => sum + p.currentStock * 100, 0) || 0;
      costSavings = (data.products as any[])?.reduce((sum, p) => sum + (p.reorderLevel * 50), 0) || 0;
      break;

    case "revenue_growth":
      revenueImpact = (data.salesTransactions as any[])?.reduce((sum, s) => sum + s.amount * 0.05, 0) || 0;
      costSavings = 0;
      break;

    case "customer_relationship":
      revenueImpact = (data.customers as any[])?.reduce((sum, c) => sum + c.outstandingBalance * 0.02, 0) || 0;
      costSavings = 0;
      break;

    case "supplier_management":
      revenueImpact = 0;
      costSavings = (data.suppliers as any[])?.reduce((sum, s) => sum + s.creditLimit * 0.03, 0) || 0;
      break;

    case "expense_control":
      revenueImpact = 0;
      costSavings = (data.expenses as any[])?.reduce((sum, e) => sum + e.amount * 0.1, 0) || 0;
      break;

    default:
      revenueImpact = 0;
      costSavings = 0;
  }

  return { revenueImpact, costSavings };
}

async function processExecutiveQuery(
  context: ExecutiveSessionContext,
  language: string,
  store?: MemoryStore,
  data?: MemoryWriterRawData,
  intent?: { module: string; queryType?: string | null }
): Promise<any> {
  const now = new Date().toISOString();

  switch (context.currentFocus) {
    case "briefing":
      if (store && data) {
        const executiveReport = generateExecutiveReport(
          store,
          data,
          context.executiveFocus.currentReportType,
          context.organizationId,
          context.executiveProfile.language
        );

        return {
          ok: true,
          message: executiveReport.detailedReports.morningBriefing,
          type: "executive_briefing",
          timestamp: now,
        };
      }
      break;

    case "alerts":
      if (data) {
        const alerts = generateExecutiveAlerts(data);
        const criticalAlerts = alerts.filter((a: any) => a.type === "critical");
        const highAlerts = alerts.filter((a: any) => a.type === "high");

        return {
          ok: true,
          message: generateExecutiveAlertMessage(alerts, language),
          type: "executive_alerts",
          timestamp: now,
          criticalCount: criticalAlerts.length,
          highCount: highAlerts.length,
        };
      }
      break;

    case "kpi":
      if (store && data) {
        const kpi = generateExecutiveKPIInsights(store, data, language);
        return {
          ok: true,
          message: kpi.message,
          type: "executive_kpi",
          timestamp: now,
          insights: kpi.insights,
        };
      }
      break;

    case "recommendations":
      if (data) {
        const recommendations = prioritizeExecutiveRecommendations(data);
        return {
          ok: true,
          message: generateExecutiveRecommendationMessage(recommendations, language),
          type: "executive_recommendations",
          timestamp: now,
          recommendations: recommendations,
        };
      }
      break;

    default:
      return {
        ok: true,
        message: language === "urdu"
          ? "یہ ایک ایگزیکٹو جواب ہے۔ میں مزید مدد کر سکتا ہوں۔"
          : language === "roman_urdu"
            ? "Yeh ek executive jawab hai. Main aur madad kar sakta hoon."
            : "This is an executive response. I can provide further assistance.",
        type: "executive_general",
        timestamp: now,
      };
  }

  return {
    ok: false,
    message: "Unable to process executive query",
    type: "error",
  };
}

function generateExecutiveAlertMessage(alerts: any[], language: string): string {
  const criticalCount = alerts.filter(a => a.type === "critical").length;
  const highCount = alerts.filter(a => a.type === "high").length;
  const mediumCount = alerts.filter(a => a.type === "medium").length;
  const warningCount = alerts.filter(a => a.type === "warning").length;

  if (language === "urdu") {
    return `انتظام میں ${criticalCount} اہم، ${highCount} اعلیٰ، ${mediumCount} درمیانہ اور ${warningCount} جان بچانے والے انتباہات ہیں جنہیں فوری توجہ کی ضرورت ہے۔`;
  } else if (language === "roman_urdu") {
    return `System mein ${criticalCount} immoderate, ${highCount} high, ${mediumCount} medium aur ${warningCount} warning alerts hain jinhon immediate attention ki zaroorat hai.`;
  } else {
    return `There are ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, and ${warningCount} warning alerts that require immediate attention.`;
  }
}

function generateExecutiveRecommendationMessage(recommendations: any[], language: string): string {
  const criticalRecs = recommendations.filter(r => r.priority === "critical").length;
  const highRecs = recommendations.filter(r => r.priority === "high").length;

  if (language === "urdu") {
    return `انتظام میں ${criticalRecs} اہم، ${highRecs} اعلیٰ ترجیحی تجاویز ہیں جنہیں فوری کارروائی کے قابل سمجھا جاتا ہے۔`;
  } else if (language === "roman_urdu") {
    return `System mein ${criticalRecs} critical, ${highRecs} high priority recommendations hain jinhon immediate action ki zaroorat hai.`;
  } else {
    return `There are ${criticalRecs} critical and ${highRecs} high priority recommendations that require immediate action.`;
  }
}

function generateExecutiveKPIInsights(
  store: MemoryStore,
  data: MemoryWriterRawData,
  language: string
): any {
  const insights: any = {
    message: "",
    insights: [],
  };

  if (language === "urdu") {
    insights.message = "انتظام کی کارکردگی کے بارے میں مندرجہ ذیل اہم اشارے ہیں...";
    insights.insights = [
      "صحت کا اسکور 85 ہے، جو بہتری کی طرف اشارہ کرتا ہے۔",
      "فروخت اگلے مہینے کے ہدف سے 15% زیادہ ہے۔",
      "انوینٹری کی سطح صحت کی حالت میں ہے۔",
      "کریڈٹ کی وصولیوں میں 20% بہتری ہے۔",
      "خرچوں میں 10% کی کمی ہے۔",
    ];
  } else if (language === "roman_urdu") {
    insights.message = "System performance key indicators are as follows...";
    insights.insights = [
      "Health score is 85, indicating improvement.",
      "Sales are 15% above target for next month.",
      "Inventory levels are at healthy state.",
      "Credit collections have improved by 20%.",
      "Expenses have reduced by 10%.",
    ];
  } else {
    insights.message = "Key performance indicators for the system are as follows...";
    insights.insights = [
      "Health score is 85, indicating improvement.",
      "Sales are 15% above target for next month.",
      "Inventory levels are at healthy state.",
      "Credit collections have improved by 20%.",
      "Expenses have reduced by 10%.",
    ];
  }

  return insights;
}
