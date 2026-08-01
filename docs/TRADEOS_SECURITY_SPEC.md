# TradeOS Voice Runtime — Security Specification

Document ID: TVR-SEC-001
Title: TradeOS Voice Runtime Security Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_VOICE_CONFIGURATION_SPEC.md (TVR-VCS-001)
- TRADEOS_PROVIDER_INTERFACE_SPEC.md (TVR-PIS-001)
- TRADEOS_PROVIDER_COMPLIANCE_SPEC.md (TVR-PCS-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_DEPLOYMENT_SPEC.md (TVR-DPL-001)
- TRADEOS_OBSERVABILITY_SPEC.md (TVR-OBS-001)
- Frozen Voice Runtime Architecture
- Frozen Conversation Gateway Protocol (TCGP v1.0)

---

## 1. Purpose

This specification defines the **security requirements** for the TradeOS Voice Runtime. It covers how the runtime authenticates callers, authorizes actions, protects data in transit and at rest, manages secrets, isolates sessions, logs security events, and defends against the threats identified in the threat model.

The Voice Runtime is not an authentication provider — it relies on the application layer (Business Brain, Gateway) for user authentication. It is responsible for **internal security**: protecting its own interfaces, isolating sessions from each other, securing provider credentials, and ensuring audio data is handled safely.

---

## 2. Scope

| Domain | Sections | Owner |
|---|---|---|
| Authentication Model | 3 | Runtime engineering |
| Authorization Model | 4 | Runtime engineering |
| API Security | 5 | Runtime engineering |
| Transport Security | 6 | Platform engineering |
| Audio Data Security | 7 | Runtime engineering |
| Secrets & Credentials | 8 | Security engineering |
| Data Encryption | 9 | Platform engineering |
| Session Security | 10 | Runtime engineering |
| Audit Logging | 11 | Runtime engineering |
| Threat Model | 12 | Security engineering |
| Compliance Checklist | 13 | All |

---

## 3. Authentication Model

### 3.1 Assumptions

The Voice Runtime makes the following authentication assumptions:

| # | Assumption | Rationale |
|---|---|---|
| A-01 | Callers are authenticated by the **Business Brain** or **Conversation Gateway** before reaching the Voice Runtime | The runtime operates behind the Gateway — it does not receive unauthenticated requests |
| A-02 | The Voice SDK authenticates via API key to the Gateway, not to the runtime directly | SDK calls are proxied through the Gateway |
| A-03 | Provider credentials (STT, TTS, Transport) are pre-configured — the runtime authenticates to providers, not vice versa | Providers are downstream dependencies, not upstream callers |
| A-04 | No end-user identity is stored or managed by the runtime | User identity is the Gateway's concern |

### 3.2 Runtime-Internal Authentication

Within the runtime, components communicate via direct method calls (not HTTP). Internal authentication is **not required** — component boundaries are trust boundaries only if they cross process or network boundaries.

| Boundary | Auth Required | Mechanism |
|---|---|---|
| SDK → Gateway | Yes | API key (Bearer token) |
| Gateway → Runtime | Yes | Gateway passes `conversationId` + `correlationId` (trusted caller) |
| Runtime → Providers | Yes | Provider-specific auth (API key, OAuth, mTLS) |
| Runtime internal (in-process) | No | Same process, same trust domain |

### 3.3 Provider Authentication

Every provider SHALL authenticate to its backend service using the credentials resolved from `credentialsRef`:

```typescript
interface ProviderAuthentication {
  /** Credential reference key in the secrets manager */
  credentialsRef: string;

  /** Authentication method */
  method: "api_key" | "oauth2" | "mtls" | "custom";

  /** Credential lifetime (for rotation) */
  credentialLifetimeMs?: number;
}
```

| # | Rule |
|---|---|
| A-05 | Provider credentials SHALL NOT be stored in configuration — only `credentialsRef` |
| A-06 | Provider credentials SHALL be resolved at `initialize()` time, not before |
| A-07 | Provider credentials SHALL be held in memory only — never written to disk |
| A-08 | Failed authentication SHALL return `AUTHENTICATION_FAILED` error and emit `error.provider_auth` event |

---

## 4. Authorization Model

### 4.1 Assumptions

| # | Assumption | Rationale |
|---|---|---|
| Z-01 | Authorization is enforced by the **Gateway** and **Business Brain** — the runtime does not authorize user actions | The runtime processes what it receives |
| Z-02 | The runtime authorizes **provider usage** — a provider may be restricted to specific environments or sessions | Prevents accidental use of production providers in staging |
| Z-03 | The runtime enforces **session isolation** — one session SHALL NOT access another session's data | Critical for multi-tenant safety |

### 4.2 Provider Authorization

```typescript
interface ProviderAuthorization {
  /** Allowed environments for this provider */
  allowedEnvironments: ("development" | "staging" | "production")[];

  /** Allowed session types (if restricted) */
  allowedSessionTypes?: ("voice" | "streaming" | "batch")[];
}
```

| # | Rule |
|---|---|
| Z-04 | A provider with `allowedEnvironments` that does not include the current environment SHALL fail to initialize |
| Z-05 | If no `allowedEnvironments` is specified, the provider SHALL be allowed in all environments |

### 4.3 Session Isolation

| # | Rule |
|---|---|
| Z-06 | A session's audio data SHALL NOT be accessible from any other session |
| Z-07 | A session's events SHALL carry the session's `sessionId` for consumer-side filtering |
| Z-08 | A session's metrics SHALL be namespaced by `session_id` label |
| Z-09 | Session handles SHALL NOT be serializable or transferable between contexts |

---

## 5. API Security

### 5.1 Runtime API Endpoints

The Voice Runtime exposes the following API endpoints:

| Endpoint | Method | Auth Required | Rate Limited | Purpose |
|---|---|---|---|---|
| `/api/health` | GET | No | No | Health check |
| `/api/health/live` | GET | No | No | Liveness probe |
| `/api/health/ready` | GET | No | No | Readiness probe |
| `/api/conversation/chat` | POST | Yes (Gateway API key) | Yes | Chat request |
| `/api/conversation/chat/stream` | POST | Yes (Gateway API key) | Yes | Streaming chat |
| `/api/conversation/status` | GET | Yes (Gateway API key) | Yes | Gateway status/metrics |
| `/debug/diagnostics` | GET | Yes (admin auth) | Yes | Deep diagnostics |

### 5.2 API Key Authentication

The POST endpoints SHALL authenticate callers via Bearer token:

```
Authorization: Bearer <gateway-api-key>
```

| # | Rule |
|---|---|
| API-01 | API key SHALL be validated against the configured `GATEWAY_API_KEY` |
| API-02 | API key comparison SHALL use constant-time comparison |
| API-03 | Invalid API key SHALL return HTTP 401 with `{"error": "UNAUTHORIZED", "message": "Invalid API key"}` |
| API-04 | Missing Authorization header SHALL return HTTP 401 |
| API-05 | API key SHALL NOT appear in logs, error messages, or metrics |

### 5.3 Input Validation

| # | Rule |
|---|---|
| API-06 | Every request body SHALL be validated against a schema |
| API-07 | String fields SHALL be checked for maximum length |
| API-08 | Numeric fields SHALL be checked for range |
| API-09 | Unknown fields SHALL be rejected (no extra properties) |
| API-10 | Invalid input SHALL return HTTP 400 with field-level error details |

### 5.4 Rate Limiting

| # | Rule |
|---|---|
| API-11 | Rate limiting SHALL be applied per API key |
| API-12 | Rate limit exceeded SHALL return HTTP 429 with `Retry-After` header |
| API-13 | Rate limit window SHALL be 1 second |
| API-14 | Rate limit configuration SHALL be adjustable without deployment |

### 5.5 Security Headers

Every API response SHALL include:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Type: application/json
```

---

## 6. Transport Security

### 6.1 In-Transit Encryption

| Boundary | Protocol | Encryption | Minimum Version |
|---|---|---|---|
| Client → Gateway | HTTPS | TLS | TLS 1.2 |
| Gateway → Runtime | HTTPS (internal) | TLS | TLS 1.2 |
| Runtime → STT Provider | HTTPS/gRPC | TLS | TLS 1.2 |
| Runtime → TTS Provider | HTTPS/gRPC | TLS | TLS 1.2 |
| Runtime → Transport | WebSocket Secure (WSS) | TLS | TLS 1.2 |

| # | Rule |
|---|---|
| T-01 | All external communication SHALL use TLS 1.2 or higher |
| T-02 | TLS 1.0 and 1.1 SHALL NOT be accepted |
| T-03 | Certificates SHALL be valid, non-expired, and signed by a trusted CA |
| T-04 | Certificate hostname verification SHALL be enforced |
| T-05 | Self-signed certificates SHALL NOT be accepted in production |

### 6.2 Network Segmentation

| # | Rule |
|---|---|
| T-06 | The runtime SHALL NOT expose ports other than the configured HTTP port |
| T-07 | Provider connections SHALL be outbound-only — no inbound provider connections |
| T-08 | Database connections SHALL use private networking when available |
| T-09 | The runtime SHALL NOT accept connections from the public internet on debug endpoints |

---

## 7. Audio Data Security

### 7.1 Audio Classification

| Data Type | Classification | Handling Requirements |
|---|---|---|
| Audio input (user speech) | Sensitive | Encrypt in transit, do not persist, do not log |
| Audio output (TTS playback) | Sensitive | Encrypt in transit, do not persist, do not log |
| Transcripts (STT results) | Sensitive | Encrypt in transit, session-scoped retention |
| Provider audio (intermediate) | Sensitive | Never stored, process in memory only |

### 7.2 Audio Handling Rules

| # | Rule |
|---|---|
| AU-01 | Audio data SHALL NOT be written to disk by the runtime |
| AU-02 | Audio data SHALL NOT appear in logs, metrics, or error messages |
| AU-03 | Audio data SHALL be encrypted in transit between all components |
| AU-04 | Audio chunks SHALL be released from memory immediately after processing |
| AU-05 | Audio buffer SHALL be cleared on session end |
| AU-06 | Audio transcripts MAY be retained per session configuration but SHALL NOT exceed `maxMetadataSizeBytes` |
| AU-07 | Audio data SHALL NOT be sent to AI providers without explicit configuration |

### 7.3 Microphone Security

For SDK clients with microphone access (Web, Mobile, Desktop):

| # | Rule |
|---|---|
| AU-08 | Microphone access SHALL require explicit user consent (browser permission) |
| AU-09 | Microphone capture SHALL be visually indicated (browser indicator, in-app icon) |
| AU-10 | Microphone capture SHALL stop immediately on `stopListening()` or session end |
| AU-11 | The SDK SHALL NOT capture audio without an active session |

---

## 8. Secrets & Credentials Management

### 8.1 Secrets Inventory (Voice Runtime)

| Secret | Source | Used By | Classification |
|---|---|---|---|
| `GATEWAY_API_KEY` | Environment variable | Runtime authentication | Critical |
| STT provider API key | Secrets manager (via `credentialsRef`) | STT Provider | Critical |
| TTS provider API key | Secrets manager (via `credentialsRef`) | TTS Provider | Critical |
| Transport provider credentials | Secrets manager (via `credentialsRef`) | Transport Provider | Critical |
| `VOICE_CONFIG_JSON` | Environment variable (optional) | Runtime initialization | Sensitive |

### 8.2 Secrets Resolution

```typescript
interface SecretsManager {
  /** Resolve a credential by reference key */
  resolve(credentialsRef: string): Promise<Credential>;

  /** Store or update a credential */
  store(key: string, credential: Credential): Promise<void>;

  /** Revoke a credential */
  revoke(key: string): Promise<void>;
}

interface Credential {
  type: "api_key" | "oauth_token" | "certificate" | "username_password";
  value: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}
```

### 8.3 Secrets Compliance Rules

| # | Rule |
|---|---|
| SC-01 | Secrets SHALL NOT be hardcoded in source code |
| SC-02 | Secrets SHALL NOT be committed to version control |
| SC-03 | Secrets SHALL NOT appear in logs, error messages, stack traces, or metrics |
| SC-04 | Secrets SHALL be stored encrypted at rest in the secrets manager |
| SC-05 | Secrets SHALL be transmitted encrypted in transit |
| SC-06 | Secrets SHALL be resolved at initialization time, not at build time |
| SC-07 | Secrets SHALL be held in memory only — never swapped to disk |
| SC-08 | Secrets SHALL be zeroed after `dispose()` |
| SC-09 | Each environment SHALL use distinct credentials — no sharing between dev/staging/prod |
| SC-10 | Secrets SHALL be rotated within 24 hours of suspected exposure |
| SC-11 | Credential rotation SHALL NOT require a deployment — runtime SHALL hot-reload from secrets manager |

### 8.4 Credential Rotation

| Secret | Rotation Period | Rotation Mechanism |
|---|---|---|
| `GATEWAY_API_KEY` | Every 90 days | Update environment variable, restart |
| STT provider API key | Every 90 days | Update in secrets manager, hot-reload |
| TTS provider API key | Every 90 days | Update in secrets manager, hot-reload |
| Transport credentials | Every 90 days | Update in secrets manager, hot-reload |

---

## 9. Data Encryption

### 9.1 Encryption Matrix

| Data State | Encryption Standard | Key Management |
|---|---|---|
| In transit (external) | TLS 1.2+ | Managed by platform (Vercel, provider) |
| In transit (internal) | TLS 1.2+ or mTLS | Managed by runtime |
| At rest (database) | AES-256 | Managed by Supabase |
| At rest (logs) | AES-256 | Managed by log aggregator |
| At rest (backups) | AES-256 | Managed by backup service |
| In memory | No encryption (process-isolated) | N/A |

### 9.2 Encryption Compliance Rules

| # | Rule |
|---|---|
| EN-01 | All external communication SHALL use TLS 1.2+ |
| EN-02 | All provider communication SHALL use TLS 1.2+ |
| EN-03 | Audio data in transit SHALL be encrypted (TLS for HTTP, WSS for WebSocket) |
| EN-04 | The runtime SHALL NOT store encryption keys — keys are managed by the infrastructure layer |
| EN-05 | Session data in memory SHALL be cleared on session end |

---

## 10. Session Security

### 10.1 Session Isolation Model

```
Session A ─── SpeechRuntime ─── STT Provider
                  │
Session B ─── SpeechRuntime ─── STT Provider
```

- Each session is isolated within the runtime
- Sessions share provider instances but provider calls are tagged with session ID
- One session SHALL NOT access another session's audio buffers, transcripts, or state

### 10.2 Session Identifier Security

```typescript
interface SessionIdentifier {
  /** Session ID format: sess_{timestamp_ms}_{random_base36} */
  sessionId: string;

  /** Internal sequence number (monotonically increasing per runtime instance) */
  internalSequence: number;
}
```

| # | Rule |
|---|---|
| SS-01 | Session IDs SHALL NOT be predictable — they SHALL contain at least 8 characters of random entropy |
| SS-02 | Session IDs SHALL NOT encode user identity, organization, or any PII |
| SS-03 | Session IDs SHALL be unique across all runtime instances (timestamp + random) |
| SS-04 | Session handles SHALL be scoped to the creating SDK client — they SHALL NOT be transferable |

### 10.3 Session Lifecycle Security

| # | Rule |
|---|---|
| SS-05 | A session SHALL NOT be activatable without prior creation |
| SS-06 | A session SHALL NOT be resumed by a different SDK client instance |
| SS-07 | On session expiry, all audio buffers SHALL be cleared immediately |
| SS-08 | On session close, all in-memory session data SHALL be released |
| SS-09 | A disposed session SHALL reject all operations with `INVALID_STATE` |

### 10.4 Session Hijacking Prevention

| # | Rule |
|---|---|
| SS-10 | The SDK SHALL NOT expose raw session IDs to untrusted code |
| SS-11 | Session handles SHALL be opaque objects, not serializable strings |
| SS-12 | Gateway requests SHALL include the `sessionId` for server-side verification |
| SS-13 | The runtime SHALL verify that a session ID in a gateway response matches the active session |

---

## 11. Audit Logging

### 11.1 Security Events

Every security-relevant event SHALL be logged as a structured audit record:

| Event | Level | Trigger | Data |
|---|---|---|---|
| `security.authn.failed` | `warn` | Invalid API key | `{ clientIp }` |
| `security.authn.missing` | `info` | Missing Authorization header | `{ clientIp, path }` |
| `security.authz.denied` | `warn` | Provider environment restriction | `{ providerId, environment }` |
| `security.session.cross_access` | `error` | Session A tries to access Session B data | `{ sourceSessionId, targetSessionId }` |
| `security.secrets.resolved` | `info` | Credential resolved from secrets manager | `{ credentialsRef }` |
| `security.secrets.rotation` | `info` | Credential rotated | `{ credentialsRef }` |
| `security.rate_limit.exceeded` | `warn` | Rate limit hit | `{ clientIp, path }` |
| `security.config.invalid` | `warn` | Config validation failure | `{ field, value }` |
| `security.provider.auth_failed` | `error` | Provider auth failure | `{ providerId, method }` |
| `security.session.timeout` | `info` | Session expired | `{ sessionId, reason }` |

### 11.2 Audit Record Format

```typescript
interface SecurityAuditRecord {
  /** ISO 8601 UTC timestamp */
  timestamp: string;

  /** Security event name (from Section 11.1) */
  event: string;

  /** Severity level */
  level: "info" | "warn" | "error" | "critical";

  /** Correlation ID of the triggering operation */
  correlationId?: string;

  /** Session ID if applicable */
  sessionId?: string;

  /** Source IP address */
  clientIp?: string;

  /** Component that detected the event */
  component: string;

  /** Structured event data */
  data: Record<string, unknown>;

  /** Runtime instance ID */
  instanceId: string;

  /** Environment */
  environment: string;
}
```

### 11.3 Audit Compliance Rules

| # | Rule |
|---|---|
| AL-01 | Every security event from Section 11.1 SHALL produce an audit record |
| AL-02 | Audit records SHALL be immutable — no deletion or modification after creation |
| AL-03 | Audit records SHALL be retained for a minimum of 90 days |
| AL-04 | Audit records SHALL be accessible only to users with security audit permissions |
| AL-05 | Audit records SHALL NOT contain secrets, credentials, or audio data |
| AL-06 | Audit records SHALL NOT contain PII |
| AL-07 | The audit log SHALL be monitored for suspicious patterns (e.g., rapid auth failures) |

---

## 12. Threat Model

### 12.1 Methodology

This threat model uses **STRIDE** per component:

| Threat | Definition |
|---|---|
| **S**poofing | Impersonating a user, component, or provider |
| **T**ampering | Modifying data in transit or at rest |
| **R**epudiation | Denying an action due to insufficient audit |
| **I**nformation Disclosure | Exposing sensitive data to unauthorized parties |
| **D**enial of Service | Degrading or denying service |
| **E**levation of Privilege | Gaining unauthorized access or capabilities |

### 12.2 Threat Matrix

#### T1: SDK → Gateway Communication

| Threat | Risk | Mitigation |
|---|---|---|
| **S** API key theft (spoofing) | **Critical** — attacker impersonates SDK | API key stored securely, rotated quarterly, constant-time comparison |
| **T** Request tampering | **High** — attacker modifies request body | TLS in transit, Gateway validates request signature |
| **R** Missing audit trail | **Medium** — cannot prove who sent what | All requests logged with correlation ID |
| **I** API key in logs | **High** — credential leak | API key redacted from all log output |
| **D** Request flooding | **High** — service overloaded | Rate limiting per API key |
| **E** API key privilege escalation | **Medium** — key has broader scope than intended | Least-privilege API keys, scoped per channel |

#### T2: Runtime → Provider Communication

| Threat | Risk | Mitigation |
|---|---|---|
| **S** Provider impersonation | **Critical** — attacker MITM provider connection | TLS certificate verification, hostname validation |
| **T** Audio data tampering | **High** — attacker modifies audio stream | TLS in transit, chunk sequencing validation |
| **R** No provider audit | **Medium** — cannot prove what was sent | Provider requests logged with correlation ID and payload hash |
| **I** Audio data disclosure | **Critical** — attacker captures audio stream | TLS in transit, audio never persisted |
| **D** Provider API abuse | **Medium** — unlimited provider calls | Provider-level rate limiting per session |
| **E** Credential reuse | **Medium** — same credential across environments | Distinct credentials per environment |

#### T3: Runtime Internal (In-Process)

| Threat | Risk | Mitigation |
|---|---|---|
| **S** Component impersonation | **Low** — same process, same trust domain | N/A (in-process) |
| **T** Memory tampering | **Low** — requires process access | N/A (requires host compromise) |
| **R** Missing internal audit | **Low** — all cross-component calls generate events | Events carry producer/consumer metadata |
| **I** Session data cross-access | **High** — Session A reads Session B audio | Session isolation enforced by session scoping |
| **D** Component crash | **Medium** — single component fails | Isolated error handling, state recovery |
| **E** Buffer overflow | **Medium** — memory corruption | Bounded buffers, input validation |

#### T4: Provider Credential Storage

| Threat | Risk | Mitigation |
|---|---|---|
| **S** Credential theft from memory | **Critical** — attacker dumps process memory | Credentials held in typed arrays, zeroed after use |
| **T** Credential modification | **High** — attacker swaps credential | Secrets manager access control, audit logging |
| **R** No credential access audit | **Medium** — no record of who accessed what | Every credential resolution audited |
| **I** Credential in config file | **Critical** — config file leaked | `credentialsRef` pattern — no inline credentials |
| **D** Credential rotation failure | **Medium** — expired credential blocks provider | Hot-reload from secrets manager |
| **E** Credential scope too broad | **High** — key has more permissions than needed | Least-privilege provider keys |

#### T5: Health & Diagnostics Endpoints

| Threat | Risk | Mitigation |
|---|---|---|
| **S** Unauthenticated diagnostics access | **High** — attacker learns internal state | Diagnostics require admin auth in production |
| **I** Diagnostics leak configuration | **Medium** — attacker learns provider config | Secrets redacted from diagnostics output |
| **D** Health check DoS | **Low** — health check is lightweight | Rate limiting on health endpoints |
| **E** Health endpoint triggers side effects | **Low** — health checks are read-only | Health check SHALL NOT trigger mutations |

### 12.3 Threat Mitigation Summary

| Threat ID | Risk | Mitigated By | Verification |
|---|---|---|---|
| T1-S | Critical | API key security (SC-01 through SC-11) | Secrets audit |
| T1-T | High | TLS 1.2+ (T-01 through T-05) | TLS config review |
| T1-D | High | Rate limiting (API-11 through API-14) | Load test |
| T2-S | Critical | TLS certificate verification (T-03) | Integration test |
| T2-I | Critical | TLS + no persistence (AU-01, AU-02) | Code review |
| T3-I | High | Session isolation (Z-06 through Z-09) | Integration test |
| T4-S | Critical | Memory zeroing (SC-08) | Security audit |
| T4-I | Critical | credentialsRef pattern (SC-01) | Config audit |
| T5-S | High | Admin auth on diagnostics (API-01) | Integration test |

---

## 13. Compliance Checklist

### 13.1 Authentication & Authorization

| # | Requirement | Status | Verified By |
|---|---|---|---|
| AUTH-01 | API key authentication on all POST endpoints | | Integration test |
| AUTH-02 | Constant-time API key comparison | | Code review |
| AUTH-03 | Invalid key returns HTTP 401 | | Integration test |
| AUTH-04 | Provider credentials use `credentialsRef` pattern | | Config audit |
| AUTH-05 | Provider environment restriction enforced | | Integration test |
| AUTH-06 | Session isolation enforced | | Integration test |

### 13.2 API Security

| # | Requirement | Status | Verified By |
|---|---|---|---|
| API-01 | Input validation on all request bodies | | Integration test |
| API-02 | Rate limiting per API key | | Load test |
| API-03 | Security headers on all responses | | Integration test |
| API-04 | Unknown fields rejected | | Integration test |
| API-05 | CORS restricted to known origins | | Config audit |

### 13.3 Transport Security

| # | Requirement | Status | Verified By |
|---|---|---|---|
| TLS-01 | TLS 1.2+ on all external communication | | Network audit |
| TLS-02 | Valid certificates in production | | Certificate check |
| TLS-03 | TLS 1.0/1.1 disabled | | Network audit |
| TLS-04 | No public debug endpoints | | Network audit |

### 13.4 Audio Security

| # | Requirement | Status | Verified By |
|---|---|---|---|
| AUD-01 | Audio not written to disk | | Code review |
| AUD-02 | Audio not in logs or metrics | | Code review |
| AUD-03 | Audio encrypted in transit | | Network audit |
| AUD-04 | Audio buffers cleared on session end | | Integration test |
| AUD-05 | Microphone requires user consent | | SDK test |

### 13.5 Secrets Management

| # | Requirement | Status | Verified By |
|---|---|---|---|
| SEC-01 | No hardcoded secrets in source | | Code scan |
| SEC-02 | No secrets in logs | | Log audit |
| SEC-03 | Secrets encrypted at rest | | Config audit |
| SEC-04 | Secrets resolved at init time | | Integration test |
| SEC-05 | Secrets zeroed after dispose | | Security audit |
| SEC-06 | Distinct credentials per environment | | Config audit |
| SEC-07 | Credential rotation capability | | Integration test |

### 13.6 Encryption

| # | Requirement | Status | Verified By |
|---|---|---|---|
| ENC-01 | TLS 1.2+ on all boundaries | | Network audit |
| ENC-02 | Session memory cleared on end | | Integration test |

### 13.7 Session Security

| # | Requirement | Status | Verified By |
|---|---|---|---|
| SES-01 | Session IDs not predictable | | Code review |
| SES-02 | Session IDs not encode PII | | Code review |
| SES-03 | Session not resumable by different client | | Integration test |
| SES-04 | Session buffers cleared on expiry | | Integration test |

### 13.8 Audit Logging

| # | Requirement | Status | Verified By |
|---|---|---|---|
| AUDIT-01 | All security events logged | | Integration test |
| AUDIT-02 | Audit records immutable | | Integration test |
| AUDIT-03 | Audit records retained 90 days | | Config audit |
| AUDIT-04 | No secrets in audit records | | Log audit |
| AUDIT-05 | No PII in audit records | | Log audit |

### 13.9 Threat Model Coverage

| # | Threat | Mitigated | Verified By |
|---|---|---|---|
| TM-01 | T1-S: API key spoofing | | Security test |
| TM-02 | T1-T: Request tampering | | Security test |
| TM-03 | T1-D: Request flooding | | Load test |
| TM-04 | T2-S: Provider impersonation | | Security test |
| TM-05 | T2-I: Audio disclosure | | Security test |
| TM-06 | T3-I: Session cross-access | | Integration test |
| TM-07 | T4-S: Credential theft | | Security audit |
| TM-08 | T4-I: Credential in config | | Config audit |
| TM-09 | T5-S: Unauthenticated diagnostics | | Integration test |

### 13.10 Release Gating

| Suite | Min Pass Rate | Critical Failures | Blocks Release |
|---|---|---|---|
| Authentication | 100% | Any | Yes |
| API Security | 100% | Any | Yes |
| Transport Security | 100% | Any | Yes |
| Audio Security | 100% | Any | Yes |
| Secrets Management | 100% | Any | Yes |
| Session Security | 100% | Any | Yes |
| Audit Logging | 100% | 0 | Yes |
| Threat Model Coverage | 100% | Any | Yes |

---

## 14. Security Incident Response

### 14.1 Severity Levels

| Level | Definition | Response Time | Escalation |
|---|---|---|---|
| **SEV-1** | Credential leak, session data exposure, provider compromise | 15 min | Security Lead, CTO |
| **SEV-2** | Rate limiting bypass, authentication bypass, audit failure | 1 hour | Security Lead, Dev Lead |
| **SEV-3** | Input validation gap, missing security header, slow rotation | 4 hours | Dev Lead |
| **SEV-4** | Minor — logging improvement, documentation gap | Next sprint | Team |

### 14.2 Voice Runtime-Specific Runbooks

#### SEV-1: Provider Credential Leak

```
1. DETECT: Alert from secrets manager or external notification
2. CONTAIN: Revoke compromised credential immediately
3. ROTATE: Issue new credential and update secrets manager
4. VERIFY: Run provider compliance suite with new credential
5. AUDIT: Review access logs for unauthorized usage
6. DOCUMENT: Post-mortem within 24 hours
7. ROTATE ALL: Rotate all other provider credentials as precaution
```

#### SEV-1: Session Data Cross-Access

```
1. DETECT: Alert from session isolation monitor
2. CONTAIN: Identify affected sessions and isolate runtime instance
3. ANALYZE: Determine scope of exposure
4. NOTIFY: Inform affected users/organizations
5. PATCH: Fix isolation gap
6. VERIFY: Run session isolation compliance tests
7. DOCUMENT: Post-mortem within 24 hours
```

#### SEV-2: Authentication Bypass

```
1. DETECT: Unexpected 200 on unauthenticated request
2. CONTAIN: Enable additional auth enforcement
3. ANALYZE: Review access logs for exploitation
4. PATCH: Fix authentication gap
5. VERIFY: Run authentication compliance tests
6. DOCUMENT: Post-mortem within 48 hours
```

---

## 15. Compliance Requirements

### 15.1 Implementation Compliance

| # | Requirement | Verification |
|---|---|---|
| SEC-01 | API key authentication on all protected endpoints | Integration test |
| SEC-02 | Rate limiting on all POST endpoints | Load test |
| SEC-03 | TLS 1.2+ on all external communication | Network audit |
| SEC-04 | Secrets use `credentialsRef` pattern | Config audit |
| SEC-05 | Audio data never written to disk | Code review |
| SEC-06 | Session isolation enforced | Integration test |
| SEC-07 | Security events logged per Section 11 | Integration test |
| SEC-08 | All STRIDE threats mitigated per Section 12 | Security test |
| SEC-09 | Security headers on all responses | Integration test |
| SEC-10 | Input validation on all request bodies | Integration test |
| SEC-11 | Diagnostics endpoint protected in production | Integration test |
| SEC-12 | Secrets zeroed on dispose | Security audit |

### 15.2 Security Compliance for Providers

Every provider implementation SHALL:

| # | Requirement |
|---|---|
| P-SEC-01 | Authenticate using credentials from `credentialsRef` — no hardcoded keys |
| P-SEC-02 | Use TLS 1.2+ for all provider communication |
| P-SEC-03 | Never log credentials, API keys, or auth tokens |
| P-SEC-04 | Never persist audio data to disk |
| P-SEC-05 | Clear audio buffers after processing |
| P-SEC-06 | Reject requests from uninitialized/disposed state |

---

## 16. Appendix A — Security Headers Reference

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer header |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` | Restrict API access |
| `Content-Type` | `application/json` | JSON responses |
| `Cache-Control` | `no-store` (for API responses) | Prevent caching of sensitive data |

---

## 17. Appendix B — Session ID Format

```
sess_{timestamp_ms}_{random_base36}
```

- `timestamp_ms`: Unix timestamp in milliseconds (13 digits)
- `random_base36`: 8-character random alphanumeric (base36), generated using a cryptographically secure RNG

Example: `sess_1722345600000_k8mF2xR7`

Total entropy: 48 bits (8 characters × 6 bits per base36 character). Sufficient to prevent ID guessing within a reasonable time window.

---

## 18. Appendix C — Constant-Time Comparison Reference

```typescript
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Always compare lengths to prevent timing oracle, but return false
    // Use a constant-time comparison even for different lengths
    const result = crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

---

## 19. Appendix D — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. Authentication model, authorization model, API security, transport security, audio security, secrets management, data encryption, session security, audit logging, STRIDE threat model (5 threat surfaces, 10 prioritized mitigations), compliance checklist (50 items across 8 categories), incident response runbooks. |
