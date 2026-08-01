# TradeOS Session Runtime Specification

Document ID: TVR-SESR-001
Title: TradeOS Session Runtime Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- Frozen Voice Runtime Architecture
- Frozen Conversation Gateway Protocol

---

## 1. Purpose

This specification defines the implementation contract for the Session Runtime within the TradeOS Voice Runtime.

The Session Runtime is responsible for the lifecycle of Voice Runtime sessions. It creates, activates, suspends, resumes, expires, and disposes sessions that encompass the full duration of a voice interaction.

It is responsible **only** for runtime session management.

It does **not** own:

- Business sessions or user sessions
- Business memory
- Business logic
- Business permissions
- Database persistence
- Gateway implementation
- Dialogue orchestration
- Speech processing (STT/TTS)
- Stream management
- Provider lifecycle

---

## 2. Scope

The Session Runtime owns:

- Voice session creation (allocate a new session for an incoming voice interaction)
- Conversation association (link a session to a Conversation Gateway conversation ID)
- Session activation (transition a session into the active state)
- Session suspension (temporarily deactivate a session without destroying it)
- Session resumption (restore a suspended session to active state)
- Session expiration (close a session due to idle timeout or maximum duration)
- Session shutdown (gracefully close a session on demand)
- Runtime metadata (track session-level identifiers, timestamps, and state)
- Session recovery (restore a session after interruption or runtime failure)
- Session health (report whether a session is functional)

The Session Runtime does **not** own:

- Dialogue flow or turn management
- Business data or computation
- User authentication or permissions
- Database persistence of session data beyond runtime lifetime
- Gateway protocol implementation
- Speech-to-Text or Text-to-Speech provider management
- Audio stream lifecycle
- Provider selection or configuration

---

## 3. Runtime Responsibilities

The Session Runtime shall:

| Responsibility | Description |
|---|---|
| Create session | Allocate a new VoiceSession with a unique identifier |
| Resume session | Restore a suspended or interrupted session to active state |
| Suspend session | Deactivate a session, preserving its state and metadata |
| Close session | Terminate a session and release all associated resources |
| Track runtime state | Maintain the current state of every active session |
| Manage session identifiers | Generate and enforce uniqueness of session IDs |
| Associate conversation identifiers | Link each session to a Conversation Gateway conversation ID |
| Handle inactivity | Detect idle sessions and emit timeout warnings |
| Handle expiration | Close sessions that exceed idle timeout or maximum duration |
| Recover interrupted sessions | Detect session interruption and attempt recovery |
| Emit lifecycle events | Fire standardized events for every state transition |
| Report health | Return session health on demand |
| Enforce state transitions | Reject invalid transitions with structured errors |

---

## 4. Internal Modules

The Session Runtime is composed of the following implementation modules.

### 4.1 Session Manager

Responsibilities:
- Process session creation, suspension, resumption, and closure requests
- Validate state transitions against the lifecycle model
- Coordinate with other internal modules during transitions
- Enforce session-level configuration (timeouts, duration limits)

### 4.2 Session Registry

Responsibilities:
- Maintain an in-memory map of all active and suspended sessions
- Provide lookup by session ID
- Enforce uniqueness of session identifiers
- Support enumeration for health reporting and metrics

### 4.3 Conversation Association Manager

Responsibilities:
- Link a session to its corresponding Conversation Gateway conversation ID
- Resolve the conversation ID for a given session
- Detach the conversation association on session close
- Validate that a session has exactly one active conversation at a time

### 4.4 Lifecycle Manager

Responsibilities:
- Drive session state transitions
- Enforce lifecycle ordering (no transition out of disposed)
- Emit lifecycle events for every transition
- Track transition timestamps for metrics

### 4.5 Recovery Manager

Responsibilities:
- Detect session interruption (heartbeat loss, runtime error)
- Initiate recovery with configurable retry policy
- Restore session state and metadata after recovery
- Escalate to `failed` state if recovery is unsuccessful

### 4.6 Timeout Manager

Responsibilities:
- Monitor idle timeout per session
- Monitor maximum session duration
- Emit `SessionTimeout` and `SessionExpiring` events
- Initiate session closure when timeout thresholds are reached

### 4.7 Heartbeat Manager

Responsibilities:
- Send periodic heartbeats for active sessions
- Monitor expected heartbeat acknowledgements
- Detect heartbeat loss and notify the Recovery Manager
- Emit heartbeat-related events

### 4.8 Metadata Manager

Responsibilities:
- Store and retrieve session-level metadata
- Enforce metadata size limits
- Provide typed access to known metadata fields (channel, language, device info)
- Clear metadata on session close

### 4.9 Health Monitor

Responsibilities:
- Aggregate health signals from all modules
- Report per-session health status
- Report aggregate runtime health
- Emit healthy and unhealthy events

---

## 5. Public Interfaces

### 5.1 VoiceSessionRuntime

```typescript
interface VoiceSessionRuntime {
  initialize(config: SessionConfiguration): Promise<void>;

  createSession(options: SessionOptions): Promise<VoiceSession>;

  resumeSession(sessionId: string): Promise<VoiceSession>;

  suspendSession(sessionId: string): Promise<void>;

  closeSession(sessionId: string): Promise<void>;

  getSession(sessionId: string): Promise<VoiceSession | null>;

  getState(): SessionRuntimeState;

  health(): Promise<SessionRuntimeHealth>;

  dispose(): Promise<void>;
}
```

### 5.2 VoiceSession

```typescript
interface VoiceSession {
  readonly sessionId: string;
  readonly conversationId: string | null;
  readonly state: SessionState;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly metadata: SessionMetadata;

  heartbeat(): Promise<void>;

  getHealth(): SessionHealth;

  onEvent(handler: (event: SessionEvent) => void): void;
}
```

### 5.3 SessionOptions

```typescript
interface SessionOptions {
  channel: Channel;
  language?: string;
  userId?: string;
  organizationId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}
```

### 5.4 SessionMetadata

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

### 5.5 SessionConfiguration

```typescript
interface SessionConfiguration {
  sessionTimeoutMs: number;
  idleTimeoutMs: number;
  heartbeatIntervalMs: number;
  recoveryTimeoutMs: number;
  maxSessionDurationMs: number;
  maxMetadataSizeBytes: number;
  maxSessions: number;
}
```

### 5.6 SessionState

```typescript
type SessionState =
  | "created"
  | "initializing"
  | "active"
  | "idle"
  | "suspended"
  | "resuming"
  | "recovering"
  | "closing"
  | "closed"
  | "disposed"
  | "failed";
```

### 5.7 SessionRuntimeState

```typescript
type SessionRuntimeState =
  | "created"
  | "initialized"
  | "running"
  | "stopping"
  | "stopped"
  | "disposed"
  | "failed";
```

### 5.8 SessionHealth

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

### 5.9 SessionRuntimeHealth

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

### 5.10 SessionHandle

```typescript
interface SessionHandle {
  readonly sessionId: string;

  activate(): Promise<void>;

  suspend(): Promise<void>;

  close(): Promise<void>;

  getState(): SessionState;

  getConversationId(): string | null;

  associateConversation(conversationId: string): Promise<void>;
}
```

---

## 6. Session Lifecycle

The Session Runtime implements the following lifecycle.

```
Created
   │
Initialize
   │
Initializing
   │
   ▼
Active ◄────────────────────────────┐
   │                                 │
   ├── Idle timeout ──► Idle ────────┤
   │                    │            │
   │                    ├── Resume ──┘
   │                    │
   │                    └── Timeout ──► Closing
   │                                    │
   ├── Suspend ──► Suspended           │
   │                  │                │
   │                  ├── Resume ──► Resuming ──► Active
   │                  │
   │                  └── Timeout ──► Closing
   │
   ├── Close ──► Closing ──► Closed ──► Disposed
   │
   └── Error ──► Failed ──► Closed
```

### Lifecycle states explained

| State | Meaning |
|---|---|
| Created | Session object allocated, not yet configured |
| Initializing | Session being configured with options and associated with conversation |
| Active | Session is fully operational; Dialogue Runtime may be running |
| Idle | No activity detected within idle timeout window; session preserved |
| Suspended | Session explicitly suspended; resources may be released |
| Resuming | Session transitioning from Suspended back to Active |
| Closing | Session in the process of shutting down |
| Closed | Session fully shut down; metadata preserved for inspection |
| Disposed | Session destroyed; all resources released |
| Failed | Session encountered an unrecoverable error |

---

## 7. Runtime State Machine

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

Failure from any state:

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

### Session-level states and valid transitions

| From | To | Condition |
|---|---|---|
| created | initializing | `createSession()` called |
| initializing | active | Configuration applied, conversation associated |
| active | idle | No activity detected for `idleTimeoutMs` |
| idle | active | Activity resumes (user speech detected) |
| active | suspended | `suspendSession()` called explicitly |
| suspended | resuming | `resumeSession()` called |
| resuming | active | Session fully restored |
| suspended | closing | Idle timeout or `closeSession()` while suspended |
| idle | closing | Idle timeout exceeded |
| active | closing | `closeSession()` called |
| closing | closed | Resources released |
| closed | disposed | `dispose()` called |
| active | failed | Unrecoverable runtime error |
| idle | failed | Unrecoverable runtime error |
| suspended | failed | Unrecoverable runtime error |
| recovering | failed | Recovery retries exhausted |
| active | recovering | Interruption detected, recovery initiated |
| idle | recovering | Interruption detected during idle |
| recovering | active | Recovery successful, session restored |
| recovering | closing | Recovery declined |
| failed | closing | Escalated to closure |
| failed | initializing | Restart attempted (optional, configurable) |

### Illegal transitions

The following transitions shall be rejected with `InvalidSessionState`:

- Any transition from `disposed`
- Any transition from `closed` except `disposed`
- `createSession()` while runtime is not `initialized` or `running`
- `suspendSession()` when session is not `active`
- `resumeSession()` when session is not `suspended`

---

## 8. Runtime Events

The Session Runtime emits standardized runtime events.

### Lifecycle Events

| Event | Emitted When |
|---|---|
| SessionRuntimeInitialized | Runtime `initialize()` completes |
| SessionRuntimeStarted | Runtime enters `running` state |
| SessionRuntimeStopped | Runtime enters `stopped` state |
| SessionRuntimeDisposed | Runtime `dispose()` completes |

### Session Lifecycle Events

| Event | Emitted When |
|---|---|
| SessionCreated | Session allocated with unique ID |
| SessionInitialized | Session configuration applied |
| SessionActivated | Session transitions to `active` |
| SessionIdle | Session transitions to `idle` |
| SessionSuspended | Session transitions to `suspended` |
| SessionResumed | Session transitions to `active` from `resuming` |
| SessionRecovered | Recovery completes successfully |
| SessionClosing | Session enters `closing` |
| SessionClosed | Session enters `closed` |
| SessionDisposed | Session enters `disposed` |
| SessionFailed | Session enters `failed` |

### Heartbeat Events

| Event | Emitted When |
|---|---|
| SessionHeartbeat | Heartbeat acknowledged for session |
| SessionHeartbeatMissed | Expected heartbeat not received |

### Timeout Events

| Event | Emitted When |
|---|---|
| SessionIdleWarning | Session idle time approaches `idleTimeoutMs` |
| SessionExpiring | Session duration approaches `maxSessionDurationMs` |
| SessionTimeout | Session exceeded idle timeout or max duration, closure initiated |

### Error Events

| Event | Emitted When |
|---|---|
| SessionError | A runtime-level or session-level error occurs |
| SessionRecoveryFailed | Recovery retries exhausted |
| SessionStateViolation | Illegal state transition attempted |

---

## 9. Error Handling

All errors conform to the following structure:

```typescript
interface SessionError {
  code: SessionErrorCode;
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  fatal: boolean;
  cause?: unknown;
  sessionId?: string;
  timestamp: Date;
}
```

```typescript
type ErrorCategory =
  | "initialization"
  | "state"
  | "timeout"
  | "heartbeat"
  | "recovery"
  | "configuration"
  | "runtime";
```

### Error Catalog

| Code | Category | Description | Recoverable | Fatal |
|---|---|---|---|---|
| SessionInitializationFailed | initialization | Session failed to apply configuration or associate conversation | No | Yes |
| InvalidSessionState | state | Operation not valid for current session state | No | No |
| SessionExpired | timeout | Session exceeded idle timeout or max duration | No | Yes |
| SessionNotFound | runtime | Requested session ID does not exist in the registry | No | No |
| DuplicateSession | runtime | Attempted to create a session with an already-existing ID | No | Yes |
| RecoveryFailed | recovery | All recovery retries exhausted | No | Yes |
| HeartbeatTimeout | heartbeat | Heartbeat not received before threshold | Yes | No (escalates to recovery) |
| MetadataLimitExceeded | configuration | Metadata size exceeds `maxMetadataSizeBytes` | No | No |
| ConfigurationError | configuration | Invalid or missing configuration field | No | Yes |
| RuntimeNotInitialized | state | Operation attempted before runtime initialization | No | Yes |

### Error Handling Rules

1. Recoverable errors shall not terminate the session.
2. The Recovery Manager shall attempt reconnection for recoverable errors.
3. Fatal errors shall transition the session to `failed`.
4. Non-fatal state violations shall return a structured error without changing state.
5. The runtime shall emit a `SessionError` event for every error.
6. Errors shall not expose Business Brain or Gateway internals through public interfaces.

---

## 10. Configuration

### SessionConfiguration

```typescript
interface SessionConfiguration {
  sessionTimeoutMs: number;
  idleTimeoutMs: number;
  heartbeatIntervalMs: number;
  recoveryTimeoutMs: number;
  maxSessionDurationMs: number;
  maxMetadataSizeBytes: number;
  maxSessions: number;
}
```

### Field Reference

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| sessionTimeoutMs | number | Yes | — | Must be between 1000 and 3600000 |
| idleTimeoutMs | number | Yes | 30000 | Must be between 5000 and 300000 |
| heartbeatIntervalMs | number | Yes | 5000 | Must be between 1000 and 60000 |
| recoveryTimeoutMs | number | Yes | 10000 | Must be between 5000 and 60000 |
| maxSessionDurationMs | number | Yes | 3600000 | Must be between 60000 and 86400000 |
| maxMetadataSizeBytes | number | Yes | 4096 | Must be between 256 and 65536 |
| maxSessions | number | Yes | 100 | Must be between 1 and 10000 |

### Validation Rules

1. Configuration shall be validated during `initialize()`.
2. Invalid configuration shall emit `ConfigurationError` and reject the initialize promise.
3. `idleTimeoutMs` must be less than `sessionTimeoutMs`.
4. `heartbeatIntervalMs` must be less than `recoveryTimeoutMs`.
5. Field types and bounds shall be enforced strictly.

---

## 11. Performance Targets

The implementation shall satisfy the following engineering objectives:

| Objective | Requirement |
|---|---|
| Fast session creation | Session creation shall not block the caller beyond a single synchronous allocation |
| Reliable recovery | Recovery shall complete within `recoveryTimeoutMs` when the underlying cause is resolved |
| Stable long-running sessions | Sessions lasting up to `maxSessionDurationMs` shall show no resource degradation |
| Minimal resource consumption | A single idle session shall consume no more than 10 KB of heap memory |
| Deterministic lifecycle | State transitions shall complete synchronously or reject with a clear error within bounded time |
| Scalable concurrent sessions | The runtime shall support up to `maxSessions` concurrent sessions without resource contention |
| Memory stability | No monotonic memory growth over the lifetime of any session |
| Timeout precision | Idle and session timeouts shall fire within ±500 ms of the configured threshold |

---

## 12. Testing Requirements

### 12.1 Unit Testing

| Test | Description |
|---|---|
| Session creation | `createSession()` returns a session with valid ID and state `initializing` |
| Session initialization | Session transitions to `active` after configuration |
| State transitions | Every legal transition produces the correct target state |
| Illegal transitions | Every illegal transition is rejected with `InvalidSessionState` |
| ID uniqueness | No two sessions share the same session ID |
| Metadata enforcement | Metadata exceeding `maxMetadataSizeBytes` is rejected |

### 12.2 Lifecycle Testing

| Test | Description |
|---|---|
| Created → active | Full path through initializing to active |
| Active → idle → active | Idle timeout triggers idle; activity resumes active |
| Active → suspended → active | Suspend and resume round-trip |
| Active → closing → closed → disposed | Full shutdown path |
| Created → disposed without activation | Cleanup of never-activated session |

### 12.3 Concurrent Session Testing

| Test | Description |
|---|---|
| Multiple simultaneous creations | `maxSessions` sessions created concurrently, all succeed |
| Concurrent lifecycle operations | Simultaneous suspend/resume/close on different sessions |
| Registry isolation | Operations on one session do not affect others |
| Maximum capacity | At `maxSessions`, additional creation is handled gracefully |

### 12.4 Recovery Testing

| Test | Description |
|---|---|
| Interruption detection | Session detects heartbeat loss and enters `recovering` |
| Successful recovery | Session returns to `active` after recovery |
| Recovery failure | Session enters `failed` after all retries exhausted |
| Recovery during idle | Session recovers from idle state correctly |

### 12.5 Expiration Testing

| Test | Description |
|---|---|
| Idle timeout | Session transitions to `idle` after `idleTimeoutMs` of inactivity |
| Session duration expiry | Session closes after `maxSessionDurationMs` |
| Expiring event | `SessionExpiring` fires before expiry |
| Timeout cancellation | Activity during idle window resets the idle timer |

### 12.6 Heartbeat Testing

| Test | Description |
|---|---|
| Heartbeat emission | Heartbeat sent at `heartbeatIntervalMs` |
| Heartbeat acknowledgement | Acknowledged heartbeat updates `lastActivityAt` |
| Missed heartbeat | `SessionHeartbeatMissed` fired after threshold |
| Heartbeat recovery | Heartbeat resumes after interruption |

### 12.7 Timeout Testing

| Test | Description |
|---|---|
| Idle warning | `SessionIdleWarning` fires at 80% of `idleTimeoutMs` |
| Timeout closure | Session closes when timeout threshold is crossed |
| Timeout cancellation | Activity within warning window cancels timeout |
| Configuration bounds | Timeouts outside allowed range are rejected |

### 12.8 Long-Duration Testing

| Test | Description |
|---|---|
| 60-minute session | No resource degradation over full session lifetime |
| Multiple idle cycles | 10+ idle/resume cycles within a single session |
| Maximum duration session | Session runs to `maxSessionDurationMs` and closes cleanly |

### 12.9 Stress Testing

| Test | Description |
|---|---|
| Max concurrent sessions | `maxSessions` sessions created, exercised, and closed |
| Rapid create/close | 1000 sessions created and closed sequentially |
| Mixed operations | Simultaneous lifecycle operations across many sessions |

### 12.10 Performance Benchmarking

| Benchmark | Description |
|---|---|
| Session creation throughput | Sessions created per second |
| Session lookup latency | Time to retrieve a session by ID |
| State transition latency | Time to complete each state transition |
| Concurrent session overhead | Memory and CPU cost per additional session |
| Recovery time | Time from detection to recovered state |

### 12.11 Compliance Testing

| Test | Description |
|---|---|
| Interface compliance | Implements all required public interfaces |
| Lifecycle compliance | All lifecycle states and transitions present |
| Event compliance | All standardized events emitted |
| Error compliance | All error codes conform to specification |
| Configuration compliance | All required fields accepted and validated |

---

## 13. Compliance Requirements

A Session Runtime implementation is compliant with this specification **only if** it:

1. Implements every required public interface defined in Section 5.
2. Implements the complete lifecycle defined in Section 6.
3. Implements the state machine defined in Section 7, including all required states and transitions.
4. Emits all standardized runtime events defined in Section 8.
5. Maintains unique session identifiers across all sessions.
6. Associates conversation identifiers correctly with each session.
7. Does **not** implement business logic.
8. Does **not** access Business Brain internals.
9. Does **not** implement speech processing (STT/TTS).
10. Does **not** communicate directly with the Business Brain.
11. Supports externally supplied configuration (Section 10).
12. Passes every required testing suite defined in Section 12.

---

## 14. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Breaking changes to public interfaces, lifecycle states, state machine transitions, mandatory events, or error contracts |
| Minor | Backward-compatible additions: new optional configuration fields, new events, new metrics, new test categories |
| Patch | Documentation clarifications, correction of non-normative text, correction of test descriptions |

Implementations shall declare the specification version they conform to, enabling compatibility validation across Voice Runtime components.

---

## 15. Non-Goals

The Session Runtime explicitly does **not** implement:

- Business logic or business rule evaluation
- Business memory or context storage
- Business permissions or access control
- Database persistence beyond runtime lifetime
- Business calculations or financial computations
- Inventory logic or product data
- Analytics or reporting
- Forecasting or predictions
- Conversation Gateway internals or protocol construction
- Speech recognition or speech synthesis
- Provider implementation or provider lifecycle
- Business Brain integration or querying
- Dialogue orchestration or turn management
