# TradeOS AI — Business Memory Specification

> **Version**: 1.0  
> **Status**: Immutable Architecture Specification — Final  
> **Scope**: The permanent Business Memory system that powers every AI request  
> **Principle**: Business Memory is the single source of truth for all AI data lookups. No component reads raw database tables for an AI request.

---

## Table of Contents

1. [Memory Philosophy](#1-memory-philosophy)
2. [Memory Hierarchy](#2-memory-hierarchy)
3. [Memory Lifecycle](#3-memory-lifecycle)
4. [Memory Categories](#4-memory-categories)
5. [Memory Retrieval Strategy](#5-memory-retrieval-strategy)
6. [Context Retrieval Rules](#6-context-retrieval-rules)
7. [Token Budget Strategy](#7-token-budget-strategy)
8. [Memory Refresh Rules](#8-memory-refresh-rules)
9. [Memory Confidence](#9-memory-confidence)
10. [Memory Security](#10-memory-security)
11. [Future Vector Search Strategy](#11-future-vector-search-strategy)
12. [Future Multi-Branch Memory](#12-future-multi-branch-memory)
13. [Future Offline Memory](#13-future-offline-memory)
14. [Business Timeline Memory](#14-business-timeline-memory)
15. [Memory Performance Targets](#15-memory-performance-targets)

---

## 1. Memory Philosophy

### 1.1 Why Business Memory Exists

Business Memory exists because an LLM, by itself, knows nothing about the owner's business. Every AI response must be grounded in actual business data — product names, customer balances, sales figures, stock levels. Without a structured, queryable memory system, the AI would either:

- Send raw database dumps in every prompt (expensive, slow, insecure)
- Rely on the LLM to remember facts across turns (unreliable)
- Hallucinate numbers and entities (dangerous)

Business Memory solves this by being a **deterministic, structured, queryable layer** between the database and the Language Engine. It pre-computes what the AI needs to know and serves it on demand.

### 1.2 Difference Between Business Memory and LLM Memory

| Aspect | Business Memory | LLM Memory (Context Window) |
|--------|-----------------|----------------------------|
| **Nature** | Deterministic, structured data | Probabilistic, unstructured text |
| **Persistence** | Survives across sessions | Lost when context window clears |
| **Mutability** | Explicit write + refresh cycles | Implicit, no control |
| **Source of truth** | TradeOS database | Whatever was in the prompt |
| **Retrieval** | Key-based, indexed, O(1) lookups | Semantic, fuzzy, token-costly |
| **Confidence** | 100% (it is the data) | Variable (may hallucinate) |
| **Token cost** | Zero (in-memory) | Direct (every token in the prompt) |
| **Security** | Row-level, tenant-isolated | Prompt-level, shared context |
| **Update** | Programmatic, auditable | None (new prompt needed) |

**The cardinal rule**: Business Memory holds facts. The LLM holds language. They never swap roles.

### 1.3 Core Principles

1. **Single source of truth**: Every AI data lookup goes through Business Memory, never directly to the database.
2. **Deterministic reads**: Memory returns the same data for the same key every time (until refreshed).
3. **Zero computation in the LLM**: All business calculations happen in Skills, which read from Memory.
4. **Tenant isolation**: Memory is per-organization, never shared.
5. **Graceful staleness**: Memory may be slightly stale (seconds to minutes). The system knows its age and reports it.
6. **Explicit refresh only**: Memory never auto-updates mid-request. Refresh is a separate, explicit cycle.

---

## 2. Memory Hierarchy

Business Memory is not a single store. It is a **layered hierarchy** with different durations, storage backends, and access patterns.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     MEMORY HIERARCHY                                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L0: WORKING MEMORY (In-memory, per-request)                  │  │
│  │  ├── Current intent + entities                                 │  │
│  │  ├── Active draft (multi-turn collection)                      │  │
│  │  ├── Current skill results                                     │  │
│  │  └── Evicted: when request completes                            │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│                                    ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L1: CONVERSATION MEMORY (In-memory + Supabase)               │  │
│  │  ├── This conversation's message history                       │  │
│  │  ├── Last N exchanges for context                              │  │
│  │  ├── Active state (what stage of pipeline)                     │  │
│  │  ├── Persisted: ai_conversations + ai_conversation_messages    │  │
│  │  └── Archived: after 24h inactivity or 100+ messages           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│                                    ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L2: BUSINESS MEMORY (In-memory, computed from DB)             │  │
│  │  ├── Entity stores (products, customers, suppliers, staff)     │  │
│  │  ├── Time-series stores (sales, purchases, expenses)          │  │
│  │  ├── Computed stores (health score, KPIs, forecasts)          │  │
│  │  ├── Inventory, tasks, alerts stores                          │  │
│  │  ├── Refreshed: on page load + after write operations         │  │
│  │  └── Duration: lifetime of browser tab (Phase 1)              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│                                    ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L3: PREFERENCE MEMORY (In-memory + Supabase)                 │  │
│  │  ├── Learned preferences (implicit: topic frequency, period)  │  │
│  │  ├── Explicit preferences (owner-stated: language, suppliers) │  │
│  │  ├── Ignored recommendation types                             │  │
│  │  ├── Suggested question rankings                              │  │
│  │  ├── Persisted: ai_owner_preferences table                    │  │
│  │  └── Duration: permanent across sessions                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│                                    ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L4: LONG-TERM MEMORY (Supabase + future vector store)        │  │
│  │  ├── Historical patterns and seasonal trends                  │  │
│  │  ├── Past decisions and outcomes                              │  │
│  │  ├── Entity relationships (knowledge graph)                   │  │
│  │  ├── Anomaly records and resolved issues                      │  │
│  │  ├── Persisted: ai_business_memory table                      │  │
│  │  └── Phase 1: design only, populated in Phase 6+              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│                                    ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  L5: WORLD KNOWLEDGE CACHE (In-memory + API cache)            │  │
│  │  ├── Market intelligence (news, analyses, signals)            │  │
│  │  ├── Currency exchange rates                                  │  │
│  │  ├── Commodity price references                               │  │
│  │  ├── Business rules and compliance info                       │  │
│  │  ├── TTL: configurable (hours to days)                        │  │
│  │  └── Phase 1: empty, populated when market features land      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Layer Characteristics

| Layer | Name | Storage | Duration | Latency | Persistence | Phase |
|-------|------|---------|----------|---------|-------------|-------|
| L0 | Working Memory | In-memory JS object | Per-request | <1µs | None | P1 |
| L1 | Conversation Memory | In-memory + `ai_conversation_messages` | Session (30m timeout) | <1ms read, <50ms write | Supabase | P6 |
| L2 | Business Memory | In-memory `MemoryStore` | Tab lifetime (P1) → extended (P6) | <1µs read | None (P1) → Supabase (P6) | P1 |
| L3 | Preference Memory | In-memory `PreferenceStore` + `ai_owner_preferences` | Permanent | <1µs read, <50ms write | Supabase | P6 |
| L4 | Long-Term Memory | `ai_business_memory` + future vector store | Permanent | <100ms read | Supabase | P6+ |
| L5 | World Knowledge Cache | In-memory cache + API | TTL (hours–days) | <1ms read | None | Future |

### 2.2 Data Flow Between Layers

```
Database ──► L2 (Business Memory) ──► Skills ──► Orchestrator ──► L1 (Conversation Memory) ──► Response
                 │                                                        │
                 ▼                                                        ▼
            L3 (Preferences) ──────────────────────────────────► Context Package
                 │                                                        │
                 ▼                                                        ▼
            L4 (Long-Term) ──► (Future enrichment)              Language Engine
```

**Read path**: Orchestrator → L2 (Business Memory) → Skills → L1 (Conversation History) → Context Package → LLM → Response

**Write path**: Confirmed action → Database → L2 (Business Memory refresh) → L1 (append confirmation message)

---

## 3. Memory Lifecycle

### 3.1 Creation

```
L0 — Working Memory
  Created: At pipeline start (Stage 0).
  Content: NormalizedRequest → grows through stages.
  Destroyed: After UnifiedResponse is returned.

L1 — Conversation Memory
  Created: First message in a new conversation.
    - Generate conversation_id (UUID v4)
    - Initialize empty message array
    - Set status = "active"
  Phase 1: In-memory only.
  Phase 6: INSERT into ai_conversations table.

L2 — Business Memory
  Created: On AI Assistant page mount.
    - MemoryWriter reads from existing React state (Phase 1)
    - Normalizes all data into MemoryStore structure
    - Pre-computes initial analytics/kpis
    - Full creation time: <500ms for typical business (<10k entities)
  Phase 1: Created on every page load (no persistence).
  Phase 6: Partially hydrated from Supabase cache on load.

L3 — Preference Memory
  Created: On AI Assistant page mount.
    - Initialize with defaults
    - Phase 1: empty in-memory store
    - Phase 6: loaded from ai_owner_preferences table
  Content seeded:
    - preferred_language: "english"
    - preferred_period: null (learned)
    - frequent_topics: {}
    - ignored_recommendation_types: []

L4 — Long-Term Memory
  Created: Phase 6+.
  Seeded: Periodically by Analyst Agent scanning business patterns.
  Phase 1: Not created (design only).

L5 — World Knowledge Cache
  Created: When first market intelligence request is made.
  Phase 1: Not created (design only).
```

### 3.2 Refresh

```
L0 — Working Memory
  Refreshed: Every request (fresh start).
  Mechanism: Pipeline creates new working memory.

L1 — Conversation Memory
  Appended: Every exchange (user message + assistant response).
  Refresh: Load last N messages when pipeline starts.
  Mechanism:
    - On pipeline start: read last 50 messages from memory
    - On response complete: append user + assistant messages

L2 — Business Memory
  Full refresh: On page load.
  Targeted refresh: After write operations (specific sections only).
  Mechanism:
    Normal refresh:
      MemoryWriter reads all React state → normalizes → writes to MemoryStore

    Targeted refresh (post-execution):
      Only affected sections are re-read:
        action_sale:      sales, products, computed
        action_purchase:  purchases, products, computed
        action_expense:   expenses, computed
        action_task:      tasks
        action_customer:  customers
        action_supplier:  suppliers
        action_product:   products, inventory, computed

    Poll refresh (Phase 6+):
      Background interval (configurable, default: 5 minutes) checks for data changes.
      Only refreshes sections that changed (detected via updated_at timestamps).

L3 — Preference Memory
  Appended: By Learning Engine (Stage 11) after each request.
  Full refresh: On page load (Phase 6: from database).
  Mechanism:
    - Learning Engine reads current preferences
    - Applies learning rules
    - Writes updated preferences back to store
    - Phase 6: async write to ai_owner_preferences

L4 — Long-Term Memory
  Scheduled: Daily (or on demand).
  Mechanism: Analyst Agent scans business data, extracts patterns, stores insights.
  Phase 1: No refresh (not implemented).

L5 — World Knowledge Cache
  TTL-based: Each entry has a time-to-live.
  On cache miss: Fetch from external API, cache with TTL.
```

### 3.3 Expiration

```
L0: Immediate — destroyed when request completes.

L1: 30 minutes of inactivity (configurable).
    After 30 min: conversation status = "archived".
    Archived conversations are loadable but not auto-included in context.

L2: Phase 1 — tab lifetime.
    Phase 6 — extended with service worker / background sync up to 24 hours.
    Stale after 30 minutes since last refresh (data may be outdated).

L3: Permanent until explicitly overridden.
    Owner can reset preferences: clears all learned preferences.
    Owner can set explicit preferences: overrides implicit ones.

L4: Permanent (append-only). Historical insights never expire.
    Patterns may be deprecated if newer data contradicts them.

L5: Per-entry TTL. Defaults:
    Market intelligence: 6 hours
    Currency rates: 1 hour
    Commodity prices: 24 hours
    Compliance rules: 7 days
```

### 3.4 Archiving

```
L1 — Conversation Archiving
  Triggers:
    - 24 hours since last message
    - 100+ messages in a single conversation
    - Owner explicitly archives

  What happens:
    - Status set to "archived"
    - Full message history preserved
    - Not included in auto-context retrieval
    - Searchable via conversation history UI

  Phase 1: No archiving (conversations reset on page refresh).
  Phase 6: Supabase-backed archiving with full history.

L2 — Business Memory Archiving
  Not applicable (current state snapshot, not historical).

L3 — Preference Archiving
  Not applicable (preferences are always current).

L4 — Long-Term Memory Archiving
  Not applicable (append-only store).

L5 — World Knowledge Archiving
  Not applicable (cache entries expire, not archive).
```

### 3.5 Cleanup

```
L0: Automatic — garbage collected when request completes.
  No explicit cleanup needed.

L1: Cleanup on archive:
    - In-memory state released
    - Only Supabase persistence remains
  Phase 6: messages older than 90 days moved to cold storage.

L2: Cleanup on tab close:
    - Full MemoryStore released
  Phase 6: cleanup of stale cache entries in Supabase.

L3: Cleanup on explicit reset:
    - Owner can reset all preferences
    - Individual preference removal supported
  No automatic cleanup (preferences persist until changed).

L4: Cleanup never (append-only by design).
  Old entries may be summarized/consolidated (Phase 8+).

L5: Automatic cleanup on TTL expiry.
  Stale entries evicted on next cache access.
  Periodic sweep: every hour.
```

---

## 4. Memory Categories

### 4.1 Products

```typescript
interface ProductMemory {
  // Identity
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;

  // Pricing
  defaultSellingPrice: number;
  lastPurchasePrice: number;
  defaultCostPrice: number;

  // Stock
  currentStock: number;
  reorderLevel: number;
  minimumStockLevel: number;
  stockStatus: "out_of_stock" | "urgent" | "low_soon" | "healthy" | "overstocked";
  estimatedDaysLeft: number | null;

  // Velocity (30-day window)
  totalSold30d: number;
  totalPurchased30d: number;
  dailySalesVelocity: number;
  revenue30d: number;
  profit30d: number;
  profitMargin30d: number | null;
  averageSellingPrice30d: number;

  // Timestamps
  lastSaleDate: string | null;
  lastPurchaseDate: string | null;
  createdAt: string;
  updatedAt: string;

  // Tracking
  trackBatch: boolean;
  trackExpiry: boolean;

  // Computed flags
  isActive: boolean;
  isFastMoving: boolean;
  isSlowMoving: boolean;
  needsReorder: boolean;
}
```

**Source**: Products table + sales_items aggregation (30-day window).

**Size**: ~200 bytes per product. 5,000 products ≈ 1MB.

**Indexed by**: `id`, `name` (fuzzy match), `category`, `stockStatus`.

### 4.2 Customers

```typescript
interface CustomerMemory {
  // Identity
  id: string;
  name: string;
  shopName: string | null;
  phone: string | null;
  address: string | null;

  // Sales (30-day window)
  totalSales30d: number;
  invoiceCount30d: number;
  lastSaleDate: string | null;
  averageSaleValue30d: number;

  // Credit
  creditLimit: number | null;
  creditPolicy: string | null;
  creditDays: number | null;
  allowOverLimit: boolean;
  allowOverdueSales: boolean;

  // Balances
  outstandingBalance: number;
  overdueAmount: number;
  overdueDays: number | null;
  creditUtilizationPct: number | null;

  // Payment behavior
  onTimePaymentRate: number | null;
  averagePaymentDays: number | null;
  lastPaymentDate: string | null;

  // Classification
  isActive30d: boolean;       // Purchased in last 30 days
  isNew30d: boolean;          // First purchase in last 30 days
  isHighValue: boolean;       // Top 20% by revenue
  isAtRisk: boolean;          // Overdue > 60 days or utilization > 90%

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
```

**Source**: Customers table + sales + payments aggregation.

**Size**: ~250 bytes per customer. 5,000 customers ≈ 1.25MB.

**Indexed by**: `id`, `name` (fuzzy match), `phone`, `isAtRisk`, `isActive30d`.

### 4.3 Suppliers

```typescript
interface SupplierMemory {
  // Identity
  id: string;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  address: string | null;

  // Purchases (30-day window)
  totalPurchases30d: number;
  invoiceCount30d: number;
  lastPurchaseDate: string | null;

  // Payables
  payableAmount: number;
  overdueAmount: number;
  averagePaymentDays: number | null;

  // Performance
  averageLeadTime: number | null;     // Days
  onTimeDeliveryRate: number | null;
  preferredPaymentTerms: string | null;

  // Classification
  isActive30d: boolean;
  isPreferred: boolean;               // Marked by owner or learned

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
```

**Source**: Suppliers table + purchases + payments aggregation.

**Size**: ~200 bytes per supplier. 1,000 suppliers ≈ 200KB.

**Indexed by**: `id`, `name` (fuzzy match), `isActive30d`.

### 4.4 Sales

```typescript
interface SalesMemory {
  // Period summaries
  today: SalesPeriodSummary;
  thisWeek: SalesPeriodSummary;
  thisMonth: SalesPeriodSummary;
  last30Days: SalesPeriodSummary;
  lastMonth: SalesPeriodSummary;     // Full previous calendar month
  allTime: SalesPeriodSummary;

  // Daily breakdown (last 30 days)
  daily: Array<{
    date: string;
    revenue: number;
    profit: number;
    invoiceCount: number;
  }>;

  // Monthly breakdown (last 12 months)
  monthly: Array<{
    month: string;                    // "2026-01"
    revenue: number;
    profit: number;
    invoiceCount: number;
  }>;

  // Metadata
  lastTransactionDate: string;
  transactionCount: number;
  hasProfitData: boolean;
  profitConfidence: "high" | "medium" | "low";
}

interface SalesPeriodSummary {
  revenue: number;
  profit: number;
  profitMargin: number | null;
  invoiceCount: number;
  averageSaleValue: number;
  byPaymentType: Record<string, number>;  // "cash": 50000, "credit": 30000
  byStaff: Record<string, number>;        // staff_id → revenue (if attributed)
  topProductId: string | null;
  topProductRevenue: number;
  topProductQuantity: number;
}
```

**Source**: Sales_transactions + sales_items tables, aggregated by period.

**Size**: ~5KB base + 500 bytes per day (30 days) + 300 bytes per month (12 months) ≈ ~25KB.

**Indexed by**: Period keys (today, thisWeek, etc.), date ranges.

### 4.5 Purchases

```typescript
interface PurchasesMemory {
  // Period summaries
  today: PurchasePeriodSummary;
  thisWeek: PurchasePeriodSummary;
  thisMonth: PurchasePeriodSummary;
  last30Days: PurchasePeriodSummary;
  allTime: PurchasePeriodSummary;

  // Metadata
  lastTransactionDate: string;
  transactionCount: number;
}

interface PurchasePeriodSummary {
  totalAmount: number;
  invoiceCount: number;
  bySupplier: Record<string, number>;    // supplier_id → amount
  byPaymentType: Record<string, number>;
}
```

**Source**: Purchase_transactions + purchase_items tables.

**Size**: ~3KB base + period data ≈ ~10KB.

### 4.6 Expenses

```typescript
interface ExpensesMemory {
  // Period summaries
  thisMonth: ExpensePeriodSummary;
  last30Days: ExpensePeriodSummary;
  lastMonth: ExpensePeriodSummary;
  allTime: ExpensePeriodSummary;

  // Category breakdown
  byCategory: Record<string, number>;    // "transport": 50000, "salary": 200000

  // Daily breakdown
  daily30d: Array<{
    date: string;
    total: number;
    byCategory: Record<string, number>;
  }>;

  // Monthly breakdown
  monthly12m: Array<{
    month: string;
    total: number;
    byCategory: Record<string, number>;
  }>;

  // Anomalies
  anomalies: Array<{
    category: string;
    month: string;
    amount: number;
    averageAmount: number;
    deviationPct: number;
    severity: "low" | "medium" | "high";
  }>;

  // Metadata
  totalExpenses: number;
  expenseCount: number;
  averageExpenseValue: number;
  topCategory: string | null;
  topCategoryPct: number | null;
  hasCategoryData: boolean;
}

interface ExpensePeriodSummary {
  totalAmount: number;
  count: number;
  byCategory: Record<string, number>;
}
```

**Source**: Expenses table, aggregated by period and category.

**Size**: ~4KB base + 200 bytes per day + 300 bytes per month ≈ ~15KB.

### 4.7 Employees (Staff)

```typescript
interface StaffMemory {
  // Identity
  id: string;
  name: string;
  role: string;
  phone: string | null;

  // Duty
  isActiveDuty: boolean;
  lastDutyStart: string | null;
  onDutySince: string | null;
  dutyDurationHours: number | null;

  // Location
  lastLocation: {
    lat: number;
    lng: number;
    capturedAt: string;
  } | null;

  // Performance (today)
  salesCountToday: number;
  salesAmountToday: number;

  // Performance (30-day)
  salesAmount30d: number;
  invoiceCount30d: number;
  averageSaleValue30d: number;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
```

**Source**: Staff table + duty_sessions + sales attribution.

**Size**: ~300 bytes per staff member. 100 staff ≈ 30KB.

**Indexed by**: `id`, `name`, `isActiveDuty`.

### 4.8 Permissions

```typescript
interface PermissionsMemory {
  // Owner
  ownerId: string;
  ownerProfileId: string;
  isOwner: boolean;                     // Current user is owner

  // Staff permissions (future)
  staffPermissions: Array<{
    staffId: string;
    canReadSales: boolean;
    canReadInventory: boolean;
    canReadCustomers: boolean;
    canReadExpenses: boolean;
    canReadStaff: boolean;
    canWriteSales: boolean;
    canWritePurchases: boolean;
    canWriteExpenses: boolean;
    canWriteCustomers: boolean;
    canWriteSuppliers: boolean;
    canWriteProducts: boolean;
    spendingLimit: number | null;
  }>;

  // Feature flags
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  marketIntelligenceEnabled: boolean;
}
```

**Source**: Auth context + staff_permissions table + organization settings.

**Size**: ~500 bytes for owner. ~200 bytes per staff member.

**Not cached**: Fetched fresh on every page load (security requirement).

### 4.9 Analytics (Computed)

```typescript
interface AnalyticsMemory {
  // Pre-computed health score
  healthScore: {
    score: number;
    label: string;
    breakdown: Record<string, number>;
    reasons: string[];
    trend: string;
    confidence: "full" | "partial" | "minimal" | "none";
    lastCalculated: string;
  };

  // Pre-computed KPIs (20 KPIs)
  kpis: Array<{
    key: string;
    label: string;
    category: string;
    value: number;
    formatted: string;
    change: number | null;
    changeLabel: "up" | "down" | "flat";
    confidence: "high" | "medium" | "low";
  }>;

  // Trends
  trends: {
    revenue: Array<{ label: string; value: number }>;
    profit: Array<{ label: string; value: number }>;
    expenses: Array<{ label: string; value: number }>;
  };

  // Forecasts
  forecasts: Array<{
    metric: string;
    period: string;
    predictedValue: number;
    confidence: number;
    range: { lower: number; upper: number };
  }>;

  // Recommendations
  recommendations: Array<{
    id: string;
    type: string;
    priority: string;
    title: string;
    description: string;
    expectedImpact: string;
  }>;

  // Warning flags
  needsAttention: boolean;
  attentionReasons: string[];
}
```

**Source**: Computed by Business Skills from other memory sections.

**Size**: ~10KB for all computed data.

**Refreshed**: On page load + after write operations.

### 4.10 Recommendations

```typescript
interface RecommendationsMemory {
  // Active recommendations (cached from Recommendation Engine)
  active: Array<{
    id: string;
    type: string;
    category: string;
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    expectedImpact: string;
    actionLink: string | null;
    sourceSkill: string;
    dismissed: boolean;
  }>;

  // Summary
  summary: {
    total: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
    byCategory: Record<string, number>;
  };

  // Last generated
  lastGenerated: string;
}
```

**Source**: SK010 (Recommendation Engine) output.

**Size**: ~2KB (capped at 20 recommendations).

**Refreshed**: On page load + when relevant memory sections change.

### 4.11 Conversations

```typescript
interface ConversationMemory {
  // Current conversation
  current: {
    id: string;
    title: string;
    status: "active" | "archived";
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  };

  // Recent messages (last 50)
  recentMessages: Array<{
    id: string;
    role: "user" | "assistant";
    type: string;                     // "text" | "chart" | "action_draft" | etc.
    text: string;
    chartData?: unknown;
    tableData?: unknown;
    actionDraft?: unknown;
    createdAt: string;
  }>;

  // Conversation list (last 20 conversations)
  recentConversations: Array<{
    id: string;
    title: string;
    messageCount: number;
    lastMessageAt: string;
    status: string;
  }>;

  // State
  state: {
    pipelineStage: string | null;      // Current pipeline stage
    awaitingConfirmation: boolean;     // Waiting for owner yes/no
    activeDraft: unknown | null;       // Current draft (if any)
  };
}
```

**Source**: Message history from current session + `ai_conversation_messages` table (Phase 6).

**Size**: ~500 bytes per message. 50 messages ≈ 25KB.

**Retention**: Last 50 messages in memory. Full history in database.

### 4.12 Preferences

```typescript
interface PreferencesMemory {
  // Learned (implicit)
  frequentTopics: Record<string, number>;  // intent → count
  preferredPeriod: "today" | "week" | "month" | null;
  preferredLanguage: "english" | "urdu" | "roman_urdu";
  ignoredRecommendationTypes: string[];

  // Explicitly set
  preferredSuppliers: string[];         // supplier names
  defaultPaymentType: "cash" | "credit" | null;
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  sttLanguage: string;

  // Suggested questions
  suggestedQuestions: Array<{
    text: string;
    intent: string;
    rank: number;
    frequency: number;
    lastAsked: string | null;
  }>;

  // Metadata
  version: number;                      // Incremented on each update
  lastModified: string;
  lastPersisted: string;                // Phase 6
}
```

**Source**: Learning Engine + owner explicit settings.

**Size**: ~2KB.

**Persistence**: Phase 1 in-memory. Phase 6 Supabase-backed.

---

## 5. Memory Retrieval Strategy

### 5.1 Retrieval Interface

```typescript
interface MemoryStore {
  // ─── Entity Retrieval ───

  /** Get a single entity by ID */
  getProduct(id: string): ProductMemory | undefined;
  getCustomer(id: string): CustomerMemory | undefined;
  getSupplier(id: string): SupplierMemory | undefined;
  getStaff(id: string): StaffMemory | undefined;

  /** Query entities by field value */
  findProducts(field: "name" | "category" | "brand", value: string): ProductMemory[];
  findCustomers(field: "name" | "phone", value: string): CustomerMemory[];
  findSuppliers(field: "name" | "phone", value: string): SupplierMemory[];

  /** Fuzzy search by name (for entity resolution) */
  searchProducts(name: string, threshold?: number): FuzzyMatch<ProductMemory>[];
  searchCustomers(name: string, threshold?: number): FuzzyMatch<CustomerMemory>[];
  searchSuppliers(name: string, threshold?: number): FuzzyMatch<SupplierMemory>[];
  searchStaff(name: string, threshold?: number): FuzzyMatch<StaffMemory>[];

  // ─── Section Retrieval ───

  /** Get entire typed section */
  getSection<K extends keyof MemorySections>(key: K): MemorySections[K];

  /** Get multiple sections at once (batch read) */
  getSections(keys: (keyof MemorySections)[]): Partial<MemorySections>;

  /** Get a summary of the entire business (for LLM context) */
  getBusinessSummary(): BusinessSummary;

  // ─── Computed Retrieval ───

  /** Get pre-computed analytics */
  getAnalytics(): AnalyticsMemory;

  /** Get active recommendations */
  getRecommendations(): RecommendationsMemory;

  /** Get conversation context (last N messages) */
  getConversationContext(n: number): ConversationMessage[];

  // ─── Metadata ───

  /** Age of memory since last refresh (ms) */
  ageMs: number;

  /** True if memory is stale (>30 min since refresh) */
  isStale: boolean;

  /** Size of memory in bytes (approximate) */
  byteSize: number;

  /** Section-level staleness */
  sectionAge(key: keyof MemorySections): number;
}

interface FuzzyMatch<T> {
  item: T;
  score: number;              // 0.0–1.0 similarity
  matchedField: string;       // Which field matched
  originalQuery: string;      // What was searched
}
```

### 5.2 Fuzzy Matching Algorithm

```
Phase 1 — Simple Fuzzy Match:

1. Normalize query: lowercase, trim, remove extra spaces, Urdu-normalize.
2. For each entity:
   a. Exact match on normalized name → score = 1.0 (immediate return)
   b. Check if query is a substring of name → score = 0.9
   c. Check if name is a substring of query → score = 0.85
   d. Levenshtein distance:
      - distance <= 2 for names < 10 chars → score = 0.8
      - distance <= 3 for names >= 10 chars → score = 0.7
   e. Word overlap: common words / total words → score = 0.5–0.7
3. Sort by score descending.
4. Return top 5 results.
5. Threshold: only return matches with score >= 0.5 (configurable).

Phase 3+ — Enhanced Fuzzy Match:
  - Add tokenization for compound names ("Pepsi 500ml" → ["Pepsi", "500ml"])
  - Add Urdu transliteration matching ("Pepsi" = "پیپسی")
  - Add brand-aware matching (search includes brand field)
```

### 5.3 Retrieval Priority Rules

```
Rule R1 — Exact match always wins (score = 1.0).
  Example: searching "Pepsi 500ml" with exact product name → immediate return.

Rule R2 — Recent entities preferred for equal scores.
  If two entities have the same fuzzy score, prefer the one with a more recent updatedAt.

Rule R3 — Active entities preferred over inactive.
  If a product is discontinued (isActive = false), demote score by 0.2.

Rule R4 — Case-insensitive always.
  "pepsi" == "Pepsi" == "PEPSI".

Rule R5 — Urdu normalization applied before matching.
  Different alef forms (ا, آ, أ, إ) normalized to base alef.
  Different ye forms (ي, ی) normalized to base ye.

Rule R6 — Roman Urdu transliteration (Phase 3+).
  "Pepsi" also matches "پیپسی" and vice versa.
```

### 5.4 Batch Retrieval

When the Context Retriever needs multiple sections for a single intent, it uses batch retrieval:

```
Batch retrieval process:
  1. Determine required sections (from Context Retrieval Rules, Section 6)
  2. Lock memory for reads (prevent concurrent writes during read)
  3. Read all sections in a single synchronous pass (O(k) where k = sections)
  4. Return typed Partial<MemorySections>
  5. Release lock

Phase 1:
  Single-threaded (JS event loop). No locks needed.
  All sections are plain JS objects — reads are O(1) to O(n) depending on section.
```

---

## 6. Context Retrieval Rules

### 6.1 Intent-to-Section Mapping

When the Context Retriever needs to assemble context for a request, it maps the intent to the required memory sections:

```
Intent                     Sections Required                       Max Tokens
────────────────────────────────────────────────────────────────────────────────
health                     meta, analytics (healthScore)              2500
analytics_sales            meta, products, sales, analytics (kpis)    2000
analytics_inventory        meta, products, inventory                  1500
analytics_customers        meta, customers                            2000
analytics_expenses         meta, expenses                             1500
forecast                   meta, sales, analytics (forecasts)         2000
kpi                        meta, analytics (kpis)                     1000
reorder                    meta, products, inventory                  1500
recommendations            meta, analytics, recommendations           2000
general_overview           meta, analytics, inventory, recent sales   4000

action_sale                meta, products (target), customers (target) 1000
action_purchase            meta, products (target), suppliers (target) 1000
action_expense             meta, expenses (categories only)            500
action_task                meta                                       500
action_customer            meta, customers (duplicate check)           500
action_supplier            meta, suppliers (duplicate check)           500
action_product             meta, products (duplicate check)            500
send_whatsapp              meta, customers, suppliers (resolve)        500
```

### 6.2 Scoping Rules

```
Rule S1 — Scope to intent only.
  Never load full memory. Only load sections relevant to the detected intent.
  Exception: general_overview loads 5 sections.

Rule S2 — Scope to relevant entities for actions.
  For action_sale: load only the specific product and customer (by ID), not all.
  For action_purchase: load only the specific product and supplier (by ID).

Rule S3 — Omit raw transaction lists.
  Period summaries are sufficient. Never include individual invoice line items.

Rule S4 — Include conversation history.
  Always include last 3 exchanges for read pipeline.
  Always include last 5 exchanges for write pipeline (multi-turn field collection).

Rule S5 — Include preferences.
  Always include: preferred_period, preferred_language, ignored_recommendation_types.

Rule S6 — Include business summary.
  Always include a 2–3 sentence summary of the business (org, size, current period).
```

### 6.3 Context Package Structure

```typescript
interface ContextPackage {
  requestId: string;

  // Always included
  meta: {
    businessName: string;
    ownerName: string;
    currentDate: string;
    currentTime: string;
    timezone: string;
    businessSummary: string;           // 2–3 sentences
    memoryAgeMs: number;
    memoryIsStale: boolean;
  };

  // Intent-scoped sections
  sections: Partial<{
    products: ProductMemory[];
    customers: CustomerMemory[];
    suppliers: SupplierMemory[];
    staff: StaffMemory[];
    sales: SalesMemory;
    purchases: PurchasesMemory;
    expenses: ExpensesMemory;
    inventory: InventoryMemory;        // Flat view derived from products
    analytics: AnalyticsMemory;
    recommendations: RecommendationsMemory;
  }>;

  // Action-specific (write pipeline)
  actionContext: {
    targetProduct: ProductMemory | null;
    targetCustomer: CustomerMemory | null;
    targetSupplier: SupplierMemory | null;
  } | null;

  // Conversation context
  conversationHistory: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: string;
  }>;

  // Preferences
  preferences: {
    preferredPeriod: string | null;
    preferredLanguage: string;
    ignoredRecommendationTypes: string[];
  };

  // Token tracking
  estimatedTokens: number;
  tokenBudget: number;
  exceedsBudget: boolean;
}
```

### 6.4 Truncation Strategy

If the assembled context exceeds the token budget for the intent, truncate in this order:

```
1. Truncate conversation history to last 2 exchanges (from 3/5)
2. Remove individual product KPIs from analytics section
3. Truncate trend data to last 14 days (from 30)
4. Remove non-essential fields from entity data (prices, velocities kept; flags removed)
5. Remove daily breakdowns, keep only period summaries
6. Truncate conversation history to last 1 exchange
```

If still over budget after all truncation:

```
Remove individual entity data. Keep only period summaries + analytics.
Flag response with warning: "Detailed data truncated to fit context window."
```

---

## 7. Token Budget Strategy

### 7.1 Per-Intent Budgets

Each intent has a maximum token budget for the assembled context package. This is the total size of the ContextPackage + prompts sent to the Language Engine.

```
Intent                     Context Budget    Prompt Budget    Total Budget
──────────────────────────────────────────────────────────────────────────
health                       2,000             500              2,500
analytics_sales              1,500             500              2,000
analytics_inventory          1,000             500              1,500
analytics_customers          1,500             500              2,000
analytics_expenses           1,000             500              1,500
forecast                     1,500             500              2,000
kpi                            800             500              1,300
reorder                      1,000             500              1,500
recommendations              1,500             500              2,000
general_overview             3,500             500              4,000

action_sale                    800             500              1,300
action_purchase                800             500              1,300
action_expense                 400             500                900
action_task                    300             500                800
action_customer                400             500                900
action_supplier                400             500                900
action_product                 400             500                900
send_whatsapp                  300             500                800

greeting / thanks                0             200                200
casual / unknown              500             500              1,000
```

### 7.2 Token Estimation Formula

```
Token estimation (client-side, before sending):

For English text:
  tokens ≈ text.length * 0.25  (conservative: 4 chars per token)

For Urdu text:
  tokens ≈ text.length * 0.35  (Urdu characters are 2+ bytes in UTF-8)

For structured data (JSON):
  tokens ≈ JSON.stringify(data).length * 0.20  (keys + numbers are compact)

For mixed data:
  Estimate each field separately, sum totals.
  Add 10% safety margin.

For Gemini Flash 2.0 (Phase 1 provider):
  Max output tokens: 8,192
  Max context window: 1,048,576
  Phase 1 will never approach this limit, but the estimation ensures responsible usage.
```

### 7.3 Budget Enforcement

```
Enforcement is at the ContextPackage level (Stage 3 of the pipeline):

Step 1 — Estimate tokens:
  Iterate through assembled context sections.
  Sum estimated token counts.

Step 2 — Compare with intent budget:
  If estimated tokens > budget: trigger truncation (Section 6.4).
  If estimated tokens <= budget: proceed.

Step 3 — Track budget utilization:
  budgetUtilization = estimatedTokens / totalBudget * 100
  Include in response metadata.

Step 4 — Log over-budget events:
  If truncation was needed: log which sections were truncated and why.
  Used for optimizing context assembly rules over time.
```

### 7.4 Provider-Specific Limits

```
Gemini Flash 2.0 (Phase 1 primary):
  Context window: 1,048,576 tokens
  Max output: 8,192 tokens
  Phase 1 context will use <5% of this capacity.

OpenAI GPT-4o-mini (Phase 1 fallback):
  Context window: 128,000 tokens
  Max output: 16,384 tokens
  Phase 1 context will use <10% of this capacity.

Groq Llama 3 (Phase 1 second fallback):
  Context window: 32,000 tokens (varies by model)
  Must ensure context fits within 32K for Groq fallback.
```

---

## 8. Memory Refresh Rules

### 8.1 Refresh Triggers

```
Full refresh (all sections):
  Trigger: Page load or navigation to AI Assistant page.
  Action: MemoryWriter reads all data, normalizes, pre-computes analytics.
  Duration: <500ms (typical business), <2s (large business, 10k+ entities).

Targeted refresh (specific sections):
  Trigger: After write operation execution (Stage 8).
  Action: Only affected sections re-read and recomputed.
  Duration: <100ms per section.

Background refresh (Phase 6+):
  Trigger: Timer (configurable, default 5 minutes).
  Action: Check updated_at timestamps; refresh only changed sections.
  Duration: <50ms per section (if unchanged, just timestamp check).

Manual refresh:
  Trigger: Owner clicks "Refresh" button (future UI).
  Action: Full refresh.

Staleness refresh:
  Trigger: Pipeline Stage 3 finds memory age > 30 minutes.
  Action: Async targeted refresh (does not block the current request).
  Warning: "Data may be up to 30 minutes old" included in response.
```

### 8.2 Refresh Scope

```
Full Refresh:
  ┌─ Products    ──> ProductsMemory (all)
  ├─ Customers   ──> CustomersMemory (all)
  ├─ Suppliers   ──> SuppliersMemory (all)
  ├─ Staff       ──> StaffMemory (all)
  ├─ Sales       ──> SalesMemory (aggregate all periods)
  ├─ Purchases   ──> PurchasesMemory (aggregate all periods)
  ├─ Expenses    ──> ExpensesMemory (aggregate all periods)
  ├─ Permissions ──> PermissionsMemory
  ├─ Inventory   ──> Computed from Products
  ├─ Analytics   ──> Run SK001–SK010, cache results
  └─ Recommend   ──> Run SK010, cache results

Targeted (Post-action_sale):
  ┌─ Sales       ──> Refresh today, thisWeek, thisMonth, last30Days
  ├─ Products    ──> Refresh only the sold product
  └─ Analytics   ──> Recompute health score + KPIs + recommendations

Targeted (Post-action_purchase):
  ┌─ Purchases   ──> Refresh today, thisWeek, thisMonth, last30Days
  ├─ Products    ──> Refresh only the purchased product
  └─ Analytics   ──> Recompute health score + KPIs + recommendations

Targeted (Post-action_expense):
  ┌─ Expenses    ──> Refresh thisMonth
  └─ Analytics   ──> Recompute expense ratio + recommendations
```

### 8.3 Refresh Locking

```
During a full refresh:
  - Memory is NOT locked for reads.
  - Reads during refresh see the OLD memory state until refresh completes.
  - When refresh completes: memory pointers atomically swap to new state.
  - This prevents partial reads (no torn reads).

Implementation:
  MemoryStore is immutable by design.
  Refresh creates a new MemoryStore instance.
  On completion: active reference is swapped.
  In-flight requests continue using the old instance (eventual consistency).

Phase 1 simplification:
  Single-threaded JS. No concurrent reads/writes possible.
  Refresh runs synchronously on page load.
  Post-execution refresh is queued after the response is sent.
```

### 8.4 Refresh Failure Handling

```
If a refresh fails (database error, timeout):
  - Keep existing memory (may be stale).
  - Log error.
  - Set memory.isStale = true.
  - Include warning in next response: "Data refresh failed. Showing data from {age} ago."

If a targeted refresh fails:
  - Log error for the failed section.
  - Other sections update normally.
  - Stale section flagged in metadata.
```

---

## 9. Memory Confidence

### 9.1 Per-Section Confidence

Each memory section has a confidence label indicating how reliable its data is.

```
Confidence Levels:

FULL    — All required data sources were available and up to date.
          No warnings. Data is considered authoritative.

PARTIAL — Some data sources were missing or incomplete.
          Core fields are present, but some computed fields may be estimated.
          Warnings explain what is missing.

MINIMAL — Most data sources were missing.
          Only basic information is available.
          Computed fields are likely defaults or 0.

NONE    — Section could not be populated.
          No data available for this category.
          Skills should return warnings or null results.

Section      FULL Condition                              PARTIAL If
────────────────────────────────────────────────────────────────────
Products     All products have prices + stock values     >20% missing prices
Customers    All customers have balances                 >20% missing credit limits
Suppliers    All suppliers have payables                  >20% missing payment terms
Sales        All sales have cost data (COGS known)       >50% of sales have cost data
Inventory    All products have stock + reorder levels    >20% missing reorder levels
Expenses     All expenses categorized                    >30% uncategorized
Staff        Sales attributed + location data            Sales not attributed
Analytics    All skills executed successfully            Some skills had partial data
Preferences  At least 3 interactions recorded            <3 interactions
```

### 9.2 Overall Memory Confidence

```
Overall confidence = weighted average of section confidences:

  FULL    = 1.0
  PARTIAL = 0.6
  MINIMAL = 0.3
  NONE    = 0.0

Overall confidence label:
  >= 0.85:  HIGH    — All sections reliable. Trust results fully.
  >= 0.60:  MEDIUM  — Some sections incomplete. Results are usable but verify critical numbers.
  >= 0.30:  LOW     — Significant data gaps. Results are indicative only.
  < 0.30:   UNRELIABLE — Insufficient data for meaningful results.

Overall confidence is included in every response metadata.
Skills can use section confidence to adjust their own output confidence.
```

### 9.3 Confidence Impact on Responses

```
When overall confidence is:
  HIGH    → Normal response. No disclaimers.
  MEDIUM  → Add subtle note: "Based on available data. Some fields may be estimates."
  LOW     → Prominent disclaimer: "Limited data available. Numbers are estimates."
  UNRELIABLE → Warning: "Not enough data for reliable analysis. Please add more data."

On the response level:
  LLM is instructed (in the generation prompt) to adjust language based on confidence.
  If confidence is LOW: use tentative language ("approximately", "around", "estimated").
  If confidence is HIGH: use definitive language ("your revenue is", "you have").
```

---

## 10. Memory Security

### 10.1 Tenant Isolation

```
Rule T1 — Every memory store is scoped to exactly one organization_id.
  No memory data is shared across organizations.
  organization_id is set at memory creation and never changed.

Rule T2 — Memory is populated only from the owning organization's data.
  MemoryWriter filters all queries by organization_id.
  Supabase RLS policies enforce this at the database level.

Rule T3 — Cross-tenant access is architecturally impossible.
  MemoryStore has no method to load data from a different organization.
  The MemoryStore instance is created per-organization, per-page-load.
```

### 10.2 Access Control

```
Phase 1 (Owner-only):
  - Owner is authenticated via Supabase Auth
  - Memory is populated with all business data
  - No access restrictions (owner sees everything)

Phase 6+ (Staff access):
  - Staff permissions scoped at the MemoryWriter level
  - StaffMemorySection contains only data the staff member is permitted to see
  - Entity-level filtering: staff who cannot see prices receive products with price = 0
  - Permission check happens during memory write, not during read

Regardless of phase:
  - PermissionsMemory section is always populated (even for owner)
  - Validator (Stage 6) checks permission before any write operation
  - Working Memory (L0) is per-request and never persisted
```

### 10.3 Data Sensitivity

```
Sensitive data handling:

  Financial data (sales, profit, balances):
    Stored in memory with full detail.
    Never logged in plain text in conversation history (audit logs have masked values).
    Only displayed to authenticated owner.

  Personally identifiable information (customer phone, staff name):
    Stored in memory for entity resolution.
    Never sent to LLM providers in prompts unless needed for the specific request.
    LLM prompt assembly strips PII when not required.

  API keys / tokens:
    Never stored in Business Memory.
    Handled by provider-router.ts exclusively.
```

### 10.4 Memory Integrity

```
Integrity guarantees:

  Immutable reads: MemoryStore is read-only during pipeline execution.
    Writing to memory is only possible through the MemoryWriter interface.
    No skill or component can mutate memory directly.

  Atomic swaps: When memory is refreshed, the old and new instances coexist briefly.
    Readers holding a reference to the old instance continue reading consistent data.
    New readers see the new instance. No torn reads.

  No ghost data: When an entity is deleted from the database:
    It is removed from memory on the next refresh.
    In-flight requests may still reference the deleted entity (eventual consistency).
    The system handles this gracefully: "It appears this product was recently removed."
```

---

## 11. Future Vector Search Strategy

### 11.1 Purpose

Enable semantic search across conversations, past queries, and business entities. This allows the AI to:
- Find past conversations by meaning, not just keywords
- Retrieve relevant business memories based on conceptual similarity
- Enable "remember when I asked about..." type queries

### 11.2 Architecture (Phase 6+)

```
┌──────────────────────────────────────────────────────────────┐
│                    VECTOR SEARCH                               │
│                                                               │
│  ┌─────────────────────┐    ┌──────────────────────────────┐  │
│  │  EMBEDDING GENERATOR │    │  VECTOR STORE                 │  │
│  │                      │    │                               │  │
│  │  • Conversation text │───►│  • pgvector on Supabase       │  │
│  │  • Business entities │    │  • 1536-dim embeddings        │  │
│  │  • Past queries      │    │  • IVFFlat index              │  │
│  │  • Skill results     │    │  • Cosine similarity search   │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│                                         │                      │
│                                         ▼                      │
│                               ┌──────────────────────────┐     │
│                               │  RETRIEVAL AUGMENTED      │     │
│                               │  GENERATION (RAG)          │     │
│                               │                            │     │
│                               │  • Top-K results by        │     │
│                               │    similarity score        │     │
│                               │  • Context window assembly │     │
│                               │  • Relevance filtering     │     │
│                               └──────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### 11.3 What Gets Embedded

```
Phase 6 — Initial:

  Conversations:
    Every user message + assistant response pair is embedded.
    Stored in ai_conversation_messages with embedding column.
    Used for: "What did I ask about last week?"

  Past Queries:
    Every owner question is embedded and stored.
    Used for: "Show me questions I've asked about inventory."

  Business Summaries:
    Weekly business summaries are embedded.
    Used for: "How was business in March?"

Phase 8 — Enhanced:

  Entities:
    Product names, customer names, supplier names embedded.
    Used for: cross-lingual entity resolution (Urdu ↔ English).

  Skill Results:
    Key analytical results embedded.
    Used for: "What did the health score say last time?"

  Owner Preferences:
    Preference entries embedded for context-aware retrieval.
    Used for: "You always ask about this in the morning."
```

### 11.4 Retrieval Flow

```
1. Owner asks: "What did I ask about last week regarding Pepsi?"
2. Orchestrator classifies intent: episodic_query
3. Working memory flags: needs_vector_search = true
4. Query text embedded using same embedding model
5. Vector store searched for top 5 similar past conversations
6. Results filtered by:
   - organization_id (mandatory)
   - time range (last week)
   - relevance score > 0.7
7. Top results formatted and included in context
8. LLM generates answer from retrieved conversations

Phase 1: This entire flow is stubbed.
  Orchestrator handles "remember" queries with a response:
  "I don't have long-term memory yet. This feature is coming soon."
```

### 11.5 Embedding Model Selection

```
Criteria:
  - Must support Urdu + English + Roman Urdu
  - Must fit within Phase 6 budget (free or low-cost)
  - Must produce embeddings compatible with pgvector

Primary candidate: text-embedding-004 (Google) — free tier, multilingual, 768-dim
Alternative: text-embedding-3-small (OpenAI) — 1536-dim, multilingual
Fallback: BGE-M3 (open source, self-hosted)

Dimension: 768 (Google) or 1536 (OpenAI) — both supported by pgvector.
Index type: IVFFlat with 100 centroids (default for <1M rows).

Embedding cost per query:
  ~100 tokens per query → ~10,000 queries per $0.001 (Google free tier)
  Phase 6 budget: negligible.
```

---

## 12. Future Multi-Branch Memory

### 12.1 Purpose

Support businesses with multiple branches/locations. The AI must be branch-aware: it should know which branch it's talking about and answer accordingly.

### 12.2 Memory Structure (Phase 8+)

```
Single store, branching by organization:

MemoryStore {
  organization: {
    id: string;
    name: string;
    branches: BranchMemory[];
  };
  currentBranch: string | null;      // Currently active branch context
  global: OrganizationMemory;         // Consolidated across all branches
}

BranchMemory {
  id: string;
  name: string;
  location: string;
  isActive: boolean;

  // All the standard sections, scoped to this branch
  products: Map<string, ProductMemory>;
  customers: Map<string, CustomerMemory>;
  sales: SalesMemory;
  purchases: PurchasesMemory;
  expenses: ExpensesMemory;
  staff: StaffMemory;
  inventory: InventoryMemory;
  analytics: AnalyticsMemory;
}
```

### 12.3 Branch Context Switching

```
Automatic (via intent):
  "How is the Lahore branch doing?"
    → Intent: health, entity: "Lahore branch"
    → Context: switch currentBranch to Lahore
    → Load Lahore-specific memory sections

  "How are all branches doing?"
    → Intent: health, scope: "all"
    → Load consolidated global analytics

Manual (via owner preference):
  Owner sets default branch in preferences.
  All queries default to that branch unless another is specified.

Memory refresh:
  Each branch has its own refresh schedule.
  Global analytics are computed from branch-level data.
```

### 12.4 Cross-Branch Analytics

```
Consolidated view:
  totalRevenue = sum(branch.revenue)
  totalProfit = sum(branch.profit)
  topBranch = branch with highest revenue
  worstBranch = branch with lowest health score

Comparison queries:
  "Which branch has the highest sales?" → Compare branch sales summaries
  "How does Lahore compare to Karachi?" → Side-by-side analytics

Phase 1: No branch support.
  All memory is single-organization, single-branch.
```

---

## 13. Future Offline Memory

### 13.1 Purpose

Enable the AI Assistant to work when the internet is slow or unavailable. Core memory operations must work offline; only LLM calls require connectivity.

### 13.2 Architecture (Phase 8+)

```
Browser (Online)
  ┌─────────────────────┐
  │  MemoryStore        │  ←--- Loaded from server on page load
  ├─────────────────────┤
  │  Service Worker     │  ←--- Caches memory snapshots
  └─────────┬───────────┘
            │
            ▼
Browser (Offline)
  ┌─────────────────────────┐
  │  MemoryStore (cached)    │
  ├─────────────────────────┤
  │  Last good snapshot     │  ←--- From service worker cache
  ├─────────────────────────┤
  │  Skills (pure functions)│  ←--- All work offline
  ├─────────────────────────┤
  │  LLM (unavailable)      │  ←--- Only this fails offline
  └─────────────────────────┘
```

### 13.3 Offline Behavior

```
When offline:

  Read queries:
    - Memory is available from last cached snapshot
    - Skills execute normally (they are pure functions)
    - Response Generation (LLM) is unavailable
    - Fallback: deterministic template-based response from skill results
    - Example: Health score → "Your health score is 72 (Average).
      Based on cached data from 2 hours ago."

  Write operations:
    - Action Planner works (deterministic, no LLM needed)
    - Entity resolution works (memory is cached)
    - Owner sees draft and can confirm
    - Execution queues; performed when online
    - Draft saved to pending queue

  UI:
    - All conversation UI works
    - Suggested questions work (cached)
    - Warning banner: "Offline — AI responses use cached data.
      Answers will be less conversational."
```

### 13.4 Cache Management

```
Cache storage: IndexedDB (browser) or Service Worker Cache API.

Cache size:
  Phase 8 target: <10MB for typical business.
  Typical MemoryStore snapshot: 1-3MB compressed.
  Service worker cache: last 3 snapshots (rolling).

Cache invalidation:
  On every successful online refresh, cache the new snapshot.
  Cache is labeled with organization_id + timestamp.
  Old snapshots evicted when cache exceeds 10MB.

Offline data freshness:
  Displayed in every offline response:
  "Data from {timestamp}. {age} old."
```

---

## 14. Business Timeline Memory

### 14.1 Purpose

Maintain a chronological timeline of significant business events. This enables the AI to answer questions about sequences of events and understand business context over time.

### 14.2 Memory Structure (Phase 8+)

```typescript
interface TimelineMemory {
  events: BusinessEvent[];
  summary: {
    lastEvent: string;                  // Description of most recent event
    eventCount30d: number;
    significantChange: boolean;         // True if major event in last 7 days
    significantChangeDescription: string | null;
  };
}

interface BusinessEvent {
  id: string;
  type: EventType;
  timestamp: string;
  title: string;
  description: string;
  severity: "positive" | "negative" | "neutral" | "critical";
  entityType: string | null;           // "product", "customer", etc.
  entityId: string | null;
  entityName: string | null;
  amount: number | null;
  previousValue: number | null;        // For change events
  newValue: number | null;
  isResolved: boolean;
  resolvedAt: string | null;
}

type EventType =
  | "large_sale"              // Single sale > 20% of daily average
  | "large_purchase"          // Single purchase > 20% of daily average
  | "stockout"                // Product went out of stock
  | "stock_restocked"         // Product restocked after stockout
  | "new_customer"            // First-time customer
  | "customer_overdue"        // Customer became overdue
  | "customer_paid"           // Overdue customer paid
  | "expense_spike"           // Category expense > 2x normal
  | "profit_milestone"        // Daily profit > 50% above average
  | "revenue_milestone"       // Daily revenue > 50% above average
  | "health_change"           // Health score changed by >5 points
  | "staff_milestone"         // Staff sales milestone
  | "ai_action_executed"      // AI performed a write operation
  | "system_alert";           // System-generated alert
```

### 14.3 Event Detection Rules

```
Rule E1 — Events are detected during memory refresh.
  During targeted refresh, compare new data with previous snapshot.
  If a threshold is crossed, generate an event.

Rule E2 — Events are deduplicated.
  Same event type for the same entity within 24 hours → merge into existing event.
  Example: Product goes out of stock → one event. If it stays out of stock for 3 days, no new events.

Rule E3 — Event severity guides inclusion in LLM context.
  "critical" events always included in context (last 7 days).
  "positive"/"negative" events included if within last 48 hours.
  "neutral" events only included if specifically asked about.

Rule E4 — Timeline is append-only.
  Events are never deleted, only marked as resolved.
  Old events archived after 90 days.

Phase 1: Timeline is not implemented.
  Minimal tracking: last 3 event types stored in memory for awareness.
  Full timeline in Phase 8+.
```

### 14.4 Timeline Query Examples

```
"Has anything important happened this week?"
  → Timeline summary: "3 significant events: Stockout of Pepsi (resolved),
     Large sale of PKR 250,000 to Usman Store, Expense spike in Transport category."

"What happened after the stockout of Pepsi?"
  → Retrieve stockout event, then all events within 48 hours after it.
  → "You reordered 50 units from Ahmad Supplier. Stock was restored 2 days later."

"Why did my health score drop?"
  → Find health_change event with negative severity.
  → "Your health score dropped from 78 to 72 on July 20 due to
     increased overdue receivables and an expense spike."
```

---

## 15. Memory Performance Targets

### 15.1 Absolute Targets

```
Metric                          Target          Maximum         Measurement
─────────────────────────────────────────────────────────────────────────────
Memory initialization (load)    200ms           500ms           Time from page mount to MemoryStore ready
Memory initialization (10k)     500ms           2,000ms         Time for large businesses
Section read (single entity)    <1µs            5µs             getProduct, getCustomer, etc.
Section read (entire section)   <5ms            20ms            getSection("products") for 5k items
Batch read (3 sections)         <10ms           30ms            getSections(["sales","products","inventory"])
Memory refresh (full)           200ms           500ms           MemoryWriter full cycle
Memory refresh (targeted)       50ms            200ms           Single section refresh
Fuzzy search (5k products)      <5ms            15ms            searchProducts("pepsi")
Context assembly                5ms             15ms            ContextPackage construction
Byte size (typical business)    2MB             5MB             Full MemoryStore serialized
Byte size (10k entities)        5MB             10MB            Full MemoryStore for large business
```

### 15.2 Scaling Characteristics

```
Entity count scaling:
  100 products:    ~20KB    → 50ms init, <1ms reads
  1,000 products:  ~200KB   → 100ms init, <2ms reads
  5,000 products:  ~1MB     → 200ms init, <5ms reads
  10,000 products: ~2MB     → 500ms init, <10ms reads (upper limit for Phase 1)

Transaction count scaling (affects SalesMemory):
  1,000 transactions:  ~10KB → 50ms aggregation
  10,000 transactions: ~100KB → 200ms aggregation
  100,000 transactions: ~1MB → Phase 6+ optimization needed (pre-aggregated server-side)

Read vs write ratio:
  Read-heavy: 95% reads, 5% writes (typical AI usage)
  Memory is optimized for read performance.
  Writes (refresh) are infrequent and can take longer.
```

### 15.3 Optimization Rules

```
Rule O1 — Lazy computation.
  Don't compute analytics until they are requested.
  Page load computes only what Skills will need.
  Full analytics computation happens on first analytics query.

Rule O2 — Pre-compute, not re-compute.
  Health score, KPIs, trends computed once during refresh.
  Subsequent reads get cached values (O(1)).
  Invalidation: targeted refresh triggers re-computation.

Rule O3 — Indexed entity maps.
  Products, customers, suppliers stored as Map<string, T> (hash map).
  Lookup by ID: O(1).
  Lookup by name: O(n) scan (acceptable for <10k entities).
  Phase 6+: inverted index for O(log n) name lookup.

Rule O4 — Period summaries instead of raw data.
  Never store raw transaction lists in memory.
  Pre-aggregate into period buckets (today, thisWeek, thisMonth, last30Days).
  Reduces memory from O(n) transactions to O(1) period buckets.

Rule O5 — String interning for repeated values.
  Category names, brand names, payment types are stored once and referenced.
  Reduces memory for repeated string values across entities.
```

### 15.4 Monitoring & Alerting

```
Metrics to track (Phase 6+):

  memory_init_time_ms     — Alert if >1s
  memory_byte_size        — Alert if >10MB
  section_read_time_ms    — Alert if >50ms
  context_assembly_time_ms — Alert if >50ms
  memory_age_ms           — Alert if >1 hour without refresh
  refresh_failure_count   — Alert if >3 consecutive failures
  fuzzy_search_time_ms    — Alert if >50ms

Logging:
  Every memory refresh is logged with duration + byte size.
  Every cache miss is logged (section requested but not populated).
  Every stale read (memory > 30 min) is logged.
```

---

## Appendix A: Memory Data Flow Diagram

```
                          DATABASE (Supabase RLS)
                               │
                               ▼
    ┌─────────────────────────────────────────────────┐
    │                MEMORY WRITER                      │
    │  - Reads products, customers, suppliers, sales    │
    │  - Aggregates transactions into period buckets    │
    │  - Normalizes entity data into memory shapes      │
    │  - Calls Skills to pre-compute analytics          │
    └─────────────────────┬───────────────────────────┘
                          │
                          ▼
    ┌─────────────────────────────────────────────────┐
    │                  MEMORY STORE                     │
    │                                                   │
    │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
    │  │ Entities   │  │ Time-series│  │ Computed   │  │
    │  │            │  │            │  │             │  │
    │  │ products   │  │ sales      │  │ healthScore│  │
    │  │ customers  │  │ purchases  │  │ kpis       │  │
    │  │ suppliers  │  │ expenses   │  │ forecasts  │  │
    │  │ staff      │  │            │  │ recommend  │  │
    │  └────────────┘  └────────────┘  └────────────┘  │
    │                                                   │
    │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
    │  │ Preferences│  │ Permissions│  │ Metadata   │  │
    │  │            │  │            │  │             │  │
    │  │ topics     │  │ owner      │  │ age        │  │
    │  │ language   │  │ staffPerms │  │ stale      │  │
    │  │ ignored    │  │ features   │  │ size       │  │
    │  └────────────┘  └────────────┘  └────────────┘  │
    └─────────────────────┬───────────────────────────┘
                          │
                          ▼
    ┌─────────────────────────────────────────────────┐
    │               CONTEXT RETRIEVER                   │
    │  - Scopes sections by intent                     │
    │  - Applies token budget                          │
    │  - Adds conversation history                     │
    │  - Builds ContextPackage                         │
    └─────────────────────┬───────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
    ┌──────────────────┐   ┌──────────────────────┐
    │    SKILLS         │   │  LANGUAGE ENGINE      │
    │  Read from Memory │   │  Receives context     │
    │  Return results   │   │  Generates text       │
    └──────────────────┘   └──────────────────────┘
```

## Appendix B: Memory Sections Quick Reference

```
Section             Key             Read Pattern     Avg Size     Refresh Trigger
────────────────────────────────────────────────────────────────────────────────
Products            "products"      Map<id, T>        1MB         Page load + post-write
Customers           "customers"     Map<id, T>        1.25MB      Page load + post-write
Suppliers           "suppliers"     Map<id, T>        200KB       Page load + post-write
Staff               "staff"         Map<id, T>        30KB        Page load
Sales               "sales"         Section object    25KB        Page load + post-sale
Purchases           "purchases"     Section object    10KB        Page load + post-purchase
Expenses            "expenses"      Section object    15KB        Page load + post-expense
Inventory           "inventory"     Derived from      5KB         Page load + post-write
                                      products
Permissions         "permissions"   Section object    500B        Page load
Analytics           "analytics"     Pre-computed      10KB        Page load + post-write
Recommendations     "recommend"     Pre-computed      2KB         Page load + post-write
Preferences         "preferences"   Section object    2KB         Each request (learned)
Conversations       "conversations" Array + state     25KB        Each exchange
```

## Appendix C: Database Schema for Memory (Phase 6+)

```sql
-- Core memory persistence
-- Phase 1: Not created. Phase 6: Migration.

CREATE TABLE ai_business_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  section         text NOT NULL,             -- "products", "sales", etc.
  memory_key      text,                      -- entity ID or section key
  data            jsonb NOT NULL,            -- The serialized memory data
  schema_version  integer NOT NULL DEFAULT 1,
  confidence      text NOT NULL DEFAULT 'FULL',
  byte_size       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Composite key
  UNIQUE(organization_id, section, memory_key)
);

CREATE INDEX idx_memory_org_section ON ai_business_memory(organization_id, section);
CREATE INDEX idx_memory_updated ON ai_business_memory(organization_id, updated_at DESC);

-- Owner preferences
CREATE TABLE ai_owner_preferences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id      uuid NOT NULL REFERENCES profiles(id),
  preference_key  text NOT NULL,
  preference_value jsonb NOT NULL,
  source          text NOT NULL DEFAULT 'implicit',   -- "implicit" | "explicit"
  confidence      real NOT NULL DEFAULT 0.5,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE(organization_id, profile_id, preference_key)
);

-- Semantic memory (Phase 8+)
CREATE TABLE ai_semantic_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  content_type    text NOT NULL,             -- "conversation" | "insight" | "pattern"
  content_text    text NOT NULL,
  embedding       vector(768),               -- or vector(1536), depends on model
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- IVFFlat index on embedding (created after data is populated)
  -- CREATE INDEX idx_semantic_embedding ON ai_semantic_memory
  --   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
);

CREATE INDEX idx_semantic_org ON ai_semantic_memory(organization_id, content_type);
```

## Appendix D: Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-29 | Chief AI Architect | Initial Business Memory specification — 15 sections defining the permanent memory system |

---

*This document defines the permanent Business Memory architecture for TradeOS AI. Business Memory is the single source of truth for all AI data lookups. No component reads raw database tables for an AI request. The LLM never directly accesses memory. All business computations flow through deterministic Skills that read from Memory.*

---

**Architecture freeze**: With this document, the TradeOS AI architecture is complete. The five architecture documents — Master Architecture, Execution Protocol, Business Skills Spec, Business Memory Spec, and Phase 1 Implementation Plan — constitute the complete, frozen specification. The next task is implementation.
