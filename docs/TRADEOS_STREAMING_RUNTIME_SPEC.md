# TradeOS Streaming Runtime Specification

Document ID: TVR-STRS-001
Title: TradeOS Streaming Runtime Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- Frozen Voice Runtime Architecture
- Frozen Conversation Gateway Protocol

---

## 1. Purpose

This specification defines the implementation contract for the Streaming Runtime within the TradeOS Voice Runtime.

The Streaming Runtime is responsible for audio stream orchestration only. It manages the lifecycle of bidirectional audio streams, coordinates chunk delivery between speech input and speech output, and ensures uninterrupted media flow under real-time conditions.

It does **not** own:

- Dialogue management
- Gateway communication
- Business logic
- Session management
- Business Brain interaction
- Provider selection
- Speech recognition or synthesis logic

---

## 2. Scope

The Streaming Runtime owns:

- Audio stream lifecycle (create, connect, start, pause, resume, stop, dispose)
- Bidirectional streaming (simultaneous input and output streams)
- Stream synchronization (input/output alignment within a session)
- Buffer management (input and output buffers)
- Chunk management (framing, sequencing, reassembly)
- Flow control (rate matching between producer and consumer)
- Backpressure handling (signal sources when buffers are saturated)
- Stream recovery (reconnect, resync, resume after interruption)
- Latency monitoring (per-chunk and aggregate round-trip tracking)
- Stream metrics (throughput, jitter, packet loss, buffer水位)

The Streaming Runtime does **not** own:

- Microphone acquisition or audio playback (delegated to Speech Runtime)
- Speech-to-Text or Text-to-Speech provider orchestration (delegated to Speech Runtime)
- Dialogue state or intent routing
- Conversation Gateway protocol parsing or message construction
- Business data access or computation
- User authentication or session tokens
- Network transport provider selection

---

## 3. Runtime Responsibilities

The Streaming Runtime shall:

| Responsibility | Description |
|---|---|
| Create stream | Allocate stream resources with a given configuration |
| Start stream | Begin bidirectional chunk flow |
| Stop stream | Gracefully terminate chunk flow and flush buffers |
| Pause stream | Suspend chunk flow without releasing resources |
| Resume stream | Restart chunk flow from pause state |
| Receive input chunks | Accept inbound audio chunks from the Speech Runtime |
| Send output chunks | Deliver outbound audio chunks to the Speech Runtime |
| Buffer input chunks | Hold received chunks in a FIFO input buffer |
| Buffer output chunks | Hold synthesized chunks in a FIFO output buffer |
| Enforce flow control | Throttle producers when buffers approach capacity |
| Apply backpressure | Signal upstream components to pause when buffers are saturated |
| Monitor stream health | Track heartbeats, latency, and chunk continuity |
| Detect stream interruption | Identify dropped chunks, heartbeat loss, or transport disconnection |
| Recover interrupted streams | Attempt reconnection, resynchronization, and stream resumption |
| Report stream metrics | Expose throughput, jitter, buffer depth, and error counts |
| Emit runtime events | Fire standardized lifecycle, health, and error events |
| Validate chunks | Enforce chunk format, sequence integrity, and timing constraints |

---

## 4. Internal Modules

The Streaming Runtime is composed of the following implementation modules.

### 4.1 Input Stream Manager

Responsibilities:
- Manage the input stream lifecycle
- Accept inbound audio chunks from the Speech Runtime
- Sequence and deduplicate chunks
- Route chunks to the buffer manager
- Signal input stream state transitions

### 4.2 Output Stream Manager

Responsibilities:
- Manage the output stream lifecycle
- Deliver outbound audio chunks to the Speech Runtime
- Sequence output chunks in order
- Route chunks from the buffer manager to the consumer
- Signal output stream state transitions

### 4.3 Buffer Manager

Responsibilities:
- Maintain input and output circular buffers
- Enforce minimum and maximum buffer thresholds
- Signal buffer-low and buffer-high events
- Drain buffers on stream stop
- Flush stale chunks on recovery

### 4.4 Chunk Manager

Responsibilities:
- Frame raw audio into chunks of configured size
- Assign sequence numbers to chunks
- Validate chunk ordering and detect gaps
- Reassemble fragmented chunks
- Drop duplicate chunks

### 4.5 Flow Controller

Responsibilities:
- Monitor buffer depth on input and output paths
- Compute flow control signals (throttle, resume)
- Apply backpressure to upstream producers
- Release backpressure when buffer drains below threshold

### 4.6 Latency Monitor

Responsibilities:
- Measure per-chunk end-to-end latency
- Compute rolling average, minimum, and maximum latency
- Emit latency-warning events when thresholds are exceeded
- Store latency samples for metrics export

### 4.7 Recovery Manager

Responsibilities:
- Detect stream interruption (heartbeat miss, chunk gap, transport error)
- Initiate reconnection with configured retry policy
- Perform stream resynchronization after reconnection
- Recover buffered chunks after reconnection
- Escalate to runtime error if recovery fails

### 4.8 Health Monitor

Responsibilities:
- Track stream heartbeats (expected vs. received)
- Monitor chunk continuity (sequence gaps)
- Report stream-level health status
- Emit healthy, unhealthy, and recovered events

### 4.9 Metrics Collector

Responsibilities:
- Accumulate throughput counters (chunks in, chunks out, bytes)
- Capture latency statistics (min, max, avg, p50, p95, p99)
- Track jitter (inter-chunk delay variance)
- Report buffer occupancy rates
- Expose snapshot for runtime monitoring queries

---

## 5. Public Interfaces

### 5.1 StreamingRuntime

```typescript
interface StreamingRuntime {
  initialize(config: StreamConfiguration): Promise<void>;

  createStream(id: string, direction: StreamDirection): Promise<StreamController>;

  start(): Promise<void>;

  stop(): Promise<void>;

  dispose(): Promise<void>;

  getState(): StreamingRuntimeState;

  getMetrics(): StreamMetrics;

  health(): Promise<StreamHealth>;
}
```

### 5.2 StreamController

```typescript
interface StreamController {
  readonly id: string;
  readonly direction: StreamDirection;

  start(): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  stop(): Promise<void>;

  write(chunk: AudioChunk): Promise<void>;

  onChunk(handler: (chunk: AudioChunk) => void): void;

  getState(): StreamState;

  getMetrics(): StreamMetrics;
}
```

### 5.3 InputStream

```typescript
interface InputStream {
  readonly id: string;

  start(): Promise<void>;

  stop(): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  write(chunk: AudioChunk): Promise<void>;

  onChunk(handler: (chunk: AudioChunk) => void): void;

  getState(): StreamState;

  getMetrics(): StreamMetrics;
}
```

### 5.4 OutputStream

```typescript
interface OutputStream {
  readonly id: string;

  start(): Promise<void>;

  stop(): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  onChunk(handler: (chunk: AudioChunk) => void): void;

  getState(): StreamState;

  getMetrics(): StreamMetrics;
}
```

### 5.5 StreamConfiguration

```typescript
interface StreamConfiguration {
  chunkSize: number;
  maxBufferSize: number;
  minBufferSize: number;
  maxLatencyMs: number;
  heartbeatIntervalMs: number;
  reconnectIntervalMs: number;
  recoveryTimeoutMs: number;
  maxRetries: number;
  compression: CompressionOptions;
  mode: StreamingMode;
}

type StreamingMode = "send" | "receive" | "duplex";

interface CompressionOptions {
  enabled: boolean;
  algorithm?: "gzip" | "zlib" | "none";
  level?: number;
}
```

### 5.6 StreamDirection

```typescript
type StreamDirection = "input" | "output";
```

### 5.7 StreamState

```typescript
type StreamState =
  | "created"
  | "initialized"
  | "connecting"
  | "connected"
  | "streaming"
  | "paused"
  | "resuming"
  | "stopping"
  | "stopped"
  | "disposed"
  | "failed"
  | "recovering";
```

### 5.8 StreamingRuntimeState

```typescript
type StreamingRuntimeState =
  | "created"
  | "initialized"
  | "running"
  | "stopping"
  | "stopped"
  | "disposed"
  | "failed";
```

### 5.9 StreamMetrics

```typescript
interface StreamMetrics {
  streamId: string;
  direction: StreamDirection;

  chunksSent: number;
  chunksReceived: number;
  bytesSent: number;
  bytesReceived: number;
  chunksDropped: number;
  chunksRecovered: number;

  latencyMinMs: number;
  latencyMaxMs: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;

  jitterMs: number;
  bufferOccupancyPercent: number;
  bufferOverflowCount: number;
  bufferUnderflowCount: number;

  heartbeatsMissed: number;
  interruptions: number;
  recoveries: number;
  recoveryTimeMs: number;

  uptimeMs: number;
  lastActivityAt: Date;
}
```

### 5.10 StreamHealth

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

---

## 6. Runtime State Machine

The Streaming Runtime implements the following state model.

### Runtime-level states

```
Created
   │
Initialize
   │
Initialized
   │
Start
   │
Running
   │
Stop
   │
Stopping
   │
Stopped
   │
Dispose
   ▼
Disposed
```

Failure from any active state:

```
Running
   │
   ▼
Failed
   │
Recover (optional)
   │
Initialized
```

### Stream-level states

```
Created
   │
Initialize
   │
Initialized
   │
Connect
   │
Connecting
   │
Connected
   │
Start
   │
Streaming ────────── Pause ──── Paused
   │                        │
   │                        Resume
   │                        │
   │                   Resuming
   │                        │
   └────────────────────────┘
   │
Stop
   │
Stopping
   │
Stopped
   │
Dispose
   ▼
Disposed
```

Failure from any active stream state:

```
Streaming ──── Paused ──── Connecting
   │            │            │
   └────────────┴────────────┘
                  │
                  ▼
               Failed
                  │
              Recover
                  │
              Connecting
```

### Valid stream state transitions

| From | To | Condition |
|---|---|---|
| created | initialized | `initialize(config)` succeeds |
| initialized | connecting | `start()` called |
| connecting | connected | Transport handshake completes |
| connected | streaming | First chunk flows |
| streaming | paused | `pause()` called |
| paused | resuming | `resume()` called |
| resuming | streaming | Chunk flow resumes |
| streaming | stopping | `stop()` called |
| paused | stopping | `stop()` called |
| stopping | stopped | Resources released |
| stopped | disposed | `dispose()` called |
| streaming | failed | Unrecoverable error |
| paused | failed | Unrecoverable error |
| connecting | failed | Transport or handshake failure |
| failed | connecting | `recover()` called and succeeds |
| failed | stopped | Recovery declined or fails |

---

## 7. Runtime Events

The Streaming Runtime emits standardized runtime events.

### Lifecycle Events

| Event | Emitted When |
|---|---|
| StreamRuntimeInitialized | Runtime `initialize()` completes |
| StreamRuntimeStarted | Runtime `start()` completes |
| StreamRuntimeStopped | Runtime `stop()` completes |
| StreamRuntimeDisposed | Runtime `dispose()` completes |

### Stream Lifecycle Events

| Event | Emitted When |
|---|---|
| StreamCreated | Stream allocated via `createStream()` |
| StreamInitialized | Stream configuration applied |
| StreamConnecting | Stream `start()` called, transport pending |
| StreamConnected | Transport handshake confirmed |
| StreamStarted | First chunk queued |
| StreamPaused | Stream `pause()` completes |
| StreamResumed | Stream `resume()` completes |
| StreamStopping | Stream `stop()` called |
| StreamStopped | Stream fully stopped |
| StreamDisposed | Stream resources released |

### Chunk Events

| Event | Emitted When |
|---|---|
| InputChunkReceived | Inbound chunk accepted into input buffer |
| OutputChunkSent | Outbound chunk delivered to consumer |
| ChunkDropped | Chunk discarded due to overflow or sequence gap |
| ChunkRecovered | Lost chunk retransmitted during recovery |

### Buffer Events

| Event | Emitted When |
|---|---|
| BufferLow | Buffer depth falls below `minBufferSize` |
| BufferHigh | Buffer depth exceeds `maxBufferSize` |
| BufferOverflow | Buffer capacity exhausted, oldest chunks evicted |
| BufferUnderflow | Buffer empty when consumer requested data |
| BufferDrained | Buffer fully flushed on stop |

### Latency Events

| Event | Emitted When |
|---|---|
| LatencyNormal | Latency within acceptable range |
| LatencyWarning | Latency exceeds `maxLatencyMs` threshold |
| LatencyCritical | Latency exceeds 2x `maxLatencyMs` |
| JitterSpike | Inter-chunk delay variance exceeds configured threshold |

### Heartbeat Events

| Event | Emitted When |
|---|---|
| HeartbeatReceived | Heartbeat acknowledged by peer |
| HeartbeatMissed | Expected heartbeat not received within interval |
| HeartbeatResumed | Heartbeat flow restored after interruption |

### Recovery Events

| Event | Emitted When |
|---|---|
| StreamInterrupted | Chunk gap, heartbeat miss, or transport loss detected |
| RecoveryStarted | Recovery manager initiates reconnection |
| RecoveryProgress | Recovery attempt in progress (retry count) |
| RecoveryCompleted | Stream resynchronized and resumed |
| RecoveryFailed | All retries exhausted, stream escalated to failed |

### Error Events

| Event | Emitted When |
|---|---|
| StreamError | A runtime-level or stream-level error occurs |
| TransportDisconnected | Underlying transport disconnects unexpectedly |
| ConfigurationError | Invalid configuration detected at initialization |

---

## 8. Error Handling

All errors conform to the following structure:

```typescript
interface StreamError {
  code: StreamErrorCode;
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  fatal: boolean;
  cause?: unknown;
  streamId?: string;
  timestamp: Date;
}
```

```typescript
type ErrorCategory =
  | "initialization"
  | "transport"
  | "buffer"
  | "chunk"
  | "latency"
  | "heartbeat"
  | "recovery"
  | "configuration";
```

### Error Catalog

| Code | Category | Description | Recoverable | Fatal |
|---|---|---|---|---|
| StreamInitializationFailed | initialization | Runtime or stream failed to initialize | No | Yes |
| BufferOverflow | buffer | Buffer capacity exceeded, chunks evicted | Yes | No |
| BufferUnderflow | buffer | Buffer empty on consumer request | Yes | No |
| StreamTimeout | latency | Chunk or heartbeat not received within timeout | Yes | No |
| TransportDisconnected | transport | Underlying transport connection lost | Yes | No |
| TransportUnavailable | transport | Transport provider not reachable | Yes | Yes (after retries) |
| InvalidChunk | chunk | Chunk fails format, sequence, or timing validation | No | Yes |
| ChunkGapDetected | chunk | Sequence number gap exceeds tolerance | Yes | No |
| SynchronizationFailure | recovery | Stream resync fails after reconnection | No | Yes |
| HeartbeatTimeout | heartbeat | Heartbeat not received within timeout × maxRetries | No | Yes |
| RecoveryFailed | recovery | All recovery retries exhausted | No | Yes |
| ConfigurationError | configuration | Invalid or missing configuration field | No | Yes |

### Error Handling Rules

1. Recoverable errors shall not terminate the stream.
2. The Recovery Manager shall attempt reconnection for recoverable transport errors.
3. Fatal errors shall transition the stream to the `failed` state.
4. The runtime shall emit a `StreamError` event for every error.
5. Errors shall not expose provider-specific implementation details through public interfaces.

---

## 9. Configuration

### StreamConfiguration

```typescript
interface StreamConfiguration {
  chunkSize: number;
  maxBufferSize: number;
  minBufferSize: number;
  maxLatencyMs: number;
  heartbeatIntervalMs: number;
  reconnectIntervalMs: number;
  recoveryTimeoutMs: number;
  maxRetries: number;
  compression: CompressionOptions;
  mode: StreamingMode;
}
```

### Field Reference

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| chunkSize | number | Yes | — | Must be between 160 and 65535 bytes |
| maxBufferSize | number | Yes | — | Must be >= minBufferSize |
| minBufferSize | number | Yes | — | Must be > 0 and <= maxBufferSize |
| maxLatencyMs | number | Yes | — | Must be > 0 |
| heartbeatIntervalMs | number | Yes | 1000 | Must be between 100 and 30000 ms |
| reconnectIntervalMs | number | Yes | 500 | Must be between 100 and 10000 ms |
| recoveryTimeoutMs | number | Yes | 10000 | Must be > reconnectIntervalMs |
| maxRetries | number | Yes | 3 | Must be between 0 and 10 |
| compression.enabled | boolean | No | false | — |
| compression.algorithm | string | No | "none" | Must be "gzip", "zlib", or "none" when enabled |
| compression.level | number | No | — | Must be between 1 and 9 when algorithm is set |
| mode | StreamingMode | Yes | "duplex" | Must be "send", "receive", or "duplex" |

### Validation Rules

1. Configuration shall be validated during `initialize()`.
2. Invalid configuration shall emit `ConfigurationError` and reject the initialize promise.
3. Field types and bounds shall be enforced strictly.
4. Compression options shall be validated only when `enabled` is `true`.

---

## 10. Performance Targets

The implementation shall satisfy the following engineering objectives:

| Objective | Requirement |
|---|---|
| Streaming stability | Stream shall sustain continuous chunk flow without interruption under normal network conditions |
| Chunk throughput | Throughput shall match or exceed the audio sample rate × bit depth × channels for the configured chunk size |
| Buffer stability | Buffer occupancy shall remain between `minBufferSize` and `maxBufferSize` under steady-state flow |
| Long-running streams | No resource degradation over sessions lasting 60 minutes or longer |
| Recovery time | Stream shall recover within `recoveryTimeoutMs` after transport reconnection |
| Resource usage | Memory footprint shall remain bounded by `maxBufferSize` regardless of session duration |
| Memory stability | No monotonic memory growth over the lifetime of a stream session |
| CPU usage | CPU utilization shall not prevent the Speech Runtime from meeting its own performance targets |
| Scalability | Runtime shall support at least one duplex stream per voice session without resource contention |

---

## 11. Testing Requirements

### 11.1 Unit Testing

| Test | Description |
|---|---|
| Chunk validation | Valid chunks accepted, invalid chunks rejected with `InvalidChunk` error |
| Sequence numbering | Chunks numbered sequentially, gaps detected and reported |
| Buffer bounds | Buffer respects min/max thresholds, overflow evicts oldest chunks |
| State transitions | Every valid and invalid state transition tested |
| Configuration validation | Invalid config rejected with `ConfigurationError` |

### 11.2 Integration Testing

| Test | Description |
|---|---|
| Create → start → stop → dispose | Full lifecycle passes |
| Streaming chunks | End-to-end chunk flow from input to output |
| Flow control | Backpressure applied when buffer exceeds threshold |
| Heartbeat exchange | Heartbeats sent and received at configured interval |

### 11.3 Streaming Tests

| Test | Description |
|---|---|
| Bidirectional streaming | Simultaneous input and output streams |
| Stream pause/resume | Chunk flow pauses and resumes correctly |
| Stream mode switching | Send-only, receive-only, and duplex modes |
| Chunk ordering | Output chunks delivered in sequence order |

### 11.4 Stress Tests

| Test | Description |
|---|---|
| Maximum throughput | Sustained chunk production at peak rate |
| Buffer saturation | Sustained producer rate exceeding consumer rate |
| Latency under load | Latency metrics under maximum configured throughput |

### 11.5 Buffer Tests

| Test | Description |
|---|---|
| Overflow behavior | Oldest chunks evicted at capacity, `BufferOverflow` emitted |
| Underflow behavior | Empty buffer on consumer read, `BufferUnderflow` emitted |
| Drain behavior | All chunks flushed on stop |
| Threshold events | `BufferLow` and `BufferHigh` fire at correct occupancy |

### 11.6 Packet Loss Tests

| Test | Description |
|---|---|
| Chunk gap detection | Missing sequence numbers detected and reported |
| Chunk reordering | Out-of-order chunks re-sequenced correctly |
| Dropped chunk recovery | Lost chunks re-requested during recovery |
| Partial data loss | Stream continues after isolated chunk loss |

### 11.7 Recovery Tests

| Test | Description |
|---|---|
| Transport disconnect | Stream detects disconnection and initiates recovery |
| Reconnection | Stream reconnects within `reconnectIntervalMs` |
| Resynchronization | Stream resumes chunk flow from correct sequence position |
| Retry exhaustion | All retries consumed, stream transitions to `failed` |
| Recovery with buffered data | Buffered chunks preserved and flushed after reconnection |

### 11.8 Long-Duration Tests

| Test | Description |
|---|---|
| 60-minute stream | No degradation, memory leak, or metric drift |
| 60-minute with pauses | Multiple pause/resume cycles over duration |
| Overnight stability | Stream survives extended idle periods |

### 11.9 Concurrency Tests

| Test | Description |
|---|---|
| Multiple input streams | Concurrent input streams do not interfere |
| Multiple output streams | Concurrent output streams do not interfere |
| Concurrent start/stop | Simultaneous lifecycle operations succeed |
| Buffer contention | Concurrent producers and consumers on shared buffer |

### 11.10 Performance Benchmarking

| Benchmark | Description |
|---|---|
| Chunk throughput (max) | Maximum chunks per second sustainable |
| Latency (idle) | Round-trip latency under no load |
| Latency (loaded) | Round-trip latency under maximum throughput |
| Recovery time | Time from interruption to resumed streaming |
| Buffer flush time | Time to drain full buffer |

### 11.11 Memory Leak Testing

| Test | Description |
|---|---|
| Stream create/dispose cycle | 1000 iterations, no heap growth |
| Long-duration allocation | 60-minute run, stable RSS |
| Buffer allocation/deallocation | Repeated buffer fill/drain cycles |

### 11.12 Compliance Testing

| Test | Description |
|---|---|
| Interface compliance | Implements all required public interfaces |
| State machine compliance | All required states and transitions present |
| Event compliance | All standardized events emitted |
| Error compliance | All error codes conform to specification |
| Configuration compliance | All required fields accepted and validated |

---

## 12. Compliance Requirements

A Streaming Runtime implementation is compliant with this specification **only if** it:

1. Implements every required public interface defined in Section 5.
2. Implements the complete state machine defined in Section 6, including all required states and transitions.
3. Emits all standardized runtime events defined in Section 7.
4. Returns structured errors conforming to Section 8 for every error condition.
5. Uses only Provider Interfaces (TVR-PIS-001) for external streaming services.
6. Does **not** communicate directly with the Conversation Gateway.
7. Does **not** implement dialogue logic.
8. Does **not** implement business logic.
9. Does **not** access Business Brain internals.
10. Supports externally supplied configuration (Section 9).
11. Passes every required testing suite defined in Section 11.

---

## 13. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Breaking changes to public interfaces, state machine states/transitions, mandatory events, or error contracts |
| Minor | Backward-compatible additions: new optional configuration fields, new events, new metrics, new test categories |
| Patch | Documentation clarifications, correction of non-normative text, correction of test descriptions |

Implementations shall declare the specification version they conform to, enabling compatibility validation across Voice Runtime components.

---

## 14. Non-Goals

The Streaming Runtime explicitly does **not** implement:

- Business logic or business rule evaluation
- Conversation planning or response generation
- Dialogue management or intent routing
- Memory, context, or conversation history
- Gateway protocol construction or parsing
- Business calculations or financial computations
- Business permissions or access control
- Database access or persistence
- Business Brain integration or querying
- User authentication or session token management
- Provider selection or provider lifecycle management
- Speech recognition or synthesis algorithms
- Microphone acquisition or audio playback device management
