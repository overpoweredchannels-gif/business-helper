# TradeOS Voice Runtime — Provider Compliance Specification

Document ID: TVR-PCS-001
Title: TradeOS Provider Compliance Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_RUNTIME_EVENT_MODEL.md (TVR-EM-001)
- TRADEOS_VOICE_CONFIGURATION_SPEC.md (TVR-VCS-001)
- TRADEOS_RUNTIME_TESTING_SPEC.md (TVR-TS-001)
- Frozen Voice Runtime Architecture

---

## 1. Purpose

This specification defines the **certification requirements** that every provider implementation (STT, TTS, Transport) MUST satisfy to be considered compliant with the TradeOS Voice Runtime. Compliance is mandatory — any provider that fails these requirements SHALL be rejected by the runtime's provider factory.

The specification covers:

- Required interface implementation (every method, every signature)
- Required lifecycle behavior and state machine compliance
- Required event emission (lifecycle, operational, error)
- Required error contract compliance (codes, structure, retryability)
- Required health reporting (fields, timing, accuracy)
- Required metrics collection (fields, aggregation, reset rules)
- Required testing (unit, integration, compliance, stress, long-running)
- Formal compliance checklist (provider self-certification + automated audit)
- Version compatibility requirements (semver, backward compatibility)

This specification is **provider-agnostic**. It does not reference any specific provider SDK (Google, Azure, etc.). It defines the contract that every provider must meet, regardless of implementation technology.

---

## 2. Scope

This specification applies to three provider categories:

| Category | Interface | Purpose |
|---|---|---|
| STT Provider | `SpeechToTextProvider` | Speech-to-text recognition |
| TTS Provider | `TextToSpeechProvider` | Text-to-speech synthesis |
| Transport Provider | `RealtimeTransportProvider` | Bidirectional real-time message transport |

Every provider implementation of any category MUST comply with:

- The base `Provider` interface (Section 4)
- The category-specific interface (STT: Section 5, TTS: Section 6, Transport: Section 7)
- The lifecycle contract (Section 8)
- The event contract (Section 9)
- The error contract (Section 10)
- The health contract (Section 11)
- The metrics contract (Section 12)
- The testing contract (Section 13)
- The version compatibility requirements (Section 14)

---

## 3. Compliance Architecture

### 3.1 Compliance Levels

| Level | Label | Requirements |
|---|---|---|
| 1 | **Base Compliance** | All Provider interface methods, lifecycle, health, error contract |
| 2 | **Category Compliance** | All category-specific interface methods (STT/TTS/Transport) |
| 3 | **Event Compliance** | All required events emitted with correct payloads |
| 4 | **Metrics Compliance** | All required metrics reported with correct aggregation |
| 5 | **Testing Compliance** | All compliance tests pass with 100% rate |

A provider SHALL NOT be registered with the runtime unless it achieves **Level 5** compliance.

### 3.2 Compliance Verification

Compliance SHALL be verified through two mechanisms:

1. **Automated Compliance Suite** — A runtime-provided test suite that every provider MUST pass (Section 13).
2. **Provider Self-Certification** — A signed checklist that the provider author submits with the implementation (Appendix A).

The automated suite is the authoritative verification. Self-certification is informational only.

### 3.3 Provider Factory Guard

The runtime's provider factory SHALL:

1. Load the provider implementation
2. Run the compliance suite against the provider
3. If any compliance test fails, reject the provider with `COMPLIANCE_FAILED` error
4. If all tests pass, register the provider and permit it to be used

```typescript
interface ProviderFactory {
  register(provider: Provider): Promise<void>;
  // Throws ComplianceError if compliance suite fails
}
```

---

## 4. Required Interfaces — Base Provider

### 4.1 Interface Signature

Every provider MUST implement the `Provider` interface exactly as specified:

```typescript
interface Provider {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: ProviderCapabilities;

  initialize(config: ProviderConfiguration): Promise<void>;

  start(): Promise<void>;

  stop(): Promise<void>;

  dispose(): Promise<void>;

  health(): Promise<ProviderHealth>;

  getState(): ProviderState;
}
```

### 4.2 Field Requirements

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | `string` | Yes | Non-empty, unique across all registered providers, max 64 chars, matches `^[a-zA-Z0-9_-]+$` |
| `name` | `string` | Yes | Human-readable, non-empty, max 128 chars |
| `version` | `string` | Yes | Valid semver (MAJOR.MINOR.PATCH) |
| `capabilities` | `ProviderCapabilities` | Yes | Every field MUST be populated — no partial capabilities objects |

### 4.3 ProviderCapabilities

```typescript
interface ProviderCapabilities {
  streaming: boolean;
  multilingual: boolean;
  interruption: boolean;
  partialResults: boolean;
  reconnect: boolean;
}
```

| Field | STT | TTS | Transport |
|---|---|---|---|
| `streaming` | Required `true` | Required `true` | Required `true` |
| `multilingual` | Optional | Optional | Optional |
| `interruption` | Optional | Optional | Optional |
| `partialResults` | Required `true` | `false` | `false` |
| `reconnect` | Optional | Optional | Required `true` |

### 4.4 Compliance Rules

| # | Rule |
|---|---|
| P-01 | `id` SHALL be immutable after construction |
| P-02 | `name` SHALL be immutable after construction |
| P-03 | `version` SHALL be immutable after construction |
| P-04 | `capabilities` SHALL be immutable after construction |
| P-05 | `capabilities` SHALL be a complete object — no undefined fields |

---

## 5. Required Interfaces — STT Provider

### 5.1 Interface Signature

```typescript
interface SpeechToTextProvider extends Provider {
  startRecognition(session: VoiceSession): Promise<void>;

  stopRecognition(): Promise<void>;

  writeAudio(chunk: AudioChunk): Promise<void>;
}
```

### 5.2 VoiceSession

```typescript
interface VoiceSession {
  id: string;
  language?: string;
  sampleRate?: number;
  encoding?: string;
  metadata?: Record<string, unknown>;
}
```

| Field | Rule |
|---|---|
| `id` | Non-empty, max 64 chars |
| `language` | BCP 47 tag; required if `capabilities.multilingual` is `true` |
| `sampleRate` | If provided, must be valid sample rate (8000, 16000, 24000, 44100, 48000) |

### 5.3 AudioChunk

```typescript
interface AudioChunk {
  data: ArrayBuffer;
  format: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  sequence: number;
  isFinal: boolean;
}
```

| Field | Rule |
|---|---|
| `data` | Non-empty ArrayBuffer |
| `format` | Must match the configured `audioEncoding` |
| `sampleRate` | Must match the session sample rate |
| `channels` | Must be 1 (mono) for voice |
| `sequence` | Monotonically increasing, starting from 0 |
| `isFinal` | `true` only for the last chunk of a recognition segment |

### 5.4 Compliance Rules

| # | Rule |
|---|---|
| STT-01 | `startRecognition()` SHALL begin buffering audio for recognition |
| STT-02 | `startRecognition()` SHALL throw `INVALID_STATE` if called without prior `initialize()` |
| STT-03 | `startRecognition()` SHALL throw `INVALID_STATE` if already in recognition state |
| STT-04 | `writeAudio()` SHALL accept valid AudioChunk without error |
| STT-05 | `writeAudio()` SHALL throw `INVALID_AUDIO` for invalid or empty AudioChunk |
| STT-06 | `writeAudio()` SHALL throw `INVALID_STATE` if called without active `startRecognition()` |
| STT-07 | `stopRecognition()` SHALL flush pending audio and produce a final transcript |
| STT-08 | `stopRecognition()` SHALL be idempotent — subsequent calls SHALL no-op |
| STT-09 | Provider SHALL emit `provider.stt.partial_transcript` events during active recognition |
| STT-10 | Provider SHALL emit `provider.stt.final_transcript` event after `stopRecognition()` |
| STT-11 | Final transcript confidence SHALL be >= 0.0 and <= 1.0 |
| STT-12 | If `capabilities.multilingual` is `true`, provider SHALL accept BCP 47 `language` in `VoiceSession` |

### 5.5 Method Behavior Matrix

| Method | Before init | After init | After start | After stop | After dispose |
|---|---|---|---|---|---|
| `initialize()` | Allowed | Idempotent or error | Error | Error | Error |
| `startRecognition()` | Error | Allowed | Error | Error | Error |
| `writeAudio()` | Error | Error | Allowed | Error | Error |
| `stopRecognition()` | Error | Error | Allowed | Idempotent | Error |

---

## 6. Required Interfaces — TTS Provider

### 6.1 Interface Signature

```typescript
interface TextToSpeechProvider extends Provider {
  synthesize(request: SpeechRequest): Promise<AudioStream>;

  stopSynthesis(): Promise<void>;
}
```

### 6.2 SpeechRequest

```typescript
interface SpeechRequest {
  text: string;
  voice?: string;
  language?: string;
  rate?: number;
  pitch?: number;
  metadata?: Record<string, unknown>;
}
```

| Field | Rule |
|---|---|
| `text` | Non-empty string, max 65535 characters |
| `voice` | If provided, must be a voice identifier supported by the provider |
| `language` | BCP 47 tag; required if `capabilities.multilingual` is `true` |
| `rate` | If provided, between 0.5 and 2.0 (1.0 = normal) |
| `pitch` | If provided, between 0.5 and 2.0 (1.0 = normal) |

### 6.3 AudioStream

```typescript
interface AudioStream {
  [Symbol.asyncIterator](): AsyncIterator<AudioChunk>;
}
```

- `AudioStream` SHALL yield one or more `AudioChunk` objects
- The stream SHALL complete (async iterator returns `{ done: true }`) when synthesis is complete
- Each chunk SHALL follow the `AudioChunk` contract (Section 5.3)

### 6.4 Compliance Rules

| # | Rule |
|---|---|
| TTS-01 | `synthesize()` SHALL return a valid `AudioStream` |
| TTS-02 | `synthesize()` SHALL throw `INVALID_STATE` if called without prior `initialize()` |
| TTS-03 | `synthesize()` SHALL throw `UNSUPPORTED_LANGUAGE` for unsupported BCP 47 tags (if `multilingual` capability) |
| TTS-04 | `synthesize()` SHALL throw `INVALID_CONFIGURATION` for out-of-range `rate` or `pitch` |
| TTS-05 | `stopSynthesis()` SHALL interrupt an active `synthesize()` call |
| TTS-06 | `stopSynthesis()` SHALL cause the active `AudioStream` to terminate early |
| TTS-07 | `stopSynthesis()` SHALL be idempotent |
| TTS-08 | Provider SHALL emit `provider.tts.synthesis_started` when synthesis begins |
| TTS-09 | Provider SHALL emit `provider.tts.audio_chunk_produced` for each chunk yielded |
| TTS-10 | Provider SHALL emit `provider.tts.playback_completed` when synthesis finishes or is stopped |

### 6.5 Method Behavior Matrix

| Method | Before init | After init | During synthesis | After stop | After dispose |
|---|---|---|---|---|---|
| `initialize()` | Allowed | Idempotent or error | Error | Error | Error |
| `synthesize()` | Error | Allowed | Error (or queue) | Error | Error |
| `stopSynthesis()` | Error | Error | Allowed | Idempotent | Error |

---

## 7. Required Interfaces — Transport Provider

### 7.1 Interface Signature

```typescript
interface RealtimeTransportProvider extends Provider {
  connect(session: VoiceSession): Promise<void>;

  disconnect(): Promise<void>;

  send(message: TransportMessage): Promise<void>;
}
```

### 7.2 TransportMessage

```typescript
interface TransportMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

| Field | Rule |
|---|---|
| `id` | Non-empty string, unique per sender instance |
| `type` | Non-empty string, max 64 characters |
| `payload` | Any serializable value |
| `timestamp` | Valid Date object |

### 7.3 Compliance Rules

| # | Rule |
|---|---|
| TR-01 | `connect()` SHALL establish a transport connection |
| TR-02 | `connect()` SHALL throw `INVALID_STATE` if called without prior `initialize()` |
| TR-03 | `connect()` SHALL throw `INVALID_STATE` if already connected |
| TR-04 | `disconnect()` SHALL terminate the transport connection gracefully |
| TR-05 | `disconnect()` SHALL be idempotent |
| TR-06 | `send()` SHALL deliver the message over the transport |
| TR-07 | `send()` SHALL throw `INVALID_STATE` if not connected |
| TR-08 | `send()` SHALL throw `CONNECTION_LOST` if transport drops mid-send |
| TR-09 | If `capabilities.reconnect` is `true`, provider SHALL automatically reconnect after connection loss |
| TR-10 | Provider SHALL emit `provider.transport.connected` on successful connect |
| TR-11 | Provider SHALL emit `provider.transport.disconnected` on disconnect |
| TR-12 | Provider SHALL emit `provider.transport.reconnected` on successful reconnection |

### 7.4 Method Behavior Matrix

| Method | Before init | After init | Connected | After disconnect | After dispose |
|---|---|---|---|---|---|
| `initialize()` | Allowed | Idempotent or error | Error | Error | Error |
| `connect()` | Error | Allowed | Error | Allowed | Error |
| `send()` | Error | Error | Allowed | Error | Error |
| `disconnect()` | Error | Error | Allowed | Idempotent | Error |

---

## 8. Required Lifecycle

### 8.1 State Machine

Every provider SHALL implement the following state machine:

```
     ┌──────────┐
     │  created  │
     └─────┬────┘
           │ initialize()
           ▼
     ┌──────────────┐
     │  initialized  │
     └──────┬───────┘
            │ start()
            ▼
     ┌─────────┐
     │ starting │
     └────┬────┘
          │ (async complete)
          ▼
     ┌─────────┐
     │ running  │ ◀────────────────────────┐
     └────┬────┘                           │
          │ stop()                         │ start()
          ▼                                │
     ┌─────────┐                           │
     │ stopping │                           │
     └────┬────┘                           │
          │ (async complete)               │
          ▼                                │
     ┌─────────┐                           │
     │ stopped  │──────────────────────────┘
     └────┬────┘
          │ dispose()
          ▼
     ┌──────────┐
     │ disposed  │
     └──────────┘

Failed state reachable from any non-disposed state:

     ┌─────────┐
     │  failed  │
     └────┬────┘
          │ dispose()
          ▼
     ┌──────────┐
     │ disposed  │
     └──────────┘
```

### 8.2 ProviderState

```typescript
type ProviderState =
  | "created"
  | "initialized"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "disposed"
  | "failed";
```

### 8.3 Valid Transitions

| From | To | Trigger | Rules |
|---|---|---|---|
| `created` | `initialized` | `initialize()` | Config validated; all resources allocated |
| `initialized` | `starting` | `start()` | Provider begins activation |
| `starting` | `running` | (async) | Provider operational |
| `starting` | `failed` | (error) | Start failed, provider enters failed state |
| `running` | `stopping` | `stop()` | Provider begins deactivation |
| `running` | `failed` | (error) | Runtime error, provider enters failed state |
| `stopping` | `stopped` | (async) | Provider fully stopped |
| `stopping` | `failed` | (error) | Stop failed |
| `stopped` | `starting` | `start()` | Provider restarts |
| `stopped` | `disposed` | `dispose()` | All resources released |
| `failed` | `disposed` | `dispose()` | Cleanup after failure |
| Any non-disposed | `failed` | (error) | Catastrophic failure |

### 8.4 Illegal Transitions

| From | To | Trigger | Behavior |
|---|---|---|---|
| `created` | `running` | Direct call | SHALL throw `INVALID_STATE` |
| `created` | `stopped` | Direct call | SHALL throw `INVALID_STATE` |
| `initialized` | `stopped` | `stop()` | SHALL throw `INVALID_STATE` |
| `initialized` | `disposed` | `dispose()` | Allowed (skip start/stop) |
| `running` | `initialized` | `initialize()` | SHALL throw `INVALID_STATE` or be idempotent |
| `disposed` | any | Any call | SHALL throw `INVALID_STATE` |

### 8.5 Lifecycle Compliance Rules

| # | Rule |
|---|---|
| L-01 | `getState()` SHALL return the current state at all times |
| L-02 | State transitions SHALL be atomic — no intermediate states visible to callers |
| L-03 | All async lifecycle methods SHALL settle (resolve or reject) within `config.timeoutMs` |
| L-04 | After `dispose()`, the provider SHALL release all resources (network connections, file handles, timers) |
| L-05 | After `failed`, the provider SHALL reject all subsequent operations (except `dispose()`) with `INVALID_STATE` |
| L-06 | Transitions SHALL emit lifecycle events per Section 9 |
| L-07 | `start()` after `stopped` SHALL fully re-initialize the provider |

---

## 9. Required Events

### 9.1 All Providers — Lifecycle Events

Every provider SHALL emit these lifecycle events:

| Event Name | Trigger | Payload |
|---|---|---|
| `lifecycle.provider.initialized` | After `initialize()` resolves | `{ providerId, providerType }` |
| `lifecycle.provider.started` | After `start()` resolves | `{ providerId, providerType }` |
| `lifecycle.provider.stopped` | After `stop()` resolves | `{ providerId, providerType, reason? }` |
| `lifecycle.provider.disposed` | After `dispose()` resolves | `{ providerId, providerType }` |

### 9.2 All Providers — Error Events

| Event Name | Trigger | Payload |
|---|---|---|
| `error.provider` | Any provider error | `{ providerId, providerType, code, message, retryable }` |
| `error.provider_auth` | Authentication failure | `{ providerId, providerType }` |
| `error.provider_timeout` | Operation timeout | `{ providerId, providerType, operation, timeoutMs }` |

### 9.3 All Providers — Health Events

| Event Name | Trigger | Payload |
|---|---|---|
| `provider.healthy` | `health()` returns healthy | `{ providerId, providerType, latencyMs }` |
| `provider.unhealthy` | `health()` returns unhealthy | `{ providerId, providerType, error }` |
| `provider.recovered` | Provider returns to healthy | `{ providerId, providerType }` |

### 9.4 STT Provider Events

| Event Name | Trigger | Payload |
|---|---|---|
| `provider.stt.recognition_started` | `startRecognition()` resolves | `{ providerId, providerType, sessionId }` |
| `provider.stt.partial_transcript` | Interim recognition result | `{ providerId, providerType, text, confidence, isFinal: false }` |
| `provider.stt.final_transcript` | `stopRecognition()` completes | `{ providerId, providerType, text, confidence, isFinal: true }` |
| `provider.stt.recognition_stopped` | Recognition ends | `{ providerId, providerType, reason? }` |

### 9.5 TTS Provider Events

| Event Name | Trigger | Payload |
|---|---|---|
| `provider.tts.synthesis_started` | `synthesize()` begins | `{ providerId, providerType, requestId }` |
| `provider.tts.audio_chunk_produced` | Each chunk yielded | `{ providerId, providerType, sequence, durationMs }` |
| `provider.tts.playback_completed` | Synthesis finishes or stops | `{ providerId, providerType, requestId }` |

### 9.6 Transport Provider Events

| Event Name | Trigger | Payload |
|---|---|---|
| `provider.transport.connected` | `connect()` resolves | `{ providerId, providerType, sessionId }` |
| `provider.transport.disconnected` | `disconnect()` resolves or connection lost | `{ providerId, providerType, reason? }` |
| `provider.transport.reconnected` | Auto-reconnect succeeds | `{ providerId, providerType, sessionId }` |
| `provider.transport.message_sent` | `send()` resolves | `{ providerId, providerType, messageId }` |
| `provider.transport.message_received` | Message arrives from peer | `{ providerId, providerType, messageId, messageType }` |

### 9.7 Event Compliance Rules

| # | Rule |
|---|---|
| E-01 | Every event SHALL conform to the `RuntimeEvent` envelope from TVR-EM-001 |
| E-02 | Every event SHALL carry `providerId` in the payload |
| E-03 | Every event SHALL carry `providerType` in the payload |
| E-04 | Events SHALL be emitted in causal order within a provider instance |
| E-05 | Events SHALL NOT be emitted after `dispose()` completes |
| E-06 | STT transcript events SHALL follow the exact order: recognition_started → (partial*) → final → recognition_stopped |
| E-07 | TTS events SHALL follow: synthesis_started → (audio_chunk_produced*) → playback_completed |
| E-08 | Error events SHALL include a retryable flag matching the error contract |
| E-09 | Event emission SHALL NOT block the calling operation |

---

## 10. Required Error Contracts

### 10.1 ProviderError

```typescript
interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}
```

### 10.2 ProviderErrorCode

```typescript
type ProviderErrorCode =
  | "INITIALIZATION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "CONNECTION_FAILED"
  | "CONNECTION_LOST"
  | "TIMEOUT"
  | "INVALID_CONFIGURATION"
  | "INVALID_AUDIO"
  | "UNSUPPORTED_LANGUAGE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "UNKNOWN_ERROR"
  | "INVALID_STATE";
```

### 10.3 Error Code Specifications

| Code | When Used | Retryable | HTTP Analogue |
|---|---|---|---|
| `INITIALIZATION_FAILED` | `initialize()` fails | `false` | 500 |
| `AUTHENTICATION_FAILED` | Invalid or expired credentials | `false` | 401 |
| `CONNECTION_FAILED` | Transport connect fails | `true` | 503 |
| `CONNECTION_LOST` | Connection drops during operation | `true` | — |
| `TIMEOUT` | Operation exceeds `timeoutMs` | `true` | 408 |
| `INVALID_CONFIGURATION` | Config fails validation | `false` | 400 |
| `INVALID_AUDIO` | Audio chunk format/rate mismatch | `false` | 400 |
| `UNSUPPORTED_LANGUAGE` | Language not supported by provider | `false` | 400 |
| `RATE_LIMITED` | Provider rate limit exceeded | `true` | 429 |
| `SERVICE_UNAVAILABLE` | Provider backend unavailable | `true` | 503 |
| `UNKNOWN_ERROR` | Unclassified error | `false` | 500 |
| `INVALID_STATE` | Method called in wrong state | `false` | 409 |

### 10.4 Error Compliance Rules

| # | Rule |
|---|---|
| ER-01 | Every rejected promise SHALL use `ProviderError` — never raw `Error` or `string` |
| ER-02 | `retryable` SHALL match the specification in Section 10.3 exactly |
| ER-03 | `message` SHALL be human-readable and non-empty |
| ER-04 | `code` SHALL be one of the defined `ProviderErrorCode` values |
| ER-05 | `cause` MAY be populated with the underlying error (SDK error, network error, etc.) |
| ER-06 | All error codes SHALL be supported — unused codes SHALL still be handled |
| ER-07 | Operations retried per `RetryPolicy` SHALL produce a single error on final failure — intermediate retries are internal |

---

## 11. Required Health Reporting

### 11.1 ProviderHealth

```typescript
interface ProviderHealth {
  healthy: boolean;
  latencyMs: number;
  lastHeartbeat: Date;
  message?: string;
}
```

### 11.2 Health Compliance Rules

| # | Rule |
|---|---|
| H-01 | `health()` SHALL never throw — it SHALL return a valid `ProviderHealth` object |
| H-02 | `healthy` SHALL be `true` when the provider can process requests, `false` otherwise |
| H-03 | `latencyMs` SHALL be the round-trip time of the most recent health check or operation |
| H-04 | `latencyMs` SHALL be >= 0 |
| H-05 | `lastHeartbeat` SHALL be within `2 × heartbeatIntervalMs` of the current time when healthy |
| H-06 | `message` SHOULD be populated when `healthy` is `false` with a diagnostic description |
| H-07 | `health()` SHOULD complete within 1000 ms — it is not a deep diagnostic |
| H-08 | A provider that has not been started SHALL return `healthy: false` |
| H-09 | A disposed provider SHALL return `healthy: false` |

### 11.3 Health Event Rules

| # | Rule |
|---|---|
| HE-01 | Provider SHALL emit `provider.healthy` when `health()` transitions from unhealthy to healthy |
| HE-02 | Provider SHALL emit `provider.unhealthy` when `health()` transitions from healthy to unhealthy |
| HE-03 | Provider SHALL emit `provider.recovered` when it returns to healthy after an unhealthy period |
| HE-04 | Health events SHALL NOT be emitted more frequently than once per `heartbeatIntervalMs` |

---

## 12. Required Metrics

### 12.1 ProviderMetrics

Every provider SHALL expose the following metrics through its public API:

```typescript
interface ProviderMetrics {
  /** Total number of requests processed */
  requestCount: number;

  /** Number of successful requests */
  successCount: number;

  /** Number of failed requests */
  errorCount: number;

  /** Number of retries performed */
  retryCount: number;

  /** Number of timeouts */
  timeoutCount: number;

  /** Total audio bytes processed (STT) or synthesized (TTS), or total message bytes (Transport) */
  totalBytes: number;

  /** Minimum request duration (ms) */
  durationMinMs: number;

  /** Maximum request duration (ms) */
  durationMaxMs: number;

  /** Average request duration (ms) */
  durationAvgMs: number;

  /** Median request duration (ms) */
  durationP50Ms: number;

  /** 95th percentile request duration (ms) */
  durationP95Ms: number;

  /** 99th percentile request duration (ms) */
  durationP99Ms: number;

  /** Timestamp of the last request */
  lastRequestAt: Date | null;

  /** Provider uptime in milliseconds since last start() */
  uptimeMs: number;
}
```

### 12.2 Category-Specific Metrics

#### STT Metrics (extends ProviderMetrics)

```typescript
interface SttProviderMetrics extends ProviderMetrics {
  /** Total number of recognition sessions */
  sessionCount: number;

  /** Total number of audio chunks received */
  chunkCount: number;

  /** Total duration of audio processed (ms) */
  audioDurationMs: number;

  /** Number of partial transcripts emitted */
  partialTranscriptCount: number;

  /** Number of final transcripts emitted */
  finalTranscriptCount: number;
}
```

#### TTS Metrics (extends ProviderMetrics)

```typescript
interface TtsProviderMetrics extends ProviderMetrics {
  /** Total number of synthesis requests */
  synthesisCount: number;

  /** Total number of audio chunks produced */
  chunkCount: number;

  /** Total duration of audio synthesized (ms) */
  audioDurationMs: number;

  /** Number of synthesis cancellations */
  cancellationCount: number;
}
```

#### Transport Metrics (extends ProviderMetrics)

```typescript
interface TransportProviderMetrics extends ProviderMetrics {
  /** Total number of transport connections established */
  connectionCount: number;

  /** Total number of disconnections (intentional or unintentional) */
  disconnectionCount: number;

  /** Total number of reconnections */
  reconnectionCount: number;

  /** Total number of messages sent */
  messagesSent: number;

  /** Total number of messages received */
  messagesReceived: number;
}
```

### 12.3 Metrics Compliance Rules

| # | Rule |
|---|---|
| M-01 | Metrics counters SHALL start at 0 after `initialize()` |
| M-02 | Metrics SHALL NOT reset on `start()` after `stop()` — counters accumulate across sessions |
| M-03 | Metrics SHALL be reset to 0 after `dispose()` |
| M-04 | `uptimeMs` SHALL be relative to the most recent `start()` call |
| M-05 | Duration percentiles SHALL use at least 100 samples before reporting meaningful values |
| M-06 | Metrics collection SHALL NOT impact request latency |
| M-07 | Metrics SHALL be available through a `getMetrics()` method on the provider |

---

## 13. Required Testing

### 13.1 Testing Philosophy

Every provider implementation SHALL be tested against an automated compliance suite. The suite is provider-agnostic — it communicates only through the `Provider`, `SpeechToTextProvider`, `TextToSpeechProvider`, and `RealtimeTransportProvider` interfaces.

Tests SHALL be:

1. **Deterministic** — No dependency on network timing, random state, or external service availability.
2. **Self-contained** — Mock transport and backend layers are provided by the test harness.
3. **Fast** — Each test SHALL complete within 2000 ms.
4. **Repeatable** — Tests SHALL produce identical results on every run.

### 13.2 Compliance Test Suite

#### Lifecycle Tests (10 tests)

| # | Test | Method | Verification |
|---|---|---|---|
| CL-01 | Initialize with valid config | `initialize(validConfig)` | Resolves; state = `initialized` |
| CL-02 | Initialize with invalid config | `initialize(invalidConfig)` | Rejects with `INVALID_CONFIGURATION`; state = `created` |
| CL-03 | Start after initialize | `start()` | Resolves; state = `running` |
| CL-04 | Stop after start | `stop()` | Resolves; state = `stopped` |
| CL-05 | Dispose after stop | `dispose()` | Resolves; state = `disposed` |
| CL-06 | Start without initialize | `start()` before `initialize()` | Rejects with `INVALID_STATE` |
| CL-07 | Double initialize | `initialize()` twice | Second call is idempotent or rejects with `INVALID_STATE` |
| CL-08 | Double dispose | `dispose()` twice | Second call is idempotent |
| CL-09 | Restart after stop | `start()` → `stop()` → `start()` | Third call resolves; state = `running` |
| CL-10 | Restart after failure | Inject transient error | Provider recovers; state = `running` |

#### State Machine Tests (8 tests)

| # | Test | Verification |
|---|---|---|
| CS-01 | Every valid transition reaches correct state | For each valid (from, to) pair, verify state after trigger |
| CS-02 | Every illegal transition is rejected | For each illegal (from, to) pair, verify `INVALID_STATE` error |
| CS-03 | State is correct after failed transition | State unchanged after a rejected transition |
| CS-04 | Failed state entered on catastrophic error | Inject unrecoverable error; state = `failed` |
| CS-05 | Dispose from failed state | `dispose()` from `failed`; state = `disposed` |
| CS-06 | No operations after dispose | Any call after `dispose()` rejects with `INVALID_STATE` |
| CS-07 | State visible via getState | `getState()` returns current state at any point |
| CS-08 | State transitions emit events | Each transition emits corresponding lifecycle event |

#### Health Tests (5 tests)

| # | Test | Verification |
|---|---|---|
| CH-01 | Healthy when operational | `health().healthy === true` when state = `running` |
| CH-02 | Unhealthy when stopped | `health().healthy === false` when state = `stopped` |
| CH-03 | Latency reported | `health().latencyMs` is a non-negative number |
| CH-04 | Heartbeat current | `health().lastHeartbeat` is within 2× heartbeat interval |
| CH-05 | Health after recovery | `health().healthy === true` after provider recovers from failure |

#### Error Contract Tests (6 tests)

| # | Test | Verification |
|---|---|---|
| CE-01 | All errors are ProviderError | Every rejected promise is `ProviderError` with `code`, `message`, `retryable` |
| CE-02 | Error code matches condition | Each error condition produces correct `ProviderErrorCode` |
| CE-03 | Retryable flag correct | `retryable` is `true` for transient errors, `false` for permanent |
| CE-04 | Error events emitted | Each error emits `error.provider` event with matching payload |
| CE-05 | Unknown errors handled | Provider catches unexpected exceptions and wraps as `UNKNOWN_ERROR` |
| CE-06 | Timeout enforcement | Operation exceeding `timeoutMs` produces `TIMEOUT` error |

#### Event Tests (8 tests)

| # | Test | Verification |
|---|---|---|
| CEV-01 | Lifecycle events emitted | Each lifecycle transition emits correct event |
| CEV-02 | STT events emitted (STT only) | Recognition sequence emits all required events in order |
| CEV-03 | TTS events emitted (TTS only) | Synthesis sequence emits all required events in order |
| CEV-04 | Transport events emitted (Transport only) | Connect/disconnect/send/receive emit all required events |
| CEV-05 | Events carry providerId | Every event payload contains the provider's `id` |
| CEV-06 | Events carry providerType | Every event payload contains the provider's type category |
| CEV-07 | No events after dispose | Event emission stops after `dispose()` |
| CEV-08 | Event order preserved | Events within a category arrive in causal order |

#### Metrics Tests (4 tests)

| # | Test | Verification |
|---|---|---|
| CM-01 | Counters start at zero | All counters are 0 after `initialize()` |
| CM-02 | Counters increment correctly | Each operation increments the correct counter |
| CM-03 | Metrics survive stop/start | Counters are preserved across `stop()` → `start()` cycle |
| CM-04 | Metrics reset after dispose | All counters are 0 after `dispose()` |

#### STT-Specific Tests (7 tests)

| # | Test | Verification |
|---|---|---|
| CSTT-01 | Start recognition | `startRecognition()` begins recognition; events emitted |
| CSTT-02 | Continuous recognition | Multiple `writeAudio()` calls accepted; partial transcripts emitted |
| CSTT-03 | Final transcript | `stopRecognition()` produces `final_transcript` event |
| CSTT-04 | Invalid audio rejected | `writeAudio()` with invalid chunk rejects with `INVALID_AUDIO` |
| CSTT-05 | Recognition stopped | `stopRecognition()` ends recognition; state returns to idle |
| CSTT-06 | Language switching | If multilingual: different `language` in `VoiceSession` is accepted |
| CSTT-07 | Empty recognition | `stopRecognition()` after no audio produces empty final transcript |

#### TTS-Specific Tests (5 tests)

| # | Test | Verification |
|---|---|---|
| CTTS-01 | Synthesize returns stream | `synthesize()` returns valid `AudioStream` |
| CTTS-02 | Stream yields chunks | `AudioStream` yields >= 1 chunk |
| CTTS-03 | Synthesis cancellation | `stopSynthesis()` interrupts active synthesis; stream terminates |
| CTTS-04 | Invalid parameters rejected | Out-of-range `rate`/`pitch` rejects with `INVALID_CONFIGURATION` |
| CTTS-05 | Empty text rejected | `synthesize()` with empty `text` rejects with `INVALID_CONFIGURATION` |

#### Transport-Specific Tests (6 tests)

| # | Test | Verification |
|---|---|---|
| CTR-01 | Connect | `connect()` resolves; state transitions to connected |
| CTR-02 | Disconnect | `disconnect()` resolves; state transitions to disconnected |
| CTR-03 | Reconnect | If `reconnect` capability: auto-reconnect after connection loss |
| CTR-04 | Send message | `send()` delivers message; `transport.message_sent` event emitted |
| CTR-05 | Message ordering | Messages sent in order are received in order |
| CTR-06 | Network interruption | If `reconnect` capability: connection loss detected; `ConnectionLost` emitted |

#### Concurrency Tests (4 tests)

| # | Test | Verification |
|---|---|---|
| CC-01 | Concurrent initialize (all) | Multiple simultaneous `initialize()` calls — only one succeeds |
| CC-02 | Concurrent synthesize (TTS) | Multiple `synthesize()` calls — implementation-defined queuing or rejection |
| CC-03 | Concurrent writeAudio (STT) | `writeAudio()` from multiple callers is serialized |
| CC-04 | Concurrent send (Transport) | `send()` from multiple callers is serialized |

#### Long-running Tests (3 tests)

| # | Test | Duration | Verification |
|---|---|---|---|
| CLR-01 | STT stability | 60 min | No memory growth; no state corruption |
| CLR-02 | TTS stability | 60 min | No memory growth; no state corruption |
| CLR-03 | Transport stability | 60 min | No connection leaks; no state corruption |

### 13.3 Pass Criteria

| Suite | Tests | Min Pass Rate | Critical Failures | Blocks Registration |
|---|---|---|---|---|
| Lifecycle | 10 | 100% | Any | Yes |
| State Machine | 8 | 100% | Any | Yes |
| Health | 5 | 100% | Any | Yes |
| Error Contract | 6 | 100% | Any | Yes |
| Events | 8 | 100% | Any | Yes |
| Metrics | 4 | 100% | Any | Yes |
| STT-Specific | 7 | 100% | Any | Yes |
| TTS-Specific | 5 | 100% | Any | Yes |
| Transport-Specific | 6 | 100% | Any | Yes |
| Concurrency | 4 | 100% | Any | Yes |
| Long-running | 3 | 100% | 0 | Yes |

---

## 14. Version Compatibility

### 14.1 Provider Version

Every provider SHALL declare its version using Semantic Versioning (`MAJOR.MINOR.PATCH`):

- **MAJOR** — Incompatible interface changes (method removal, parameter changes, return type changes)
- **MINOR** — Backward-compatible additions (new optional methods, new events, new capabilities)
- **PATCH** — Backward-compatible fixes (bug fixes, performance improvements, no API changes)

### 14.2 Runtime Compatibility

| Provider MAJOR | Runtime MAJOR | Compatible |
|---|---|---|
| Same | Same | Yes |
| Provider lower | Runtime higher | Maybe (depends on deprecation) |
| Provider higher | Runtime lower | No |
| Different MAJOR | Any | No (unless explicit migration layer) |

### 14.3 Compliance Versioning

| # | Rule |
|---|---|
| V-01 | Provider `version` SHALL match the compliance spec version it targets |
| V-02 | A provider targeting compliance spec v1.x SHALL pass all v1.x compliance tests |
| V-03 | A provider targeting compliance spec v2.0+ SHALL pass all tests for that MAJOR version |
| V-04 | Runtime SHALL reject a provider whose MAJOR version does not match the runtime's expected MAJOR |
| V-05 | Provider MAY support multiple compliance spec versions by implementing multiple interfaces |

### 14.4 Backward Compatibility Guarantees

| Change | Backward Compatible? |
|---|---|
| Adding a new optional method | Yes (MINOR) |
| Adding a new event | Yes (MINOR) |
| Adding a new capability flag | Yes (MINOR) |
| Fixing a bug in existing behavior | Yes (PATCH) |
| Improving performance | Yes (PATCH) |
| Removing a method | No (MAJOR) |
| Changing a method signature | No (MAJOR) |
| Changing error code semantics | No (MAJOR) |
| Changing event payload structure | No (MAJOR) |

---

## 15. Compliance Audit — Automated Suite

### 15.1 Suite Interface

```typescript
interface ComplianceSuite {
  /** Human-readable name of the suite */
  readonly name: string;

  /** Provider category this suite targets */
  readonly targetType: "stt" | "tts" | "transport";

  /** Run all tests. Returns a detailed report. */
  run(provider: Provider): Promise<ComplianceReport>;
}

interface ComplianceReport {
  /** Overall pass/fail */
  passed: boolean;

  /** Timestamp of the test run */
  timestamp: Date;

  /** Provider under test */
  providerId: string;
  providerVersion: string;

  /** Results grouped by test category */
  categories: ComplianceCategoryResult[];

  /** Aggregate statistics */
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  };
}

interface ComplianceCategoryResult {
  name: string;
  passed: boolean;
  tests: ComplianceTestResult[];
}

interface ComplianceTestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}
```

### 15.2 Suite Registration

The compliance suite SHALL be registered with the provider factory and executed automatically:

```typescript
interface ProviderFactory {
  /** Register a compliance suite for a provider category */
  registerSuite(
    targetType: "stt" | "tts" | "transport",
    suite: ComplianceSuite
  ): void;

  /** Register a provider. Runs compliance suite automatically. */
  register(provider: Provider): Promise<void>;
  // Throws ComplianceError if compliance suite fails
}
```

### 15.3 Suite Distribution

A reference compliance suite implementation SHALL be distributed with the Voice Runtime. Provider authors MAY:

1. Use the reference suite directly (recommended)
2. Implement their own suite that produces the same `ComplianceReport` structure

---

## 16. Compliance Checklist

### 16.1 Provider Self-Certification Checklist

Every provider implementation SHALL be accompanied by a completed self-certification checklist. The checklist SHALL be signed by the provider author and included in the provider's documentation.

#### Base Provider — All Categories

| # | Requirement | Status | Notes |
|---|---|---|---|
| B-01 | `id` is immutable, non-empty, max 64 chars, matches `^[a-zA-Z0-9_-]+$` | | |
| B-02 | `name` is immutable, non-empty, max 128 chars | | |
| B-03 | `version` is valid semver | | |
| B-04 | `capabilities` is a complete object with all 5 fields | | |
| B-05 | `initialize()` validates config and rejects with `INVALID_CONFIGURATION` | | |
| B-06 | State machine follows Section 8 exactly | | |
| B-07 | `getState()` always returns current state | | |
| B-08 | `dispose()` releases all resources | | |
| B-09 | All 12 `ProviderErrorCode` values are supported | | |
| B-10 | Errors are always `ProviderError`, never raw `Error` | | |

#### Lifecycle

| # | Requirement | Status | Notes |
|---|---|---|---|
| L-01 | Valid transitions match Section 8.3 | | |
| L-02 | Illegal transitions are rejected with `INVALID_STATE` | | |
| L-03 | `start()` after `stop()` succeeds | | |
| L-04 | `dispose()` from `failed` succeeds | | |
| L-05 | All async methods settle within `timeoutMs` | | |

#### Events

| # | Requirement | Status | Notes |
|---|---|---|---|
| E-01 | All lifecycle events emitted | | |
| E-02 | All error events emitted | | |
| E-03 | All health events emitted | | |
| E-04 | Category-specific events emitted (STT/TTS/Transport) | | |
| E-05 | Events carry `providerId` and `providerType` | | |
| E-06 | Events ordered causally | | |
| E-07 | No events after `dispose()` | | |

#### Health

| # | Requirement | Status | Notes |
|---|---|---|---|
| H-01 | `health()` never throws | | |
| H-02 | `healthy` reflects operational status | | |
| H-03 | `latencyMs` is non-negative | | |
| H-04 | `lastHeartbeat` is current when healthy | | |

#### Metrics

| # | Requirement | Status | Notes |
|---|---|---|---|
| M-01 | Counters start at 0 after `initialize()` | | |
| M-02 | Counters increment correctly | | |
| M-03 | Metrics survive stop/start cycle | | |
| M-04 | `getMetrics()` returns all required fields | | |

#### STP-Specific

| # | Requirement | Status | Notes |
|---|---|---|---|
| STT-01 | `startRecognition()` begins recognition | | |
| STT-02 | `writeAudio()` accepts valid chunks | | |
| STT-03 | `writeAudio()` rejects invalid chunks with `INVALID_AUDIO` | | |
| STT-04 | `stopRecognition()` produces final transcript | | |
| STT-05 | Partial transcripts emitted during recognition | | |
| STT-06 | Multilingual support (if capability declared) | | |

#### TTS-Specific

| # | Requirement | Status | Notes |
|---|---|---|---|
| TTS-01 | `synthesize()` returns valid `AudioStream` | | |
| TTS-02 | Stream yields >= 1 chunk | | |
| TTS-03 | `stopSynthesis()` interrupts synthesis | | |
| TTS-04 | Invalid `rate`/`pitch` rejected | | |
| TTS-05 | Empty `text` rejected | | |

#### Transport-Specific

| # | Requirement | Status | Notes |
|---|---|---|---|
| TR-01 | `connect()` establishes connection | | |
| TR-02 | `disconnect()` terminates connection | | |
| TR-03 | Auto-reconnect on connection loss (if `reconnect` capability) | | |
| TR-04 | `send()` delivers messages | | |
| TR-05 | In-order message delivery | | |
| TR-06 | Connection loss detected and reported via event | | |

---

## 17. Compliance Enforcement

### 17.1 Registration Flow

```
Provider Implementation
        │
        ▼
Provider Factory .register(provider)
        │
        ├── Load compliance suite for provider type
        │
        ├── Run ComplianceSuite.run(provider)
        │       │
        │       ├── All tests pass → Continue
        │       │
        │       └── Any test fails → Reject with ComplianceError
        │
        ├── Store provider in registry
        │
        └── Return success
```

### 17.2 ComplianceError

```typescript
interface ComplianceError {
  code: "COMPLIANCE_FAILED";
  message: string;
  report: ComplianceReport;
}
```

### 17.3 Runtime Behavior on Compliance Failure

1. The provider SHALL NOT be registered
2. The factory SHALL emit `error.provider` with code `COMPLIANCE_FAILED`
3. The factory SHALL return the `ComplianceReport` as part of the error
4. The runtime SHALL continue operating with previously registered providers

---

## 18. Appendix A — Provider Self-Certification Template

```
╔══════════════════════════════════════════════════════════════╗
║         Provider Compliance Self-Certification              ║
╠══════════════════════════════════════════════════════════════╣
║ Provider Name:    _________________________________         ║
║ Provider ID:      _________________________________         ║
║ Provider Version: _________________________________         ║
║ Provider Type:    [ ] STT   [ ] TTS   [ ] Transport        ║
║ Compliance Spec:  TVR-PCS-001 v1.0.0                        ║
║ Date:             _________________________________         ║
║ Author:           _________________________________         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║ I certify that this provider implementation complies with    ║
║ all requirements in TVR-PCS-001 v1.0.0 as checked in the    ║
║ compliance checklist (Section 16).                           ║
║                                                              ║
║ All tests in the automated compliance suite (Section 13)     ║
║ pass at 100%.                                                 ║
║                                                              ║
║ Signature: _________________________________                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 19. Appendix B — Error Code Reference

| Code | Category | Retryable | Message Pattern |
|---|---|---|---|
| `INITIALIZATION_FAILED` | Lifecycle | `false` | `"Provider {id} failed to initialize: {detail}"` |
| `AUTHENTICATION_FAILED` | Auth | `false` | `"Provider {id} authentication failed: {detail}"` |
| `CONNECTION_FAILED` | Network | `true` | `"Provider {id} connection failed: {detail}"` |
| `CONNECTION_LOST` | Network | `true` | `"Provider {id} connection lost: {detail}"` |
| `TIMEOUT` | Timing | `true` | `"Provider {id} operation {op} timed out after {ms}ms"` |
| `INVALID_CONFIGURATION` | Config | `false` | `"Provider {id} invalid configuration: {field}: {detail}"` |
| `INVALID_AUDIO` | Input | `false` | `"Provider {id} invalid audio: {detail}"` |
| `UNSUPPORTED_LANGUAGE` | Input | `false` | `"Provider {id} unsupported language: {lang}"` |
| `RATE_LIMITED` | Throttle | `true` | `"Provider {id} rate limited: {detail}"` |
| `SERVICE_UNAVAILABLE` | Backend | `true` | `"Provider {id} service unavailable: {detail}"` |
| `UNKNOWN_ERROR` | Catch-all | `false` | `"Provider {id} unknown error: {detail}"` |
| `INVALID_STATE` | State | `false` | `"Provider {id} invalid state {state} for operation {op}"` |

---

## 20. Appendix C — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. All compliance requirements for STT, TTS, and Transport providers defined. |
