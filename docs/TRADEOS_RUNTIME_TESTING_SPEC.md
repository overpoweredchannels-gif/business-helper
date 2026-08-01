# TradeOS Voice Runtime — Testing Specification

Document ID: TVR-TS-001
Title: TradeOS Voice Runtime Testing Specification
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

---

## 1. Testing Philosophy

### 1.1 Principles

1. **Every interface has a contract test.** No public interface shall be implemented without a corresponding test that verifies every method signature, parameter type, and return type.

2. **Every state machine is fully covered.** Every valid transition and every illegal transition shall have a dedicated test case.

3. **Every error path is tested.** Success paths alone are insufficient. Every error code, every retry branch, and every timeout path shall be tested.

4. **Providers are tested through compliance suites.** No provider-specific SDK logic shall be tested directly. All provider testing is done through the compliance test suite defined in TVR-PIS-001.

5. **Integration tests use real interfaces.** Integration tests shall wire components together through their public interfaces, not through internal methods or mocks.

6. **Recovery is tested under real failure conditions.** Connection loss, timeout, and provider unavailability shall be injected at the transport layer, not simulated at the component boundary.

7. **Long-running tests are mandatory.** Every runtime component shall have a test that exercises it for at least 60 minutes to verify memory stability and the absence of resource leaks.

8. **Tests are deterministic.** Flaky tests shall be treated as bugs. Tests shall have no hidden dependencies on timing, network conditions, or random state.

9. **Test data is reproducible.** Every test shall use deterministic seed data. Randomized tests shall log the seed so failures can be reproduced.

10. **Tests run in CI.** Every test in this specification shall be automated and run in a CI pipeline on every commit.

### 1.2 Test Levels

| Level | Scope | Environment |
|---|---|---|
| Unit | Single class or function | Isolated, no I/O |
| Integration | Component + direct dependencies | In-process, mocked transport |
| Contract | Public interface compliance | Isolated, reflection-based |
| Stress | Component under load | In-process, synthetic load |
| Long-running | Component over time | Dedicated environment |
| E2E | Full Voice SDK → Gateway | Production-like staging |

---

## 2. Unit Testing

### 2.1 Requirements

Every public function, method, and class in the Voice Runtime SHALL have unit tests covering:

- Normal operation (happy path)
- All error paths
- Edge cases (empty input, null input, boundary values)
- State transitions (valid and invalid)

### 2.2 Test cases

| # | Test | Applies To | Verification |
|---|---|---|---|
| UT-01 | Method exists | Every public method | Test calls method and verifies it returns without throwing for valid input |
| UT-02 | Method rejects invalid input | Every public method with parameters | Test calls method with null/undefined/out-of-range values and verifies structured error |
| UT-03 | Method idempotency | Every method documented as idempotent | Test calls method twice with same input and verifies same result |
| UT-04 | Async methods complete | Every async method | Test awaits method and verifies promise resolves or rejects within timeout |
| UT-05 | Empty collections handled | Methods accepting arrays/maps | Test passes empty collection and verifies no crash |
| UT-06 | Boundary values accepted | Methods with numeric parameters | Test passes min/max boundary values and verifies acceptance |
| UT-07 | Boundary values rejected | Methods with numeric ranges | Test passes below-min and above-max values and verifies rejection |
| UT-08 | Default values applied | Methods with optional parameters | Test omits optional parameter and verifies default behavior |
| UT-09 | Type enforcement | Methods with union type parameters | Test passes every valid variant and verifies acceptance |
| UT-10 | No side effects on error | Methods that modify state | Test triggers error and verifies state is unchanged |

### 2.3 Pass criteria

- 100% of public methods have unit tests.
- 100% of error paths are exercised.
- 90%+ line coverage (excluding type-only files).
- Zero flaky tests over 10 consecutive runs.

---

## 3. Integration Testing

### 3.1 Requirements

Integration tests verify that components work together through their public interfaces.

### 3.2 Test cases

| # | Test | Description |
|---|---|---|
| IT-01 | Provider → Speech Runtime | STT provider delivers transcript events to Speech Runtime |
| IT-02 | Speech Runtime → Dialogue Runtime | Final transcript delivered from Speech Runtime to Dialogue Runtime |
| IT-03 | Dialogue Runtime → Gateway Client | Dialogue turn triggers gateway request |
| IT-04 | Gateway Client → Dialogue Runtime | Gateway response delivered back to Dialogue Runtime |
| IT-05 | Dialogue Runtime → Speech Runtime | Speak request triggers TTS synthesis |
| IT-06 | Streaming Runtime ↔ Speech Runtime | Audio chunks flow bidirectionally between Streaming and Speech Runtimes |
| IT-07 | Session Runtime → Dialogue Runtime | Session activation triggers Dialogue Runtime initialization |
| IT-08 | Session Runtime → Speech Runtime | Session activation triggers Speech Runtime initialization |
| IT-09 | Session Runtime → Streaming Runtime | Session activation triggers Streaming Runtime initialization |
| IT-10 | Voice SDK → All Runtimes | SDK initialize() propagates to all runtimes |
| IT-11 | Voice SDK → Session Runtime | SDK startSession() creates session in Session Runtime |
| IT-12 | Voice SDK → Audio API | SDK startCapture() triggers audio flow through Speech Runtime |
| IT-13 | Gateway Client → Conversation Gateway | Gateway Client sends valid ChatRequest and receives ChatResponse |
| IT-14 | Full dialogue round-trip | Transcript → Gateway request → Gateway response → Speech synthesis completes |

### 3.3 Pass criteria

- All integration tests pass with real component instances (no mocks for the component under test).
- Tests use mocked transport layer (no external network dependency).
- Each test completes within 10 seconds.

---

## 4. Contract Testing

### 4.1 Requirements

Every public TypeScript interface SHALL have a contract test that verifies it is implemented correctly. Contract tests use reflection and type inspection where possible.

### 4.2 Test cases

| # | Test | Applies To |
|---|---|---|
| CT-01 | All interface methods present | Provider, SpeechRuntime, StreamingRuntime, DialogueRuntime, VoiceSessionRuntime, GatewayClient, VoiceSDK, VoiceClient |
| CT-02 | All interface method signatures match | Provider, SpeechRuntime, StreamingRuntime, DialogueRuntime, VoiceSessionRuntime, GatewayClient, VoiceSDK, VoiceClient |
| CT-03 | All enum variants present | ProviderState, SessionState, StreamState, SpeechRuntimeState, DialogueState, VoiceClientState, ClientType |
| CT-04 | All union type variants present | ProviderErrorCode, SpeechRuntimeErrorCode, StreamErrorCode, SessionErrorCode, GatewayClientErrorCode, SDKErrorCode |
| CT-05 | All event names emitted | All events defined in TVR-EM-001 Section 5 |
| CT-06 | Event envelope fields present | All events carry version, id, name, timestamp, producer, consumer, category, level, correlationId, payload |
| CT-07 | Configuration fields accepted | All configuration interfaces accept all required fields |
| CT-08 | Configuration defaults applied | All optional configuration fields have correct defaults |

### 4.3 Pass criteria

- 100% of public interfaces have contract tests.
- Contract tests fail at compile time if an interface changes without updating the test.
- Zero tolerance for missing methods, incorrect signatures, or missing enum variants.

---

## 5. Provider Compliance Testing

### 5.1 Requirements

Every provider implementation (STT, TTS, Transport) SHALL pass a compliance test suite that verifies it satisfies the Provider Interface Specification (TVR-PIS-001).

### 5.2 Test cases

#### 5.2.1 Lifecycle Tests

| # | Test | Description |
|---|---|---|
| PC-01 | Initialize | `initialize()` succeeds with valid configuration |
| PC-02 | Initialize with invalid config | `initialize()` rejects invalid configuration with ProviderError |
| PC-03 | Start | `start()` transitions provider to running state |
| PC-04 | Stop | `stop()` transitions provider to stopped state |
| PC-05 | Dispose | `dispose()` releases all resources |
| PC-06 | Start without init | Calling `start()` before `initialize()` returns correct error |
| PC-07 | Double initialize | Second `initialize()` is idempotent or returns correct error |
| PC-08 | Double dispose | Second `dispose()` is idempotent |
| PC-09 | Restart after stop | `start()` after `stop()` succeeds |
| PC-10 | Restart after failure | Provider recovers to running state after transient failure |

#### 5.2.2 Health Tests

| # | Test | Description |
|---|---|---|
| PC-11 | Healthy state | `health()` returns `healthy: true` when provider is operational |
| PC-12 | Unhealthy state | `health()` returns `healthy: false` when provider is unavailable |
| PC-13 | Health after recovery | `health()` returns `healthy: true` after provider recovers |
| PC-14 | Heartbeat validation | `health().lastHeartbeat` is recent (within 2x heartbeat interval) |
| PC-15 | Latency reported | `health().latencyMs` is a non-negative number |

#### 5.2.3 STT Tests

| # | Test | Description |
|---|---|---|
| PC-16 | Start recognition | `startRecognition()` begins audio processing |
| PC-17 | Continuous recognition | Provider accepts multiple `writeAudio()` calls and emits partial transcripts |
| PC-18 | Final transcript | Provider emits `FinalTranscriptReceived` after `stopRecognition()` |
| PC-19 | Write audio | `writeAudio()` accepts valid AudioChunk without error |
| PC-20 | Write invalid audio | `writeAudio()` rejects invalid AudioChunk with structured error |
| PC-21 | Stop recognition | `stopRecognition()` stops audio processing |
| PC-22 | Language switching | Provider accepts different language in VoiceSession (if multilingual capability) |

#### 5.2.4 TTS Tests

| # | Test | Description |
|---|---|---|
| PC-23 | Synthesize | `synthesize()` returns an AudioStream |
| PC-24 | Streaming synthesis | AudioStream yields one or more AudioChunks |
| PC-25 | Long response | AudioStream yields chunks totalling expected duration |
| PC-26 | Cancel synthesis | `stopSynthesis()` interrupts active synthesis |
| PC-27 | Concurrent synthesis | Provider handles concurrent `synthesize()` calls (up to implementation limit) |

#### 5.2.5 Transport Tests

| # | Test | Description |
|---|---|---|
| PC-28 | Connect | `connect()` establishes transport connection |
| PC-29 | Disconnect | `disconnect()` terminates transport connection |
| PC-30 | Reconnect | Provider reconnects after connection loss (if reconnect capability) |
| PC-31 | Send message | `send()` delivers TransportMessage |
| PC-32 | Message ordering | Messages sent in order are received in order |
| PC-33 | Network interruption | Provider survives temporary network loss and recovers (if reconnect capability) |

#### 5.2.6 Failure Tests

| # | Test | Description |
|---|---|---|
| PC-34 | Authentication failure | Provider rejects invalid credentials with AUTHENTICATION_FAILED |
| PC-35 | Timeout | Provider operation times out after configured timeoutMs |
| PC-36 | Connection loss | Provider detects connection loss and emits ConnectionLost event |
| PC-37 | Invalid configuration | Provider rejects invalid configuration with INVALID_CONFIGURATION |
| PC-38 | Service unavailable | Provider handles service unavailable with SERVICE_UNAVAILABLE error |
| PC-39 | Retry behavior | Provider retries on transient failures per RetryPolicy |

### 5.3 Pass criteria

- 100% of applicable tests pass for each provider type.
- One compliance report per provider implementation.
- Tests run against a real provider endpoint (sandbox/test tier) or a compliant mock.

---

## 6. Gateway Client Testing

### 6.1 Requirements

The Gateway Client SHALL pass tests verifying correct request construction, retry logic, timeout enforcement, and response parsing.

### 6.2 Test cases

| # | Test | Description |
|---|---|---|
| GC-01 | Request construction | `send()` produces a ChatRequest with all required TCGP fields |
| GC-02 | Channel is voice | ChatRequest.channel is always "voice" |
| GC-03 | Correlation ID propagation | Provided correlationId appears in ChatRequest |
| GC-04 | Correlation ID generation | Absent correlationId is generated with correct format |
| GC-05 | Message ID generation | Every request has unique messageId in metadata |
| GC-06 | Idempotency key present | Retried requests carry same idempotencyKey |
| GC-07 | Response parsing | Successful ChatResponse produces correct GatewayResponse |
| GC-08 | Error parsing | Error ChatResponse produces structured GatewayClientError |
| GC-09 | Conversation ID extraction | conversationId extracted from response and returned |
| GC-10 | Retry on INTERNAL_ERROR | Gateway returns INTERNAL_ERROR, client retries |
| GC-11 | Retry on RATE_LIMITED | Gateway returns RATE_LIMITED, client retries |
| GC-12 | No retry on VALIDATION_ERROR | Gateway returns VALIDATION_ERROR, client does not retry |
| GC-13 | No retry on BRAIN_NOT_INITIALIZED | Gateway returns BRAIN_NOT_INITIALIZED, client does not retry |
| GC-14 | Max retries exhausted | After retryMaxAttempts, returns MaxRetriesExceeded |
| GC-15 | Backoff delay | Delay between retries follows exponential backoff formula |
| GC-16 | Network error retry | Fetch exception triggers retry |
| GC-17 | Per-request timeout | Gateway does not respond within timeoutMs, RequestTimedOut emitted |
| GC-18 | Timeout with retry | Timeout on attempt 1, retry on attempt 2 |
| GC-19 | Total timeout exceeded | Cumulative time exceeds budget, operation fails |
| GC-20 | RequestStarted event emitted | Event fires on dispatch |
| GC-21 | RequestSucceeded event emitted | Event fires on success |
| GC-22 | RequestRetried event emitted | Event fires before each retry |
| GC-23 | RequestTimedOut event emitted | Event fires on timeout |
| GC-24 | RequestFailed event emitted | Event fires on non-retryable error |

### 6.3 Pass criteria

- 100% of test cases pass.
- Tests use a mock gateway that returns configurable responses.
- Retry and timeout tests verify wall-clock delays against configured values (±10% tolerance).

---

## 7. Dialogue Testing

### 7.1 Requirements

The Dialogue Runtime SHALL pass tests verifying turn management, confirmation flows, clarification flows, interruption handling, and state machine compliance.

### 7.2 Test cases

| # | Test | Description |
|---|---|---|
| DT-01 | Turn start | `startTurn()` transitions to Listening state |
| DT-02 | Turn complete | Final transcript → gateway request → response → speak completes full turn |
| DT-03 | Turn timeout | Turn duration exceeds maxTurnDuration, TurnTimeout emitted |
| DT-04 | Confirmation requested | Dialogue emits confirmation request when confidence below threshold |
| DT-05 | Confirmation received | User confirms, dialogue proceeds |
| DT-06 | Confirmation rejected | User rejects, dialogue requests clarification or alternative |
| DT-07 | Confirmation timeout | User does not respond within confirmationTimeout, dialogue recovers |
| DT-08 | Clarification requested | Dialogue emits clarification request when input is ambiguous |
| DT-09 | Clarification received | User provides clarification, dialogue proceeds |
| DT-10 | Clarification timeout | User does not respond within clarificationTimeout, dialogue recovers |
| DT-11 | Speech interruption during playback | User speaks during TTS playback, dialogue transitions to Listening |
| DT-12 | Speech interruption during thinking | User speaks while waiting for gateway, dialogue handles interruption |
| DT-13 | Gateway error during turn | Gateway returns error, dialogue reports error and recovers |
| DT-14 | Gateway timeout during turn | Gateway times out, dialogue retries or reports error |
| DT-15 | Multiple clarifications | Dialogue handles multiple sequential clarification rounds |
| DT-16 | Empty transcript | STT returns empty transcript, dialogue requests repeat |
| DT-17 | Low confidence transcript | STT returns low-confidence transcript, dialogue requests confirmation |
| DT-18 | Dialogue state machine | Every valid state transition produces correct state |
| DT-19 | Illegal state transitions | Every illegal transition is rejected with InvalidDialogueState |
| DT-20 | Thinking event emitted | `ThinkingStarted` and `ThinkingCompleted` emitted for gateway wait period |

### 7.3 Pass criteria

- 100% of test cases pass.
- Turn completion time is bounded (no infinite waits).
- All state transitions verified (both valid and illegal).

---

## 8. Streaming Testing

### 8.1 Requirements

The Streaming Runtime SHALL pass tests verifying stream lifecycle, chunk flow, buffer management, flow control, heartbeat exchange, and recovery.

### 8.2 Test cases

| # | Test | Description |
|---|---|---|
| ST-01 | Stream create | `createStream()` returns StreamController with valid state |
| ST-02 | Stream lifecycle | create → initialize → connect → stream → pause → resume → stop → dispose |
| ST-03 | Stream connect | `start()` establishes transport and transitions to connected |
| ST-04 | Stream write | `write()` accepts AudioChunk and delivers it to output |
| ST-05 | Stream onChunk | `onChunk()` handler receives AudioChunks |
| ST-06 | Stream pause | `pause()` suspends chunk flow, no chunks delivered while paused |
| ST-07 | Stream resume | `resume()` restarts chunk flow from pause |
| ST-08 | Stream stop | `stop()` terminates chunk flow and flushes buffers |
| ST-09 | Stream dispose | `dispose()` releases all stream resources |
| ST-10 | Chunk sequencing | Chunks received in order of sequence number |
| ST-11 | Chunk gap detection | Missing sequence number detected, ChunkDropped or gap event emitted |
| ST-12 | Chunk deduplication | Duplicate sequence number is discarded |
| ST-13 | Buffer low | Buffer occupancy falls below minBufferSize, BufferLow emitted |
| ST-14 | Buffer high | Buffer occupancy exceeds maxBufferSize, BufferHigh emitted |
| ST-15 | Buffer overflow | Buffer capacity exceeded, oldest chunks evicted, BufferOverflow emitted |
| ST-16 | Buffer underflow | Buffer empty on consumer request, BufferUnderflow emitted |
| ST-17 | Buffer drain | `stop()` drains buffer, BufferDrained emitted |
| ST-18 | Flow control apply | Producer throttled when buffer exceeds threshold |
| ST-19 | Flow control release | Producer unthrottled when buffer drains |
| ST-20 | Heartbeat send/receive | Heartbeats exchanged at configured interval |
| ST-21 | Heartbeat miss detected | Missing heartbeat detected after interval × tolerance |
| ST-22 | Latency measurement | LatencyMs updated on each chunk round-trip |
| ST-23 | Latency warning | Latency exceeds maxLatencyMs, LatencyWarning emitted |
| ST-24 | Stream interruption | Chunk gap or heartbeat loss detected, StreamInterrupted emitted |
| ST-25 | Recovery connect | Stream reconnects within reconnectIntervalMs |
| ST-26 | Recovery resync | Stream resumes from correct sequence position |
| ST-27 | Recovery retry | Recovery retries up to maxRetries |
| ST-28 | Recovery failure | After maxRetries, stream transitions to failed |
| ST-29 | Bidirectional streaming | Simultaneous input and output streams operate without interference |
| ST-30 | Illegal state operations | write() on stopped stream, pause() on idle stream rejected |

### 8.3 Pass criteria

- 100% of test cases pass.
- Buffer tests verify occupancy levels with measurement probes.
- Recovery tests use a configurable transport mock that can disconnect on demand.

---

## 9. Session Testing

### 9.1 Requirements

The Session Runtime SHALL pass tests verifying session lifecycle, state transitions, heartbeat, timeout, and recovery.

### 9.2 Test cases

| # | Test | Description |
|---|---|---|
| SE-01 | Session creation | `createSession()` returns VoiceSession with unique ID |
| SE-02 | Session lifecycle | created → initializing → active → idle → active → closing → closed → disposed |
| SE-03 | Session activation | Session transitions to active after configuration |
| SE-04 | Session idle | No activity for idleTimeoutMs, session transitions to idle |
| SE-05 | Session idle resume | Activity during idle resumes session to active |
| SE-06 | Session suspend | `suspendSession()` transitions session to suspended |
| SE-07 | Session resume | `resumeSession()` transitions session to active |
| SE-08 | Session close | `closeSession()` transitions session to closing → closed |
| SE-09 | Session dispose | `dispose()` releases all session resources |
| SE-10 | Session expiry | Session exceeds maxSessionDurationMs, closes automatically |
| SE-11 | Idle warning | SessionIdleWarning emitted at 80% of idleTimeoutMs |
| SE-12 | Expiring warning | SessionExpiring emitted before maxSessionDurationMs |
| SE-13 | Heartbeat send | Heartbeat sent at heartbeatIntervalMs |
| SE-14 | Heartbeat miss | Missed heartbeat detected and SessionHeartbeatMissed emitted |
| SE-15 | Session recovery | Interrupted session recovers and emits SessionRecovered |
| SE-16 | Recovery failure | Session enters failed after recovery retries exhausted |
| SE-17 | Duplicate session ID | `createSession()` with existing ID rejected with DuplicateSession |
| SE-18 | Session not found | `getSession()` with unknown ID returns null |
| SE-19 | Illegal transitions | Operations on wrong state return InvalidSessionState error |
| SE-20 | Conversation association | Session correctly associates with conversation ID |
| SE-21 | Metadata storage | Metadata stored and retrieved correctly |
| SE-22 | Metadata limit | Metadata exceeding maxMetadataSizeBytes rejected |

### 9.3 Pass criteria

- 100% of test cases pass.
- Timeout tests use a fast clock (configurable timeout values for testing).
- Session ID uniqueness verified across 10000 consecutive creations.

---

## 10. Speech Testing

### 10.1 Requirements

The Speech Runtime SHALL pass tests verifying audio capture, recognition, synthesis, playback, and provider integration.

### 10.2 Test cases

| # | Test | Description |
|---|---|---|
| SP-01 | Runtime lifecycle | initialize → start → startListening → stopListening → stop → dispose |
| SP-02 | Start listening | `startListening()` opens microphone and begins capture |
| SP-03 | Stop listening | `stopListening()` stops capture and closes microphone |
| SP-04 | Speak | `speak()` triggers TTS synthesis and playback |
| SP-05 | Interrupt playback | `interruptPlayback()` stops active playback |
| SP-06 | Continuous recognition | Speech Runtime streams audio to STT provider continuously |
| SP-07 | Partial transcript | STT partial transcript delivered to Dialogue Runtime |
| SP-08 | Final transcript | STT final transcript delivered to Dialogue Runtime |
| SP-09 | Speech detection | VAD detects speech start and end, emits SpeechDetected/SpeechEnded |
| SP-10 | Silence detection | VAD detects silence and signals end of speech |
| SP-11 | Playback streaming | TTS audio chunks played in sequence without audible gaps |
| SP-12 | Playback completion | PlaybackCompleted emitted after last chunk |
| SP-13 | Playback interruption | User speech during playback triggers interruption |
| SP-14 | STT provider connect | Speech Runtime connects to STT provider on startListening |
| SP-15 | STT provider disconnect | Speech Runtime disconnects from STT provider on stopListening |
| SP-16 | TTS provider connect | Speech Runtime connects to TTS provider on speak |
| SP-17 | TTS provider disconnect | Speech Runtime disconnects from TTS provider after playback |
| SP-18 | Microphone opened | MicrophoneOpened emitted when device opens |
| SP-19 | Microphone closed | MicrophoneClosed emitted when device closes |
| SP-20 | Audio format validation | Invalid audio format rejected with InvalidAudioFormat error |
| SP-21 | State machine compliance | All legal and illegal state transitions verified |

### 10.3 Pass criteria

- 100% of test cases pass.
- Audio tests use synthetic audio data (no real microphone required in CI).
- Playback interruption verified within 100 ms of speech detection.

---

## 11. SDK Testing

### 11.1 Requirements

The Voice SDK SHALL pass tests verifying client lifecycle, session management, event subscription, streaming, audio API, and error handling across all client types.

### 11.2 Test cases

| # | Test | Description |
|---|---|---|
| SK-01 | SDK entry point | `getVoiceSDK()` or equivalent returns valid VoiceSDK |
| SK-02 | Client creation | `createClient()` returns VoiceClient with correct clientType |
| SK-03 | Configuration validation | Invalid config throws INVALID_CONFIGURATION |
| SK-04 | Client lifecycle | create → initialize → connect → disconnect → dispose |
| SK-05 | Client lifecycle (no connect) | create → initialize → dispose |
| SK-06 | Double initialize | Second initialize is no-op |
| SK-07 | Start session | `startSession()` returns VoiceSessionHandle |
| SK-08 | Stop session | `stopSession()` ends active session |
| SK-09 | Double start session | Second `startSession()` throws SESSION_FAILED |
| SK-10 | Stop without session | `stopSession()` is no-op |
| SK-11 | Session handle | VoiceSessionHandle returns correct sessionId, state, idle time |
| SK-12 | Event subscribe | `on()` registers handler |
| SK-13 | Event unsubscribe | `off()` removes handler |
| SK-14 | Event dispatch | Handler receives event with correct data |
| SK-15 | Multiple handlers | All handlers invoked for same event |
| SK-16 | Handler exception isolation | One handler exception does not prevent other handlers |
| SK-17 | Input stream access | `getInputStream()` returns InputStream during session |
| SK-18 | Output stream access | `getOutputStream()` returns OutputStream during session |
| SK-19 | Start capture (web/mobile/desktop) | `startCapture()` begins audio flow |
| SK-20 | Stop capture (web/mobile/desktop) | `stopCapture()` stops audio flow |
| SK-21 | Play audio (web/mobile/desktop) | `playAudio()` enqueues chunk for playback |
| SK-22 | Stop playback (web/mobile/desktop) | `stopPlayback()` stops active playback |
| SK-23 | Audio API unsupported | WhatsApp/Phone/MCP client calls audio API, throws UNSUPPORTED_CLIENT_TYPE |
| SK-24 | All client types | ClientType enum includes all 6 variants |
| SK-25 | SDK events emitted | All events from TVR-VSDK-001 Section 11 emitted |
| SK-26 | Error is SDKError | All errors returned as SDKError, no runtime types leaked |
| SK-27 | Fatal error transitions | Fatal error transitions client to failed state |

### 11.3 Pass criteria

- 100% of test cases pass for each client type.
- Client type tests run the same suite with different clientType configuration.

---

## 12. Multilingual Testing

### 12.1 Requirements

The Voice Runtime SHALL pass tests verifying that multilingual configurations are accepted, propagated, and handled correctly through all components.

### 12.2 Test cases

| # | Test | Description |
|---|---|---|
| ML-01 | Language in SDK config | SDKConfiguration accepts BCP 47 language tag |
| ML-02 | Language in session | SessionOptions accepts language, propagated to Session Runtime |
| ML-03 | Language in STT | Language propagated to STT provider VoiceSession |
| ML-04 | Language in TTS | Language propagated to TTS provider SpeechRequest |
| ML-05 | Language in gateway request | Language included in ChatRequest metadata |
| ML-06 | English (en) | Full dialogue round-trip in English succeeds |
| ML-07 | Urdu (ur) | Full dialogue round-trip in Urdu succeeds (if STT/TTS support) |
| ML-08 | Code switching | Dialogue handles mixed-language input gracefully |
| ML-09 | Unsupported language | Unsupported language does not crash runtime; emits UNSUPPORTED_LANGUAGE error |
| ML-10 | Language change mid-session | Language changed between turns, correct provider config applied |

### 12.3 Pass criteria

- Tests use language-specific STT/TTS provider configurations.
- Unsupported language returns structured error (not a crash).
- At minimum, English is tested as the default language.

---

## 13. Interruption Testing

### 13.1 Requirements

The Voice Runtime SHALL pass tests verifying that interruptions at every layer are detected, propagated, and handled correctly.

### 13.2 Test cases

| # | Test | Description |
|---|---|---|
| IN-01 | Speech interruption during playback | User speaks during TTS playback, playback stops, listening begins |
| IN-02 | Speech interruption during thinking | User speaks while waiting for gateway, current turn cancelled |
| IN-03 | Multiple interruptions | User interrupts repeatedly within a single dialogue turn |
| IN-04 | Interruption during interruption | System handles nested interruption gracefully |
| IN-05 | Stream interruption | Transport disconnects during active stream, recovery initiated |
| IN-06 | Session interruption | Runtime error during active session, session recovery initiated |
| IN-07 | Gateway interruption | Gateway call interrupted by user speech, request aborted |
| IN-08 | Post-interruption resume | After interruption, dialogue resumes at correct state |
| IN-09 | Interruption events | All relevant interruption events emitted (TVR-EM-001 Section 5.8) |
| IN-10 | Interruption metrics | Interruption count and duration tracked in metrics |

### 13.3 Pass criteria

- 100% of test cases pass.
- Interruption detection latency within 200 ms of speech onset.
- Post-interruption state matches expected dialogue state.

---

## 14. Recovery Testing

### 14.1 Requirements

Every recovery mechanism across all runtimes SHALL be tested with real failure injection.

### 14.2 Test cases

| # | Test | Description |
|---|---|---|
| RC-01 | STT provider disconnect/reconnect | STT provider disconnects during recognition, Speech Runtime reconnects |
| RC-02 | TTS provider disconnect/reconnect | TTS provider disconnects during synthesis, Speech Runtime reconnects |
| RC-03 | Transport disconnect/reconnect | Transport disconnects during streaming, Streaming Runtime reconnects |
| RC-04 | Gateway timeout → retry | Gateway does not respond, Gateway Client retries |
| RC-05 | Gateway 503 → retry | Gateway returns SERVICE_UNAVAILABLE, Gateway Client retries |
| RC-06 | Session heartbeat loss → recovery | Heartbeats missed, Session Runtime initiates recovery |
| RC-07 | Session recovery success | Session returns to active after recovery |
| RC-08 | Session recovery failure | Session enters failed after recovery retries exhausted |
| RC-09 | Dialogue recovery after interruption | Dialogue resumes at correct turn after interruption resolves |
| RC-10 | Recovery events emitted | All TVR-EM-001 Section 5.12 recovery events emitted |
| RC-11 | Recovery metrics | Recovery attempt count, duration, and success/failure tracked |
| RC-12 | Multiple recovery cycles | Provider cycles through disconnect/reconnect 10 times without degradation |

### 14.3 Pass criteria

- 100% of test cases pass.
- Recovery tests inject real failures (not mock responses).
- Recovery time measured and verified against configured timeouts.

---

## 15. Long-running Session Testing

### 15.1 Requirements

Every runtime component SHALL pass a test that exercises it continuously for at least 60 minutes.

### 15.2 Test cases

| # | Test | Duration | Description |
|---|---|---|---|
| LR-01 | Speech Runtime stability | 60 min | Continuous listen/speak cycles, no resource growth |
| LR-02 | Streaming Runtime stability | 60 min | Continuous chunk flow, no buffer drift or memory growth |
| LR-03 | Session Runtime stability | 60 min | Session remains active, heartbeats steady, no state drift |
| LR-04 | Dialogue Runtime stability | 60 min | Continuous dialogue turns, no state corruption |
| LR-05 | Gateway Client stability | 60 min | Continuous gateway requests, no retry count drift |
| LR-06 | Full stack stability | 60 min | SDK → all runtimes → mock gateway, end-to-end |
| LR-07 | Memory snapshot comparison | 60 min | Heap snapshot at t=0 vs t=60 min, growth < 5% |
| LR-08 | Event emission stability | 60 min | Event emission rate stable, no event loss |

### 15.3 Pass criteria

- All tests run for full duration without crash, timeout, or unrecoverable error.
- Memory growth < 5% over 60 minutes.
- No monotonic increase in any counter beyond expected values.
- Event throughput within ±10% of initial measurement.

---

## 16. Load Testing

### 16.1 Requirements

The Voice Runtime SHALL pass tests that simulate realistic concurrent load.

### 16.2 Test cases

| # | Test | Load | Description |
|---|---|---|---|
| LD-01 | Concurrent sessions (low) | 10 sessions | All sessions created, active, and closed successfully |
| LD-02 | Concurrent sessions (medium) | 50 sessions | All sessions created, active, and closed successfully |
| LD-03 | Concurrent sessions (high) | 100 sessions | All sessions created, active, and closed successfully |
| LD-04 | Concurrent gateway requests | 50 req/s | Gateway Client handles concurrent request throughput |
| LD-05 | Concurrent streams | 100 streams | Streaming Runtime handles concurrent stream lifecycle |
| LD-06 | Mixed load | Varied | Combination of sessions, streams, and gateway requests |
| LD-07 | Load spike | 0 → 100 sessions in 1 s | Runtime handles sudden load increase without failure |

### 16.3 Pass criteria

- All sessions, streams, and requests complete successfully under load.
- No request timeout due to resource contention.
- CPU and memory within 2x of idle baseline at maximum load.
- No cascading failures (one component failure does not bring down others).

---

## 17. Stress Testing

### 17.1 Requirements

The Voice Runtime SHALL pass tests that push components beyond their configured limits.

### 17.2 Test cases

| # | Test | Description |
|---|---|---|
| ST-01 | Buffer saturation | Input producer rate exceeds consumer rate for extended period, overflow handled |
| ST-02 | Max sessions exceeded | Attempt to create session beyond maxSessions rejected gracefully |
| ST-03 | Rapid session create/close | 1000 sessions created and closed in rapid succession |
| ST-04 | Maximum chunk throughput | Chunks produced at maximum rate, no data loss |
| ST-05 | Maximum stream count | Streams created up to implementation limit, no failure |
| ST-06 | Rapid state transitions | Rapid start/pause/resume/stop cycles on a single stream |
| ST-07 | Maximum gateway retries | Gateway returns error repeatedly, client exhausts retries gracefully |
| ST-08 | Maximum dialogue clarifications | Dialogue enters infinite clarification loop, timeout terminates gracefully |

### 17.3 Pass criteria

- System does not crash under any stress condition.
- Resources are released correctly after stress ends.
- Error paths return structured errors (not thrown exceptions).
- System returns to idle baseline within 5 seconds after stress ends.

---

## 18. Memory Leak Testing

### 18.1 Requirements

Every runtime component SHALL pass tests that verify memory stability over repeated lifecycle operations.

### 18.2 Test cases

| # | Test | Iterations | Description |
|---|---|---|---|
| ML-01 | Provider create/dispose | 1000 | Provider created and disposed, heap compared |
| ML-02 | Speech Runtime init/dispose | 1000 | Full Speech Runtime lifecycle, heap compared |
| ML-03 | Streaming Runtime stream create/dispose | 1000 | Stream created and disposed, heap compared |
| ML-04 | Session create/close | 1000 | Session created and closed, heap compared |
| ML-05 | Dialogue turn cycle | 1000 | Full dialogue turn executed, heap compared |
| ML-06 | Gateway request cycle | 1000 | Request sent and response received, heap compared |
| ML-07 | SDK client create/dispose | 1000 | Client created and disposed, heap compared |
| ML-08 | Full stack cycle | 100 | SDK create → session → dialogue → speech → dispose, heap compared |
| ML-09 | Event subscriber leak | 1000 | Subscribe/unsubscribe cycle, listener count stable |
| ML-10 | Stream buffer leak | 1000 | Buffer fill/drain cycle, buffer capacity stable |

### 18.3 Pass criteria

- Heap snapshots before and after iterations show < 1% growth.
- No `Detached` or `Retained` objects identified in heap analysis.
- Event listener count returns to zero after unsubscribe.
- Tests run with `--expose-gc` and global `gc()` call before each snapshot.

---

## 19. Performance Benchmark Testing

### 19.1 Requirements

Every runtime component SHALL have benchmark tests that measure latency, throughput, and resource usage.

### 19.2 Benchmarks

| # | Benchmark | Component | Metric |
|---|---|---|---|
| PB-01 | Provider initialization | All providers | Time from `initialize()` to `start()` complete |
| PB-02 | STT recognition latency | STT provider | Time from audio input to final transcript |
| PB-03 | TTS synthesis latency | TTS provider | Time from text input to first audio chunk |
| PB-04 | Stream creation | Streaming Runtime | Time from `createStream()` to `connected` |
| PB-05 | Chunk throughput (input) | Streaming Runtime | Chunks/second sustained input |
| PB-06 | Chunk throughput (output) | Streaming Runtime | Chunks/second sustained output |
| PB-07 | Buffer drain time | Streaming Runtime | Time to drain full buffer |
| PB-08 | Session creation | Session Runtime | Time from `createSession()` to `active` |
| PB-09 | Session lookup | Session Runtime | Time for `getSession()` by ID |
| PB-10 | Dialogue turn (no gateway) | Dialogue Runtime | Turn time excluding gateway latency |
| PB-11 | Gateway round-trip | Gateway Client | Time from `send()` to response |
| PB-12 | SDK client creation | Voice SDK | Time from `createClient()` to `ready` |
| PB-13 | SDK session start | Voice SDK | Time from `startSession()` to session active |
| PB-14 | Event delivery latency | Event Model | Time from event emission to handler invocation |
| PB-15 | Recovery time | Recovery Manager | Time from interruption to recovered state |

### 19.3 Pass criteria

- Benchmarks produce repeatable results (±10% across 10 runs).
- Results are logged to a structured format for trend analysis.
- Benchmarks run in CI and results compared against previous run (regression detection).
- No benchmark exceeds 30 seconds wall-clock time.

---

## 20. Failure Injection Testing

### 20.1 Requirements

The Voice Runtime SHALL pass tests where failures are injected at every integration boundary to verify graceful degradation and structured error handling.

### 20.2 Test cases

| # | Failure Injected | Expected Behavior |
|---|---|---|
| FI-01 | Provider initialization fails | Component reports initialization failure, does not proceed to running state |
| FI-02 | Provider authentication fails | AUTHENTICATION_FAILED error, provider enters failed state |
| FI-03 | Provider timeout during operation | TIMEOUT error, operation retried or aborted per policy |
| FI-04 | STT provider returns garbage | RecognitionError emitted, dialogue handles gracefully |
| FI-05 | TTS provider returns empty stream | SynthesisFailure emitted, dialogue handles gracefully |
| FI-06 | Transport drops all packets | ConnectionLost detected, recovery initiated |
| FI-07 | Transport corrupts message ordering | ChunkGapDetected, recovery initiated |
| FI-08 | Gateway returns 500 for all requests | INTERNAL_ERROR, client retries and exhausts budget |
| FI-09 | Gateway never responds | Timeout, client retries and exhausts budget |
| FI-10 | Session heartbeats stop | HeartbeatTimeout, session recovery initiated |
| FI-11 | Audio device removed during capture | AudioDeviceError emitted, capture stopped |
| FI-12 | Microphone permission denied | AUDIO_CAPTURE_FAILED, SDK error surfaced |
| FI-13 | Network disconnected during stream | StreamInterrupted, recovery initiated |
| FI-14 | Power loss (simulated crash) | Runtime restarts without corruption |
| FI-15 | Clock skew detected | Timestamps handled gracefully, no crash |

### 20.3 Pass criteria

- Every failure injection produces a structured error (no unhandled exceptions).
- Every failure injection emits the corresponding error event.
- Recoverable failures result in successful recovery.
- Fatal failures leave the system in a known state (failed, not undefined).

---

## 21. Security Testing

### 21.1 Requirements

The Voice Runtime SHALL pass tests verifying authentication, authorization, credential handling, and data isolation.

### 21.2 Test cases

| # | Test | Description |
|---|---|---|
| STY-01 | API key validation | Invalid API key rejected at SDK client creation |
| STY-02 | API key forwarding | API key forwarded to Gateway Client in Authorization header |
| STY-03 | Credential isolation | Provider credentials not logged or exposed in events |
| STY-04 | Provider credential expiry | Expired provider credential detected and reported |
| STY-05 | Session isolation | Session A cannot access Session B's data or state |
| STY-06 | Conversation isolation | Conversation A metadata not visible in Conversation B events |
| STY-07 | Event data sanitization | Events do not contain credentials, tokens, or PII |
| STY-08 | Configuration sanitization | Configuration logs redact sensitive fields |
| STY-09 | Gateway request sanitization | ChatRequest metadata does not include credentials |
| STY-10 | Denial of service resilience | Rapid request flood does not crash runtime |

### 21.3 Pass criteria

- 100% of test cases pass.
- Credential redaction verified by scanning log output.
- Session isolation verified by creating two sessions with overlapping operations.

---

## 22. Compliance Testing

### 22.1 Requirements

Every runtime component SHALL have a compliance test suite that verifies it meets all requirements of its corresponding specification.

### 22.2 Test suites

| # | Suite | Specification | Applies To |
|---|---|---|---|
| CP-01 | Provider compliance | TVR-PIS-001 Section 13 | All provider implementations |
| CP-02 | Speech Runtime compliance | TVR-SRS-001 Section 12 | Speech Runtime |
| CP-03 | Streaming Runtime compliance | TVR-STRS-001 Section 12 | Streaming Runtime |
| CP-04 | Dialogue Runtime compliance | TVR-DRS-001 Section 12 | Dialogue Runtime |
| CP-05 | Session Runtime compliance | TVR-SESR-001 Section 13 | Session Runtime |
| CP-06 | Gateway Client compliance | TVR-GWC-001 Section 17 | Gateway Client |
| CP-07 | Voice SDK compliance | TVR-VSDK-001 Section 14 | Voice SDK |
| CP-08 | Event Model compliance | TVR-EM-001 Section 7 | All components |

### 22.3 Compliance criteria

Each compliance suite shall verify:

- All public interfaces are implemented (method count, signatures, return types).
- All required state machine states and transitions are present.
- All required events are emitted (verified by event listener).
- All required error codes are returned (verified by error injection).
- No unauthorized dependencies exist (verified by import analysis).

### 22.4 Pass criteria

- 100% of compliance tests pass for each component.
- Compliance tests are invariant under implementation refactoring (they test the contract, not the code).
- A compliance failure blocks release.

---

## 23. Acceptance Criteria

### 23.1 Per-suite pass criteria

| Test Suite | Minimum Pass Rate | Critical Failures Allowed | Blocking |
|---|---|---|---|
| Unit Tests | 100% | 0 | Yes |
| Integration Tests | 100% | 0 | Yes |
| Contract Tests | 100% | 0 | Yes |
| Provider Compliance | 100% | 0 | Yes |
| Gateway Client Tests | 100% | 0 | Yes |
| Dialogue Tests | 100% | 0 | Yes |
| Streaming Tests | 100% | 0 | Yes |
| Session Tests | 100% | 0 | Yes |
| Speech Tests | 100% | 0 | Yes |
| SDK Tests | 100% | 0 | Yes |
| Multilingual Tests | 100% | 0 | No (documented gaps OK) |
| Interruption Tests | 100% | 0 | Yes |
| Recovery Tests | 100% | 0 | Yes |
| Long-running Tests | 100% | 0 | Yes |
| Load Tests | 100% | 0 | No (degradation OK) |
| Stress Tests | 100% | 0 | Yes |
| Memory Leak Tests | 100% | 0 | Yes |
| Performance Benchmarks | — | — | No (regression alert) |
| Failure Injection Tests | 100% | 0 | Yes |
| Security Tests | 100% | 0 | Yes |
| Compliance Tests | 100% | 0 | Yes |

### 23.2 Release gating

A release is blocked if:

- Any suite with `Blocking: Yes` has a failure.
- Any suite with `Minimum Pass Rate: 100%` has a failure.
- Performance benchmarks show >20% regression without documented justification.
- Security tests reveal a vulnerability.

---

## 24. Versioning

This specification follows Semantic Versioning.

| Version Bump | Criteria |
|---|---|
| Major | Restructuring of test categories, removal of required test cases, changes to pass criteria that invalidate existing test suites |
| Minor | Addition of new test categories, addition of new test cases within existing categories, addition of new pass metrics |
| Patch | Correction of test descriptions, clarification of pass criteria, correction of cross-references to other specifications |

Test implementations shall declare the specification version they conform to.
