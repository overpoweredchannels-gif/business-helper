# TradeOS AI — Execution Protocol

> **Version**: 1.0  
> **Status**: Immutable Architecture Contract  
> **Scope**: Every AI request — text, voice, WhatsApp, and all future integrations  
> **Principle**: The LLM is a language engine only. Every business calculation is a deterministic Business Skill. The Business Brain orchestrates everything.

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Protocol Invariants](#2-protocol-invariants)
3. [Request Lifecycle](#3-request-lifecycle)
4. [Stage 0: Input Reception & Normalization](#4-stage-0-input-reception--normalization)
5. [Stage 1: Intent Classification](#5-stage-1-intent-classification)
6. [Stage 2: Entity Extraction](#6-stage-2-entity-extraction)
7. [Stage 3: Context Retrieval](#7-stage-3-context-retrieval)
8. [Stage 4: Business Skills Execution](#8-stage-4-business-skills-execution)
9. [Stage 5: Action Validation (Operation Requests Only)](#9-stage-5-action-validation-operation-requests-only)
10. [Stage 6: Permission Checks](#10-stage-6-permission-checks)
11. [Stage 7: Owner Confirmation (Operation Requests Only)](#11-stage-7-owner-confirmation-operation-requests-only)
12. [Stage 8: Execution (Operation Requests Only)](#12-stage-8-execution-operation-requests-only)
13. [Stage 9: Response Generation](#13-stage-9-response-generation)
14. [Stage 10: Audit Logging](#14-stage-10-audit-logging)
15. [Stage 11: Learning & Memory Update](#15-stage-11-learning--memory-update)
16. [Error Handling](#16-error-handling)
17. [Channel-Specific Adaptations](#17-channel-specific-adaptations)
18. [Protocol Enforcement](#18-protocol-enforcement)

---

## 1. Purpose & Scope

### 1.1 Purpose

This document defines the **immutable, mandatory execution protocol** that every AI request in TradeOS must follow. It is the permanent contract between:

- The **Business Brain** (orchestrator) and all input channels
- The **Business Brain** and the **Language Engine** (LLM providers)
- The **Business Brain** and **Business Skills** (deterministic services)
- The **Business Brain** and **Business Memory** (data layer)
- The **Business Brain** and **Audit & Learning** subsystems

### 1.2 Scope

This protocol governs **every request** regardless of:

- **Channel**: Text (in-app), Voice (Web Speech / Deepgram / ElevenLabs), WhatsApp (incoming / outgoing), future MCP integrations
- **Intent**: Business question, analysis request, action command, communication task, system control, casual conversation
- **Language**: English, Urdu, Roman Urdu, or mixed
- **User role**: Owner (Phase 1), Staff (future)

### 1.3 Binding Nature

- **No component** — UI, API route, voice handler, WhatsApp handler, or future MCP server — may process an AI request through a different pipeline.
- **No future provider** — AI, voice, or integration — may bypass this protocol.
- **Deviations** require written architectural review and a documented exception in this file.

---

## 2. Protocol Invariants

These invariants are **non-negotiable**. Every component and every future integration must respect them.

| # | Invariant | Violation Consequence |
|---|-----------|----------------------|
| I1 | The LLM **never** calculates business metrics (health score, forecast, KPI, trend analysis, or recommendations). | Architectural failure — revert immediately |
| I2 | The LLM **never** resolves entities against business data. Entity resolution is deterministic. | Data corruption risk |
| I3 | The LLM **never** validates business logic (stock sufficiency, credit limits, data integrity). | Financial loss risk |
| I4 | The LLM **never** writes to the database or calls external APIs directly. | Security breach |
| I5 | No database write occurs without going through the full Understand → Plan → Validate → Confirm → Execute → Audit → Learn pipeline. | Data integrity failure |
| I6 | Every operation request **must** be presented to the owner for explicit confirmation before execution. | Trust violation |
| I7 | Every request (read or write) **must** be logged with sufficient detail for full reconstruction. | Audit failure |
| I8 | Business Memory is the **single source of truth** for all AI data lookups. No component reads raw database tables for an AI request. | Consistency failure |
| I9 | The Business Brain is the **only entry point** for all AI requests. No channel bypasses the orchestrator. | Architecture violation |

---

## 3. Request Lifecycle

### 3.1 Two Pipeline Modes

The protocol defines two pipeline modes depending on the request type:

#### Read Pipeline (Questions, Analysis, Casual)

```
INPUT → NORMALIZE → CLASSIFY → EXTRACT → RETRIEVE → EXECUTE SKILLS → GENERATE → AUDIT → LEARN → RESPONSE
         Stage 0     Stage 1   Stage 2   Stage 3    Stage 4           Stage 9   Stage 10 Stage 11
```

Operational stages 5–8 are skipped.

#### Write Pipeline (Commands, Operations, State Changes)

```
INPUT → NORMALIZE → CLASSIFY → EXTRACT → RETRIEVE → EXECUTE SKILLS → VALIDATE → PERMISSION → CONFIRM → EXECUTE → GENERATE → AUDIT → LEARN → RESPONSE
         Stage 0     Stage 1   Stage 2   Stage 3    Stage 4           Stage 5   Stage 6     Stage 7   Stage 8   Stage 9   Stage 10 Stage 11
```

All 12 stages execute in order. No stage may be skipped, reordered, or shortcut.

### 3.2 Full Pipeline Diagram

```
┌─────────────┐
│   CHANNEL    │  Text / Voice / WhatsApp / MCP
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS BRAIN                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 0: INPUT RECEPTION & NORMALIZATION                              ││
│  │   - Channel detection (text/voice/whatsapp)                             ││
│  │   - Language detection (en/ur/roman_urdu)                               ││
│  │   - Normalization (trim, Urdu normalization, remove noise)              ││
│  │   - Rate limit check                                                    ││
│  │   Output: NormalizedRequest { text, language, channel, metadata }       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 1: INTENT CLASSIFICATION                                        ││
│  │   - Language Engine (LLM, temp=0) classifies intent from text           ││
│  │   - Deterministic fallback (keyword match) if LLM unavailable           ││
│  │   - Output: IntentResult { intent, confidence, pipeline_mode }          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 2: ENTITY EXTRACTION                                            ││
│  │   - Language Engine (LLM, temp=0) extracts entities from text           ││
│  │   - Entities resolved against Business Memory (deterministic)           ││
│  │   - Ambiguous entities flagged for clarification                        ││
│  │   - Output: EntityResult { resolved, ambiguous, missing }               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 3: CONTEXT RETRIEVAL                                            ││
│  │   - Context Retriever reads from Business Memory                        ││
│  │   - Scoped to intent (never full dataset)                               ││
│  │   - Includes conversation history + preferences                         ││
│  │   - Output: ContextPackage { memory_snapshot, history, preferences }    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 4: BUSINESS SKILLS EXECUTION                                    ││
│  │   - Skill Registry maps intent → deterministic skill function(s)        ││
│  │   - Skills read from ContextPackage, return structured results          ││
│  │   - Multiple skill results merged for complex intents                   ││
│  │   - NO LLM involvement                                                  ││
│  │   - Output: SkillResults { invoked_skills[], results[] }                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│        ┌────────────────────────────┼────────────────────────────┐          │
│        ▼                            ▼                            ▼          │
│  ┌───────────┐              ┌───────────────┐           ┌───────────────┐  │
│  │  QUERY    │              │  OPERATION     │           │  SYSTEM       │  │
│  │  (Read)   │              │  (Write)       │           │  (Control)    │  │
│  └─────┬─────┘              └───────┬───────┘           └───────┬───────┘  │
│        │                            │                           │          │
│        ▼                            ▼                           ▼          │
│  ┌───────────┐              ┌───────────────┐           ┌───────────────┐  │
│  │ SKIP      │              │ STAGE 5:      │           │ STAGE 5:      │  │
│  │ Stages 5-8│              │ VALIDATION     │           │ VALIDATION    │  │
│  └─────┬─────┘              │ (Permissions,  │           │ (System       │  │
│        │                    │  Data, Logic,  │           │  safety only) │  │
│        │                    │  Safety)       │           └───────┬───────┘  │
│        │                    └───────┬───────┘                   │          │
│        │                            │                           ▼          │
│        │                    ┌───────────────┐           ┌───────────────┐  │
│        │                    │ STAGE 6:      │           │ STAGE 7:      │  │
│        │                    │ PERMISSION    │           │ CONFIRMATION  │  │
│        │                    │ CHECK         │           │ (If state-    │  │
│        │                    └───────┬───────┘           │  changing)    │  │
│        │                            │                   └───────┬───────┘  │
│        │                    ┌───────────────┐                   │          │
│        │                    │ STAGE 7:      │◄──────────────────┘          │
│        │                    │ CONFIRMATION  │                              │
│        │                    │ (Owner yes/no)│                              │
│        │                    └───────┬───────┘                              │
│        │                            │                                      │
│        │                    ┌───────────────┐                              │
│        │                    │ STAGE 8:      │                              │
│        │                    │ EXECUTION     │                              │
│        │                    │ (DB write /   │                              │
│        │                    │  API call)    │                              │
│        │                    └───────┬───────┘                              │
│        └────────────┬──────────────┴──────────────────────────────────────┘
│                     │
│                     ▼
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 9: RESPONSE GENERATION                                         ││
│  │   - Language Engine (LLM, temp=0.3) converts structured data to text    ││
│  │   - Response Former assembles: text + charts + tables + key points      ││
│  │   - Output: UnifiedResponse { text, chart_data, table_data, metadata  } ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 10: AUDIT LOGGING                                              ││
│  │   - Every stage output logged to immutable audit trail                  ││
│  │   - Full reconstruction possible from log                               ││
│  │   - Output: AuditRecord { request_id, stages[], timestamps }            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │   STAGE 11: LEARNING & MEMORY UPDATE                                   ││
│  │   - Learning Engine records patterns, updates preferences               ││
│  │   - Memory freshness check (schedule next refresh if needed)            ││
│  │   - Non-blocking, asynchronous                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                                      ▼
                              ┌─────────────────┐
                              │   CHANNEL OUTPUT │
                              └─────────────────┘
```

### 3.3 Stage Transition Rules

1. **Sequential**: Stages execute in order. No stage begins until the previous stage completes.
2. **Fail-stop**: If any stage returns an error, the pipeline stops immediately and returns the error to the channel.
3. **No skip**: Read pipeline skips Stages 5–8 by design (architecture decision, not a shortcut). Write pipeline must execute all stages.
4. **No retry inside pipeline**: If a stage fails due to a transient error (LLM timeout, DB connection), the entire request fails. Retry is handled at the channel level, not within the pipeline.

---

## 4. Stage 0: Input Reception & Normalization

### 4.1 Purpose

Receive raw input from any channel, normalize it, and produce a consistent structure for the pipeline.

### 4.2 Input

```
Channel Input:
  - Raw text (typed or transcribed)
  - Channel identifier: "in_app" | "voice" | "whatsapp" | "mcp"
  - Channel metadata:
    - In-app: { session_id, conversation_id? }
    - Voice: { audio_duration_ms, stt_provider, confidence }
    - WhatsApp: { wa_message_id, sender_phone, sender_name, message_type }
```

### 4.3 Processing Steps

```
Step 0.1 — Channel Detection
  Identify the input channel from metadata.

Step 0.2 — Language Detection
  Detect language from text using character-range heuristics + keyword matching:
    - Urdu script (Unicode range 0600-06FF) → "urdu"
    - Roman Urdu keywords (han, ji, nahi, kya, hai, etc.) → "roman_urdu"
    - English default → "english"
  Confidence score attached. If uncertain, default to "english".

Step 0.3 — Text Normalization
  - Trim whitespace
  - Collapse multiple spaces
  - Remove control characters
  - Normalize Urdu characters (alef variants, ye variants)
  - Preserve original text in metadata

Step 0.4 — Rate Limit Check
  - Check in-memory rate limiter for this organization
  - If exceeded: return 429 error immediately (do not proceed to Stage 1)

Step 0.5 — Request ID Generation
  - Generate UUID v4 request_id for traceability
```

### 4.4 Output

```
NormalizedRequest {
  request_id: string;           // UUID v4 — traces this request through all stages
  text: string;                 // Normalized text
  language: "english" | "urdu" | "roman_urdu";
  language_confidence: number;  // 0.0–1.0
  channel: "in_app" | "voice" | "whatsapp" | "mcp";
  channel_metadata: Record<string, unknown>;
  original_text: string;        // Preserved for audit
  received_at: string;          // ISO 8601 timestamp
}
```

### 4.5 Error Conditions

| Condition | Response |
|-----------|----------|
| Empty text after normalization | Error: `EMPTY_INPUT` — "Please type or speak your question." |
| Rate limit exceeded | Error: `RATE_LIMITED` — "Please wait a moment before sending another request." |
| Language detection uncertainty < 0.3 | Default to "english", proceed without error |

---

## 5. Stage 1: Intent Classification

### 5.1 Purpose

Determine what the owner wants: a question, an action, analysis, or system control. This stage drives the pipeline mode (read vs. write).

### 5.2 Input

```
NormalizedRequest
```

### 5.3 Processing Steps

```
Step 1.1 — Primary Classification (LLM)
  Send text to Language Engine with intent classification prompt.
  LLM temperature: 0.0 (deterministic).
  LLM output: { intent, confidence, sub_intent? }

Step 1.2 — Confidence Check
  If LLM confidence >= 0.7: accept LLM result.
  If LLM confidence < 0.7 AND > 0.3: fall back to deterministic keyword classification.
  If LLM confidence <= 0.3 AND LLM unavailable (error/timeout): fall back to deterministic keyword classification.

Step 1.3 — Deterministic Fallback
  Keyword-based classification when LLM is unavailable:
    - "how is", "health", "score", "doing" → health
    - "sell", "sale", "revenue", "income" → analytics_sales
    - "stock", "inventory", "product", "item" → analytics_inventory
    - "customer", "client", "credit", "balance" → analytics_customers
    - "expense", "spend", "cost", "paid" → analytics_expenses
    - "forecast", "predict", "will", "future" → forecast
    - "kpi", "metric", "number", "stat" → kpi
    - "reorder", "order", "buy", "purchase" (question context) → reorder
    - "recommend", "suggest", "advice", "should" → recommendations
    - "create", "add", "new", "make", "record" → action_*
    - "send", "message", "whatsapp", "tell" → communication
    - "brief", "alert", "notify", "daily" → system
    - default → general_overview

Step 1.4 — Pipeline Mode Assignment
  Based on intent, assign pipeline mode:
    - action_*, communication → "write" (full pipeline)
    - system (if state-changing) → "write"
    - all other intents → "read" (short-circuit at Stage 4)
```

### 5.4 Intent Taxonomy

```
business_question
├── health                  ← "How is my business doing?"
├── analytics_sales         ← "What were my sales yesterday?"
├── analytics_inventory     ← "Which products are low in stock?"
├── analytics_customers     ← "Who are my top customers?"
├── analytics_expenses      ← "Where is my money going?"
├── forecast                ← "What will my sales be next month?"
├── kpi                     ← "What are my key metrics?"
├── reorder                 ← "What should I reorder?"
├── recommendations         ← "What should I do?"
├── general_overview        ← "Give me a summary of everything"

action_command
├── action_sale             ← "Create a sale of 5 Pepsi to Usman Store"
├── action_purchase         ← "Order 10 cartons of Oil from Ahmad Supplier"
├── action_expense          ← "Record a transport expense of PKR 500"
├── action_task             ← "Create a task to call Khurram"
├── action_customer         ← "Add a new customer: Rashid Electronics"
├── action_supplier         ← "Add a new supplier: Ali Traders"
├── action_product          ← "Add a new product: Banana 1kg"

communication
├── send_whatsapp           ← "Send message to Usman Store that delivery tomorrow"
├── read_whatsapp           ← Incoming WhatsApp message (auto-route)

system
├── generate_briefing       ← "Give me my daily briefing"
├── generate_alert          ← "Alert me when stock of Pepsi is low"
├── schedule_reminder       ← "Remind me to call Khurram at 3 PM"
├── learn_preference        ← "Always show sales in PKR"
├── set_setting             ← "Switch to Urdu language"

casual
├── greeting                ← "Hi", "Assalam-o-Alaikum", "Hello"
├── thanks                  ← "Thanks", "Shukriya", "Thank you"
├── farewell                ← "Bye", "Khuda Hafiz"
├── clarification           ← "What do you mean?", "Explain again"
└── unknown                 ← Non-business conversation
```

### 5.5 Output

```
IntentResult {
  request_id: string;
  intent: string;                       // From taxonomy above
  sub_intent: string | null;            // Further refinement (e.g., "daily" for analytics_sales)
  confidence: number;                   // 0.0–1.0
  pipeline_mode: "read" | "write";
  classification_method: "llm" | "keyword" | "fallback";
  raw_llm_output: unknown | null;       // Logged, not used downstream
}
```

### 5.6 Error Conditions

| Condition | Response |
|-----------|----------|
| LLM unavailable AND keyword fallback returns "unknown" | Error: `UNCLASSIFIABLE` — "I didn't understand. Please rephrase." |
| Intent is "unknown" with confidence < 0.5 | Error: `UNCLASSIFIABLE` — "I'm not sure what you need. Try asking about sales, inventory, or customers." |
| Intent is "greeting" / "thanks" / "farewell" | Short-circuit directly to Stage 9 with a canned response (skip Stages 2–8) |

---

## 6. Stage 2: Entity Extraction

### 6.1 Purpose

Extract business entities (products, customers, suppliers, staff, quantities, amounts) from the owner's text and resolve them against Business Memory.

### 6.2 Input

```
NormalizedRequest + IntentResult
```

### 6.3 Processing Steps

```
Step 2.1 — LLM Entity Extraction
  Send text + available entity catalogs (product names, customer names, supplier names) to LLM.
  LLM temperature: 0.0.
  LLM output: { entities: Array<{ type, name, quantity?, amount? }> }

Step 2.2 — Entity Resolution (Deterministic)
  For each extracted entity, resolve against Business Memory:
    - Product name → fuzzy match against memory.products (name, brand)
    - Customer name → fuzzy match against memory.customers
    - Supplier name → fuzzy match against memory.suppliers
    - Staff name → fuzzy match against memory.staff

Step 2.3 — Ambiguity Detection
  If multiple entities match (e.g., "Pepsi" matches "Pepsi 500ml" and "Pepsi 1.5L"):
    - Mark entity as "ambiguous"
    - Include top 3 candidates with identifiers

Step 2.4 — Missing Field Detection
  Compare extracted fields against required fields for the intent/action type.
  If required fields are missing:
    - Mark as "missing" with the field name
    - Required fields defined in the Skills Registry for each action type
```

### 6.4 Required Fields by Action Type

```
action_sale:
  required: [product, quantity, customer, payment_type]
  optional: [price, discount, date, staff]

action_purchase:
  required: [product, quantity, supplier]
  optional: [price, date, payment_type]

action_expense:
  required: [amount, category]
  optional: [description, date, staff]

action_task:
  required: [title]
  optional: [priority, due_date, assigned_to, description]

action_customer:
  required: [name]
  optional: [shop_name, phone, credit_limit]

action_supplier:
  required: [name]
  optional: [phone, payment_terms]

action_product:
  required: [name, price]
  optional: [brand, category, reorder_level]

send_whatsapp:
  required: [recipient, message]
  optional: [template_name]
```

### 6.5 Entity Resolution Rules

```
Rule ER1 — Exact match is preferred over fuzzy match.
Rule ER2 — Fuzzy match uses normalized name (lowercase, trimmed, Urdu-normalized).
Rule ER3 — Levenshtein distance threshold: ≤2 for names <10 chars, ≤3 for names ≥10 chars.
Rule ER4 — If no fuzzy match found, entity is marked "unresolved" with the raw text preserved.
Rule ER5 — Quantity and price entities are parsed from text using regex (digits + optional decimal).
Rule ER6 — Date entities are resolved relative to "today" from memory.meta.current_date.
Rule ER7 — Time entities (e.g., "next month", "last week") are resolved to exact date ranges.
```

### 6.6 Output

```
EntityResult {
  request_id: string;
  resolved: Array<{
    type: "product" | "customer" | "supplier" | "staff";
    name: string;               // Original text
    resolved_name: string;      // Matched memory entity name
    resolved_id: string;        // Matched memory entity ID
    confidence: number;         // 0.0–1.0
  }>;
  extracted: Array<{
    field: string;              // e.g., "quantity", "price", "date", "payment_type"
    value: string | number;
  }>;
  ambiguous: Array<{
    name: string;
    candidates: Array<{ id: string; name: string; identifier: string }>;
  }>;
  missing: Array<{
    field: string;
    required: boolean;
    prompt: string;             // Question to ask owner to collect this field
  }>;
  unresolved: Array<{
    type: string;
    raw_text: string;
  }>;
}
```

### 6.7 Error Conditions

| Condition | Response |
|-----------|----------|
| All required entities unresolved for action intent | Error: `ENTITIES_UNRESOLVED` — return error, do not proceed |
| Ambiguous entities exist | Do NOT proceed to Stage 3. Return ambiguous candidates to owner for clarification. Restart pipeline when clarified. |

---

## 7. Stage 3: Context Retrieval

### 7.1 Purpose

Assemble all business data needed for the subsequent stages. The Context Retriever reads from Business Memory — it never queries raw database tables directly.

### 7.2 Input

```
NormalizedRequest + IntentResult + EntityResult
```

### 7.3 Processing Steps

```
Step 3.1 — Scope Determination
  Based on intent + resolved entities, determine which Business Memory sections to read:

  health               → meta, computed.health_score, inventory, sales.this_month, expenses.this_month
  analytics_sales      → meta, sales (all periods), customers (top), products (sales data)
  analytics_inventory  → meta, inventory, products (stock data), computed.kpis
  analytics_customers  → meta, customers (all), sales.last_30_days
  analytics_expenses   → meta, expenses, sales.this_month (for ratio comparison)
  forecast             → meta, sales (all periods), computed.forecasts
  kpi                  → meta, computed.kpis, computed.health_score
  reorder              → meta, inventory, products (reorder data), computed.recommendations
  recommendations      → meta, computed.recommendations, computed.health_score, computed.kpis
  general_overview     → meta, computed (all), sales.this_month, inventory, expenses.this_month
  action_*             → meta, relevant entity details (product stock, customer balance, supplier details)
  communication        → meta, relevant entity details (customer/supplier phone)

Step 3.2 — Memory Read
  Read the determined sections from Business Memory.
  If memory is stale (age > 30 minutes since last refresh), trigger async refresh.
  Return the data immediately with a staleness flag; do NOT block on refresh.

Step 3.3 — Conversation History Assembly
  Include last N exchanges from conversation history:
    - For read pipeline: last 5 exchanges
    - For write pipeline with missing fields: last 10 exchanges (preserves context across multi-turn collection)
  Format as: [{ role: "user" | "assistant", text: string }]

Step 3.4 — Preference Inclusion
  Read relevant preferences from PreferenceStore:
    - preferred_period (if analytics or forecast intent)
    - preferred_language (for response generation)
    - ignored_recommendation_types (if recommendations intent)
```

### 7.4 Context Token Budget

```
Intent               Max Tokens    Priority
────────────────────────────────────────────
health                  2500       computed data only
analytics_sales         2000       aggregate data
analytics_inventory     1500       stock + product data
analytics_customers     2000       customer + balance data
analytics_expenses      1500       expense + ratio data
forecast                2000       historical + forecast data
kpi                     1000       KPI values only
reorder                 1500       product + stock data
recommendations         2000       all computed recommendations
general_overview        4000       all computed + current period
action_*                1000       entity + validation data only
communication           500        entity contact + history
system                  1000       system state
```

If the assembled context exceeds the budget, trim in this order:
1. Remove conversation history beyond last 3 exchanges
2. Remove supplementary entity details (keep only essential)
3. Truncate trend data to last 7 points instead of 30

### 7.5 Output

```
ContextPackage {
  request_id: string;
  memory_age_ms: number;            // Age since last full refresh
  is_stale: boolean;                // True if memory is older than 30 min
  sections_loaded: string[];        // Names of memory sections read

  // Business data (structure varies by intent — typed per section)
  business: {
    meta: MemoryMeta;
    products?: ProductMemory[];
    customers?: CustomerMemory[];
    suppliers?: SupplierMemory[];
    staff?: StaffMemory[];
    sales?: PeriodData<SalesSummary>;
    purchases?: PeriodData<PurchaseSummary>;
    expenses?: PeriodData<ExpenseSummary>;
    inventory?: InventoryMemory;
    tasks?: TaskMemory;
    alerts?: AlertMemory;
    computed?: {
      health_score?: HealthScoreResult;
      kpis?: KpiResult[];
      trends?: TrendResult[];
      forecasts?: ForecastResult[];
      recommendations?: RecommendationResult[];
    };
  };

  // Resolved entities (for write pipeline)
  resolved_entities: EntityResult;

  // Conversation context
  conversation_history: Array<{ role: string; text: string; timestamp: string }>;

  // Owner preferences
  preferences: {
    preferred_period: string | null;
    preferred_language: string | null;
    ignored_recommendation_types: string[];
  };
}
```

### 7.6 Error Conditions

| Condition | Response |
|-----------|----------|
| Business Memory is empty (first load) | Error: `MEMORY_EMPTY` — "Loading your business data. Please try again in a moment." |
| Requested sections not found in memory | Log warning, return partial context, proceed |
| Memory refresh in progress | Return current (possibly stale) data with `is_stale: true` |

---

## 8. Stage 4: Business Skills Execution

### 8.1 Purpose

Execute deterministic Business Skills that perform all business calculations. This stage is the core of the Business Brain — the LLM is not involved.

### 8.2 Input

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage
```

### 8.3 Skill Registry

```
SKILL_REGISTRY = {
  // Read intents → one or more skills
  health:                     [healthScore],
  analytics_sales:            [analytics.getSalesAnalytics],
  analytics_inventory:        [analytics.getInventoryAnalytics],
  analytics_customers:        [analytics.getCustomerAnalytics],
  analytics_expenses:         [analytics.getExpenseAnalytics],
  forecast:                   [forecast],
  kpi:                        [kpi.getKpis],
  reorder:                    [reorderAdvice],
  recommendations:            [recommendationEngine],
  general_overview:           [healthScore, kpi.getKpis, analytics.getSalesAnalytics, recommendationEngine],

  // Write intents → planning skill (decomposes action into steps)
  action_sale:                [actionPlanner],
  action_purchase:            [actionPlanner],
  action_expense:             [actionPlanner],
  action_task:                [actionPlanner],
  action_customer:            [actionPlanner],
  action_supplier:            [actionPlanner],
  action_product:             [actionPlanner],
  send_whatsapp:              [actionPlanner],
}
```

### 8.4 Skill Contract

Every Business Skill must conform to this interface:

```typescript
interface BusinessSkill<Input, Output> {
  name: string;                        // Unique skill identifier
  version: string;                     // Semver for change tracking
  description: string;                 // Human-readable purpose
  input_schema: Record<string, unknown>; // JSON Schema for validation
  execute(input: Input, context: ContextPackage): SkillResult<Output>;
}

interface SkillResult<Output> {
  skill_name: string;
  success: boolean;
  data: Output | null;
  error: SkillError | null;
  warnings: string[];
  execution_time_ms: number;
}
```

### 8.5 Available Skills (Phase 1)

| Skill | File | Purpose | Deterministic? |
|-------|------|---------|----------------|
| `healthScore` | `skills/health-score.ts` | Calculate business health score (0–100) | Yes |
| `analytics.getSalesAnalytics` | `skills/analytics.ts` | Sales totals, trends, top products | Yes |
| `analytics.getInventoryAnalytics` | `skills/analytics.ts` | Stock value, low stock, out-of-stock | Yes |
| `analytics.getCustomerAnalytics` | `skills/analytics.ts` | Top customers, balances, overdue | Yes |
| `analytics.getExpenseAnalytics` | `skills/analytics.ts` | By category, trends, ratios | Yes |
| `analytics.getStaffAnalytics` | `skills/analytics.ts` | Active sessions, sales per staff | Yes |
| `forecast` | `skills/forecast.ts` | Moving average + linear trend projection | Yes |
| `kpi.getKpis` | `skills/kpi.ts` | Revenue, margin, turnover, ratios | Yes |
| `reorderAdvice` | `skills/reorder-advice.ts` | Reorder recommendations from stock data | Yes |
| `recommendationEngine` | `skills/recommendation-engine.ts` | Cross-skill priority-ranked recommendations | Yes |
| `actionPlanner` | `skills/action-planner.ts` | Decompose action into executable steps | Yes |

### 8.6 Multi-Skill Merge (For Composite Intents)

When multiple skills are invoked for one intent (e.g., `general_overview`), their results are merged into a single structure:

```typescript
interface MergedSkillResults {
  request_id: string;
  invoked_skills: Array<{ name: string; version: string; execution_time_ms: number }>;
  total_execution_time_ms: number;

  // Typed results (null if skill was not invoked or failed)
  health_score: HealthScoreResult | null;
  analytics: AnalyticsResult | null;
  forecast: ForecastResult | null;
  kpis: KpiResult[] | null;
  reorder_advice: RecommendationResult[] | null;
  recommendations: RecommendationResult[] | null;
  action_plan: ActionPlanResult | null;  // Only for write pipeline
}
```

### 8.7 Action Planner (Write Pipeline Only)

For action intents, the `actionPlanner` skill decomposes the command into verifiable steps:

```typescript
interface ActionPlanResult {
  action_type: string;                   // "action_sale" | "action_purchase" | ...
  status: "ready" | "needs_input" | "blocked";

  steps: Array<{
    order: number;
    description: string;                 // e.g., "Verify product 'Pepsi' exists in inventory"
    status: "ready" | "needs_input" | "blocked";
    details: string;                     // e.g., "Found: Pepsi 500ml (id: xyz-789, stock: 12)"
  }>;

  draft_summary: string;                 // "Sale of 5 × Pepsi 500ml @ PKR 130 to Usman General Store"
  estimated_total: number | null;        // e.g., 650
  missing_fields: Array<{ field: string; prompt: string }>;

  warnings: string[];                    // e.g., "Customer has overdue balance of PKR 25,000"
  blockers: string[];                    // e.g., "Insufficient stock: requested 50, available 12"
}
```

### 8.8 Processing Steps

```
Step 4.1 — Skill Lookup
  Map intent to skill(s) using SKILL_REGISTRY.
  If intent not found in registry: return empty results.

Step 4.2 — Skill Execution
  For each mapped skill:
    - Read required data from ContextPackage
    - Execute the pure function
    - Collect result (success or error)

Step 4.3 — Result Merge
  Merge all skill results into MergedSkillResults structure.
  If a skill fails, include error in merged results (do NOT fail the entire pipeline for non-critical skills).

Step 4.4 — Warning Collection
  Collect warnings from all skills. Categorize as:
    - info: Non-critical observations
    - warning: Important but not blocking
    - critical: Must be flagged to owner
```

### 8.9 Error Conditions

| Condition | Response |
|-----------|----------|
| All skills fail for a read intent | Error: `SKILLS_FAILED` — "Unable to analyze your business data. Please try again." |
| Action planner returns "blocked" status | Do NOT proceed to Stage 5. Return blockers to owner. Pipeline stops. |
| Skill execution throws unexpected error | Log error, skip that skill, continue with other skills |

---

## 9. Stage 5: Action Validation (Operation Requests Only)

### 9.1 Purpose

Validate an operation request before presenting it to the owner for confirmation. This stage catches errors before they reach the database.

### 9.2 Input

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage + MergedSkillResults (with action_plan)
```

### 9.3 Validation Checks (Executed in Order)

```
Check 5.1 — Entity Existence Validation
  Verify all resolved entities exist in Business Memory with active status.
  - Product: exists, not discontinued, has price
  - Customer: exists, not blocked
  - Supplier: exists, active
  - Staff: exists, active

Check 5.2 — Data Integrity Validation
  Verify all extracted values are valid:
  - Quantity > 0
  - Price > 0 (if provided)
  - Amount > 0
  - Date is valid ISO format or parseable relative date
  - Payment type is one of: "cash", "credit", "transfer", "online"

Check 5.3 — Business Logic Validation
  Action-specific business rules:
  - Sale: stock >= requested quantity
  - Sale (credit): customer outstanding + new amount <= customer credit limit
  - Purchase: no duplicate pending purchase for same product from same supplier
  - Expense: category exists in expense categories list
  - Task: no duplicate active task with same title
  - WhatsApp: recipient has a valid phone number

Check 5.4 — Safety Validation
  Warnings (non-blocking but flagged):
  - Sale to customer with overdue balance > 30 days
  - Sale at price significantly different from default (>20% variance)
  - Purchase from supplier with recent delivery issues
  - Expense in category with unusually high monthly spend
  - Batch operation affecting multiple records

Check 5.5 — Duplicate Detection
  Check for pending (unconfirmed) drafts of the same action type with the same entities.
  If found: warn owner about existing draft, offer to resume or create new.
```

### 9.4 Output

```
ValidationResult {
  status: "pass" | "warning" | "fail";

  checks: Array<{
    check_name: string;           // "entity_existence", "data_integrity", etc.
    status: "pass" | "warning" | "fail";
    message: string;
    details: string;
  }>;

  warnings: Array<{
    type: "safety" | "business_logic" | "duplicate";
    severity: "info" | "warning" | "critical";
    message: string;
  }>;

  errors: Array<{
    type: string;
    message: string;
    blocking: boolean;            // If true, pipeline stops
    resolution_hint: string;     // How owner can fix this
  }>;
}
```

### 9.5 Validation Rules

| Condition | Action |
|-----------|--------|
| Any blocking error | Pipeline stops. Return errors to owner with resolution hints. |
| Warnings present (no errors) | Status = "warning". Proceed to Stage 6. Warnings included in confirmation. |
| All checks pass | Status = "pass". Proceed to Stage 6. |

### 9.6 Error Conditions

| Condition | Response |
|-----------|----------|
| Insufficient stock for sale | Error: `INSUFFICIENT_STOCK` — "Only X units available. You requested Y." |
| Customer exceeds credit limit | Error: `CREDIT_LIMIT_EXCEEDED` — "Customer balance PKR X + new sale PKR Y exceeds limit PKR Z." |
| Product not found | Error: `ENTITY_NOT_FOUND` — "Product 'X' not found. Available products: [list top 5]." |

---

## 10. Stage 6: Permission Checks

### 10.1 Purpose

Verify that the request is permitted. In Phase 1 (owner-only), this is a simplified check. In future phases (staff access), this enforces role-based permissions.

### 10.2 Input

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage + MergedSkillResults + ValidationResult
```

### 10.3 Permission Levels

```
Level 1 — Read (Owner)
  Allowed: All read intents (health, analytics_*, forecast, kpi, reorder, recommendations, general_overview)
  Denied: None (owner reads everything)
  Check: Verify authenticated user is owner

Level 2 — Write (Owner)
  Allowed: All action commands, communication tasks, system controls
  Denied: Level 4 operations (see below)
  Check: Verify authenticated user is owner (always yes in Phase 1)

Level 3 — Sensitive Write (Owner)
  Allowed: With extra confirmation:
    - Void/cancel transactions
    - Modify prices or rates
    - Batch operations (>1 record)
    - Operations over PKR 100,000
  Check: Same as Level 2 + requires "confirm_sensitive" flag in confirmation

Level 4 — Never Allowed
  Prohibited operations for ALL users:
    - Delete/disable owner account
    - Remove staff members
    - Change owner credentials
    - Modify AI system prompts
    - Access other organizations' data
    - Delete audit logs
    - Bypass this execution protocol

Level 5 — Staff (Future)
  Allowed: Read intents scoped to staff permissions
  Denied: Write intents unless explicitly permitted by owner
  Check: Staff role, permissions, section access, spending limits
```

### 10.4 Phase 1 Implementation

Phase 1 is owner-only. Permission checks are:

```
Step 6.1 — Owner Verification
  Verify supabase.auth user is the organization owner.
  If not owner, check if AI access is enabled for this user (future).

Step 6.2 — Action Permission Check
  Verify the action type is not in the Level 4 (Never Allowed) list.
  All Level 1 and Level 2 actions are always allowed for the owner.

Step 6.3 — Sensitive Flag
  If action meets Level 3 criteria → set sensitive = true in confirmation.
```

### 10.5 Output

```
PermissionResult {
  permitted: boolean;
  level: "read" | "write" | "sensitive_write";
  sensitive: boolean;               // True if extra confirmation needed
  denied_reason: string | null;     // Only if permitted = false
}
```

### 10.6 Error Conditions

| Condition | Response |
|-----------|----------|
| Owner not authenticated | Error: `UNAUTHENTICATED` — handled at channel level before pipeline entry |
| Action is Level 4 (Never Allowed) | Error: `OPERATION_DENIED` — "This operation is not available through the AI assistant." |
| Staff tries write action (future) | Error: `PERMISSION_DENIED` — "You don't have permission to perform this action." |

---

## 11. Stage 7: Owner Confirmation (Operation Requests Only)

### 11.1 Purpose

Present the proposed action to the owner for explicit confirmation before execution. This is the safety gate — no write operation proceeds without the owner's explicit "yes".

### 11.2 Input

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage + MergedSkillResults + ValidationResult + PermissionResult
```

### 11.3 Confirmation Presentation

The confirmation is presented to the owner as a structured card containing:

```
┌─────────────────────────────────────────────────────────────┐
│  🔧 CONFIRM ACTION                                           │
│                                                              │
│  Action: Create Sale                                          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Draft Summary                                           │ │
│  │                                                          │ │
│  │  Product:     Pepsi 500ml  × 5  @ PKR 130 = PKR 650     │ │
│  │  Customer:    Usman General Store                        │ │
│  │  Payment:     Cash                                       │ │
│  │  Total:       PKR 650                                    │ │
│  │                                                          │ │
│  │  Status:      ✅ Ready to execute                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ⚠️ Warnings:                                                 │
│  • Customer has overdue balance of PKR 25,000 (45 days)      │
│                                                              │
│  [✅ Execute]  [✏️ Modify]  [❌ Cancel]                      │
└─────────────────────────────────────────────────────────────┘
```

### 11.4 Confirmation Options

```
Option 1 — Execute ("Yes")
  Owner confirms the action as presented.
  Pipeline proceeds to Stage 8 (Execution).

Option 2 — Modify ("Modify")
  Owner wants to change something.
  Owner provides updated text → pipeline restarts at Stage 0 with new text.
  Original draft is preserved for reference.

Option 3 — Cancel ("No")
  Owner rejects the action.
  Pipeline stops. Draft marked as "cancelled" in audit log.
  Response: "Cancelled. Let me know if you need anything else."

Option 4 — Clarify ("What does this mean?")
  Owner asks for more detail about the draft.
  Language Engine generates explanation from the action plan steps.
  After explanation, present the same confirmation options again.

Option 5 — Timeout
  Owner does not respond within 5 minutes.
  Draft status set to "pending".
  Response: "This draft is saved. Come back to confirm or cancel it anytime."
```

### 11.5 Sensitive Operation Confirmation

For Level 3 (Sensitive) operations, the confirmation includes:

```
  🔴 SENSITIVE OPERATION
  • Action affects multiple records (3 purchase orders)
  • Total amount: PKR 350,000
  • This action cannot be automatically reversed.

  Type "CONFIRM" to proceed, or "CANCEL" to cancel.
```

### 11.6 Output

```
ConfirmationResult {
  decision: "execute" | "modify" | "cancel" | "clarify" | "timeout";
  modification_text: string | null;    // Only if decision = "modify"
  confirmed_at: string | null;         // ISO timestamp of confirmation
  sensitive_acknowledged: boolean;     // True if sensitive operation was confirmed
}
```

### 11.7 Error Conditions

| Condition | Response |
|-----------|----------|
| Owner cancels | Pipeline stops gracefully. Log: "Owner cancelled [action_type]" |
| Owner modifies | Pipeline restarts from Stage 0 with modification text |
| Timeout | Draft saved as "pending". Pipeline stops. |

---

## 12. Stage 8: Execution (Operation Requests Only)

### 12.1 Purpose

Execute the confirmed action. Write to the database or call external APIs. This is the only stage that changes business state.

### 12.2 Input

```
NormalizedRequest + IntentResult + EntityResult + ContextPackage + MergedSkillResults + ValidationResult + PermissionResult + ConfirmationResult (decision = "execute")
```

### 12.3 Executor Contract

The Executor is the **only component** that may write to the database or call external APIs. It must:

```typescript
interface Executor {
  execute(action: ExecutableAction): Promise<ExecutionResult>;
}

interface ExecutableAction {
  action_type: string;
  resolved_entities: EntityResult;
  action_plan: ActionPlanResult;
  validation: ValidationResult;
  permission: PermissionResult;
  confirmation: ConfirmationResult;
  context: ContextPackage;
}

interface ExecutionResult {
  success: boolean;
  operation: string;              // e.g., "create_sale"
  entity_type: string;            // e.g., "sales_transaction"
  entity_id: string | null;       // Created record ID
  entity_reference: string | null; // Invoice number, order number, etc.
  details: string;                // Human-readable summary
  error: ExecutionError | null;

  // Post-execution state
  affected_records: Array<{ table: string; id: string; action: "insert" | "update" }>;
  memory_invalidation: string[];  // Memory sections that need refresh
}
```

### 12.4 Execution Rules

```
Rule EX1 — Transactional: All writes within a single execution must be atomic (all succeed or all fail).
Rule EX2 — Idempotent: If the same confirmation is received twice (e.g., double-click), the second execution is rejected with "Already executed".
Rule EX3 — Auditable: Every write is logged before and after execution.
Rule EX4 — Reversible: The executor logs sufficient information for the Auditor to determine if a reversal is needed.
Rule EX5 — Non-blocking: DB writes should complete within 500ms. If they take longer, the pipeline returns "executing" status and completes asynchronously.
```

### 12.5 Supported Operations

```
┌──────────────────────┬───────────────────────────────────────┬────────────────────┐
│ Action Type          │ Database Operation                   │ Tables Affected    │
├──────────────────────┼───────────────────────────────────────┼────────────────────┤
│ action_sale          │ Insert sale + items, update stock     │ sales_transactions,│
│                      │                                       │ sales_items,       │
│                      │                                       │ products (stock)   │
│ action_purchase      │ Insert purchase + items, update stock │ purchase_transactions│
│                      │                                       │ purchase_items,    │
│                      │                                       │ products (stock)   │
│ action_expense       │ Insert expense                        │ expenses           │
│ action_task          │ Insert task                           │ tasks              │
│ action_customer      │ Insert customer                       │ customers          │
│ action_supplier      │ Insert supplier                       │ suppliers          │
│ action_product       │ Insert product                        │ products           │
│ send_whatsapp        │ Call WhatsApp Cloud API               │ (external API)     │
│ void_transaction     │ Update transaction status, audit log  │ sales_transactions,│
│                      │                                       │ audit_logs         │
└──────────────────────┴───────────────────────────────────────┴────────────────────┘
```

### 12.6 Output

```
ExecutionResult {
  request_id: string;
  success: boolean;
  transaction_id: string | null;         // Database transaction ID
  created_records: Array<{
    entity_type: string;
    entity_id: string;
    reference: string;                   // Invoice number, receipt, etc.
  }>;
  error: {
    code: string;
    message: string;
    details: string;
  } | null;
  memory_stale_sections: string[];       // Sections of memory that need refresh
  execution_time_ms: number;
}
```

### 12.7 Error Conditions

| Condition | Response |
|-----------|----------|
| Database write fails | Error: `EXECUTION_FAILED` — "The operation could not be completed. The database returned an error. Your draft is saved — try again." |
| WhatsApp API fails | Error: `API_FAILED` — "Message could not be sent. WhatsApp API error. Draft saved — retry from conversation." |
| Duplicate execution detected | Error: `ALREADY_EXECUTED` — "This action has already been executed. [Reference: INV-2026-0715]." |
| Timeout (>5s) | Return "pending" status. Execution continues asynchronously. Notify owner on completion. |

---

## 13. Stage 9: Response Generation

### 13.1 Purpose

Convert structured skill results and execution outcomes into a natural language response in the owner's language, with optional charts and tables.

### 13.2 Input

Read Pipeline:
```
NormalizedRequest + IntentResult + EntityResult + ContextPackage + MergedSkillResults
```

Write Pipeline:
```
Above + ValidationResult + PermissionResult + ConfirmationResult (if skipped = null) + ExecutionResult (if skip = null)
```

### 13.3 Processing Steps

```
Step 9.1 — LLM Response Generation
  Send to Language Engine (LLM, temperature=0.3):
    - Language: {language} from Stage 0
    - Skill results (structured data)
    - Business summary (from ContextPackage)
    - Conversation history (last 3 exchanges)
    - Execution result (if write pipeline)
    - Generation prompt constraints

  LLM output: Natural language text.

Step 9.2 — Response Former Assembly
  Deterministic assembly of the final response:
    - text: LLM-generated natural language
    - key_points: Extracted from skill results (e.g., health score reasons, top recommendations)
    - warnings: From validation (if write pipeline) or skill warnings
    - chart_data: From skill results if visualization is relevant
    - table_data: From skill results if structured data presentation is better
    - action_result: Execution confirmation (if write pipeline)
    - suggested_questions: From Learning Engine (based on current intent + frequency)

Step 9.3 — Content Type Selection
  Choose the best presentation format based on intent and data:
    - health → text + score gauge
    - analytics_sales → text + bar chart + table of top products
    - analytics_inventory → text + status indicators + table
    - analytics_customers → text + table (sorted by balance)
    - analytics_expenses → text + pie chart categories
    - forecast → text + line chart
    - kpi → text + metric cards grid
    - recommendations → text + priority-ordered list
    - action_* (confirmed) → text + action confirmation card
    - action_* (cancelled) → text + confirmation of cancellation
    - communication → text + delivery confirmation
    - system → text + system status
    - greeting/farewell → text only
```

### 13.4 Response Structure

```typescript
interface UnifiedResponse {
  request_id: string;

  // Primary content
  text: string;                              // LLM-generated natural language
  language: "english" | "urdu" | "roman_urdu";

  // Structured data (for rich rendering)
  key_points: string[];                      // Bullet-point highlights
  warnings: string[];                        // From validation or skills
  chart_data: ChartData | null;              // For visualization
  table_data: TableData | null;              // For structured display
  action_result: {
    executed: boolean;
    draft_summary: string | null;
    reference: string | null;                // Invoice number, etc.
  } | null;

  // Next steps
  suggested_questions: string[];             // From Learning Engine

  // Metadata
  metadata: {
    intent: string;
    pipeline_mode: "read" | "write";
    skills_invoked: string[];
    total_stages_completed: number;
    total_execution_time_ms: number;
    llm_provider: string;
    llm_model: string;
    llm_latency_ms: number;
    memory_age_ms: number;
  };
}

interface ChartData {
  type: "bar" | "line" | "pie" | "metric";
  title: string;
  labels: string[];
  datasets: Array<{
    label: string;
    values: number[];
    color?: string;
  }>;
}

interface TableData {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number>>;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}
```

### 13.5 Generation Prompt Constraints

The Language Engine prompt for response generation enforces these rules:

```
1. Write ONLY what the data says. Do not add information.
2. Do NOT calculate anything. Use only the numbers provided in skill results.
3. Do NOT give business advice unless the skill results explicitly contain recommendations.
4. Format money values as "PKR X,XXX" (Pakistani Rupees).
5. Match the owner's language: {language}.
6. If the owner asked in Roman Urdu, respond in Roman Urdu.
7. Keep responses concise. One paragraph for simple questions, up to three for complex analysis.
8. When presenting numbers, use bullet points for clarity.
9. If data is insufficient for a complete answer, say so honestly.
10. For health score, always include the score number and label.
```

### 13.6 Error Conditions

| Condition | Response |
|-----------|----------|
| LLM generation fails | Fallback: deterministic template-based response from skill results (no LLM). Warnings included. |
| LLM returns empty text | Regenerate once. If still empty, use template fallback. |

---

## 14. Stage 10: Audit Logging

### 14.1 Purpose

Record every request, every stage decision, and every execution outcome in an immutable audit trail.

### 14.2 What Is Logged

Every stage output is logged with its full content. The audit entry captures:

```typescript
interface AuditEntry {
  id: string;                          // UUID
  request_id: string;                  // Links all stages of one request
  organization_id: string;
  user_id: string;                     // owner or staff ID
  channel: "in_app" | "voice" | "whatsapp";
  timestamp: string;                   // ISO 8601

  // Input
  original_input: string;              // Raw owner text
  normalized_input: string;            // After Stage 0 normalization
  detected_language: string;

  // Classification
  intent: string;
  intent_confidence: number;
  pipeline_mode: "read" | "write";

  // Entities (if extracted)
  resolved_entities: EntityResult | null;

  // Skills
  invoked_skills: Array<{ name: string; version: string; execution_time_ms: number }>;

  // Validation (write pipeline)
  validation_result: ValidationResult | null;

  // Permission
  permission_result: PermissionResult | null;

  // Confirmation
  confirmation_decision: string | null;  // "execute" | "modify" | "cancel" | null
  confirmation_time: string | null;

  // Execution (write pipeline)
  execution_result: ExecutionResult | null;

  // Response
  response_summary: string;             // First 200 chars of response text
  response_has_chart: boolean;
  response_has_table: boolean;

  // Performance
  total_duration_ms: number;
  stages: Array<{
    name: string;
    duration_ms: number;
    success: boolean;
    error?: string;
  }>;

  // Environment
  memory_age_ms: number;
  memory_refresh_triggered: boolean;
}
```

### 14.3 Audit Storage

```
Table: audit_logs (existing, extended)

Columns:
  id              uuid PK
  organization_id uuid FK
  profile_id      uuid FK
  action_type     text           ← AI-specific action type prefix: "ai_<intent>"
  entity_type     text           ← "ai_request"
  entity_id       text           ← request_id (generated at Stage 0)
  details         jsonb          ← Full AuditEntry (above)
  created_at      timestamptz

Indexes:
  (organization_id, created_at DESC)   ← For owner audit review
  (request_id, organization_id)        ← For single-request lookup
  (action_type, organization_id)       ← For usage analysis
```

### 14.4 Audit Rules

```
Rule A1 — Append-only: Audit entries are never modified or deleted.
Rule A2 — Every request generates exactly one audit entry (after Stage 11 completes).
Rule A3 — Partial entries are written if pipeline fails mid-way (for failure analysis).
Rule A4 — Audit entries are accessible to the owner via a future audit dashboard.
Rule A5 — Audit retention: minimum 2 years. Archival strategy defined in Enterprise Scaling.
```

### 14.5 Output

```
AuditRecord {
  entry_id: string;
  request_id: string;
  logged_at: string;
}
```

### 14.6 Error Conditions

| Condition | Response |
|-----------|----------|
| Audit DB write fails | Log to console.error. Critical issue — alert operations team. Do NOT block the response from reaching the owner. |

---

## 15. Stage 11: Learning & Memory Update

### 15.1 Purpose

Learn from the request and update Business Memory and owner preferences. This stage runs asynchronously and does not block the response.

### 15.2 Processing Steps

```
Step 11.1 — Question Pattern Recording
  Learning Engine records:
    - Question text (normalized)
    - Classified intent
    - Skills invoked
    - Whether the response was used (owner asked a follow-up? clicked a suggestion?)
    - Frequency counter for this intent/topic

Step 11.2 — Preference Update
  Implicit learning:
    - If owner consistently asks about "this month" → update preferred_period to "month"
    - If owner ignores a recommendation type 3+ times → add to ignored_recommendation_types
    - If owner rephrases a question → learn the phrasing pattern

  Explicit learning:
    - If owner says "always use Supplier X for Y" → store explicit preference
    - (Phase 1: explicit learning is manual via learn_preference intent)

Step 11.3 — Suggested Questions Update
  Update the ranked list of suggested questions:
    - Top questions by frequency (across all sessions)
    - Recent questions (last 7 days)
    - Current context-relevant questions (based on memory state)
    - Remove suggestions that match ignored_recommendation_types

Step 11.4 — Memory Freshness Check
  Check if memory needs refresh:
    - If memory is > 30 minutes old → trigger background refresh
    - If execution modified business state → mark affected sections for refresh
    - If no changes → no action

Step 11.5 — Scheduled Tasks Check (Future)
  Check if any scheduled tasks, reminders, or alerts need to be triggered.
  (Phase 1: skip this step.)
```

### 15.3 Output

```typescript
interface LearningResult {
  preferences_updated: boolean;
  updated_preferences: Array<{ key: string; value: unknown }>;
  suggested_questions_updated: boolean;
  memory_refresh_triggered: boolean;
  memory_stale_sections: string[];
}
```

### 15.4 Error Conditions

| Condition | Response |
|-----------|----------|
| Learning Engine write fails | Log warning. Non-critical. Do not impact response delivery. |
| Memory refresh fails | Log warning. Memory will be refreshed on next page load. |

---

## 16. Error Handling

### 16.1 Error Taxonomy

All errors flowing through the pipeline use a standard structure:

```typescript
interface PipelineError {
  code: string;                          // Machine-readable error code
  message: string;                       // Human-readable, owner-facing message
  detail: string;                        // Technical detail (logged, not shown to owner)
  stage: string;                         // Which stage produced the error
  severity: "info" | "warning" | "error" | "critical";
  recoverable: boolean;                  // Can the owner retry?
  resolution_hint: string;               // What the owner can do
}
```

### 16.2 Error Codes

```
Category: Input
  EMPTY_INPUT           → Text is empty after normalization
  RATE_LIMITED          → Too many requests

Category: Classification
  UNCLASSIFIABLE        → Intent could not be determined
  LOW_CONFIDENCE        → Intent confidence below threshold

Category: Entity
  ENTITIES_UNRESOLVED   → Required entities not found in memory
  ENTITIES_AMBIGUOUS    → Multiple entities matched, needs clarification
  MISSING_REQUIRED_FIELD → Required field not provided

Category: Memory
  MEMORY_EMPTY          → Business Memory not yet populated
  MEMORY_STALE          → Data may be outdated (warning only)
  SECTION_NOT_FOUND     → Requested data section not in memory

Category: Skills
  SKILLS_FAILED         → All skills failed for the intent
  SKILL_ERROR           → Individual skill execution error
  ACTION_BLOCKED        → Action planner found blockers

Category: Validation
  INSUFFICIENT_STOCK    → Not enough stock for sale
  CREDIT_LIMIT_EXCEEDED → Customer would exceed credit limit
  ENTITY_NOT_FOUND      → Referenced entity does not exist
  INVALID_VALUE         → Field value fails integrity check
  DUPLICATE_DRAFT       → Similar pending draft exists

Category: Permission
  UNAUTHENTICATED       → User not logged in
  PERMISSION_DENIED     → User lacks permission for this action
  OPERATION_DENIED      → Operation is Level 4 (Never Allowed)

Category: Execution
  EXECUTION_FAILED      → Database write or API call failed
  ALREADY_EXECUTED      → Duplicate execution attempt
  API_FAILED            → External API (WhatsApp, etc.) failed

Category: LLM
  LLM_UNAVAILABLE       → AI provider returned error or timed out
  LLM_INVALID_RESPONSE  → AI provider returned malformed response
  LLM_RATE_LIMITED      → AI provider rate limit hit

Category: System
  INTERNAL_ERROR        → Unexpected system error
  TIMEOUT               → Pipeline exceeded maximum execution time
```

### 16.3 Error Recovery Strategy

```
Step 1 — Catch
  Each stage catches its own errors. Errors are wrapped in PipelineError with stage attribution.

Step 2 — Classify
  - recoverable: Owner can retry (rate limit, LLM timeout, stock insufficient)
  - non-recoverable: Owner cannot fix (internal error, entity not found)

Step 3 — Respond
  For recoverable errors: Return error message with resolution_hint.
  For non-recoverable errors: Return error message with "Please contact support" + error code.

Step 4 — Log
  Full error with stack trace is logged to audit system (not shown to owner).

Step 5 — Cleanup
  Any partial state (pending drafts, partial DB writes in failed transactions) is cleaned up.

Pipeline rules:
  - A single stage failure stops the entire pipeline.
  - No partial execution: If Stage 8 (Execution) starts but fails mid-transaction, the transaction is rolled back.
  - The owner receives exactly one response per request (error or success, never both).
```

### 16.4 Owner-Facing Error Messages

```
"Please wait a moment before sending another request."
  → RATE_LIMITED, recoverable

"Sorry, I didn't understand that. Could you rephrase?"
  → UNCLASSIFIABLE, recoverable

"Did you mean one of these? [Pepsi 500ml, Pepsi 1.5L, Pepsi 2.25L]"
  → ENTITIES_AMBIGUOUS, recoverable

"I can't find the product 'X' in your inventory. Check the name and try again."
  → ENTITY_NOT_FOUND, non-recoverable

"Not enough stock. You have 12 units of Pepsi 500ml but requested 50."
  → INSUFFICIENT_STOCK, recoverable

"Sorry, I'm having trouble connecting. Please try again."
  → LLM_UNAVAILABLE, recoverable

"Something went wrong. [Error code: E-XXXXX]. Please try again or contact support."
  → INTERNAL_ERROR, non-recoverable
```

---

## 17. Channel-Specific Adaptations

### 17.1 In-App (Text)

**Entry point**: `useAiConversation.send(question)` → `orchestrator.process()`

**Adaptations**:
- Full 12-stage pipeline as documented
- Rich UI rendering (text + charts + tables + action cards)
- Confirmation via button click (Execute / Modify / Cancel)
- Suggested questions rendered as clickable chips

### 17.2 Voice

**Entry point**: Speech → STT → text → `orchestrator.process()` → text → TTS → speech

**Adaptations**:
- Stage 0 includes STT confidence in metadata
- Stage 9 output goes through TTS (text summary only — no charts/tables)
- Confirmation via voice: "Execute? Say yes or no."
- Sensitive operations require verbal confirmation: "Say 'I confirm' to proceed."
- Suggested questions spoken as options: "You can ask: 'How are my sales?' or 'What should I reorder?'"
- Language detection from audio language hint + STT output language

**TTS-specific constraints on generated text**:
- Replace symbols with words ("PKR 1,500" → "one thousand five hundred rupees")
- Avoid chart descriptions (not useful in audio)
- Keep sentences shorter and more conversational
- Number items as "First... Second... Third..." rather than bullet points

### 17.3 WhatsApp

**Entry point**: Meta webhook → Webhook handler → `orchestrator.process()` → response → WhatsApp API

**Adaptations**:
- Stage 0: Sender phone resolved to customer/supplier/owner via WhatsApp contact resolution
- Stage 0: Message type (text/image/document) logged in metadata
- Stage 7: Confirmation via WhatsApp interactive buttons (if available) or text reply
  - "Reply with 1 to execute, 2 to cancel, or type your changes"
- Stage 9: Response formatted for WhatsApp (max 1024 chars per message, no charts/tables)
  - Long responses split into multiple messages
  - Key points sent as separate messages with bullet prefixes
  - Action confirmations include reference numbers
- Stage 11: No suggested questions (WhatsApp is transactional)

**WhatsApp-specific constraints**:
- Response must fit within WhatsApp's message limits
- No rich formatting (no charts, no tables, text-only)
- Use emoji sparingly for visual cues: ✅ ❌ ⚠️ 📊
- Support for interactive list menus for confirmations

### 17.4 Future MCP

**Entry point**: External tool → MCP server → `orchestrator.process()` → MCP response

**Adaptations**:
- Defined when MCP integration is designed
- Must conform to this protocol's pipeline
- Channel metadata includes MCP server identifier and tool name

---

## 18. Protocol Enforcement

### 18.1 Automated Enforcement

- **Pipeline mode**: The orchestrator must verify pipeline mode before routing. A "read" request that reaches Stage 5 is a protocol violation.
- **Stage ordering**: Each stage validates its predecessor completed. If Stage 3 input is received without Stage 2 output, the pipeline rejects with `PROTOCOL_VIOLATION`.
- **LLM boundary**: The Language Engine wrapper enforces that LLM responses for intent classification match the expected JSON schema. Any deviation is rejected.
- **Executor isolation**: Only the Executor module has access to database write functions. If any other module attempts a write, it is blocked at the Supabase RLS level.

### 18.2 Manual Enforcement

- **Architecture review**: Every new channel integration (voice provider, WhatsApp, MCP server) must pass a protocol compliance review before deployment.
- **Code review**: Every pull request touching the orchestrator, executor, or any pipeline stage must reference this protocol.
- **Exception process**: Exceptions to this protocol require:
  1. Written rationale
  2. Architectural review sign-off
  3. Documented exception in this file's version history
  4. Time-bound validity (exceptions expire)

### 18.3 Testing Requirements

Every pipeline stage must have tests that verify:

```
Stage 0: Input normalization, language detection, rate limit enforcement
Stage 1: Intent classification accuracy, fallback behavior, confidence thresholds
Stage 2: Entity extraction, fuzzy matching, ambiguity detection, missing field detection
Stage 3: Context scoping, token budget enforcement, memory staleness handling
Stage 4: Skill execution, multi-skill merge, error propagation
Stage 5: Validation rules (stock, credit, integrity), duplicate detection
Stage 6: Permission levels, sensitive operation detection
Stage 7: Confirmation flow (execute/modify/cancel/timeout), sensitive confirmation
Stage 8: Transactional execution, idempotency, error rollback
Stage 9: Response assembly, content type selection, LLM fallback
Stage 10: Audit fields completeness, append-only behavior
Stage 11: Preference learning, suggested questions ranking, memory refresh triggers
```

Integration tests must verify:
- End-to-end read pipeline (all stages 0–4, 9–11)
- End-to-end write pipeline (all 12 stages)
- Error recovery at every stage
- Channel-specific adaptations

---

## Appendix A: Quick Reference — Stage Summary

```
Stage  Name                 Input                          Output
─────  ───────────────────  ────────────────────────────  ─────────────────────────────
  0    Input Reception      Raw channel input             NormalizedRequest
  1    Intent Classification NormalizedRequest             IntentResult
  2    Entity Extraction     Request + IntentResult        EntityResult
  3    Context Retrieval     Request + IntentResult +      ContextPackage
                              EntityResult
  4    Skills Execution      Request + Intent + Entity +   MergedSkillResults
                              Context
  5    Validation (write)    Merged + Validation/Permission ValidationResult
  6    Permission Check      ValidationResult              PermissionResult
  7    Owner Confirmation    PermissionResult              ConfirmationResult
  8    Execution (write)     ConfirmationResult            ExecutionResult
  9    Response Generation   All prior stage outputs       UnifiedResponse
 10    Audit Logging         UnifiedResponse + all stages  AuditRecord
 11    Learning & Memory     AuditRecord                   LearningResult
```

## Appendix B: Pipeline Mode Decision Matrix

```
Intent                  Pipeline    Stages 5-8   LLM Role
──────────────────────  ──────────  ───────────  ──────────────────────────────
health                  read        skip         generate only
analytics_*             read        skip         generate only
forecast                read        skip         generate only
kpi                     read        skip         generate only
reorder                 read        skip         generate only
recommendations         read        skip         generate only
general_overview        read        skip         generate only
action_*                write       execute      classify + extract + generate
communication           write       execute      classify + extract + generate
system (state-change)   write       execute      classify + extract + generate
system (no change)      read        skip         generate only
greeting/farewell       read        skip         skip LLM (canned response)
casual                  read        skip         generate only
unknown                 read        skip         generate only
```

## Appendix C: Protocol Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-29 | Chief AI Architect | Initial execution protocol — defines the permanent, immutable pipeline for all AI requests |

---

*This document defines the immutable execution protocol for TradeOS AI. Every AI request — text, voice, WhatsApp, or future MCP — must conform to this pipeline. No future provider, channel, or integration may bypass, reorder, or shortcut any stage. Exceptions require documented architectural review.*
