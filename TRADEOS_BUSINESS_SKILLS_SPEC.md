# TradeOS AI — Business Skills Specification

> **Version**: 1.0  
> **Status**: Immutable Architecture Specification  
> **Scope**: Every deterministic Business Skill in the TradeOS AI Business Brain  
> **Principle**: The LLM never performs business calculations. Every numeric business result is produced by a deterministic Business Skill.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Skill Contract](#2-skill-contract)
3. [SK001: Health Score](#3-sk001-health-score)
4. [SK002: Sales Analytics](#4-sk002-sales-analytics)
5. [SK003: Inventory Analytics](#5-sk003-inventory-analytics)
6. [SK004: Customer Analytics](#6-sk004-customer-analytics)
7. [SK005: Expense Analytics](#7-sk005-expense-analytics)
8. [SK006: Staff Analytics](#8-sk006-staff-analytics)
9. [SK007: KPI Calculator](#9-sk007-kpi-calculator)
10. [SK008: Forecast Engine](#10-sk008-forecast-engine)
11. [SK009: Reorder Advice](#11-sk009-reorder-advice)
12. [SK010: Recommendation Engine](#12-sk010-recommendation-engine)
13. [SK011: Action Planner](#13-sk011-action-planner)
14. [SK012: Context Summarizer](#14-sk012-context-summarizer)
15. [SK013: Learning Engine](#15-sk013-learning-engine)
16. [Skill Dependency Graph](#16-skill-dependency-graph)
17. [Validation & Testing Strategy](#17-validation--testing-strategy)

---

## 1. Introduction

### 1.1 What Is a Business Skill?

A Business Skill is a **deterministic, pure function** that:

- Reads from Business Memory (never raw database tables)
- Produces structured, typed output
- Never calls an LLM
- Never makes API calls
- Is synchronous and testable
- Has a single, well-defined responsibility
- Is registered in the Skill Registry for intent-based dispatch

### 1.2 Skill Categories

| Category | Skills | LLM Role |
|----------|--------|----------|
| **Assessment** | Health Score, KPI Calculator | Generate explanation text only |
| **Analytics** | Sales, Inventory, Customer, Expense, Staff | Generate summary text only |
| **Prediction** | Forecast Engine | Generate forecast narrative only |
| **Recommendation** | Reorder Advice, Recommendation Engine | Generate action-oriented text only |
| **Execution** | Action Planner | Generate action summary text only |
| **Utility** | Context Summarizer | None (pure data formatting) |
| **Cross-cutting** | Learning Engine | None (deterministic pattern tracking) |

### 1.3 Design Principles

1. **Purity**: Skills are pure functions — same input always produces same output.
2. **Composability**: Skills can be chained. A skill's output can be another skill's input.
3. **Graceful degradation**: If input data is missing or incomplete, the skill produces a partial result with warnings, not an error.
4. **Single responsibility**: Each skill does exactly one thing.
5. **No LLM boundary**: Skills never call the Language Engine. The Language Engine never calls skills.

---

## 2. Skill Contract

### 2.1 Interface

Every skill conforms to this interface:

```typescript
interface BusinessSkill<TInput, TOutput> {
  /** Unique skill identifier (e.g., "health_score") */
  readonly id: string;

  /** Semantic version for change tracking */
  readonly version: string;

  /** Human-readable purpose statement */
  readonly description: string;

  /** JSON Schema for input validation */
  readonly inputSchema: Record<string, unknown>;

  /** Execute the skill */
  execute(input: TInput, context: SkillContext): SkillResult<TOutput>;
}

interface SkillContext {
  memory: MemoryStore;          // Business Memory snapshot
  preferences: PreferenceStore; // Current owner preferences
  requestId: string;            // Tracing ID
  invokedAt: string;            // ISO timestamp
}

interface SkillResult<TOutput> {
  skillId: string;
  version: string;
  success: boolean;
  data: TOutput | null;
  error: SkillError | null;
  warnings: SkillWarning[];
  metrics: {
    executionTimeMs: number;
    inputSize: number;        // Number of entities processed
    outputSize: number;       // Size of output data
  };
}

interface SkillError {
  code: string;               // Machine-readable
  message: string;            // Developer-facing
  detail: string;             // Technical detail
  recoverable: boolean;
}

interface SkillWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
  affectedData: string;       // What data was missing/affected
}
```

### 2.2 Error Handling Contract

| Condition | Behavior |
|-----------|----------|
| Input data missing (entire section) | Return `success: true` with empty/null data + warning: `DATA_MISSING` |
| Input data partial (some fields null) | Process available data + warning: `DATA_PARTIAL` with affected fields |
| Division by zero in formula | Return `0` or `null` for that specific metric + warning: `DIVISION_BY_ZERO` |
| Unexpected exception | Return `success: false` with `SkillError` |
| Timeout (>100ms per skill) | Return `success: false` with `TIMEOUT` error |

### 2.3 Performance Budget

| Skill | Max Execution | Max Input Size | Acceptable Latency |
|-------|--------------|----------------|-------------------|
| Health Score | 5ms | N/A (memory read) | <5ms |
| Sales Analytics | 20ms | 10k transactions | <20ms |
| Inventory Analytics | 10ms | 5k products | <10ms |
| Customer Analytics | 15ms | 5k customers | <15ms |
| Expense Analytics | 10ms | 5k expenses | <10ms |
| Staff Analytics | 5ms | 100 staff | <5ms |
| KPI Calculator | 20ms | All analytics results | <20ms |
| Forecast Engine | 15ms | 90 data points | <15ms |
| Reorder Advice | 10ms | 5k products | <10ms |
| Recommendation Engine | 20ms | All skill results | <20ms |
| Action Planner | 10ms | Resolved entities | <10ms |
| Context Summarizer | 5ms | All skill results | <5ms |
| Learning Engine | 5ms | Request metadata | <5ms |

**Total budget for all skills in a single pipeline**: <150ms. Skills exceeding this budget must be optimized or split.

---

## 3. SK001: Health Score

### 3.1 Purpose

Calculate a deterministic business health score (0–100) that reflects the overall state of the business at a single point in time. The score is used for dashboard display, alert generation, and as input to the Recommendation Engine.

### 3.2 Inputs

```
MemoryStore (computed sections required):
  - sales: { today, this_week, this_month, last_30_days }
  - expenses: { this_month }
  - inventory: { low_stock_count, out_of_stock_count, urgent_reorder_count, total_products }
  - customers: full map (for receivable/overdue calculations)
  - suppliers: full map (for payable calculation)
  - computed.kpis: KpiResult[]
  - computed.trends: TrendResult[]
  - meta: { current_date }
```

### 3.3 Outputs

```typescript
interface HealthScoreResult {
  score: number;                          // 0–100
  label: "Critical" | "Needs Attention" | "Average" | "Good" | "Excellent";
  breakdown: {
    revenueHealth: number;                // 0–100 sub-score
    profitHealth: number;                 // 0–100 sub-score
    inventoryHealth: number;              // 0–100 sub-score
    receivableHealth: number;             // 0–100 sub-score
    expenseHealth: number;                // 0–100 sub-score
    cashflowHealth: number;               // 0–100 sub-score
  };
  reasons: string[];                      // Human-readable, max 5 reasons
  contributingFactors: Array<{
    factor: string;
    impact: "positive" | "negative";
    weight: number;                       // 0.0–1.0
    detail: string;
  }>;
  trend: "improving" | "declining" | "stable";
  trendEvidence: string;                  // What data supports the trend direction
  lastCalculated: string;                 // ISO timestamp
}
```

### 3.4 Algorithm

```
STEP 1 — Revenue Health (weight: 0.25)
  Compare this_month sales to last_30_days average.
  If this_month sales > 0:
    sales_change = (this_month_sales - last_month_avg) / last_month_avg
    revenueScore = 50 + (sales_change * 50)
    Clamp to [0, 100]
  Else:
    revenueScore = 0
    Warning: "No sales recorded this month"

STEP 2 — Profit Health (weight: 0.20)
  From computed.kpis, find profit_margin KPI.
  If profit_margin exists:
    margin = profit_margin.value (as percentage)
    If margin >= 30:  profitScore = 100
    If margin >= 20:  profitScore = 80
    If margin >= 10:  profitScore = 60
    If margin >= 5:   profitScore = 40
    If margin >= 0:   profitScore = 20
    If margin < 0:    profitScore = 0
  Else:
    profitScore = 50
    Warning: "Profit margin could not be calculated"

STEP 3 — Inventory Health (weight: 0.20)
  total = inventory.total_products
  outOfStock = inventory.out_of_stock_count
  lowStock = inventory.low_stock_count
  urgent = inventory.urgent_reorder_count

  If total == 0:
    inventoryScore = 50
  Else:
    outOfStockRatio = outOfStock / total
    lowStockRatio = lowStock / total
    inventoryScore = 100
      - (outOfStockRatio * 100) * 0.6    // Out of stock heavily penalized
      - (lowStockRatio * 100) * 0.3      // Low stock moderately penalized
      - (urgent > 10 ? 10 : 0)           // Urgency penalty cap
    Clamp to [0, 100]

STEP 4 — Receivable Health (weight: 0.15)
  Calculate overdue_ratio = total_overdue_receivables / total_receivables
  If total_receivables == 0:
    receivableScore = 100                // No receivables = healthy
  Else:
    If overdue_ratio == 0:               receivableScore = 100
    Else if overdue_ratio <= 0.1:        receivableScore = 85
    Else if overdue_ratio <= 0.25:       receivableScore = 65
    Else if overdue_ratio <= 0.5:        receivableScore = 40
    Else:                                receivableScore = 15

STEP 5 — Expense Health (weight: 0.10)
  Compare this_month expenses to this_month sales.
  If sales == 0:
    expenseScore = 50
  Else:
    expenseRatio = this_month_expenses / this_month_sales
    If expenseRatio <= 0.3:              expenseScore = 100
    Else if expenseRatio <= 0.5:         expenseScore = 80
    Else if expenseRatio <= 0.7:         expenseScore = 60
    Else if expenseRatio <= 1.0:         expenseScore = 30
    Else:                                expenseScore = 0  (expenses exceed sales)

STEP 6 — Cash Flow Health (weight: 0.10)
  net_cashflow = total_receivables_collected_30d - total_payables_paid_30d
  If no data:
    cashflowScore = 50
  Else:
    If net_cashflow > 0:
      cashflowScore = 70 + min(30, (net_cashflow / total_receivables) * 30)
    Else:
      cashflowScore = max(0, 50 + (net_cashflow / total_payables) * 50)
    Clamp to [0, 100]

STEP 7 — Composite Score
  score = (revenueScore     * 0.25)
        + (profitScore      * 0.20)
        + (inventoryScore   * 0.20)
        + (receivableScore  * 0.15)
        + (expenseScore     * 0.10)
        + (cashflowScore    * 0.10)

  Round to nearest integer.

STEP 8 — Label Assignment
  If score >= 85:   label = "Excellent"
  If score >= 70:   label = "Good"
  If score >= 50:   label = "Average"
  If score >= 30:   label = "Needs Attention"
  Else:             label = "Critical"

STEP 9 — Trend Determination
  Compare current health score with previous period's score (from Memory).
  If current > previous + 3:     trend = "improving"
  If current < previous - 3:     trend = "declining"
  Else:                           trend = "stable"
  (If no previous score exists:   trend = "stable")

STEP 10 — Reason Generation
  Select top 5 contributing factors sorted by absolute impact weight:
    - If revenueScore < 50:   "Low sales this month compared to average"
    - If profitScore < 50:    "Thin or negative profit margins"
    - If inventoryScore < 50: "Significant out-of-stock or low-stock issues"
    - If receivableScore < 50: "High overdue receivable ratio"
    - If expenseScore < 50:   "Expenses are high relative to revenue"
    - If cashflowScore < 50:  "Negative cash flow position"
    - If revenueScore >= 80:  "Strong sales performance this month"
    - If profitScore >= 80:   "Healthy profit margins"
    - If inventoryScore >= 80: "Well-managed inventory"
```

### 3.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| Zero sales ever recorded | Score defaults to 50 (base). All sales-dependent sub-scores set to 50. Warning: "No sales history available" |
| Zero products in inventory | inventoryScore = 50. Warning: "No products in inventory" |
| Zero customers | receivableScore = 100 (no receivables risk). Warning: "No customers registered" |
| Single product business | All ratios work correctly. Warning if applicable. |
| Very new business (<30 days) | Trend = "stable" (no prior period). Revenue calculations use available data proportional to days. Warning: "Limited historical data (<30 days)" |
| Extremely high sales month | revenueScore clamped to 100. Contributing factor shows maximum positive impact. |
| Negative expenses | Warning: "Negative expense values detected" — use absolute values for ratio, set expenseScore to 50 |

### 3.6 Confidence Scoring

Confidence is not calculated per-request. Instead, each sub-score includes a confidence label:

```
Confidence labels based on data completeness:
  - FULL:   All required data present    → confidence = 1.0
  - PARTIAL: Some data estimated         → confidence = 0.7
  - MINIMAL: Mostly defaults             → confidence = 0.4
  - NONE:    No data available           → confidence = 0.0

Overall confidence = average of sub-score confidences.
```

### 3.7 Required Permissions

```
Level 1 (Read): Full access — owner sees all sub-scores.
Staff (future): Read access to relevant sections only.
```

### 3.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <5ms |
| Memory reads | 8 section reads |
| Allocations | <50KB |

### 3.9 Test Cases

```
TC-HS-001: Healthy business with strong sales, profit margin >20%, no stock issues, no overdue
  → Score: 90+ (Excellent)

TC-HS-002: Business with no sales, heavy stock, high overdue
  → Score: <30 (Critical)

TC-HS-003: New business (first week, few transactions)
  → Score: around 50 with PARTIAL confidence

TC-HS-004: High sales but negative profit margin (COGS exceed revenue)
  → Score penalized by profit health sub-score

TC-HS-005: All inventory out of stock
  → inventoryScore = 0, overall score heavily penalized

TC-HS-006: Perfect receivable collection (all customers paid)
  → receivableScore = 100

TC-HS-007: Expenses exceed sales
  → expenseScore = 0

TC-HS-008: Trend improving — compare two consecutive periods
  → trend = "improving"

TC-HS-009: Zero products, zero customers, zero sales (fresh organization)
  → Score: 50, all confidences = NONE/MINIMAL

TC-HS-010: Single product with high margin, single customer, no stock issues
  → Score: 80+ (Good) with correct sub-scores
```

---

## 4. SK002: Sales Analytics

### 4.1 Purpose

Compute structured sales analytics — totals, trends, top products, profit estimates, and periodic breakdowns.

### 4.2 Inputs

```
MemoryStore (sales sections required):
  - sales: PeriodData<SalesSummary> (today, this_week, this_month, last_30_days, all_time)
  - products: Map<string, ProductMemory>
  - customers: Map<string, CustomerMemory>
  - meta: { current_date }
```

### 4.3 Outputs

```typescript
interface SalesAnalyticsResult {
  overview: {
    totalRevenue: number;
    totalProfit: number;
    profitMargin: number | null;      // Percentage, null if incalculable
    invoiceCount: number;
    averageSaleValue: number;
    byPaymentType: Record<string, number>;
  };

  periods: {
    today: PeriodSummary;
    thisWeek: PeriodSummary;
    thisMonth: PeriodSummary;
    last30Days: PeriodSummary;
  };

  trends: {
    daily: TrendPoint[];              // Last 30 days
    weekly: TrendPoint[];             // Last 12 weeks
    monthly: TrendPoint[];            // Last 12 months
    changeVsLastPeriod: number;       // Percentage change
  };

  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
    profit: number;
    margin: number | null;
  }>;                                 // Top 10 by revenue

  topCustomers: Array<{
    customerId: string;
    customerName: string;
    revenue: number;
    invoiceCount: number;
    lastSaleDate: string | null;
  }>;                                 // Top 10 by revenue

  metadata: {
    periodCovered: string;
    hasCompleteData: boolean;         // False if cost data is missing
    warnings: string[];
  };
}

interface PeriodSummary {
  revenue: number;
  profit: number;
  invoiceCount: number;
  averageValue: number;
  profitMargin: number | null;
}

interface TrendPoint {
  label: string;                      // "Mon", "Tue" or "2026-07-01" or "July"
  value: number;
  comparisonValue?: number;           // Previous period value for comparison
}
```

### 4.4 Algorithm

```
STEP 1 — Revenue Calculation
  For each sales transaction in the period:
    revenue = sum(lineItem.quantity * lineItem.sellingPrice)
  
  Periods are computed by filtering transactions by date ranges:
    today:       date === meta.current_date
    thisWeek:    date within current week (Monday–Sunday)
    thisMonth:   date within current month
    last30Days:  date >= meta.current_date - 30 days

STEP 2 — Profit Calculation
  For each line item:
    If lineItem has purchase_price_snapshot:
      unitCost = purchase_price_snapshot
    Else if product.last_purchase_price > 0:
      unitCost = product.last_purchase_price
    Else:
      unitCost = null (cost unknown)
    
    If unitCost is not null:
      lineProfit = quantity * (sellingPrice - unitCost)
      lineRevenue = quantity * sellingPrice
      knownCost = true
    Else:
      lineProfit = 0
      lineRevenue = quantity * sellingPrice
      knownCost = false

  totalRevenue = sum(lineRevenue)
  totalKnownProfit = sum(lineProfit where knownCost)
  unknownCostRevenue = sum(lineRevenue where not knownCost)
  profitMargin = totalRevenue > 0 ? (totalKnownProfit / totalRevenue) * 100 : null

  If unknownCostRevenue / totalRevenue > 0.5:
    Warning: PROFIT_ESTIMATE_LOW_CONFIDENCE — "More than 50% of revenue has unknown cost data"

STEP 3 — Average Sale Value
  averageSaleValue = invoiceCount > 0 ? totalRevenue / invoiceCount : 0

STEP 4 — Payment Type Breakdown
  Group revenue by payment_type field from transactions.
  byPaymentType = { "cash": amount, "credit": amount, "transfer": amount, "online": amount }

STEP 5 — Trend Computation
  Daily: Group last 30 days of sales by date. Fill missing dates with 0.
  Weekly: Group last 12 weeks by ISO week number.
  Monthly: Group last 12 months by month.

STEP 6 — Top Products
  Aggregate line items by product ID for the last_30_days period.
  Sort by revenue descending. Take top 10.
  For each: compute quantity, revenue, profit, margin.

STEP 7 — Top Customers
  Aggregate transactions by customer ID for the last_30_days period.
  Sort by revenue descending. Take top 10.
  For each: compute revenue, invoice count, last sale date.

STEP 8 — Period Comparison
  changeVsLastPeriod = compare this month vs previous month:
    If previousMonthRevenue > 0:
      ((thisMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
    Else if thisMonthRevenue > 0:  +100 (growth from zero)
    Else:  0
```

### 4.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No sales in period | All values 0. Warning: "No sales in selected period" |
| All cost data missing | profit = 0, margin = null. Warning: PROFIT_ESTIMATE_LOW_CONFIDENCE |
| Single massive sale distorts average | averageSaleValue includes it. No automatic outlier removal — owner should see it |
| Period with negative quantities (returns) | Net quantity can be negative. Warning: "Returns detected in period" |
| Zero-priced items (free samples) | Included in quantity count, revenue = 0. Warning: "Zero-priced items detected" |
| Incomplete current day | today values are partial. Warning: "Current day data is incomplete" |
| Extremely high number of transactions (>10k) | Process in batches, maintain total budget of 20ms |

### 4.6 Confidence Scoring

```
Based on percentage of revenue with known costs:
  >= 80% known costs → confidence = "HIGH"
  >= 50% known costs → confidence = "MEDIUM"
  < 50% known costs  → confidence = "LOW" (profit data unreliable)
  No cost data at all → confidence = "NONE" (no profit data available)
```

### 4.7 Required Permissions

```
Level 1 (Read): Full access to sales analytics.
Staff (future): Scoped to staff-visible products/customers.
```

### 4.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <20ms |
| Max transaction processing | 10,000 |
| Max product processing | 5,000 |

### 4.9 Test Cases

```
TC-SA-001: 30 days of consistent daily sales of PKR 10,000 each
  → Total revenue = PKR 300,000, daily trend shows 10,000 per point

TC-SA-002: Partial cost data (60% of items have cost info)
  → profitMargin calculated, confidence = "MEDIUM"

TC-SA-003: Zero sales in period
  → All values 0, warning generated

TC-SA-004: Single customer accounts for 80% of revenue
  → TopCustomers shows 1 customer dominating

TC-SA-005: Sales include returns (negative quantities)
  → Warning generated, net quantities reflect returns

TC-SA-006: Mixed payment types (cash + credit + transfer)
  → byPaymentType has correct breakdown matching totals

TC-SA-007: Month-over-month growth from PKR 50,000 to PKR 75,000
  → changeVsLastPeriod = +50%

TC-SA-008: Top 10 products have correct margin calculations
  → Each product's profit, margin, revenue computed correctly
```

---

## 5. SK003: Inventory Analytics

### 5.1 Purpose

Compute inventory health metrics — stock levels, stock value, low stock alerts, and categorization of stock status.

### 5.2 Inputs

```
MemoryStore:
  - products: Map<string, ProductMemory>  (including current_stock, reorder_level, last_purchase_price)
  - inventory: partial (may already have some computed values)
```

### 5.3 Outputs

```typescript
interface InventoryAnalyticsResult {
  summary: {
    totalProducts: number;
    totalStockValue: number;            // Market value of all stock
    totalStockCost: number;             // Cost value of all stock
    activeProductCount: number;         // Products with stock > 0
  };

  stockStatus: {
    outOfStock: number;                 // Products with stock <= 0
    lowStock: number;                   // Stock > 0 and <= reorder level
    healthy: number;                    // Stock > reorder level
    overstocked: number;                // Stock > 3x reorder level
  };

  stockStatusPercentages: {
    outOfStockPct: number;
    lowStockPct: number;
    healthyPct: number;
    overstockedPct: number;
  };

  lowStockItems: Array<{
    productId: string;
    productName: string;
    currentStock: number;
    reorderLevel: number;
    status: "out_of_stock" | "urgent" | "low_soon" | "healthy";
    estimatedDaysLeft: number | null;
    lastPurchasePrice: number;
  }>;                                   // Sorted by urgency (most urgent first)

  categories: Array<{
    categoryName: string;
    productCount: number;
    stockValue: number;
    lowStockCount: number;
  }>;

  turnover: {
    overallTurnoverRate: number | null; // COGS / average inventory value
    fastMovers: string[];               // Product IDs (top 10 by 30d sales)
    slowMovers: string[];               // Product IDs (zero sales in 30d, stock > 0)
  };

  metadata: {
    hasReorderLevelData: boolean;       // False if all reorder levels are 0/unset
    hasCostData: boolean;              // False if all last_purchase_prices are 0
    warnings: string[];
  };
}
```

### 5.4 Algorithm

```
STEP 1 — Stock Value Calculation
  For each product with current_stock > 0:
    unitValue = product.default_selling_price  // Market value
    unitCost = product.last_purchase_price       // Cost value
  
  totalStockValue = sum(current_stock * unitValue)
  totalStockCost = sum(current_stock * unitCost)

  If totalStockValue == 0 (no products have defaults selling price):
    Warning: "Selling prices not set for any product"
  If totalStockCost == 0 (no products have purchase prices):
    Warning: "Purchase costs not set for any product"

STEP 2 — Stock Status Classification
  For each product:
    If current_stock <= 0:
      status = "out_of_stock"
    Else if reorder_level > 0:
      dailySales = total_sold_30d > 0 ? total_sold_30d / 30 : 0
      estimatedDaysLeft = dailySales > 0 ? current_stock / dailySales : null
      If current_stock <= reorder_level * 0.5:  status = "urgent"
      Else if estimatedDaysLeft !== null && estimatedDaysLeft <= 7:  status = "low_soon"
      Else:  status = "healthy"
    Else:
      status = "healthy"  // No reorder level set — assume healthy

STEP 3 — Category Aggregation
  Group products by category field.
  For each category:
    productCount = number of products
    stockValue = sum(current_stock * default_selling_price)
    lowStockCount = number of products with status !== "healthy"

STEP 4 — Turnover Rate
  COGS = total cost of goods sold in last_30_days
  avgInventoryValue = average of (totalStockCost at start and end of period)
  If avgInventoryValue > 0:
    overallTurnoverRate = COGS / avgInventoryValue
  Else:
    overallTurnoverRate = null

STEP 5 — Fast/Slow Movers
  Fast movers: Products with total_sold_30d > 0, sorted descending, top 10.
  Slow movers: Products with total_sold_30d === 0 && current_stock > 0, sorted by stock value descending.
```

### 5.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No reorder levels set for any product | All statuses = "healthy". Warning: "Reorder levels not configured" |
| Negative stock (oversold) | Treated as out_of_stock with current_stock = 0 for value calculations |
| All products out of stock | outOfStock = totalProducts. Warning: "All products are out of stock" |
| Zero products in system | All counts 0. Warning: "No products registered" |
| Extremely high stock value (single expensive item) | Included normally. No automatic outlier detection. |
| Products in multiple categories | Assigned to one category each. Category names normalized. |

### 5.6 Confidence Scoring

```
Based on data completeness:
  All products have prices AND reorder levels → "FULL"
  >50% have prices AND reorder levels → "PARTIAL"
  <50% have prices or reorder levels → "LOW"
  No data → "NONE"
```

### 5.7 Required Permissions

```
Level 1 (Read): Full inventory access.
```

### 5.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <10ms |
| Max products | 5,000 |

### 5.9 Test Cases

```
TC-IA-001: 100 products, 5 out of stock, 10 low stock, 85 healthy
  → Correct counts, percentages: 5%, 10%, 85%, 0% overstocked

TC-IA-002: All products have prices and reorder levels
  → hasReorderLevelData = true, hasCostData = true

TC-IA-003: No reorder levels set
  → All statuses = "healthy", warning generated

TC-IA-004: Single product worth PKR 1,000,000
  → totalStockValue correct, not treated as outlier

TC-IA-005: Products with negative stock
  → Treated as out_of_stock, stock value uses 0

TC-IA-006: Category breakdown with 3 categories
  → Each category has correct count, value, and low stock count

TC-IA-007: Fast movers vs slow movers correctly identified
  → Top 10 by sales quantity = fast, zero sales = slow

TC-IA-008: Turnover rate computed from COGS and average inventory
  → Formula correct, null when COGS unavailable
```

---

## 6. SK004: Customer Analytics

### 6.1 Purpose

Compute customer-focused analytics — outstanding balances, overdue amounts, top customers by revenue, payment behavior.

### 6.2 Inputs

```
MemoryStore:
  - customers: Map<string, CustomerMemory>
  - sales: PeriodData<SalesSummary>
  - meta: { current_date }
```

### 6.3 Outputs

```typescript
interface CustomerAnalyticsResult {
  summary: {
    totalCustomers: number;
    activeCustomers30d: number;        // Customers with purchase in last 30 days
    newCustomers30d: number;           // Customers with first purchase in last 30 days
    totalOutstanding: number;           // Sum of all customer balances
    totalOverdue: number;              // Sum of overdue amounts
    overdueCustomerCount: number;
  };

  topCustomers: Array<{
    customerId: string;
    customerName: string;
    shopName: string | null;
    totalSales30d: number;
    invoiceCount30d: number;
    outstandingBalance: number;
    overdueAmount: number;
    overdueDays: number | null;
    creditLimit: number | null;
    creditUtilizationPct: number | null;  // outstanding / credit_limit * 100
    lastSaleDate: string | null;
  }>;                                    // Top 10 by totalSales30d

  aging: {
    current: number;                    // Not yet due
    overdue1to30: number;               // 1-30 days overdue
    overdue31to60: number;              // 31-60 days overdue
    overdue61to90: number;              // 61-90 days overdue
    overdue90plus: number;              // >90 days overdue
    totalOverdue: number;
  };

  paymentBehavior: {
    onTimePaymentRate: number | null;   // Percentage of payments made on time
    averagePaymentDays: number | null;  // Average days to pay
    creditCustomerCount: number;        // Customers with outstanding > 0
  };

  metadata: {
    hasCreditLimitData: boolean;
    hasPaymentHistory: boolean;
    warnings: string[];
  };
}
```

### 6.4 Algorithm

```
STEP 1 — Customer Summary
  totalCustomers = customers.size
  activeCustomers30d = count of customers with last_sale_date >= 30 days ago
  newCustomers30d = count of customers whose first sale date is within last 30 days
  totalOutstanding = sum(customers.map(c => c.outstanding_balance))
  totalOverdue = sum(customers.map(c => c.overdue_amount))
  overdueCustomerCount = count of customers with overdue_amount > 0

STEP 2 — Top Customers
  Filter customers with total_sales_30d > 0.
  Sort by total_sales_30d descending.
  Take top 10.
  For each:
    creditUtilizationPct = credit_limit > 0 ? (outstandingBalance / creditLimit * 100) : null
    overdueDays = calculated from overdue_amount and last_payment_date (if available)

STEP 3 — Aging Buckets
  aging is computed from the customer memory overdue_amount field.
  Since Phase 1 memory stores only total overdue_amount, aging is estimated:
    - If overdue_amount > 0 but no aging data: use simple split
    - If detailed aging data exists in memory: bucket accordingly
  Default (Phase 1): totalOverdue assigned to current (no aging detail yet)

STEP 4 — Payment Behavior
  If payment history is available from memory:
    onTimePaymentRate = count(on_time_payments) / count(total_payments) * 100
    averagePaymentDays = average(days_between_invoice_date_and_payment_date)
  Else:
    onTimePaymentRate = null
    averagePaymentDays = null
    hasPaymentHistory = false

  creditCustomerCount = count of customers with outstanding_balance > 0
```

### 6.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| All customers have zero balance | totalOutstanding = 0, overdueCustomerCount = 0 |
| No customers registered | All counts 0. Warning: "No customers registered" |
| Single customer with very large balance | Included in top customers. Not treated as outlier. |
| Customer with balance but no credit limit | creditUtilizationPct = null |
| Customer with balance exceeding credit limit | creditUtilizationPct > 100. Warning generated. |
| No payment history available | onTimePaymentRate and averagePaymentDays = null |

### 6.6 Confidence Scoring

```
Based on data completeness:
  Payment history available AND credit limits set → "FULL"
  Either payment history or credit limits available → "PARTIAL"
  Neither available → "LOW"
  No customers → "NONE"
```

### 6.7 Required Permissions

```
Level 1 (Read): Full customer analytics.
```

### 6.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <15ms |
| Max customers | 5,000 |

### 6.9 Test Cases

```
TC-CA-001: 50 customers, 30 active in 30 days, 5 new, total outstanding PKR 500,000
  → Correct counts and totals

TC-CA-002: Top customer has PKR 200,000 in 30-day sales
  → Listed first in topCustomers

TC-CA-003: Customer with balance exceeding credit limit (PKR 100k / PKR 80k)
  → creditUtilizationPct = 125%, warning generated

TC-CA-004: No customers registered
  → All zeros, warning generated

TC-CA-005: No payment history
  → hasPaymentHistory = false, onTimePaymentRate = null

TC-CA-006: All customers paid on time
  → onTimePaymentRate = 100%

TC-CA-007: Customer with zero balance and zero sales in 30 days
  → Excluded from activeCustomers30d and topCustomers, included in totalCustomers
```

---

## 7. SK005: Expense Analytics

### 7.1 Purpose

Compute expense breakdowns, category analysis, trends, and expense-to-revenue ratios.

### 7.2 Inputs

```
MemoryStore:
  - expenses: PeriodData<ExpenseSummary>
  - sales: PeriodData<SalesSummary> (for ratio calculations)
  - meta: { current_date }
```

### 7.3 Outputs

```typescript
interface ExpenseAnalyticsResult {
  summary: {
    totalExpenses: number;                // This month
    expenseCount: number;                 // Number of expense entries
    averageExpenseValue: number;
    expenseToRevenueRatio: number | null; // Percentage
    changeVsLastMonth: number | null;     // Percentage change
  };

  byCategory: Array<{
    category: string;
    amount: number;
    percentage: number;                   // Of total expenses
    count: number;
    trend: "up" | "down" | "stable";     // vs last month
  }>;                                     // Sorted by amount descending

  trends: {
    daily30d: TrendPoint[];
    monthly12m: TrendPoint[];
    categoryTrends: Array<{
      category: string;
      data: TrendPoint[];                 // Monthly for last 6 months
    }>;
  };

  anomalies: Array<{
    category: string;
    reason: string;
    deviation: number;                    // Percentage above normal
    amount: number;
    severity: "low" | "medium" | "high";
  }>;

  metadata: {
    topCategoryName: string;
    topCategoryPct: number;
    hasCategoryData: boolean;
    warnings: string[];
  };
}
```

### 7.4 Algorithm

```
STEP 1 — Expense Summary
  totalExpenses = expenses.this_month.total_amount
  expenseCount = number of expense entries in this month
  averageExpenseValue = expenseCount > 0 ? totalExpenses / expenseCount : 0

STEP 2 — Expense-to-Revenue Ratio
  thisMonthSales = sales.this_month.total_amount
  If thisMonthSales > 0:
    expenseToRevenueRatio = (totalExpenses / thisMonthSales) * 100
  Else if totalExpenses > 0:
    expenseToRevenueRatio = null (expenses exist but no revenue)
    Warning: "Expenses recorded but no revenue this month"
  Else:
    expenseToRevenueRatio = null

STEP 3 — Category Breakdown
  categories = expenses.this_month.by_category
  For each category:
    percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0
    trend = compare category's this_month amount to previous_month amount
      If change > 10%:    trend = "up"
      If change < -10%:   trend = "down"
      Else:               trend = "stable"

  Sort categories by amount descending.
  topCategoryName = categories[0].category (or null if no categories)
  topCategoryPct = categories[0].percentage (or 0)

STEP 4 — Trend Computation
  Daily30d: Group expenses by day for last 30 days. Sum amounts per day.
  Monthly12m: Group expenses by month for last 12 months. Sum amounts per month.

STEP 5 — Anomaly Detection
  For each category in this month:
    averageMonthly = average of category amounts over last 6 months
    If averageMonthly > 0:
      deviation = ((thisMonthAmount - averageMonthly) / averageMonthly) * 100
      If deviation > 50:
        Add anomaly: reason = "Category {name} is {deviation}% above normal"
          severity = deviation > 100 ? "high" : (deviation > 75 ? "medium" : "low")

STEP 6 — Month-over-Month Change
  If previousMonthTotal > 0:
    changeVsLastMonth = ((totalExpenses - previousMonthTotal) / previousMonthTotal) * 100
  Else:
    changeVsLastMonth = null
```

### 7.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No expenses in period | All values 0. Warning: "No expenses recorded in this period" |
| Single category accounts for all expenses | One category at 100%. |
| No category labels (all "uncategorized") | hasCategoryData = false. Warning: "Expenses not categorized" |
| Negative expense amounts | Treated as credits. Warning: "Negative expense values detected" |
| Expense exceeds revenue | expenseToRevenueRatio > 100%. Warning generated. |
| Zero revenue with expenses | expenseToRevenueRatio = null. Warning: "No revenue to compare against" |

### 7.6 Confidence Scoring

```
Based on categorization and completeness:
  All expenses categorized AND 6+ months history → "FULL"
  All expenses categorized OR 3+ months history → "PARTIAL"
  Uncategorized expenses OR <3 months history → "LOW"
  No expense data → "NONE"
```

### 7.7 Required Permissions

```
Level 1 (Read): Full expense analytics.
```

### 7.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <10ms |
| Max expense entries | 5,000 |
| Max categories | 50 |

### 7.9 Test Cases

```
TC-EA-001: PKR 100,000 total, 5 categories: Transport (40%), Salary (30%), Utilities (20%), Supplies (5%), Other (5%)
  → Correct percentages, sorted descending

TC-EA-002: Transport category doubled this month (PKR 40k vs normal PKR 20k)
  → Anomaly detected: deviation = +100%, severity = "high"

TC-EA-003: No expenses recorded
  → All values 0, warning generated

TC-EA-004: Expense-to-revenue ratio of 80%
  → Correct percentage, warning not generated (below 100%)

TC-EA-005: Expense-to-revenue ratio of 120% (expenses exceed revenue)
  → Correct percentage, warning: expenses exceed revenue

TC-EA-006: All expenses uncategorized
  → hasCategoryData = false, single "Uncategorized" category at 100%
```

---

## 8. SK006: Staff Analytics

### 8.1 Purpose

Compute staff performance analytics — active duty sessions, sales per staff member, location data.

### 8.2 Inputs

```
MemoryStore:
  - staff: Map<string, StaffMemory>
  - sales: PeriodData<SalesSummary> (for per-staff breakdown if available)
```

### 8.3 Outputs

```typescript
interface StaffAnalyticsResult {
  summary: {
    totalStaff: number;
    activeStaff: number;               // Currently on duty
    totalSalesToday: number;            // Sum of all staff sales today
    averagePerStaff: number;           // Per active staff
  };

  staffList: Array<{
    staffId: string;
    name: string;
    role: string;
    isActiveDuty: boolean;
    salesToday: number;
    lastLocation: { lat: number; lng: number; capturedAt: string } | null;
    lastDutyStart: string | null;
    dutyDuration: number | null;       // Hours on duty today
  }>;

  activeLocations: Array<{
    staffId: string;
    staffName: string;
    lat: number;
    lng: number;
    capturedAt: string;
  }>;

  metadata: {
    hasLocationData: boolean;
    hasSalesAttribution: boolean;       // Whether sales are linked to staff
    warnings: string[];
  };
}
```

### 8.4 Algorithm

```
STEP 1 — Staff Summary
  totalStaff = staff.size
  activeStaff = count of staff with is_active_duty === true
  totalSalesToday = sum(staff.sales_count_today * average_sale_value) or
                   = sum of sales attributed to staff today
  averagePerStaff = activeStaff > 0 ? totalSalesToday / activeStaff : 0

STEP 2 — Staff List Construction
  For each staff member:
    If is_active_duty && last_location exists:
      Include in activeLocations
    dutyDuration = if on_duty_since exists:
      (currentTime - on_duty_since) in hours, rounded to 1 decimal
    Else: null

STEP 3 — Sales Attribution
  If sales_attribution data exists (sales link to staff_member_id):
    hasSalesAttribution = true
    salesToday = sum of sales amounts where staff_member_id matches and date = today
  Else:
    hasSalesAttribution = false
    salesToday = 0 for all staff
    Warning: "Sales are not attributed to individual staff members"

STEP 4 — Location Summary
  Collect all staff with active duty + location data.
  hasLocationData = count(activeLocations) > 0
```

### 8.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No staff registered | All counts 0. Warning: "No staff registered" |
| No staff on duty | activeStaff = 0. averagePerStaff = 0 |
| Sales not attributed to staff | totalSalesToday = 0. Warning generated |
| Staff on duty but no location | Not included in activeLocations. No warning (location tracking optional) |
| Staff with 24+ hour duty session | dutyDuration capped at 24 hours. Warning: "Unusually long duty session" |

### 8.6 Confidence Scoring

```
Sales attribution available AND location data → "FULL"
Sales attribution or location data → "PARTIAL"
Neither → "LOW" (only staff count available)
```

### 8.7 Required Permissions

```
Level 1 (Read): Full staff analytics. Staff (future): Self-only view.
```

### 8.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <5ms |
| Max staff | 100 |

### 8.9 Test Cases

```
TC-SA-001: 10 staff, 5 active, sales attributed, 3 with locations
  → Correct counts, activeLocations has 3 entries

TC-SA-002: No staff registered
  → All values 0, warning generated

TC-SA-003: Sales not attributed to staff
  → hasSalesAttribution = false, totalSalesToday = 0

TC-SA-004: Staff on duty for 8.5 hours
  → dutyDuration = 8.5

TC-SA-005: Staff on duty for 30 hours (impossible)
  → dutyDuration capped at 24, warning generated
```

---

## 9. SK007: KPI Calculator

### 9.1 Purpose

Calculate a comprehensive set of Key Performance Indicators (KPIs) from business data. This skill aggregates data from other analytics skills to produce consistent, comparable metrics.

### 9.2 Inputs

```
MemoryStore (requires all sections):
  - sales: PeriodData<SalesSummary>
  - purchases: PeriodData<PurchaseSummary>
  - expenses: PeriodData<ExpenseSummary>
  - inventory: InventoryMemory
  - products: Map<string, ProductMemory>
  - customers: Map<string, CustomerMemory>
```

### 9.3 Outputs

```typescript
interface KpiResult {
  kpis: KpiItem[];
  categories: {
    revenue: KpiItem[];
    profitability: KpiItem[];
    efficiency: KpiItem[];
    liquidity: KpiItem[];
    growth: KpiItem[];
  };
  metadata: {
    totalKpis: number;
    calculatedAt: string;
    warnings: string[];
  };
}

interface KpiItem {
  key: string;                          // Unique identifier
  label: string;                        // Human-readable name
  category: "revenue" | "profitability" | "efficiency" | "liquidity" | "growth";
  value: number;
  unit: "currency" | "percentage" | "count" | "ratio" | "days";
  formatted: string;                    // "PKR 45,000" or "23.5%" or "5"
  change: number | null;                // Percentage change vs previous period
  changeLabel: "up" | "down" | "flat";
  isPercentage: boolean;
  comparisonPeriod: string;             // e.g., "vs yesterday" or "vs last month"
  confidence: "high" | "medium" | "low";
}
```

### 9.4 KPI Catalog

```
REVENUE KPIs

KPI-01: Today's Revenue
  Formula: sales.today.total_amount
  Unit: currency
  Comparison: vs yesterday
  Confidence: high

KPI-02: This Month's Revenue
  Formula: sales.this_month.total_amount
  Unit: currency
  Comparison: vs last month
  Confidence: high

KPI-03: Average Sale Value
  Formula: sales.this_month.total_amount / sales.this_month.invoice_count
  Unit: currency
  Comparison: vs last month
  Confidence: medium (affected by very large or very small sales)

KPI-04: Revenue per Customer (30d)
  Formula: sales.last_30_days.total_amount / activeCustomerCount
  Where activeCustomerCount = customers with purchases in last 30 days
  Unit: currency
  Comparison: vs previous 30 days
  Confidence: medium

PROFITABILITY KPIs

KPI-05: Gross Profit Margin
  Formula: (sales.this_month.profit_estimate / sales.this_month.total_amount) * 100
  If denominator is 0: null
  Unit: percentage
  Comparison: vs last month
  Confidence: based on cost data completeness

KPI-06: Net Profit (30d)
  Formula: sales.last_30_days.profit_estimate - expenses.last_30_days.total_amount
  Unit: currency
  Comparison: vs previous 30 days
  Confidence: medium (depends on expense completeness)

KPI-07: Expense Ratio
  Formula: (expenses.this_month.total_amount / sales.this_month.total_amount) * 100
  If denominator is 0: null
  Unit: percentage
  Comparison: vs last month
  Confidence: high

KPI-08: Profit per Sale
  Formula: sales.this_month.profit_estimate / sales.this_month.invoice_count
  Unit: currency
  Comparison: vs last month
  Confidence: medium

EFFICIENCY KPIs

KPI-09: Stock Turnover Rate (30d)
  Formula: COGS_last_30d / average_inventory_value
  Where:
    COGS_last_30d = sum of (quantity * unit_cost) for all sales in last 30 days
    average_inventory_value = (beginning_inventory + ending_inventory) / 2
  Unit: ratio
  Comparison: vs previous 30 days
  Confidence: low (requires accurate cost data)

KPI-10: Inventory-to-Sales Ratio
  Formula: total_stock_value / sales.last_30_days.total_amount
  If denominator is 0 or null: null
  Unit: ratio
  Comparison: vs previous 30 days
  Confidence: medium

KPI-11: Stockout Rate
  Formula: (out_of_stock_count / total_products) * 100
  Unit: percentage
  Comparison: vs last month
  Confidence: high

KPI-12: Low Stock Percentage
  Formula: ((out_of_stock_count + low_stock_count) / total_products) * 100
  Unit: percentage
  Comparison: vs last month
  Confidence: high

LIQUIDITY KPIs

KPI-13: Receivables Total
  Formula: sum(customers.map(c => c.outstanding_balance))
  Unit: currency
  Comparison: vs last month
  Confidence: high

KPI-14: Overdue Receivables
  Formula: sum(customers.map(c => c.overdue_amount))
  Unit: currency
  Comparison: vs last month
  Confidence: medium

KPI-15: Overdue Ratio
  Formula: (total_overdue / total_receivables) * 100
  If denominator is 0: 0
  Unit: percentage
  Comparison: vs last month
  Confidence: medium

KPI-16: Payables Total
  Formula: sum(suppliers.map(s => s.payable_amount))
  Unit: currency
  Comparison: vs last month
  Confidence: high

KPI-17: Current Ratio (Simplified)
  Formula: total_receivables / total_payables
  If denominator is 0: null (no payables = healthy, but ratio undefined)
  Unit: ratio
  Comparison: vs last month
  Confidence: medium

GROWTH KPIs

KPI-18: Sales Growth (Month-over-Month)
  Formula: ((sales.this_month.total_amount - sales.last_month.total_amount) / sales.last_month.total_amount) * 100
  If last_month is 0: null (or +100% if this_month > 0)
  Unit: percentage
  Comparison: previous month
  Confidence: high

KPI-19: Sales Growth (Year-over-Year)
  Formula: ((sales.this_month.total_amount - sales.same_month_last_year.total_amount) / sales.same_month_last_year.total_amount) * 100
  If same_month_last_year is unavailable or 0: null
  Unit: percentage
  Comparison: same month last year
  Confidence: low (requires 1+ year of data)

KPI-20: Customer Growth (30d)
  Formula: new_customers_30d as computed by Customer Analytics
  Unit: count
  Comparison: vs previous 30 days
  Confidence: medium
```

### 9.5 Algorithm

```
STEP 1 — Gather Inputs
  Read all required sections from MemoryStore.

STEP 2 — Iterate KPI Catalog
  For each KPI in the catalog:
    - Compute value using the specified formula
    - Compute change vs previous period
    - Assign changeLabel: "up" if change > 3%, "down" if change < -3%, else "flat"
    - Format value: currency → "PKR X,XXX", percentage → "XX.X%", count → "XXX"
    - Assign confidence based on data completeness

STEP 3 — Categorization
  Group KPIs into categories: revenue, profitability, efficiency, liquidity, growth.

STEP 4 — Change Computation
  For each KPI with a defined comparison period:
    If previousValue > 0:
      change = ((currentValue - previousValue) / previousValue) * 100
    Else if currentValue > 0:
      change = 100 (growth from zero)
    Else:
      change = 0
```

### 9.6 Edge Cases

| Condition | Behavior |
|-----------|----------|
| All revenue KPIs zero (no sales) | KPIs return 0 or null. Confidence still valid. |
| Profit margin cannot be calculated (no cost data) | null with confidence = "low" |
| Division by zero in any formula | Return null, log warning. Not an error. |
| Negative profit margin | Handled correctly as negative percentage. |
| Stock turnover with zero stock | null with warning |
| Year-over-year comparison with <1 year data | null with confidence = "low" |
| All customers have zero balance | KPI-13, KPI-14, KPI-15 = 0 |

### 9.7 Confidence Scoring

```
Per-KPI confidence based on:
  - Data source completeness (was all required data available?)
  - Calculation stability (was there a division by zero risk?)
  - Time period coverage (does the period have enough data?)

Overall confidence = weighted average of per-KPI confidences.
```

### 9.8 Required Permissions

```
Level 1 (Read): Full KPI access.
```

### 9.9 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <20ms |
| KPIs computed | 20 |
| KPI categories | 5 |

### 9.10 Test Cases

```
TC-KPI-001: Revenue PKR 500,000 this month, PKR 400,000 last month
  → KPI-02 = PKR 500,000, change = +25%

TC-KPI-002: Profit margin 18.5%
  → KPI-05 = 18.5%, formatted = "18.5%", change computed correctly

TC-KPI-003: 150 products, 15 out of stock
  → KPI-11 = 10%, KPI-12 = 15% (if 7 low stock)

TC-KPI-004: Receivables PKR 1,000,000, Payables PKR 400,000
  → KPI-13 = PKR 1,000,000, KPI-16 = PKR 400,000, KPI-17 = 2.5

TC-KPI-005: No sales in current or previous month
  → KPI-01 = 0, KPI-18 = null

TC-KPI-006: No cost data for any product
  → KPI-05, KPI-06 = null with "low" confidence

TC-KPI-007: All 20 KPIs computed within 20ms
  → Performance budget met

TC-KPI-008: Negative profit margin (-5.2%)
  → KPI-05 = -5.2%, changeLabel = "down"
```

---

## 10. SK008: Forecast Engine

### 10.1 Purpose

Generate deterministic forecasts using simple mathematical models. Phase 1 uses moving averages and linear trends. No ML, no LLM, no external APIs.

### 10.2 Inputs

```
MemoryStore:
  - sales: PeriodData<SalesSummary> (all periods with daily breakdown)
  - computed.trends: TrendResult[] (existing trend data)
  - meta: { current_date }
```

### 10.3 Outputs

```typescript
interface ForecastResult {
  forecasts: ForecastItem[];
  metadata: {
    method: "moving_average" | "linear_trend" | "seasonal";
    periodsAnalyzed: number;
    confidence: "high" | "medium" | "low";
    warnings: string[];
  };
}

interface ForecastItem {
  metric: "sales_revenue" | "sales_quantity" | "profit" | "expenses" | "cash_flow";
  period: "daily" | "weekly" | "monthly";
  targetDate: string;                   // ISO date of forecast point
  predictedValue: number;
  confidence: number;                   // 0.0–1.0
  range: {
    lower: number;                      // Lower bound (confidence interval)
    upper: number;                      // Upper bound (confidence interval)
  };
  basedOn: string;                      // e.g., "last_30_days" | "last_90_days"
  trend: "up" | "down" | "stable";
  changePct: number | null;            // Predicted change vs current period
}
```

### 10.4 Algorithm

```
FORECAST METHODS

Method 1 — Simple Moving Average (SMA)
  Use when: Data shows no clear trend (stable business)
  Formula:
    SMA(n) = (sum of values for last n periods) / n
    Forecast = SMA(n)
  Window n:
    - Daily forecast:  n = 7   (7-day moving average)
    - Weekly forecast: n = 4   (4-week moving average)
    - Monthly forecast: n = 3  (3-month moving average)

Method 2 — Linear Trend (Linear Regression)
  Use when: Data shows a clear upward or downward trend
  Formula:
    Given points (x_i, y_i) for i = 1..n:
      slope = (n * sum(x_i * y_i) - sum(x_i) * sum(y_i)) / (n * sum(x_i²) - sum(x_i)²)
      intercept = (sum(y_i) - slope * sum(x_i)) / n
      Forecast(x) = slope * x + intercept
  Where:
    x_i = period index (1, 2, 3, ...)
    y_i = actual value

Method 3 — Seasonal Naive
  Use when: Same-period-last-cycle data is available
  Formula:
    Forecast = value from same period in previous cycle
    Example: Forecast for next Monday = last Monday's value

METHOD SELECTION LOGIC

If data_points < 3:
  method = "insufficient_data"
  forecast = average of available data
  confidence = 0.2

If data_points >= 3 AND data_points < 7:
  method = "moving_average"
  Use SMA with n = data_points
  confidence = 0.4

If data_points >= 7:
  Compute linear regression slope.
  If |slope| / average > 0.1 (significant trend):
    method = "linear_trend"
    confidence = 0.6 (stronger with more data)
  Else:
    method = "moving_average"
    confidence = 0.5

If same period last year available (52+ weeks of data):
  Use seasonal component to adjust forecast:
    seasonal_factor = value_same_period_last_year / average_last_year
    adjusted_forecast = base_forecast * seasonal_factor
  confidence += 0.15 (capped at 0.95)

CONFIDENCE INTERVAL
  range_lower = predictedValue * (1 - margin)
  range_upper = predictedValue * (1 + margin)
  Where margin = (1 - confidence) * 0.5

  Example: predictedValue = 100,000, confidence = 0.7
    margin = 0.3 * 0.5 = 0.15
    range = [85,000, 115,000]

FORECAST PERIODS

Daily Forecast (next 7 days):
  - For each of next 7 days, use SMA-7 or linear trend
  - Adjust for day-of-week pattern if 4+ weeks of data available

Weekly Forecast (next 4 weeks):
  - Sum of next 7 days × 4 (short-term)
  - Or SMA-4 on weekly data

Monthly Forecast (next 3 months):
  - SMA-3 on monthly data
  - Or linear trend on last 12 months
```

### 10.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| Less than 3 data points | method = "insufficient_data". confidence = 0.2. Warning: "Insufficient data for reliable forecast" |
| All values are zero | Forecast = 0. confidence = 0.3. Warning: "No historical data for forecast" |
| Extreme outlier (10x normal) | Included in calculation. No automatic outlier removal. Warning: "Outlier detected in historical data" |
| Negative values (returns) | Included. Forecast may be negative. Warning: "Negative values in historical data" |
| Flat trend (zero slope) | Uses SMA. confidence = 0.5. |
| Very volatile data (high variance) | margin increases proportionally. confidence decreases. |
| 3+ years of data | Uses linear trend with seasonal adjustment. confidence up to 0.95. |

### 10.6 Confidence Scoring

```
Confidence rules:
  data_points >= 90:               base = 0.7
  data_points >= 30:               base = 0.6
  data_points >= 7:                base = 0.5
  data_points >= 3:                base = 0.4
  data_points < 3:                 base = 0.2

  If seasonal data available:      +0.15 (cap at 0.95)
  If trend is strong (|slope|/avg > 0.2):  +0.10 (cap at 0.95)
  If data is very volatile (CV > 1.0):     -0.15

  Final confidence: clamp(base, 0.1, 0.95)

  Labels:
    >= 0.7: "high"
    >= 0.4: "medium"
    < 0.4:  "low"
```

### 10.7 Required Permissions

```
Level 1 (Read): Full forecast access.
```

### 10.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <15ms |
| Max data points processed | 90 (daily for 3 months) |
| Forecasts generated | Up to 5 (sales revenue, quantity, profit, expenses, cash flow) |

### 10.9 Test Cases

```
TC-FE-001: 30 days of steadily increasing sales (10,000 → 20,000 → 30,000)
  → Linear trend detected, slope > 0, confidence >= 0.6
  → Next 7 days forecast shows continued increase

TC-FE-002: 7 days of flat sales (~PKR 15,000 each day)
  → SMA-7 used, forecast ~PKR 15,000, confidence = 0.5

TC-FE-003: 2 data points only (new business)
  → method = "insufficient_data", confidence = 0.2, warning generated

TC-FE-004: All sales data = 0
  → Forecast = 0, confidence = 0.3

TC-FE-005: Highly volatile data (PKR 1,000 one day, PKR 100,000 next)
  → Large confidence interval, lower confidence

TC-FE-006: 14 months of data with seasonal pattern (higher in month 12)
  → Seasonal adjustment applied, confidence boosted

TC-FE-007: Negative forecast due to negative trend
  → Floor at 0 (sales cannot be negative). Warning: "Forecast suggests zero sales"

TC-FE-008: Predict next 7 days individually
  → 7 forecast items with daily periods
```

---

## 11. SK009: Reorder Advice

### 11.1 Purpose

Generate deterministic reorder recommendations based on current stock levels, sales velocity, and reorder thresholds.

### 11.2 Inputs

```
MemoryStore:
  - products: Map<string, ProductMemory>
  - inventory: InventoryMemory
  - sales: PeriodData<SalesSummary>
```

### 11.3 Outputs

```typescript
interface ReorderAdviceResult {
  recommendations: ReorderRecommendation[];
  summary: {
    totalUrgent: number;
    totalRecommended: number;
    totalItemsToOrder: number;          // Total quantity across all recommendations
    estimatedCost: number;              // Estimated total cost
  };
  metadata: {
    hasReorderLevelData: boolean;
    hasSalesVelocity: boolean;
    warnings: string[];
  };
}

interface ReorderRecommendation {
  productId: string;
  productName: string;
  currentStock: number;
  reorderLevel: number;
  status: "out_of_stock" | "urgent" | "order_soon" | "watch";
  dailySalesVelocity: number;          // Average daily sales (30-day window)
  estimatedDaysLeft: number | null;    // Days until stock = 0 at current velocity
  suggestedOrderQuantity: number;
  suggestedSupplier: string | null;    // If supplier preference learned
  lastPurchasePrice: number;
  estimatedCost: number;               // suggestedOrderQuantity * lastPurchasePrice
  priority: "high" | "medium" | "low";
  reason: string;                      // Human-readable reason
}
```

### 11.4 Algorithm

```
STEP 1 — Sales Velocity Calculation
  For each product:
    If total_sold_30d > 0:
      dailySalesVelocity = total_sold_30d / 30
    Else:
      dailySalesVelocity = 0
      Warning: "No sales data for product {name}"

STEP 2 — Days Left Estimation
  If dailySalesVelocity > 0:
    estimatedDaysLeft = currentStock / dailySalesVelocity
  Else:
    estimatedDaysLeft = null (no sales data to estimate from)

STEP 3 — Status Classification
  If currentStock <= 0:
    status = "out_of_stock"
    priority = "high"
  Else if reorderLevel > 0:
    If currentStock <= reorderLevel * 0.5:
      status = "urgent"
      priority = "high"
    Else if currentStock <= reorderLevel:
      status = "order_soon"
      priority = "medium"
    Else:
      If estimatedDaysLeft !== null && estimatedDaysLeft <= 7:
        status = "order_soon"
        priority = "medium"
      Else:
        status = "watch"
        priority = "low"
  Else:
    No reorder level set — use heuristic:
      If estimatedDaysLeft !== null && estimatedDaysLeft <= 7:
        status = "order_soon"
        priority = "medium"
      Else if estimatedDaysLeft !== null && estimatedDaysLeft <= 14:
        status = "watch"
        priority = "low"
      Else:
        status = "watch"
        priority = "low"        // No reorder level, no urgency
        (Warning: "Reorder level not set for {product}")

STEP 4 — Suggested Order Quantity
  Basic formula:
    If dailySalesVelocity > 0 AND reorderLevel > 0:
      coverageDays = max(14, reorderLevel / dailySalesVelocity * 30)
      suggestedQty = ceil(dailySalesVelocity * coverageDays) - currentStock
      suggestedQty = max(suggestedQty, reorderLevel - currentStock)
      suggestedQty = max(suggestedQty, 0)
    Else if dailySalesVelocity > 0:
      suggestedQty = ceil(dailySalesVelocity * 14)  // 14-day coverage
      suggestedQty = max(suggestedQty, 1)
    Else:
      suggestedQty = 1  // Minimum 1 unit (no data to base on)

STEP 5 — Supplier Assignment
  If preferenceStore has preferred_suppliers for this product:
    suggestedSupplier = preferred supplier name
  Else:
    suggestedSupplier = null

STEP 6 — Cost Estimation
  estimatedCost = suggestedOrderQuantity * lastPurchasePrice
  If lastPurchasePrice == 0:
    estimatedCost = 0
    Warning: "Purchase price not set for {product}"

STEP 7 — Sorting
  Sort by priority order: high > medium > low
  Within same priority, sort by estimatedDaysLeft ascending (most urgent first).

STEP 8 — Summary
  totalUrgent = count(status in ["out_of_stock", "urgent"])
  totalRecommended = count(status in ["out_of_stock", "urgent", "order_soon"])
  totalItemsToOrder = sum(suggestedOrderQuantity for all recommendations)
  estimatedCost = sum(estimatedCost for all recommendations)
```

### 11.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No reorder levels set for any product | Uses heuristic (sales velocity + 14-day coverage). Warning generated. |
| Product with zero sales velocity but high stock | status = "watch". suggestedQty = 1. priority = "low" |
| Product already overstocked (stock >> reorder level) | Excluded from urgent/order_soon. No recommendation. |
| Extremely high sales velocity (thousands/day) | suggestedQty calculated correctly, may be very large |
| Negative stock (oversold) | treated as out_of_stock. suggestedQty covers the deficit + normal. |
| All products out of stock | All have high priority. Summary shows total. |
| lastPurchasePrice is 0 for all products | estimatedCost = 0 for all. Warning: "Purchase prices not configured" |
| Single product shop | Single recommendation generated. |

### 11.6 Confidence Scoring

```
Based on data quality:
  Reorder levels set AND 30+ days of sales data → "HIGH"
  Either reorder levels OR sales data available → "MEDIUM"
  Neither available → "LOW"
```

### 11.7 Required Permissions

```
Level 1 (Read): Full reorder advice access.
```

### 11.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <10ms |
| Max products | 5,000 |

### 11.9 Test Cases

```
TC-RA-001: Product with stock = 5, reorderLevel = 20, dailySalesVelocity = 3
  → status = "urgent" (5 < 20 * 0.5 = 10)
  → estimatedDaysLeft = 5/3 = 1.67
  → suggestedQty = ceil(3 * max(14, 20/3*30)) - 5 = large coverage order

TC-RA-002: Product with stock = 25, reorderLevel = 20, dailySalesVelocity = 1
  → status = "order_soon" (25 <= 20 is false, but 25 > 20*0.5 is true, so actually healthy)
  → Wait: 25 <= 20? No. 25 > 20*0.5 = 10? Yes. So check estimatedDaysLeft: 25/1 = 25 days. > 7. So status = "watch".
  → Actually re-check: rule is "else if estimatedDaysLeft <= 7" → 25 > 7 → watch.
  → Correct: status = "watch", priority = "low"

TC-RA-003: Product with stock = 0, no reorderLevel, dailySalesVelocity = 5
  → status = "out_of_stock", priority = "high"
  → suggestedQty = ceil(5 * 14) = 70

TC-RA-004: Product with stock = 100, reorderLevel = 20, dailySalesVelocity = 0
  → dailySalesVelocity = 0, estimatedDaysLeft = null
  → status = "watch", suggestedQty = 1

TC-RA-005: Product with stock = -3 (oversold)
  → currentStock treated as 0 for classification = "out_of_stock"
  → suggestedQty covers the deficit

TC-RA-006: All 100 products, 10 out of stock, 15 urgent, 20 order_soon
  → totalUrgent = 25 (out_of_stock + urgent)
  → totalRecommended = 45 (all non-watch)
  → Sorted by priority then daysLeft

TC-RA-007: No reorder levels set (all = 0)
  → Uses heuristic. Warning generated. hasReorderLevelData = false
```

---

## 12. SK010: Recommendation Engine

### 12.1 Purpose

Cross-skill synthesis engine that produces actionable, prioritized recommendations by combining outputs from Health Score, Analytics, KPI, Forecast, and Reorder Advice.

### 12.2 Inputs

```
MemoryStore (requires ALL computed sections):
  - computed.health_score: HealthScoreResult
  - computed.kpis: KpiResult[]
  - computed.trends: TrendResult[]
  - computed.forecasts: ForecastResult[]
  - inventory: InventoryMemory
  - customers: Map<string, CustomerMemory>
  - products: Map<string, ProductMemory>

Also receives results from other skills executed in the current pipeline:
  - salesAnalytics: SalesAnalyticsResult
  - inventoryAnalytics: InventoryAnalyticsResult
  - customerAnalytics: CustomerAnalyticsResult
  - expenseAnalytics: ExpenseAnalyticsResult
  - reorderAdvice: ReorderAdviceResult
  - forecastResult: ForecastResult
```

### 12.3 Outputs

```typescript
interface RecommendationResult {
  recommendations: Recommendation[];
  summary: {
    total: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
    byCategory: Record<string, number>;
  };
  metadata: {
    skillsConsulted: string[];
    generatedAt: string;
    warnings: string[];
  };
}

interface Recommendation {
  id: string;                           // "rec-{uuid}"
  type: "reorder" | "follow_up" | "price_adjustment" | "expense_review"
       | "staff_action" | "forecast_alert" | "health_alert" | "opportunity";
  category: "inventory" | "customers" | "finances" | "staff" | "general";
  priority: "high" | "medium" | "low";
  title: string;                        // Short, actionable title
  description: string;                  // Context + rationale
  expectedImpact: string;               // What will improve
  actionLink: string | null;            // Section ID to navigate to
  sourceSkill: string;                  // Which skill produced the input data
  dismissed: boolean;                   // Client-side tracking
}
```

### 12.4 Algorithm

The Recommendation Engine is a **rule-based synthesis engine**. It reads outputs from all other skills and applies deterministic rules to generate recommendations.

```
STEP 1 — Inventory Recommendations (from Reorder Advice + Inventory Analytics)

  Rule IR1: If product is out_of_stock with high sales velocity:
    → type: "reorder", category: "inventory", priority: "high"
    → title: "Reorder {productName} — Out of Stock"
    → expectedImpact: "Prevent lost sales of ~PKR {monthlyRevenue}/month"

  Rule IR2: If >= 5 products are urgent reorder:
    → type: "reorder", category: "inventory", priority: "high"
    → title: "Review {count} products needing urgent reorder"
    → expectedImpact: "Restore stock for top-selling products"

  Rule IR3: If inventoryHealth < 50 (from Health Score):
    → type: "health_alert", category: "inventory", priority: "high"
    → title: "Inventory health needs attention"
    → expectedImpact: "Improve stock availability and reduce lost sales"

  Rule IR4: If any product has 30d sales > currentStock (will run out):
    → type: "reorder", category: "inventory", priority: "high"
    → title: "{productName} will run out in ~{daysLeft} days"
    → expectedImpact: "Order now to avoid stockout"

STEP 2 — Customer Recommendations (from Customer Analytics)

  Rule CR1: If any customer has overdue > 30 days with significant balance (>PKR 10,000):
    → type: "follow_up", category: "customers", priority: "medium" (30-60 days) or "high" (>60 days)
    → title: "Follow up with {customerName} — overdue by {days} days"
    → expectedImpact: "Recover PKR {amount} in receivables"

  Rule CR2: If total overdue > 20% of total receivables:
    → type: "follow_up", category: "customers", priority: "medium"
    → title: "Overdue receivables at {percentage}% — review collection process"
    → expectedImpact: "Improve cash flow by recovering overdue amounts"

  Rule CR3: If customer creditUtilizationPct > 90%:
    → type: "follow_up", category: "customers", priority: "low"
    → title: "{customerName} nearing credit limit ({utilization}%)"
    → expectedImpact: "Prevent credit risk"

STEP 3 — Financial Recommendations (from KPI + Forecast + Expense Analytics)

  Rule FR1: If expenseToRevenueRatio > 80%:
    → type: "expense_review", category: "finances", priority: "high"
    → title: "Expenses are {ratio}% of revenue — review spending"
    → expectedImpact: "Reduce expense ratio to improve profitability"

  Rule FR2: If profitMargin < 5% and profitMargin >= 0:
    → type: "price_adjustment", category: "finances", priority: "medium"
    → title: "Profit margin is thin ({margin}%) — review pricing"
    → expectedImpact: "Increase margin by adjusting prices or reducing COGS"

  Rule FR3: If profitMargin < 0:
    → type: "price_adjustment", category: "finances", priority: "high"
    → title: "Negative profit margin ({margin}%) — immediate review needed"
    → expectedImpact: "Restore profitability"

  Rule FR4: If anomaly detected in expense category (from Expense Analytics):
    → type: "expense_review", category: "finances", priority: "medium"
    → title: "{category} expenses {deviation}% above normal"
    → expectedImpact: "Investigate unusual spending"

  Rule FR5: If forecast predicts significant decline (>15%):
    → type: "forecast_alert", category: "finances", priority: "medium"
    → title: "Sales forecast predicts {changePct}% decline next month"
    → expectedImpact: "Prepare for reduced revenue"

STEP 4 — Staff Recommendations (from Staff Analytics)

  Rule SR1: If staff on duty > 24 hours:
    → type: "staff_action", category: "staff", priority: "high"
    → title: "{staffName} on duty for {hours} hours — review"
    → expectedImpact: "Ensure staff well-being and compliance"

  Rule SR2: If sales today == 0 and staff are on duty:
    → type: "staff_action", category: "staff", priority: "low"
    → title: "No sales recorded today despite {count} staff on duty"
    → expectedImpact: "Investigate if sales are being recorded properly"

STEP 5 — Health Alert Recommendations (from Health Score)

  Rule HR1: If healthScore < 50:
    → type: "health_alert", category: "general", priority: "high"
    → title: "Business health score is {score} ({label})"
    → expectedImpact: "Address contributing factors: {topReasons}"

  Rule HR2: If health trend is "declining" for 2+ consecutive periods:
    → type: "health_alert", category: "general", priority: "high"
    → title: "Business health declining — {trendEvidence}"
    → expectedImpact: "Reverse the declining trend"

  Rule HR3: If healthScore > 80 (excellent):
    → type: "opportunity", category: "general", priority: "low"
    → title: "Business is performing well (score: {score})"
    → expectedImpact: "Consider expansion or new investments"

STEP 6 — Deduplication
  Remove recommendations with identical titles (same product, same customer, same issue).
  Keep the one with higher priority.

STEP 7 — Priority Sorting
  Sort by: priority (high > medium > low), then by category order.
  Within same priority, sort by estimated financial impact (if available).

STEP 8 — Filtering Against Preferences
  Remove recommendation types in ignored_recommendation_types.
```

### 12.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| No issues found (perfect business) | Only opportunity recommendations. summary.total may be 0 or very low. |
| All skills return incomplete data | Generate recommendations from available data with warnings. |
| Hundreds of low-stock products | Top N (10) individual product recommendations + 1 aggregate recommendation. |
| Conflicting recommendations | Both are included with their respective priorities. Owner decides. |
| Owner has ignored all recommendations of a type | Removed per preference filter. |
| Extremely high priority and low priority only | Sorting works correctly across all levels. |

### 12.6 Confidence Scoring

```
Per-recommendation confidence based on source skill confidence:
  If source skill confidence >= 0.7:  rec_confidence = "HIGH"
  If source skill confidence >= 0.4:  rec_confidence = "MEDIUM"
  Else:                               rec_confidence = "LOW"

Overall engine confidence = average of source skill confidences.
```

### 12.7 Required Permissions

```
Level 1 (Read): Full recommendation access.
```

### 12.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <20ms |
| Rules evaluated | ~20 |
| Max recommendations | 20 (capped to prevent overload) |

### 12.9 Test Cases

```
TC-RE-001: 10 products out of stock (high velocity) + 5 customers overdue 60+ days
  → 10 individual reorder recs (high) + 1 aggregate reorder rec + up to 5 follow-up recs (high)

TC-RE-002: Perfect business (score 95, all margins healthy, no overdue, full stock)
  → 1 opportunity recommendation. No warnings/errors.

TC-RE-003: Expense ratio 90%, profit margin -2%
  → FR1 (high) + FR3 (high) both generated

TC-RE-004: No data available for any skill
  → Empty recommendations array. Warning: "Insufficient data for recommendations"

TC-RE-005: Deduplication — same product from IR1 and IR4
  → Single recommendation kept, higher priority wins

TC-RE-006: Owner has ignored "reorder" type recommendations
  → All reorder recommendations filtered out
```

---

## 13. SK011: Action Planner

### 13.1 Purpose

Decompose an action command into a structured, verifiable execution plan. This skill is invoked during the write pipeline (Stages 4–8) after entity extraction.

### 13.2 Inputs

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage
```

### 13.3 Outputs

```typescript
interface ActionPlanResult {
  actionType: ActionType;               // "action_sale" | "action_purchase" | etc.
  status: "ready" | "needs_input" | "blocked";

  steps: ActionStep[];
  draftSummary: string;                 // "Sale of 5 × Pepsi 500ml @ PKR 130 to Usman General Store"
  estimatedTotal: number | null;

  missingFields: Array<{
    field: string;
    prompt: string;                     // Natural language question to ask owner
    examples: string[];                 // Example values
  }>;

  warnings: string[];                   // Non-blocking concerns
  blockers: string[];                   // Blocking issues — pipeline stops
}

interface ActionStep {
  order: number;
  description: string;                  // Human-readable step description
  checkType: "entity_exists" | "data_valid" | "business_rule" | "permission";
  status: "ready" | "needs_input" | "blocked";
  detail: string;                       // Evidence or reason
}

type ActionType =
  | "action_sale" | "action_purchase" | "action_expense"
  | "action_task" | "action_customer" | "action_supplier"
  | "action_product" | "send_whatsapp";
```

### 13.4 Per-Action-Type Plans

```
CREATE SALE (action_sale)

Required: product, quantity, customer, payment_type
Optional: price, discount, date, staff, notes

Steps:
  1. Verify product exists in Business Memory
     → If not found: blocked. "Product '{name}' not found."
  2. Verify sufficient stock (quantity <= current_stock)
     → If insufficient: blocked. "Only {stock} available, requested {quantity}."
  3. Verify customer exists
     → If not found: blocked. "Customer '{name}' not found."
  4. If price not provided: use default_selling_price
     → If no default price: needs_input. "What price per unit?"
  5. If payment_type = "credit":
       Check customer credit limit
       → If would exceed limit: warning. "Customer would exceed credit limit by PKR {overage}."
  6. Check for overdue customer balance > 30 days
     → Warning: "Customer has overdue balance of PKR {amount} ({days} days)."
  7. Draft summary: "Sale of {qty} × {product} @ PKR {price} to {customer}"
  8. estimatedTotal: quantity * price

CREATE PURCHASE (action_purchase)

Required: product, quantity, supplier
Optional: price, date, payment_type, notes

Steps:
  1. Verify product exists
  2. Verify supplier exists
  3. If price not provided: use last_purchase_price
     → If no last price: needs_input. "What was the purchase price per unit?"
  4. Check for pending purchase draft for same product + supplier
     → Warning: "There is already a pending purchase for {product} from {supplier}."
  5. Draft summary: "Purchase of {qty} × {product} @ PKR {price} from {supplier}"
  6. estimatedTotal: quantity * price

CREATE EXPENSE (action_expense)

Required: amount, category
Optional: description, date, staff, linked_to

Steps:
  1. Verify amount > 0
     → If not: blocked. "Expense amount must be greater than zero."
  2. If category not in known categories list:
     → Warning: "Category '{category}' is new. It will be added to your expense categories."
  3. If amount > 50,000 (high expense):
     → Warning: "This is a high-value expense (PKR {amount}). Please verify."
  4. Draft summary: "Expense: PKR {amount} for {category}"
  5. estimatedTotal: amount

CREATE TASK (action_task)

Required: title
Optional: priority, due_date, assigned_to, description, task_type

Steps:
  1. Verify title is not empty
  2. If assigned_to provided: verify staff exists
  3. If due_date is past:
     → Warning: "Due date is in the past. Set a future date?"
  4. Check for duplicate active task with same title
     → Warning: "A pending task with similar title already exists."
  5. Draft summary: "Task: {title}" (+ priority: {priority} if provided)

CREATE CUSTOMER (action_customer)

Required: name
Optional: shop_name, phone, credit_limit, address

Steps:
  1. Check for existing customer with same name
     → Warning: "A customer named '{name}' already exists. Add anyway?"
  2. If phone provided: validate format (Pakistan: 03XX-XXXXXXX)
     → Warning if invalid format.
  3. If credit_limit provided:
     → Verify credit_limit > 0
  4. Draft summary: "New customer: {name}" (+ shop: {shopName} if provided)

CREATE SUPPLIER (action_supplier)

Required: name
Optional: phone, payment_terms, address

Steps:
  1. Check for existing supplier with same name
     → Warning: "A supplier named '{name}' already exists. Add anyway?"
  2. Draft summary: "New supplier: {name}"

CREATE PRODUCT (action_product)

Required: name, price
Optional: brand, category, reorder_level, track_batch

Steps:
  1. Verify name is not empty
  2. Verify price > 0
     → If not: blocked. "Price must be greater than zero."
  3. Check for existing product with same name + brand
     → Warning: "A product named '{name}' already exists. Add anyway?"
  4. Draft summary: "New product: {name} @ PKR {price}" (+ brand, category if provided)

SEND WHATSAPP (send_whatsapp)

Required: recipient, message
Optional: template_name

Steps:
  1. Resolve recipient: check customer and supplier phone numbers
     → If not found: blocked. "No contact found with that name/phone."
  2. Verify message is not empty
  3. If message length > 1024 chars:
     → Warning: "Message is long ({length} chars). WhatsApp may truncate."
  4. Draft summary: "WhatsApp to {recipientName}: \"{messagePreview}...\""
```

### 13.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| All required fields missing | status = "needs_input", all required missingFields populated |
| Ambiguous entities from Stage 2 | Do NOT reach this skill — pipeline stops at Stage 2 |
| Entity resolved but data is stale | Warning: "Data may be outdated. Last refreshed {age} ago." |
| Action with zero total (free product) | estimatedTotal = 0. Warning: "Zero-value transaction" |
| Very large quantity (10,000 units) | Warning: "Unusually large quantity. Please confirm." |
| Multiple products in one command (Phase 1 = single only) | Phase 1 only handles single-product commands. Warning if multiple detected. |

### 13.6 Confidence Scoring

```
Not applicable — Action Planner is pass/fail based on step statuses:
  All steps "ready" → action can proceed
  Any step "needs_input" → requires owner input
  Any step "blocked" → action cannot proceed
```

### 13.7 Required Permissions

```
Level 2 (Write): Permissions checked in Stage 6 (separate from this skill).
```

### 13.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <10ms |
| Steps per action | 4–8 |

### 13.9 Test Cases

```
TC-AP-001: Complete sale (product exists, stock sufficient, customer exists, price known)
  → All steps "ready", status = "ready", estimatedTotal correct

TC-AP-002: Product not found
  → Step 1 blocked, status = "blocked"

TC-AP-003: Insufficient stock
  → Step 2 blocked, status = "blocked"

TC-AP-004: Sale to customer with overdue > 30 days
  → Step 6 warning generated, but action still "ready"

TC-AP-005: Purchase with missing price and no last_purchase_price
  → needs_input for price, status = "needs_input"

TC-AP-006: New customer creation with existing name
  → Warning generated, action still "ready"
```

---

## 14. SK012: Context Summarizer

### 14.1 Purpose

Build a concise, formatted text summary of the business state and skill results for inclusion in the Language Engine prompt. This skill runs just before Stage 9 (Response Generation) to prepare the data the LLM will use to generate natural language.

### 14.2 Inputs

```
All skill results from the current pipeline:
  - healthScoreResult?: HealthScoreResult
  - salesAnalytics?: SalesAnalyticsResult
  - inventoryAnalytics?: InventoryAnalyticsResult
  - customerAnalytics?: CustomerAnalyticsResult
  - expenseAnalytics?: ExpenseAnalyticsResult
  - staffAnalytics?: StaffAnalyticsResult
  - kpiResult?: KpiResult
  - forecastResult?: ForecastResult
  - reorderAdvice?: ReorderAdviceResult
  - recommendationResult?: RecommendationResult
  - actionPlan?: ActionPlanResult
  - executionResult?: ExecutionResult

Plus:
  - MemoryStore meta section
  - Conversation history (last 5 exchanges)
  - Detected language
  - Original question text
```

### 14.3 Outputs

```typescript
interface ContextSummaryResult {
  /** Text summary of the business (org name, size, current date) */
  businessSummary: string;              // Max 200 words

  /** Formatted skill results for the LLM prompt */
  skillResultsText: string;             // Max 1500 words

  /** Conversation history formatted for prompt */
  conversationHistoryText: string;      // Last 5 exchanges

  /** Token estimate for the assembled context */
  estimatedTokens: number;

  /** Structure flag for prompt routing */
  containsAction: boolean;

  metadata: {
    skillsSummarized: string[];
    warnings: string[];
  };
}
```

### 14.4 Algorithm

```
STEP 1 — Build Business Summary
  Template:
    "Business: {organization_name}
     Owner: {owner_name}
     Current Date: {current_date}
     Timezone: {timezone}
     Total Products: {total_products}
     Total Customers: {total_customers}
     Total Suppliers: {total_suppliers}"

  If any meta field is missing: omit that line.

STEP 2 — Format Skill Results
  For each skill result present in the pipeline:
    - Select the most important 3-5 data points from the result
    - Format as structured text (not JSON):
      "=== {SKILL NAME} ===
       - Key point 1: {value}
       - Key point 2: {value}
       ..."

  Skill result selection logic:
    healthScore:
      - Score and label
      - Top 3 reasons
      - Trend direction

    salesAnalytics:
      - Revenue (current period)
      - Profit
      - vs last period change percentage
      - Top product name + revenue

    inventoryAnalytics:
      - Total stock value
      - Out of stock count
      - Low stock count

    customerAnalytics:
      - Total outstanding
      - Total overdue
      - Overdue customer count

    expenseAnalytics:
      - Total expenses
      - Expense/revenue ratio
      - Top category name + percentage

    kpiResult:
      - Top 5 KPIs by category (one from each)
      - Revenue KPI, Profit KPI, Efficiency KPI

    forecastResult:
      - Next period prediction
      - Confidence
      - Trend direction

    reorderAdvice:
      - Urgent reorder count
      - Top urgent item name + quantity

    recommendationResult:
      - Top 3 recommendations (by priority)

    actionPlan (write pipeline):
      - Action type
      - Draft summary
      - Status (ready/needs_input/blocked)

    executionResult (write pipeline, post-execution):
      - Success/failure
      - Entity reference (invoice number)
      - Affected records

STEP 3 — Format Conversation History
  Last 5 exchanges, formatted as:
    "User: {question}
     Assistant: {response}"

  Truncate each message to 500 chars if longer.

STEP 4 — Token Estimation
  Rough estimation: count words * 1.3 (average tokens per word for English/Urdu).
  If > 3000 tokens: trim conversation history to last 3 exchanges.

STEP 5 — Output Assembly
  Return the assembled ContextSummaryResult.
```

### 14.5 Edge Cases

| Condition | Behavior |
|----------|----------|
| All skill results empty/null | businessSummary only. Warning: "No skill results available" |
| Very long conversation history | Trim to fit 3000 token budget |
| Urdu/Roman Urdu texts | Preserved as-is. Token estimation uses same formula (conservative) |
| Zero values across all metrics | businessSummary shows zeros. Warning: "Business has no recorded activity" |

### 14.6 Confidence Scoring

```
Not applicable — this is a formatting utility, not an analytical skill.
```

### 14.7 Required Permissions

```
N/A — Internal utility skill. No permissions needed beyond parent pipeline.
```

### 14.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <5ms |
| Max input size | All skill results (typically <50KB) |

### 14.9 Test Cases

```
TC-CS-001: All skills executed with full results
  → businessSummary + 10 skill result sections + conversation history
  → estimatedTokens < 3000

TC-CS-002: No skill results (empty pipeline)
  → businessSummary only, warning generated

TC-CS-003: Conversation history has 20 prior exchanges
  → Trimmed to last 5. Focus on most recent.

TC-CS-004: Urdu conversation history
  → Preserved correctly, token estimate handles Unicode

TC-CS-005: Write pipeline result (action execution)
  → includes actionPlan and executionResult sections
```

---

## 15. SK013: Learning Engine

### 15.1 Purpose

Learn from owner behavior and update Business Memory with preferences and patterns. This skill runs asynchronously after the response is delivered (Stage 11 in the pipeline).

### 15.2 Inputs

```
Request metadata:
  - requestId: string
  - question: string
  - detectedLanguage: string
  - intent: string
  - skillsInvoked: string[]
  - pipelineMode: "read" | "write"
  - executionResult: ExecutionResult | null (if write pipeline)
  - confirmationDecision: string | null (if write pipeline)
  - timestamp: string

PreferenceStore:
  - Current preference state (frequent_topics, preferred_period, ignored_recommendation_types, etc.)
```

### 15.3 Outputs

```typescript
interface LearningResult {
  preferencesUpdated: PreferenceUpdate[];
  suggestedQuestionsUpdated: boolean;
  updatedSuggestedQuestions: string[];
  memoryRefreshTriggered: boolean;
  warnings: string[];
}

interface PreferenceUpdate {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  method: "implicit" | "explicit";
  confidence: number;                   // 0.0–1.0
}
```

### 15.4 Algorithms

```
LEARNING RULES

Rule L1 — Topic Frequency Tracking
  On every question:
    Increment frequent_topics[intent] by 1.
    Increment frequent_topics[derived_category] by 1.
      derived_category = first segment of intent (e.g., "analytics_sales" → "analytics").

Rule L2 — Period Preference Learning
  On analytics questions:
    If question contains keywords like "today", "aaj":   increment period_today
    If question contains "week", "hafte":                 increment period_week
    If question contains "month", "mahine":               increment period_month
  When any counter reaches 3:
    Set preferred_period to the most frequent period.
    Update preference with method = "implicit".

Rule L3 — Language Preference Learning
  On every question:
    Track detectedLanguage per session.
    If same language detected in >= 3 consecutive questions:
      Set preferred_language to that language.
      (Can be overridden by explicit setting.)

Rule L4 — Recommendation Dismissal Learning
  When owner ignores a recommendation type 3+ times (not clicked/not acted on):
    Add to ignored_recommendation_types.
    Update preference with method = "implicit".
    (Owner can re-enable explicitly.)

Rule L5 — Suggested Question Ranking
  Every N requests (configurable, default 5):
    Re-rank suggested questions:
      1. Top 3 by frequent_topics count (most asked topics)
      2. Next 3 by recent activity (last 7 days)
      3. Next 2 context-relevant (based on current memory state — low stock? suggest reorder Q)
      4. Remove any matching ignored_recommendation_types
    Cap at 8 total suggestions.

Rule L6 — Memory Refresh Trigger
  If pipeline mode = "write" AND executionResult.success = true:
    Mark affected memory sections for refresh.
    Sections: depends on actionType:
      action_sale:        ["sales", "products", "computed"]
      action_purchase:    ["purchases", "products", "computed"]
      action_expense:     ["expenses", "computed"]
      action_task:        ["tasks"]
      action_customer:    ["customers"]
      action_supplier:    ["suppliers"]
      action_product:     ["products", "inventory"]
  Set memoryRefreshTriggered = true.

Rule L7 — Business Memory Persistence (Future — Phase 6)
  If significant preference changes accumulate:
    Trigger async persistence to database.
    (Phase 1: all preferences are in-memory only.)

Rule L8 — Trend Awareness
  After every Nth request (default 20):
    Run a simple trend analysis on frequent_topics:
      Which intents are increasing in frequency?
      Which are decreasing?
    Store in memory for potential proactive suggestions.
    (Phase 1: log only, no action taken.)
```

### 15.5 Edge Cases

| Condition | Behavior |
|-----------|----------|
| Owner asks 100 questions all different intents | frequent_topics spread evenly. No dominant preference emerges. |
| Owner explicitly sets a preference conflicting with learned one | Explicit overrides implicit. Warning: "Overriding learned preference with explicit value." |
| ignored_recommendation_types grows large | Only actively remove matching types. No automatic cleanup. |
| Memory refresh triggered but data hasn't changed | Refresh executes anyway (idempotent). |
| First-time owner (no history) | All preferences at defaults. No learning until 3+ interactions. |

### 15.6 Confidence Scoring

```
Per-preference-update:
  Explicit (owner stated):            confidence = 1.0
  Implicit with 3+ confirmations:     confidence = 0.7
  Implicit with 1-2 confirmations:    confidence = 0.4
  Implicit with 0 confirmations:      confidence = 0.1
```

### 15.7 Required Permissions

```
Level 1 (Read): Learning engine reads all request metadata.
Level 2 (Write): Updates in-memory PreferenceStore only (no DB writes in Phase 1).
```

### 15.8 Performance Expectations

| Metric | Target |
|--------|--------|
| Execution time | <5ms (non-blocking, async) |
| Memory updates | Map writes only — no allocations >10KB |

### 15.9 Test Cases

```

TC-LE-001: Owner asks 3 sales analytics questions in a row
  → preferred_period learned after 3rd question
  → suggested questions updated to prioritize sales topics

TC-LE-002: Owner explicitly says "Always show in Urdu"
  → Language preference set with confidence = 1.0

TC-LE-003: Owner ignores 3 reorder recommendations
  → reorder type added to ignored_recommendation_types

TC-LE-004: Owner executes a sale
  → Memory sections ["sales", "products", "computed"] marked for refresh

TC-LE-005: 100 questions with diverse intents
  → frequent_topics shows distribution, no single dominant preference

TC-LE-006: First-time owner, first question
  → No learning occurs (minimum threshold of 3 interactions not met)
```

---

## 16. Skill Dependency Graph

```
                    ┌─────────────────────┐
                    │   Business Memory    │
                    │   (Data Layer)       │
                    └─────────┬───────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                     ▼
  ┌─────────────┐    ┌───────────────┐    ┌──────────────┐
  │ SK001       │    │ SK002         │    │ SK003        │
  │ Health Score│    │ Sales Analytics│   │ Inventory    │
  │             │    │               │    │ Analytics    │
  └──────┬──────┘    └───────┬───────┘    └──────┬───────┘
         │                   │                    │
         ▼                   ▼                    ▼
  ┌─────────────┐    ┌───────────────┐    ┌──────────────┐
  │ SK007       │    │ SK004         │    │ SK005        │
  │ KPI         │◄───│ Customer      │    │ Expense      │
  │ Calculator  │    │ Analytics     │    │ Analytics    │
  └──────┬──────┘    └───────┬───────┘    └──────┬───────┘
         │                   │                    │
         ▼                   ▼                    ▼
  ┌─────────────┐    ┌───────────────┐    ┌──────────────┐
  │ SK008       │    │ SK006         │    │ SK009        │
  │ Forecast    │    │ Staff         │    │ Reorder      │
  │ Engine      │    │ Analytics     │    │ Advice       │
  └──────┬──────┘    └───────┬───────┘    └──────┬───────┘
         │                   │                    │
         └──────────┬────────┴────────────────────┘
                    │
                    ▼
           ┌──────────────────┐
           │ SK010            │
           │ Recommendation   │
           │ Engine           │
           └────────┬─────────┘
                    │
                    ▼
           ┌──────────────────┐
           │ SK012            │
           │ Context          │
           │ Summarizer       │
           └────────┬─────────┘
                    │
                    ▼
              ┌──────────┐
              │ Stage 9   │
              │ Response  │
              │ Generation│
              └──────────┘

Write Pipeline Only:
           SK011 (Action Planner)
           ─ depends on EntityResult + ContextPackage
           ─ feeds into Stage 5 (Validation)

Async / Cross-cutting:
           SK013 (Learning Engine)
           ─ reads all stage outputs
           ─ updates PreferenceStore
           ─ triggers memory refresh
```

### 16.1 Dependency Rules

```
Rule D1 — SK010 (Recommendation Engine) depends on SK001–SK009.
  If any dependency fails, SK010 runs with available data + warnings.
  It never blocks the pipeline.

Rule D2 — SK007 (KPI Calculator) depends on SK002–SK006.
  SK001 (Health Score) uses KPI results only for trend data; it can run independently.

Rule D3 — SK008 (Forecast Engine) depends on SK002 (Sales Analytics).
  It can also use SK005 (Expense Analytics) for expense forecasts.
  Forecast runs independently of other analytics.

Rule D4 — SK011 (Action Planner) is only invoked in the write pipeline.
  It depends on EntityResult (Stage 2) and ContextPackage (Stage 3).
  It is independent of all analytical skills.

Rule D5 — SK013 (Learning Engine) is always invoked last (Stage 11).
  It depends on all stage outputs. It never blocks the response.
```

---

## 17. Validation & Testing Strategy

### 17.1 Per-Skill Test Requirements

Every skill must have:

1. **Unit tests** (pure function tests — no mocks needed for data):
   - 10 test cases minimum per skill (defined in each skill's test case section)
   - Edge case coverage (zero data, missing fields, extreme values)
   - Performance benchmark test (verify <max execution time)

2. **Integration tests** (with mocked Business Memory):
   - Verify output structure matches schema
   - Verify warnings are emitted for partial data
   - Verify errors are emitted for missing critical data

3. **Regression tests**:
   - Hardcoded input/output pairs for every formula change
   - Version bump triggers regression suite

### 17.2 Test Harness Contract

```typescript
interface SkillTestHarness<Input, Output> {
  /** Execute a test case */
  runTestCase(name: string, input: Input, expected: Partial<Output>): TestResult;

  /** Verify output structure matches schema */
  validateSchema(output: Output): SchemaValidationResult;

  /** Measure execution time */
  benchmark(input: Input): { durationMs: number; output: Output };

  /** Test with partial/incomplete data */
  testPartialData(input: Partial<Input>): { output: Output; warnings: string[] };
}

interface TestResult {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  errors: string[];
}
```

### 17.3 Acceptance Criteria

| Criterion | Requirement |
|-----------|-------------|
| Skill produces correct output | All unit tests pass |
| Skill handles edge cases | All edge case tests pass |
| Skill performs within budget | Benchmark test < max execution time |
| Skill degrades gracefully | Partial data test returns warnings, not errors |
| Skill output matches schema | Schema validation test passes |
| Skill is deterministic | Same input always produces same output |
| Skill has no LLM calls | Zero `provider-router.ts` imports |

---

## Appendix A: Skill Registry Map

```
Intent                  Primary Skills                                   Pipeline
──────────────────────  ───────────────────────────────────────────────  ──────────
health                  SK001 (Health Score)                            read
analytics_sales         SK002 (Sales Analytics)                         read
analytics_inventory     SK003 (Inventory Analytics)                     read
analytics_customers     SK004 (Customer Analytics)                      read
analytics_expenses      SK005 (Expense Analytics)                       read
staff_query             SK006 (Staff Analytics)                         read
kpi                     SK007 (KPI Calculator)                          read
forecast                SK008 (Forecast Engine)                         read
reorder                 SK009 (Reorder Advice)                          read
recommendations         SK010 (Recommendation Engine)                   read
general_overview        SK001 + SK002 + SK007 + SK010                   read
action_*                SK011 (Action Planner)                          write
all (context building)  SK012 (Context Summarizer)                      both
all (post-response)     SK013 (Learning Engine)                         both
```

## Appendix B: Skill Performance Budgets

```
Skill ID    Name                     Max Time    Max Input     Complexity
───────     ───────────────────────  ──────────  ────────────  ──────────
SK001       Health Score             5ms         8 sections     O(k) where k=5 sub-scores
SK002       Sales Analytics          20ms        10k txn        O(n + m) where n=txn, m=products
SK003       Inventory Analytics      10ms        5k products    O(n)
SK004       Customer Analytics       15ms        5k customers   O(n)
SK005       Expense Analytics        10ms        5k expenses    O(n + c) where c=categories
SK006       Staff Analytics          5ms         100 staff      O(n)
SK007       KPI Calculator           20ms        All analytics  O(k) where k=20 KPIs
SK008       Forecast Engine          15ms        90 points      O(n) linear regression
SK009       Reorder Advice           10ms        5k products    O(n)
SK010       Recommendation Engine    20ms        All skills     O(r) where r=~20 rules
SK011       Action Planner           10ms        N/A            O(s) where s=4-8 steps
SK012       Context Summarizer       5ms         All results    O(k) where k=skill count
SK013       Learning Engine          5ms         N/A            O(1)
```

## Appendix C: Skill Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-29 | Chief AI Architect | Initial Business Skills specification — 13 deterministic skills defined |

---

*This document defines every deterministic Business Skill in the TradeOS AI system. The LLM must never perform calculations that belong to these skills. Every numeric business result must come from these deterministic functions. Future skills must follow this specification's contract and pass through the documented validation process.*
