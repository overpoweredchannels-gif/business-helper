import { MemoryConfidenceLabel, TrendPoint } from "./common";

// ─── Entity Memory Types ───

export interface ProductMemory {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  defaultSellingPrice: number;
  lastPurchasePrice: number;
  defaultCostPrice: number;
  currentStock: number;
  reorderLevel: number;
  minimumStockLevel: number;
  stockStatus: "out_of_stock" | "urgent" | "low_soon" | "healthy" | "overstocked";
  estimatedDaysLeft: number | null;
  totalSold30d: number;
  totalPurchased30d: number;
  dailySalesVelocity: number;
  revenue30d: number;
  profit30d: number;
  profitMargin30d: number | null;
  averageSellingPrice30d: number;
  lastSaleDate: string | null;
  lastPurchaseDate: string | null;
  createdAt: string;
  updatedAt: string;
  trackBatch: boolean;
  trackExpiry: boolean;
  isActive: boolean;
  isFastMoving: boolean;
  isSlowMoving: boolean;
  needsReorder: boolean;
}

export interface CustomerMemory {
  id: string;
  name: string;
  shopName: string | null;
  phone: string | null;
  address: string | null;
  totalSales30d: number;
  invoiceCount30d: number;
  lastSaleDate: string | null;
  averageSaleValue30d: number;
  creditLimit: number | null;
  creditPolicy: string | null;
  creditDays: number | null;
  allowOverLimit: boolean;
  allowOverdueSales: boolean;
  outstandingBalance: number;
  overdueAmount: number;
  overdueDays: number | null;
  creditUtilizationPct: number | null;
  onTimePaymentRate: number | null;
  averagePaymentDays: number | null;
  lastPaymentDate: string | null;
  isActive30d: boolean;
  isNew30d: boolean;
  isHighValue: boolean;
  isAtRisk: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierMemory {
  id: string;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  address: string | null;
  totalPurchases30d: number;
  invoiceCount30d: number;
  lastPurchaseDate: string | null;
  payableAmount: number;
  overdueAmount: number;
  averagePaymentDays: number | null;
  averageLeadTime: number | null;
  onTimeDeliveryRate: number | null;
  preferredPaymentTerms: string | null;
  isActive30d: boolean;
  isPreferred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffMemory {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  isActiveDuty: boolean;
  lastDutyStart: string | null;
  onDutySince: string | null;
  dutyDurationHours: number | null;
  lastLocation: { lat: number; lng: number; capturedAt: string } | null;
  salesCountToday: number;
  salesAmountToday: number;
  salesAmount30d: number;
  invoiceCount30d: number;
  averageSaleValue30d: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Period Data Types ───

export interface SalesPeriodSummary {
  revenue: number;
  profit: number;
  profitMargin: number | null;
  invoiceCount: number;
  averageSaleValue: number;
  byPaymentType: Record<string, number>;
  byStaff: Record<string, number>;
  topProductId: string | null;
  topProductRevenue: number;
  topProductQuantity: number;
}

export interface SalesMemory {
  today: SalesPeriodSummary;
  thisWeek: SalesPeriodSummary;
  thisMonth: SalesPeriodSummary;
  last30Days: SalesPeriodSummary;
  lastMonth: SalesPeriodSummary;
  allTime: SalesPeriodSummary;
  daily: Array<{ date: string; revenue: number; profit: number; invoiceCount: number }>;
  monthly: Array<{ month: string; revenue: number; profit: number; invoiceCount: number }>;
  lastTransactionDate: string;
  transactionCount: number;
  hasProfitData: boolean;
  profitConfidence: "high" | "medium" | "low";
}

export interface PurchasePeriodSummary {
  totalAmount: number;
  invoiceCount: number;
  bySupplier: Record<string, number>;
  byPaymentType: Record<string, number>;
}

export interface PurchasesMemory {
  today: PurchasePeriodSummary;
  thisWeek: PurchasePeriodSummary;
  thisMonth: PurchasePeriodSummary;
  last30Days: PurchasePeriodSummary;
  allTime: PurchasePeriodSummary;
  lastTransactionDate: string;
  transactionCount: number;
}

export interface ExpensePeriodSummary {
  totalAmount: number;
  count: number;
  byCategory: Record<string, number>;
}

export interface ExpensesMemory {
  thisMonth: ExpensePeriodSummary;
  last30Days: ExpensePeriodSummary;
  lastMonth: ExpensePeriodSummary;
  allTime: ExpensePeriodSummary;
  byCategory: Record<string, number>;
  daily30d: Array<{ date: string; total: number; byCategory: Record<string, number> }>;
  monthly12m: Array<{ month: string; total: number; byCategory: Record<string, number> }>;
  anomalies: Array<{
    category: string;
    month: string;
    amount: number;
    averageAmount: number;
    deviationPct: number;
    severity: "low" | "medium" | "high";
  }>;
  totalExpenses: number;
  expenseCount: number;
  averageExpenseValue: number;
  topCategory: string | null;
  topCategoryPct: number | null;
  hasCategoryData: boolean;
}

export interface InventoryMemory {
  totalProducts: number;
  totalStockValue: number;
  totalStockCost: number;
  activeProductCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  healthyCount: number;
  overstockedCount: number;
  urgentReorderCount: number;
}

// ─── Computed Types ───

export interface HealthScoreResult {
  score: number;
  label: "Critical" | "Needs Attention" | "Average" | "Good" | "Excellent";
  breakdown: Record<string, number>;
  reasons: string[];
  contributingFactors: Array<{ factor: string; impact: "positive" | "negative"; weight: number; detail: string }>;
  trend: "improving" | "declining" | "stable";
  trendEvidence: string;
  lastCalculated: string;
}

export interface KpiItem {
  key: string;
  label: string;
  category: "revenue" | "profitability" | "efficiency" | "liquidity" | "growth";
  value: number;
  unit: "currency" | "percentage" | "count" | "ratio" | "days";
  formatted: string;
  change: number | null;
  changeLabel: "up" | "down" | "flat";
  isPercentage: boolean;
  comparisonPeriod: string;
  confidence: "high" | "medium" | "low";
}

export interface ForecastItem {
  metric: string;
  period: string;
  targetDate: string;
  predictedValue: number;
  confidence: number;
  range: { lower: number; upper: number };
  basedOn: string;
  trend: "up" | "down" | "stable";
  changePct: number | null;
}

export interface RecommendationItem {
  id: string;
  type: "reorder" | "follow_up" | "price_adjustment" | "expense_review" | "staff_action" | "forecast_alert" | "health_alert" | "opportunity";
  category: "inventory" | "customers" | "finances" | "staff" | "general";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  actionLink: string | null;
  sourceSkill: string;
}

export interface AnalyticsMemory {
  healthScore: HealthScoreResult;
  kpis: KpiItem[];
  trends: {
    revenue: TrendPoint[];
    profit: TrendPoint[];
    expenses: TrendPoint[];
  };
  forecasts: ForecastItem[];
  recommendations: RecommendationItem[];
  needsAttention: boolean;
  attentionReasons: string[];
}

// ─── Permissions ───

export interface PermissionsSnapshot {
  ownerId: string;
  ownerProfileId: string;
  isOwner: boolean;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  marketIntelligenceEnabled: boolean;
}

// ─── Conversation Memory ───

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  type: string;
  text: string;
  chartData?: unknown;
  tableData?: unknown;
  createdAt: string;
}

export interface ConversationMemoryState {
  current: {
    id: string;
    title: string;
    status: "active" | "archived";
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  recentMessages: ConversationMessage[];
  recentConversations: Array<{
    id: string;
    title: string;
    messageCount: number;
    lastMessageAt: string;
    status: string;
  }>;
  state: {
    pipelineStage: string | null;
    awaitingConfirmation: boolean;
    activeDraft: unknown | null;
  };
}

// ─── Meta ───

export interface MemoryMeta {
  organizationId: string;
  organizationName: string;
  ownerName: string;
  currentDate: string;
  currentTime: string;
  timezone: string;
  schemaVersion: number;
  lastFullRefresh: string;
  sectionVersions: Record<string, number>;
}

// ─── Preferences ───

export interface SuggestedQuestion {
  text: string;
  intent: string;
  rank: number;
  frequency: number;
  lastAsked: string | null;
}

export interface PreferencesSnapshot {
  frequentTopics: Record<string, number>;
  preferredPeriod: "today" | "week" | "month" | null;
  preferredLanguage: "english" | "urdu" | "roman_urdu";
  ignoredRecommendationTypes: string[];
  topicFrequency7d: Record<string, number>;
  suggestedQuestions: SuggestedQuestion[];
  version: number;
  lastModified: string;
  totalInteractions: number;
}

// ─── Task & Alert Stores ───

export interface TaskMemory {
  pending: number;
  overdue: number;
  completed: number;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
}

export interface AlertMemory {
  active: number;
  critical: number;
  byType: Record<string, number>;
  recent: Array<{
    id: string;
    type: string;
    title: string;
    severity: string;
    createdAt: string;
  }>;
}

// ─── Full Memory Sections ───

export interface MemorySections {
  products: Map<string, ProductMemory>;
  customers: Map<string, CustomerMemory>;
  suppliers: Map<string, SupplierMemory>;
  staff: Map<string, StaffMemory>;
  sales: SalesMemory;
  purchases: PurchasesMemory;
  expenses: ExpensesMemory;
  inventory: InventoryMemory;
  analytics: AnalyticsMemory;
  recommendations: { active: RecommendationItem[]; summary: { total: number; highPriority: number; mediumPriority: number; lowPriority: number; byCategory: Record<string, number> }; lastGenerated: string };
  conversations: ConversationMemoryState;
  preferences: PreferencesSnapshot;
  permissions: PermissionsSnapshot;
  meta: MemoryMeta;
  tasks: TaskMemory;
  alerts: AlertMemory;
}

// ─── Entity Search ───

export interface EntitySearchResult<T> {
  entity: T;
  score: number;
  matchedField: string;
  originalQuery: string;
}

// ─── Memory Writer Input ───

export interface MemoryWriterRawData {
  organizationId: string;
  organizationName: string;
  ownerName: string;
  timezone: string;
  products: Array<{
    id: number | string;
    name: string;
    brand_id?: string | null;
    category_id?: string | null;
    brand_name?: string | null;
    category_name?: string | null;
    last_purchase_price?: number | null;
    default_selling_price?: number | null;
    minimum_stock_level?: number | null;
    reorder_level?: number | null;
    track_batch?: boolean | null;
    track_expiry?: boolean | null;
    created_at?: string;
    updated_at?: string;
  }>;
  customers: Array<{
    id: string;
    customer_name: string;
    shop_name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    area?: string | null;
    customer_type?: string | null;
    whatsapp?: string | null;
    preferred_payment_method?: string | null;
    credit_limit?: number | null;
    credit_policy?: string | null;
    credit_days?: number | null;
    allow_over_limit?: boolean | null;
    allow_overdue_sales?: boolean | null;
    created_at?: string;
    updated_at?: string;
  }>;
  suppliers: Array<{
    id: string;
    supplier_name: string;
    contact_person?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    city?: string | null;
    area?: string | null;
    notes?: string | null;
    credit_limit?: number | null;
    credit_policy?: string | null;
    credit_days?: number | null;
    allow_over_limit?: boolean | null;
    allow_overdue_sales?: boolean | null;
    preferred_payment_method?: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  salesTransactions: Array<{
    id: string;
    customer_id: string;
    invoice_number: string;
    created_at: string;
    sale_date?: string | null;
    payment_type?: string | null;
    credit_due_date?: string | null;
  }>;
  salesItems: Array<{
    id: string;
    sales_transaction_id: string;
    product_id: number | string;
    quantity: number;
    selling_price: number;
    purchase_price_snapshot?: number | null;
    created_at?: string;
  }>;
  purchaseTransactions: Array<{
    id: string;
    supplier_id: string;
    invoice_number: string;
    created_at: string;
    purchase_date?: string | null;
    payment_type?: string | null;
  }>;
  purchaseItems: Array<{
    id: string;
    purchase_transaction_id: string;
    product_id: number | string;
    quantity: number;
    purchase_price: number;
    selling_price: number;
    created_at?: string;
  }>;
  expenses: Array<{
    id: string;
    expense_type?: string;
    amount?: number;
    notes?: string;
    expense_date?: string;
    created_at?: string;
    supplier_id?: string | null;
    customer_id?: string | null;
  }>;
  staff: Array<{
    id: string;
    display_name: string;
    role?: string | null;
    phone?: string | null;
    is_active?: boolean | null;
    created_at?: string;
    updated_at?: string;
  }>;
  dutySessions?: Array<{
    id: string;
    profile_id: string;
    status: string;
    started_at: string;
    ended_at?: string | null;
    start_latitude?: number | null;
    start_longitude?: number | null;
  }>;
  locationPoints?: Array<{
    id: string;
    profile_id: string;
    duty_session_id: string;
    latitude: number;
    longitude: number;
    captured_at: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    task_type: string;
    priority: string;
    status: string;
    due_date?: string | null;
    created_at: string;
    completed_at?: string | null;
  }>;
  alerts: Array<{
    id: string;
    alert_type: string;
    title: string;
    summary?: string | null;
    severity: string;
    status: string;
    created_at: string;
  }>;
  customerPayments?: Array<{
    id: string;
    customer_id: string;
    amount: number;
    payment_date?: string;
    created_at?: string;
  }>;
  supplierPayments?: Array<{
    id: string;
    supplier_id: string;
    amount: number;
    payment_date?: string;
    created_at?: string;
  }>;
}

// ─── Fuzzy Match ───

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
  matchedField: string;
  originalQuery: string;
}
