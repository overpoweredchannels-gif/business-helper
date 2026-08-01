# TradeOS Voice Runtime — Canonical Event Model

Document ID: TVR-EM-001
Title: TradeOS Voice Runtime Event Model Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_VOICE_SDK_SPEC.md (TVR-VSDK-001)

---

## 1. Purpose

This specification defines the canonical event model for every component within the TradeOS Voice Runtime. It establishes a single, immutable contract for how events are structured, named, categorized, ordered, delivered, and traced across all runtime boundaries.

Every runtime component (Provider, Speech, Streaming, Dialogue, Session, Gateway Client) and the top-level SDK SHALL emit events that conform to this model. No component may define its own event format.

The event model serves three purposes:

1. **Observability** — Every state change, data flow, and error is captured as a structured event that monitoring and debugging tools can consume.
2. **Decoupling** — Components communicate through events without importing each other's types or calling each other's methods directly where event-driven interaction is specified.
3. **Audit** — Every significant runtime occurrence is recorded with enough context (correlation ID, session ID, timestamp, producer) to reconstruct the sequence of events for any voice session.

---

## 2. Event Philosophy

### 2.1 Events are facts

Every event represents something that has already happened. Events are immutable after emission. There is no "cancel" or "unsend" operation.

### 2.2 Events are ordered per producer

Events produced by a single component SHALL be delivered in emission order. Events from different producers have no defined relative ordering.

### 2.3 Events carry context

Every event SHALL carry enough context (correlation ID, session ID, conversation ID, producer identity) to be useful in isolation. Consumers SHALL NOT need to correlate across events to understand a single event's meaning.

### 2.4 Events are versioned

The event envelope and every event payload SHALL carry a version number. Consumers MAY reject events with unknown versions.

### 2.5 Events are not commands

Events signal that something happened. They are not instructions to do something. Command patterns SHALL use direct method calls, not events.

### 2.6 Events are fire-and-forget

Producers SHALL NOT await consumer processing. Consumers SHALL NOT block producers. Event delivery is asynchronous and non-blocking.

### 2.7 Events are lossy-tolerant

The runtime SHALL function correctly even if some events are dropped (e.g., under backpressure). Critical state transitions SHALL be enforced by the state machine, not by event delivery guarantees.

---

## 3. Event Envelope

Every event in the Voice Runtime SHALL conform to the following envelope:

```typescript
interface RuntimeEvent {
  /** Schema version of this envelope (currently "1.0") */
  version: string;

  /** Unique identifier for this specific event instance */
  id: string;

  /** Event name — a dot-separated path identifying the event */
  name: string;

  /** ISO 8601 UTC timestamp of when the event was emitted */
  timestamp: string;

  /** Component that produced this event */
  producer: EventProducer;

  /** Component categories that should receive this event */
  consumer: EventConsumer;

  /** Runtime category this event belongs to */
  category: EventCategory;

  /** Severity / importance level */
  level: EventLevel;

  /** Correlation ID for end-to-end tracing */
  correlationId: string;

  /** Session ID if the event occurred within a voice session */
  sessionId?: string;

  /** Conversation ID if the event is associated with a gateway conversation */
  conversationId?: string;

  /** Provider ID if the event originated from a provider */
  providerId?: string;

  /** Stream ID if the event originated from a stream */
  streamId?: string;

  /** Dialogue turn sequence number if applicable */
  turnSequence?: number;

  /** Retry attempt number if applicable */
  attempt?: number;

  /** Event-specific payload */
  payload: Record<string, unknown>;
}
```

### 3.1 EventProducer

```typescript
type EventProducer =
  | "voice_sdk"
  | "session_runtime"
  | "dialogue_runtime"
  | "speech_runtime"
  | "streaming_runtime"
  | "gateway_client"
  | "stt_provider"
  | "tts_provider"
  | "transport_provider";
```

### 3.2 EventConsumer

```typescript
type EventConsumer =
  | "external_client"    // Emitted to the SDK client application
  | "internal_runtime"   // Consumed by other runtime components
  | "monitoring"         // Consumed by observability infrastructure
  | "all";               // Emitted to all consumers
```

### 3.3 EventCategory

```typescript
type EventCategory =
  | "lifecycle"
  | "session"
  | "streaming"
  | "speech"
  | "dialogue"
  | "gateway"
  | "playback"
  | "interruption"
  | "configuration"
  | "telemetry"
  | "provider"
  | "recovery"
  | "error";
```

### 3.4 EventLevel

```typescript
type EventLevel =
  | "debug"
  | "info"
  | "warning"
  | "error"
  | "critical";
```

---

## 4. Event Metadata

### 4.1 Event ID generation

```
event_id = evt_{producer_short}_{timestamp_ms}_{random_base36}
```

Example: `evt_sr_1785364271000_a8f3k2`

### 4.2 Correlation ID propagation

1. Every event SHALL carry a `correlationId`.
2. If the event is emitted within an active session, the correlation ID SHALL be the session's current correlation ID.
3. If the event is emitted outside a session, the correlation ID SHALL be generated for that event:
   ```
   corr_evt_{timestamp_ms}_{random_base36}
   ```
4. Components SHALL propagate the correlation ID from the triggering operation to all events emitted during that operation.

### 4.3 Session ID inclusion

1. If the event is emitted within an active voice session, `sessionId` SHALL be set.
2. Session-scoped events without a `sessionId` SHALL be considered invalid.

### 4.4 Conversation ID inclusion

1. If the event relates to a Conversation Gateway interaction, `conversationId` SHALL be set.
2. Gateway-scoped events without a `conversationId` SHALL be considered invalid.

### 4.5 Timestamp format

All timestamps SHALL use ISO 8601 UTC format with millisecond precision:

```
2026-07-30T12:34:56.789Z
```

### 4.6 Version field

The `version` field SHALL be `"1.0"` for this version of the event model. When the envelope schema changes, this version SHALL be incremented according to the versioning policy in Section 15.

---

## 5. Event Categories

### 5.1 Lifecycle Events

Events tracking the initialization, start, stop, and disposal of runtime components.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `lifecycle.provider.initialized` | Provider initialized successfully | stt_provider, tts_provider, transport_provider | internal_runtime, monitoring | info |
| `lifecycle.provider.started` | Provider entered running state | stt_provider, tts_provider, transport_provider | internal_runtime | info |
| `lifecycle.provider.stopped` | Provider stopped | stt_provider, tts_provider, transport_provider | internal_runtime | info |
| `lifecycle.provider.disposed` | Provider resources released | stt_provider, tts_provider, transport_provider | internal_runtime | info |
| `lifecycle.speech.initialized` | Speech Runtime initialized | speech_runtime | internal_runtime | info |
| `lifecycle.speech.started` | Speech Runtime entered running state | speech_runtime | internal_runtime | info |
| `lifecycle.speech.stopped` | Speech Runtime stopped | speech_runtime | internal_runtime | info |
| `lifecycle.speech.disposed` | Speech Runtime resources released | speech_runtime | internal_runtime | info |
| `lifecycle.streaming.initialized` | Streaming Runtime initialized | streaming_runtime | internal_runtime | info |
| `lifecycle.streaming.started` | Streaming Runtime entered running state | streaming_runtime | internal_runtime | info |
| `lifecycle.streaming.stopped` | Streaming Runtime stopped | streaming_runtime | internal_runtime | info |
| `lifecycle.streaming.disposed` | Streaming Runtime resources released | streaming_runtime | internal_runtime | info |
| `lifecycle.dialogue.initialized` | Dialogue Runtime initialized | dialogue_runtime | internal_runtime | info |
| `lifecycle.dialogue.started` | Dialogue Runtime entered running state | dialogue_runtime | internal_runtime | info |
| `lifecycle.dialogue.stopped` | Dialogue Runtime stopped | dialogue_runtime | internal_runtime | info |
| `lifecycle.dialogue.disposed` | Dialogue Runtime resources released | dialogue_runtime | internal_runtime | info |
| `lifecycle.session.initialized` | Session Runtime initialized | session_runtime | internal_runtime | info |
| `lifecycle.session.started` | Session Runtime entered running state | session_runtime | internal_runtime | info |
| `lifecycle.session.stopped` | Session Runtime stopped | session_runtime | internal_runtime | info |
| `lifecycle.session.disposed` | Session Runtime resources released | session_runtime | internal_runtime | info |
| `lifecycle.gateway_client.initialized` | Gateway Client initialized | gateway_client | internal_runtime | info |
| `lifecycle.gateway_client.stopped` | Gateway Client stopped | gateway_client | internal_runtime | info |
| `lifecycle.gateway_client.disposed` | Gateway Client resources released | gateway_client | internal_runtime | info |
| `lifecycle.sdk.initialized` | SDK client initialized | voice_sdk | external_client, monitoring | info |
| `lifecycle.sdk.connected` | SDK client connected to runtime | voice_sdk | external_client | info |
| `lifecycle.sdk.disconnected` | SDK client disconnected from runtime | voice_sdk | external_client, monitoring | info |
| `lifecycle.sdk.disposed` | SDK client disposed | voice_sdk | external_client, monitoring | info |

#### Payload Schema

```typescript
interface LifecycleEventPayload {
  component: string;
  version: string;
  state: string;
  durationMs?: number;
  error?: string;
}
```

#### Ordering Rules

1. Lifecycle events for a single component SHALL be emitted in order: initialized → started → stopped → disposed.
2. A `started` event without a preceding `initialized` event SHALL be considered an invalid runtime state.
3. A `disposed` event without a preceding `stopped` event SHALL imply the component stopped implicitly during disposal.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No (lossy-tolerant) |
| In-order per producer | Yes |
| In-order across producers | No |
| Synchronous | No |

#### Versioning

Lifecycle event payloads are versioned with the envelope version (`1.0`). If a new lifecycle state is added, it becomes a new event name rather than changing the payload schema.

#### Correlation IDs

1. Lifecycle events emitted during runtime initialization SHALL use a correlation ID generated at startup.
2. Lifecycle events emitted during a session SHALL use the session's correlation ID.

#### Idempotency Rules

Lifecycle events are not idempotent. Duplicate lifecycle events MAY be emitted (e.g., during recovery) and consumers SHALL handle duplicates gracefully by comparing state.

---

### 5.2 Session Events

Events tracking voice session lifecycle and state transitions.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `session.created` | Session allocated with unique ID | session_runtime | internal_runtime | info |
| `session.initialized` | Session configuration applied | session_runtime | internal_runtime | info |
| `session.activated` | Session transitioned to active | session_runtime | dialogue_runtime, monitoring | info |
| `session.idle` | Session entered idle state | session_runtime | dialogue_runtime, monitoring | warning |
| `session.suspended` | Session suspended | session_runtime | internal_runtime | info |
| `session.resumed` | Session transitioned to active from suspended | session_runtime | dialogue_runtime | info |
| `session.recovered` | Session recovered after interruption | session_runtime | dialogue_runtime, monitoring | info |
| `session.closing` | Session entering closing state | session_runtime | internal_runtime | info |
| `session.closed` | Session fully shut down | session_runtime | dialogue_runtime, monitoring | info |
| `session.disposed` | Session resources released | session_runtime | internal_runtime | info |
| `session.failed` | Session encountered unrecoverable error | session_runtime | dialogue_runtime, monitoring | error |
| `session.heartbeat` | Heartbeat acknowledged for session | session_runtime | monitoring | debug |
| `session.heartbeat_missed` | Expected heartbeat not received | session_runtime | recovery_manager | warning |
| `session.idle_warning` | Session idle time approaching timeout | session_runtime | dialogue_runtime, monitoring | warning |
| `session.expiring` | Session duration approaching maximum | session_runtime | external_client | warning |
| `session.timeout` | Session exceeded idle or max duration | session_runtime | dialogue_runtime | error |
| `session.sdk.started` | Voice session started by SDK client | voice_sdk | external_client | info |
| `session.sdk.ended` | Voice session ended by SDK client | voice_sdk | external_client | info |

#### Payload Schema

```typescript
interface SessionEventPayload {
  sessionId: string;
  conversationId?: string;
  state: string;
  previousState?: string;
  idleTimeMs?: number;
  elapsedTimeMs?: number;
  durationMs?: number;
  reason?: string;
  heartbeatsMissed?: number;
  error?: string;
}
```

#### Ordering Rules

1. Session lifecycle events SHALL follow the session lifecycle defined in TVR-SESR-001.
2. A `session.activated` event SHALL NOT follow `session.closed` for the same session.
3. Heartbeat events SHALL be independent of lifecycle ordering.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No (lossy-tolerant) |
| In-order per session | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Session event payloads are versioned with the envelope version. New session states result in new event names.

#### Correlation IDs

All session events SHALL carry the session's correlation ID.

#### Idempotency Rules

Duplicate `session.activated` events MAY occur during recovery. Consumers SHALL check the current session state before acting on an activation event.

---

### 5.3 Streaming Events

Events tracking audio stream lifecycle, chunk flow, and buffer status.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `stream.created` | Stream allocated | streaming_runtime | internal_runtime | info |
| `stream.initialized` | Stream configuration applied | streaming_runtime | internal_runtime | info |
| `stream.connecting` | Stream connecting to transport | streaming_runtime | internal_runtime | info |
| `stream.connected` | Stream transport established | streaming_runtime | internal_runtime | info |
| `stream.started` | Stream chunk flow begun | streaming_runtime | monitoring | info |
| `stream.paused` | Stream paused | streaming_runtime | internal_runtime | info |
| `stream.resumed` | Stream resumed | streaming_runtime | internal_runtime | info |
| `stream.stopping` | Stream stopping | streaming_runtime | internal_runtime | info |
| `stream.stopped` | Stream fully stopped | streaming_runtime | internal_runtime | info |
| `stream.disposed` | Stream resources released | streaming_runtime | internal_runtime | info |
| `stream.chunk_received` | Input chunk accepted into buffer | streaming_runtime | monitoring | debug |
| `stream.chunk_sent` | Output chunk delivered to consumer | streaming_runtime | monitoring | debug |
| `stream.chunk_dropped` | Chunk discarded due to overflow or gap | streaming_runtime | monitoring | warning |
| `stream.chunk_recovered` | Lost chunk retransmitted | streaming_runtime | monitoring | info |
| `stream.buffer_low` | Buffer depth below minimum | streaming_runtime | monitoring | warning |
| `stream.buffer_high` | Buffer depth above maximum | streaming_runtime | flow_controller | warning |
| `stream.buffer_overflow` | Buffer capacity exceeded | streaming_runtime | monitoring | error |
| `stream.buffer_underflow` | Buffer empty on consumer request | streaming_runtime | monitoring | error |
| `stream.buffer_drained` | Buffer fully flushed | streaming_runtime | internal_runtime | debug |
| `stream.latency_normal` | Latency within acceptable range | streaming_runtime | monitoring | debug |
| `stream.latency_warning` | Latency exceeds threshold | streaming_runtime | monitoring | warning |
| `stream.latency_critical` | Latency exceeds 2x threshold | streaming_runtime | monitoring | error |
| `stream.jitter_spike` | Inter-chunk delay variance high | streaming_runtime | monitoring | warning |
| `stream.heartbeat_received` | Heartbeat acknowledged by peer | streaming_runtime | monitoring | debug |
| `stream.heartbeat_missed` | Expected heartbeat not received | streaming_runtime | recovery_manager | warning |
| `stream.heartbeat_resumed` | Heartbeat flow restored | streaming_runtime | monitoring | info |
| `stream.interrupted` | Chunk gap or heartbeat loss detected | streaming_runtime | recovery_manager | error |
| `stream.recovery_started` | Recovery reconnection initiated | streaming_runtime | monitoring | warning |
| `stream.recovery_progress` | Recovery retry attempt | streaming_runtime | monitoring | warning |
| `stream.recovery_completed` | Stream resynchronized and resumed | streaming_runtime | monitoring | info |
| `stream.recovery_failed` | All recovery retries exhausted | streaming_runtime | monitoring | error |

#### Payload Schema

```typescript
interface StreamEventPayload {
  streamId: string;
  direction: "input" | "output";
  state?: string;
  previousState?: string;
  sequence?: number;
  chunkSize?: number;
  bufferOccupancy?: number;
  bufferCapacity?: number;
  latencyMs?: number;
  jitterMs?: number;
  heartbeatsMissed?: number;
  recoveryAttempt?: number;
  maxRetries?: number;
  reason?: string;
  error?: string;
}
```

#### Ordering Rules

1. Stream lifecycle events SHALL follow the stream state machine defined in TVR-STRS-001.
2. Chunk events (`chunk_received`, `chunk_sent`, `chunk_dropped`) SHALL be emitted in chunk sequence order per stream.
3. Buffer events SHALL be emitted immediately when the threshold is crossed.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No (lossy-tolerant) |
| In-order per stream | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Stream event payloads are versioned with the envelope version. New stream states result in new event names.

#### Correlation IDs

All stream events SHALL carry the correlation ID of the session that owns the stream.

#### Idempotency Rules

Stream events are not idempotent. Duplicate chunk events MAY occur during recovery retransmission. Consumers SHALL deduplicate by `sequence` number.

---

### 5.4 Speech Events

Events tracking speech detection, recognition, and audio input.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `speech.detected` | Voice activity detected | speech_runtime | dialogue_runtime | info |
| `speech.started` | User speech segment began | speech_runtime | dialogue_runtime, monitoring | info |
| `speech.ended` | User speech segment ended | speech_runtime | dialogue_runtime | info |
| `speech.transcript_partial` | Partial recognition result | speech_runtime | dialogue_runtime, external_client | debug |
| `speech.transcript_final` | Final recognition result | speech_runtime | dialogue_runtime, external_client | info |
| `speech.microphone_opened` | Microphone device opened | speech_runtime | monitoring | info |
| `speech.microphone_closed` | Microphone device closed | speech_runtime | monitoring | info |
| `speech.capture_started` | Audio capture started | speech_runtime | monitoring | info |
| `speech.capture_stopped` | Audio capture stopped | speech_runtime | monitoring | info |
| `speech.sdk_capture_started` | SDK client started audio capture | voice_sdk | external_client | info |
| `speech.sdk_capture_stopped` | SDK client stopped audio capture | voice_sdk | external_client | info |
| `speech.speech_started` | SDK client notified speech started | voice_sdk | external_client | info |
| `speech.speech_ended` | SDK client notified speech ended | voice_sdk | external_client | info |

#### Payload Schema

```typescript
interface SpeechEventPayload {
  sessionId?: string;
  text?: string;
  confidence?: number;
  isFinal?: boolean;
  durationMs?: number;
  energy?: number;
  deviceId?: string;
  reason?: string;
  language?: string;
}
```

#### Ordering Rules

1. `speech.detected` SHALL precede `speech.started`.
2. `speech.transcript_partial` SHALL precede `speech.transcript_final` for the same speech segment.
3. `speech.ended` SHALL follow `speech.transcript_final`.
4. Microphone and capture events SHALL be independent of speech segment ordering.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per session | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Speech event payloads are versioned with the envelope version. Transcript confidence score format changes constitute a minor version bump.

#### Correlation IDs

All speech events SHALL carry the session's correlation ID.

#### Idempotency Rules

Duplicate `transcript_final` events with the same text and confidence MAY occur during STT provider retry. Consumers SHALL deduplicate by comparing text and timestamp within a 500 ms window.

---

### 5.5 Dialogue Events

Events tracking dialogue turns, thinking, confirmation, clarification, and interruption.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `dialogue.turn_started` | Dialogue turn began | dialogue_runtime | monitoring | info |
| `dialogue.turn_completed` | Dialogue turn completed | dialogue_runtime | monitoring | info |
| `dialogue.thinking_started` | Runtime waiting for gateway response | dialogue_runtime | external_client, monitoring | info |
| `dialogue.thinking_completed` | Gateway response received | dialogue_runtime | external_client, monitoring | info |
| `dialogue.confirmation_requested` | User confirmation required | dialogue_runtime | external_client, monitoring | info |
| `dialogue.confirmation_received` | User confirmation received | dialogue_runtime | monitoring | info |
| `dialogue.clarification_requested` | User clarification required | dialogue_runtime | external_client, monitoring | info |
| `dialogue.clarification_received` | User clarification received | dialogue_runtime | monitoring | info |
| `dialogue.interrupted` | Dialogue interrupted (user speech) | dialogue_runtime | external_client, monitoring | info |
| `dialogue.recovered` | Dialogue resumed after interruption | dialogue_runtime | monitoring | info |
| `dialogue.completed` | Dialogue flow completed naturally | dialogue_runtime | monitoring | info |

#### Payload Schema

```typescript
interface DialogueEventPayload {
  sessionId?: string;
  turnSequence?: number;
  state?: string;
  previousState?: string;
  durationMs?: number;
  interruptionDurationMs?: number;
  confirmationId?: string;
  clarificationId?: string;
  summary?: string;
  error?: string;
}
```

#### Ordering Rules

1. `dialogue.turn_started` SHALL precede all other events for that turn.
2. `dialogue.thinking_started` SHALL precede `dialogue.thinking_completed`.
3. `dialogue.confirmation_requested` SHALL precede `dialogue.confirmation_received`.
4. `dialogue.interrupted` SHALL be followed by either `dialogue.recovered` or a new `dialogue.turn_started`.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per dialogue session | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Dialogue event payloads are versioned with the envelope version. New dialogue states result in new event names.

#### Correlation IDs

All dialogue events SHALL carry the session's correlation ID.

#### Idempotency Rules

Duplicate `dialogue.turn_completed` events MAY occur after gateway retry. Consumers SHALL compare `turnSequence` for deduplication.

---

### 5.6 Gateway Events

Events tracking gateway request/response lifecycle.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `gateway.request_started` | Gateway request dispatched | gateway_client | dialogue_runtime, monitoring | info |
| `gateway.request_succeeded` | Successful gateway response | gateway_client | dialogue_runtime | info |
| `gateway.request_retried` | Request retry initiated | gateway_client | monitoring | warning |
| `gateway.request_timed_out` | Per-request timeout | gateway_client | monitoring | error |
| `gateway.request_failed` | Non-retryable gateway error | gateway_client | dialogue_runtime | error |
| `gateway.stream_started` | Stream request dispatched | gateway_client | monitoring | info |
| `gateway.stream_event_received` | Individual stream event | gateway_client | dialogue_runtime | debug |
| `gateway.stream_completed` | Stream completed successfully | gateway_client | dialogue_runtime | info |
| `gateway.stream_failed` | Stream finished with error | gateway_client | dialogue_runtime | error |

#### Payload Schema

```typescript
interface GatewayEventPayload {
  requestId?: string;
  correlationId: string;
  conversationId?: string;
  messageLength?: number;
  turnSequence?: number;
  durationMs?: number;
  retryCount?: number;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  provider?: string;
  model?: string;
  responseLength?: number;
  eventType?: string;
  error?: string;
  retryable?: boolean;
}
```

#### Ordering Rules

1. `gateway.request_started` SHALL precede `gateway.request_succeeded`, `gateway.request_retried`, `gateway.request_timed_out`, or `gateway.request_failed`.
2. `gateway.request_retried` SHALL be followed by another `gateway.request_started` or `gateway.request_failed`.
3. Stream events SHALL follow `gateway.stream_started` and precede `gateway.stream_completed` or `gateway.stream_failed`.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per request | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Gateway event payloads are versioned with the envelope version.

#### Correlation IDs

Gateway events SHALL carry the correlation ID provided by the Dialogue Runtime for that turn.

#### Idempotency Rules

Duplicate `gateway.request_started` events MAY occur when a request is retried. Consumers SHALL match by `requestId` (gateway-generated) or `messageId` (client-generated) for deduplication.

---

### 5.7 Playback Events

Events tracking audio playback lifecycle.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `playback.started` | Audio playback began | speech_runtime | dialogue_runtime, external_client | info |
| `playback.paused` | Audio playback paused | speech_runtime | monitoring | info |
| `playback.resumed` | Audio playback resumed | speech_runtime | monitoring | info |
| `playback.interrupted` | Audio playback interrupted by user speech | speech_runtime | dialogue_runtime, external_client | info |
| `playback.completed` | Audio playback finished naturally | speech_runtime | dialogue_runtime, monitoring | info |
| `playback.sdk_started` | SDK client started audio playback | voice_sdk | external_client | info |
| `playback.sdk_stopped` | SDK client stopped audio playback | voice_sdk | external_client | info |

#### Payload Schema

```typescript
interface PlaybackEventPayload {
  sessionId?: string;
  requestId?: string;
  chunkSize?: number;
  durationMs?: number;
  reason?: string;
  interruptedBy?: string;
}
```

#### Ordering Rules

1. `playback.started` SHALL precede `playback.paused`, `playback.interrupted`, or `playback.completed`.
2. `playback.paused` SHALL be followed by `playback.resumed` or `playback.interrupted`.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per playback session | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Playback event payloads are versioned with the envelope version.

#### Correlation IDs

Playback events SHALL carry the session's correlation ID.

#### Idempotency Rules

Duplicate `playback.completed` events SHALL NOT occur under normal operation. If they do, consumers SHALL compare `requestId`.

---

### 5.8 Interruption Events

Events tracking runtime interruptions and their resolution.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `interruption.stream` | Audio stream interrupted | streaming_runtime | recovery_manager | error |
| `interruption.dialogue` | Dialogue flow interrupted by user | dialogue_runtime | external_client | info |
| `interruption.playback` | Playback interrupted by user speech | speech_runtime | dialogue_runtime | info |
| `interruption.session` | Session interrupted by runtime error | session_runtime | dialogue_runtime | error |
| `interruption.recovery_started` | Recovery initiated for interruption | recovery_manager | monitoring | warning |
| `interruption.recovery_completed` | Recovery completed successfully | recovery_manager | monitoring | info |
| `interruption.recovery_failed` | Recovery retries exhausted | recovery_manager | monitoring | critical |

#### Payload Schema

```typescript
interface InterruptionEventPayload {
  sessionId?: string;
  source: string;
  type: string;
  durationMs?: number;
  recoveryAttempt?: number;
  maxRetries?: number;
  error?: string;
}
```

#### Ordering Rules

1. An interruption event SHALL be followed by either a `recovery_started` or `recovery_failed` event.
2. `recovery_started` SHALL precede `recovery_completed` or `recovery_failed`.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per source | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Interruption event payloads are versioned with the envelope version.

#### Correlation IDs

Interruption events SHALL carry the session's correlation ID.

#### Idempotency Rules

Duplicate interruption events for the same cause SHALL NOT occur. The Recovery Manager SHALL deduplicate by `source` and `type`.

---

### 5.9 Configuration Events

Events tracking configuration changes and validation.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `configuration.applied` | Configuration applied successfully | Any runtime | monitoring | info |
| `configuration.changed` | Runtime configuration changed at runtime | Any runtime | monitoring | info |
| `configuration.invalid` | Configuration validation failed | Any runtime | monitoring, external_client | error |

#### Payload Schema

```typescript
interface ConfigurationEventPayload {
  component: string;
  field?: string;
  value?: unknown;
  expected?: unknown;
  error?: string;
}
```

#### Ordering Rules

1. `configuration.applied` SHALL precede any operational events from that component.
2. `configuration.changed` MAY occur at any time and SHALL be followed by operational events using the new configuration.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per component | Yes |
| Synchronous | No |

#### Versioning

Configuration event payloads are versioned with the envelope version.

#### Correlation IDs

Configuration events SHALL use a correlation ID generated at configuration time, which MAY be the session's correlation ID if the configuration is session-scoped.

#### Idempotency Rules

Duplicate `configuration.applied` events SHALL NOT occur. If a component is re-initialized, it SHALL emit a new `configuration.applied` event.

---

### 5.10 Telemetry Events

Events providing runtime observability data.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `telemetry.runtime_healthy` | Runtime health check passed | Any runtime | monitoring | info |
| `telemetry.runtime_unhealthy` | Runtime health check failed | Any runtime | monitoring | error |
| `telemetry.heartbeat` | Periodic runtime heartbeat | Any runtime | monitoring | debug |
| `telemetry.metrics_snapshot` | Periodic metrics snapshot | Any runtime | monitoring | debug |
| `telemetry.provider_healthy` | Provider health check passed | stt_provider, tts_provider, transport_provider | monitoring | info |
| `telemetry.provider_unhealthy` | Provider health check failed | stt_provider, tts_provider, transport_provider | monitoring | error |
| `telemetry.provider_recovered` | Provider health restored | stt_provider, tts_provider, transport_provider | monitoring | info |

#### Payload Schema

```typescript
interface TelemetryEventPayload {
  component: string;
  uptimeMs: number;
  healthy: boolean;
  latencyMs?: number;
  lastHeartbeatAt?: string;
  metrics?: Record<string, number>;
  error?: string;
}
```

#### Ordering Rules

Telemetry events have no ordering dependencies. They are emitted at periodic intervals independent of other event flows.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per producer | Yes (by timestamp) |
| Synchronous | No |

#### Versioning

Telemetry event payloads are versioned with the envelope version. Adding new metrics fields constitutes a minor version bump.

#### Correlation IDs

Telemetry events MAY omit `correlationId` or use a runtime-scoped correlation ID. They are not tied to a specific session.

#### Idempotency Rules

Telemetry events are not idempotent. Consumers SHALL use the `timestamp` field to select the most recent event.

---

### 5.11 Provider Events

Events emitted by STT, TTS, and Transport providers.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `provider.stt.recognition_started` | STT recognition session started | stt_provider | speech_runtime | info |
| `provider.stt.partial_transcript` | Partial transcript produced | stt_provider | speech_runtime | debug |
| `provider.stt.final_transcript` | Final transcript produced | stt_provider | speech_runtime | info |
| `provider.stt.recognition_stopped` | STT recognition session stopped | stt_provider | speech_runtime | info |
| `provider.tts.synthesis_started` | TTS synthesis started | tts_provider | speech_runtime | info |
| `provider.tts.audio_chunk_produced` | Audio chunk produced | tts_provider | speech_runtime | debug |
| `provider.tts.playback_completed` | TTS playback completed | tts_provider | speech_runtime | info |
| `provider.transport.connected` | Transport connection established | transport_provider | streaming_runtime | info |
| `provider.transport.disconnected` | Transport disconnected | transport_provider | streaming_runtime | warning |
| `provider.transport.reconnected` | Transport reconnected | transport_provider | streaming_runtime | info |
| `provider.transport.message_sent` | Transport message sent | transport_provider | streaming_runtime | debug |
| `provider.transport.message_received` | Transport message received | transport_provider | streaming_runtime | debug |
| `provider.transport.authentication_failed` | Provider authentication failed | Any provider | monitoring | critical |
| `provider.transport.connection_lost` | Provider connection lost | Any provider | recovery_manager | error |

#### Payload Schema

```typescript
interface ProviderEventPayload {
  providerId: string;
  providerType: "stt" | "tts" | "transport";
  sessionId?: string;
  text?: string;
  confidence?: number;
  isFinal?: boolean;
  sequence?: number;
  durationMs?: number;
  messageId?: string;
  messageType?: string;
  reason?: string;
  error?: string;
  retryable?: boolean;
}
```

#### Ordering Rules

1. Provider events SHALL be ordered per provider instance.
2. STT transcript events SHALL follow recognition_started → (zero or more partial_transcript) → final_transcript → recognition_stopped.
3. TTS events SHALL follow synthesis_started → (zero or more audio_chunk_produced) → playback_completed.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per provider instance | Yes |
| In-order across providers | No |
| Synchronous | No |

#### Versioning

Provider event payloads are versioned with the envelope version.

#### Correlation IDs

Provider events SHALL carry the session's correlation ID when emitted within a session.

#### Idempotency Rules

Provider events are not idempotent. Duplicate transcript events MAY occur during provider retry. Consumers SHALL deduplicate by comparing text, confidence, and a 200 ms window for partial transcripts, or by `sequence` for audio chunks.

---

### 5.12 Recovery Events

Events emitted during interruption recovery flows across all runtimes.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `recovery.stream_started` | Stream recovery initiated | streaming_runtime | monitoring | warning |
| `recovery.stream_progress` | Stream recovery retry attempt | streaming_runtime | monitoring | warning |
| `recovery.stream_completed` | Stream recovered successfully | streaming_runtime | monitoring | info |
| `recovery.stream_failed` | Stream recovery exhausted | streaming_runtime | monitoring | error |
| `recovery.session_started` | Session recovery initiated | session_runtime | dialogue_runtime | warning |
| `recovery.session_completed` | Session recovered successfully | session_runtime | dialogue_runtime | info |
| `recovery.session_failed` | Session recovery exhausted | session_runtime | dialogue_runtime | error |
| `recovery.dialogue_started` | Dialogue recovery initiated | dialogue_runtime | monitoring | warning |
| `recovery.dialogue_completed` | Dialogue recovered successfully | dialogue_runtime | monitoring | info |
| `recovery.dialogue_failed` | Dialogue recovery exhausted | dialogue_runtime | monitoring | error |

#### Payload Schema

```typescript
interface RecoveryEventPayload {
  sessionId?: string;
  streamId?: string;
  source: string;
  attempt: number;
  maxRetries: number;
  durationMs: number;
  delayMs?: number;
  error?: string;
}
```

#### Ordering Rules

1. `*_started` SHALL precede zero or more `*_progress` events.
2. `*_progress` SHALL precede `*_completed` or `*_failed`.
3. Multiple `*_progress` events MAY be emitted per recovery attempt.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per recovery flow | Yes |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Recovery event payloads are versioned with the envelope version.

#### Correlation IDs

Recovery events SHALL carry the correlation ID of the interrupted session.

#### Idempotency Rules

Duplicate `recovery.*.completed` events MAY occur. Consumers SHALL check current state before acting.

---

### 5.13 Error Events

Events emitted when runtime errors occur.

| Event Name | Description | Producer | Consumer | Level |
|---|---|---|---|---|
| `error.provider` | Provider-level error | stt_provider, tts_provider, transport_provider | speech_runtime, streaming_runtime | error |
| `error.provider_auth` | Provider authentication failure | Any provider | monitoring | critical |
| `error.provider_timeout` | Provider operation timed out | Any provider | monitoring | error |
| `error.audio_device` | Audio device error | speech_runtime | monitoring, external_client | error |
| `error.recognition` | STT recognition failure | speech_runtime | dialogue_runtime, monitoring | error |
| `error.playback` | Audio playback failure | speech_runtime | monitoring, external_client | error |
| `error.synthesis` | TTS synthesis failure | speech_runtime | dialogue_runtime | error |
| `error.stream` | Streaming runtime error | streaming_runtime | monitoring | error |
| `error.dialogue` | Dialogue runtime error | dialogue_runtime | monitoring | error |
| `error.session` | Session runtime error | session_runtime | monitoring | error |
| `error.gateway` | Gateway returned error | gateway_client | dialogue_runtime | error |
| `error.configuration` | Invalid configuration | Any runtime | monitoring, external_client | error |
| `error.state_violation` | Invalid state transition attempted | Any runtime | monitoring | error |
| `error.sdk` | SDK-level error | voice_sdk | external_client | error |
| `error.runtime` | Runtime-internal error | Any runtime | monitoring | error |
| `error.unknown` | Unclassified error | Any runtime | monitoring, external_client | error |

#### Payload Schema

```typescript
interface ErrorEventPayload {
  code: string;
  message: string;
  retryable: boolean;
  fatal: boolean;
  category: string;
  component: string;
  sessionId?: string;
  streamId?: string;
  providerId?: string;
  conversationId?: string;
  cause?: string;
  stack?: string;
}
```

#### Ordering Rules

Error events have no ordering dependencies. They are emitted immediately when the error condition is detected.

#### Delivery Guarantees

| Guarantee | Value |
|---|---|
| At-least-once | No |
| In-order per producer | Yes |
| Synchronous | No |

#### Versioning

Error event payloads are versioned with the envelope version.

#### Correlation IDs

Error events SHALL carry the correlation ID of the operation that caused the error, if available.

#### Idempotency Rules

Duplicate error events for the same error condition SHALL NOT occur. The emitting component SHALL deduplicate by error code and timestamp before emission.

---

## 6. Testing Requirements

### 6.1 Envelope Compliance Testing

| Test | Description |
|---|---|
| Envelope fields present | Every emitted event contains all required envelope fields |
| Envelope field types | Every envelope field matches its specified type |
| Timestamp format | All timestamps are valid ISO 8601 UTC with ms precision |
| Event ID uniqueness | No duplicate event IDs within a runtime session |

### 6.2 Category Compliance Testing

| Test | Description |
|---|---|
| Category assignment | Every event is assigned to exactly one category |
| Category validity | Event category matches the EventCategory union |
| Producer validity | Event producer matches the EventProducer union |
| Level validity | Event level matches the EventLevel union |

### 6.3 Metadata Testing

| Test | Description |
|---|---|
| Session events include sessionId | All session-scoped events carry sessionId |
| Gateway events include conversationId | All gateway-scoped events carry conversationId |
| Correlation ID present | Every event carries a non-empty correlationId |
| Correlation ID format | Correlation IDs follow the specified format |

### 6.4 Ordering Testing

| Test | Description |
|---|---|
| Per-producer ordering | Events from a single producer are emitted in order |
| Lifecycle ordering | Lifecycle events follow initialized → started → stopped → disposed |
| Session ordering | Session events follow the session lifecycle |
| Stream ordering | Stream events follow the stream state machine |
| Dialogue ordering | Dialogue events follow turn_started → thinking → response flow |

### 6.5 Delivery Testing

| Test | Description |
|---|---|
| Non-blocking emission | Producer is not blocked by consumer processing |
| Handler isolation | One handler exception does not affect other handlers |
| Lossy tolerance | Runtime functions correctly with event loss (tested via throttling) |

### 6.6 Correlation Testing

| Test | Description |
|---|---|
| Session correlation | All events within a session share the same correlation ID |
| Turn correlation | All events within a dialogue turn share the same correlation ID |
| Request correlation | Gateway request and response events share the same correlation ID |
| Generation format | Generated correlation IDs follow the specified format |

### 6.7 Error Event Testing

| Test | Description |
|---|---|
| Error on error | Error events are emitted for every runtime error |
| Error payload complete | Error events contain all required payload fields |
| Retryable flag | retryable field accurately reflects error classification |
| Fatal flag | fatal field accurately reflects error severity |

---

## 7. Compliance Requirements

An Event Model implementation is compliant with this specification **only if** it:

1. Implements the canonical `RuntimeEvent` envelope defined in Section 3 for every emitted event.
2. Assigns every event to exactly one of the 13 categories defined in Section 5.
3. Populates every required envelope field before emission.
4. Generates unique event IDs per the format in Section 4.1.
5. Propagates correlation IDs per Section 4.2.
6. Includes `sessionId` on all session-scoped events.
7. Includes `conversationId` on all gateway-scoped events.
8. Emits events in the ordering specified per category.
9. Does not block producers during event emission.
10. Produces events that survive handler exceptions without affecting other handlers.
11. Passes every required testing suite defined in Section 6.

---

## 8. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Breaking changes to the event envelope, field types, required fields, event naming convention, or category model |
| Minor | Backward-compatible additions: new optional envelope fields, new event names, new categories, new payload fields |
| Patch | Documentation clarifications, correction of non-normative text, correction of test descriptions |

The event envelope `version` field SHALL be updated to match the specification version when the envelope schema changes. Event payloads do not carry their own version; they are versioned through the envelope version.

Implementations shall declare the specification version they conform to.
