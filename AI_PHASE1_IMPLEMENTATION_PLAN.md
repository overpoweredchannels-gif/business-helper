# TradeOS AI — Phase 1 Implementation Plan (Revised)

> **Phase Goal**: A single production-ready AI Assistant page where the owner asks business questions and the Business Brain answers them by reading Business Memory and invoking deterministic Business Skills.  
> **Architecture Principle**: The LLM is only a language engine. Every business calculation is a deterministic TradeOS service. The Business Brain orchestrates everything.

---

## 1. Architecture: The Business Brain

### Central Concept

TradeOS AI is not an LLM with tool calling. It is a **Business Brain** — a deterministic orchestration layer that sits above both the business data and the language engine.

```
┌──────────────────────────────────────────────────────────────────┐
│                      OWNER INTERFACE                              │
│              (React page — single conversation)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       BUSINESS BRAIN                               │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                    ORCHESTRATOR                              │     │
│  │                                                              │     │
│  │  1. Receives owner question                                  │     │
│  │  2. Determines intent (analytics / health / forecast / ...)  │     │
│  │  3. Invokes the correct Business Skill(s)                    │     │
│  │  4. Assembles skill results + question into language prompt  │     │
│  │  5. Sends to Language Engine for natural language generation │     │
│  │  6. Returns formatted response to owner                      │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │ BUSINESS     │  │ BUSINESS     │  │ LANGUAGE ENGINE         │   │
│  │ MEMORY       │  │ SKILLS       │  │ (LLM — Gemini/OpenAI)  │   │
│  │              │  │              │  │                        │   │
│  │ • Products   │  │ • Health     │  │ • Natural language     │   │
│  │ • Customers  │  │   Score      │  │   understanding only   │   │
│  │ • Suppliers  │  │ • Forecast   │  │ • Natural language     │   │
│  │ • Sales      │  │ • Analytics  │  │   generation only      │   │
│  │ • Purchases  │  │ • KPIs       │  │ • Never calculates     │   │
│  │ • Expenses   │  │ • Reorder    │  │ • Never analyzes       │   │
│  │ • Staff      │  │   Advice     │  │ • Never recommends     │   │
│  │ • Tasks      │  │ • Recommenda-│  │                        │   │
│  │ • Alerts     │  │   tion Engine│  │                        │   │
│  │ • Trends     │  │ • Learning   │  │                        │   │
│  │              │  │   Engine     │  │                        │   │
│  └──────────────┘  └──────────────┘  └────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### LLM Role (Strictly Limited)

The Language Engine (LLM) does **only**:
- **Understand**: Convert the owner's natural language question into a structured intent.
- **Generate**: Convert structured data + skill results into fluent natural language in the owner's language (English, Urdu, Roman Urdu).

The Language Engine **never**:
- Calculates health scores
- Computes forecasts
- Analyzes trends
- Generates recommendations
- Looks up data
- Validates business logic
- Creates or modifies business records

Every one of those tasks is performed by a **deterministic Business Skill**.

---

## 2. Folder Structure

```
src/
├── app/
│   ├── (dashboard)/
│   │   └── ai-assistant/
│   │       └── page.tsx              ← NEW: Single AI Assistant page
│   │
│   └── api/
│       ├── ai-business-query/
│       │   └── route.ts              ← EXISTING: Refactored — calls Business Brain, not LLM directly
│       └── brain/
│           └── context/
│               └── route.ts          ← NEW: Returns Business Memory snapshot (debug)
│
├── components/
│   └── ai/
│       ├── AiLayout.tsx              ← NEW: Layout wrapper
│       ├── ConversationPanel.tsx     ← NEW: Message list
│       ├── MessageBubble.tsx         ← NEW: Renders text + chart + table
│       ├── MessageInput.tsx          ← NEW: Text input + suggested chips
│       ├── MessageChart.tsx          ← NEW: Chart from structured data
│       ├── MessageTable.tsx          ← NEW: Table from structured data
│       └── SuggestedQuestions.tsx    ← NEW: Clickable question chips
│
├── hooks/
│   └── useAiConversation.ts          ← NEW: Conversation state, calls Brain, renders response
│
├── lib/
│   ── brain/                          ← NEW: The Business Brain
│   │   ├── orchestrator.ts           ← NEW: Central orchestrator (intent → skill → language → response)
│   │   ├── intent-classifier.ts      ← NEW: Identifies which skill(s) to invoke from question text
│   │   ├── memory/
│   │   │   ├── business-memory.ts    ← NEW: In-memory store + retrieval interface
│   │   │   ├── memory-writer.ts      ← NEW: Writes data into memory from database state
│   │   │   └── types.ts              ← NEW: Memory data types
│   │   ├── skills/
│   │   │   ├── skill-registry.ts     ← NEW: Registry of all skills
│   │   │   ├── health-score.ts       ← NEW: Deterministic business health calculation
│   │   │   ├── analytics.ts          ← NEW: Deterministic analytics (sales, profit, inventory)
│   │   │   ├── forecast.ts           ← NEW: Deterministic forecast (trend projection)
│   │   │   ├── kpi.ts                ← NEW: Deterministic KPI calculations
│   │   │   ├── reorder-advice.ts     ← NEW: Deterministic reorder recommendations
│   │   │   └── recommendation-engine.ts ← NEW: Cross-skill recommendation synthesis
│   │   ├── learning/
│   │   │   ├── learning-engine.ts    ← NEW: Tracks outcomes, updates memory
│   │   │   └── preference-store.ts   ← NEW: Owner preference storage
│   │   ├── language/
│   │   │   ├── intent-prompt.ts      ← NEW: Prompt for intent classification only
│   │   │   ├── generation-prompt.ts  ← NEW: Prompt for natural language generation only
│   │   │   └── language-detector.ts  ← NEW: Detects English/Urdu/Roman Urdu
│   │   └── types.ts                  ← NEW: Brain-level types
│   │
│   ── ai/
│       ├── provider-router.ts        ← EXISTING: Unchanged
│       └── conversation-engine.ts    ← EXISTING: Reserved for Phase 3
│
├── middleware/
│   └── rate-limit.ts                 ← NEW: In-memory rate limiter
│
└── types/
    └── brain.ts                      ← NEW: Shared brain types for cross-file use
```

---

## 3. Business Memory (Phase 1 — In-Memory, Production Architecture)

### Role

Business Memory is a **structured, queryable snapshot of the entire business** that lives in the browser's JavaScript memory. It is written once on page load and refreshed periodically. Every Business Skill reads from it. The Context Retriever reads from it. The Language Engine never touches it directly.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    BUSINESS MEMORY                         │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                 MEMORY WRITER                          │ │
│  │  Reads from existing page.tsx state (products,        │ │
│  │  customers, sales, purchases, expenses, staff, etc.)  │ │
│  │  Normalizes and stores in structured MemoryStore      │ │
│  └──────────────────────┬───────────────────────────────┘ │
│                         │                                  │
│                         ▼                                  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                  MEMORY STORE                          │ │
│  │                                                            │
│  │  products: Map<id, ProductSummary>                     │ │
│  │  customers: Map<id, CustomerSummary>                   │ │
│  │  suppliers: Map<id, SupplierSummary>                   │ │
│  │  sales: { today, this_week, this_month, all }         │ │
│  │  purchases: { today, this_week, this_month, all }     │ │
│  │  expenses: { by_category, total }                     │ │
│  │  inventory: { stock_value, low_stock, out_of_stock }  │ │
│  │  staff: { active, locations, summary }                │ │
│  │  tasks: { pending, overdue, by_priority }             │ │
│  │  alerts: { active, critical }                         │ │
│  │  preferences: Map<key, value>                         │ │
│  │  computed: { health_score, kpis, trends, forecasts }  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Retrieval Methods:                                        │
│  • getSection(key): returns typed section data             │
│  • query(field, value): returns matching entities          │
│  • compute(skillName): triggers a skill, returns result    │
│  • snapshot(): returns full serializable state             │
└──────────────────────────────────────────────────────────┘
```

### Memory Refresh Cycle

```
Page Load
   │
   ▼
MemoryWriter.refresh()
   │
   ├── Reads products[] → writes memory.products
   ├── Reads customers[] → writes memory.customers
   ├── Reads suppliers[] → writes memory.suppliers
   ├── Reads salesTransactions[] → writes memory.sales
   ├── Reads purchaseTransactions[] → writes memory.purchases
   ├── Reads expenses[] → writes memory.expenses
   ├── Computes inventory stats → writes memory.inventory
   ├── Computes health score → writes memory.computed.health_score
   ├── Computes KPIs → writes memory.computed.kpis
   ├── Computes trends → writes memory.computed.trends
   └── Triggers Recommendation Engine → writes memory.computed.recommendations
```

Memory is refreshed when:
- Page loads (full refresh)
- User navigates back to AI Assistant (full refresh)
- A background poll detects data changes (future — Phase 6)

### Phase 1 Implementation

Business Memory is built as an **in-memory singleton** within the browser tab. It is populated once on page load by the `MemoryWriter` which reads from the existing TradeOS React state. This means:

- **Zero additional API calls** to populate memory in Phase 1
- **Data freshness**: Memory is as fresh as the last page load
- **Persistence**: No persistence yet (Phase 6 adds Supabase backing)

### Memory Data Shapes

```typescript
// ─── Memory Store ───

interface MemoryStore {
  meta: {
    organization_name: string;
    owner_name: string;
    current_date: string;
    timezone: string;
  };

  // Entity stores
  products: Map<string, ProductMemory>;
  customers: Map<string, CustomerMemory>;
  suppliers: Map<string, SupplierMemory>;
  staff: Map<string, StaffMemory>;

  // Time-series stores
  sales: PeriodData<SalesSummary>;
  purchases: PeriodData<PurchaseSummary>;
  expenses: PeriodData<ExpenseSummary>;

  // Computed stores
  inventory: InventoryMemory;
  tasks: TaskMemory;
  alerts: AlertMemory;
  preferences: Map<string, unknown>;

  // Pre-computed by skills
  computed: {
    health_score: HealthScoreResult;
    kpis: KpiResult[];
    trends: TrendResult[];
    forecasts: ForecastResult[];
    recommendations: RecommendationResult[];
    priorities: string[];
  };
}

// ─── Entity Memory Shapes ───

interface ProductMemory {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  current_stock: number;
  reorder_level: number;
  default_selling_price: number;
  total_sold_30d: number;
  total_purchased_30d: number;
  stock_status: "out_of_stock" | "urgent" | "low_soon" | "healthy";
  last_sale_date: string | null;
  last_purchase_date: string | null;
}

interface CustomerMemory {
  id: string;
  name: string;
  shop_name: string | null;
  total_sales_30d: number;
  invoice_count_30d: number;
  outstanding_balance: number;
  overdue_amount: number;
  last_sale_date: string | null;
  credit_limit: number | null;
}

interface SupplierMemory {
  id: string;
  name: string;
  total_purchases_30d: number;
  payable_amount: number;
  last_purchase_date: string | null;
}

interface StaffMemory {
  id: string;
  name: string;
  role: string;
  is_active_duty: boolean;
  last_location: { lat: number; lng: number; captured_at: string } | null;
  sales_count_today: number;
}

// ─── Time-Series Shapes ───

interface PeriodData<T> {
  today: T;
  this_week: T;
  this_month: T;
  last_30_days: T;
  all_time: T;
}

interface SalesSummary {
  total_amount: number;
  invoice_count: number;
  profit_estimate: number;
  by_payment_type: Record<string, number>;
}

interface PurchaseSummary {
  total_amount: number;
  invoice_count: number;
}

interface ExpenseSummary {
  total_amount: number;
  by_category: Record<string, number>;
}

// ─── Computed Shapes ───

interface InventoryMemory {
  total_products: number;
  total_stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  urgent_reorder_count: number;
}

interface HealthScoreResult {
  score: number;        // 0-100
  label: string;        // "Excellent" | "Good" | "Average" | "Needs Attention" | "Critical"
  reasons: string[];    // Human-readable reasons
  trend: "improving" | "declining" | "stable";
}

interface KpiResult {
  key: string;          // "revenue_today" | "profit_margin" | "stock_turnover" | ...
  label: string;        // "Today's Revenue"
  value: number;
  formatted: string;    // "PKR 45,000"
  change: number;       // Percentage change vs previous period
  change_label: "up" | "down" | "flat";
}

interface TrendResult {
  metric: string;       // "sales" | "profit" | "expenses"
  period: string;       // "daily" | "weekly" | "monthly"
  data: Array<{ label: string; value: number }>;
}

interface ForecastResult {
  metric: string;
  period: string;
  predicted_value: number;
  confidence: number;   // 0-1
  based_on: string;     // "last_30_days" | "last_90_days" | "same_period_last_year"
}

interface RecommendationResult {
  id: string;
  type: "reorder" | "follow_up" | "price_adjustment" | "expense_review" | "staff_action";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expected_impact: string;
  action_link?: string;  // Section ID to navigate to
}
```

---

## 4. Business Skills (Phase 1 — Deterministic Services)

### Role

Business Skills are **pure, deterministic functions** that read from Business Memory and return structured results. They never call an LLM. They never make API calls. They are synchronous, testable, and predictable.

### Skill: Health Score

**File**: `src/lib/brain/skills/health-score.ts`

**Input**: `MemoryStore`

**Output**: `HealthScoreResult`

**Logic** (deterministic, rule-based):

```
health_score = 100
               - deductions for low stock (>5 items: -10, >10: -20)
               - deductions for overdue receivables (>0: -5 per 10% of total)
               - deductions for negative cash flow: -15
               - deductions for out-of-stock products: -5 each, max -20
               + bonus for positive profit margin (>10%: +5, >20%: +10)
               + bonus for sales growth vs last period: +5
               = clamped to 0-100
```

### Skill: Analytics

**File**: `src/lib/brain/skills/analytics.ts`

**Input**: `MemoryStore` + query parameters (time period, entity filter)

**Output**: Structured analytics data

**Capabilities** (each is a separate exported function):
- `getSalesAnalytics(memory, period)` — Total sales, count, profit, by payment type, top products
- `getInventoryAnalytics(memory)` — Stock value, low stock, out of stock, slow movers
- `getCustomerAnalytics(memory, period)` — Top customers, outstanding, overdue, new vs returning
- `getExpenseAnalytics(memory, period)` — By category, trends, comparison to revenue
- `getStaffAnalytics(memory)` — Active sessions, sales per staff, locations

### Skill: Forecast

**File**: `src/lib/brain/skills/forecast.ts`

**Input**: `MemoryStore` + metric name

**Output**: `ForecastResult`

**Logic** (deterministic, simple projection):

```
forecast = average of last N periods
           + trend adjustment (linear regression on last N points)
           + seasonal adjustment (same period last cycle, if available)
           = projected value
```

Phase 1 uses simple moving average + linear trend. More sophisticated forecasting (SARIMA, Prophet) is a future enhancement.

### Skill: KPI

**File**: `src/lib/brain/skills/kpi.ts`

**Input**: `MemoryStore`

**Output**: `KpiResult[]`

**KPIs calculated** (all deterministic):
- Today's revenue vs yesterday
- Profit margin (net profit / revenue)
- Average sale value
- Stock turnover rate (COGS / average inventory)
- Receivables turnover (credit sales / average receivables)
- Payables ratio (payables / purchases)
- Expense ratio (expenses / revenue)
- Low stock percentage
- Staff productivity (sales per active staff)

### Skill: Reorder Advice

**File**: `src/lib/brain/skills/reorder-advice.ts`

**Input**: `MemoryStore`

**Output**: `RecommendationResult[]` (filtered to reorder type)

**Logic**:
- Products where `current_stock <= reorder_level` → urgent reorder
- Products where `current_stock <= reorder_level * 1.5` → order soon
- Products with `total_sold_30d > current_stock` → will run out in <30 days
- Each recommendation includes suggested quantity based on 30-day sales velocity

### Skill: Recommendation Engine

**File**: `src/lib/brain/skills/recommendation-engine.ts`

**Input**: `MemoryStore` (including results from other skills)

**Output**: `RecommendationResult[]`

**Purpose**: Cross-skill synthesis that produces actionable, prioritized recommendations by combining outputs from Health Score, Analytics, Forecast, KPI, and Reorder Advice.

**Logic**:
- Reads outputs from all other skills
- Deduplicates overlapping recommendations
- Ranks by priority (high/medium/low)
- Groups by category (inventory, customers, finances, staff)
- Attaches expected impact to each recommendation

**Example output**:

```json
[
  {
    "type": "reorder",
    "priority": "high",
    "title": "Reorder Pepsi 500ml",
    "description": "Current stock: 5 units. 30-day sales: 150 units. Will run out in ~1 day.",
    "expected_impact": "Prevent lost sales of ~PKR 22,500/month"
  },
  {
    "type": "follow_up",
    "priority": "high",
    "title": "Follow up with Usman General Store",
    "description": "Outstanding balance: PKR 125,000. Overdue by 45 days.",
    "expected_impact": "Recover PKR 125,000 in receivables"
  }
]
```

### Skill Registry

**File**: `src/lib/brain/skills/skill-registry.ts`

Maps intent types to skill functions:

```typescript
const SKILL_REGISTRY = {
  "health": healthScore,
  "analytics_sales": () => analytics.getSalesAnalytics,
  "analytics_inventory": () => analytics.getInventoryAnalytics,
  "analytics_customers": () => analytics.getCustomerAnalytics,
  "analytics_expenses": () => analytics.getExpenseAnalytics,
  "forecast_sales": forecast,
  "kpi": kpi,
  "reorder": reorderAdvice,
  "recommendations": recommendationEngine,
  "general_overview": [healthScore, kpi, analytics.getSalesAnalytics, recommendationEngine],
};
```

When multiple skills are mapped to one intent, their outputs are merged before language generation.

---

## 5. Learning Engine (Phase 1 — Design with Simple Implementation)

### Role

The Learning Engine observes owner behavior and updates Business Memory with learned preferences. In Phase 1, it is minimal — it tracks repeated patterns and stores them in `memory.preferences`.

### Implementation

```typescript
// src/lib/brain/learning/learning-engine.ts

interface LearningEngine {
  // Called when the owner asks a question
  recordQuestion(question: string, intent: string): void;

  // Called when the owner clicks a suggested question
  recordSuggestionClick(question: string): void;

  // Called when the owner ignores a recommendation
  recordRecommendationIgnored(recommendationId: string): void;

  // Called to get learned preferences
  getPreferences(): Map<string, unknown>;

  // Learning logic — runs periodically
  process(): void;
}
```

**What it learns in Phase 1**:
- Frequently asked question topics → rank suggestions by frequency
- Preferred time periods for analytics (owner always asks "this month" → default to monthly)
- Ignored recommendation types → deprioritize in future

**What it does NOT learn in Phase 1** (reserved for Phase 6+):
- Entity preferences ("always order from Supplier X")
- Pricing patterns
- Complex behavioral learning

### Preference Store

```typescript
// src/lib/brain/learning/preference-store.ts

interface PreferenceStore {
  // Implicit preferences (learned)
  frequent_topics: Map<string, number>;        // topic → count
  preferred_period: "today" | "week" | "month";
  ignored_recommendation_types: Set<string>;

  // Explicit preferences (set by owner, future)
  preferred_suppliers: Set<string>;
  default_payment_type: "cash" | "credit";
  report_language: "english" | "urdu" | "roman_urdu";

  // Methods
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  increment(key: string): void;
}
```

---

## 6. Context Retriever (Replaces Context Builder)

### Purpose

The Context Retriever reads from Business Memory and assembles a **context package** for the Language Engine. It does NOT rebuild data from raw sources — it reads pre-computed data from Memory.

### Architecture Difference

| Old Approach (Context Builder) | New Approach (Context Retriever) |
|-------------------------------|----------------------------------|
| Iterates over raw arrays | Reads pre-computed memory sections |
| Computes analytics on each request | Reads cached skill results |
| Assembles context from scratch | Filters and formats existing data |
| Every request pays full compute cost | Most data is pre-computed |

### Interface

```typescript
// src/lib/brain/orchestrator.ts (Context Retrieval is part of orchestration)

interface RetrievalResult {
  // What the Language Engine receives
  language_context: {
    business_summary: string;       // Text summary of the business
    skill_results: unknown[];       // Results from invoked skills
    question: string;               // Original question
    language: string;               // Detected language
    conversation_history: string;   // Last N exchanges (formatted)
  };

  // Metadata for the UI
  metadata: {
    skills_invoked: string[];
    memory_age_ms: number;
    token_estimate: number;
  };
}
```

### Retrieval Flow

```
1. Intent is classified (from question text)
2. Skill registry maps intent → skill function(s)
3. Skill functions read from Memory, return results
4. Context Retriever formats: skill results + business summary + conversation history
5. Formatted context sent to Language Engine for NL generation only
6. Language Engine returns natural language text
7. Orchestrator returns structured response to UI
```

---

## 7. Orchestrator (The Business Brain)

### File: `src/lib/brain/orchestrator.ts`

### Complete Flow

```
                    ┌──────────────────────────────┐
                    │  Owner types question          │
                    │  "How is my business doing?"   │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────┐
              │    1. INTENT CLASSIFIER               │
              │    (Language Engine — minimal LLM)    │
              │                                       │
              │    Input: "How is my business doing?" │
              │    Prompt: Classify into one of:      │
              │      health, analytics_sales,         │
              │      analytics_inventory, forecast,   │
              │      kpi, reorder, general_overview   │
              │                                       │
              │    Output: { intent: "health",        │
              │              confidence: 0.95 }        │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    2. SKILL DISPATCHER                │
              │    (Deterministic — no LLM)           │
              │                                       │
              │    Looks up SKILL_REGISTRY["health"]  │
              │    Calls healthScore(memory)          │
              │    Result: { score: 72, label:        │
              │      "Average", reasons: [...],       │
              │      trend: "improving" }             │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    3. CONTEXT RETRIEVER               │
              │    (Deterministic — no LLM)           │
              │                                       │
              │    Reads from Memory:                 │
              │    - Business summary text            │
              │    - Health score result              │
              │    - Top priorities                   │
              │    - Conversation history             │
              │    - Preferences                      │
              │                                       │
              │    Formats into language context      │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    4. LANGUAGE GENERATOR              │
              │    (Language Engine — LLM)            │
              │                                       │
              │    Input: context + skill results     │
              │    Task: Convert to fluent natural    │
              │      language in the owner's language │
              │    Constraints:                       │
              │      • Use only the data provided     │
              │      • Do not calculate anything      │
              │      • Do not add new information     │
              │      • Format numbers as PKR          │
              │                                       │
              │    Output: "Your business is doing    │
              │      average with a score of 72.      │
              │      Your profit margin is improving  │
              │      but you have 8 low-stock items   │
              │      that need attention..."          │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    5. RESPONSE FORMER                 │
              │    (Deterministic — no LLM)           │
              │                                       │
              │    Combines LLM text + structured     │
              │    data from skills:                  │
              │    - Text answer                      │
              │    - Chart data (from skill results)  │
              │    - Table data (from skill results)  │
              │    - Key points (from skill results)  │
              │                                       │
              │    Returns unified response object    │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    6. LEARNING ENGINE                 │
              │    (Asynchronous, non-blocking)       │
              │                                       │
              │    Records: question, intent,          │
              │    skills used, response accepted?    │
              │    Updates preference store           │
              └──────────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │    7. UI RENDERS RESPONSE             │
              │    Text + chart + table + key points  │
              └──────────────────────────────────────┘
```

### Orchestrator Interface

```typescript
// src/lib/brain/orchestrator.ts

interface OrchestratorInput {
  question: string;
  conversationHistory: Array<{ role: "user" | "assistant"; text: string }>;
  memory: MemoryStore;
  preferences: PreferenceStore;
}

interface OrchestratorResponse {
  text: string;                    // Natural language answer
  key_points: string[];            // From skills
  warnings: string[];              // From skills
  chart_data: ChartData | null;    // From skills
  table_data: TableData | null;    // From skills
  metadata: {
    intent: string;
    skills_invoked: string[];
    language: string;
    provider: string;
    model: string;
    latency_ms: number;
    memory_age_ms: number;
  };
}
```

---

## 8. Language Engine (LLM — Strictly Limited)

### Role

The Language Engine is a **thin NLU/NLG layer** with two distinct prompts:

| Prompt | Purpose | Temperature | Tokens | Json Mode |
|--------|---------|-------------|--------|-----------|
| **Intent Classification** | Map question text to a skill intent | 0.0 | ~100 | Yes |
| **Response Generation** | Convert structured data to fluent text | 0.3 | ~500-1500 | No |

### Intent Classification Prompt

```
System: You are a business query classifier. Given a question, classify it into exactly one of these intents:

- health: Business health, overall performance, how am I doing
- analytics_sales: Sales numbers, revenue, top products, sales trends
- analytics_inventory: Stock levels, low stock, inventory value
- analytics_customers: Customer info, top customers, outstanding balances
- analytics_expenses: Expense breakdown, spending by category
- forecast: Future predictions, what will happen, trends
- kpi: Key metrics, numbers, statistics
- reorder: What to reorder, stock advice, purchase suggestions
- recommendations: What should I do, suggestions, advice
- general_overview: Broad questions about multiple areas
- unknown: Not about business data

Respond with JSON: { "intent": "...", "confidence": 0.0-1.0 }

Question: {question}
```

### Response Generation Prompt

```
System: You are a business report writer for a Pakistani wholesaler or retailer.

You will receive structured business data. Your ONLY job is to write it in fluent, natural language.

RULES:
1. Write in {language} (english/urdu/roman_urdu). Match the owner's language.
2. Use PKR format for all money values.
3. Do NOT add any information that is not in the provided data.
4. Do NOT calculate anything. Use only the numbers given.
5. Do NOT give advice. Only report what the data says.
6. Keep responses concise (under 3 paragraphs for most questions).
7. Use bullet points for lists.

DATA:
{business_summary}

SKILL RESULTS:
{skill_results_json}

CONVERSATION HISTORY (last 3 exchanges):
{conversation_history}

QUESTION: {question}

Write a natural language answer based ONLY on the DATA and SKILL RESULTS above.
```

### Provider Selection

Phase 1 uses Gemini Flash 2.0 as the primary language engine because:
- 1M token context window fits large business summaries
- Strong Urdu support
- Free tier is sufficient

OpenAI GPT-4o-mini is the fallback. Groq (Llama) is the second fallback.

---

## 9. Future Voice Agent Architecture (Design Reference)

The voice agent is not implemented in Phase 1, but its architecture is defined here to ensure the Phase 1 design accommodates it.

### Wrong Approach (Direct LLM)

```
Audio → STT → Text → LLM → Text → TTS → Audio
                     ↑
              (LLM does everything: intent, calculation, generation)
```

### Correct Approach (Business Brain)

```
Audio → STT → Text → ┌──────────────────┐
                      │  BUSINESS BRAIN  │
                      │                  │
                      │ 1. Intent Class  │
                      │ 2. Skill Dispatch│
                      │ 3. Lang Generate │
                      └──────────────────┘
                              ↓
Audio ← TTS ← Text ← ┌──────────────────┐
                      │  RESPONSE        │
                      └──────────────────┘
```

The voice agent plugs into the **same Business Brain**. It replaces only the input method (microphone → text) and output method (text → speech). The brain itself — intent classification, skill invocation, language generation — remains identical.

### Phase 1 Compatibility

The architecture supports voice insertion:
- `useAiConversation.send(question)` accepts text from any source (typed or transcribed)
- `orchestrator.process()` returns structured response that can drive TTS
- Memory is already in-place, skills are already deterministic
- LLM prompts are already separated from business logic

---

## 10. API Endpoint Changes

### `POST /api/ai-business-query` (Modified)

**Change**: The API route now receives structured skill results plus language context, rather than raw business data to be analyzed by the LLM.

**Before (Phase 1 draft)**:
```
Client sends raw business data → API sends to LLM → LLM analyzes + generates
```

**After (Revised)**:
```
Client sends pre-computed skill results → API formats prompt → LLM generates text only
```

**New Request Body**:
```json
{
  "question": "How is my business doing?",
  "language": "english",
  "task": "generate_answer",
  "context": {
    "business_summary": "A general store with 150 products...",
    "skill_results": [
      {
        "skill": "health_score",
        "result": { "score": 72, "label": "Average", "reasons": [...], "trend": "improving" }
      },
      {
        "skill": "kpi",
        "result": [
          { "key": "revenue_today", "value": 45000, "formatted": "PKR 45,000", "change": 12, "change_label": "up" }
        ]
      }
    ],
    "conversation_history": "..."
  }
}
```

**New Response**:
```json
{
  "ok": true,
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "result": {
    "answer": "Your business is doing average with a score of 72. Your profit margin is improving...",
    "language": "english"
  },
  "metadata": {
    "token_count": 450,
    "latency_ms": 1200
  }
}
```

### No New API Routes

The `POST /api/ai-business-query` endpoint is sufficient for Phase 1. The `/api/brain/context` debug endpoint is optional and low priority.

---

## 11. Required Database Additions

Only the two tables from the original plan (`ai_conversations`, `ai_conversation_messages`). No changes to existing tables.

The Business Memory, Skills, and Learning Engine are entirely **client-side** in Phase 1. They use no database storage. Persistence is added in Phase 6.

---

## 12. Revised Execution Order

### Phase 1A — Business Memory (Days 1-2)

| Step | File(s) | Description |
|------|---------|-------------|
| 1 | `src/lib/brain/types.ts` + `src/lib/brain/memory/types.ts` | All memory interfaces, store shapes, skill result types |
| 2 | `src/lib/brain/memory/business-memory.ts` | In-memory `MemoryStore` implementation with `getSection()`, `query()`, `snapshot()` |
| 3 | `src/lib/brain/memory/memory-writer.ts` | Reads from existing page.tsx state, writes to MemoryStore — normalizes all data |
| 4 | `src/lib/brain/learning/preference-store.ts` | Simple preference store (in-memory Map) |

**Milestone**: Business Memory can be populated and queried.

### Phase 1B — Business Skills (Days 2-4)

| Step | File(s) | Description |
|------|---------|-------------|
| 5 | `src/lib/brain/skills/skill-registry.ts` | Registry mapping intent → skill function |
| 6 | `src/lib/brain/skills/health-score.ts` | Deterministic health score calculation |
| 7 | `src/lib/brain/skills/analytics.ts` | Sales, inventory, customer, expense analytics functions |
| 8 | `src/lib/brain/skills/kpi.ts` | KPI calculations (revenue, margin, turnover, ratios) |
| 9 | `src/lib/brain/skills/forecast.ts` | Simple moving average + linear trend forecast |
| 10 | `src/lib/brain/skills/reorder-advice.ts` | Reorder recommendations from inventory memory |
| 11 | `src/lib/brain/skills/recommendation-engine.ts` | Cross-skill priority-ranked recommendations |
| 12 | `src/lib/brain/learning/learning-engine.ts` | Tracks questions, updates preferences |

**Milestone**: All deterministic skills are implemented and independently testable.

### Phase 1C — Orchestrator + Language Engine (Days 4-6)

| Step | File(s) | Description |
|------|---------|-------------|
| 13 | `src/lib/brain/language/language-detector.ts` | Unicode + keyword detection for Urdu/Roman Urdu |
| 14 | `src/lib/brain/language/intent-prompt.ts` | Intent classification prompt template |
| 15 | `src/lib/brain/language/generation-prompt.ts` | Response generation prompt template |
| 16 | `src/lib/brain/orchestrator.ts` | Complete orchestrator: intent → skill → context → language → response |
| 17 | `src/middleware/rate-limit.ts` | In-memory rate limiter |
| 18 | `src/app/api/ai-business-query/route.ts` | Refactor to accept pre-computed skill results + generate only |

**Milestone**: End-to-end flow works: question → intent → skill → context → LLM → response.

### Phase 1D — UI (Days 6-9)

| Step | File(s) | Description |
|------|---------|-------------|
| 19 | `src/hooks/useAiConversation.ts` | Hook: populates memory, calls orchestrator, manages message state |
| 20 | `src/components/ai/AiLayout.tsx` | Layout wrapper |
| 21 | `src/components/ai/ConversationPanel.tsx` | Scrollable message list |
| 22 | `src/components/ai/MessageBubble.tsx` | Message renderer |
| 23 | `src/components/ai/MessageChart.tsx` | SVG bar/line chart from skill data |
| 24 | `src/components/ai/MessageTable.tsx` | Table from skill data |
| 25 | `src/components/ai/MessageInput.tsx` | Text input + send |
| 26 | `src/components/ai/SuggestedQuestions.tsx` | Clickable question chips (dynamically ranked by Learning Engine) |
| 27 | `src/app/(dashboard)/ai-assistant/page.tsx` | Page assembly |

**Milestone**: Functional AI Assistant page.

### Phase 1E — Integration (Days 9-11)

| Step | File(s) | Description |
|------|---------|-------------|
| 28 | Sidebar navigation | Point AI Assistant to new page |
| 29 | Memory refresh | Connect `memory-writer` to page.tsx state with `useEffect` on mount |
| 30 | Error handling | Memory empty, skill failure, LLM failure, rate limit |
| 31 | Responsive | Mobile layout testing |
| 32 | Edge cases | New org (no data), very large org, rapid questions |

**Milestone**: Production-ready Phase 1 complete.

### Day Planner (Revised)

| Day | Tasks |
|-----|-------|
| 1 | Steps 1-4 (Memory types, store, writer, preference store) |
| 2 | Steps 5-8 (Skill registry, health score, analytics, KPI) |
| 3 | Steps 9-12 (Forecast, reorder, recommendation engine, learning engine) |
| 4 | Steps 13-16 (Language detector, prompts, orchestrator) |
| 5 | Steps 17-18 (Rate limiter, API route refactor) |
| 6 | Steps 19-22 (Hook, layout, conversation panel, message bubble) |
| 7 | Steps 23-27 (Chart, table, input, suggested questions, page) |
| 8 | Steps 28-30 (Navigation, memory refresh, error handling) |
| 9 | Steps 31-32 (Responsive, edge cases, testing) |
| 10 | Buffer / review / fix |

---

## 13. Summary of Key Architectural Differences

| Aspect | Original Plan | Revised Plan |
|--------|--------------|--------------|
| **Central architecture** | LLM with context | Business Brain with deterministic skills |
| **Business calculations** | LLM calculates (in prompt) | Deterministic skills calculate (no LLM) |
| **LLM role** | Understand + calculate + generate | Understand only + generate only |
| **Context assembly** | Context Builder (rebuilds each request) | Context Retriever (reads from Memory) |
| **Business Memory** | Designed, not implemented (Phase 6) | Implemented in-memory (Phase 1) |
| **Skills** | Prompt logic in templates | First-class TypeScript modules |
| **Recommendations** | LLM-generated in prompt | Deterministic Recommendation Engine |
| **Learning** | Not mentioned | Learning Engine tracks and adapts |
| **Voice integration** | Direct LLM pipeline | Plugs into Business Brain |
| **`ai-business-query` API** | Sends raw data, LLM analyzes | Sends skill results, LLM formats text only |
| **Testability** | Hard (LLM-dependent) | Easy (skills are pure functions) |

---

*End of Revised Phase 1 Implementation Plan*
