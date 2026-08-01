import { SkillWarning, TrendPoint } from "./common";
import { MemoryStore } from "../memory/business-memory";
import { PreferenceStore } from "../learning/preference-store";

export interface SkillContext {
  memory: MemoryStore;
  preferences: PreferenceStore;
  requestId: string;
  invokedAt: string;
}

export interface SkillResult<T = unknown> {
  skillId: string;
  version: string;
  success: boolean;
  data: T | null;
  error: SkillError | null;
  warnings: SkillWarning[];
  metrics: {
    executionTimeMs: number;
    inputSize: number;
    outputSize: number;
  };
}

export interface SkillError {
  code: string;
  message: string;
  detail: string;
  recoverable: boolean;
}

export interface SkillRegistryEntry {
  skillId: string;
  version: string;
  execute: (input: Record<string, unknown>, context: SkillContext) => SkillResult;
}

// ─── SK001: Health Score ───

export interface HealthScoreOutput {
  score: number;
  label: "Critical" | "Needs Attention" | "Average" | "Good" | "Excellent";
  breakdown: {
    revenueHealth: number;
    profitHealth: number;
    inventoryHealth: number;
    receivableHealth: number;
    expenseHealth: number;
    cashflowHealth: number;
  };
  reasons: string[];
  contributingFactors: Array<{ factor: string; impact: "positive" | "negative"; weight: number; detail: string }>;
  trend: "improving" | "declining" | "stable";
  trendEvidence: string;
  lastCalculated: string;
}

// ─── SK002: Sales Analytics ───

export interface SalesAnalyticsOutput {
  overview: {
    totalRevenue: number;
    totalProfit: number;
    profitMargin: number | null;
    invoiceCount: number;
    averageSaleValue: number;
    byPaymentType: Record<string, number>;
  };
  periods: Record<string, { revenue: number; profit: number; invoiceCount: number; averageValue: number }>;
  trends: {
    daily: TrendPoint[];
    weekly: TrendPoint[];
    monthly: TrendPoint[];
    changeVsLastPeriod: number | null;
  };
  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
    profit: number;
    margin: number | null;
  }>;
  topCustomers: Array<{
    customerId: string;
    customerName: string;
    revenue: number;
    invoiceCount: number;
    lastSaleDate: string | null;
  }>;
  metadata: { periodCovered: string; hasCompleteData: boolean; warnings: string[] };
}

// ─── SK003: Inventory Analytics ───

export interface InventoryAnalyticsOutput {
  summary: { totalProducts: number; totalStockValue: number; totalStockCost: number; activeProductCount: number };
  stockStatus: { outOfStock: number; lowStock: number; healthy: number; overstocked: number };
  stockStatusPercentages: { outOfStockPct: number; lowStockPct: number; healthyPct: number; overstockedPct: number };
  lowStockItems: Array<{
    productId: string; productName: string; currentStock: number; reorderLevel: number;
    status: string; estimatedDaysLeft: number | null; lastPurchasePrice: number;
  }>;
  categories: Array<{ categoryName: string; productCount: number; stockValue: number; lowStockCount: number }>;
  turnover: { overallTurnoverRate: number | null; fastMovers: string[]; slowMovers: string[] };
  metadata: { hasReorderLevelData: boolean; hasCostData: boolean; warnings: string[] };
}

// ─── SK004: Customer Analytics ───

export interface CustomerAnalyticsOutput {
  summary: {
    totalCustomers: number; activeCustomers30d: number; newCustomers30d: number;
    totalOutstanding: number; totalOverdue: number; overdueCustomerCount: number;
  };
  topCustomers: Array<{
    customerId: string; customerName: string; shopName: string | null;
    totalSales30d: number; invoiceCount30d: number;
    outstandingBalance: number; overdueAmount: number; overdueDays: number | null;
    creditLimit: number | null; creditUtilizationPct: number | null; lastSaleDate: string | null;
  }>;
  aging: { current: number; overdue1to30: number; overdue31to60: number; overdue61to90: number; overdue90plus: number; totalOverdue: number };
  paymentBehavior: { onTimePaymentRate: number | null; averagePaymentDays: number | null; creditCustomerCount: number };
  metadata: { hasCreditLimitData: boolean; hasPaymentHistory: boolean; warnings: string[] };
}

// ─── SK005: Expense Analytics ───

export interface ExpenseAnalyticsOutput {
  summary: {
    totalExpenses: number; expenseCount: number; averageExpenseValue: number;
    expenseToRevenueRatio: number | null; changeVsLastMonth: number | null;
  };
  byCategory: Array<{ category: string; amount: number; percentage: number; count: number; trend: "up" | "down" | "stable" }>;
  trends: { daily30d: TrendPoint[]; monthly12m: TrendPoint[] };
  anomalies: Array<{ category: string; reason: string; deviation: number; amount: number; severity: "low" | "medium" | "high" }>;
  metadata: { topCategoryName: string | null; topCategoryPct: number | null; hasCategoryData: boolean; warnings: string[] };
}

// ─── SK006: Staff Analytics ───

export interface StaffAnalyticsOutput {
  summary: { totalStaff: number; activeStaff: number; totalSalesToday: number; averagePerStaff: number };
  staffList: Array<{
    staffId: string; name: string; role: string; isActiveDuty: boolean;
    salesToday: number; lastLocation: object | null; dutyDuration: number | null;
  }>;
  activeLocations: Array<{ staffId: string; staffName: string; lat: number; lng: number; capturedAt: string }>;
  metadata: { hasLocationData: boolean; hasSalesAttribution: boolean; warnings: string[] };
}

// ─── SK007: KPI Calculator ───

export interface KpiOutput {
  kpis: Array<{
    key: string; label: string; category: string; value: number; unit: string;
    formatted: string; change: number | null; changeLabel: string; confidence: string;
  }>;
  categories: Record<string, Array<{ key: string; label: string; value: number; formatted: string; change: number | null }>>;
}

// ─── SK008: Forecast Engine ───

export interface ForecastOutput {
  forecasts: Array<{
    metric: string; period: string; targetDate: string;
    predictedValue: number; confidence: number;
    range: { lower: number; upper: number }; basedOn: string;
    trend: string; changePct: number | null;
  }>;
  metadata: { method: string; periodsAnalyzed: number; confidence: "high" | "medium" | "low"; warnings: string[] };
}

// ─── SK009: Reorder Advice ───

export interface ReorderAdviceOutput {
  recommendations: Array<{
    productId: string; productName: string; currentStock: number; reorderLevel: number;
    status: string; dailySalesVelocity: number; estimatedDaysLeft: number | null;
    suggestedOrderQuantity: number; suggestedSupplier: string | null;
    lastPurchasePrice: number; estimatedCost: number; priority: string; reason: string;
  }>;
  summary: { totalUrgent: number; totalRecommended: number; totalItemsToOrder: number; estimatedCost: number };
  metadata: { hasReorderLevelData: boolean; hasSalesVelocity: boolean; warnings: string[] };
}

// ─── SK010: Recommendation Engine ───

export interface RecommendationOutput {
  recommendations: Array<{
    id: string; type: string; category: string; priority: string;
    title: string; description: string; expectedImpact: string;
    actionLink: string | null; sourceSkill: string;
  }>;
  summary: { total: number; highPriority: number; mediumPriority: number; lowPriority: number; byCategory: Record<string, number> };
  metadata: { skillsConsulted: string[]; warnings: string[] };
}

// ─── SK011: Action Planner ───

export interface ActionPlanStep {
  order: number;
  description: string;
  checkType: "entity_exists" | "data_valid" | "business_rule" | "permission";
  status: "ready" | "needs_input" | "blocked";
  detail: string;
}

export interface ActionPlannerOutput {
  actionType: string;
  status: "ready" | "needs_input" | "blocked";
  steps: ActionPlanStep[];
  draftSummary: string;
  estimatedTotal: number | null;
  missingFields: Array<{ field: string; prompt: string; examples: string[] }>;
  warnings: string[];
  blockers: string[];
}
