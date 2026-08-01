# TradeOS Voice SDK Specification

Document ID: TVR-VSDK-001
Title: TradeOS Voice SDK Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- Frozen Conversation Gateway Protocol (TCGP v1.0)

---

## 1. Purpose

This specification defines the implementation contract for the Voice SDK — the public API surface through which every client application (Web, Mobile, Desktop, WhatsApp, Phone, and future MCP clients) interacts with the TradeOS Voice Runtime.

The SDK abstracts all internal runtimes (Session, Dialogue, Speech, Streaming, Gateway Client) behind a single, channel-agnostic interface. No client application may import or depend on runtime-internal modules.

The SDK is the **only** permitted public API for voice-enabled client applications.

It does **not** own:

- Runtime implementation or orchestration
- Business logic
- Business memory
- Gateway protocol
- Provider SDK integration
- Audio hardware abstraction beyond what the SDK exposes

---

## 2. Scope

The Voice SDK owns:

- Providing a single `VoiceSDK` entry point for all client applications
- Managing the client lifecycle (initialize, connect, disconnect, dispose)
- Exposing session management (start, stop voice interaction)
- Exposing event subscriptions (transcript, state, error, metrics events)
- Exposing streaming API (audio input/output for custom pipelines)
- Exposing audio API (start/stop capture, play audio) for Web/Mobile/Desktop clients
- Exposing configuration per client type and per session
- Normalizing errors across all internal runtimes into SDK-level error codes
- Emitting SDK-level events that abstract runtime internal events
- Providing typed TypeScript interfaces for all public operations
- Supporting multiple client types through a single unified interface

The Voice SDK does **not** own:

- Runtime orchestration logic
- Dialogue management
- Session lifecycle beyond start/stop
- Speech recognition or synthesis
- Stream buffer management
- Gateway request construction
- Business logic or business data access
- Provider selection or configuration
- Audio device enumeration or selection (delegated to host platform)

---

## 3. Public SDK API

### 3.1 VoiceSDK — Entry Point

```typescript
interface VoiceSDK {
  createClient(config: SDKConfiguration): VoiceClient;

  getVersion(): string;

  getSupportedClients(): ClientType[];
}
```

### 3.2 VoiceClient — Client Instance

```typescript
interface VoiceClient {
  // Lifecycle
  initialize(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;

  // Session
  startSession(options?: SessionOptions): Promise<VoiceSessionHandle>;
  stopSession(): Promise<void>;

  // Events
  on(event: VoiceSDKEventName, handler: VoiceSDKEventHandler): void;
  off(event: VoiceSDKEventName, handler: VoiceSDKEventHandler): void;

  // Audio (Web/Mobile/Desktop)
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  playAudio(audio: AudioChunk): Promise<void>;
  stopPlayback(): Promise<void>;

  // Streaming (all clients)
  getInputStream(): InputStream;
  getOutputStream(): OutputStream;

  // State
  getState(): VoiceClientState;
  getMetrics(): SDKMetrics;

  // Health
  health(): Promise<SDKHealth>;
}
```

### 3.3 VoiceSessionHandle

```typescript
interface VoiceSessionHandle {
  readonly sessionId: string;
  readonly conversationId: string | null;
  readonly state: SessionState;

  getIdleTime(): number;
  getElapsedTime(): number;

  onEnded(handler: () => void): void;
}
```

### 3.4 SDKConfiguration

```typescript
interface SDKConfiguration {
  clientType: ClientType;
  apiKey?: string;
  baseUrl: string;
  timeout?: number;
  language?: string;
  audio?: AudioConfiguration;
  logging?: LoggingConfiguration;
}

type ClientType = "web" | "mobile" | "desktop" | "whatsapp" | "phone" | "mcp";
```

### 3.5 AudioConfiguration

```typescript
interface AudioConfiguration {
  inputSampleRate?: number;
  outputSampleRate?: number;
  inputDeviceId?: string;
  outputDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  automaticGainControl?: boolean;
}
```

### 3.6 LoggingConfiguration

```typescript
interface LoggingConfiguration {
  level: "debug" | "info" | "warn" | "error" | "silent";
  prefix?: string;
}
```

### 3.7 SessionOptions

```typescript
interface SessionOptions {
  userId?: string;
  organizationId?: string;
  language?: string;
  channel?: ClientType;
  metadata?: Record<string, unknown>;
}
```

### 3.8 VoiceClientState

```typescript
type VoiceClientState =
  | "created"
  | "initializing"
  | "ready"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "disposed"
  | "failed";
```

### 3.9 SDKMetrics

```typescript
interface SDKMetrics {
  sessionCount: number;
  activeSession: boolean;
  uptimeMs: number;
  requestsSent: number;
  requestsFailed: number;
  audioBytesCaptured: number;
  audioBytesPlayed: number;
  currentLatencyMs: number;
}
```

### 3.10 SDKHealth

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

### 3.11 SDKError

```typescript
interface SDKError {
  code: SDKErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
  timestamp: Date;
}
```

### 3.12 SDKErrorCode

```typescript
type SDKErrorCode =
  | "INITIALIZATION_FAILED"
  | "CONNECTION_FAILED"
  | "DISCONNECTION_FAILED"
  | "SESSION_FAILED"
  | "AUDIO_CAPTURE_FAILED"
  | "AUDIO_PLAYBACK_FAILED"
  | "STREAM_FAILED"
  | "GATEWAY_ERROR"
  | "TIMEOUT"
  | "INVALID_CONFIGURATION"
  | "UNSUPPORTED_CLIENT_TYPE"
  | "RUNTIME_ERROR"
  | "UNKNOWN_ERROR";
```

---

## 4. Client Lifecycle

Every client instance follows this lifecycle:

```
Created  (new VoiceClient)
   │
Initialize
   │
Initializing
   │
   ▼
Ready
   │
Connect
   │
Connecting
   │
   ▼
Connected ─── Session active
   │
   ├── startSession() ──► Session running
   │                        │
   │                        └── stopSession() ──► Connected (no session)
   │
   ├── disconnect() ──► Disconnecting ──► Disconnected
   │                                           │
   │                                           └── dispose() ──► Disposed
   │
   └── dispose() ──► Disposed
   │
   ▼
Failed ──► Disposed
```

### State transition rules

| From | To | Condition |
|---|---|---|
| created | initializing | `initialize()` called |
| initializing | ready | Internal runtimes initialized |
| ready | connecting | `connect()` called |
| connecting | connected | Gateway reachable, session runtime ready |
| connected | connected | `startSession()` / `stopSession()` (session state changes, client stays connected) |
| connected | disconnecting | `disconnect()` called |
| disconnecting | disconnected | Resources released |
| disconnected | disposed | `dispose()` called |
| any | failed | Unrecoverable error |
| failed | disposed | `dispose()` called |

---

## 5. Session API

### 5.1 Starting a session

```typescript
// VoiceClient method
startSession(options?: SessionOptions): Promise<VoiceSessionHandle>;
```

When `startSession()` is called:

1. The SDK SHALL create a new voice session via the Session Runtime.
2. The SDK SHALL associate the session with a Conversation Gateway conversation ID.
3. The SDK SHALL initialize the Dialogue Runtime for the session.
4. The SDK SHALL initialize the Speech Runtime for audio processing (Web/Mobile/Desktop).
5. The SDK SHALL return a `VoiceSessionHandle` to the caller.

### 5.2 Stopping a session

```typescript
// VoiceClient method
stopSession(): Promise<void>;
```

When `stopSession()` is called:

1. The SDK SHALL stop the Dialogue Runtime.
2. The SDK SHALL stop the Speech Runtime (Web/Mobile/Desktop).
3. The SDK SHALL close the voice session via the Session Runtime.
4. The SDK SHALL emit a `SessionEnded` event.

### 5.3 Session handle

The `VoiceSessionHandle` provides:

| Method | Description |
|---|---|
| `getIdleTime()` | Milliseconds since last activity |
| `getElapsedTime()` | Milliseconds since session started |
| `onEnded(handler)` | Register a callback for when the session ends |

### 5.4 Session rules

1. Only one session SHALL be active at a time per `VoiceClient`.
2. Calling `startSession()` while a session is active SHALL throw `SESSION_FAILED`.
3. Calling `stopSession()` with no active session SHALL be a no-op.
4. Sessions SHALL be automatically terminated when `disconnect()` is called.

---

## 6. Event Subscription API

### 6.1 Subscribing

```typescript
// VoiceClient methods
on(event: VoiceSDKEventName, handler: VoiceSDKEventHandler): void;
off(event: VoiceSDKEventName, handler: VoiceSDKEventHandler): void;
```

### 6.2 Event names

```typescript
type VoiceSDKEventName =
  // Lifecycle
  | "client:initialized"
  | "client:connected"
  | "client:disconnected"
  | "client:disposed"
  | "client:failed"
  // Session
  | "session:started"
  | "session:ended"
  | "session:idle"
  | "session:expiring"
  | "session:error"
  // Transcript
  | "transcript:partial"
  | "transcript:final"
  // Speech
  | "speech:started"
  | "speech:ended"
  // Gateway
  | "gateway:requestStarted"
  | "gateway:responseReceived"
  | "gateway:error"
  // Audio (Web/Mobile/Desktop)
  | "audio:captureStarted"
  | "audio:captureStopped"
  | "audio:playbackStarted"
  | "audio:playbackStopped"
  // Error
  | "error:sdk"
  | "error:runtime";
```

### 6.3 Event handler

```typescript
interface VoiceSDKEvent {
  name: VoiceSDKEventName;
  timestamp: Date;
  data: Record<string, unknown>;
  sessionId?: string;
}

type VoiceSDKEventHandler = (event: VoiceSDKEvent) => void;
```

### 6.4 Subscription rules

1. Multiple handlers MAY subscribe to the same event.
2. `off()` SHALL remove only the specific handler provided.
3. Handlers SHALL be invoked synchronously in subscription order.
4. A handler exception SHALL NOT affect other handlers.
5. Removing a handler that was never added SHALL be a no-op.

---

## 7. Streaming API

### 7.1 Accessing streams

```typescript
// VoiceClient methods
getInputStream(): InputStream;
getOutputStream(): OutputStream;
```

### 7.2 InputStream (from Voice Runtime to client)

```typescript
interface InputStream {
  onChunk(handler: (chunk: AudioChunk) => void): void;
  getState(): StreamState;
  getMetrics(): StreamMetrics;
}
```

The InputStream delivers audio chunks from the Voice Runtime (synthesized speech) to the client application. Clients that handle their own audio playback (WhatsApp, Phone, MCP) use this to receive audio data.

### 7.3 OutputStream (from client to Voice Runtime)

```typescript
interface OutputStream {
  write(chunk: AudioChunk): Promise<void>;
  getState(): StreamState;
  getMetrics(): StreamMetrics;
}
```

The OutputStream accepts audio chunks from the client application and delivers them to the Voice Runtime for recognition. Clients that capture their own audio (WhatsApp, Phone, MCP) use this to send audio data.

### 7.4 Stream states

```typescript
type StreamState =
  | "created"
  | "streaming"
  | "paused"
  | "stopped"
  | "failed";
```

### 7.5 Stream rules

1. Streams SHALL be created when `startSession()` is called.
2. Streams SHALL be destroyed when `stopSession()` is called.
3. Writing to a stopped stream SHALL throw `STREAM_FAILED`.
4. Chunks SHALL be sequenced and ordered by the underlying Streaming Runtime.

---

## 8. Audio API

The Audio API is available only for client types that manage their own audio hardware: `web`, `mobile`, `desktop`. WhatsApp, Phone, and MCP clients do not use this API.

### 8.1 Audio capture

```typescript
// VoiceClient methods
startCapture(): Promise<void>;
stopCapture(): Promise<void>;
```

When `startCapture()` is called:

1. The SDK SHALL request microphone access (platform-permission flow).
2. The SDK SHALL open the configured audio input device.
3. The SDK SHALL begin streaming audio to the Speech Runtime.
4. The SDK SHALL emit `audio:captureStarted`.

When `stopCapture()` is called:

1. The SDK SHALL stop audio streaming.
2. The SDK SHALL close the audio input device.
3. The SDK SHALL emit `audio:captureStopped`.

### 8.2 Audio playback

```typescript
// VoiceClient methods
playAudio(audio: AudioChunk): Promise<void>;
stopPlayback(): Promise<void>;
```

When `playAudio()` is called:

1. The SDK SHALL enqueue the audio chunk for playback.
2. The SDK SHALL play audio through the configured output device.
3. The SDK SHALL emit `audio:playbackStarted`.

When `stopPlayback()` is called:

1. The SDK SHALL clear the playback queue.
2. The SDK SHALL stop active playback.
3. The SDK SHALL emit `audio:playbackStopped`.

### 8.3 Audio rules

1. `startCapture()` SHALL fail with `AUDIO_CAPTURE_FAILED` if microphone access is denied.
2. `playAudio()` SHALL fail with `AUDIO_PLAYBACK_FAILED` if no output device is available.
3. Capture and playback MAY operate simultaneously (full-duplex).
4. Client types other than `web`, `mobile`, and `desktop` SHALL throw `UNSUPPORTED_CLIENT_TYPE` if audio API methods are called.

---

## 9. Configuration API

### 9.1 Creating a client

```typescript
const sdk: VoiceSDK = getVoiceSDK();
const client: VoiceClient = sdk.createClient({
  clientType: "web",
  baseUrl: "https://api.tradeos.app",
  apiKey: "...",
  language: "en",
  audio: {
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    echoCancellation: true,
    noiseSuppression: true,
  },
  logging: {
    level: "info",
  },
});
```

### 9.2 Configuration by client type

| Field | web | mobile | desktop | whatsapp | phone | mcp |
|---|---|---|---|---|---|---|
| audio | optional | optional | optional | N/A | N/A | N/A |
| baseUrl | required | required | required | required | required | required |
| apiKey | optional | optional | optional | required | required | required |
| language | optional | optional | optional | optional | optional | optional |

### 9.3 Configuration validation

Configuration SHALL be validated during `createClient()`. Invalid configuration SHALL throw `INVALID_CONFIGURATION` immediately.

---

## 10. Error Contracts

### 10.1 Error interface

All SDK errors conform to:

```typescript
interface SDKError {
  code: SDKErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
  timestamp: Date;
}
```

### 10.2 Error catalog

| Code | Description | Retryable | Source |
|---|---|---|---|
| INITIALIZATION_FAILED | SDK or runtime failed to initialize | No | SDK |
| CONNECTION_FAILED | Failed to connect to the Voice Runtime | Yes | SDK |
| DISCONNECTION_FAILED | Failed to disconnect gracefully | No | SDK |
| SESSION_FAILED | Session operation failed | Depends | Session Runtime |
| AUDIO_CAPTURE_FAILED | Microphone access or capture failed | Yes | Speech Runtime |
| AUDIO_PLAYBACK_FAILED | Audio playback failed | Yes | Speech Runtime |
| STREAM_FAILED | Stream operation failed | Depends | Streaming Runtime |
| GATEWAY_ERROR | Gateway returned an error | Depends | Gateway Client |
| TIMEOUT | Operation timed out | Yes | Gateway Client |
| INVALID_CONFIGURATION | Invalid SDK configuration | No | SDK |
| UNSUPPORTED_CLIENT_TYPE | Operation not supported for this client type | No | SDK |
| RUNTIME_ERROR | Internal runtime error | Depends | Any runtime |
| UNKNOWN_ERROR | Unclassified error | No | Any |

### 10.3 Error handling rules

1. All errors SHALL be surfaced as `SDKError` — no runtime-internal error types SHALL leak to the client.
2. Retryable errors SHALL include a `retryable: true` flag for the client to decide retry behavior.
3. The SDK SHALL emit an error event for every error before rejecting the promise.
4. Fatal errors SHALL transition the client to `failed` state.

---

## 11. SDK Events

### 11.1 Event catalog

| Event | Emitted When | Data |
|---|---|---|
| `client:initialized` | Client ready | `{ uptimeMs }` |
| `client:connected` | Client connected | `{ sessionCount }` |
| `client:disconnected` | Client disconnected | `{ reason? }` |
| `client:disposed` | Client disposed | `{}` |
| `client:failed` | Client entered failed state | `{ error }` |
| `session:started` | Voice session started | `{ sessionId, conversationId }` |
| `session:ended` | Voice session ended | `{ sessionId, durationMs }` |
| `session:idle` | Session idle warning | `{ sessionId, idleTimeMs }` |
| `session:expiring` | Session expiring | `{ sessionId, remainingMs }` |
| `session:error` | Session error | `{ sessionId, error }` |
| `transcript:partial` | Partial transcript | `{ text, confidence, isFinal: false }` |
| `transcript:final` | Final transcript | `{ text, confidence }` |
| `speech:started` | User speech detected | `{}` |
| `speech:ended` | User speech ended | `{ durationMs }` |
| `gateway:requestStarted` | Gateway request dispatched | `{ messageLength, turnSequence }` |
| `gateway:responseReceived` | Gateway response received | `{ responseLength, provider? }` |
| `gateway:error` | Gateway error | `{ error, retryable }` |
| `audio:captureStarted` | Microphone capture started | `{ deviceId }` |
| `audio:captureStopped` | Microphone capture stopped | `{ reason? }` |
| `audio:playbackStarted` | Audio playback started | `{ chunkSize }` |
| `audio:playbackStopped` | Audio playback stopped | `{ reason? }` |
| `error:sdk` | SDK-level error | `{ code, message, retryable }` |
| `error:runtime` | Runtime-internal error | `{ code, message }` |

---

## 12. Configuration

### 12.1 SDKConfiguration

```typescript
interface SDKConfiguration {
  clientType: ClientType;
  apiKey?: string;
  baseUrl: string;
  timeout?: number;
  language?: string;
  audio?: AudioConfiguration;
  logging?: LoggingConfiguration;
}
```

### 12.2 Field reference

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| clientType | ClientType | Yes | — | Must be a valid ClientType |
| apiKey | string | For whatsapp/phone/mcp | — | Non-empty string |
| baseUrl | string | Yes | — | Must be a valid URL |
| timeout | number | No | 10000 | Between 1000 and 60000 |
| language | string | No | "en" | BCP 47 language tag |
| audio | AudioConfiguration | Only web/mobile/desktop | — | Per-field validation |
| logging | LoggingConfiguration | No | `{ level: "info" }` | Per-field validation |

### 12.3 AudioConfiguration field reference

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| inputSampleRate | number | No | 16000 | 8000, 16000, 24000, 44100, 48000 |
| outputSampleRate | number | No | 24000 | 8000, 16000, 24000, 44100, 48000 |
| inputDeviceId | string | No | default | — |
| outputDeviceId | string | No | default | — |
| echoCancellation | boolean | No | false | — |
| noiseSuppression | boolean | No | false | — |
| automaticGainControl | boolean | No | false | — |

---

## 13. Performance Targets

The implementation shall satisfy the following engineering objectives:

| Objective | Requirement |
|---|---|
| Client creation | `createClient()` SHALL complete synchronously |
| Initialization | `initialize()` SHALL complete within 500 ms under normal conditions |
| Connection | `connect()` SHALL complete within 1000 ms under normal conditions |
| Session start | `startSession()` SHALL complete within 200 ms |
| Event dispatch | Event handlers SHALL be invoked within 5 ms of event emission |
| Audio capture start | `startCapture()` SHALL begin streaming within 100 ms of call |
| Audio playback | `playAudio()` SHALL begin playback within 50 ms of call |
| Memory per client | An idle connected client SHALL consume no more than 5 MB of heap memory |
| No blocking | All SDK methods SHALL be non-blocking (async) |
| Thread safety | Events SHALL be delivered on a single logical thread; no external synchronization required by client code |

---

## 14. Compliance Requirements

A Voice SDK implementation is compliant with this specification **only if** it:

1. Implements every required public interface defined in Section 3.
2. Exposes a single `VoiceSDK` entry point.
3. Supports all client types defined in `ClientType`.
4. Implements the client lifecycle defined in Section 4.
5. Implements the session API defined in Section 5.
6. Implements the event subscription API defined in Section 6.
7. Implements the streaming API defined in Section 7.
8. Implements the audio API for web/mobile/desktop client types defined in Section 8.
9. Returns only `SDKError` error types to client code.
10. Emits all standardized SDK events defined in Section 11.
11. Validates configuration per Section 12.
12. Does **not** expose runtime-internal types, interfaces, or modules.
13. Does **not** implement business logic.
14. Does **not** access Business Brain internals.
15. Does **not** communicate directly with the Conversation Gateway.
16. Passes every required testing suite defined in Section 15.

---

## 15. Testing Requirements

### 15.1 Unit Testing

| Test | Description |
|---|---|
| Client creation | `createClient()` returns a valid `VoiceClient` |
| Configuration validation | Invalid config throws `INVALID_CONFIGURATION` |
| Client type enforcement | Audio API on non-audio client types throws `UNSUPPORTED_CLIENT_TYPE` |
| Event subscription | `on()` registers handler, `off()` removes handler |
| Event dispatch | Handler receives correct event data |
| Multiple handlers | All handlers invoked for the same event |

### 15.2 Lifecycle Testing

| Test | Description |
|---|---|
| Full lifecycle | create → initialize → connect → disconnect → dispose |
| Initialize without connect | Client in `ready` state, connect later |
| Double initialize | Second call is no-op or returns immediately |
| Dispose without connect | Cleanup from `created` state |
| Failure during connect | Client transitions to `failed`, emits `client:failed` |

### 15.3 Session Testing

| Test | Description |
|---|---|
| Session start/stop | Full session lifecycle within connected client |
| Double session start | Second `startSession()` throws `SESSION_FAILED` |
| Stop without session | `stopSession()` is a no-op |
| Session accessor | `VoiceSessionHandle` returns correct values |
| Session auto-terminate | Session ends when `disconnect()` is called |

### 15.4 Event Testing

| Test | Description |
|---|---|
| All events emitted | Every event in Section 11 catalog fires under expected conditions |
| Event data shape | Each event carries the correct data fields |
| Handler exception isolation | One handler exception does not prevent other handlers from executing |
| Off removes handler | Handler removed via `off()` is not invoked |

### 15.5 Streaming Testing

| Test | Description |
|---|---|
| Input stream access | `getInputStream()` returns valid stream during session |
| Output stream access | `getOutputStream()` returns valid stream during session |
| Chunk flow | Chunks written to output stream are delivered to Voice Runtime |
| Stream lifecycle | Streams created on session start, destroyed on session end |

### 15.6 Audio API Testing (Web/Mobile/Desktop)

| Test | Description |
|---|---|
| Capture start/stop | `startCapture()` begins audio flow, `stopCapture()` stops it |
| Playback | `playAudio()` plays chunk, `stopPlayback()` stops |
| Permission denied | `startCapture()` throws `AUDIO_CAPTURE_FAILED` |
| No output device | `playAudio()` throws `AUDIO_PLAYBACK_FAILED` |

### 15.7 Error Testing

| Test | Description |
|---|---|
| All errors are SDKError | No runtime error type leaks to client |
| Error events emitted | Every error also fires `error:sdk` or `error:runtime` |
| Retryable flag | `retryable` field accurately reflects error type |
| Fatal errors | Fatal errors transition client to `failed` |

### 15.8 Client Type Testing

| Test | Description |
|---|---|
| Web client | Audio API available, streaming API available |
| Mobile client | Audio API available, streaming API available |
| Desktop client | Audio API available, streaming API available |
| WhatsApp client | Audio API throws UNSUPPORTED_CLIENT_TYPE, streaming API available |
| Phone client | Audio API throws UNSUPPORTED_CLIENT_TYPE, streaming API available |
| MCP client | Audio API throws UNSUPPORTED_CLIENT_TYPE, streaming API available |

### 15.9 Long-Duration Testing

| Test | Description |
|---|---|
| 60-minute connected session | No memory growth, no event drift |
| Multiple sequential sessions | 10 start/stop cycles, no degradation |
| Overnight idle | Client in connected state for 8 hours, no resource leak |

### 15.10 Concurrency Testing

| Test | Description |
|---|---|
| Multiple clients | Two independent `VoiceClient` instances operate without interference |
| Concurrent events | Events fire correctly under concurrent session activity |

### 15.11 Compliance Testing

| Test | Description |
|---|---|
| Interface compliance | Implements all required public interfaces |
| Event compliance | All standardized events emitted |
| Error compliance | All error codes conform to specification |
| Configuration compliance | All required fields accepted and validated |
| Client type compliance | All client types supported |

---

## 16. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Breaking changes to public interfaces, client lifecycle, session API, event contracts, or error codes |
| Minor | Backward-compatible additions: new client types, new events, new optional configuration fields, new metrics |
| Patch | Documentation clarifications, correction of non-normative text, correction of test descriptions |

Implementations shall declare the specification version they conform to, enabling compatibility validation across SDK versions and client applications.

---

## 17. Non-Goals

The Voice SDK explicitly does **not** implement:

- Business logic or business rule evaluation
- Business memory or context storage
- Conversation Gateway protocol construction or parsing
- Dialogue management or turn orchestration
- Runtime orchestration or internal module coordination
- Provider SDK integration or provider lifecycle
- Audio device enumeration or selection beyond delegation to host platform
- Audio processing algorithms (VAD, noise suppression, echo cancellation)
- Speech recognition or synthesis algorithms
- Session persistence beyond runtime lifetime
- Business permissions or access control
- Business calculations or financial computations
- Business Brain integration or querying
- Database access
- User authentication (beyond API key forwarding)
