# TradeOS Conversation Gateway — Architecture Specification

**Protocol:** TCGP v1.0 (TradeOS Conversation Gateway Protocol)  
**Version:** 1.0  
**Status:** Active  
**Scope:** Single public conversational interface for all client channels

---

## 1. Architecture

```
Client (Web / Voice / WhatsApp / Phone / MCP / Desktop / Mobile)
                │
                ▼
      Conversation Gateway
                │
                ▼
        BusinessBrain.chat()
```

The **Conversation Gateway** is the **only** public interface for conversational
interaction with TradeOS. No client channel may call `BusinessBrain.chat()`
directly.

This document defines **TCGP v1.0** — the TradeOS Conversation Gateway
Protocol — governing all communication between conversational clients and the
Gateway.

---

## 2. Responsibilities

### Gateway owns

| Concern | Description |
|---------|-------------|
| Request envelope validation | Validate version, message, channel before reaching the brain |
| Protocol version negotiation | Accept or reject based on supported version list |
| Correlation ID propagation | Generate or propagate correlation IDs for request tracing |
| Session management | Track sessions across channels; auto-generate session IDs |
| Conversation IDs | Generate and track conversation threads across messages |
| Channel metadata | Record which channel originated each request |
| Response normalization | Wrap brain responses into a stable envelope with tracing IDs |
| Structured event logging | Log every request, response, and error with structured metadata |
| Streaming abstraction | Define the future streaming contract (not yet implemented) |
| Channel-independent contract | Single `ChatRequest` / `ChatResponse` contract for every channel |

### Gateway does NOT own

Business Skills, MemoryStore, EntityIndex, ContextRetriever, Analytics,
Forecasting, Recommendations, Database logic, Business calculations.

These remain inside the **Business Brain**, which is frozen and may only be
modified for bug fixes.

---

## 3. TCGP v1.0 — Request Contract

```typescript
interface ChatRequest {
  // Envelope
  version?: string;
  correlationId?: string;
  timestamp?: string;

  // Payload
  message: string;
  conversationId?: string;
  sessionId?: string;
  userId?: string;
  organizationId?: string;
  channel: Channel;
  metadata?: ChannelMetadata;
}
```

### Fields

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `version` | `string` | No | Must be in `SUPPORTED_VERSIONS` if provided | Protocol version. Defaults to `"1.0"`. |
| `correlationId` | `string` | No | Opaque string | Client-provided correlation ID for tracing. Generated if absent. |
| `timestamp` | `string` | No | ISO 8601 | Client-side timestamp. Recorded but not validated strictly. |
| `message` | `string` | Yes | Non-empty after trim. Must be `typeof string`. | The user's message text. |
| `conversationId` | `string` | No | — | Client-provided conversation ID. Generated if absent or unknown. |
| `sessionId` | `string` | No | — | Client session identifier. Generated if absent. |
| `userId` | `string` | No | — | End-user identifier (human or system). |
| `organizationId` | `string` | No | — | Business organization context. |
| `channel` | `Channel` | Yes | Must be a valid `Channel` value | Originating channel (see §7). |
| `metadata` | `object` | No | — | Channel-specific metadata (see §7). |

### Channel enum

```typescript
type Channel = "web" | "voice" | "whatsapp" | "phone" | "mcp" | "desktop" | "mobile";
```

### Channel metadata

```typescript
interface ChannelMetadata {
  userAgent?: string;
  platform?: string;
  locale?: string;
  timezone?: string;
  ipAddress?: string;
}
```

---

## 4. TCGP v1.0 — Response Contract

```typescript
interface ChatResponse {
  version: string;
  correlationId: string;
  requestId: string;
  timestamp: string;

  ok: boolean;
  message: string;
  conversationId: string;
  provider?: string;
  model?: string;
  error?: string;
}
```

### Fields

| Field | Type | Always present | Description |
|-------|------|----------------|-------------|
| `version` | `string` | Yes | Protocol version used to serve the request. |
| `correlationId` | `string` | Yes | Echo of the correlation ID from the request, or gateway-generated. |
| `requestId` | `string` | Yes | Unique per-request tracing ID. Format: `req_{timestamp}_{counter}`. |
| `timestamp` | `string` | Yes | Server-side ISO 8601 timestamp of the response. |
| `ok` | `boolean` | Yes | Whether the request succeeded. |
| `message` | `string` | Yes | The assistant's response text (empty on error). |
| `conversationId` | `string` | Yes | The resolved conversation ID for tracing and continuity. |
| `provider` | `string` | No | AI provider that served the request (passthrough from brain). |
| `model` | `string` | No | AI model used (passthrough from brain). |
| `error` | `string` | No | Error description. When `ok` is `false`, this follows the format `"{ErrorCode}: {message}"` for gateway-detected errors, or is the raw error message from the brain for delegation errors. |

---

## 5. TCGP v1.0 — Error Model

### Error codes

```typescript
type ErrorCode =
  | "BRAIN_NOT_INITIALIZED"   // BusinessBrain singleton is null
  | "RATE_LIMITED"            // Rate limit exceeded (reserved)
  | "VALIDATION_ERROR"        // Malformed or missing required fields
  | "INTERNAL_ERROR"          // Unexpected runtime failure
  | "CONVERSATION_NOT_FOUND"  // Referenced conversation does not exist
  | "UNSUPPORTED_VERSION";    // Requested API version is not supported
```

### Error response shape

```typescript
interface GatewayError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
}
```

When the Gateway detects the error (validation, version, brain missing), the
`ChatResponse.error` field is set to `"{ErrorCode}: {message}"`. Clients should
parse the error prefix for programmatic handling.

When the error originates from the Business Brain (e.g., fetch failure, AI
provider error), the error message passes through as-is without the Gateway
error prefix.

---

## 6. TCGP v1.0 — ID Strategy

### Correlation ID

- Format: `corr_{timestamp}_{random}`
- Used for tracing a logical operation across multiple requests
- Client may provide one; Gateway generates one if absent
- Propagated to all logs and responses
- Distinct from `requestId` — a single correlation may span multiple requests

### Conversation ID

- Format: `conv_{timestamp}_{random}`
- Generated by the Gateway on first message if not provided by the client
- Persists across messages in the same logical thread
- Stored in Gateway memory for the lifetime of the process
- Clients should store and re-send `conversationId` for thread continuity

### Session ID

- Format: `sess_{timestamp}_{random}`
- Generated by the Gateway if not provided
- Tracks one client session (e.g., browser tab, phone call)
- A session may span multiple conversations

### Request ID

- Format: `req_{timestamp}_{counter}`
- Generated by the Gateway per invocation of `chat()`
- Used for request tracing, logging, and debugging
- Never re-used

### User ID

- Opaque string provided by the client
- Passed through to the Gateway for logging and future personalization
- No Gateway-side validation (trusted client input)

### Organization ID

- Opaque string provided by the client
- Passed through for future multi-tenant routing
- Currently not consumed; reserved for multi-org support

---

## 7. TCGP v1.0 — Channel Metadata

Each channel specifies its identity and any relevant metadata:

| Channel | Required metadata | Notes |
|---------|-------------------|-------|
| `web` | — | Browser-based UI. Metadata populated from `navigator`. |
| `voice` | `locale`, `timezone` | Voice runtime. Set by voice platform SDK. |
| `whatsapp` | — | WhatsApp Business API. Inferred from message webhook. |
| `phone` | `phoneNumber` | PSTN / SIP calls. Set by telephony adapter. |
| `mcp` | — | MCP server tool calls. |
| `desktop` | — | Electron/Tauri desktop app. |
| `mobile` | — | React Native / Flutter mobile app. |

---

## 8. TCGP v1.0 — Streaming Contract

Defined for future implementation. The Gateway does **not** currently implement
streaming.

```typescript
type StreamEventType = "start" | "text" | "done" | "error";

interface StreamEvent {
  type: StreamEventType;
  requestId: string;
  conversationId: string;
  correlationId: string;
  version: string;
  timestamp: string;
  text?: string;    // present when type = "text"
  error?: string;   // present when type = "error"
  provider?: string; // present when type = "done"
  model?: string;    // present when type = "done"
}

interface ChatStream {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
}
```

When streaming support is added:
- A `chatStream()` method will return a `ChatStream` (async iterable)
- The `requestId` and `conversationId` will be consistent between the initial
  response and subsequent stream chunks
- All channels will share the same streaming contract
- The `start` event signals the beginning of a response
- Zero or more `text` events carry response fragments
- A `done` event signals completion with optional `provider`/`model` metadata
- An `error` event signals failure

---

## 9. TCGP v1.0 — Confirmation Protocol

Defined for multi-turn action confirmation (e.g., "Create purchase of 50 units
from ABC Supplier — should I proceed?"):

```typescript
interface ConfirmationRequest {
  type: "confirmation";
  conversationId: string;
  summary: string;
  requiredFields: string[];
  timeoutMs: number;
}

interface ConfirmationResponse {
  type: "confirmation";
  conversationId: string;
  confirmed: boolean;
  amendments?: Record<string, unknown>;
}
```

The Gateway defines these interfaces but does **not** implement confirmation
logic. Future channel adapters (Voice, WhatsApp) will interpret
`ConfirmationRequest` from the brain's response and convert user input into a
`ConfirmationResponse`.

---

## 10. TCGP v1.0 — Version Negotiation

- **Current version:** `"1.0"`
- **Supported versions:** `["1.0"]`
- **Version format:** `MAJOR.MINOR`
- **Backward compatibility:** Within the same MAJOR version, all changes are
  additive (new optional fields). Clients that omit unknown fields remain
  compatible.
- **Version header:** `x-tcgp-version` (for HTTP-bound transports)
- **Correlation header:** `x-correlation-id` (for HTTP-bound transports)
- **Unsupported version:** Gateway returns `UNSUPPORTED_VERSION` error with
  the list of supported versions in the error message.
- **Default version:** If the client omits `version`, the Gateway defaults to
  `CURRENT_VERSION` (`"1.0"`).

When a new MAJOR version is released:
- The Gateway supports both old and new versions concurrently
- Clients opt in via the `version` field
- Old versions are deprecated with a minimum 6-month sunset window

---

## 11. TCGP v1.0 — Structured Event Logging

Every chat request produces structured JSON log entries for observability.

### Log format

```typescript
interface LogEntry {
  timestamp: string;     // ISO 8601
  level: LogLevel;       // "debug" | "info" | "warn" | "error"
  event: string;         // Event name (see below)
  correlationId?: string;
  requestId?: string;
  conversationId?: string;
  channel?: string;
  version?: string;
  durationMs?: number;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}
```

### Logged events

| Event | Level | When |
|-------|-------|------|
| `chat.request` | `info` | A valid request is about to be delegated to the brain |
| `chat.response` | `info` | A successful response is returned from the brain |
| `chat.error` | `warn` | The brain returned an error result |
| `chat.exception` | `error` | The brain threw an unexpected exception |
| `brain.unavailable` | `error` | The BusinessBrain singleton is not initialized |
| `validation.failed` | `warn` | A request failed validation |
| `version.unsupported` | `warn` | An unsupported protocol version was requested |

---

## 12. Implementation — `ConversationGateway` class

### Location

```
src/lib/conversation/
    gateway.ts   — ConversationGateway class
    contracts.ts — ChatRequest, ChatResponse, error types, streaming types
    types.ts     — Channel enum, ChannelMetadata
    logger.ts    — GatewayLogger (structured event logging)
    index.ts     — Barrel exports
```

### Singleton

```typescript
import { getGateway } from "@/lib/conversation";

const gateway = getGateway();
```

`getGateway()` returns the same instance for the lifetime of the process.

### Public methods

```typescript
class ConversationGateway {
  chat(request: ChatRequest): Promise<ChatResponse>;
  getConversation(conversationId: string): ConversationState | undefined;
  getStatus(): GatewayStatus;
}
```

### Gateway status

```typescript
interface GatewayStatus {
  ready: boolean;
  brainAttached: boolean;
  conversationCount: number;
  sessionCount: number;
  uptimeMs: number;
}
```

### Internal flow of `chat()`

```
chat(request)
  ├── 1. Generate requestId (req_{ts}_{counter})
  ├── 2. Resolve correlationId (provided or corr_{ts}_{random})
  ├── 3. Record timestamp
  ├── 4. Version negotiation (validate or default to "1.0")
  │     └── fail → UNSUPPORTED_VERSION (logged)
  ├── 5. Message validation (non-empty, typeof string)
  │     └── fail → VALIDATION_ERROR (logged)
  ├── 6. Channel validation (valid enum value)
  │     └── fail → VALIDATION_ERROR (logged)
  ├── 7. Resolve conversationId (generate or find)
  ├── 8. Resolve sessionId (generate or find)
  ├── 9. Log "chat.request" event
  ├── 10. Delegate to BusinessBrain.chat(message)
  │       ├── brain absent → BRAIN_NOT_INITIALIZED (logged)
  │       ├── brain returns error → "chat.error" event logged
  │       ├── brain throws → "chat.exception" event logged
  │       └── brain succeeds → "chat.response" event logged
  └── 11. Wrap result in ChatResponse with full envelope
```

---

## 13. TCGP v1.0 — Rules

1. **No client calls the brain directly.** Every conversational interaction
   must pass through `ConversationGateway.chat()`.
2. **No business logic in the Gateway.** The Gateway validates, routes,
   tracks, and logs — it does not compute business metrics.
3. **The Business Brain is frozen.** Bug fixes only. No new skills, memory
   structures, or context logic.
4. **Contracts come first.** Every channel adapter implements the same
   `ChatRequest` → `ChatResponse` contract.
5. **Fail closed.** If the brain is absent, the Gateway returns
   `BRAIN_NOT_INITIALIZED` — it does not fabricate a response.
6. **Trace everything.** Every request receives a `requestId`. Every
   correlation-aware request receives or generates a `correlationId`. All
   events are logged with both IDs.
7. **Version explicitly.** Clients should always specify a `version` field.
   The Gateway defaults to the latest version for backward compatibility.

---

## 14. Integration Tests

### Test suite

Location: `src/lib/conversation/validation/`  
Runner: `npx tsx scripts/run-gateway-validation.ts`

### Test coverage (25 tests)

| Category | Tests | Description |
|----------|-------|-------------|
| Version negotiation | 3 | Default version, supported version, unsupported version |
| Envelope validation | 5 | Empty message, whitespace, non-string, missing channel, valid request |
| Correlation ID | 4 | Auto-generation, propagation, uniqueness, same ID reuse |
| Request ID | 1 | Uniqueness and format |
| Timestamp | 1 | ISO format validity |
| Conversation ID | 3 | Auto-generation, reuse, unknown ID handling |
| Brain delegation | 2 | Brain absent, message delegation |
| Response envelope | 3 | All fields present, provider/model, error message |
| Channel metadata | 1 | All 7 channel types accepted |
| Gateway status | 2 | Status object shape, conversation counting |

### Running

```bash
npx tsx scripts/run-gateway-validation.ts
```
