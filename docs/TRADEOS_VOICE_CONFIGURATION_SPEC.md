# TradeOS Voice Runtime — Configuration Specification

Document ID: TVR-VCS-001
Title: TradeOS Voice Runtime Configuration Specification
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
- TRADEOS_RUNTIME_EVENT_MODEL.md (TVR-EM-001)
- Frozen Voice Runtime Architecture
- Frozen Conversation Gateway Protocol

---

## 1. Purpose

This specification defines **every configurable option** across all Voice Runtime components. It serves as the single source of truth for:

- The complete set of configuration interfaces and their fields
- Field types, required/optional status, and default values
- Validation rules and bounds for every numeric/string field
- Cross-field constraint rules (e.g., `idleTimeoutMs` must be less than `sessionTimeoutMs`)
- Configuration versioning strategy and migration rules
- Compliance requirements for configuration handling

No production code is generated from this specification. Implementations SHALL derive their configuration types and validation logic from this document.

---

## 2. Scope

This specification covers configuration for:

| Layer | Configuration Type | Source |
|---|---|---|
| 1. Top-Level Runtime | `VoiceRuntimeConfiguration` | This document |
| 2. Provider | `ProviderConfiguration`, `RetryPolicy` | TVR-PIS-001 |
| 3. Audio | `VadConfiguration`, `AudioDeviceDescriptor` | TVR-SRS-001 |
| 4. Speech Runtime | `SpeechRuntimeConfiguration` | TVR-SRS-001 |
| 5. Streaming | `StreamConfiguration`, `CompressionOptions` | TVR-STRS-001 |
| 6. Dialogue | `DialogueConfiguration` | This document, TVR-DRS-001 |
| 7. Session | `SessionConfiguration`, `SessionOptions` | TVR-SESR-001 |
| 8. Gateway Client | `GatewayClientConfiguration` | TVR-GWC-001 |
| 9. SDK | `SDKConfiguration`, `AudioConfiguration`, `LoggingConfiguration` | TVR-VSDK-001 |

---

## 3. Configuration Architecture

### 3.1 Composition Model

Configuration is hierarchical. The top-level `VoiceRuntimeConfiguration` composes all component-level configurations:

```
VoiceRuntimeConfiguration
├── runtime       → RuntimeConfiguration
├── providers     → ProviderConfiguration[]
├── speech        → SpeechRuntimeConfiguration
├── streaming     → StreamConfiguration
├── dialogue      → DialogueConfiguration
├── session       → SessionConfiguration
├── gateway       → GatewayClientConfiguration
└── sdk           → SDKConfiguration
```

### 3.2 Principles

1. **Every configuration field has a defined default.** No required field shall be left to the implementer to guess.
2. **Every configuration is validated at initialization.** Invalid configuration SHALL produce a `ConfigurationError` event and reject the initialize promise.
3. **Configuration is immutable after initialization.** No field may be changed after the component is initialized. Changes require disposal and re-initialization.
4. **Configuration errors are structured.** Invalid configuration SHALL produce an error with the field name, the invalid value, the allowed range or values, and a human-readable message.
5. **Configuration is serializable.** All configuration types SHALL be serializable to JSON. No function references, class instances, or circular references.
6. **Configuration versioning is explicit.** Every configuration envelope SHALL carry a `version` field. Version migration is handled by a dedicated migration layer.

### 3.3 ConfigurationError Schema

```typescript
interface ConfigurationError {
  field: string;
  value: unknown;
  expected: string;
  message: string;
}
```

---

## 4. Runtime Configuration

Top-level runtime configuration that applies to the entire Voice Runtime instance.

### 4.1 VoiceRuntimeConfiguration

```typescript
interface VoiceRuntimeConfiguration {
  /** Schema version of this configuration object */
  version: string;

  /** Global runtime settings */
  runtime: RuntimeConfiguration;

  /** Provider configurations (one per provider) */
  providers: ProviderConfiguration[];

  /** Speech runtime configuration */
  speech: SpeechRuntimeConfiguration;

  /** Streaming runtime configuration */
  streaming: StreamConfiguration;

  /** Dialogue runtime configuration */
  dialogue: DialogueConfiguration;

  /** Session runtime configuration */
  session: SessionConfiguration;

  /** Gateway client configuration */
  gateway: GatewayClientConfiguration;

  /** SDK configuration */
  sdk: SDKConfiguration;
}
```

### 4.2 RuntimeConfiguration

```typescript
interface RuntimeConfiguration {
  /** Globally unique identifier for this runtime instance */
  instanceId: string;

  /** Environment label — used for event emission and logging */
  environment: "development" | "staging" | "production";

  /** Default language for voice interactions (BCP 47 tag) */
  defaultLanguage: string;

  /** Default log level for all components */
  logLevel: "debug" | "info" | "warn" | "error" | "silent";

  /** Global timeout for all component initialization (ms) */
  initTimeoutMs: number;

  /** Interval at which the runtime emits health telemetry events (ms) */
  healthReportIntervalMs: number;

  /** Enable detailed metrics collection (disables to reduce overhead) */
  enableDetailedMetrics: boolean;

  /** Enable debug event emission (includes debug-level events) */
  enableDebugEvents: boolean;
}
```

### 4.3 Validation Rules

| Field | Rule |
|---|---|
| `instanceId` | Non-empty string, max 64 characters, alphanumeric + hyphens only |
| `environment` | Must be one of: `"development"`, `"staging"`, `"production"` |
| `defaultLanguage` | Valid BCP 47 language tag (regex: `^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$`) |
| `logLevel` | Must be one of: `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"` |
| `initTimeoutMs` | Must be between 1000 and 60000 |
| `healthReportIntervalMs` | Must be between 1000 and 3600000 |
| `enableDetailedMetrics` | Boolean |
| `enableDebugEvents` | Boolean |

### 4.4 Default Values

| Field | Default |
|---|---|
| `environment` | `"production"` |
| `defaultLanguage` | `"en"` |
| `logLevel` | `"info"` |
| `initTimeoutMs` | `10000` |
| `healthReportIntervalMs` | `30000` |
| `enableDetailedMetrics` | `true` |
| `enableDebugEvents` | `false` |

---

## 5. Provider Configuration

Configures individual provider instances (STT, TTS, Transport).

### 5.1 ProviderConfiguration

```typescript
interface ProviderConfiguration {
  /** Unique identifier for this provider instance */
  providerId: string;

  /** Provider type category */
  providerType: "stt" | "tts" | "transport";

  /** Provider implementation key (e.g., "google", "azure", "websocket") */
  providerKey: string;

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Retry policy for failed requests */
  retryPolicy: RetryPolicy;

  /** Provider-specific configuration (opaque, validated by provider factory) */
  providerOptions?: Record<string, unknown>;

  /** Credentials reference (key name in secure credential store, never inline) */
  credentialsRef?: string;

  /** Arbitrary metadata for routing, tagging, and debugging */
  metadata: Record<string, unknown>;
}
```

### 5.2 RetryPolicy

```typescript
interface RetryPolicy {
  /** Maximum number of retry attempts (0 = no retry) */
  maxAttempts: number;

  /** Base delay before first retry (ms) */
  baseDelayMs: number;

  /** Maximum delay between retries (ms) — caps exponential growth */
  maxDelayMs: number;

  /** Enable exponential backoff (false = fixed baseDelayMs) */
  exponentialBackoff: boolean;

  /** Maximum total retry duration across all attempts (ms) — 0 = unlimited */
  totalTimeoutMs?: number;

  /** HTTP status codes that trigger a retry */
  retryableStatuses?: number[];
}
```

### 5.3 Validation Rules

#### ProviderConfiguration

| Field | Rule |
|---|---|
| `providerId` | Non-empty string, max 64 characters, regex: `^[a-zA-Z0-9_-]+$` |
| `providerType` | Must be one of: `"stt"`, `"tts"`, `"transport"` |
| `providerKey` | Non-empty string, max 64 characters |
| `timeoutMs` | Must be between 100 and 60000 |
| `credentialsRef` | If provided, must be non-empty and reference a valid store key |

#### RetryPolicy

| Field | Rule |
|---|---|
| `maxAttempts` | Must be between 0 and 10 |
| `baseDelayMs` | Must be between 50 and 30000 |
| `maxDelayMs` | Must be >= `baseDelayMs` |
| `totalTimeoutMs` | If provided, must be > 0 and <= 300000 |
| `retryableStatuses` | If provided, each value must be a valid HTTP status code (100–599) |

### 5.4 Default Values

#### RetryPolicy

| Field | Default |
|---|---|
| `maxAttempts` | `3` |
| `baseDelayMs` | `500` |
| `maxDelayMs` | `10000` |
| `exponentialBackoff` | `true` |
| `totalTimeoutMs` | `30000` |
| `retryableStatuses` | `[429, 500, 502, 503]` |

---

## 6. Audio Configuration

Audio-level configuration shared across Speech Runtime and SDK.

### 6.1 AudioDeviceDescriptor

```typescript
interface AudioDeviceDescriptor {
  /** Platform device identifier */
  deviceId: string;

  /** Human-readable label */
  label?: string;

  /** Device group identifier (same physical device across APIs) */
  groupId?: string;

  /** Direction of audio flow */
  kind: "audioinput" | "audiooutput";
}
```

#### Validation

| Field | Rule |
|---|---|
| `deviceId` | Non-empty string |
| `kind` | Must be exactly `"audioinput"` or `"audiooutput"` |

#### Defaults

No defaults — `deviceId` and `kind` are always required.

---

### 6.2 VadConfiguration

```typescript
interface VadConfiguration {
  /** VAD sensitivity mode */
  mode?: "aggressive" | "moderate" | "sensitive";

  /** Duration of silence before speech segment is considered ended (ms) */
  silenceTimeoutMs: number;

  /** Energy threshold for speech detection (0.0 – 1.0) */
  speechThreshold?: number;

  /** Energy threshold for silence detection (0.0 – 1.0) */
  silenceThreshold?: number;

  /** Minimum duration to qualify as speech (ms) — filters noise spikes */
  minSpeechDurationMs?: number;
}
```

#### Validation

| Field | Rule |
|---|---|
| `mode` | If provided, must be `"aggressive"`, `"moderate"`, or `"sensitive"` |
| `silenceTimeoutMs` | Must be between 200 and 5000 |
| `speechThreshold` | If provided, must be between 0.0 and 1.0 |
| `silenceThreshold` | If provided, must be between 0.0 and 1.0 |
| `minSpeechDurationMs` | If provided, must be between 50 and 2000 |

#### Defaults

| Field | Default |
|---|---|
| `mode` | `"moderate"` |
| `silenceTimeoutMs` | `800` |
| `speechThreshold` | `0.5` |
| `silenceThreshold` | `0.3` |
| `minSpeechDurationMs` | `150` |

---

### 6.3 AudioConfiguration (SDK-level)

```typescript
interface AudioConfiguration {
  /** Sample rate for audio input capture (Hz) */
  inputSampleRate?: number;

  /** Sample rate for audio output playback (Hz) */
  outputSampleRate?: number;

  /** Input device ID (platform-specific) */
  inputDeviceId?: string;

  /** Output device ID (platform-specific) */
  outputDeviceId?: string;

  /** Enable acoustic echo cancellation */
  echoCancellation?: boolean;

  /** Enable noise suppression filter */
  noiseSuppression?: boolean;

  /** Enable automatic gain control */
  automaticGainControl?: boolean;
}
```

#### Validation

| Field | Rule |
|---|---|
| `inputSampleRate` | If provided, must be one of: `8000`, `16000`, `24000`, `44100`, `48000` |
| `outputSampleRate` | If provided, must be one of: `8000`, `16000`, `24000`, `44100`, `48000` |

#### Defaults

| Field | Default |
|---|---|
| `inputSampleRate` | `16000` |
| `outputSampleRate` | `24000` |
| `inputDeviceId` | `"default"` |
| `outputDeviceId` | `"default"` |
| `echoCancellation` | `false` |
| `noiseSuppression` | `false` |
| `automaticGainControl` | `false` |

---

## 7. Speech Runtime Configuration

### 7.1 SpeechRuntimeConfiguration

```typescript
interface SpeechRuntimeConfiguration {
  /** Provider ID for Speech-to-Text service */
  sttProviderId: string;

  /** Provider ID for Text-to-Speech service */
  ttsProviderId: string;

  /** Audio input device descriptor */
  audioInputDevice: AudioDeviceDescriptor;

  /** Audio output device descriptor */
  audioOutputDevice: AudioDeviceDescriptor;

  /** Sample rate for audio input (Hz) */
  inputSampleRate: number;

  /** Sample rate for audio output (Hz) */
  outputSampleRate: number;

  /** Audio encoding format (e.g., "pcm_s16le", "opus") */
  audioEncoding: string;

  /** Voice Activity Detection configuration */
  vad: VadConfiguration;

  /** Silence timeout for end-of-speech detection (ms) */
  silenceTimeoutMs: number;

  /** Maximum time to wait for a recognition result (ms) */
  recognitionTimeoutMs: number;

  /** Size of the playback buffer in bytes */
  playbackBufferSize: number;

  /** Enable noise suppression on input */
  noiseSuppression?: boolean;

  /** Enable echo cancellation on input */
  echoCancellation?: boolean;

  /** Enable automatic gain control on input */
  automaticGainControl?: boolean;

  /** Preferred recognition language (BCP 47 tag) */
  preferredLanguage?: string;

  /** Preferred TTS voice identifier */
  preferredVoice?: string;

  /** Maximum duration for a single playback segment (ms) */
  maxPlaybackDurationMs?: number;

  /** Log level for speech runtime internals */
  logLevel?: string;
}
```

### 7.2 Validation Rules

| Field | Rule |
|---|---|
| `sttProviderId` | Must match a `providerId` in the `providers` array with `providerType = "stt"` |
| `ttsProviderId` | Must match a `providerId` in the `providers` array with `providerType = "tts"` |
| `inputSampleRate` | Must be one of: `8000`, `16000`, `24000`, `44100`, `48000` |
| `outputSampleRate` | Must be one of: `8000`, `16000`, `24000`, `44100`, `48000` |
| `audioEncoding` | Must be non-empty string, max 32 characters |
| `silenceTimeoutMs` | Must be between 200 and 10000 |
| `recognitionTimeoutMs` | Must be between 1000 and 60000 |
| `playbackBufferSize` | Must be between 1024 and 1048576 |
| `maxPlaybackDurationMs` | If provided, must be between 1000 and 300000 |
| `logLevel` | If provided, must be one of: `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"` |

### 7.3 Default Values

| Field | Default |
|---|---|
| `inputSampleRate` | `16000` |
| `outputSampleRate` | `24000` |
| `audioEncoding` | `"pcm_s16le"` |
| `silenceTimeoutMs` | `1500` |
| `recognitionTimeoutMs` | `10000` |
| `playbackBufferSize` | `65536` |
| `noiseSuppression` | `false` |
| `echoCancellation` | `false` |
| `automaticGainControl` | `false` |
| `maxPlaybackDurationMs` | `60000` |
| `logLevel` | `"info"` |

---

## 8. Streaming Configuration

### 8.1 StreamConfiguration

```typescript
interface StreamConfiguration {
  /** Size of each audio chunk in bytes */
  chunkSize: number;

  /** Maximum size of the stream buffer (bytes) */
  maxBufferSize: number;

  /** Minimum threshold for buffer before requesting more data (bytes) */
  minBufferSize: number;

  /** Maximum acceptable one-way latency (ms) */
  maxLatencyMs: number;

  /** Interval between stream heartbeats (ms) */
  heartbeatIntervalMs: number;

  /** Interval between reconnection attempts (ms) */
  reconnectIntervalMs: number;

  /** Maximum time allowed for stream recovery (ms) */
  recoveryTimeoutMs: number;

  /** Maximum number of reconnection retries */
  maxRetries: number;

  /** Compression options */
  compression: CompressionOptions;

  /** Stream direction mode */
  mode: StreamingMode;
}

type StreamingMode = "send" | "receive" | "duplex";
```

### 8.2 CompressionOptions

```typescript
interface CompressionOptions {
  /** Enable compression */
  enabled: boolean;

  /** Compression algorithm */
  algorithm?: "gzip" | "zlib" | "none";

  /** Compression level (1–9) */
  level?: number;
}
```

### 8.3 Validation Rules

#### StreamConfiguration

| Field | Rule |
|---|---|
| `chunkSize` | Must be between 160 and 65535 bytes |
| `maxBufferSize` | Must be >= `minBufferSize` |
| `minBufferSize` | Must be > 0 and <= `maxBufferSize` |
| `maxLatencyMs` | Must be > 0 |
| `heartbeatIntervalMs` | Must be between 100 and 30000 |
| `reconnectIntervalMs` | Must be between 100 and 10000 |
| `recoveryTimeoutMs` | Must be > `reconnectIntervalMs` |
| `maxRetries` | Must be between 0 and 10 |
| `mode` | Must be `"send"`, `"receive"`, or `"duplex"` |

#### CompressionOptions

| Field | Rule |
|---|---|
| `algorithm` | When `enabled` is `true`, must be `"gzip"` or `"zlib"` (not `"none"`) |
| `level` | When `algorithm` is set, must be between 1 and 9 |

### 8.4 Default Values

| Field | Default |
|---|---|
| `chunkSize` | `4096` |
| `maxBufferSize` | `262144` (256 KB) |
| `minBufferSize` | `65536` (64 KB) |
| `maxLatencyMs` | `300` |
| `heartbeatIntervalMs` | `1000` |
| `reconnectIntervalMs` | `500` |
| `recoveryTimeoutMs` | `10000` |
| `maxRetries` | `3` |
| `mode` | `"duplex"` |
| `compression.enabled` | `false` |
| `compression.algorithm` | `"none"` |

---

## 9. Dialogue Configuration

### 9.1 DialogueConfiguration

```typescript
interface DialogueConfiguration {
  /** Maximum time to wait for gateway response during thinking state (ms) */
  thinkingTimeoutMs: number;

  /** Maximum time to wait for user confirmation response (ms) */
  confirmationTimeoutMs: number;

  /** Maximum time to wait for user clarification response (ms) */
  clarificationTimeoutMs: number;

  /** Maximum duration of a single dialogue turn (ms) */
  turnTimeoutMs: number;

  /** Maximum number of consecutive clarification rounds before escalation */
  maxClarificationRounds: number;

  /** Maximum number of consecutive confirmation rounds before escalation */
  maxConfirmationRounds: number;

  /** Confidence threshold below which confirmation is requested (0.0 – 1.0) */
  confirmationThreshold: number;

  /** Confidence threshold below which clarification is requested (0.0 – 1.0) */
  clarificationThreshold: number;

  /** Enable interruption handling (user speech during TTS playback) */
  enableInterruption: boolean;

  /** Enable automatic recovery after gateway timeout or error */
  enableAutoRecovery: boolean;

  /** Maximum recovery attempts before failing the turn */
  maxRecoveryAttempts: number;

  /** Log level for dialogue runtime internals */
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
}
```

### 9.2 DialogueState

```typescript
type DialogueState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "awaiting_confirmation"
  | "awaiting_clarification"
  | "interrupted"
  | "recovering"
  | "completed"
  | "failed";
```

### 9.3 Validation Rules

| Field | Rule |
|---|---|
| `thinkingTimeoutMs` | Must be between 1000 and 60000 |
| `confirmationTimeoutMs` | Must be between 1000 and 30000 |
| `clarificationTimeoutMs` | Must be between 1000 and 30000 |
| `turnTimeoutMs` | Must be between 5000 and 120000 |
| `maxClarificationRounds` | Must be between 1 and 10 |
| `maxConfirmationRounds` | Must be between 1 and 10 |
| `confirmationThreshold` | Must be between 0.0 and 1.0 |
| `clarificationThreshold` | Must be between 0.0 and 1.0 |
| `maxRecoveryAttempts` | Must be between 0 and 5 |

#### Cross-field Rules

- `clarificationThreshold` MUST be less than or equal to `confirmationThreshold`
- `thinkingTimeoutMs` MUST be less than `turnTimeoutMs`

### 9.4 Default Values

| Field | Default |
|---|---|
| `thinkingTimeoutMs` | `15000` |
| `confirmationTimeoutMs` | `10000` |
| `clarificationTimeoutMs` | `10000` |
| `turnTimeoutMs` | `30000` |
| `maxClarificationRounds` | `3` |
| `maxConfirmationRounds` | `3` |
| `confirmationThreshold` | `0.6` |
| `clarificationThreshold` | `0.3` |
| `enableInterruption` | `true` |
| `enableAutoRecovery` | `true` |
| `maxRecoveryAttempts` | `2` |
| `logLevel` | `"info"` |

---

## 10. Session Configuration

### 10.1 SessionConfiguration

```typescript
interface SessionConfiguration {
  /** Maximum idle time before session is suspended (ms) */
  idleTimeoutMs: number;

  /** Maximum total session duration before forced expiration (ms) */
  sessionTimeoutMs: number;

  /** Interval between session heartbeat signals (ms) */
  heartbeatIntervalMs: number;

  /** Maximum time allowed for session recovery (ms) */
  recoveryTimeoutMs: number;

  /** Absolute maximum session lifetime from creation (ms) */
  maxSessionDurationMs: number;

  /** Maximum size of session metadata payload (bytes) */
  maxMetadataSizeBytes: number;

  /** Maximum number of concurrent sessions */
  maxSessions: number;
}
```

### 10.2 SessionOptions

```typescript
interface SessionOptions {
  /** Communication channel */
  channel: Channel;

  /** Preferred language for this session (BCP 47 tag) */
  language?: string;

  /** End-user identifier */
  userId?: string;

  /** Organization or tenant identifier */
  organizationId?: string;

  /** Pre-existing conversation ID to associate */
  conversationId?: string;

  /** Per-session metadata */
  metadata?: Record<string, unknown>;
}

type Channel = "web" | "voice" | "whatsapp" | "phone" | "mcp" | "desktop" | "mobile";
```

### 10.3 SessionMetadata

```typescript
interface SessionMetadata {
  channel: Channel;
  language?: string;
  userId?: string;
  organizationId?: string;
  deviceInfo?: DeviceInfo;
  custom: Record<string, unknown>;
}

interface DeviceInfo {
  platform?: string;
  browser?: string;
  version?: string;
}
```

### 10.4 Validation Rules

#### SessionConfiguration

| Field | Rule |
|---|---|
| `sessionTimeoutMs` | Must be between 1000 and 3600000 |
| `idleTimeoutMs` | Must be between 5000 and 300000 |
| `heartbeatIntervalMs` | Must be between 1000 and 60000 |
| `recoveryTimeoutMs` | Must be between 5000 and 60000 |
| `maxSessionDurationMs` | Must be between 60000 and 86400000 |
| `maxMetadataSizeBytes` | Must be between 256 and 65536 |
| `maxSessions` | Must be between 1 and 10000 |

#### Cross-field Rules

- `idleTimeoutMs` MUST be less than `sessionTimeoutMs`
- `heartbeatIntervalMs` MUST be less than `recoveryTimeoutMs`

#### SessionOptions

| Field | Rule |
|---|---|
| `channel` | Must be a valid `Channel` value |
| `language` | If provided, must be a valid BCP 47 tag |
| `metadata` | If provided, total serialized size must be <= `maxMetadataSizeBytes` |

### 10.5 Default Values

| Field | Default |
|---|---|
| `sessionTimeoutMs` | `600000` (10 min) |
| `idleTimeoutMs` | `30000` (30 sec) |
| `heartbeatIntervalMs` | `5000` |
| `recoveryTimeoutMs` | `10000` |
| `maxSessionDurationMs` | `3600000` (1 hour) |
| `maxMetadataSizeBytes` | `4096` |
| `maxSessions` | `100` |

---

## 11. Gateway Client Configuration

### 11.1 GatewayClientConfiguration

```typescript
interface GatewayClientConfiguration {
  /** Per-request timeout (ms) */
  timeoutMs: number;

  /** Maximum number of retry attempts per request */
  retryMaxAttempts: number;

  /** Base delay before first retry (ms) */
  retryBaseDelayMs: number;

  /** Maximum delay between retries (ms) */
  retryMaxDelayMs: number;

  /** Hard channel value — always "voice" */
  channel: "voice";
}
```

### 11.2 Validation Rules

| Field | Rule |
|---|---|
| `timeoutMs` | Must be between 1000 and 60000 |
| `retryMaxAttempts` | Must be between 0 and 5 |
| `retryBaseDelayMs` | Must be between 100 and 5000 |
| `retryMaxDelayMs` | Must be between 1000 and 30000 |
| `channel` | Must be exactly `"voice"` |

#### Cross-field Rules

- `retryMaxDelayMs` MUST be greater than `retryBaseDelayMs`
- `timeoutMs` MUST be greater than `retryBaseDelayMs`

### 11.3 Default Values

| Field | Default |
|---|---|
| `timeoutMs` | `10000` |
| `retryMaxAttempts` | `3` |
| `retryBaseDelayMs` | `1000` |
| `retryMaxDelayMs` | `10000` |
| `channel` | `"voice"` |

---

## 12. SDK Configuration

### 12.1 SDKConfiguration

```typescript
interface SDKConfiguration {
  /** Client type identifier */
  clientType: ClientType;

  /** API key for gateway authentication (required for whatsapp/phone/mcp, optional for web/mobile/desktop) */
  apiKey?: string;

  /** Base URL of the TradeOS gateway */
  baseUrl: string;

  /** Request timeout (ms) */
  timeout?: number;

  /** Default language for sessions (BCP 47 tag) */
  language?: string;

  /** Audio hardware configuration (web/mobile/desktop only) */
  audio?: AudioConfiguration;

  /** Logging behavior */
  logging?: LoggingConfiguration;
}

type ClientType = "web" | "mobile" | "desktop" | "whatsapp" | "phone" | "mcp";
```

### 12.2 LoggingConfiguration

```typescript
interface LoggingConfiguration {
  /** Log verbosity level */
  level: "debug" | "info" | "warn" | "error" | "silent";

  /** Optional prefix for all log messages */
  prefix?: string;
}
```

### 12.3 Validation Rules

#### SDKConfiguration

| Field | Rule |
|---|---|
| `clientType` | Must be a valid `ClientType` value |
| `apiKey` | Required when `clientType` is `"whatsapp"`, `"phone"`, or `"mcp"`; must be non-empty string |
| `baseUrl` | Must be a valid URL with `http://` or `https://` scheme |
| `timeout` | If provided, must be between 1000 and 60000 |
| `language` | If provided, must be a valid BCP 47 tag |

#### LoggingConfiguration

| Field | Rule |
|---|---|
| `level` | Must be one of: `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"` |
| `prefix` | If provided, max 32 characters |

### 12.4 Default Values

| Field | Default |
|---|---|
| `timeout` | `10000` |
| `language` | `"en"` |
| `logging.level` | `"info"` |

---

## 13. Consolidated Validation Rules

### 13.1 General Validation Behavior

All component configuration validation SHALL follow these rules:

1. **Validation timing:** Configuration SHALL be validated during `initialize()`. No component may proceed past `initialize()` with invalid configuration.
2. **Error production:** Invalid configuration SHALL emit a `configuration.invalid` event and reject the initialize promise with a `ConfigurationError`.
3. **Field-level errors:** Each invalid field SHALL produce a separate `ConfigurationError` describing the field name, the invalid value, the expected constraint, and a human-readable message.
4. **All-at-once validation:** All fields SHALL be validated before any error is reported. A single `initialize()` call SHALL report ALL invalid fields, not just the first one found.
5. **Immutable after init:** Configuration SHALL be frozen (immutable) after `initialize()` succeeds. No component may mutate its own configuration at runtime.
6. **Cross-field validation:** Cross-field rules (e.g., `retryMaxDelayMs > retryBaseDelayMs`) SHALL be validated and produce a single error referencing both fields.

### 13.2 Validation Order

Validation SHALL proceed in dependency order:

1. `RuntimeConfiguration` (no dependencies)
2. `ProviderConfiguration[]` (no dependencies)
3. `DialogueConfiguration` (no dependencies)
4. `GatewayClientConfiguration` (no dependencies)
5. `SessionConfiguration` (no dependencies)
6. `StreamConfiguration` (no dependencies)
7. `SpeechRuntimeConfiguration` (depends on `ProviderConfiguration` — validates provider IDs exist)
8. `SDKConfiguration` (validated at `createClient()`, not at runtime initialize)

### 13.3 ConfigurationError Type

```typescript
interface ConfigurationError {
  /** Dot-separated path to the invalid field (e.g., "speech.sttProviderId") */
  field: string;

  /** The value that failed validation */
  value: unknown;

  /** Human-readable description of the expected constraint */
  expected: string;

  /** Human-readable error message */
  message: string;

  /** Error code — invariant for automated handling */
  code: ConfigurationErrorCode;
}

type ConfigurationErrorCode =
  | "FIELD_REQUIRED"
  | "FIELD_TYPE_MISMATCH"
  | "FIELD_OUT_OF_RANGE"
  | "FIELD_INVALID_OPTION"
  | "FIELD_TOO_LONG"
  | "FIELD_TOO_SHORT"
  | "FIELD_PATTERN_MISMATCH"
  | "CROSS_FIELD_CONSTRAINT"
  | "PROVIDER_REFERENCE_NOT_FOUND"
  | "DEPENDENCY_MISSING";
```

---

## 14. Consolidated Default Values Table

### 14.1 Runtime

| Path | Field | Default |
|---|---|---|
| `runtime.environment` | environment | `"production"` |
| `runtime.defaultLanguage` | defaultLanguage | `"en"` |
| `runtime.logLevel` | logLevel | `"info"` |
| `runtime.initTimeoutMs` | initTimeoutMs | `10000` |
| `runtime.healthReportIntervalMs` | healthReportIntervalMs | `30000` |
| `runtime.enableDetailedMetrics` | enableDetailedMetrics | `true` |
| `runtime.enableDebugEvents` | enableDebugEvents | `false` |

### 14.2 Provider

| Path | Field | Default |
|---|---|---|
| `providers[].retryPolicy.maxAttempts` | maxAttempts | `3` |
| `providers[].retryPolicy.baseDelayMs` | baseDelayMs | `500` |
| `providers[].retryPolicy.maxDelayMs` | maxDelayMs | `10000` |
| `providers[].retryPolicy.exponentialBackoff` | exponentialBackoff | `true` |
| `providers[].retryPolicy.totalTimeoutMs` | totalTimeoutMs | `30000` |
| `providers[].retryPolicy.retryableStatuses` | retryableStatuses | `[429, 500, 502, 503]` |

### 14.3 Audio

| Path | Field | Default |
|---|---|---|
| `speech.inputSampleRate` | inputSampleRate | `16000` |
| `speech.outputSampleRate` | outputSampleRate | `24000` |
| `speech.audioEncoding` | audioEncoding | `"pcm_s16le"` |
| `speech.silenceTimeoutMs` | silenceTimeoutMs | `1500` |
| `speech.recognitionTimeoutMs` | recognitionTimeoutMs | `10000` |
| `speech.playbackBufferSize` | playbackBufferSize | `65536` |
| `speech.noiseSuppression` | noiseSuppression | `false` |
| `speech.echoCancellation` | echoCancellation | `false` |
| `speech.automaticGainControl` | automaticGainControl | `false` |
| `speech.maxPlaybackDurationMs` | maxPlaybackDurationMs | `60000` |
| `speech.logLevel` | logLevel | `"info"` |
| `speech.vad.mode` | mode | `"moderate"` |
| `speech.vad.silenceTimeoutMs` | silenceTimeoutMs | `800` |
| `speech.vad.speechThreshold` | speechThreshold | `0.5` |
| `speech.vad.silenceThreshold` | silenceThreshold | `0.3` |
| `speech.vad.minSpeechDurationMs` | minSpeechDurationMs | `150` |
| `sdk.audio.inputSampleRate` | inputSampleRate | `16000` |
| `sdk.audio.outputSampleRate` | outputSampleRate | `24000` |
| `sdk.audio.echoCancellation` | echoCancellation | `false` |
| `sdk.audio.noiseSuppression` | noiseSuppression | `false` |
| `sdk.audio.automaticGainControl` | automaticGainControl | `false` |

### 14.4 Streaming

| Path | Field | Default |
|---|---|---|
| `streaming.chunkSize` | chunkSize | `4096` |
| `streaming.maxBufferSize` | maxBufferSize | `262144` |
| `streaming.minBufferSize` | minBufferSize | `65536` |
| `streaming.maxLatencyMs` | maxLatencyMs | `300` |
| `streaming.heartbeatIntervalMs` | heartbeatIntervalMs | `1000` |
| `streaming.reconnectIntervalMs` | reconnectIntervalMs | `500` |
| `streaming.recoveryTimeoutMs` | recoveryTimeoutMs | `10000` |
| `streaming.maxRetries` | maxRetries | `3` |
| `streaming.mode` | mode | `"duplex"` |
| `streaming.compression.enabled` | enabled | `false` |
| `streaming.compression.algorithm` | algorithm | `"none"` |

### 14.5 Dialogue

| Path | Field | Default |
|---|---|---|
| `dialogue.thinkingTimeoutMs` | thinkingTimeoutMs | `15000` |
| `dialogue.confirmationTimeoutMs` | confirmationTimeoutMs | `10000` |
| `dialogue.clarificationTimeoutMs` | clarificationTimeoutMs | `10000` |
| `dialogue.turnTimeoutMs` | turnTimeoutMs | `30000` |
| `dialogue.maxClarificationRounds` | maxClarificationRounds | `3` |
| `dialogue.maxConfirmationRounds` | maxConfirmationRounds | `3` |
| `dialogue.confirmationThreshold` | confirmationThreshold | `0.6` |
| `dialogue.clarificationThreshold` | clarificationThreshold | `0.3` |
| `dialogue.enableInterruption` | enableInterruption | `true` |
| `dialogue.enableAutoRecovery` | enableAutoRecovery | `true` |
| `dialogue.maxRecoveryAttempts` | maxRecoveryAttempts | `2` |
| `dialogue.logLevel` | logLevel | `"info"` |

### 14.6 Session

| Path | Field | Default |
|---|---|---|
| `session.sessionTimeoutMs` | sessionTimeoutMs | `600000` |
| `session.idleTimeoutMs` | idleTimeoutMs | `30000` |
| `session.heartbeatIntervalMs` | heartbeatIntervalMs | `5000` |
| `session.recoveryTimeoutMs` | recoveryTimeoutMs | `10000` |
| `session.maxSessionDurationMs` | maxSessionDurationMs | `3600000` |
| `session.maxMetadataSizeBytes` | maxMetadataSizeBytes | `4096` |
| `session.maxSessions` | maxSessions | `100` |

### 14.7 Gateway Client

| Path | Field | Default |
|---|---|---|
| `gateway.timeoutMs` | timeoutMs | `10000` |
| `gateway.retryMaxAttempts` | retryMaxAttempts | `3` |
| `gateway.retryBaseDelayMs` | retryBaseDelayMs | `1000` |
| `gateway.retryMaxDelayMs` | retryMaxDelayMs | `10000` |
| `gateway.channel` | channel | `"voice"` |

### 14.8 SDK

| Path | Field | Default |
|---|---|---|
| `sdk.timeout` | timeout | `10000` |
| `sdk.language` | language | `"en"` |
| `sdk.logging.level` | level | `"info"` |

---

## 15. Configuration Versioning

### 15.1 Version Format

Configuration versions follow strict Semantic Versioning: `MAJOR.MINOR.PATCH`

- **MAJOR** — Incompatible configuration structure changes (field removal, type changes, required→optional or optional→required changes)
- **MINOR** — Backward-compatible additions (new optional fields, new enum variants)
- **PATCH** — Backward-compatible fixes (default value changes, validation range adjustments)

### 15.2 Current Version

The current configuration schema version is `1.0.0`.

### 15.3 Version Storage

The configuration version SHALL be stored in the top-level `version` field of `VoiceRuntimeConfiguration`:

```typescript
{
  version: "1.0.0",
  runtime: { ... },
  providers: [ ... ],
  speech: { ... },
  streaming: { ... },
  dialogue: { ... },
  session: { ... },
  gateway: { ... },
  sdk: { ... }
}
```

### 15.4 Migration

- Configuration SHOULD be provided in the latest schema version by the application layer.
- A **Migration Layer** MAY be implemented to upgrade older configuration versions to the current version.
- The Migration Layer SHALL:
  - Accept configuration objects with `version` field
  - Detect the source version
  - Apply a sequence of transforms to reach the latest version
  - Reject configurations with unknown or future MAJOR versions
- Migration SHALL be explicit — no silent upgrades of MAJOR versions.

### 15.5 Breaking Change Policy

A configuration change is **breaking** if it:

1. Removes a field
2. Changes a field type
3. Changes an optional field to required
4. Changes a required field to optional
5. Renames a field
6. Removes an enum variant
7. Tightens a validation range
8. Changes a default value in a way that alters runtime behavior

Breaking changes SHALL increment the MAJOR version.

---

## 16. Compliance Requirements

### 16.1 Implementation Compliance

Every Voice Runtime implementation SHALL:

| # | Requirement | Verification |
|---|---|---|
| C-01 | Define every configuration interface listed in Sections 4–12 | Contract test (CT-01) |
| C-02 | Apply every default value from Section 14 | Unit test verifying default population |
| C-03 | Enforce every validation rule from Sections 4–12 | Unit test per rule |
| C-04 | Validate all fields before reporting any error (all-at-once) | Integration test |
| C-05 | Reject initialize promise with `ConfigurationError` on invalid config | Integration test |
| C-06 | Emit `configuration.invalid` event for every invalid field | Integration test |
| C-07 | Freeze configuration after successful initialization | Unit test verifying immutability |
| C-08 | Support all `ConfigurationErrorCode` values | Contract test |
| C-09 | Store and report configuration version in `version` field | Unit test |
| C-10 | Implement cross-field validation (Section 13.1, rule 6) | Integration test per cross-field rule |

### 16.2 Provider Compliance

Every provider configuration SHALL:

| # | Requirement | Verification |
|---|---|---|
| P-01 | Include a `providerId` that is unique across the `providers` array | Integration test |
| P-02 | Include a `retryPolicy` with valid bounds | Unit test |
| P-03 | Reference credentials by key (never inline values) | Security audit |

### 16.3 Schema Compliance

| # | Requirement | Verification |
|---|---|---|
| S-01 | All configuration types SHALL be serializable to JSON | Contract test |
| S-02 | All configuration types SHALL have a `version` field | Contract test |
| S-03 | Configuration SHALL be accepted as a single `VoiceRuntimeConfiguration` object | Integration test |

### 16.4 Release Gating

| Suite | Min Pass Rate | Critical Failures | Blocks Release |
|---|---|---|---|
| Configuration default values | 100% | Any | Yes |
| Configuration validation (per-field) | 100% | Any | Yes |
| Configuration validation (cross-field) | 100% | Any | Yes |
| Configuration immutability | 100% | Any | Yes |
| Configuration event emission | 100% | 0 | Yes |
| Configuration serialization | 100% | Any | Yes |
| Provider reference validation | 100% | Any | Yes |

---

## 17. Test Cases

### 17.1 Configuration Defaults

| # | Test | Verification |
|---|---|---|
| CONF-01 | Every field has a default | Create empty config, verify all fields populated with Section 14 values |
| CONF-02 | Defaults do not violate validation | Create config with only required fields, verify initialize succeeds |
| CONF-03 | Explicit null uses default | Pass `null` for optional field, verify default applied |

### 17.2 Configuration Validation — Per-field

| # | Test | Verification |
|---|---|---|
| CONF-04 | Required field missing | Omit required field, verify `FIELD_REQUIRED` error |
| CONF-05 | Field wrong type | Pass string for numeric field, verify `FIELD_TYPE_MISMATCH` |
| CONF-06 | Field below minimum | Pass value < min, verify `FIELD_OUT_OF_RANGE` |
| CONF-07 | Field above maximum | Pass value > max, verify `FIELD_OUT_OF_RANGE` |
| CONF-08 | Invalid enum variant | Pass invalid string for union type, verify `FIELD_INVALID_OPTION` |
| CONF-09 | String too long | Exceed max length, verify `FIELD_TOO_LONG` |
| CONF-10 | Pattern mismatch | Pass invalid BCP 47 tag, verify `FIELD_PATTERN_MISMATCH` |

### 17.3 Configuration Validation — Cross-field

| # | Test | Verification |
|---|---|---|
| CONF-11 | retryMaxDelayMs < retryBaseDelayMs | Verify `CROSS_FIELD_CONSTRAINT` error referencing both fields |
| CONF-12 | timeoutMs < retryBaseDelayMs | Verify `CROSS_FIELD_CONSTRAINT` error |
| CONF-13 | idleTimeoutMs > sessionTimeoutMs | Verify `CROSS_FIELD_CONSTRAINT` error |
| CONF-14 | heartbeatIntervalMs > recoveryTimeoutMs | Verify `CROSS_FIELD_CONSTRAINT` error |
| CONF-15 | clarificationThreshold > confirmationThreshold | Verify `CROSS_FIELD_CONSTRAINT` error |
| CONF-16 | thinkingTimeoutMs > turnTimeoutMs | Verify `CROSS_FIELD_CONSTRAINT` error |

### 17.4 Configuration Validation — All-at-once

| # | Test | Verification |
|---|---|---|
| CONF-17 | Multiple invalid fields | Pass config with 3 invalid fields, verify 3 distinct `ConfigurationError`s returned in one call |
| CONF-18 | All fields valid | Pass fully valid config, verify initialize succeeds with no errors |

### 17.5 Configuration Immutability

| # | Test | Verification |
|---|---|---|
| CONF-19 | Config frozen after init | After initialize, attempt to mutate a field, verify it is rejected (frozen or throws) |
| CONF-20 | Config deeply frozen | After initialize, attempt to mutate a nested field (e.g., `config.vad.silenceTimeoutMs`), verify rejection |

### 17.6 Configuration Events

| # | Test | Verification |
|---|---|---|
| CONF-21 | `configuration.invalid` emitted | Invalid config causes event emission with all error details |
| CONF-22 | `configuration.initialized` emitted | Valid config causes event emission after successful initialize |
| CONF-23 | Event payload matches ConfigurationError | Verify `field`, `value`, `expected`, `message`, `code` in event payload |

### 17.7 Configuration Serialization

| # | Test | Verification |
|---|---|---|
| CONF-24 | Config serializes to JSON | `JSON.stringify(config)` succeeds without circular ref errors |
| CONF-25 | Config deserializes from JSON | `JSON.parse(serialized)` produces same field values |
| CONF-26 | Version round-trip | Version field survives serialize/deserialize cycle |

### 17.8 Configuration Versioning

| # | Test | Verification |
|---|---|---|
| CONF-27 | Version field present | Every config object has `version` field |
| CONF-28 | Version format valid | `version` matches semver `MAJOR.MINOR.PATCH` pattern |
| CONF-29 | Unknown MAJOR rejected | Config with future MAJOR version is rejected with descriptive error |

### 17.9 Provider Reference Validation

| # | Test | Verification |
|---|---|---|
| CONF-30 | sttProviderId references existing STT provider | Invalid reference produces `PROVIDER_REFERENCE_NOT_FOUND` |
| CONF-31 | ttsProviderId references existing TTS provider | Invalid reference produces `PROVIDER_REFERENCE_NOT_FOUND` |
| CONF-32 | Duplicate providerId in providers array | Duplicate produces validation error |

---

## 18. Appendix A — Field Type Reference

### 18.1 Common Types

```typescript
type Channel = "web" | "voice" | "whatsapp" | "phone" | "mcp" | "desktop" | "mobile";
type ClientType = "web" | "mobile" | "desktop" | "whatsapp" | "phone" | "mcp";
type StreamingMode = "send" | "receive" | "duplex";
type VadMode = "aggressive" | "moderate" | "sensitive";
type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
type ProviderType = "stt" | "tts" | "transport";
type Environment = "development" | "staging" | "production";
```

### 18.2 BCP 47 Language Tag Pattern

```
^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$
```

Examples: `"en"`, `"ur"`, `"en-US"`, `"zh-CN"`, `"pt-BR"`

### 18.3 Provider ID Pattern

```
^[a-zA-Z0-9_-]+$
```

Max length: 64 characters.

### 18.4 Instance ID Pattern

```
^[a-zA-Z0-9-]+$
```

Max length: 64 characters.

---

## 19. Appendix B — Configuration Merge Rules

When configuration is provided at multiple levels (e.g., default → runtime → per-session), merge SHALL follow these rules:

1. **Explicit values win over defaults.** Any field explicitly provided by the user overrides the default from Section 14.
2. **No partial merge of nested objects.** If a nested object (e.g., `vad`) is provided, ALL its fields use the provided values — defaults for that object's sub-fields are NOT merged. To use a default for a sub-field, omit the entire parent object or explicitly pass the sub-field.
3. **Arrays are replaced, not merged.** The `providers` array is replaced entirely when provided. No merging of individual array elements.
4. **`undefined` means "use default".** Fields set to `undefined` SHALL be replaced with their default value. Fields set to `null` SHALL produce a validation error (null is not a valid value for any field).

---

## 20. Appendix C — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. All 9 configuration layers defined with full validation, defaults, versioning, and compliance requirements. |
