# TradeOS Voice Runtime — Observability Specification

Document ID: TVR-OBS-001
Title: TradeOS Voice Runtime Observability Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_RUNTIME_EVENT_MODEL.md (TVR-EM-001)
- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_VOICE_SDK_SPEC.md (TVR-VSDK-001)
- TRADEOS_VOICE_CONFIGURATION_SPEC.md (TVR-VCS-001)
- TRADEOS_PROVIDER_COMPLIANCE_SPEC.md (TVR-PCS-001)
- Frozen Voice Runtime Architecture

---

## 1. Purpose

This specification defines the **observability contract** for the entire Voice Runtime — how every component produces structured logs, exposes metrics, participates in distributed tracing, reports health, and emits telemetry. It establishes a single, consistent observability surface that monitoring infrastructure, dashboards, and alerting systems can rely on.

Observability serves four purposes:

1. **Debugging** — Engineers can reconstruct the exact sequence of events leading to any failure.
2. **Monitoring** — Operators can observe real-time health, latency, and throughput of every component.
3. **Alerting** — Automated systems can detect anomalies, degradation, and failures before they impact users.
4. **Capacity planning** — Teams can analyze trends in usage, latency, and resource consumption.

---

## 2. Scope

This specification covers:

| Domain | Sections | Consumers |
|---|---|---|
| Structured Logging | 3, 4 | Engineers (ad-hoc queries, log aggregation) |
| Metrics | 5, 6, 7 | Operators, dashboards, auto-scalers |
| Distributed Tracing | 8, 9 | Engineers (latency analysis, dependency mapping) |
| Health Checks | 10, 11 | Load balancers, orchestrators, operators |
| Runtime Diagnostics | 12 | Engineers (deep inspection) |
| Correlation IDs | 13 | All observability signals |
| Telemetry Events | 14 | Monitoring pipeline |
| Dashboards | 15 | Operators, engineers |
| Alerting | 16 | On-call engineers |

---

## 3. Structured Logging

### 3.1 Log Levels

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
```

| Level | Purpose | Emitted When |
|---|---|---|
| `debug` | Detailed diagnostic information | Every method entry/exit, every event emission, every state transition |
| `info` | Normal operational events | Lifecycle transitions, session start/end, successful gateway requests |
| `warn` | Degraded but recoverable conditions | Retry attempts, heartbeat misses, buffer warnings, idle warnings |
| `error` | Failure conditions | Provider errors, gateway errors, invalid state transitions, timeouts |
| `silent` | No log output | Disables all logging |

### 3.2 Log Record Format

Every log record SHALL be a structured JSON object with the following fields:

```typescript
interface LogRecord {
  /** ISO 8601 UTC timestamp with millisecond precision */
  timestamp: string;

  /** Log level */
  level: LogLevel;

  /** Component that produced the log */
  component: LogComponent;

  /** Short, dot-separated log message name */
  message: string;

  /** Human-readable description */
  description: string;

  /** Correlation ID (see Section 13) */
  correlationId?: string;

  /** Session ID if within a session context */
  sessionId?: string;

  /** Conversation ID if within a gateway conversation */
  conversationId?: string;

  /** Provider ID if within a provider context */
  providerId?: string;

  /** Stream ID if within a stream context */
  streamId?: string;

  /** Structured key-value data */
  data?: Record<string, unknown>;

  /** Error information (populated for error-level logs) */
  error?: {
    code: string;
    message: string;
    stack?: string;
    cause?: string;
  };

  /** Runtime environment */
  environment: string;

  /** Runtime instance ID */
  instanceId: string;
}

type LogComponent =
  | "voice_runtime"
  | "speech_runtime"
  | "streaming_runtime"
  | "dialogue_runtime"
  | "session_runtime"
  | "gateway_client"
  | "stt_provider"
  | "tts_provider"
  | "transport_provider"
  | "voice_sdk";
```

### 3.3 Log Message Naming

Log messages SHALL use dot-separated paths following the convention `{component}.{area}.{action}`:

| Component | Example Messages |
|---|---|
| `voice_runtime` | `voice_runtime.initialize.start`, `voice_runtime.initialize.complete`, `voice_runtime.dispose` |
| `speech_runtime` | `speech_runtime.listening.start`, `speech_runtime.recognition.transcript`, `speech_runtime.playback.start` |
| `streaming_runtime` | `streaming_runtime.stream.create`, `streaming_runtime.stream.chunk_sent`, `streaming_runtime.buffer.overflow` |
| `dialogue_runtime` | `dialogue_runtime.turn.start`, `dialogue_runtime.thinking.start`, `dialogue_runtime.confirmation.requested` |
| `session_runtime` | `session_runtime.session.create`, `session_runtime.session.activate`, `session_runtime.session.expire` |
| `gateway_client` | `gateway_client.request.start`, `gateway_client.request.success`, `gateway_client.request.retry` |
| `stt_provider` | `stt_provider.recognition.start`, `stt_provider.recognition.partial`, `stt_provider.recognition.final` |
| `tts_provider` | `tts_provider.synthesis.start`, `tts_provider.synthesis.chunk`, `tts_provider.synthesis.complete` |
| `transport_provider` | `transport_provider.connect`, `transport_provider.disconnect`, `transport_provider.reconnect` |
| `voice_sdk` | `voice_sdk.client.create`, `voice_sdk.session.start`, `voice_sdk.session.stop` |

### 3.4 Logging Compliance Rules

| # | Rule |
|---|---|
| L-01 | Every log record SHALL be a single-line JSON object (one log = one line) |
| L-02 | Every log record SHALL include `timestamp`, `level`, `component`, `message`, `instanceId`, `environment` |
| L-03 | Log records SHALL NOT contain PII (personally identifiable information) |
| L-04 | Log records SHALL NOT contain credentials, API keys, or tokens |
| L-05 | `warn` and `error` logs SHALL include a correlation ID when available |
| L-06 | `error` logs SHALL include the `error` block with `code` and `message` |
| L-07 | Log emission SHALL NOT block the calling operation |
| L-08 | Log emission SHALL NOT throw — failures to write logs SHALL be silently dropped |
| L-09 | The `data` field SHALL be JSON-serializable |
| L-10 | The `data` field SHALL NOT exceed 4096 bytes after serialization |

### 3.5 Log Sampling

Under high throughput, `debug`-level logs MAY be sampled:

- `debug`: Sample rate SHOULD NOT exceed 1:100 under normal load
- `info`: No sampling
- `warn`: No sampling
- `error`: No sampling — every error SHALL be logged

---

## 4. Logging Configuration

### 4.1 Runtime Logging Configuration

```typescript
interface RuntimeLoggingConfiguration {
  /** Global log level — overridden by component-specific levels */
  level: LogLevel;

  /** Component-specific log level overrides */
  componentLevels?: Partial<Record<LogComponent, LogLevel>>;

  /** Enable JSON pretty-printing (development only) */
  prettyPrint?: boolean;

  /** Log output destination */
  destination?: "stdout" | "stderr" | "file" | "tcp";

  /** File path when destination is "file" */
  filePath?: string;

  /** TCP endpoint when destination is "tcp" */
  tcpEndpoint?: string;

  /** Maximum log record size in bytes before truncation */
  maxRecordSizeBytes?: number;

  /** Enable debug log sampling */
  enableDebugSampling?: boolean;

  /** Debug log sample rate (1:N) */
  debugSampleRate?: number;
}
```

### 4.2 Default Values

| Field | Default |
|---|---|
| `level` | `"info"` |
| `componentLevels` | `{}` |
| `prettyPrint` | `false` |
| `destination` | `"stdout"` |
| `maxRecordSizeBytes` | `4096` |
| `enableDebugSampling` | `true` |
| `debugSampleRate` | `100` |

---

## 5. Metrics Architecture

### 5.1 Principles

1. **Every component exposes metrics.** No component shall be a black box.
2. **Metrics are additive counters and histograms.** No gauges that can go down (except uptime).
3. **Metrics are labeled.** Every metric carries component, instance, and type labels.
4. **Metrics are namespaced.** Every metric name starts with `tradeos_voice_{component}_`.
5. **Metrics are push-based for real-time, pull-based for dashboards.** Components push events; aggregators build time series.

### 5.2 Metric Types

```typescript
type MetricType = "counter" | "histogram" | "gauge";
```

| Type | Behavior | Examples |
|---|---|---|
| `counter` | Monotonically increasing | Request count, error count, bytes processed |
| `histogram` | Distribution of values | Latency (p50/p95/p99), chunk size, buffer occupancy |
| `gauge` | Point-in-time value (can go up or down) | Active sessions, uptime, buffer occupancy percent |

### 5.3 Metric Naming Convention

```
tradeos_voice_{component}_{metric_name}
```

Examples:
- `tradeos_voice_gateway_client_requests_total`
- `tradeos_voice_speech_runtime_recognition_duration_ms`
- `tradeos_voice_session_runtime_active_sessions`

All metric names SHALL use lowercase snake_case.

### 5.4 Common Labels

Every metric SHALL carry the following labels:

| Label | Description | Example |
|---|---|---|
| `component` | LogComponent value | `"speech_runtime"` |
| `instance_id` | Runtime instance ID | `"voice-prod-1"` |
| `environment` | Deployment environment | `"production"` |
| `provider_id` | Provider ID (if applicable) | `"google-stt-1"` |
| `session_id` | Session ID (if applicable) | `"sess_abc123"` |

---

## 6. Component Metrics

### 6.1 Voice Runtime (Top-Level)

| Metric Name | Type | Description |
|---|---|---|
| `tradeos_voice_runtime_uptime_seconds` | gauge | Runtime uptime in seconds |
| `tradeos_voice_runtime_initialized` | gauge | 1 if initialized, 0 otherwise |
| `tradeos_voice_runtime_healthy` | gauge | 1 if all components healthy, 0 otherwise |

### 6.2 Speech Runtime

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_speech_listening_total` | counter | `state` | Number of times listening started |
| `tradeos_voice_speech_recognition_total` | counter | `result` | Number of recognition results (partial/final) |
| `tradeos_voice_speech_recognition_duration_ms` | histogram | — | Recognition latency distribution |
| `tradeos_voice_speech_synthesis_total` | counter | `result` | Number of synthesis requests |
| `tradeos_voice_speech_synthesis_duration_ms` | histogram | — | Synthesis latency distribution |
| `tradeos_voice_speech_playback_total` | counter | `state` | Number of playback events (start/stop/interrupt) |
| `tradeos_voice_speech_audio_bytes_processed` | counter | `direction` | Total audio bytes (input/output) |
| `tradeos_voice_speech_vad_detections_total` | counter | — | Number of VAD speech detections |
| `tradeos_voice_speech_vad_state` | gauge | — | Current VAD state (0=idle, 1=detecting, 2=speech, 3=silence) |
| `tradeos_voice_speech_state` | gauge | — | Current runtime state as integer |

### 6.3 Streaming Runtime

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_streaming_streams_total` | counter | `state` | Number of streams created/stopped |
| `tradeos_voice_streaming_active_streams` | gauge | — | Currently active streams |
| `tradeos_voice_streaming_chunks_sent_total` | counter | `direction` | Total chunks sent (input) |
| `tradeos_voice_streaming_chunks_received_total` | counter | `direction` | Total chunks received (output) |
| `tradeos_voice_streaming_bytes_sent_total` | counter | `direction` | Total bytes sent |
| `tradeos_voice_streaming_bytes_received_total` | counter | `direction` | Total bytes received |
| `tradeos_voice_streaming_latency_ms` | histogram | — | One-way streaming latency |
| `tradeos_voice_streaming_jitter_ms` | histogram | — | Inter-chunk delay variation |
| `tradeos_voice_streaming_buffer_occupancy` | gauge | `direction` | Current buffer occupancy as percent |
| `tradeos_voice_streaming_buffer_overflows_total` | counter | `direction` | Number of buffer overflow events |
| `tradeos_voice_streaming_buffer_underflows_total` | counter | `direction` | Number of buffer underflow events |
| `tradeos_voice_streaming_chunks_dropped_total` | counter | — | Number of dropped chunks |
| `tradeos_voice_streaming_heartbeats_missed_total` | counter | — | Number of missed heartbeats |
| `tradeos_voice_streaming_recoveries_total` | counter | `result` | Number of recovery attempts |
| `tradeos_voice_streaming_recovery_duration_ms` | histogram | — | Recovery time distribution |

### 6.4 Dialogue Runtime

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_dialogue_turns_total` | counter | `state` | Number of turns (started/completed/interrupted) |
| `tradeos_voice_dialogue_turn_duration_ms` | histogram | — | Turn duration distribution |
| `tradeos_voice_dialogue_thinking_total` | counter | `state` | Number of thinking cycles (started/completed) |
| `tradeos_voice_dialogue_thinking_duration_ms` | histogram | — | Gateway wait time distribution |
| `tradeos_voice_dialogue_confirmations_total` | counter | `result` | Confirmation requests (accepted/rejected/timed_out) |
| `tradeos_voice_dialogue_clarifications_total` | counter | `result` | Clarification requests (answered/timed_out) |
| `tradeos_voice_dialogue_interruptions_total` | counter | — | Number of interruption events |
| `tradeos_voice_dialogue_recoveries_total` | counter | `result` | Number of recovery attempts |
| `tradeos_voice_dialogue_gateway_requests_total` | counter | `result` | Number of gateway requests triggered |
| `tradeos_voice_dialogue_state` | gauge | — | Current dialogue state as integer |

### 6.5 Session Runtime

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_session_sessions_total` | counter | `state` | Number of sessions (created/closed/expired) |
| `tradeos_voice_session_active_sessions` | gauge | — | Currently active sessions |
| `tradeos_voice_session_suspended_sessions` | gauge | — | Currently suspended sessions |
| `tradeos_voice_session_session_duration_ms` | histogram | `channel` | Session lifetime distribution |
| `tradeos_voice_session_idle_duration_ms` | histogram | — | Idle time before suspension |
| `tradeos_voice_session_heartbeats_total` | counter | `result` | Heartbeat events (received/missed) |
| `tradeos_voice_session_recoveries_total` | counter | `result` | Number of session recovery attempts |
| `tradeos_voice_session_recovery_duration_ms` | histogram | — | Session recovery time distribution |

### 6.6 Gateway Client

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_gateway_requests_total` | counter | `result` | Number of gateway requests |
| `tradeos_voice_gateway_request_duration_ms` | histogram | — | Gateway round-trip time distribution |
| `tradeos_voice_gateway_retries_total` | counter | — | Number of retry attempts |
| `tradeos_voice_gateway_timeouts_total` | counter | — | Number of request timeouts |
| `tradeos_voice_gateway_stream_events_total` | counter | `type` | Number of stream events received |
| `tradeos_voice_gateway_errors_total` | counter | `code` | Number of gateway errors by code |

### 6.7 Provider (STT, TTS, Transport)

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_provider_operations_total` | counter | `provider_id`, `operation`, `result` | Number of provider operations |
| `tradeos_voice_provider_operation_duration_ms` | histogram | `provider_id`, `operation` | Provider operation latency |
| `tradeos_voice_provider_errors_total` | counter | `provider_id`, `error_code` | Provider errors by code |
| `tradeos_voice_provider_retries_total` | counter | `provider_id` | Number of provider retries |
| `tradeos_voice_provider_healthy` | gauge | `provider_id` | 1 if healthy, 0 otherwise |

### 6.8 Voice SDK

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `tradeos_voice_sdk_clients_total` | counter | `client_type` | Number of SDK clients created |
| `tradeos_voice_sdk_sessions_total` | counter | `result` | Number of SDK sessions (started/ended) |
| `tradeos_voice_sdk_requests_total` | counter | `result` | Number of SDK requests |
| `tradeos_voice_sdk_audio_bytes_captured` | counter | — | Total audio bytes captured |
| `tradeos_voice_sdk_audio_bytes_played` | counter | — | Total audio bytes played |
| `tradeos_voice_sdk_client_state` | gauge | `client_type` | Current client state as integer |
| `tradeos_voice_sdk_active_session` | gauge | `client_type` | 1 if session active, 0 otherwise |

---

## 7. Metrics Emission

### 7.1 Emission Strategy

Metrics SHALL be emitted through two mechanisms:

1. **Push (real-time)** — Components emit `telemetry.metrics_snapshot` events at a configurable interval (`healthReportIntervalMs`, default 30s). The monitoring pipeline collects these events and forwards them to the metrics backend.

2. **Pull (on-demand)** — Every component SHALL expose a `getMetrics()` method that returns a snapshot of current metric values. This is used by health checks, diagnostics endpoints, and the compliance suite.

### 7.2 Metrics Aggregation

- Counters SHALL be monotonically increasing within a component lifetime
- Histograms SHALL be computed over a sliding window of the last N samples
- Gauges SHALL represent point-in-time values
- On `dispose()`, the component SHALL emit a final `telemetry.metrics_snapshot` event

### 7.3 Metrics Compliance Rules

| # | Rule |
|---|---|
| M-01 | Every component SHALL expose all metrics listed in Section 6 |
| M-02 | Every metric SHALL carry all labels from Section 5.4 |
| M-03 | Counters SHALL start at 0 after `initialize()` |
| M-04 | Counters SHALL NOT reset on `stop()` — they accumulate across sessions |
| M-05 | Counters SHALL reset to 0 on `dispose()` |
| M-06 | Histogram computation SHALL NOT block the request path |
| M-07 | Metrics SHALL be available through a `getMetrics()` method |
| M-08 | `getMetrics()` SHALL never throw |

---

## 8. Distributed Tracing

### 8.1 Trace Model

Every voice interaction produces a **trace** — a tree of **spans** that captures the end-to-end flow from SDK to Gateway and back.

```
Trace: voice_interaction
├── Span: sdk.create_session
│   ├── Span: session_runtime.create
│   ├── Span: dialogue_runtime.initialize
│   └── Span: speech_runtime.initialize
├── Span: dialogue.turn
│   ├── Span: speech_runtime.listen
│   │   ├── Span: stt_provider.recognize
│   │   └── Span: streaming_runtime.receive
│   ├── Span: gateway_client.request
│   │   └── Span: [gateway processing] (external)
│   ├── Span: dialogue.think
│   └── Span: speech_runtime.speak
│       ├── Span: tts_provider.synthesize
│       └── Span: streaming_runtime.send
└── Span: sdk.close_session
    ├── Span: session_runtime.close
    ├── Span: dialogue_runtime.dispose
    └── Span: speech_runtime.dispose
```

### 8.2 Span Model

```typescript
interface Span {
  /** Unique span ID */
  spanId: string;

  /** Parent span ID (null for root span) */
  parentSpanId: string | null;

  /** Trace ID — shared across all spans in the trace */
  traceId: string;

  /** Span name — dot-separated path */
  name: string;

  /** Component that created the span */
  component: LogComponent;

  /** Start timestamp (ISO 8601 UTC) */
  startTime: string;

  /** End timestamp (ISO 8601 UTC) — null if span is in progress */
  endTime: string | null;

  /** Duration in milliseconds */
  durationMs: number;

  /** Span status */
  status: "ok" | "error";

  /** Error information (if status is "error") */
  error?: {
    code: string;
    message: string;
  };

  /** Span attributes */
  attributes: Record<string, unknown>;

  /** Correlation ID (see Section 13) */
  correlationId: string;

  /** Session ID (if applicable) */
  sessionId?: string;

  /** Conversation ID (if applicable) */
  conversationId?: string;
}
```

### 8.3 Required Spans

| Span Name | Component | Parent | Description |
|---|---|---|---|
| `voice_interaction` | voice_sdk | (root) | Entire voice interaction |
| `sdk.initialize` | voice_sdk | `voice_interaction` | SDK client initialization |
| `sdk.create_session` | voice_sdk | `voice_interaction` | Session creation |
| `sdk.stop_session` | voice_sdk | `voice_interaction` | Session teardown |
| `session.create` | session_runtime | `sdk.create_session` | Session allocation |
| `session.recover` | session_runtime | `voice_interaction` | Session recovery |
| `dialogue.turn` | dialogue_runtime | `voice_interaction` | Single dialogue turn |
| `dialogue.think` | dialogue_runtime | `dialogue.turn` | Gateway wait |
| `dialogue.confirm` | dialogue_runtime | `dialogue.turn` | User confirmation |
| `dialogue.clarify` | dialogue_runtime | `dialogue.turn` | User clarification |
| `speech.listen` | speech_runtime | `dialogue.turn` | Audio capture + STT |
| `speech.recognize` | speech_runtime | `speech.listen` | STT recognition |
| `speech.speak` | speech_runtime | `dialogue.turn` | TTS synthesis + playback |
| `speech.synthesize` | speech_runtime | `speech.speak` | TTS synthesis |
| `speech.playback` | speech_runtime | `speech.speak` | Audio playback |
| `stream.receive` | streaming_runtime | `speech.listen` | Input stream |
| `stream.send` | streaming_runtime | `speech.speak` | Output stream |
| `stream.recover` | streaming_runtime | `voice_interaction` | Stream recovery |
| `gateway.request` | gateway_client | `dialogue.think` | Gateway API call |
| `gateway.stream` | gateway_client | `dialogue.turn` | Gateway streaming |
| `stt.recognize` | stt_provider | `speech.recognize` | Provider STT |
| `tts.synthesize` | tts_provider | `speech.synthesize` | Provider TTS |
| `transport.connect` | transport_provider | `voice_interaction` | Transport connect |
| `transport.send` | transport_provider | `stream.send` | Transport message |
| `transport.receive` | transport_provider | `stream.receive` | Transport message |

### 8.4 Span Attributes

| Span | Required Attributes |
|---|---|
| `voice_interaction` | `session_id`, `channel`, `language` |
| `dialogue.turn` | `turn_sequence`, `interrupted`, `duration_ms` |
| `gateway.request` | `request_id`, `conversation_id`, `retry_count`, `timeout_ms` |
| `stt.recognize` | `language`, `audio_duration_ms`, `transcript_confidence` |
| `tts.synthesize` | `language`, `voice`, `text_length`, `audio_duration_ms` |
| `stream.receive` | `chunks`, `bytes`, `latency_ms`, `buffer_occupancy` |
| `stream.send` | `chunks`, `bytes`, `latency_ms`, `buffer_occupancy` |

### 8.5 Trace Compliance Rules

| # | Rule |
|---|---|
| T-01 | Every voice interaction SHALL produce a complete trace |
| T-02 | Every span SHALL have `spanId`, `traceId`, `parentSpanId`, `name`, `startTime` |
| T-03 | `traceId` SHALL equal the correlation ID of the interaction |
| T-04 | Spans SHALL be closed (have `endTime`) when the operation completes |
| T-05 | Error spans SHALL have `status: "error"` and an `error` block |
| T-06 | Span emission SHALL NOT block the operation |
| T-07 | Span ID format: `span_{trace_id_short}_{component_short}_{sequence}` |

### 8.6 Trace Export

Traces SHALL be exported via the existing event pipeline:

- Span start → emit `telemetry.trace_span_started` event
- Span end → emit `telemetry.trace_span_completed` event
- A separate trace exporter SHALL consume these events and forward them to the tracing backend (Jaeger, Zipkin, or OpenTelemetry collector)

Trace events SHALL carry the full span payload in the event data field.

---

## 9. Trace Context Propagation

### 9.1 W3C Trace Context

The runtime SHALL use W3C Trace Context headers (`traceparent`, `tracestate`) for propagation across service boundaries:

- **`traceparent`**: `{version}-{trace_id}-{span_id}-{trace_flags}`
  - `version`: `00`
  - `trace_id`: 32 hex characters (same as correlation ID)
  - `span_id`: 16 hex characters
  - `trace_flags`: `01` (sampled) or `00` (not sampled)

- **`tracestate`**: Vendor-specific trace data

### 9.2 Internal Propagation

Within the runtime, trace context SHALL be propagated through the `correlationId` field on the `RuntimeEvent` envelope. Every component SHALL:

1. Receive trace context from upstream component (via event or method call)
2. Create child spans using the received `traceId` and `parentSpanId`
3. Pass the same `traceId` downstream as the `correlationId`

### 9.3 Gateway Propagation

The Gateway Client SHALL propagate trace context to the Conversation Gateway by:

1. Adding the `traceparent` header to the TCGP HTTP request
2. Adding the `correlationId` to the ChatRequest envelope (mapped to TCGP's correlation field)

---

## 10. Health Checks

### 10.1 Component Health Types

Every runtime component SHALL expose a `health()` method returning a component-specific health type:

#### ProviderHealth (Section 11 of TVR-PCS-001)

```typescript
interface ProviderHealth {
  healthy: boolean;
  latencyMs: number;
  lastHeartbeat: Date;
  message?: string;
}
```

#### RuntimeHealth (Speech Runtime)

```typescript
interface RuntimeHealth {
  healthy: boolean;
  sttConnected: boolean;
  ttsConnected: boolean;
  audioInputActive: boolean;
  audioOutputActive: boolean;
  uptimeMs: number;
  lastError?: string;
}
```

#### StreamHealth

```typescript
interface StreamHealth {
  healthy: boolean;
  state: StreamState;
  latencyMs: number;
  bufferOccupancyPercent: number;
  heartbeatsMissed: number;
  lastHeartbeatAt: Date | null;
  message?: string;
}
```

#### SessionHealth

```typescript
interface SessionHealth {
  healthy: boolean;
  state: SessionState;
  uptimeMs: number;
  idleMs: number;
  heartbeatsMissed: number;
  lastActivityAt: Date;
  message?: string;
}
```

#### SessionRuntimeHealth

```typescript
interface SessionRuntimeHealth {
  healthy: boolean;
  activeSessions: number;
  suspendedSessions: number;
  totalSessionsCreated: number;
  totalSessionsClosed: number;
  uptimeMs: number;
  errors: string[];
}
```

#### GatewayClientHealth

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

#### SDKHealth

```typescript
interface SDKHealth {
  healthy: boolean;
  initialized: boolean;
  connected: boolean;
  sessionActive: boolean;
  state: VoiceClientState;
  message?: string;
}
```

### 10.2 Aggregate Runtime Health

```typescript
interface VoiceRuntimeHealth {
  /** Overall runtime health */
  healthy: boolean;

  /** Runtime instance identifier */
  instanceId: string;

  /** Runtime environment */
  environment: string;

  /** Runtime uptime */
  uptimeMs: number;

  /** Component-level health */
  components: {
    speech: RuntimeHealth;
    streaming: StreamHealth;
    session: SessionRuntimeHealth;
    gateway: GatewayClientHealth;
    providers: Record<string, ProviderHealth>;
  };

  /** Aggregate state information */
  state: {
    activeSessions: number;
    suspendedSessions: number;
    activeStreams: number;
    totalErrors: number;
  };

  /** Timestamp of this health report */
  timestamp: string;
}
```

### 10.3 Health Check Endpoint

The Voice Runtime SHALL expose a health check endpoint (HTTP GET) at `/health`:

```typescript
// Response when healthy
HTTP 200
{
  "status": "healthy",
  "instanceId": "voice-prod-1",
  "uptimeMs": 3600000,
  "components": { ... },
  "timestamp": "2026-07-30T12:00:00.000Z"
}

// Response when degraded
HTTP 200
{
  "status": "degraded",
  "instanceId": "voice-prod-1",
  "uptimeMs": 3600000,
  "components": {
    "speech": { "healthy": true, ... },
    "streaming": { "healthy": true, ... },
    "session": { "healthy": true, ... },
    "gateway": { "healthy": true, ... },
    "providers": {
      "google-stt-1": { "healthy": false, "message": "Rate limited", ... }
    }
  },
  "timestamp": "..."
}

// Response when unhealthy
HTTP 503
{
  "status": "unhealthy",
  "instanceId": "voice-prod-1",
  "uptimeMs": 3600000,
  "components": { ... },
  "error": "Speech Runtime: STT provider connection lost",
  "timestamp": "..."
}
```

### 10.4 Health Check Compliance Rules

| # | Rule |
|---|---|
| H-01 | Every component SHALL expose a `health()` method |
| H-02 | `health()` SHALL never throw |
| H-03 | The aggregate `/health` endpoint SHALL return within 1000 ms |
| H-04 | A component is `healthy` if it can process requests — partial degradation is `degraded`, not `unhealthy` |
| H-05 | A component is `unhealthy` only if it cannot process any requests |
| H-06 | Provider health SHALL be checked at least once per `healthReportIntervalMs` |
| H-07 | Provider health failures SHALL NOT cascade to parent component health (a single failed provider is `degraded`, not `unhealthy`) |

---

## 11. Health Event Emission

| Event Name | Emitted When | Payload |
|---|---|---|
| `telemetry.runtime_healthy` | Aggregate health check returns all healthy | `{ component: "voice_runtime", uptimeMs, healthy: true }` |
| `telemetry.runtime_unhealthy` | Aggregate health check returns unhealthy | `{ component: "voice_runtime", uptimeMs, healthy: false, error }` |
| `telemetry.heartbeat` | Periodic heartbeat (every `healthReportIntervalMs`) | `{ component, uptimeMs, healthy }` |
| `telemetry.metrics_snapshot` | Periodic metrics dump (every `healthReportIntervalMs`) | `{ component, uptimeMs, metrics: { ... } }` |
| `telemetry.provider_healthy` | Provider health check passes | `{ component: providerId, uptimeMs, healthy: true, latencyMs }` |
| `telemetry.provider_unhealthy` | Provider health check fails | `{ component: providerId, uptimeMs, healthy: false, error }` |
| `telemetry.provider_recovered` | Provider returns to healthy | `{ component: providerId, uptimeMs, healthy: true }` |

---

## 12. Runtime Diagnostics

### 12.1 Diagnostics Endpoint

The runtime SHALL expose a diagnostics endpoint (HTTP GET) at `/debug/diagnostics` that returns detailed internal state for debugging purposes. This endpoint SHALL NOT be exposed in production without authentication.

```typescript
interface RuntimeDiagnostics {
  /** Runtime identity */
  instanceId: string;
  environment: string;
  version: string;
  uptimeMs: number;

  /** Process-level information */
  process: {
    memoryUsageMb: number;
    cpuUsagePercent: number;
    eventLoopLagMs: number;
    activeHandles: number;
    activeRequests: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMemoryMb: number;
  };

  /** Component states */
  states: {
    speech: SpeechRuntimeState;
    streaming: StreamingRuntimeState;
    dialogue: DialogueState;
    session: SessionRuntimeState;
    gateway: boolean; // initialized
    providers: Record<string, ProviderState>;
  };

  /** Active resource counts */
  resources: {
    activeSessions: number;
    suspendedSessions: number;
    activeStreams: number;
    pendingGatewayRequests: number;
    activeProviderOperations: number;
  };

  /** Configuration (redacted — no secrets) */
  configuration: {
    speech?: Record<string, unknown>;
    streaming?: Record<string, unknown>;
    dialogue?: Record<string, unknown>;
    session?: Record<string, unknown>;
    gateway?: Record<string, unknown>;
  };

  /** Recent errors (last 100) */
  recentErrors: Array<{
    timestamp: string;
    component: string;
    code: string;
    message: string;
    correlationId?: string;
    sessionId?: string;
  }>;

  /** Provider status summary */
  providers: Array<{
    providerId: string;
    type: string;
    state: ProviderState;
    healthy: boolean;
    latencyMs: number;
    uptimeMs: number;
    errorCount: number;
  }>;

  /** Timestamp */
  timestamp: string;
}
```

### 12.2 Diagnostics Compliance Rules

| # | Rule |
|---|---|
| D-01 | Diagnostics endpoint SHALL exist in development and staging environments |
| D-02 | Diagnostics endpoint SHALL require authentication in production (or be disabled) |
| D-03 | Diagnostics SHALL NOT expose credentials, API keys, or tokens |
| D-04 | Diagnostics SHALL complete within 5000 ms |
| D-05 | Diagnostics SHALL NOT lock or block any component to read state |

---

## 13. Correlation IDs

### 13.1 ID Format

```
corr_{timestamp_ms}_{random_base36}_{sequence}
```

- `timestamp_ms`: Unix timestamp in milliseconds (13 digits)
- `random_base36`: 8-character random alphanumeric (base36)
- `sequence`: 2-digit sequence number for correlation IDs created in rapid succession

Example: `corr_1722345600000_a1b2c3d4_00`

### 13.2 Generation Rules

| # | Rule |
|---|---|
| CI-01 | A new correlation ID SHALL be generated when a voice interaction begins (SDK `startSession()`) |
| CI-02 | The same correlation ID SHALL propagate through all components for the duration of the interaction |
| CI-03 | If an interaction creates a sub-interaction (e.g., recovery), a new correlation ID MAY be generated and linked to the parent via a `parentCorrelationId` field |
| CI-04 | Correlation IDs SHALL be unique across all interactions |

### 13.3 Propagation Rules

```
SDK startSession()
  │
  ├── generate correlationId = "corr_1722345600000_a1b2c3d4_00"
  │
  ├── Session Runtime: receives correlationId, uses for all session events
  ├── Speech Runtime: receives correlationId, uses for all speech events
  ├── Dialogue Runtime: receives correlationId, uses for all dialogue events
  ├── Streaming Runtime: receives correlationId, uses for all stream events
  ├── Gateway Client: receives correlationId, passes to Gateway as correlation ID
  └── Providers: receive correlationId, use for all provider events
```

| # | Rule |
|---|---|
| CI-05 | Every `RuntimeEvent` SHALL carry a `correlationId` |
| CI-06 | Every log record SHALL carry a `correlationId` when within an interaction context |
| CI-07 | Every span SHALL carry the interaction's `correlationId` as the `traceId` |
| CI-08 | Every gateway request SHALL include the `correlationId` in the request envelope |
| CI-09 | Components SHALL pass the `correlationId` to downstream components in method calls |

### 13.4 Parent-Child Correlation

When a new correlation ID is generated (e.g., for recovery), the parent relationship SHALL be preserved:

```typescript
interface CorrelationContext {
  correlationId: string;
  parentCorrelationId?: string;
  traceId: string;
  spanId: string;
}
```

---

## 14. Telemetry Events

### 14.1 Periodic Telemetry

The runtime SHALL emit telemetry events at a configurable interval (`healthReportIntervalMs`, default 30s):

| Event | Interval | Payload |
|---|---|---|
| `telemetry.heartbeat` | Every `healthReportIntervalMs` | `{ component, uptimeMs, healthy }` |
| `telemetry.metrics_snapshot` | Every `healthReportIntervalMs` | `{ component, uptimeMs, metrics: { ... } }` |

### 14.2 Event-Driven Telemetry

| Event | Trigger | Payload |
|---|---|---|
| `telemetry.runtime_healthy` | Health check becomes healthy | `{ component: "voice_runtime", uptimeMs, healthy: true }` |
| `telemetry.runtime_unhealthy` | Health check becomes unhealthy | `{ component: "voice_runtime", uptimeMs, healthy: false, error }` |
| `telemetry.provider_healthy` | Provider health becomes healthy | `{ component: providerId, uptimeMs, healthy: true, latencyMs }` |
| `telemetry.provider_unhealthy` | Provider health becomes unhealthy | `{ component: providerId, uptimeMs, healthy: false, error }` |
| `telemetry.provider_recovered` | Provider returns from unhealthy | `{ component: providerId, uptimeMs, healthy: true }` |
| `telemetry.trace_span_started` | Span begins | Full span payload |
| `telemetry.trace_span_completed` | Span ends | Full span payload |

---

## 15. Dashboards

### 15.1 Dashboard Principles

1. **Every metric has a panel.** No metric defined in Section 6 is hidden.
2. **Panels show time series.** All panels SHALL display data over a configurable time range (default: last 1 hour, max: last 7 days).
3. **Panels are grouped by component.** Each component has a dedicated dashboard section.
4. **Critical metrics have alerts.** Panels for metrics with alerting rules (Section 16) SHALL be visually marked.
5. **Dashboards are versioned.** Dashboard definitions SHALL be checked into source control.

### 15.2 Dashboard Sections

#### Section 1: Runtime Overview

| Panel | Metric | Type | Description |
|---|---|---|---|
| Uptime | `tradeos_voice_runtime_uptime_seconds` | Stat | Current uptime |
| Health Status | `tradeos_voice_runtime_healthy` | Stat | 1 = healthy, 0 = unhealthy |
| Active Sessions | `tradeos_voice_session_active_sessions` | Time series | Current session count |
| Active Streams | `tradeos_voice_streaming_active_streams` | Time series | Current stream count |
| Error Rate | Sum of all `_errors_total` metrics | Time series (rate) | Errors per second |

#### Section 2: Gateway

| Panel | Metric | Type |
|---|---|---|
| Request Rate | `tradeos_voice_gateway_requests_total` | Rate (req/s) |
| Request Latency (p50/p95/p99) | `tradeos_voice_gateway_request_duration_ms` | Histogram quantiles |
| Error Rate | `tradeos_voice_gateway_errors_total` | Rate (errors/s) |
| Retry Rate | `tradeos_voice_gateway_retries_total` | Rate (retries/s) |
| Timeout Rate | `tradeos_voice_gateway_timeouts_total` | Rate (timeouts/s) |

#### Section 3: Speech Runtime

| Panel | Metric | Type |
|---|---|---|
| Recognition Rate | `tradeos_voice_speech_recognition_total` | Rate (results/s) |
| Recognition Latency (p50/p95) | `tradeos_voice_speech_recognition_duration_ms` | Histogram quantiles |
| Synthesis Rate | `tradeos_voice_speech_synthesis_total` | Rate (requests/s) |
| Synthesis Latency (p50/p95) | `tradeos_voice_speech_synthesis_duration_ms` | Histogram quantiles |
| Audio Throughput | `tradeos_voice_speech_audio_bytes_processed` | Rate (bytes/s) |
| VAD Detections | `tradeos_voice_speech_vad_detections_total` | Rate (detections/s) |

#### Section 4: Streaming

| Panel | Metric | Type |
|---|---|---|
| Stream Rate | `tradeos_voice_streaming_streams_total` | Rate (streams/s) |
| Chunk Throughput | `tradeos_voice_streaming_chunks_sent_total` + `_received_total` | Rate (chunks/s) |
| Byte Throughput | `tradeos_voice_streaming_bytes_sent_total` + `_bytes_received_total` | Rate (bytes/s) |
| Buffer Occupancy | `tradeos_voice_streaming_buffer_occupancy` | Time series (%) |
| Buffer Overflow Rate | `tradeos_voice_streaming_buffer_overflows_total` | Rate (events/s) |
| Streaming Latency (p50/p95) | `tradeos_voice_streaming_latency_ms` | Histogram quantiles |
| Jitter (p50/p95) | `tradeos_voice_streaming_jitter_ms` | Histogram quantiles |
| Recovery Rate | `tradeos_voice_streaming_recoveries_total` | Rate (recoveries/s) |

#### Section 5: Dialogue

| Panel | Metric | Type |
|---|---|---|
| Turn Rate | `tradeos_voice_dialogue_turns_total` | Rate (turns/s) |
| Turn Duration (p50/p95) | `tradeos_voice_dialogue_turn_duration_ms` | Histogram quantiles |
| Thinking Time (p50/p95) | `tradeos_voice_dialogue_thinking_duration_ms` | Histogram quantiles |
| Confirmation Rate | `tradeos_voice_dialogue_confirmations_total` | Rate (requests/s) |
| Interruption Rate | `tradeos_voice_dialogue_interruptions_total` | Rate (interrupts/s) |

#### Section 6: Session

| Panel | Metric | Type |
|---|---|---|
| Session Create Rate | `tradeos_voice_session_sessions_total` | Rate (sessions/s) |
| Session Duration (p50/p95) | `tradeos_voice_session_session_duration_ms` | Histogram quantiles |
| Session Recovery Rate | `tradeos_voice_session_recoveries_total` | Rate (recoveries/s) |

#### Section 7: Providers

| Panel | Metric | Type |
|---|---|---|
| Provider Health | `tradeos_voice_provider_healthy` | Time series per provider |
| Provider Operation Rate | `tradeos_voice_provider_operations_total` | Rate (ops/s) per provider |
| Provider Latency (p50/p95) | `tradeos_voice_provider_operation_duration_ms` | Histogram quantiles per provider |
| Provider Error Rate | `tradeos_voice_provider_errors_total` | Rate (errors/s) per provider |

#### Section 8: SDK

| Panel | Metric | Type |
|---|---|---|
| Active Clients | `tradeos_voice_sdk_active_session` | Time series per client type |
| Audio Captured | `tradeos_voice_sdk_audio_bytes_captured` | Rate (bytes/s) |
| Audio Played | `tradeos_voice_sdk_audio_bytes_played` | Rate (bytes/s) |

### 15.3 Dashboard Example (Grafana JSON)

```json
{
  "title": "TradeOS Voice Runtime",
  "version": 1,
  "time": { "from": "now-1h", "to": "now" },
  "panels": [
    {
      "title": "Active Sessions",
      "type": "graph",
      "targets": [{
        "expr": "tradeos_voice_session_active_sessions{environment=\"$env\"}",
        "legendFormat": "{{instance_id}}"
      }]
    }
    // ... one panel per metric in Section 15.2
  ]
}
```

---

## 16. Alerting Recommendations

### 16.1 Alert Severity Levels

| Severity | Label | Response Time | Description |
|---|---|---|---|
| P0 | Critical | 5 minutes | Complete service outage |
| P1 | High | 15 minutes | Severe degradation affecting many users |
| P2 | Medium | 1 hour | Partial degradation or error spike |
| P3 | Low | 24 hours | Warning — may become problem |
| P4 | Info | No SLA | Informational — no action required |

### 16.2 Alerting Rules

#### Availability Alerts

| Rule | Metric | Condition | Severity | Duration |
|---|---|---|---|---|
| Runtime unhealthy | `tradeos_voice_runtime_healthy` | `== 0` | P0 | 1m |
| All providers unhealthy | `tradeos_voice_provider_healthy` | `== 0` for all providers | P0 | 1m |
| Gateway unavailable | `tradeos_voice_gateway_requests_total` | Rate == 0 for 5m | P1 | 5m |

#### Latency Alerts

| Rule | Metric | Condition | Severity | Duration |
|---|---|---|---|---|
| Gateway p99 high | `tradeos_voice_gateway_request_duration_ms` p99 | `> 30s` | P1 | 5m |
| Gateway p95 high | `tradeos_voice_gateway_request_duration_ms` p95 | `> 10s` | P2 | 10m |
| STT latency high | `tradeos_voice_speech_recognition_duration_ms` p95 | `> 5s` | P2 | 10m |
| TTS latency high | `tradeos_voice_speech_synthesis_duration_ms` p95 | `> 5s` | P2 | 10m |
| Streaming latency high | `tradeos_voice_streaming_latency_ms` p95 | `> 1000ms` | P2 | 5m |
| Dialogue thinking time high | `tradeos_voice_dialogue_thinking_duration_ms` p95 | `> 20s` | P2 | 10m |

#### Error Rate Alerts

| Rule | Metric | Condition | Severity | Duration |
|---|---|---|---|---|
| Gateway error rate spike | Rate of `tradeos_voice_gateway_errors_total` | `> 5%` of total requests | P1 | 5m |
| Provider error rate spike | Rate of `tradeos_voice_provider_errors_total` | `> 10%` per provider | P2 | 5m |
| Streaming buffer overflows | Rate of `tradeos_voice_streaming_buffer_overflows_total` | `> 1/s` | P2 | 5m |
| Audio device errors | Rate of `error.audio_device` events | `> 0` | P2 | Immediate |

#### Resource Exhaustion Alerts

| Rule | Metric | Condition | Severity | Duration |
|---|---|---|---|---|
| Max sessions reached | `tradeos_voice_session_active_sessions` | `== maxSessions` for 1m | P2 | 1m |
| Memory high | `process.memoryUsageMb` (diagnostics) | `> 80%` of heapTotal | P2 | 5m |
| Event loop lag | `process.eventLoopLagMs` (diagnostics) | `> 100ms` | P2 | 5m |

#### Recovery Alerts

| Rule | Metric | Condition | Severity | Duration |
|---|---|---|---|---|
| Stream recovery failures | Rate of `tradeos_voice_streaming_recoveries_total{result="failed"}` | `> 0` | P2 | 1m |
| Session recovery failures | Rate of `tradeos_voice_session_recoveries_total{result="failed"}` | `> 0` | P2 | 1m |
| Dialogue recovery failures | Rate of `tradeos_voice_dialogue_recoveries_total{result="failed"}` | `> 0` | P2 | 1m |

### 16.3 Alert Notification Channels

| Severity | Channels |
|---|---|
| P0 | PagerDuty, Slack #on-call, SMS |
| P1 | PagerDuty, Slack #alerts |
| P2 | Slack #alerts |
| P3 | Slack #warnings |
| P4 | None (logged to #info) |

---

## 17. Compliance Requirements

### 17.1 Implementation Compliance

Every Voice Runtime implementation SHALL:

| # | Requirement | Verification |
|---|---|---|
| O-01 | Produce structured JSON logs per Section 3.2 | Log format test |
| O-02 | Support all 5 log levels | Configuration test |
| O-03 | Support component-level log level overrides | Integration test |
| O-04 | Expose every metric from Section 6 | Contract test |
| O-05 | Every metric carries all labels from Section 5.4 | Contract test |
| O-06 | Support push and pull metric emission | Integration test |
| O-07 | Produce distributed traces per Section 8 | Integration test |
| O-08 | Propagate W3C trace context per Section 9 | Integration test |
| O-09 | Expose `health()` on every component per Section 10 | Contract test |
| O-10 | Aggregate health via `/health` endpoint per Section 10.3 | Integration test |
| O-11 | Expose diagnostics via `/debug/diagnostics` per Section 12.1 | Integration test |
| O-12 | Generate and propagate correlation IDs per Section 13 | Integration test |
| O-13 | Emit all telemetry events per Section 14 | Contract test |

### 17.2 Release Gating

| Suite | Min Pass Rate | Critical Failures | Blocks Release |
|---|---|---|---|
| Log format compliance | 100% | Any | Yes |
| Metrics exposure | 100% | Any | Yes |
| Trace production | 100% | 0 | Yes |
| Health check compliance | 100% | Any | Yes |
| Correlation ID compliance | 100% | Any | Yes |
| Telemetry event emission | 100% | 0 | Yes |

### 17.3 Security and Privacy

| # | Rule |
|---|---|
| S-01 | Logs SHALL NOT contain PII — user identifiers SHALL be pseudonymized |
| S-02 | Logs SHALL NOT contain credentials, API keys, tokens, or session content |
| S-03 | Metrics SHALL NOT contain user identifiers or session content |
| S-04 | Traces SHALL NOT contain user identifiers or session content |
| S-05 | Diagnostics endpoint SHALL require authentication in production |
| S-06 | All observability data in transit SHALL use TLS |

---

## 18. Appendix A — Log Record Examples

### Info: Session Created

```json
{
  "timestamp": "2026-07-30T12:00:00.000Z",
  "level": "info",
  "component": "session_runtime",
  "message": "session_runtime.session.create",
  "description": "Voice session created",
  "correlationId": "corr_1722345600000_a1b2c3d4_00",
  "sessionId": "sess_abc123",
  "instanceId": "voice-prod-1",
  "environment": "production",
  "data": {
    "channel": "web",
    "language": "en-US"
  }
}
```

### Error: Provider Timeout

```json
{
  "timestamp": "2026-07-30T12:00:05.000Z",
  "level": "error",
  "component": "stt_provider",
  "message": "stt_provider.recognition.timeout",
  "description": "STT recognition timed out",
  "correlationId": "corr_1722345600000_a1b2c3d4_00",
  "sessionId": "sess_abc123",
  "providerId": "google-stt-1",
  "instanceId": "voice-prod-1",
  "environment": "production",
  "data": {
    "operation": "startRecognition",
    "timeoutMs": 10000
  },
  "error": {
    "code": "TIMEOUT",
    "message": "Provider google-stt-1 operation startRecognition timed out after 10000ms",
    "stack": "ProviderError: ..."
  }
}
```

---

## 19. Appendix B — Metrics Export Configuration

```typescript
interface MetricsExportConfiguration {
  /** Metrics export endpoint */
  endpoint?: string;

  /** Export interval in seconds (default: 30) */
  exportIntervalSec?: number;

  /** Export format */
  format: "prometheus" | "opentelemetry" | "json";

  /** Additional labels to attach to all metrics */
  extraLabels?: Record<string, string>;

  /** Enable histogram metrics */
  enableHistograms?: boolean;

  /** Histogram bucket definitions */
  histogramBuckets?: Record<string, number[]>;
}
```

Default values:

| Field | Default |
|---|---|
| `exportIntervalSec` | `30` |
| `format` | `"prometheus"` |
| `enableHistograms` | `true` |

---

## 20. Appendix C — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. Structured logging, 8-component metrics, distributed tracing with 25 spans, 7 health types, diagnostics endpoint, correlation ID format and propagation, telemetry events, 8-section dashboard, 18 alerting rules across 5 severities, compliance matrix. |
