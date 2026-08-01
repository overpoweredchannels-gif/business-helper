# TradeOS Voice Runtime — Performance Benchmark Specification

Document ID: TVR-PB-001
Title: TradeOS Voice Runtime Performance Benchmark Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_RUNTIME_TESTING_SPEC.md (TVR-TS-001)
- TRADEOS_OBSERVABILITY_SPEC.md (TVR-OBS-001)
- TRADEOS_PROVIDER_COMPLIANCE_SPEC.md (TVR-PCS-001)
- TRADEOS_SPEECH_RUNTIME_SPEC.md (TVR-SRS-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DIALOGUE_RUNTIME_SPEC.md (TVR-DRS-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_VOICE_SDK_SPEC.md (TVR-VSDK-001)
- TRADEOS_VOICE_CONFIGURATION_SPEC.md (TVR-VCS-001)

---

## 1. Purpose

This specification defines the **benchmark methodology** for the entire Voice Runtime — how every component is measured, under what conditions, with what instrumentation, and against what thresholds. Benchmarks serve three purposes:

1. **Regression detection** — Every code change is measured against the previous run. Any degradation triggers investigation.
2. **Capacity planning** — Benchmark results inform resource allocation and scaling decisions.
3. **SLA validation** — Benchmarks verify that the runtime meets latency, throughput, and reliability targets.

This specification covers benchmark scenarios, measurement methodology, instrumentation, acceptance thresholds, and reporting format. It does not cover correctness testing (covered by TVR-TS-001).

---

## 2. Scope

| Domain | Sections | Metrics |
|---|---|---|
| Methodology | 3, 4 | Measurement principles, environment setup |
| Speech Benchmarks | 5 | Recognition latency, synthesis latency, VAD performance |
| Streaming Benchmarks | 6 | Chunk throughput, buffer drain, latency, jitter |
| Gateway Benchmarks | 7 | Round-trip time, retry overhead, stream event throughput |
| SDK Benchmarks | 8 | Client creation, session start, event delivery |
| Session Benchmarks | 9 | Creation, lookup, recovery |
| Dialogue Benchmarks | 10 | Turn time, thinking time, confirmation overhead |
| Provider Benchmarks | 11 | Init, STT, TTS, transport latency |
| Scalability Benchmarks | 12 | Concurrent sessions, concurrent streams, mixed load |
| Long-Running Benchmarks | 13 | 60-minute stability, memory growth, throughput stability |
| Resource Usage | 14 | CPU, memory, heap, event loop, network |
| Acceptance Thresholds | 15 | Per-benchmark pass/fail criteria |
| Reporting Format | 16 | Structured output schema |

---

## 3. Benchmark Methodology

### 3.1 Principles

| # | Principle | Rationale |
|---|---|---|
| P-01 | **Deterministic** — Every benchmark SHALL produce repeatable results within ±10% across 10 consecutive runs | Non-deterministic benchmarks are useless for regression detection |
| P-02 | **Isolated** — Each benchmark SHALL measure exactly one component | No cross-component interference in measurements |
| P-03 | **Instrumented** — Every benchmark SHALL collect the full set of metrics defined in Section 14 | No blind spots |
| P-04 | **Automated** — Every benchmark SHALL run in CI without manual intervention | Regression detection requires every-commit coverage |
| P-05 | **Compared** — Every benchmark SHALL compare results against the previous run and against absolute thresholds | Both relative and absolute regression detection |
| P-06 | **Fast** — No benchmark SHALL exceed 60 seconds wall-clock time (except long-running benchmarks) | CI pipeline must complete in reasonable time |
| P-07 | **Realistic** — Benchmarks SHALL use realistic data sizes, concurrency levels, and payload patterns | Synthetic microbenchmarks alone are insufficient |

### 3.2 Benchmark Types

| Type | Duration | Runs | Purpose | CI Cadence |
|---|---|---|---|---|
| Quick | < 5 s | 10 | Per-commit regression detection | Every commit |
| Standard | < 60 s | 5 | Per-release validation | Every staging deploy |
| Extended | < 10 min | 3 | Deep performance analysis | Nightly |
| Long-running | 60 min | 1 | Stability + memory leak | Nightly |

### 3.3 Measurement Methodology

#### Latency Percentiles

Every latency measurement SHALL report:

- **p50** (median) — typical latency
- **p95** — worst-case latency excluding outliers
- **p99** — worst-case latency
- **Min** — best case
- **Max** — worst observed
- **Mean** — average
- **StdDev** — variation

Percentiles SHALL be computed from at least 100 samples.

#### Throughput

Throughput SHALL be measured as:

- **Operations per second** (ops/s) — sustained rate over the benchmark duration
- **Peak ops/s** — maximum observed in any 1-second window
- **Data throughput** (bytes/s, chunks/s, messages/s)

#### Resource Usage

Resource usage SHALL be measured as:

- **Baseline** — resource usage at idle (no load)
- **Under load** — resource usage during benchmark
- **Delta** — (under load) - (baseline)

### 3.4 Warmup

Every benchmark SHALL include a warmup phase:

| Type | Warmup Duration | Warmup Load | Measurement Window |
|---|---|---|---|
| Quick | 1 s | Full load | After warmup, 3 s window |
| Standard | 3 s | Full load | After warmup, 30 s window |
| Extended | 10 s | Full load | After warmup, 5 min window |
| Long-running | 60 s | Full load | After warmup, 59 min window |

Warmup data SHALL NOT be included in measurement results.

### 3.5 Statistical Significance

| # | Rule |
|---|---|
| S-01 | Every benchmark SHALL report the number of samples collected |
| S-02 | Benchmarks with fewer than 100 latency samples SHALL NOT report percentiles |
| S-03 | Benchmarks SHALL discard the first and last 10% of samples (ramp-up/ramp-down exclusion) |
| S-04 | Outliers SHALL be identified (values > 3× IQR from the median) and reported separately |

---

## 4. Benchmark Environment

### 4.1 Reference Hardware

All benchmarks SHALL specify the target environment. Results SHALL NOT be compared across different environments.

#### Development

| Resource | Specification |
|---|---|
| CPU | Apple M1 / Intel i7-12700 (or equivalent) |
| Cores | 8+ |
| RAM | 16 GB+ |
| Disk | SSD, 500 GB+ |
| OS | macOS 14+ / Ubuntu 22.04+ |
| Node.js | 20 LTS |

#### CI (GitHub Actions)

| Resource | Specification |
|---|---|
| Runner | ubuntu-latest (GitHub-hosted) |
| CPU | 2 vCPU (x86_64) |
| RAM | 7 GB |
| Disk | 14 GB SSD |
| Node.js | 20 LTS |

#### Production Equivalent

| Resource | Specification |
|---|---|
| CPU | 4 vCPU (ARM64, AWS Graviton or equivalent) |
| RAM | 8 GB |
| Disk | 100 GB SSD (GP3) |
| Network | 10 Gbps |
| Node.js | 20 LTS (or compatible) |

### 4.2 Environment Variables

| Variable | Development | CI | Production Ref |
|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` |
| `BENCHMARK_MODE` | `true` | `true` | `true` |
| `BENCHMARK_WARMUP_SEC` | `1` | `1` | `3` |
| `BENCHMARK_DURATION_SEC` | `5` | `10` | `30` |
| `BENCHMARK_OUTPUT` | `./bench-results/` | `./bench-results/` | `./bench-results/` |

### 4.3 Mock Providers

All benchmarks SHALL use mock provider implementations:

- **Mock STT**: Returns configurable fake transcripts with configurable latency (default: 50 ms)
- **Mock TTS**: Returns configurable fake audio chunks with configurable latency (default: 30 ms)
- **Mock Transport**: Echoes messages with configurable latency (default: 10 ms)

Mock provider latency SHALL be set to 0 ms for component-level benchmarks (measuring only the runtime overhead) and to realistic values for end-to-end benchmarks.

### 4.4 Environment Compliance Rules

| # | Rule |
|---|---|
| E-01 | Every benchmark report SHALL include the full environment specification |
| E-02 | Results from different environments SHALL NOT be compared |
| E-03 | CI benchmarks SHALL run on dedicated runners (no shared CI load) |
| E-04 | Long-running benchmarks SHALL run on production-equivalent hardware |

---

## 5. Speech Benchmarks

### 5.1 Speech Runtime Initialization

| Field | Value |
|---|---|
| **ID** | SPB-01 |
| **Type** | Standard |
| **Component** | Speech Runtime |

**Setup:**
```typescript
const runtime = createSpeechRuntime();
const config = getDefaultSpeechRuntimeConfiguration();
```

**Measurement:**
Time from `initialize(config)` call to `start()` promise resolution.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 50 ms | 50–100 ms | > 100 ms |
| p95 | < 100 ms | 100–200 ms | > 200 ms |
| p99 | < 200 ms | 200–500 ms | > 500 ms |

---

### 5.2 STT Recognition Latency

| Field | Value |
|---|---|
| **ID** | SPB-02 |
| **Type** | Standard |
| **Component** | Speech Runtime → STT Provider (mock) |

**Setup:**
- Audio: 3-second synthetic mono audio at 16 kHz, PCM S16LE
- Mock STT latency: 0 ms (runtime overhead only)

**Measurement:**
Time from `writeAudio(lastChunk)` to `FinalTranscriptReceived` event.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 20 ms | 20–50 ms | > 50 ms |
| p95 | < 50 ms | 50–100 ms | > 100 ms |
| p99 | < 100 ms | 100–200 ms | > 200 ms |

---

### 5.3 TTS Synthesis Latency

| Field | Value |
|---|---|
| **ID** | SPB-03 |
| **Type** | Standard |
| **Component** | Speech Runtime → TTS Provider (mock) |

**Setup:**
- Text: 200-character sentence
- Mock TTS latency: 0 ms (runtime overhead only)

**Measurement:**
Time from `speak(request)` call to first `AudioChunk` received.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 15 ms | 15–40 ms | > 40 ms |
| p95 | < 40 ms | 40–80 ms | > 80 ms |
| p99 | < 80 ms | 80–150 ms | > 150 ms |

---

### 5.4 VAD Detection Latency

| Field | Value |
|---|---|
| **ID** | SPB-04 |
| **Type** | Quick |
| **Component** | Voice Activity Detection Module |

**Setup:**
- Input: 100 ms audio chunks with known speech/silence boundaries
- VAD mode: `moderate`

**Measurement:**
Time from `processAudio(chunk)` call to `VadResult` resolution.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 5 ms | 5–10 ms | > 10 ms |
| p95 | < 10 ms | 10–20 ms | > 20 ms |

---

### 5.5 Full Listen → Recognize Cycle

| Field | Value |
|---|---|
| **ID** | SPB-05 |
| **Type** | Standard |
| **Component** | Speech Runtime (full cycle) |

**Setup:**
- Audio: 3-second synthetic speech
- Mock STT latency: 50 ms (realistic)

**Measurement:**
Time from `startListening()` to `FinalTranscriptReceived` event (includes capture, VAD, recognition).

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 100 ms | 100–200 ms | > 200 ms |
| p95 | < 200 ms | 200–400 ms | > 400 ms |
| p99 | < 500 ms | 500–1000 ms | > 1000 ms |

---

## 6. Streaming Benchmarks

### 6.1 Stream Creation

| Field | Value |
|---|---|
| **ID** | STB-01 |
| **Type** | Quick |
| **Component** | Streaming Runtime |

**Setup:**
```typescript
const runtime = createStreamingRuntime();
await runtime.initialize(config);
```

**Measurement:**
Time from `runtime.createStream(config)` to stream state = `connected`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 10 ms | 10–25 ms | > 25 ms |
| p95 | < 25 ms | 25–50 ms | > 50 ms |
| p99 | < 50 ms | 50–100 ms | > 100 ms |

---

### 6.2 Input Chunk Throughput

| Field | Value |
|---|---|
| **ID** | STB-02 |
| **Type** | Standard |
| **Component** | Streaming Runtime (input) |

**Setup:**
- Chunk size: 4096 bytes (default)
- Number of chunks: 10,000
- Mock transport latency: 0 ms

**Measurement:**
Sustained chunks/second through `InputStream.write()`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Sustained throughput | > 10,000 chunks/s | 5,000–10,000 chunks/s | < 5,000 chunks/s |
| Peak throughput | > 20,000 chunks/s | 10,000–20,000 chunks/s | < 10,000 chunks/s |
| Data throughput | > 40 MB/s | 20–40 MB/s | < 20 MB/s |
| Drop rate | 0% | < 0.1% | > 0.1% |

---

### 6.3 Output Chunk Throughput

| Field | Value |
|---|---|
| **ID** | STB-03 |
| **Type** | Standard |
| **Component** | Streaming Runtime (output) |

**Setup:**
- Chunk size: 4096 bytes (default)
- Number of chunks: 10,000
- Mock transport latency: 0 ms

**Measurement:**
Sustained chunks/second through `OutputStream.onChunk()`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Sustained throughput | > 10,000 chunks/s | 5,000–10,000 chunks/s | < 5,000 chunks/s |
| Data throughput | > 40 MB/s | 20–40 MB/s | < 20 MB/s |

---

### 6.4 Buffer Drain Time

| Field | Value |
|---|---|
| **ID** | STB-04 |
| **Type** | Standard |
| **Component** | Streaming Runtime (buffer) |

**Setup:**
- Fill buffer to 90% occupancy with 4096-byte chunks
- Consumer rate: unlimited (drain as fast as possible)

**Measurement:**
Time to drain buffer from 90% to 10% occupancy.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Drain time (256 KB buffer) | < 50 ms | 50–100 ms | > 100 ms |
| Drain time (1 MB buffer) | < 200 ms | 200–500 ms | > 500 ms |

---

### 6.5 Streaming Latency (One-Way)

| Field | Value |
|---|---|
| **ID** | STB-05 |
| **Type** | Standard |
| **Component** | Streaming Runtime |

**Setup:**
- Chunk size: 4096 bytes
- Mock transport latency: 10 ms (realistic)
- 1000 chunks sent

**Measurement:**
Time from chunk entering `InputStream.write()` to chunk emerging from `OutputStream.onChunk()`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 15 ms | 15–30 ms | > 30 ms |
| p95 | < 25 ms | 25–50 ms | > 50 ms |
| p99 | < 50 ms | 50–100 ms | > 100 ms |
| Jitter (p95 - p50) | < 10 ms | 10–25 ms | > 25 ms |

---

### 6.6 Stream Recovery Time

| Field | Value |
|---|---|
| **ID** | STB-06 |
| **Type** | Standard |
| **Component** | Streaming Runtime (recovery) |

**Setup:**
- Active stream with bidirectional chunk flow
- Simulate transport drop at t=0

**Measurement:**
Time from transport drop detection to stream state = `connected` with resumption.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 200 ms | 200–500 ms | > 500 ms |
| p95 | < 500 ms | 500–1000 ms | > 1000 ms |
| p99 | < 1000 ms | 1000–2000 ms | > 2000 ms |

---

## 7. Gateway Benchmarks

### 7.1 Gateway Round-Trip Time

| Field | Value |
|---|---|
| **ID** | GWB-01 |
| **Type** | Standard |
| **Component** | Gateway Client |

**Setup:**
- Mock Gateway with configurable response latency (default: 20 ms simulated processing)
- 1000 requests sent sequentially

**Measurement:**
Time from `gatewayClient.send(request)` to response callback.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 30 ms | 30–60 ms | > 60 ms |
| p95 | < 50 ms | 50–100 ms | > 100 ms |
| p99 | < 100 ms | 100–200 ms | > 200 ms |

---

### 7.2 Gateway Request Throughput

| Field | Value |
|---|---|
| **ID** | GWB-02 |
| **Type** | Standard |
| **Component** | Gateway Client |

**Setup:**
- Mock Gateway with 20 ms processing latency
- 100 concurrent requests
- 1000 total requests

**Measurement:**
Sustained requests/second.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Sustained throughput | > 500 req/s | 200–500 req/s | < 200 req/s |
| Success rate | 100% | > 99% | < 99% |

---

### 7.3 Retry Overhead

| Field | Value |
|---|---|
| **ID** | GWB-03 |
| **Type** | Standard |
| **Component** | Gateway Client (retry) |

**Setup:**
- Mock Gateway returns 503 on first 2 attempts, succeeds on 3rd
- Retry policy: 3 max attempts, 100 ms base delay, 500 ms max delay

**Measurement:**
Time from first send to successful response, compared to baseline (no retry).

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Retry overhead (vs baseline) | < 2× baseline | 2–3× baseline | > 3× baseline |
| p99 with retries | < 500 ms | 500–1000 ms | > 1000 ms |

---

### 7.4 Gateway Stream Event Throughput

| Field | Value |
|---|---|
| **ID** | GWB-04 |
| **Type** | Standard |
| **Component** | Gateway Client (streaming) |

**Setup:**
- Mock Gateway streaming: 100 events per request
- 100 concurrent stream requests

**Measurement:**
Sustained stream events/second.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Event throughput | > 1000 events/s | 500–1000 events/s | < 500 events/s |
| Per-request throughput | > 10 req/s | 5–10 req/s | < 5 req/s |

---

## 8. SDK Benchmarks

### 8.1 SDK Client Creation

| Field | Value |
|---|---|
| **ID** | SKB-01 |
| **Type** | Quick |
| **Component** | Voice SDK |

**Setup:**
```typescript
const sdk = createVoiceSDK();
```

**Measurement:**
Time from `sdk.createClient(config)` to client state = `ready`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 20 ms | 20–50 ms | > 50 ms |
| p95 | < 50 ms | 50–100 ms | > 100 ms |

---

### 8.2 SDK Session Start

| Field | Value |
|---|---|
| **ID** | SKB-02 |
| **Type** | Standard |
| **Component** | Voice SDK |

**Setup:**
- Client already initialized and connected
- All internal runtimes initialized

**Measurement:**
Time from `client.startSession()` to session handle returned.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 30 ms | 30–75 ms | > 75 ms |
| p95 | < 75 ms | 75–150 ms | > 150 ms |
| p99 | < 150 ms | 150–300 ms | > 300 ms |

---

### 8.3 SDK Event Delivery Latency

| Field | Value |
|---|---|
| **ID** | SKB-03 |
| **Type** | Standard |
| **Component** | Voice SDK (events) |

**Setup:**
- Event handler registered on client
- 1000 events fired from internal runtime

**Measurement:**
Time from internal event emission to SDK event handler invocation.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 5 ms | 5–15 ms | > 15 ms |
| p95 | < 15 ms | 15–30 ms | > 30 ms |
| p99 | < 30 ms | 30–60 ms | > 60 ms |

---

### 8.4 SDK End-to-End Latency

| Field | Value |
|---|---|
| **ID** | SKB-04 |
| **Type** | Extended |
| **Component** | Voice SDK (full stack) |

**Setup:**
- Full SDK stack initialized
- Mock STT: 50 ms, Mock TTS: 30 ms, Mock Transport: 10 ms, Mock Gateway: 20 ms
- 100 dialogue turns

**Measurement:**
Time from `client.startSession()` to `session:ended` event for a complete interaction (1 turn: listen → gateway → speak).

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 per turn | < 200 ms | 200–400 ms | > 400 ms |
| p95 per turn | < 400 ms | 400–800 ms | > 800 ms |
| p99 per turn | < 800 ms | 800–1500 ms | > 1500 ms |

---

## 9. Session Benchmarks

### 9.1 Session Creation

| Field | Value |
|---|---|
| **ID** | SEB-01 |
| **Type** | Quick |
| **Component** | Session Runtime |

**Setup:**
```typescript
const runtime = createSessionRuntime();
await runtime.initialize(config);
```

**Measurement:**
Time from `runtime.createSession(options)` to session state = `active`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 10 ms | 10–25 ms | > 25 ms |
| p95 | < 25 ms | 25–50 ms | > 50 ms |
| p99 | < 50 ms | 50–100 ms | > 100 ms |

---

### 9.2 Session Lookup

| Field | Value |
|---|---|
| **ID** | SEB-02 |
| **Type** | Quick |
| **Component** | Session Runtime |

**Setup:**
- 1000 sessions created in the runtime
- Session IDs stored in array

**Measurement:**
Time from `runtime.getSession(sessionId)` to session handle returned.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 1 ms | 1–3 ms | > 3 ms |
| p95 | < 3 ms | 3–5 ms | > 5 ms |
| p99 | < 5 ms | 5–10 ms | > 10 ms |

---

### 9.3 Session Recovery

| Field | Value |
|---|---|
| **ID** | SEB-03 |
| **Type** | Standard |
| **Component** | Session Runtime (recovery) |

**Setup:**
- Active session with known state
- Simulate session interruption (network loss)

**Measurement:**
Time from recovery trigger to session state = `active`.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 100 ms | 100–250 ms | > 250 ms |
| p95 | < 250 ms | 250–500 ms | > 500 ms |
| p99 | < 500 ms | 500–1000 ms | > 1000 ms |

---

## 10. Dialogue Benchmarks

### 10.1 Dialogue Turn Time (No Gateway)

| Field | Value |
|---|---|
| **ID** | DB-01 |
| **Type** | Standard |
| **Component** | Dialogue Runtime |

**Setup:**
- Mock Speech Runtime (instant recognition/synthesis)
- No gateway call (turn completes locally)

**Measurement:**
Time from dialogue receiving transcript to turn completion.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 10 ms | 10–25 ms | > 25 ms |
| p95 | < 25 ms | 25–50 ms | > 50 ms |
| p99 | < 50 ms | 50–100 ms | > 100 ms |

---

### 10.2 Dialogue Thinking Time (With Gateway)

| Field | Value |
|---|---|
| **ID** | DB-02 |
| **Type** | Standard |
| **Component** | Dialogue Runtime + Gateway Client |

**Setup:**
- Mock Gateway: 20 ms simulated processing
- Transcript delivered to dialogue

**Measurement:**
Time from transcript received to gateway response delivered to dialogue.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 30 ms | 30–60 ms | > 60 ms |
| p95 | < 60 ms | 60–120 ms | > 120 ms |
| p99 | < 120 ms | 120–250 ms | > 250 ms |

---

### 10.3 Confirmation Overhead

| Field | Value |
|---|---|
| **ID** | DB-03 |
| **Type** | Standard |
| **Component** | Dialogue Runtime |

**Setup:**
- Low-confidence transcript triggers confirmation flow
- User confirms

**Measurement:**
Additional time added to turn when confirmation is required vs. normal turn.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Confirmation overhead | < 20 ms | 20–50 ms | > 50 ms |

---

## 11. Provider Benchmarks

### 11.1 Provider Initialization

| Field | Value |
|---|---|
| **ID** | PRB-01 |
| **Type** | Quick |
| **Component** | Provider (all types) |

**Setup:**
```typescript
const provider = createMockProvider();
```

**Measurement:**
Time from `initialize(config)` to `start()` promise resolution.

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| p50 | < 5 ms | 5–15 ms | > 15 ms |
| p95 | < 15 ms | 15–30 ms | > 30 ms |

---

### 11.2 Provider Operation Latency (Overhead Only)

| Field | Value |
|---|---|
| **ID** | PRB-02 |
| **Type** | Standard |
| **Component** | STT / TTS / Transport Provider |

**Setup:**
- Mock provider with 0 ms simulated latency
- 1000 operations per provider type

**Measurement:**
Time spent in runtime overhead per provider operation (excluding external latency).

**Thresholds - STT:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| `writeAudio()` overhead | < 1 ms | 1–3 ms | > 3 ms |
| `stopRecognition()` overhead | < 2 ms | 2–5 ms | > 5 ms |

**Thresholds - TTS:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| `synthesize()` overhead | < 2 ms | 2–5 ms | > 5 ms |
| First chunk latency | < 2 ms | 2–5 ms | > 5 ms |

**Thresholds - Transport:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| `send()` overhead | < 1 ms | 1–3 ms | > 3 ms |
| `connect()` overhead | < 5 ms | 5–15 ms | > 15 ms |

---

## 12. Scalability Benchmarks

### 12.1 Concurrent Session Scalability

| Field | Value |
|---|---|
| **ID** | SCB-01 |
| **Type** | Extended |

**Setup:**
- Load levels: 10, 50, 100, 200 concurrent sessions
- Each session: create → active → idle → close cycle
- All sessions start within 1-second window

**Measurement:**
- Session creation success rate per load level
- Average session creation time per load level
- CPU and memory at each load level

**Thresholds:**
| Load Level | Min Success Rate | Max Create Time (p95) | Max Memory Delta |
|---|---|---|---|
| 10 sessions | 100% | < 50 ms | < 50 MB |
| 50 sessions | 100% | < 100 ms | < 200 MB |
| 100 sessions | 100% | < 200 ms | < 400 MB |
| 200 sessions | > 99% | < 500 ms | < 800 MB |

---

### 12.2 Concurrent Stream Scalability

| Field | Value |
|---|---|
| **ID** | SCB-02 |
| **Type** | Extended |

**Setup:**
- Load levels: 10, 50, 100 concurrent streams
- Each stream: create → stream 1000 chunks → close
- Chunk size: 4096 bytes

**Measurement:**
- Stream creation time per load level
- Chunk throughput per stream vs. total
- CPU and memory per load level

**Thresholds:**
| Load Level | Min Success Rate | Throughput per Stream | Max Memory Delta |
|---|---|---|---|
| 10 streams | 100% | > 80% of single-stream | < 100 MB |
| 50 streams | 100% | > 70% of single-stream | < 400 MB |
| 100 streams | 100% | > 50% of single-stream | < 800 MB |

---

### 12.3 Concurrent Gateway Request Scalability

| Field | Value |
|---|---|
| **ID** | SCB-03 |
| **Type** | Extended |

**Setup:**
- Mock Gateway: 20 ms processing latency
- Load levels: 50, 100, 200, 500 concurrent requests
- 1000 total requests per load level

**Measurement:**
- Throughput (req/s) per load level
- Success rate per load level
- p95 latency per load level

**Thresholds:**
| Load Level | Min Throughput | Max p95 Latency | Min Success Rate |
|---|---|---|---|
| 50 req/s | > 50 req/s | < 100 ms | 100% |
| 100 req/s | > 100 req/s | < 150 ms | 100% |
| 200 req/s | > 200 req/s | < 250 ms | 100% |
| 500 req/s | > 500 req/s | < 500 ms | > 99% |

---

### 12.4 Mixed Load Scalability

| Field | Value |
|---|---|
| **ID** | SCB-04 |
| **Type** | Extended |

**Setup:**
- 50 concurrent sessions
- 30 concurrent streams
- 100 concurrent gateway requests
- All running simultaneously

**Measurement:**
- All metrics from individual scalability benchmarks
- Cross-component interference (does streaming degrade gateway?)

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Session success rate | 100% | > 99% | < 99% |
| Stream throughput degradation | < 20% | 20–40% | > 40% |
| Gateway throughput degradation | < 20% | 20–40% | > 40% |
| Memory | < 1 GB | 1–2 GB | > 2 GB |
| CPU | < 80% | 80–95% | > 95% |

---

### 12.5 Load Spike

| Field | Value |
|---|---|
| **ID** | SCB-05 |
| **Type** | Standard |

**Setup:**
- Idle runtime
- 100 sessions created simultaneously within 1 second
- All sessions immediately start streaming

**Measurement:**
- Spike absorption time (time for all 100 sessions to reach active state)
- Error rate during spike
- Recovery time (time for metrics to return to baseline after spike)

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Spike absorption | < 2 s | 2–5 s | > 5 s |
| Error rate during spike | 0% | < 1% | > 1% |
| Recovery time | < 5 s | 5–10 s | > 10 s |

---

## 13. Long-Running Benchmarks

### 13.1 60-Minute Stability (All Components)

| Field | Value |
|---|---|
| **ID** | LRB-01 through LRB-08 |
| **Type** | Long-running |

Per the test definitions in TVR-TS-001 Section 15:

| ID | Test | Duration | Load |
|---|---|---|---|
| LRB-01 | Speech Runtime stability | 60 min | Listen/speak cycle every 10 s |
| LRB-02 | Streaming Runtime stability | 60 min | 100 chunks/s continuous flow |
| LRB-03 | Session Runtime stability | 60 min | Session active, heartbeat every 5 s |
| LRB-04 | Dialogue Runtime stability | 60 min | Turn every 15 s |
| LRB-05 | Gateway Client stability | 60 min | Request every 5 s |
| LRB-06 | Full stack stability | 60 min | SDK → all runtimes → mock gateway |
| LRB-07 | Memory snapshot comparison | 60 min | Heap at t=0 vs t=60 |
| LRB-08 | Event emission stability | 60 min | Events monitored for rate stability |

**Measurement:**
- State correctness at t=0, t=30, t=60
- Memory (heap used) at t=0, t=30, t=60
- Throughput at t=0, t=30, t=60 (must remain within ±10%)
- Error count (cumulative, expected = 0)
- Event rate (events/min, must remain within ±10%)

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Runtime crash | 0 | 0 | 1 |
| Unrecoverable error | 0 | 0 | 1 |
| Memory growth (t=0 → t=60) | < 5% | 5–10% | > 10% |
| Throughput drift | < 5% | 5–10% | > 10% |
| Event rate drift | < 5% | 5–10% | > 10% |
| State corruption | 0 | 0 | 1 |

---

### 13.2 Memory Leak Detection (1000 Cycles)

| Field | Value |
|---|---|
| **ID** | LRB-09 through LRB-18 |
| **Type** | Extended |

Per TVR-TS-001 Section 18:

| ID | Test | Iterations |
|---|---|---|
| LRB-09 | Provider create/dispose | 1000 |
| LRB-10 | Speech Runtime init/dispose | 1000 |
| LRB-11 | Stream create/dispose | 1000 |
| LRB-12 | Session create/close | 1000 |
| LRB-13 | Dialogue turn cycle | 1000 |
| LRB-14 | Gateway request cycle | 1000 |
| LRB-15 | SDK client create/dispose | 1000 |
| LRB-16 | Full stack cycle | 100 |
| LRB-17 | Event subscriber leak | 1000 |
| LRB-18 | Stream buffer leak | 1000 |

**Setup:**
- Run with `--expose-gc` flag
- Call `global.gc()` before each heap snapshot
- Take heap snapshot before first iteration and after last iteration

**Thresholds:**
| Metric | Target | Warning | Critical |
|---|---|---|---|
| Heap growth (before → after) | < 1% | 1–3% | > 3% |
| Detached objects | 0 | 0 | > 0 |
| Retained objects (unreachable) | 0 | 0 | > 0 |
| Event listener count (after unsubscribe) | 0 | 0 | > 0 |

---

## 14. Resource Usage Measurement

### 14.1 Measured Resources

Every benchmark SHALL measure and report:

| Resource | Unit | Collection Method | Granularity |
|---|---|---|---|
| CPU (user) | % | `process.cpuUsage().user` | Per-second |
| CPU (system) | % | `process.cpuUsage().system` | Per-second |
| Memory (heap used) | MB | `process.memoryUsage().heapUsed` | Per-second |
| Memory (heap total) | MB | `process.memoryUsage().heapTotal` | Per-second |
| Memory (RSS) | MB | `process.memoryUsage().rss` | Per-second |
| Memory (external) | MB | `process.memoryUsage().external` | Per-second |
| Event loop lag | ms | `setTimeout` delta | Per-second |
| Active handles | count | `process._getActiveHandles()` | Per-second |
| Active requests | count | `process._getActiveRequests()` | Per-second |

### 14.2 Resource Sampling

```typescript
interface ResourceSnapshot {
  timestamp: string;          // ISO 8601 UTC
  cpuUser: number;            // microseconds
  cpuSystem: number;          // microseconds
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  eventLoopLagMs: number;
  activeHandles: number;
  activeRequests: number;
}
```

| # | Rule |
|---|---|
| R-01 | Resource snapshots SHALL be collected every second during the benchmark |
| R-02 | Snapshots SHALL include the wall-clock timestamp for alignment with latency measurements |
| R-03 | Snapshots SHALL NOT be collected during warmup |
| R-04 | The benchmark report SHALL include min, max, mean, and p95 for each resource metric |

### 14.3 Resource Baseline

Every benchmark SHALL establish a resource baseline:

1. Run the benchmark environment at idle for 5 seconds
2. Collect resource snapshots every second
3. Compute baseline mean and p95 for each resource
4. Report delta: (under load) - (baseline) for each resource

---

## 15. Acceptance Thresholds

### 15.1 Threshold Classification

| Classification | Definition | Action |
|---|---|---|
| **Target** | Expected performance for a healthy system | Green in dashboard |
| **Warning** | Degraded but acceptable — investigate | Yellow in dashboard, alert |
| **Critical** | Unacceptable — must fix before release | Red in dashboard, blocks release |

### 15.2 Consolidated Threshold Table

| ID | Benchmark | Target | Warning | Critical |
|---|---|---|---|---|
| SPB-01 | Speech Runtime init (p50) | < 50 ms | 50–100 ms | > 100 ms |
| SPB-02 | STT recognition (p50) | < 20 ms | 20–50 ms | > 50 ms |
| SPB-03 | TTS synthesis (p50) | < 15 ms | 15–40 ms | > 40 ms |
| SPB-04 | VAD detection (p50) | < 5 ms | 5–10 ms | > 10 ms |
| SPB-05 | Full listen→recognize (p50) | < 100 ms | 100–200 ms | > 200 ms |
| STB-01 | Stream creation (p50) | < 10 ms | 10–25 ms | > 25 ms |
| STB-02 | Input throughput | > 10 K chunks/s | 5–10 K | < 5 K |
| STB-03 | Output throughput | > 10 K chunks/s | 5–10 K | < 5 K |
| STB-04 | Buffer drain (256 KB) | < 50 ms | 50–100 ms | > 100 ms |
| STB-05 | Streaming latency (p50) | < 15 ms | 15–30 ms | > 30 ms |
| STB-06 | Stream recovery (p50) | < 200 ms | 200–500 ms | > 500 ms |
| GWB-01 | Gateway RTT (p50) | < 30 ms | 30–60 ms | > 60 ms |
| GWB-02 | Gateway throughput | > 500 req/s | 200–500 | < 200 |
| GWB-03 | Retry overhead | < 2× baseline | 2–3× | > 3× |
| GWB-04 | Stream event throughput | > 1000 evt/s | 500–1000 | < 500 |
| SKB-01 | SDK client creation (p50) | < 20 ms | 20–50 ms | > 50 ms |
| SKB-02 | SDK session start (p50) | < 30 ms | 30–75 ms | > 75 ms |
| SKB-03 | SDK event delivery (p50) | < 5 ms | 5–15 ms | > 15 ms |
| SKB-04 | SDK E2E per turn (p50) | < 200 ms | 200–400 ms | > 400 ms |
| SEB-01 | Session creation (p50) | < 10 ms | 10–25 ms | > 25 ms |
| SEB-02 | Session lookup (p50) | < 1 ms | 1–3 ms | > 3 ms |
| SEB-03 | Session recovery (p50) | < 100 ms | 100–250 ms | > 250 ms |
| DB-01 | Dialogue turn (p50) | < 10 ms | 10–25 ms | > 25 ms |
| DB-02 | Dialogue thinking (p50) | < 30 ms | 30–60 ms | > 60 ms |
| DB-03 | Confirmation overhead | < 20 ms | 20–50 ms | > 50 ms |
| PRB-01 | Provider init (p50) | < 5 ms | 5–15 ms | > 15 ms |
| PRB-02a | STT writeAudio overhead | < 1 ms | 1–3 ms | > 3 ms |
| PRB-02b | TTS synthesize overhead | < 2 ms | 2–5 ms | > 5 ms |
| PRB-02c | Transport send overhead | < 1 ms | 1–3 ms | > 3 ms |
| SCB-01 | 100 sessions success rate | 100% | > 99% | < 99% |
| SCB-02 | 100 streams per-stream throughput | > 50% of single | 30–50% | < 30% |
| SCB-03 | 500 req/s gateway throughput | > 500 req/s | 400–500 | < 400 |
| SCB-04 | Mixed load memory | < 1 GB | 1–2 GB | > 2 GB |
| SCB-05 | Load spike absorption | < 2 s | 2–5 s | > 5 s |
| LRB-01/08 | 60-min memory growth | < 5% | 5–10% | > 10% |
| LRB-09/18 | 1000-cycle heap growth | < 1% | 1–3% | > 3% |

### 15.3 Regression Detection

| # | Rule |
|---|---|
| T-01 | A regression is detected when a benchmark result exceeds the **Warning** threshold compared to the baseline run |
| T-02 | A regression is confirmed when the same result exceeds Warning in 3 consecutive CI runs |
| T-03 | A **Critical** result in any benchmark blocks the release |
| T-04 | Baseline is the median of the last 10 successful CI benchmark runs on the `main` branch |
| T-05 | Baseline is recalculated after every `main` branch merge |

---

## 16. Reporting Format

### 16.1 BenchmarkResult

```typescript
interface BenchmarkResult {
  /** Benchmark identifier */
  id: string;

  /** Benchmark name */
  name: string;

  /** Component under test */
  component: string;

  /** Benchmark type */
  type: "quick" | "standard" | "extended" | "long-running";

  /** Timestamp of the run */
  timestamp: string;

  /** Run duration (wall-clock, including warmup) */
  durationMs: number;

  /** Environment specification */
  environment: {
    platform: string;
    cpu: string;
    cores: number;
    ramGb: number;
    nodeVersion: string;
    ci: boolean;
  };

  /** Configuration used for the benchmark */
  configuration: Record<string, unknown>;

  /** Latency measurements */
  latency?: {
    samples: number;
    minMs: number;
    maxMs: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    stdDevMs: number;
    outliers: number;
  };

  /** Throughput measurements */
  throughput?: {
    sustained: number;
    unit: string;
    peak?: number;
    total: number;
  };

  /** Resource usage */
  resources?: {
    baseline: ResourceMetrics;
    underLoad: ResourceMetrics;
    delta: ResourceMetrics;
  };

  /** Success/failure counts */
  counts?: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
  };

  /** Pass/fail status per threshold */
  status: "pass" | "warning" | "fail";

  /** Comparison with baseline */
  vsBaseline?: {
    baselineRun: string;
    delta: number; // percent change
    deltaUnit: string;
    regression: boolean;
  };

  /** Errors encountered during benchmark */
  errors?: Array<{
    timestamp: string;
    message: string;
  }>;
}

interface ResourceMetrics {
  cpuUserPercent: number;
  cpuSystemPercent: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  eventLoopLagMs: number;
  activeHandles: number;
}
```

### 16.2 BenchmarkSuiteReport

```typescript
interface BenchmarkSuiteReport {
  /** Suite identifier */
  suiteId: string;

  /** Suite name */
  suiteName: string;

  /** Timestamp */
  timestamp: string;

  /** Overall status */
  status: "pass" | "warning" | "fail";

  /** All benchmark results in this suite */
  benchmarks: BenchmarkResult[];

  /** Summary */
  summary: {
    total: number;
    passed: number;
    warning: number;
    failed: number;
    passRate: number;
  };

  /** Git context */
  git: {
    commit: string;
    branch: string;
    tag?: string;
    message: string;
  };
}
```

### 16.3 Output

| # | Rule |
|---|---|
| RPT-01 | Every benchmark SHALL produce a JSON file conforming to `BenchmarkResult` |
| RPT-02 | Every benchmark suite SHALL produce a JSON file conforming to `BenchmarkSuiteReport` |
| RPT-03 | Reports SHALL be written to `BENCHMARK_OUTPUT/{suite_id}/{timestamp}.json` |
| RPT-04 | Reports SHALL be retained for 90 days |
| RPT-05 | CI SHALL compare results against the baseline and fail on regression |

### 16.4 Example Report

```json
{
  "id": "GWB-01",
  "name": "Gateway Round-Trip Time",
  "component": "gateway_client",
  "type": "standard",
  "timestamp": "2026-07-30T12:00:00.000Z",
  "durationMs": 5230,
  "environment": {
    "platform": "linux",
    "cpu": "AMD EPYC 7763",
    "cores": 2,
    "ramGb": 7,
    "nodeVersion": "20.15.0",
    "ci": true
  },
  "configuration": {
    "mockGatewayLatencyMs": 20,
    "requestCount": 1000,
    "concurrency": 1
  },
  "latency": {
    "samples": 1000,
    "minMs": 12,
    "maxMs": 89,
    "meanMs": 22.3,
    "p50Ms": 21,
    "p95Ms": 35,
    "p99Ms": 52,
    "stdDevMs": 7.1,
    "outliers": 2
  },
  "throughput": {
    "sustained": 191,
    "unit": "req/s",
    "total": 1000
  },
  "resources": {
    "baseline": { "heapUsedMb": 45, "cpuUserPercent": 0.5 },
    "underLoad": { "heapUsedMb": 62, "cpuUserPercent": 12.3 },
    "delta": { "heapUsedMb": 17, "cpuUserPercent": 11.8 }
  },
  "counts": {
    "total": 1000,
    "succeeded": 1000,
    "failed": 0,
    "successRate": 1.0
  },
  "status": "pass",
  "vsBaseline": {
    "baselineRun": "2026-07-29T12:00:00.000Z",
    "delta": 2.1,
    "deltaUnit": "percent",
    "regression": false
  }
}
```

---

## 17. Benchmark Automation

### 17.1 CI Integration

| # | Rule |
|---|---|
| CI-01 | Quick benchmarks SHALL run on every push to any branch |
| CI-02 | Standard benchmarks SHALL run on every push to `staging` and `main` |
| CI-03 | Extended benchmarks SHALL run nightly |
| CI-04 | Long-running benchmarks SHALL run weekly |
| CI-05 | All benchmarks SHALL use the CI benchmark suite runner |
| CI-06 | CI SHALL fail if any benchmark returns `fail` status |

### 17.2 Benchmark Runner

```typescript
interface BenchmarkRunner {
  /** Run a single benchmark by ID */
  run(id: string): Promise<BenchmarkResult>;

  /** Run a suite of benchmarks */
  runSuite(suiteId: string): Promise<BenchmarkSuiteReport>;

  /** Compare result against baseline */
  compare(result: BenchmarkResult): ComparisonResult;

  /** Store result in the benchmark database */
  store(result: BenchmarkResult): Promise<void>;
}
```

---

## 18. Compliance Requirements

### 18.1 Implementation Compliance

| # | Requirement | Verification |
|---|---|---|
| PB-01 | All benchmarks from Sections 5–13 exist | Contract test |
| PB-02 | Every benchmark produces a `BenchmarkResult` | Integration test |
| PB-03 | Every benchmark includes environment specification | Integration test |
| PB-04 | Every benchmark includes resource measurements | Integration test |
| PB-05 | Benchmarks use mock providers (Section 4.3) | Code review |
| PB-06 | Benchmarks include warmup phase | Code review |
| PB-07 | Benchmarks report percentiles from >= 100 samples | Code review |
| PB-08 | CI runs quick benchmarks on every commit | CI config audit |
| PB-09 | Results compared against baseline | CI config audit |
| PB-10 | Critical threshold blocks release | CI config audit |

### 18.2 Release Gating

| Suite | Min Pass Rate | Critical Failures | Blocks Release |
|---|---|---|---|
| Quick benchmarks | 100% | Any | Yes |
| Standard benchmarks | 100% | Any | Yes |
| Extended benchmarks | 100% | Any | Yes |
| Long-running benchmarks | 100% | 0 | Yes |
| Resource usage | 100% | > 2× baseline | Yes |

### 18.3 Continuous Benchmarking

| # | Rule |
|---|---|
| CB-01 | A benchmark dashboard SHALL display the last 30 days of results |
| CB-02 | A regression alert SHALL fire when any benchmark exceeds Warning for 3 consecutive runs |
| CB-03 | A benchmark report SHALL be generated and published after every `main` branch merge |
| CB-04 | Benchmark results SHALL be accessible via API for external tooling |

---

## 19. Appendix A — Benchmark Test IDs

| ID | Section | Name |
|---|---|---|
| SPB-01 | 5.1 | Speech Runtime Initialization |
| SPB-02 | 5.2 | STT Recognition Latency |
| SPB-03 | 5.3 | TTS Synthesis Latency |
| SPB-04 | 5.4 | VAD Detection Latency |
| SPB-05 | 5.5 | Full Listen → Recognize Cycle |
| STB-01 | 6.1 | Stream Creation |
| STB-02 | 6.2 | Input Chunk Throughput |
| STB-03 | 6.3 | Output Chunk Throughput |
| STB-04 | 6.4 | Buffer Drain Time |
| STB-05 | 6.5 | Streaming Latency (One-Way) |
| STB-06 | 6.6 | Stream Recovery Time |
| GWB-01 | 7.1 | Gateway Round-Trip Time |
| GWB-02 | 7.2 | Gateway Request Throughput |
| GWB-03 | 7.3 | Retry Overhead |
| GWB-04 | 7.4 | Gateway Stream Event Throughput |
| SKB-01 | 8.1 | SDK Client Creation |
| SKB-02 | 8.2 | SDK Session Start |
| SKB-03 | 8.3 | SDK Event Delivery Latency |
| SKB-04 | 8.4 | SDK End-to-End Latency |
| SEB-01 | 9.1 | Session Creation |
| SEB-02 | 9.2 | Session Lookup |
| SEB-03 | 9.3 | Session Recovery |
| DB-01 | 10.1 | Dialogue Turn Time (No Gateway) |
| DB-02 | 10.2 | Dialogue Thinking Time (With Gateway) |
| DB-03 | 10.3 | Confirmation Overhead |
| PRB-01 | 11.1 | Provider Initialization |
| PRB-02 | 11.2 | Provider Operation Latency |
| SCB-01 | 12.1 | Concurrent Session Scalability |
| SCB-02 | 12.2 | Concurrent Stream Scalability |
| SCB-03 | 12.3 | Concurrent Gateway Request Scalability |
| SCB-04 | 12.4 | Mixed Load Scalability |
| SCB-05 | 12.5 | Load Spike |
| LRB-01 | 13.1 | Speech 60-min Stability |
| LRB-02 | 13.1 | Streaming 60-min Stability |
| LRB-03 | 13.1 | Session 60-min Stability |
| LRB-04 | 13.1 | Dialogue 60-min Stability |
| LRB-05 | 13.1 | Gateway 60-min Stability |
| LRB-06 | 13.1 | Full Stack 60-min Stability |
| LRB-07 | 13.1 | Memory Snapshot Comparison |
| LRB-08 | 13.1 | Event Emission Stability |
| LRB-09 | 13.2 | Provider Create/Dispose (1000x) |
| LRB-10 | 13.2 | Speech Init/Dispose (1000x) |
| LRB-11 | 13.2 | Stream Create/Dispose (1000x) |
| LRB-12 | 13.2 | Session Create/Close (1000x) |
| LRB-13 | 13.2 | Dialogue Turn Cycle (1000x) |
| LRB-14 | 13.2 | Gateway Request Cycle (1000x) |
| LRB-15 | 13.2 | SDK Client Create/Dispose (1000x) |
| LRB-16 | 13.2 | Full Stack Cycle (100x) |
| LRB-17 | 13.2 | Event Subscriber Leak |
| LRB-18 | 13.2 | Stream Buffer Leak |

---

## 20. Appendix B — Benchmark Script Template

```typescript
import { BenchmarkRunner, BenchmarkResult } from "./runner";

async function benchmarkGatewayRtt(runner: BenchmarkRunner): Promise<BenchmarkResult> {
  // 1. Setup
  const gateway = createMockGateway({ processingLatencyMs: 20 });
  const client = createGatewayClient();
  await client.initialize(getDefaultConfig());

  // 2. Warmup
  await runner.warmup(async () => {
    for (let i = 0; i < 100; i++) {
      await client.send(createRequest());
    }
  });

  // 3. Measure
  const result = await runner.measure(
    "GWB-01",
    "Gateway Round-Trip Time",
    async () => {
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        await client.send(createRequest());
        const end = performance.now();
        runner.recordLatency(end - start);
      }
    },
    { samples: 1000 }
  );

  // 4. Teardown
  await client.dispose();
  await gateway.stop();

  return result;
}
```

---

## 21. Appendix C — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. 47 benchmarks across 9 component areas, 3-tier threshold system, extended reporting format, CI automation requirements. |
