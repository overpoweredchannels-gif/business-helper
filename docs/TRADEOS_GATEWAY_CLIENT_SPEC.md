# TradeOS Voice Runtime — Gateway Client Specification

Document ID: TVR-GWC-001
Title: TradeOS Gateway Client Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- Frozen Conversation Gateway Protocol (TCGP v1.0)
- Frozen Conversation Gateway (`ConversationGateway.chat()`)

---

## 1. Purpose

This specification defines the implementation contract for the Gateway Client within the TradeOS Voice Runtime.

The Gateway Client is the **only** component in the Voice Runtime permitted to communicate with the Conversation Gateway. It wraps `ConversationGateway.chat()` and `ConversationGateway.chatStream()` with voice-aware semantics: correlation IDs scoped to voice sessions, message IDs tied to dialogue turns, idempotency for retried requests, and structured handling of gateway responses and errors.

It is responsible **only** for reliable gateway communication on behalf of the Dialogue Runtime.

It does **not** own:

- Dialogue orchestration
- Business logic
- Business memory
- Conversation state beyond a single request/response cycle
- Gateway implementation or protocol design
- Speech processing
- Session lifecycle
- Provider lifecycle

---

## 2. Scope

The Gateway Client owns:

- Constructing TCGP-compliant ChatRequest envelopes for voice turns
- Forwarding ChatRequest to the Conversation Gateway
- Receiving ChatResponse from the Conversation Gateway
- Forwarding ChatResponse or structured errors to the Dialogue Runtime
- Request retry with exponential backoff
- Request timeout enforcement
- Correlation ID generation and propagation
- Message ID generation and propagation
- Idempotency key management for retried requests
- Structured event emission for every request lifecycle phase
- Structured error wrapping for all gateway failure modes

The Gateway Client does **not** own:

- Dialogue state or turn sequencing
- Business logic evaluation
- Transcript formatting or language processing
- Audio chunk transport
- Session creation or teardown
- Provider lifecycle management
- Streaming runtime coordination

---

## 3. Runtime Responsibilities

The Gateway Client shall:

| Responsibility | Description |
|---|---|
| Build gateway request | Construct a `ChatRequest` envelope from a dialogue turn, including voice session context |
| Send request | Call `ConversationGateway.chat()` with the constructed envelope |
| Stream request | Call `ConversationGateway.chatStream()` for streaming responses (future) |
| Receive response | Accept the `ChatResponse` from the gateway |
| Parse response | Extract the message, provider, model, and conversation ID from the response |
| Handle success | Forward the response message to the Dialogue Runtime |
| Handle error | Wrap gateway errors into structured `GatewayClientError` types |
| Retry on failure | Apply exponential backoff for retryable gateway errors |
| Enforce timeout | Abort requests that exceed the configured timeout |
| Generate correlation ID | Create a unique correlation ID per request, or propagate one from the session |
| Generate message ID | Create a unique message ID per request for deduplication |
| Manage idempotency | Store idempotency keys for retried requests |
| Emit lifecycle events | Fire events for request start, success, retry, timeout, and error |
| Track metrics | Accumulate request count, latency, error count, and retry count |
| Validate conversation ID | Ensure the gateway returns a valid conversation ID and surface it to the Dialogue Runtime |

---

## 4. Internal Modules

The Gateway Client is composed of the following implementation modules.

### 4.1 Request Builder

Responsibilities:
- Construct a `ChatRequest` object compliant with TCGP v1.0
- Populate the `message` field from the dialogue turn's final transcript
- Populate the `channel` field with `"voice"`
- Populate `sessionId` and `userId` from the active Voice Session
- Populate `conversationId` from the Dialogue Runtime's tracked conversation
- Populate `correlationId` (generated or propagated)
- Populate `requestId` (generated per attempt)
- Populate `timestamp` with ISO 8601 time
- Include voice-specific metadata (turn sequence number, language, recognition confidence)

### 4.2 Request Dispatcher

Responsibilities:
- Call `ConversationGateway.chat()` with the constructed request
- Call `ConversationGateway.chatStream()` when streaming is requested
- Apply timeout via `AbortController` or equivalent mechanism
- Capture response or error
- Measure request duration for metrics

### 4.3 Response Parser

Responsibilities:
- Extract the `message` field from `ChatResponse`
- Extract `conversationId` and validate it is non-empty
- Extract `provider` and `model` metadata for telemetry
- Detect error responses (where `ok === false`)
- Return a structured `GatewayResponse` to the Dialogue Runtime

### 4.4 Retry Manager

Responsibilities:
- Evaluate whether a gateway error is retryable
- Apply exponential backoff between retries
- Enforce maximum retry count
- Generate idempotency keys for retried requests
- Emit retry events for each attempt

### 4.5 Timeout Manager

Responsibilities:
- Track elapsed time for each request
- Abort requests that exceed the configured timeout
- Emit timeout events
- Distinguish between gateway timeout and network-level timeout

### 4.6 Correlation Manager

Responsibilities:
- Generate unique correlation IDs per request when not provided by the session
- Propagate session-level correlation ID across requests within a dialogue turn
- Store the correlation ID in the request envelope

### 4.7 Idempotency Manager

Responsibilities:
- Generate idempotency keys for each unique request
- Store keys for the duration of the retry window
- Attach the idempotency key to retried request envelopes
- Clear keys on successful response or after retry window expires

### 4.8 Metrics Collector

Responsibilities:
- Count total requests, successful responses, errors, and retries
- Track request duration (min, max, avg, p50, p95, p99)
- Track retry counts per request
- Expose metrics snapshot for runtime monitoring queries

---

## 5. Public TypeScript Interfaces

### 5.1 GatewayClient

```typescript
interface GatewayClient {
  initialize(config: GatewayClientConfiguration): Promise<void>;

  send(request: GatewayRequest): Promise<GatewayResponse>;

  sendStream(request: GatewayRequest): AsyncGenerator<GatewayStreamEvent, void, void>;

  getMetrics(): GatewayClientMetrics;

  health(): GatewayClientHealth;

  dispose(): Promise<void>;
}
```

### 5.2 GatewayRequest

```typescript
interface GatewayRequest {
  message: string;
  sessionId: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  turnSequence: number;
  language?: string;
  recognitionConfidence?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}
```

### 5.3 GatewayResponse

```typescript
interface GatewayResponse {
  ok: boolean;
  message: string;
  conversationId: string;
  requestId: string;
  correlationId: string;
  provider?: string;
  model?: string;
  error?: string;
  durationMs: number;
  retryCount: number;
}
```

### 5.4 GatewayStreamEvent

```typescript
type GatewayStreamEvent =
  | { type: "start"; requestId: string; conversationId: string; correlationId: string; timestamp: string }
  | { type: "text"; text: string; requestId: string; conversationId: string; correlationId: string; timestamp: string }
  | { type: "done"; requestId: string; conversationId: string; correlationId: string; provider?: string; model?: string; timestamp: string }
  | { type: "error"; error: string; requestId: string; conversationId: string; correlationId: string; timestamp: string };
```

### 5.5 GatewayClientConfiguration

```typescript
interface GatewayClientConfiguration {
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  channel: "voice";
}
```

### 5.6 GatewayClientMetrics

```typescript
interface GatewayClientMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  timeoutCount: number;
  durationMinMs: number;
  durationMaxMs: number;
  durationAvgMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
  lastRequestAt: Date | null;
}
```

### 5.7 GatewayClientHealth

```typescript
interface GatewayClientHealth {
  healthy: boolean;
  initialized: boolean;
  disposed: boolean;
  totalRequests: number;
  recentErrors: number;
  lastErrorAt: Date | null;
  message?: string;
}
```

### 5.8 GatewayClientEvent

```typescript
interface GatewayClientEvent<T extends GatewayClientEventName = GatewayClientEventName> {
  name: T;
  timestamp: Date;
  data: GatewayClientEventDataMap[T];
  requestId?: string;
  correlationId?: string;
  conversationId?: string;
}
```

### 5.9 GatewayClientEventName

```typescript
type GatewayClientEventName =
  | "RequestStarted"
  | "RequestSucceeded"
  | "RequestRetried"
  | "RequestTimedOut"
  | "RequestFailed"
  | "StreamStarted"
  | "StreamEventReceived"
  | "StreamCompleted"
  | "StreamFailed";
```

### 5.10 GatewayClientEventDataMap

```typescript
interface GatewayClientEventDataMap {
  RequestStarted: { messageLength: number; turnSequence: number; conversationId?: string };
  RequestSucceeded: { responseLength: number; durationMs: number; retryCount: number; provider?: string; model?: string };
  RequestRetried: { attempt: number; maxAttempts: number; error: string; delayMs: number };
  RequestTimedOut: { timeoutMs: number };
  RequestFailed: { error: string; retryable: boolean; durationMs: number };
  StreamStarted: { requestId: string; conversationId: string };
  StreamEventReceived: { eventType: string };
  StreamCompleted: { provider?: string; model?: string };
  StreamFailed: { error: string };
}
```

---

## 6. Request Lifecycle

Every gateway request follows this lifecycle:

```
Build Request
    │
    ▼
Emit RequestStarted
    │
    ▼
Dispatch ──────────────────────────────────────────┐
    │                                                │
    ▼                                                │
Timeout reached? ──► Emit RequestTimedOut ──► Return timeout error
    │
    ▼ (no)
Send to ConversationGateway.chat()
    │
    ▼
Response received ──► Parse response
    │                    │
    │                    ▼
    │              ok === true? ──► Emit RequestSucceeded ──► Return GatewayResponse
    │                    │
    │                    ▼ (false)
    │              Retryable? ──► yes ──► Emit RequestRetried ──► Backoff ──► Dispatch (retry)
    │                    │
    │                    ▼ (no)
    │              Emit RequestFailed ──► Return error
    │
    ▼
Exception caught ──► Retryable? ──► yes ──► Emit RequestRetried ──► Backoff ──► Dispatch (retry)
                         │
                         ▼ (no)
                    Emit RequestFailed ──► Return error
```

### Retry decision flowchart

```
Response or Exception
       │
       ▼
Is retryable error? ──► No ──► Fail immediately
       │
       ▼ Yes
Retry count < maxAttempts? ──► No ──► Fail with "max retries exceeded"
       │
       ▼ Yes
Compute backoff delay
       │
       ▼
Emit RequestRetried
       │
       ▼
Wait for delay
       │
       ▼
Retry (increment attempt counter)
```

---

## 7. Response Lifecycle

Every gateway response follows this lifecycle:

```
Raw ChatResponse from ConversationGateway.chat()
    │
    ▼
Extract fields: message, conversationId, provider, model, ok, error
    │
    ▼
Validate conversationId is non-empty
    │
    ├── Empty ──► Generate error: "Gateway returned empty conversationId"
    │
    ▼ Non-empty
    │
    ▼
ok === true?
    │
    ├── Yes ──► Construct GatewayResponse { ok: true, message, conversationId, ... }
    │            │
    │            ▼
    │            Emit RequestSucceeded
    │            │
    │            ▼
    │            Return to Dialogue Runtime
    │
    └── No ──► Extract error string from response
                │
                ▼
                Classify error:
                  ├── BRAIN_NOT_INITIALIZED  → fatal
                  ├── VALIDATION_ERROR       → fatal (indicates bug)
                  ├── UNSUPPORTED_VERSION    → fatal
                  ├── INTERNAL_ERROR         → retryable
                  ├── RATE_LIMITED           → retryable
                  └── (unknown)              → retryable
                │
                ▼
                Retryable? ──► yes ──► enter retry loop
                    │
                    ▼ no
                Construct GatewayResponse { ok: false, error: classified, ... }
                │
                ▼
                Emit RequestFailed
                │
                ▼
                Return to Dialogue Runtime
```

---

## 8. Retry Policy

### Retryable errors

The following gateway error codes are retryable:

| Error Code | Retryable | Notes |
|---|---|---|
| `INTERNAL_ERROR` | Yes | Transient server error |
| `RATE_LIMITED` | Yes | Client should back off and retry |
| `BRAIN_NOT_INITIALIZED` | No | Requires application-level action |
| `VALIDATION_ERROR` | No | Indicates a bug in request construction |
| `UNSUPPORTED_VERSION` | No | Indicates a version mismatch |

Network-level exceptions (fetch failures, DNS errors, connection refused) are also retryable.

### Backoff strategy

```
delayMs = min(retryBaseDelayMs * 2^(attempt - 1), retryMaxDelayMs)
jitterMs = random(0, delayMs * 0.1)
totalDelayMs = delayMs + jitterMs
```

| Attempt | Base Delay | Max Delay | Effective Range |
|---|---|---|---|
| 1 | 1000 ms | 10000 ms | 1000–1100 ms |
| 2 | 2000 ms | 10000 ms | 2000–2200 ms |
| 3 | 4000 ms | 10000 ms | 4000–4400 ms |
| 4 | 8000 ms | 10000 ms | 8000–8800 ms |
| 5 | 10000 ms | 10000 ms | 10000–11000 ms |

### Retry budget

| Parameter | Default | Maximum |
|---|---|---|
| `retryMaxAttempts` | 3 | 5 |
| `retryBaseDelayMs` | 1000 | 5000 |
| `retryMaxDelayMs` | 10000 | 30000 |
| Total retry window (max) | ~15 s | ~80 s |

---

## 9. Timeout Policy

### Per-request timeout

Every request to `ConversationGateway.chat()` shall be bounded by a timeout.

```
timeoutMs = config.timeoutMs  (default: 10000 ms)
```

If the timeout is reached:

1. The in-flight request shall be abandoned.
2. A `RequestTimedOut` event shall be emitted.
3. If the retry budget has remaining attempts, the request shall be retried.
4. If the retry budget is exhausted, a timeout error shall be returned to the Dialogue Runtime.

### Total operation timeout

The total time across all retry attempts shall be bounded:

```
totalTimeoutMs = timeoutMs * retryMaxAttempts + sum of backoff delays
```

If the total operation timeout is exceeded, no further retries shall be attempted.

---

## 10. Correlation ID Handling

The Gateway Client manages correlation IDs as follows.

### Generation

- If the Dialogue Runtime provides a `correlationId` in the `GatewayRequest`, it shall be propagated verbatim to the `ChatRequest`.
- If no `correlationId` is provided, the Gateway Client shall generate one with format:
  ```
  corr_voice_{sessionId}_{turnSequence}_{timestamp}_{random}
  ```

### Propagation within a turn

- A single dialogue turn may produce multiple gateway requests (e.g., a clarification followed by the main query). All requests within the same turn shall share the same correlation ID.
- The Dialogue Runtime is responsible for providing the turn-scoped correlation ID.

### Propagation across sessions

- Each voice session shall use unique correlation IDs scoped to that session.
- Correlation IDs are NOT propagated across sessions.

### Logging

- Every event emitted by the Gateway Client shall include the `correlationId` if available.
- Every log entry produced by the Gateway Client shall include the `correlationId`.

---

## 11. Message ID Handling

The Gateway Client manages message IDs as follows.

### Generation

Each gateway request shall include a unique message ID:

```
msg_voice_{sessionId}_{turnSequence}_{attempt}_{random}
```

The message ID is distinct from the gateway-generated `requestId`. It is a client-side identifier.

### Purpose

- Enables the gateway to detect and reject duplicate submissions (idempotency).
- Enables tracing from dialogue turn through gateway request to gateway response.
- Enables correlation of retry attempts with the original request.

### Inclusion in request

The message ID shall be included in the `ChatRequest.metadata` field:

```typescript
{
  ...request,
  metadata: {
    ...request.metadata,
    messageId: "msg_voice_abc123_4_1_k7f9",
    turnSequence: 4,
  }
}
```

---

## 12. Idempotency Handling

The Gateway Client manages idempotency as follows.

### Idempotency key

Each unique gateway request (identified by message ID) shall have an idempotency key:

```
idempotency_key = messageId
```

### Storage

- Idempotency keys shall be stored in memory for the duration of the retry window.
- Keys shall be cleared on:
  - Successful response (ok === true)
  - Exhaustion of all retry attempts
  - Expiration of the retry window

### Retry behavior

- When a request is retried, the same idempotency key shall be used.
- The idempotency key shall be included in the `ChatRequest.metadata`:

```typescript
{
  ...request,
  metadata: {
    ...request.metadata,
    messageId: "msg_voice_abc123_4_1_k7f9",
    idempotencyKey: "msg_voice_abc123_4_1_k7f9",
  }
}
```

### Gateway responsibility

The Conversation Gateway is expected to detect duplicate `messageId` values and return the cached response when a duplicate is received within the idempotency window. The Gateway Client does not implement this detection; it only sends the key.

---

## 13. Event Model

The Gateway Client emits the following standardized events.

### Event table

| Event | Emitted When | Data |
|---|---|---|
| `RequestStarted` | Request dispatched to gateway | messageLength, turnSequence, conversationId |
| `RequestSucceeded` | Successful response received | responseLength, durationMs, retryCount, provider, model |
| `RequestRetried` | Request about to be retried | attempt, maxAttempts, error, delayMs |
| `RequestTimedOut` | Per-request timeout reached | timeoutMs |
| `RequestFailed` | Non-retryable error or retries exhausted | error, retryable, durationMs |
| `StreamStarted` | Stream request dispatched | requestId, conversationId |
| `StreamEventReceived` | Individual stream event received | eventType |
| `StreamCompleted` | Stream finished successfully | provider, model |
| `StreamFailed` | Stream finished with error | error |

### Event interface

All events conform to `GatewayClientEvent` (defined in Section 5.8).

---

## 14. Error Contracts

All errors conform to the following structure:

```typescript
interface GatewayClientError {
  code: GatewayClientErrorCode;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  internal: boolean;
  cause?: unknown;
  requestId?: string;
  correlationId?: string;
  conversationId?: string;
  timestamp: Date;
}
```

```typescript
type ErrorCategory =
  | "timeout"
  | "gateway"
  | "network"
  | "validation"
  | "configuration"
  | "internal";
```

### Error Catalog

| Code | Category | Description | Retryable | Internal |
|---|---|---|---|---|
| RequestTimeout | timeout | Per-request timeout exceeded | Yes | No |
| TotalTimeout | timeout | Total operation timeout exceeded | No | No |
| GatewayError | gateway | Gateway returned ok=false | Depends | No |
| GatewayUnreachable | network | Gateway not reachable (network error) | Yes | No |
| InvalidResponse | gateway | Gateway response missing required fields | No | Yes |
| ConversationIdMissing | gateway | Gateway response missing conversationId | No | Yes |
| ConfigurationError | configuration | Invalid GatewayClient configuration | No | Yes |
| MaxRetriesExceeded | internal | All retry attempts exhausted | No | No |
| ClientNotInitialized | internal | Operation before initialize() | No | Yes |
| ClientDisposed | internal | Operation after dispose() | No | Yes |

### Error Handling Rules

1. Retryable errors shall enter the retry loop if budget remains.
2. Non-retryable errors shall be returned to the Dialogue Runtime immediately.
3. Internal errors indicate a bug and shall be surfaced to the Dialogue Runtime as fatal.
4. Every error shall emit a corresponding event.
5. Errors shall not expose Business Brain or Gateway implementation details beyond the error code and message already defined.

---

## 15. Configuration

### GatewayClientConfiguration

```typescript
interface GatewayClientConfiguration {
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  channel: "voice";
}
```

### Field Reference

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| timeoutMs | number | Yes | 10000 | Must be between 1000 and 60000 |
| retryMaxAttempts | number | Yes | 3 | Must be between 0 and 5 |
| retryBaseDelayMs | number | Yes | 1000 | Must be between 100 and 5000 |
| retryMaxDelayMs | number | Yes | 10000 | Must be between 1000 and 30000 |
| channel | "voice" | Yes | "voice" | Must be exactly "voice" |

### Validation Rules

1. Configuration shall be validated during `initialize()`.
2. Invalid configuration shall reject the initialize promise with `ConfigurationError`.
3. `retryMaxDelayMs` must be greater than `retryBaseDelayMs`.
4. `timeoutMs` must be greater than `retryBaseDelayMs`.

---

## 16. Performance Targets

The implementation shall satisfy the following engineering objectives:

| Objective | Requirement |
|---|---|
| Request construction | Building a request envelope shall not block the Dialogue Runtime beyond a single synchronous allocation |
| Request dispatch | Dispatching a request to the gateway shall use the existing `ConversationGateway.chat()` path with no additional serialization overhead |
| Response parsing | Parsing a gateway response shall complete in O(1) time relative to message length |
| Retry overhead | Retry decision and backoff computation shall not exceed 1 ms |
| Memory per request | A single in-flight request shall consume no more than 1 KB of heap memory |
| Concurrent requests | The client shall support at most one in-flight request per dialogue turn |
| No blocking | All operations shall be non-blocking (async) |

---

## 17. Compliance Requirements

A Gateway Client implementation is compliant with this specification **only if** it:

1. Implements every required public interface defined in Section 5.
2. Constructs TCGP-compliant ChatRequest envelopes.
3. Calls `ConversationGateway.chat()` as the sole gateway communication method.
4. Calls `ConversationGateway.chatStream()` for streaming responses when requested.
5. Applies the retry policy defined in Section 8.
6. Applies the timeout policy defined in Section 9.
7. Manages correlation IDs per Section 10.
8. Manages message IDs per Section 11.
9. Manages idempotency keys per Section 12.
10. Emits all standardized runtime events defined in Section 13.
11. Returns structured errors conforming to Section 14.
12. Does **not** implement business logic.
13. Does **not** access Business Brain internals.
14. Does **not** modify the Conversation Gateway or its protocol.
15. Supports externally supplied configuration (Section 15).
16. Passes every required testing suite defined in Section 18.

---

## 18. Testing Requirements

### 18.1 Unit Testing

| Test | Description |
|---|---|
| Request construction | `send()` produces a ChatRequest with all required fields |
| Channel fixed to voice | Every ChatRequest has channel = "voice" |
| Correlation ID propagation | Provided correlationId appears in the request envelope |
| Correlation ID generation | Absent correlationId is generated with correct format |
| Message ID generation | Every request has a unique messageId in metadata |
| Response parsing | Successful ChatResponse produces correct GatewayResponse |
| Error parsing | Error ChatResponse produces correct GatewayClientError |

### 18.2 Retry Testing

| Test | Description |
|---|---|
| Retryable error triggers retry | INTERNAL_ERROR response causes a retry |
| Non-retryable error fails fast | VALIDATION_ERROR response does not retry |
| Max retries exhausted | After retryMaxAttempts, returns MaxRetriesExceeded |
| Backoff delay applied | Delay between retries follows exponential backoff formula |
| Network error retry | Fetch/network exception triggers retry |
| Success after retry | Gateway returns success on retry attempt N, response returned correctly |

### 18.3 Timeout Testing

| Test | Description |
|---|---|
| Per-request timeout | Gateway does not respond within timeoutMs, RequestTimedOut emitted |
| Timeout with retry | Timeout on attempt 1, retry attempted on attempt 2 |
| Total timeout exceeded | Cumulative time across retries exceeds total budget, operation fails |
| Success before timeout | Gateway responds within timeout, response returned normally |

### 18.4 Idempotency Testing

| Test | Description |
|---|---|
| Idempotency key present | Every retried request includes idempotencyKey in metadata |
| Same key across retries | Consecutive retry attempts carry the same idempotency key |
| Different key per unique request | Two different GatewayRequests have different idempotency keys |

### 18.5 Event Testing

| Test | Description |
|---|---|
| RequestStarted emitted | Event fires on dispatch |
| RequestSucceeded emitted | Event fires on successful response |
| RequestRetried emitted | Event fires before each retry |
| RequestTimedOut emitted | Event fires on timeout |
| RequestFailed emitted | Event fires on non-retryable error |
| All events contain correlationId | Every event includes correlationId when available |

### 18.6 Error Testing

| Test | Description |
|---|---|
| Gateway error wrapping | Gateway ok=false response produces structured GatewayClientError |
| Network error wrapping | Fetch failure produces structured GatewayClientError |
| Timeout error wrapping | Timeout produces structured GatewayClientError |
| Error retryable flag | retryable field matches Section 14 classification |
| Error events emitted | Every error emits corresponding event |

### 18.7 Configuration Testing

| Test | Description |
|---|---|
| Valid configuration accepted | Initialize succeeds with valid config |
| Invalid timeout rejected | timeoutMs outside bounds rejected |
| Invalid retry count rejected | retryMaxAttempts outside bounds rejected |
| Channel enforcement | Non-voice channel rejected |

### 18.8 Compliance Testing

| Test | Description |
|---|---|
| Interface compliance | Implements all required public interfaces |
| Event compliance | All standardized events emitted |
| Error compliance | All error codes conform to specification |
| Configuration compliance | All required fields accepted and validated |

---

## 19. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Breaking changes to public interfaces, retry policy, timeout policy, mandatory events, or error contracts |
| Minor | Backward-compatible additions: new optional configuration fields, new events, new metrics, new test categories |
| Patch | Documentation clarifications, correction of non-normative text, correction of test descriptions |

Implementations shall declare the specification version they conform to, enabling compatibility validation across Voice Runtime components.

---

## 20. Non-Goals

The Gateway Client explicitly does **not** implement:

- Business logic or business rule evaluation
- Business memory or context storage
- Dialogue orchestration or turn management
- Conversation state beyond a single request/response cycle
- Gateway protocol design or modification
- Speech recognition or speech synthesis
- Session lifecycle management
- Provider lifecycle management
- Audio stream transport
- Streaming runtime coordination
- Database access or persistence
- Business permissions or access control
- Business calculations or financial computations
- Business Brain integration or querying
