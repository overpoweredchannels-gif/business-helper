# TradeOS AI — API Contract Specification

> **Version**: 1.0  
> **Status**: Immutable Communication Contract  
> **Scope**: Every request, response, DTO, event, and error format across all TradeOS AI modules  
> **Applicable To**: Business Brain, Business Memory, Business Skills, Provider Router, Voice, WhatsApp, Future MCP, Dashboard, and every future integration

---

## Table of Contents

1. [Contract Philosophy](#1-contract-philosophy)
2. [Naming Conventions](#2-naming-conventions)
3. [Versioning Strategy](#3-versioning-strategy)
4. [Standard Envelope](#4-standard-envelope)
5. [Error Contract](#5-error-contract)
6. [Event Contract](#6-event-contract)
7. [Internal API: Orchestrator](#7-internal-api-orchestrator)
8. [Internal API: Language Engine](#8-internal-api-language-engine)
9. [Internal API: Business Memory](#9-internal-api-business-memory)
10. [Internal API: Business Skills](#10-internal-api-business-skills)
11. [Internal API: Learning Engine](#11-internal-api-learning-engine)
12. [External API: AI Query (POST /api/ai-business-query)](#12-external-api-ai-query)
13. [External API: AI Assistant (POST /api/brain/chat)](#13-external-api-ai-assistant)
14. [External API: Voice (POST /api/brain/voice)](#14-external-api-voice)
15. [External API: WhatsApp Webhook (POST /api/brain/whatsapp)](#15-external-api-whatsapp-webhook)
16. [External API: Memory Debug (GET /api/brain/context)](#16-external-api-memory-debug)
17. [Provider Router Contract](#17-provider-router-contract)
18. [Dashboard → Brain Integration Contract](#18-dashboard--brain-integration-contract)
19. [Future MCP Integration Contract](#19-future-mcp-integration-contract)
20. [JSON Schemas](#20-json-schemas)

---

## 1. Contract Philosophy

### 1.1 Purpose

This document defines the **immutable communication contracts** between every module in the TradeOS AI system. Every internal and external interface must conform to these shapes. No module may introduce a new communication format without updating this contract.

### 1.2 Design Principles

1. **Envelope-first**: Every message (request or response) wraps in a standard envelope with `ok`, `requestId`, and `timestamp`.
2. **Type-safe**: All contracts are defined as TypeScript types with strict null handling.
3. **Backward-compatible**: Fields may be added (optional, never required). Fields may never be removed or renamed.
4. **Self-describing**: Every response includes `_meta` with provider, model, latency, and version info.
5. **Error is a type, not an exception**: Errors are returned as structured data matching the error contract, not thrown.
6. **JSON-only**: All communication is JSON. No XML, no form data, no custom serialization.

### 1.3 Contract Binding

- **Breaking changes** (field removal, type change, required→optional reversal): Require a major version bump and a migration period.
- **Non-breaking changes** (new optional field, new enum value): Allowed at any time. Must be documented.
- **Every module** must validate incoming messages against the contract. Unknown fields are ignored (never rejected).

---

## 2. Naming Conventions

### 2.1 General Rules

```
Entities:                    PascalCase       →  CustomerMemory, SalesAnalyticsResult
Properties:                  camelCase        →  totalRevenue, invoiceCount
Enums:                       PascalCase       →  IntentType, PipelineMode
Enum values:                 snake_case       →  "analytics_sales", "action_sale"
JSON field names:            camelCase        →  "requestId", "totalAmount"
File names (typescript):     kebab-case       →  "business-memory.ts", "provider-router.ts"
API routes:                  kebab-case       →  "/api/brain/chat", "/api/brain/voice"
Event names:                 past_tense      →  "memory_refreshed", "action_executed"
Error codes:                 SCREAMING_SNAKE →  "INSUFFICIENT_STOCK", "LLM_UNAVAILABLE"
```

### 2.2 Prefix Conventions

```
Internal Brain types:        No prefix         →  OrchestratorInput, IntentResult
External API types:          "Api" prefix      →  ApiChatRequest, ApiChatResponse
Database types:              "Db" prefix       →  DbConversation, DbMessage
Event types:                 "Event" suffix    →  ActionExecutedEvent, MemoryRefreshedEvent
Error types:                 "Error" suffix    →  PipelineError, ValidationError
Configuration types:         "Config" suffix   →  BrainConfig, ProviderConfig
```

### 2.3 File Organization

```
src/
└── lib/
    └── brain/
        ├── contracts/
        │   ├── index.ts              ← Barrel exports
        │   ├── common.ts              ← StandardEnvelope, PipelineError, shared enums
        │   ├── orchestrator.ts        ← OrchestratorInput, OrchestratorResponse
        │   ├── language-engine.ts     ← LanguageEngineInput, LanguageEngineOutput
        │   ├── memory.ts              ← MemoryReadRequest, MemoryReadResponse
        │   ├── skills.ts              ← SkillInput, SkillResult (generic)
        │   ├── learning.ts            ← LearningInput, LearningResult
        │   ├── provider-router.ts     ← RouterInput, RouterResult
        │   ├── external.ts            ← ApiChatRequest, ApiChatResponse, ApiVoiceRequest
        │   ├── events.ts              ← All event types
        │   ├── errors.ts              ← Error catalog
        │   └── schemas.ts             ← JSON Schema constants
```

---

## 3. Versioning Strategy

### 3.1 API Versioning

External APIs use **header-based versioning**:

```
Request header:  Accept-Version: v1
Response header: X-Api-Version: v1
```

- Version is optional. Default is latest stable.
- Deprecated versions remain available for 90 days after replacement.
- Version changes are documented in the changelog.

### 3.2 Contract Versioning

```
Each contract interface carries a version tag:

interface StandardEnvelope {
  contractVersion: string;     // "1.0" — SemVer of this contract
  // ...
}
```

- Major version change: Breaking schema change (field removed, type changed).
- Minor version change: New optional field, new enum variant.
- Patch version change: Documentation fix, clarified constraint.

### 3.3 Provider Router Versioning

```
The provider-router does NOT version its internal API.
All provider integrations (Gemini, OpenAI, Groq, xAI, ZAI) conform to:
  - Input: RouterInput (stable)
  - Output: RouterResult (stable)

New providers add models to existing enums. No contract change.
```

### 3.4 Schema Enforcement

```
Every in-memory contract has a schemaVersion number:

interface MemoryStore {
  schemaVersion: number;      // Incremented on memory structure changes
  // ...
}

When schemaVersion changes:
  - Old-format memory is migrated on next page load.
  - Phase 1: No persistence, no migration needed.
  - Phase 6: DB rows tagged with schemaVersion for migration.
```

---

## 4. Standard Envelope

### 4.1 Request Envelope

```typescript
interface StandardRequest {
  requestId: string;              // UUID v4 — traces through all stages
  timestamp: string;              // ISO 8601 — when the request was created
  organizationId: string;         // Tenant isolation key
  profileId: string;              // User (owner or staff)
  channel: Channel;               // Where this request originated
  contractVersion: string;        // "1.0"
  idempotencyKey?: string;        // For write operations — prevents duplicates
}

type Channel = "in_app" | "voice" | "whatsapp" | "mcp" | "system";
```

### 4.2 Response Envelope

```typescript
interface StandardResponse<T> {
  ok: boolean;
  requestId: string;              // Echoes the request ID
  timestamp: string;              // ISO 8601
  durationMs: number;             // Total processing time
  contractVersion: string;        // "1.0"

  // Success
  data?: T;

  // Error
  error?: PipelineError;

  // Metadata — always present
  _meta: {
    pipelineMode: PipelineMode;
    stagesCompleted: number;
    memoryAgeMs: number;
    memoryConfidence: MemoryConfidenceLabel;
    provider: string | null;       // LLM provider used (null if no LLM call)
    model: string | null;          // LLM model used (null if no LLM call)
    llmLatencyMs: number | null;
    totalTokenEstimate: number;
    warnings: string[];
  };
}

type PipelineMode = "read" | "write";
type MemoryConfidenceLabel = "high" | "medium" | "low" | "unreliable";
```

### 4.3 JSON Examples

```json
// Successful response (read pipeline)
{
  "ok": true,
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-07-29T10:30:00.000Z",
  "durationMs": 847,
  "contractVersion": "1.0",
  "data": { ... },
  "_meta": {
    "pipelineMode": "read",
    "stagesCompleted": 7,
    "memoryAgeMs": 45000,
    "memoryConfidence": "high",
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "llmLatencyMs": 320,
    "totalTokenEstimate": 1450,
    "warnings": []
  }
}

// Error response
{
  "ok": false,
  "requestId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "timestamp": "2026-07-29T10:31:00.000Z",
  "durationMs": 203,
  "contractVersion": "1.0",
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock. You have 12 units of Pepsi 500ml but requested 50.",
    "detail": "Product 'Pepsi 500ml' (id: prod-789): currentStock=12, requested=50",
    "stage": "validation",
    "severity": "error",
    "recoverable": true,
    "resolutionHint": "Reduce the quantity or check other products."
  },
  "_meta": {
    "pipelineMode": "write",
    "stagesCompleted": 5,
    "memoryAgeMs": 120000,
    "memoryConfidence": "high",
    "provider": null,
    "model": null,
    "llmLatencyMs": null,
    "totalTokenEstimate": 0,
    "warnings": []
  }
}
```

---

## 5. Error Contract

### 5.1 Error Structure

```typescript
interface PipelineError {
  code: ErrorCode;                // Machine-readable
  message: string;                // Owner-facing (max 200 chars)
  detail: string;                 // Technical detail (logged, not shown)
  stage: StageName;               // Which pipeline stage produced the error
  severity: "info" | "warning" | "error" | "critical";
  recoverable: boolean;           // Can the owner retry/fix?
  resolutionHint: string | null;  // What the owner can do
  source: "input" | "classification" | "entity" | "memory"
       | "skill" | "validation" | "permission" | "execution"
       | "llm" | "system";
  internalCode: string | null;    // Provider-specific error code (e.g., "429 Too Many Requests")
}

type StageName =
  | "input_reception"
  | "intent_classification"
  | "entity_extraction"
  | "context_retrieval"
  | "skill_execution"
  | "validation"
  | "permission_check"
  | "confirmation"
  | "execution"
  | "response_generation"
  | "audit"
  | "learning";

type ErrorCode =
  // Input (E0001–E0099)
  | "EMPTY_INPUT"                  // E0001
  | "RATE_LIMITED"                // E0002
  | "INPUT_TOO_LONG"              // E0003

  // Classification (E0100–E0199)
  | "UNCLASSIFIABLE"              // E0100
  | "LOW_CONFIDENCE"              // E0101

  // Entity (E0200–E0299)
  | "ENTITIES_UNRESOLVED"         // E0200
  | "ENTITIES_AMBIGUOUS"          // E0201
  | "MISSING_REQUIRED_FIELD"      // E0202
  | "ENTITY_NOT_FOUND"            // E0203

  // Memory (E0300–E0399)
  | "MEMORY_EMPTY"                // E0300
  | "MEMORY_STALE"               // E0301 (warning only)
  | "MEMORY_SECTION_NOT_FOUND"    // E0302

  // Skills (E0400–E0499)
  | "SKILLS_FAILED"               // E0400
  | "SKILL_ERROR"                 // E0401
  | "ACTION_BLOCKED"              // E0402

  // Validation (E0500–E0599)
  | "INSUFFICIENT_STOCK"          // E0500
  | "CREDIT_LIMIT_EXCEEDED"       // E0501
  | "DUPLICATE_DRAFT"             // E0502
  | "INVALID_VALUE"               // E0503
  | "INVALID_DATE"                // E0504

  // Permission (E0600–E0699)
  | "UNAUTHENTICATED"             // E0600
  | "PERMISSION_DENIED"           // E0601
  | "OPERATION_DENIED"            // E0602

  // Execution (E0700–E0799)
  | "EXECUTION_FAILED"            // E0700
  | "ALREADY_EXECUTED"            // E0701
  | "API_FAILED"                  // E0702
  | "TRANSACTION_ROLLED_BACK"     // E0703

  // LLM (E0800–E0899)
  | "LLM_UNAVAILABLE"             // E0800
  | "LLM_INVALID_RESPONSE"        // E0801
  | "LLM_RATE_LIMITED"            // E0802
  | "LLM_TIMEOUT"                 // E0803
  | "LLM_SAFETY_BLOCK"            // E0804
  | "LLM_EMPTY_RESPONSE"          // E0805

  // System (E0900–E0999)
  | "INTERNAL_ERROR"              // E0900
  | "TIMEOUT"                     // E0901
  | "CONFIGURATION_ERROR"         // E0902
  | "PROTOCOL_VIOLATION";         // E0903 — Stage received unexpected input
```

### 5.2 Error Response Format

Every error returned by any API follows this envelope:

```json
{
  "ok": false,
  "requestId": "uuid",
  "timestamp": "ISO8601",
  "durationMs": 123,
  "contractVersion": "1.0",
  "error": {
    "code": "ERROR_CODE",
    "message": "Owner-facing message",
    "detail": "Technical detail for logging",
    "stage": "stage_name",
    "severity": "error",
    "recoverable": true,
    "resolutionHint": "What the owner can do",
    "source": "validation",
    "internalCode": null
  },
  "_meta": { /* standard meta */ }
}
```

### 5.3 Error Code Usage Matrix

```
Code                     Stage               Recoverable  Owner Action
───────────────────────  ──────────────────  ───────────  ─────────────────────────
EMPTY_INPUT              input_reception      Yes          Type or speak a question
RATE_LIMITED             input_reception      Yes          Wait before sending next
UNCLASSIFIABLE           intent_classification Yes         Rephrase the question
ENTITIES_UNRESOLVED      entity_extraction    Yes          Check the name and try again
ENTITIES_AMBIGUOUS       entity_extraction    Yes          Select from the options
MISSING_REQUIRED_FIELD   entity_extraction    Yes          Provide the missing information
INSUFFICIENT_STOCK       validation           Yes          Reduce quantity or choose another
CREDIT_LIMIT_EXCEEDED    validation           Yes          Choose a different payment method
EXECUTION_FAILED         execution            Yes          Try again — draft is saved
LLM_UNAVAILABLE          response_generation  Yes          Try again
INTERNAL_ERROR           any                  No           Contact support with error code
```

---

## 6. Event Contract

### 6.1 Event Envelope

Events are used for internal communication between modules (pub/sub pattern in Phase 6+). In Phase 1, events are logged but not broadcast.

```typescript
interface BrainEvent<T = unknown> {
  eventId: string;                  // UUID v4
  eventType: EventType;
  timestamp: string;                // ISO 8601
  organizationId: string;
  requestId: string;                // Originating request (if applicable)
  source: string;                   // Module name: "orchestrator", "memory", "skills", etc.
  version: string;                  // Event schema version
  data: T;
  severity: "info" | "warning" | "error";
}

type EventType =
  // Memory lifecycle
  | "memory.initialized"
  | "memory.refreshed"
  | "memory.refresh_failed"
  | "memory.section_updated"

  // Pipeline lifecycle
  | "pipeline.started"
  | "pipeline.stage_completed"
  | "pipeline.completed"
  | "pipeline.failed"

  // Actions
  | "action.draft_created"
  | "action.confirmed"
  | "action.executed"
  | "action.cancelled"
  | "action.failed"

  // Learning
  | "preference.updated"
  | "suggestion.ranked"

  // System
  | "provider.failed"
  | "provider.switched"
  | "rate_limit.hit"
  | "error.logged";
```

### 6.2 Key Event Shapes

```typescript
// Memory refreshed
interface MemoryRefreshedEvent {
  sectionsRefreshed: string[];
  durationMs: number;
  byteSize: number;
  confidence: MemoryConfidenceLabel;
  warnings: string[];
}

// Pipeline completed
interface PipelineCompletedEvent {
  intent: string;
  pipelineMode: PipelineMode;
  totalDurationMs: number;
  stagesCompleted: number;
  skillCount: number;
  llmProvider: string | null;
  llmLatencyMs: number | null;
  success: boolean;
  errorCode: string | null;
}

// Action executed
interface ActionExecutedEvent {
  actionType: string;
  draftSummary: string;
  entityType: string;
  entityId: string;
  reference: string;
  durationMs: number;
  ownerConfirmationTimeMs: number;
}

// Preference updated
interface PreferenceUpdatedEvent {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  method: "implicit" | "explicit";
  confidence: number;
}
```

---

## 7. Internal API: Orchestrator

### 7.1 Purpose

The Orchestrator is the entry point for all AI requests. Every channel and integration calls this single interface.

### 7.2 Process Input

```typescript
// src/lib/brain/contracts/orchestrator.ts

interface OrchestratorInput {
  /** Standard request metadata */
  standard: StandardRequest;

  /** The owner's message (typed or transcribed) */
  text: string;

  /** Detected or specified language */
  language: "english" | "urdu" | "roman_urdu";

  /** Optional conversation history (loaded by caller if available) */
  conversationHistory?: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: string;
  }>;

  /** Business Memory (injected by the caller — the hook or API route) */
  memory: MemoryStore;

  /** Preference store (injected by the caller) */
  preferences: PreferenceStore;

  /** Whether this is a new conversation or continuing */
  isNewConversation: boolean;

  /** Current conversation ID (if continuing) */
  conversationId?: string;
}

interface OrchestratorResponse {
  /** Standard response envelope */
  standard: StandardResponse<OrchestratorData>;

  /** The structured data payload */
  data: OrchestratorData;
}

interface OrchestratorData {
  /** Natural language answer */
  text: string;

  /** Structured data for rich rendering */
  keyPoints: string[];
  warnings: string[];
  chartData: ChartData | null;
  tableData: TableData | null;

  /** Action result (write pipeline only) */
  actionResult: {
    executed: boolean;
    draftSummary: string | null;
    reference: string | null;       // Invoice number, etc.
    entityType: string | null;
    entityId: string | null;
  } | null;

  /** Confirmation request (write pipeline, Stage 7) */
  confirmationRequest: {
    required: boolean;
    sensitive: boolean;
    draftSummary: string;
    warnings: string[];
    estimatedTotal: number | null;
    missingFields: Array<{ field: string; prompt: string }>;
  } | null;

  /** Suggested follow-up questions */
  suggestedQuestions: string[];

  /** Full stage-by-stage metadata */
  pipelineResult: PipelineResult;
}

interface PipelineResult {
  intent: string;
  intentConfidence: number;
  pipelineMode: PipelineMode;
  skillsInvoked: string[];
  stagesCompleted: number;
  totalDurationMs: number;
  llmProvider: string | null;
  llmModel: string | null;
  llmLatencyMs: number | null;
  totalTokenEstimate: number;
  memoryAgeMs: number;
  memoryConfidence: MemoryConfidenceLabel;
}

interface ChartData {
  type: "bar" | "line" | "pie" | "metric" | "gauge";
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
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | boolean | null>>;
  sortable?: boolean;
  maxRows?: number;
}
```

### 7.3 JSON Example (Orchestrator Input)

```json
{
  "standard": {
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-07-29T10:30:00.000Z",
    "organizationId": "org-abc-123",
    "profileId": "prof-xyz-789",
    "channel": "in_app",
    "contractVersion": "1.0"
  },
  "text": "How is my business doing?",
  "language": "english",
  "conversationHistory": [
    { "role": "user", "text": "Hi", "timestamp": "2026-07-29T10:29:00.000Z" },
    { "role": "assistant", "text": "Assalam-o-Alaikum! How can I help you today?", "timestamp": "2026-07-29T10:29:05.000Z" }
  ],
  "isNewConversation": false,
  "conversationId": "conv-456-def"
}
```

### 7.4 JSON Example (Orchestrator Output — Read)

```json
{
  "ok": true,
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-07-29T10:30:00.847Z",
  "durationMs": 847,
  "contractVersion": "1.0",
  "data": {
    "text": "Your business is doing well with a health score of 78 (Good). Revenue this month is PKR 450,000, up 12% from last month. You have 3 low-stock items that need attention.",
    "keyPoints": [
      "Health Score: 78 (Good)",
      "Revenue: PKR 450,000 (+12% vs last month)",
      "Low stock items: 3"
    ],
    "warnings": [
      "Customer 'Usman Store' has an overdue balance of PKR 25,000"
    ],
    "chartData": {
      "type": "metric",
      "title": "Business Health",
      "labels": ["Score"],
      "datasets": [{ "label": "Health Score", "values": [78], "color": "#22c55e" }]
    },
    "tableData": null,
    "actionResult": null,
    "confirmationRequest": null,
    "suggestedQuestions": [
      "What should I reorder?",
      "Show me my top customers",
      "How are my expenses this month?"
    ],
    "pipelineResult": {
      "intent": "health",
      "intentConfidence": 0.95,
      "pipelineMode": "read",
      "skillsInvoked": ["healthScore", "kpi"],
      "stagesCompleted": 7,
      "totalDurationMs": 847,
      "llmProvider": "gemini",
      "llmModel": "gemini-2.0-flash",
      "llmLatencyMs": 320,
      "totalTokenEstimate": 1450,
      "memoryAgeMs": 45000,
      "memoryConfidence": "high"
    }
  },
  "_meta": {
    "pipelineMode": "read",
    "stagesCompleted": 7,
    "memoryAgeMs": 45000,
    "memoryConfidence": "high",
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "llmLatencyMs": 320,
    "totalTokenEstimate": 1450,
    "warnings": []
  }
}
```

### 7.5 JSON Example (Orchestrator Output — Write, Awaiting Confirmation)

```json
{
  "ok": true,
  "requestId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "timestamp": "2026-07-29T10:31:00.203Z",
  "durationMs": 1203,
  "contractVersion": "1.0",
  "data": {
    "text": "I can create this sale for you. Please review and confirm.",
    "keyPoints": [],
    "warnings": ["Customer 'Usman Store' has an overdue balance of PKR 25,000"],
    "chartData": null,
    "tableData": null,
    "actionResult": null,
    "confirmationRequest": {
      "required": true,
      "sensitive": false,
      "draftSummary": "Sale of 5 × Pepsi 500ml @ PKR 130 = PKR 650 to Usman General Store (Cash)",
      "warnings": ["Customer has overdue balance of PKR 25,000 (45 days overdue)"],
      "estimatedTotal": 650,
      "missingFields": []
    },
    "suggestedQuestions": [],
    "pipelineResult": {
      "intent": "action_sale",
      "intentConfidence": 0.97,
      "pipelineMode": "write",
      "skillsInvoked": ["actionPlanner"],
      "stagesCompleted": 7,
      "totalDurationMs": 1203,
      "llmProvider": "gemini",
      "llmModel": "gemini-2.0-flash",
      "llmLatencyMs": 410,
      "totalTokenEstimate": 620,
      "memoryAgeMs": 45000,
      "memoryConfidence": "high"
    }
  },
  "_meta": { /* ... */ }
}
```

---

## 8. Internal API: Language Engine

### 8.1 Purpose

The Language Engine is the thin NLU/NLG layer. It has two distinct modes: intent classification and response generation. It wraps the Provider Router.

### 8.2 Intent Classification

```typescript
// src/lib/brain/contracts/language-engine.ts

interface IntentClassificationInput {
  text: string;
  language: string;
  conversationHistory?: string;     // Last 3 exchanges, formatted
  availableIntents: string[];       // Subset of intent taxonomy relevant to this business
}

interface IntentClassificationOutput {
  intent: string;
  subIntent: string | null;
  confidence: number;               // 0.0–1.0
  entities?: string[];              // Extracted entity mentions (raw text)
}

// JSON shape returned by LLM (JSON mode):
// {
//   "intent": "health",
//   "subIntent": null,
//   "confidence": 0.95,
//   "entities": []
// }
```

### 8.3 Response Generation

```typescript
interface ResponseGenerationInput {
  question: string;
  language: string;
  businessSummary: string;          // Formatted memory summary
  skillResults: string;             // Formatted skill outputs
  conversationHistory: string;       // Last 3 exchanges
  preferences: string;              // Relevant preferences
  confidence: MemoryConfidenceLabel;
  pipelineMode: PipelineMode;
  executionResult?: string;         // For write pipeline post-execution
}

interface ResponseGenerationOutput {
  text: string;                     // Natural language answer
  language: string;                 // Actual language used
}

// LLM output: raw text (not JSON mode for this call)
```

### 8.4 Language Engine Wrapper

```typescript
interface LanguageEngine {
  classifyIntent(input: IntentClassificationInput): Promise<IntentClassificationOutput>;
  generateResponse(input: ResponseGenerationInput): Promise<ResponseGenerationOutput>;
}

// Error output (both methods)
interface LanguageEngineError {
  code: "LLM_UNAVAILABLE" | "LLM_INVALID_RESPONSE" | "LLM_TIMEOUT" | "LLM_SAFETY_BLOCK";
  detail: string;
  providerAttempts: ProviderAttempt[];
}
```

---

## 9. Internal API: Business Memory

### 9.1 Purpose

Business Memory provides a deterministic, queryable data layer for all skills and the orchestrator. It is populated by the MemoryWriter and read by everything else.

### 9.2 Memory Read Contract

```typescript
// src/lib/brain/contracts/memory.ts

interface MemoryReadRequest {
  sections: (keyof MemorySections)[];     // Which sections to read
  scopedEntities?: {
    productIds?: string[];
    customerIds?: string[];
    supplierIds?: string[];
    staffIds?: string[];
  };                                      // For action pipeline — load specific entities only
}

interface MemoryReadResponse {
  ok: boolean;
  sections: Partial<MemorySections>;
  ageMs: number;
  isStale: boolean;
  confidence: MemoryConfidenceLabel;
  warnings: string[];
}

// MemorySections — the complete memory shape
interface MemorySections {
  products: Map<string, ProductMemory>;
  customers: Map<string, CustomerMemory>;
  suppliers: Map<string, SupplierMemory>;
  staff: Map<string, StaffMemory>;
  sales: SalesMemory;
  purchases: PurchasesMemory;
  expenses: ExpensesMemory;
  inventory: InventoryMemory;
  analytics: AnalyticsMemory;
  recommendations: RecommendationsMemory;
  conversations: ConversationMemoryState;
  preferences: PreferencesSnapshot;
  permissions: PermissionsSnapshot;
  meta: MemoryMeta;
}

interface MemoryMeta {
  organizationId: string;
  organizationName: string;
  ownerName: string;
  currentDate: string;              // YYYY-MM-DD
  currentTime: string;              // HH:mm:ss
  timezone: string;
  schemaVersion: number;
  lastFullRefresh: string;          // ISO timestamp
  sectionVersions: Record<string, number>;
}
```

### 9.3 Memory Write Contract

```typescript
interface MemoryWriteRequest {
  section: keyof MemorySections;
  data: unknown;                    // Section-specific data
  source: "memory_writer" | "learning_engine" | "skill";
  triggerRefresh?: boolean;         // If true, mark for async re-computation
}

interface MemoryWriteResponse {
  ok: boolean;
  section: string;
  previousVersion: number;
  newVersion: number;
  durationMs: number;
  warnings: string[];
}
```

### 9.4 MemoryWriter Contract

```typescript
interface MemoryWriterInput {
  // Phase 1: Reads from React state (page.tsx data props)
  // Phase 6+: Reads from Supabase directly

  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  staff: StaffProfile[];
  salesTransactions: SalesTransaction[];
  purchaseTransactions: PurchaseTransaction[];
  expenses: Expense[];
  tasks: Task[];
  alerts: AiAlert[];
  permissions: StaffPermission[];
  // ... raw data arrays
}

interface MemoryWriterOutput {
  ok: boolean;
  store: MemoryStore;
  durationMs: number;
  sectionsPopulated: string[];
  sectionsFailed: string[];
  byteSize: number;
  confidence: MemoryConfidenceLabel;
  warnings: string[];
}
```

### 9.5 Entity Search Contract

```typescript
interface EntitySearchRequest {
  type: "product" | "customer" | "supplier" | "staff";
  query: string;
  threshold?: number;               // 0.0–1.0, default 0.5
  maxResults?: number;              // Default 5
}

interface EntitySearchResponse {
  ok: boolean;
  results: Array<{
    entity: ProductMemory | CustomerMemory | SupplierMemory | StaffMemory;
    score: number;                  // 0.0–1.0 match confidence
    matchedField: string;
    originalQuery: string;
  }>;
  totalMatches: number;
  durationMs: number;
}
```

---

## 10. Internal API: Business Skills

### 10.1 Generic Skill Contract

```typescript
// src/lib/brain/contracts/skills.ts

interface SkillInput<T = unknown> {
  skillId: string;
  params: T;                        // Skill-specific parameters
  memory: MemoryStore;               // Full memory access (skill reads what it needs)
  preferences: PreferenceStore;
  requestId: string;
}

interface SkillResult<T = unknown> {
  skillId: string;
  version: string;
  success: boolean;
  data: T | null;
  error: SkillError | null;
  warnings: string[];
  metrics: SkillMetrics;
}

interface SkillError {
  code: string;
  message: string;
  detail: string;
  recoverable: boolean;
}

interface SkillMetrics {
  executionTimeMs: number;
  inputSize: number;                // Entities processed
  outputSize: number;               // Result size in bytes (approx)
}

// Skill Registry — maps intent to skill execution
interface SkillRegistryEntry {
  skillId: string;
  version: string;
  execute: (input: SkillInput, context: SkillContext) => SkillResult;
  inputSchema: Record<string, unknown>;  // JSON Schema
  outputSchema: Record<string, unknown>; // JSON Schema
}

type SkillRegistry = Map<string, SkillRegistryEntry>;
```

### 10.2 Per-Skill Contracts

```typescript
// SK001 — Health Score
interface HealthScoreInput { /* no params — reads from memory directly */ }
interface HealthScoreOutput {
  score: number; label: string;
  breakdown: Record<string, number>;
  reasons: string[];
  contributingFactors: Array<{ factor: string; impact: string; weight: number; detail: string }>;
  trend: string; trendEvidence: string;
}

// SK002 — Sales Analytics
interface SalesAnalyticsInput { period?: "today" | "week" | "month" | "30d" | "all"; }
interface SalesAnalyticsOutput {
  overview: { totalRevenue: number; totalProfit: number; profitMargin: number | null; invoiceCount: number; averageSaleValue: number; byPaymentType: Record<string, number> };
  periods: Record<string, { revenue: number; profit: number; invoiceCount: number; averageValue: number }>;
  trends: { daily: TrendPoint[]; weekly: TrendPoint[]; monthly: TrendPoint[]; changeVsLastPeriod: number | null };
  topProducts: Array<{ productId: string; productName: string; quantitySold: number; revenue: number; profit: number; margin: number | null }>;
  topCustomers: Array<{ customerId: string; customerName: string; revenue: number; invoiceCount: number; lastSaleDate: string | null }>;
}

// SK003 — Inventory Analytics
interface InventoryAnalyticsInput { /* no params */ }
interface InventoryAnalyticsOutput {
  summary: { totalProducts: number; totalStockValue: number; totalStockCost: number; activeProductCount: number };
  stockStatus: { outOfStock: number; lowStock: number; healthy: number; overstocked: number };
  lowStockItems: Array<{ productId: string; productName: string; currentStock: number; reorderLevel: number; status: string; estimatedDaysLeft: number | null }>;
  categories: Array<{ categoryName: string; productCount: number; stockValue: number; lowStockCount: number }>;
  turnover: { overallTurnoverRate: number | null; fastMovers: string[]; slowMovers: string[] };
}

// SK004 — Customer Analytics
interface CustomerAnalyticsInput { /* no params */ }
interface CustomerAnalyticsOutput {
  summary: { totalCustomers: number; activeCustomers30d: number; newCustomers30d: number; totalOutstanding: number; totalOverdue: number; overdueCustomerCount: number };
  topCustomers: Array<{ customerId: string; customerName: string; shopName: string | null; totalSales30d: number; outstandingBalance: number; overdueAmount: number; creditUtilizationPct: number | null }>;
  aging: { current: number; overdue1to30: number; overdue31to60: number; overdue61to90: number; overdue90plus: number; totalOverdue: number };
  paymentBehavior: { onTimePaymentRate: number | null; averagePaymentDays: number | null; creditCustomerCount: number };
}

// SK005 — Expense Analytics
interface ExpenseAnalyticsInput { /* no params */ }
interface ExpenseAnalyticsOutput {
  summary: { totalExpenses: number; expenseCount: number; averageExpenseValue: number; expenseToRevenueRatio: number | null };
  byCategory: Array<{ category: string; amount: number; percentage: number; count: number; trend: string }>;
  trends: { daily30d: TrendPoint[]; monthly12m: TrendPoint[] };
  anomalies: Array<{ category: string; reason: string; deviation: number; amount: number; severity: string }>;
}

// SK006 — Staff Analytics
interface StaffAnalyticsInput { /* no params */ }
interface StaffAnalyticsOutput {
  summary: { totalStaff: number; activeStaff: number; totalSalesToday: number; averagePerStaff: number };
  staffList: Array<{ staffId: string; name: string; role: string; isActiveDuty: boolean; salesToday: number; lastLocation: object | null; dutyDuration: number | null }>;
  activeLocations: Array<{ staffId: string; staffName: string; lat: number; lng: number; capturedAt: string }>;
}

// SK007 — KPI Calculator
interface KpiInput { /* no params */ }
interface KpiOutput {
  kpis: Array<{ key: string; label: string; category: string; value: number; unit: string; formatted: string; change: number | null; changeLabel: string; confidence: string }>;
  categories: Record<string, KpiItem[]>;
}

// SK008 — Forecast Engine
interface ForecastInput { metric?: "sales_revenue" | "sales_quantity" | "profit" | "expenses"; periods?: number; }
interface ForecastOutput {
  forecasts: Array<{ metric: string; period: string; targetDate: string; predictedValue: number; confidence: number; range: { lower: number; upper: number }; trend: string }>;
  metadata: { method: string; periodsAnalyzed: number; confidence: string };
}

// SK009 — Reorder Advice
interface ReorderAdviceInput { /* no params */ }
interface ReorderAdviceOutput {
  recommendations: Array<{
    productId: string; productName: string; currentStock: number; reorderLevel: number;
    status: string; dailySalesVelocity: number; estimatedDaysLeft: number | null;
    suggestedOrderQuantity: number; suggestedSupplier: string | null; estimatedCost: number; priority: string; reason: string;
  }>;
  summary: { totalUrgent: number; totalRecommended: number; totalItemsToOrder: number; estimatedCost: number };
}

// SK010 — Recommendation Engine
interface RecommendationInput { /* receives all other skill results from orchestrator */ }
interface RecommendationOutput {
  recommendations: Array<{
    id: string; type: string; category: string; priority: string;
    title: string; description: string; expectedImpact: string;
    actionLink: string | null; sourceSkill: string;
  }>;
  summary: { total: number; highPriority: number; mediumPriority: number; lowPriority: number; byCategory: Record<string, number> };
}

// SK011 — Action Planner
interface ActionPlannerInput {
  actionType: string;
  resolvedEntities: EntityResult;
  memory: MemoryStore;
  preferences: PreferenceStore;
}
interface ActionPlannerOutput {
  actionType: string;
  status: "ready" | "needs_input" | "blocked";
  steps: Array<{ order: number; description: string; checkType: string; status: string; detail: string }>;
  draftSummary: string;
  estimatedTotal: number | null;
  missingFields: Array<{ field: string; prompt: string; examples: string[] }>;
  warnings: string[];
  blockers: string[];
}
```

---

## 11. Internal API: Learning Engine

### 11.1 Purpose

Learn from owner behavior and update preferences. Runs asynchronously after the response is delivered.

### 11.2 Contract

```typescript
// src/lib/brain/contracts/learning.ts

interface LearningInput {
  requestId: string;
  question: string;
  detectedLanguage: string;
  intent: string;
  skillsInvoked: string[];
  pipelineMode: PipelineMode;
  confirmationDecision: string | null;     // "execute" | "modify" | "cancel" | null
  executionSuccess: boolean | null;
  responseRendered: boolean;               // Did the owner see the response?
  followUpQuestions: number;               // How many questions followed?
  timestamp: string;
}

interface LearningResult {
  preferencesUpdated: PreferenceUpdate[];
  suggestedQuestionsUpdated: boolean;
  updatedSuggestedQuestions: string[];
  memoryRefreshTriggered: boolean;
  memorySectionsToRefresh: string[];
  durationMs: number;
  warnings: string[];
}

interface PreferenceUpdate {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  method: "implicit" | "explicit";
  confidence: number;
}

// PreferenceStore (in-memory, updated by learning engine)
interface PreferenceStore {
  // Learned (implicit)
  frequentTopics: Record<string, number>;
  preferredPeriod: "today" | "week" | "month" | null;
  preferredLanguage: "english" | "urdu" | "roman_urdu";
  ignoredRecommendationTypes: string[];
  topicFrequency7d: Record<string, number>;      // Last 7 days

  // Explicit
  explicitPreferences: Map<string, unknown>;

  // Suggested questions
  suggestedQuestions: Array<{
    text: string;
    intent: string;
    rank: number;
    frequency: number;
    lastAsked: string | null;
  }>;

  // Metadata
  version: number;
  lastModified: string;
  totalInteractions: number;
}
```

---

## 12. External API: AI Query

### 12.1 `POST /api/ai-business-query`

**Purpose**: Legacy endpoint for business Q&A. Phase 1 refactored to delegate to the Business Brain.

**Request**:

```typescript
interface ApiBusinessQueryRequest {
  question: string;                     // Max 1000 chars
  language?: string;                    // "english" | "urdu" | "roman_urdu" | "auto"
  query_type?: string;                  // Intent hint (optional, overrides auto-detection)
  date_range_start?: string;            // ISO date (optional)
  date_range_end?: string;              // ISO date (optional)
  business_summary?: Record<string, unknown>;  // Legacy context (will be removed in v2)
}
```

**Response (Success)**:

```typescript
interface ApiBusinessQueryResponse {
  ok: boolean;
  provider: string;
  model: string;
  result: {
    answer: string;
    query_type: string;
    language: string;
    key_points: string[];
    warnings: string[];
  };
  raw?: unknown;                        // Raw provider response (debug)
  _meta: {
    latencyMs: number;
    tokenCount: number;
  };
}
```

**Response (Error)**:

```typescript
interface ApiBusinessQueryError {
  ok: false;
  error: string;
  details?: string;
  attempts?: ProviderAttempt[];
}
```

**Status codes**: `200` (success), `400` (missing question), `502` (AI provider unavailable), `500` (internal error)

**Phase 1 change**: API still accepts `business_summary` but delegates to Orchestrator internally. The Orchestrator decides what to use.

---

## 13. External API: AI Assistant

### 13.1 `POST /api/brain/chat`

**Purpose**: Primary AI Assistant endpoint. Replaces the legacy AI Business Query. All in-app text conversations go through this endpoint.

**Request**:

```typescript
interface ApiChatRequest {
  /** Standard envelope */
  requestId?: string;                   // Client-generated UUID (optional, server generates if missing)

  /** The owner's message */
  message: string;                       // Max 2000 chars

  /** Language hint */
  language?: "english" | "urdu" | "roman_urdu" | "auto";

  /** Conversation continuity */
  conversationId?: string;              // Existing conversation ID (null = new conversation)

  /** Pre-populated memory snapshot (Phase 1: client sends full state) */
  memory?: SerializedMemoryStore;       // Optional — server can use its own if available

  /** Preferences snapshot */
  preferences?: SerializedPreferences;

  /** Idempotency key (for write operations — prevents double-execution) */
  idempotencyKey?: string;
}
```

**Response (Success — Read)**:

```typescript
interface ApiChatResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;

  // Core response
  data: {
    text: string;
    keyPoints: string[];
    warnings: string[];
    chartData: ChartData | null;
    tableData: TableData | null;
    suggestedQuestions: string[];
  };

  // Pipeline metadata
  _meta: {
    conversationId: string;
    messageId: string;
    pipelineMode: "read";
    intent: string;
    skillsInvoked: string[];
    provider: string;
    model: string;
    llmLatencyMs: number;
    memoryAgeMs: number;
    totalTokenEstimate: number;
    stagesCompleted: number;
  };
}
```

**Response (Success — Write, Awaiting Confirmation)**:

```typescript
interface ApiChatResponseConfirmation {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;

  data: {
    text: string;
    keyPoints: string[];
    warnings: string[];
    chartData: null;
    tableData: null;
    suggestedQuestions: [];

    // Confirmation card
    confirmationRequest: {
      required: true;
      draftSummary: string;
      estimatedTotal: number | null;
      warnings: string[];
      missingFields: Array<{ field: string; prompt: string; examples: string[] }>;
      sensitive: boolean;
    };

    // Draft ID for confirmation/cancel actions
    draftId: string;
  };

  _meta: {
    conversationId: string;
    messageId: string;
    pipelineMode: "write";
    intent: string;
    skillsInvoked: string[];
    provider: string;
    model: string;
    llmLatencyMs: number;
    memoryAgeMs: number;
    totalTokenEstimate: number;
    stagesCompleted: number;
  };
}
```

**Response (Success — Write, Executed)**:

```typescript
interface ApiChatResponseExecuted {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;

  data: {
    text: string;
    keyPoints: string[];
    warnings: string[];
    chartData: null;
    tableData: null;
    suggestedQuestions: [];

    actionResult: {
      executed: true;
      draftSummary: string;
      reference: string;                // "INV-2026-0715-003"
      entityType: string;               // "sales_transaction"
      entityId: string;                 // UUID of created record
    };

    confirmationRequest: null;
  };

  _meta: {
    conversationId: string;
    messageId: string;
    pipelineMode: "write";
    intent: string;
    skillsInvoked: string[];
    provider: string;
    model: string;
    llmLatencyMs: number;
    memoryAgeMs: number;
    totalTokenEstimate: number;
    stagesCompleted: number;
    executionDurationMs: number;
  };
}
```

**Response (Error)**:

```typescript
interface ApiChatError {
  ok: false;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;
  error: PipelineError;                  // Full error contract
  _meta: { /* ... */ };
}
```

### 13.2 `POST /api/brain/confirm`

**Purpose**: Confirm or cancel a pending draft.

```typescript
interface ApiConfirmRequest {
  draftId: string;
  decision: "execute" | "modify" | "cancel";
  modificationText?: string;            // Required if decision = "modify"
  sensitiveAcknowledged?: boolean;      // Required for sensitive operations
}

interface ApiConfirmResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;

  data: {
    decision: "execute" | "modify" | "cancel";
    executed: boolean;
    reference: string | null;           // If executed
    entityType: string | null;
    entityId: string | null;
    text: string;                       // Confirmation/cancellation message
  };

  _meta: { /* ... */ };
}
```

**Error responses**: `404` (draft not found), `409` (draft already processed), `400` (invalid decision)

### 13.3 `POST /api/brain/feedback`

**Purpose**: Submit implicit feedback (suggestion clicked, recommendation dismissed, etc.).

```typescript
interface ApiFeedbackRequest {
  type: "suggestion_clicked" | "recommendation_dismissed" | "recommendation_accepted" | "response_helpful" | "response_not_helpful";
  targetId: string;                     // Suggestion text or recommendation ID
  requestId?: string;                   // Original request ID (if available)
}

interface ApiFeedbackResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;
}
```

### 13.4 Status Codes

```
200 — Success (any pipeline outcome)
400 — Bad request (missing message, invalid language, etc.)
404 — Resource not found (draft, conversation)
409 — Conflict (draft already processed, idempotency key used)
422 — Validation failed (business rule violation)
429 — Rate limited
500 — Internal error
502 — AI provider unavailable
503 — Service temporarily unavailable (memory not loaded)
```

---

## 14. External API: Voice

### 14.1 `POST /api/brain/voice/transcribe`

**Purpose**: Transcribe audio to text using STT provider.

```typescript
interface ApiVoiceTranscribeRequest {
  audio: Blob;                          // Multipart form — raw audio
  language?: string;                    // Language hint
  mimeType?: string;                    // "audio/webm" | "audio/wav" | "audio/mp3"
}

interface ApiVoiceTranscribeResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;

  data: {
    text: string;
    confidence: number;                 // 0.0–1.0
    language: string;
    isFinal: boolean;                   // True if end-of-utterance detected
  };

  provider: string;                     // "web_speech" | "deepgram" | "local"
  _meta: { /* ... */ };
}
```

### 14.2 `POST /api/brain/voice/synthesize`

**Purpose**: Synthesize text to speech using TTS provider.

```typescript
interface ApiVoiceSynthesizeRequest {
  text: string;                         // Max 2000 chars
  language?: string;
  voice?: string;                       // Provider-specific voice ID
  speed?: number;                       // 0.5–2.0
}

interface ApiVoiceSynthesizeResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;

  data: {
    audio: string;                       // Base64-encoded audio
    mimeType: string;                    // "audio/mp3" | "audio/wav"
    durationMs: number;                  // Audio duration
  };

  provider: string;                     // "web_speech" | "elevenlabs" | "local"
  _meta: { /* ... */ };
}
```

### 14.3 Voice → Brain Pipeline

Voice input follows this flow:

```
1. Audio captured → POST /api/brain/voice/transcribe → text
2. text → POST /api/brain/chat (same as text) → response
3. response.data.text → POST /api/brain/voice/synthesize → audio
4. Audio played to owner

The voice endpoints are stateless. The Brain handles all conversational state.
```

---

## 15. External API: WhatsApp Webhook

### 15.1 `POST /api/brain/whatsapp/webhook`

**Purpose**: Receive incoming WhatsApp messages from Meta Cloud API.

```typescript
// Meta sends this format — TradeOS validates and extracts
interface ApiWhatsAppWebhookRequest {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: "whatsapp";
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: "text" | "interactive" | "image" | "document";
          text?: { body: string };
          interactive?: {
            type: "button_reply" | "list_reply";
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
          image?: { id: string; mime_type: string; sha256: string };
        }>;
      };
      field: "messages";
    }>;
  }>;
}

// TradeOS response to Meta (verification webhook)
// GET /api/brain/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
// Response: 200 with hub.challenge as plain text

interface ApiWhatsAppWebhookResponse {
  // Standard 200 OK — Meta expects empty 200 for message webhooks
  // Standard challenge response for verification webhooks
}
```

### 15.2 `POST /api/brain/whatsapp/send`

**Purpose**: Send an outgoing WhatsApp message.

```typescript
interface ApiWhatsAppSendRequest {
  to: string;                           // Phone number (format: 92XXXXXXXXXX)
  type: "text" | "template" | "interactive";
  text?: {
    body: string;                       // Max 1024 chars
    preview_url?: boolean;
  };
  template?: {
    name: string;
    language: { code: string };
    components: Array<{
      type: "header" | "body" | "footer";
      parameters: Array<{ type: string; text?: string }>;
    }>;
  };
  interactive?: {
    type: "button" | "list";
    body: { text: string };
    action: {
      buttons?: Array<{ type: "reply"; reply: { id: string; title: string } }>;
      sections?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
}

interface ApiWhatsAppSendResponse {
  ok: true;
  requestId: string;
  timestamp: string;
  durationMs: number;

  data: {
    messageId: string;                  // WhatsApp message ID
    status: "sent" | "queued" | "failed";
    recipient: string;
  };

  _meta: { /* ... */ };
}
```

### 15.3 WhatsApp → Brain Integration

```
Incoming message flow:
  1. Meta sends webhook to /api/brain/whatsapp/webhook
  2. Webhook handler extracts sender, message text, message type
  3. Resolves sender phone against CustomerMemory / SupplierMemory
  4. Calls Orchestrator.process() with channel = "whatsapp"
  5. Orchestrator runs standard pipeline
  6. Response text sent via /api/brain/whatsapp/send
  7. Response logged to ConversationMemory

Outgoing message flow:
  1. Owner says "Send message to Usman Store that delivery tomorrow"
  2. Orchestrator classifies as send_whatsapp
  3. Action Planner verifies recipient + message
  4. Owner confirms
  5. Executor calls /api/brain/whatsapp/send
  6. Status returned to owner
```

---

## 16. External API: Memory Debug

### 16.1 `GET /api/brain/context`

**Purpose**: Debug endpoint that returns the full current state of Business Memory. Used for development and troubleshooting. Not exposed to production users.

```typescript
interface ApiMemoryDebugResponse {
  ok: true;
  requestId: string;
  timestamp: string;

  data: {
    meta: MemoryMeta;
    sections: Record<string, {
      populated: boolean;
      entityCount: number;
      byteSize: number;
      ageMs: number;
      confidence: string;
    }>;
    fullSnapshot?: SerializedMemoryStore;        // Only if ?verbose=true
  };

  _meta: {
    durationMs: number;
    memoryAgeMs: number;
    memoryConfidence: MemoryConfidenceLabel;
    warnings: string[];
  };
}
```

---

## 17. Provider Router Contract

### 17.1 Purpose

The Provider Router abstracts all LLM providers behind a single interface. It handles retries, fallbacks, timeout, and response parsing.

### 17.2 Contract (Existing — Formalized)

```typescript
// src/lib/ai/provider-router.ts — contracts

type AiProviderName = "gemini" | "openai" | "groq" | "xai" | "zai";

interface RouterInput {
  /** Task description (included in prompt preamble) */
  task: string;

  /** The primary prompt text */
  prompt: string;

  /** If true, response is parsed as JSON and returned in .json */
  jsonMode?: boolean;

  /** LLM temperature (0.0 = deterministic, 1.0 = creative) */
  temperature?: number;

  /** Description of expected JSON shape (included in prompt when jsonMode=true) */
  expectedJsonShapeDescription?: string;
}

interface RouterResult {
  ok: boolean;

  // Success
  provider?: string;
  model?: string;
  text?: string;
  json?: any;                           // Parsed JSON (if jsonMode=true)
  raw?: any;                            // Raw provider response

  // All attempts
  attempts: ProviderAttempt[];

  // Error
  error?: string;
}

interface ProviderAttempt {
  provider: string;
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
}
```

### 17.3 Configuration Contract

```typescript
// Environment variables that configure the router
interface ProviderConfig {
  providerOrder: AiProviderName[];       // AI_PROVIDER_ORDER (default: gemini,openai,groq)
  timeoutMs: number;                     // AI_PROVIDER_TIMEOUT_MS (default: 20000)
  maxRetriesPerProvider: number;         // AI_MAX_RETRIES_PER_PROVIDER (default: 0, max: 2)

  // Provider-specific
  gemini: {
    apiKey: string;                      // GEMINI_API_KEY
    primaryModel: string;                // GEMINI_PRIMARY_MODEL (default: gemini-2.0-flash)
    fallbackModel: string;               // GEMINI_FALLBACK_MODEL
  };
  openai: {
    apiKey: string;                      // OPENAI_API_KEY
    primaryModel: string;                // OPENAI_PRIMARY_MODEL (default: gpt-4o-mini)
    fallbackModel: string;               // OPENAI_FALLBACK_MODEL
  };
  groq: {
    apiKey: string;                      // GROQ_API_KEY
    primaryModel: string;                // GROQ_PRIMARY_MODEL (default: llama-3.3-70b-versatile)
    fallbackModel: string;               // GROQ_FALLBACK_MODEL (default: llama-3.1-8b-instant)
  };
  xai: {
    apiKey: string;                      // XAI_API_KEY
    primaryModel: string;                // XAI_PRIMARY_MODEL (default: grok-2)
    fallbackModel: string;               // XAI_FALLBACK_MODEL
  };
  zai: {
    apiKey: string;                      // ZAI_API_KEY
    baseUrl: string;                     // ZAI_BASE_URL
    primaryModel: string;                // ZAI_PRIMARY_MODEL
    fallbackModel: string;               // ZAI_FALLBACK_MODEL
  };
}
```

### 17.4 Call Results (Internal)

```typescript
// Returned by individual provider call functions
interface ProviderCallResult {
  ok: boolean;
  status?: number;
  text?: string;
  error?: string;
  raw?: any;
}
```

---

## 18. Dashboard → Brain Integration Contract

### 18.1 Purpose

Define how the existing Dashboard UI interacts with the AI Brain. The Dashboard displays AI-generated insights, alerts, and recommendations that are pre-computed by Business Skills.

### 18.2 Dashboard Data Flow

```
Dashboard mounts
    │
    ▼
MemoryWriter reads React state → populates MemoryStore
    │
    ▼
Skills execute (Health Score, KPI, Reorder, Recommendations)
    │
    ▼
Results stored in MemoryStore.computed
    │
    ▼
Dashboard reads computed sections for widget rendering
    │
    ▼
Widgets display: health score gauge, KPI cards, reorder alerts, insight cards
```

### 18.3 Dashboard Widget Contracts

```typescript
// BusinessHealthCard widget props
interface HealthCardProps {
  score: number;                        // 0–100
  label: "Critical" | "Needs Attention" | "Average" | "Good" | "Excellent";
  trend: "improving" | "declining" | "stable";
  reasons: string[];
  breakdown?: Record<string, number>;   // Sub-scores per category
}

// KPICard widget props
interface KpiCardProps {
  key: string;
  label: string;
  value: string;                        // Formatted: "PKR 45,000"
  change: number | null;                // Percentage
  changeLabel: "up" | "down" | "flat";
  sparklineData?: number[];             // Last 7 data points
  onClickSection?: SectionId;           // Navigate to section on click
}

// AIInsightCard widget props
interface InsightCardProps {
  id: string;
  type: "recommendation" | "alert" | "tip";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  expectedImpact: string;
  dismissed: boolean;
  onDismiss: (id: string) => void;
  onAccept?: (id: string) => void;
}

// SmartModule widget props (children: low stock, recent sales, etc.)
interface SmartModuleProps {
  title: string;
  icon: string;
  children: Array<{
    id: string;
    label: string;
    value: string;
    status?: "healthy" | "warning" | "critical";
    link?: SectionId;
  }>;
  collapsible?: boolean;
}

// DashboardView props (assembled from computed memory)
interface DashboardBrainData {
  healthScore: HealthCardProps;
  kpis: KpiCardProps[];                 // Top 6 KPIs
  insights: InsightCardProps[];          // Top 5 insights
  lowStockItems: Array<{ name: string; stock: number; reorderLevel: number }>;
  recentSales: Array<{ amount: number; customer: string; time: string }>;
  recentPurchases: Array<{ amount: number; supplier: string; time: string }>;
  pendingTasks: number;
  overdueCustomers: number;
  cashFlow: { receivables: number; payables: number; net: number };
}
```

---

## 19. Future MCP Integration Contract

### 19.1 Purpose

Define how external MCP servers will integrate with the Business Brain. This contract is for future implementation but is defined now to ensure the Brain architecture accommodates it.

### 19.2 MCP Tool Registration

```typescript
// What an MCP server provides
interface McpServerDefinition {
  serverId: string;
  name: string;
  version: string;
  description: string;
  tools: McpToolDefinition[];
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  requiresConfirmation: boolean;         // If true, owner must confirm before execution
  allowedContexts: string[];             // Which Brain contexts can invoke this tool
}

// Example
// {
//   "serverId": "banking-mcp",
//   "name": "Banking Integration",
//   "version": "1.0",
//   "description": "Check balance and transfer funds",
//   "tools": [
//     {
//       "name": "get_balance",
//       "description": "Get account balance",
//       "inputSchema": { "type": "object", "properties": { "accountId": { "type": "string" } } },
//       "requiresConfirmation": false,
//       "allowedContexts": ["analytics", "finance"]
//     },
//     {
//       "name": "initiate_transfer",
//       "description": "Transfer funds between accounts",
//       "inputSchema": {
//         "type": "object",
//         "properties": {
//           "fromAccount": { "type": "string" },
//           "toAccount": { "type": "string" },
//           "amount": { "type": "number" }
//         },
//         "required": ["fromAccount", "toAccount", "amount"]
//       },
//       "requiresConfirmation": true,
//       "allowedContexts": ["finance"]
//     }
//   ]
// }
```

### 19.3 MCP Execution Contract

```typescript
interface McpExecutionRequest {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  organizationId: string;
  requestId: string;
}

interface McpExecutionResult {
  ok: boolean;
  toolName: string;
  data: unknown;
  error: {
    code: string;
    message: string;
  } | null;
  durationMs: number;
}

// MCP tools are called by the Executor (Stage 8) after confirmation.
// The Brain treats MCP tools as external write operations:
//   Action Planner → Validator → Permission Check → Confirm → Executor (MCP call) → Audit
```

### 19.4 MCP → Brain Integration

```
External tool is registered in MCP server registry.
When Brain needs to use it:
  1. Comms Agent sends McpExecutionRequest to MCP server
  2. MCP server returns McpExecutionResult
  3. Result is formatted into the response
  4. Full execution is audited

MCP servers are isolated — they cannot access TradeOS data directly.
All data passed to MCP is explicitly included in the request arguments.
```

---

## 20. JSON Schemas

### 20.1 Standard Response Envelope Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://tradeos.ai/schemas/v1/standard-response.json",
  "title": "StandardResponse",
  "type": "object",
  "required": ["ok", "requestId", "timestamp", "durationMs", "contractVersion", "_meta"],
  "properties": {
    "ok": { "type": "boolean" },
    "requestId": { "type": "string", "format": "uuid" },
    "timestamp": { "type": "string", "format": "date-time" },
    "durationMs": { "type": "number", "minimum": 0 },
    "contractVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
    "data": { "type": "object" },
    "error": { "$ref": "#/definitions/PipelineError" },
    "_meta": {
      "type": "object",
      "required": ["pipelineMode", "stagesCompleted", "memoryConfidence", "totalTokenEstimate"],
      "properties": {
        "pipelineMode": { "type": "string", "enum": ["read", "write"] },
        "stagesCompleted": { "type": "integer", "minimum": 0, "maximum": 12 },
        "memoryAgeMs": { "type": "number" },
        "memoryConfidence": { "type": "string", "enum": ["high", "medium", "low", "unreliable"] },
        "provider": { "type": ["string", "null"] },
        "model": { "type": ["string", "null"] },
        "llmLatencyMs": { "type": ["number", "null"] },
        "totalTokenEstimate": { "type": "integer", "minimum": 0 },
        "warnings": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  "definitions": {
    "PipelineError": {
      "type": "object",
      "required": ["code", "message", "stage", "severity", "recoverable"],
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" },
        "detail": { "type": "string" },
        "stage": { "type": "string" },
        "severity": { "type": "string", "enum": ["info", "warning", "error", "critical"] },
        "recoverable": { "type": "boolean" },
        "resolutionHint": { "type": ["string", "null"] },
        "source": { "type": "string" },
        "internalCode": { "type": ["string", "null"] }
      }
    }
  }
}
```

### 20.2 Chat Request Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://tradeos.ai/schemas/v1/chat-request.json",
  "title": "ApiChatRequest",
  "type": "object",
  "required": ["message"],
  "properties": {
    "requestId": { "type": "string", "format": "uuid" },
    "message": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "language": { "type": "string", "enum": ["english", "urdu", "roman_urdu", "auto"], "default": "auto" },
    "conversationId": { "type": "string", "format": "uuid" },
    "idempotencyKey": { "type": "string", "maxLength": 100 }
  }
}
```

### 20.3 Error Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://tradeos.ai/schemas/v1/pipeline-error.json",
  "title": "PipelineError",
  "type": "object",
  "required": ["code", "message", "stage", "severity", "recoverable"],
  "properties": {
    "code": {
      "type": "string",
      "enum": [
        "EMPTY_INPUT", "RATE_LIMITED", "INPUT_TOO_LONG",
        "UNCLASSIFIABLE", "LOW_CONFIDENCE",
        "ENTITIES_UNRESOLVED", "ENTITIES_AMBIGUOUS", "MISSING_REQUIRED_FIELD", "ENTITY_NOT_FOUND",
        "MEMORY_EMPTY", "MEMORY_STALE", "MEMORY_SECTION_NOT_FOUND",
        "SKILLS_FAILED", "SKILL_ERROR", "ACTION_BLOCKED",
        "INSUFFICIENT_STOCK", "CREDIT_LIMIT_EXCEEDED", "DUPLICATE_DRAFT", "INVALID_VALUE",
        "UNAUTHENTICATED", "PERMISSION_DENIED", "OPERATION_DENIED",
        "EXECUTION_FAILED", "ALREADY_EXECUTED", "API_FAILED",
        "LLM_UNAVAILABLE", "LLM_INVALID_RESPONSE", "LLM_RATE_LIMITED", "LLM_TIMEOUT", "LLM_SAFETY_BLOCK", "LLM_EMPTY_RESPONSE",
        "INTERNAL_ERROR", "TIMEOUT", "CONFIGURATION_ERROR", "PROTOCOL_VIOLATION"
      ]
    },
    "message": { "type": "string", "maxLength": 200 },
    "detail": { "type": "string" },
    "stage": { "type": "string" },
    "severity": { "type": "string", "enum": ["info", "warning", "error", "critical"] },
    "recoverable": { "type": "boolean" },
    "resolutionHint": { "type": ["string", "null"] },
    "source": { "type": "string", "enum": ["input", "classification", "entity", "memory", "skill", "validation", "permission", "execution", "llm", "system"] },
    "internalCode": { "type": ["string", "null"] }
  }
}
```

---

## Appendix A: Complete API Route Inventory

```
Method  Route                              Purpose                     Phase
─────────────────────────────────────────────────────────────────────────────
POST    /api/ai-business-query             Legacy business Q&A         P1 (refactored)
POST    /api/brain/chat                    Primary AI Assistant        P1
POST    /api/brain/confirm                 Confirm/cancel draft        P1
POST    /api/brain/feedback                Submit implicit feedback    P1
GET     /api/brain/context                 Memory debug snapshot       P1 (dev only)
POST    /api/brain/voice/transcribe        STT: audio → text          P4
POST    /api/brain/voice/synthesize        TTS: text → audio          P4
GET     /api/brain/whatsapp/webhook        Meta verification          P7
POST    /api/brain/whatsapp/webhook        Incoming WhatsApp          P7
POST    /api/brain/whatsapp/send           Outgoing WhatsApp          P7
```

## Appendix B: Enum Values Registry

```
Channel:          "in_app" | "voice" | "whatsapp" | "mcp" | "system"
PipelineMode:     "read" | "write"
MemoryConfidence: "high" | "medium" | "low" | "unreliable"
Language:         "english" | "urdu" | "roman_urdu" | "auto"
Intent:           defined in Execution Protocol Section 5.4
StageName:        defined in Section 5.1 of this document
ErrorCode:        defined in Section 5.1 of this document
EventType:        defined in Section 6.1 of this document
ProviderName:     "gemini" | "openai" | "groq" | "xai" | "zai"
ActionType:       "action_sale" | "action_purchase" | "action_expense" | "action_task"
                  | "action_customer" | "action_supplier" | "action_product" | "send_whatsapp"
ConfirmationDecision: "execute" | "modify" | "cancel" | "clarify" | "timeout"
ChartType:        "bar" | "line" | "pie" | "metric" | "gauge"
Severity:         "info" | "warning" | "error" | "critical"
Priority:         "high" | "medium" | "low"
SkillStatus:      "ready" | "needs_input" | "blocked"
```

## Appendix C: End-to-End Message Flow

```
CLIENT (React)              API ROUTE              ORCHESTRATOR              SKILLS              LLM
    │                          │                        │                      │                  │
    │── POST /api/brain/chat ──►                        │                      │                  │
    │   { message,                                   │                      │                  │
    │     conversationId }                           │                      │                  │
    │                          │                        │                      │                  │
    │                          │── OrchestratorInput ──►                      │                  │
    │                          │   (with MemoryStore   │                      │                  │
    │                          │    injected)          │                      │                  │
    │                          │                        │── Stage 1: LLM ──────►── classify ──►──│
    │                          │                        │◄── intent ────────────◄───────────────◄──│
    │                          │                        │                      │                  │
    │                          │                        │── Stage 2: Extract ──►── resolve ─────►──│
    │                          │                        │◄── entities ──────────◄────────────────◄──│
    │                          │                        │                      │                  │
    │                          │                        │── Stage 3: Read ─────►── Memory ───────►──│
    │                          │                        │◄── context ───────────◄────────────────◄──│
    │                          │                        │                      │                  │
    │                          │                        │── Stage 4: Skills ───►── SK001–SK010 ──►──│
    │                          │                        │◄── results ───────────◄────────────────◄──│
    │                          │                        │                      │                  │
    │                          │                        │── Stage 5–8 (if write)                  │
    │                          │                        │                      │                  │
    │                          │                        │── Stage 9: Generate ─►── prompt ───────►──│
    │                          │                        │◄── text ──────────────◄────────────────◄──│
    │                          │                        │                      │                  │
    │                          │◄── StandardResponse ───┘                      │                  │
    │                          │                        │                      │                  │
    │◄── JSON ────────────────┘                        │                      │                  │
    │                          │                        │                      │                  │
    │ Render response                                  │                      │                  │
    │                          │                        │── Stage 11: Learning (async)            │
```

## Appendix D: Contract Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-29 | Chief AI Architect | Initial API contract specification — defines all communication formats across the AI architecture |

---

*This document defines the immutable communication contract for the entire TradeOS AI architecture. Every module — Business Brain, Business Memory, Business Skills, Provider Router, Voice, WhatsApp, MCP, and Dashboard — must communicate using these exact formats. No future integration may introduce a new communication pattern without updating this contract.*

---

**Architecture complete**: This is the sixth and final architecture document. The full specification now comprises:

1. `TRADEOS_AI_MASTER_ARCHITECTURE.md` — 23-chapter vision
2. `TRADEOS_AI_EXECUTION_PROTOCOL.md` — 12-stage immutable pipeline
3. `TRADEOS_BUSINESS_SKILLS_SPEC.md` — 13 deterministic skills
4. `TRADEOS_BUSINESS_MEMORY_SPEC.md` — 6-layer memory system
5. `TRADEOS_AI_API_CONTRACT.md` — Every API, DTO, event, error, and schema
6. `AI_PHASE1_IMPLEMENTATION_PLAN.md` — 32-step execution plan

**No additional architecture documents will be created. Architecture is frozen. The next step is implementation.**
