# TradeOS Voice Runtime — Deployment Specification

Document ID: TVR-DPL-001
Title: TradeOS Voice Runtime Deployment Specification
Status: Implementation Specification
Version: 1.0.0

## Dependencies

- TRADEOS_OBSERVABILITY_SPEC.md (TVR-OBS-001)
- TRADEOS_VOICE_CONFIGURATION_SPEC.md (TVR-VCS-001)
- TRADEOS_GATEWAY_CLIENT_SPEC.md (TVR-GWC-001)
- TRADEOS_SESSION_RUNTIME_SPEC.md (TVR-SESR-001)
- TRADEOS_STREAMING_RUNTIME_SPEC.md (TVR-STRS-001)
- TRADEOS_RUNTIME_EVENT_MODEL.md (TVR-EM-001)
- Frozen Voice Runtime Architecture
- Frozen Conversation Gateway Protocol (TCGP v1.0)

---

## 1. Purpose

This specification defines how the TradeOS Voice Runtime is **built, packaged, configured, deployed, scaled, and operated** across development, staging, and production environments. It covers the full deployment lifecycle: from a developer's local machine through CI/CD pipelines to production infrastructure, including operational procedures for rollback, recovery, and version rollout.

---

## 2. Scope

| Domain | Sections | Audience |
|---|---|---|
| Environment Definitions | 3 | All engineers |
| Build & Artifacts | 4 | Build engineers, CI/CD |
| Containerization | 5 | Platform engineers |
| Runtime Configuration | 6 | Operations, platform |
| Secrets Management | 7 | Security, operations |
| Health Checks & Readiness | 8 | Operations, platform |
| Scaling | 9 | Platform engineers |
| CI/CD Pipeline | 10 | Build engineers |
| Rollback Strategy | 11 | Operations, on-call |
| Disaster Recovery | 12 | Operations, security |
| Version Rollout Strategy | 13 | Engineering leads |
| Production Readiness Checklist | 14 | Engineering, operations |
| Compliance | 15 | All |

---

## 3. Environment Definitions

### 3.1 Environment Matrix

| Aspect | Development | Staging | Production |
|---|---|---|---|
| **Purpose** | Local development, unit tests | Integration tests, pre-release validation | Live user traffic |
| **Host** | `localhost:3000` | `staging.tradeos.app` | `api.tradeos.app` |
| **Infrastructure** | Local machine | Vercel Pro (preview deployment) | Vercel Enterprise |
| **Database** | Local Supabase / Supabase free tier | Supabase Pro (dedicated project) | Supabase Enterprise (HA, PITR) |
| **AI Providers** | Mock providers (default), optional real | Real providers (sandbox keys) | Real providers (production keys) |
| **Voice Runtime** | Full runtime (all components) | Full runtime (all components) | Full runtime (all components) |
| **Log Level** | `debug` | `debug` | `info` |
| **Detailed Metrics** | `true` | `true` | `true` |
| **Debug Events** | `true` | `true` | `false` |
| **Health Report Interval** | 10s | 15s | 30s |
| **TLS** | Optional (HTTP) | Required (HTTPS) | Required (HTTPS) |
| **Auth** | Optional | Required | Required |

### 3.2 Development Environment

#### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | >= 20 LTS | Runtime |
| npm | >= 10 | Package manager |
| Git | >= 2.40 | Version control |
| Supabase CLI | Latest | Local database |

#### Setup

```bash
git clone <repository-url>
cd tradeos
npm install
cp .env.example .env.local
npm run dev
```

The development server starts on `http://localhost:3000` with hot reload.

#### Mock Providers

In development, the Voice Runtime SHALL use mock provider implementations:

- **Mock STT**: Returns configurable fake transcripts
- **Mock TTS**: Returns configurable fake audio chunks
- **Mock Transport**: Echoes messages back

Mock providers are enabled by setting `VOICE_PROVIDER_MODE=mock` in `.env.local`. Default is `mock` when no provider keys are configured.

#### Verification

```bash
npm run validate      # typecheck + tests + startup validation
npm run dev           # start development server
curl http://localhost:3000/api/health
```

### 3.3 Staging Environment

The staging environment SHALL be a Vercel preview deployment connected to the project's `staging` branch.

#### Configuration

- **Branch**: `staging`
- **Deploy Trigger**: Every push to `staging`
- **DNS**: `staging.tradeos.app`
- **Database**: Staging Supabase project (independent from production)
- **AI Providers**: Real providers with sandbox/test API keys
- **Observability**: Full metrics + tracing exported to staging monitoring

#### Gate

A staging deployment SHALL pass before any production deployment:

1. All tests pass (`npm run validate`)
2. Smoke tests pass (health endpoint, session create, dialogue turn)
3. Provider compliance suite passes (mock providers)
4. No P0/P1 security findings

### 3.4 Production Environment

#### Configuration

- **Branch**: `main` or `production`
- **Deploy Trigger**: Tagged release (`v*`) or manual approval
- **DNS**: `api.tradeos.app`
- **Database**: Production Supabase project (HA, PITR, daily backups)
- **AI Providers**: Real providers with production API keys
- **Observability**: Metrics exported, tracing sampled (1:100), all errors logged

#### Requirements

| # | Requirement |
|---|---|
| PR-01 | Production SHALL have at least 2 replicas (Vercel auto-scaling) |
| PR-02 | Production SHALL have TLS enforced (HTTPS-only) |
| PR-03 | Production SHALL have a custom domain with a valid certificate |
| PR-04 | Production SHALL have health check monitoring |
| PR-05 | Production SHALL have uptime alerts configured |
| PR-06 | Production SHALL have a rollback plan documented |
| PR-07 | Production SHALL have a disaster recovery runbook |

---

## 4. Build & Artifacts

### 4.1 Build Process

```bash
npm ci                        # clean install (CI)
npm run typecheck             # TypeScript type checking
npm run lint                  # ESLint
npm run test                  # Brain + Gateway tests
npm run test:startup          # Startup validation
npm run build                 # Next.js production build
```

### 4.2 Build Artifacts

| Artifact | Path | Description |
|---|---|---|
| Next.js server | `.next/` | Compiled application |
| Static assets | `.next/static/` | Client-side JS, CSS |
| Public files | `public/` | Static assets copied to output |
| Package lock | `package-lock.json` | Dependency pinning |

### 4.3 Build Compliance Rules

| # | Rule |
|---|---|
| B-01 | Every build SHALL run `npm ci` (not `npm install`) for deterministic dependencies |
| B-02 | Every build SHALL run `npm run validate` before `npm run build` |
| B-03 | Build artifacts SHALL be immutable — same commit always produces the same build |
| B-04 | Build artifacts SHALL be versioned with the release tag |
| B-05 | Build SHALL fail on TypeScript errors and lint violations |
| B-06 | Build SHALL fail if any test suite fails |

---

## 5. Containerization

### 5.1 Docker Image

While the primary deployment target is Vercel (serverless), the Voice Runtime SHALL also be containerizable for alternative deployments (self-hosted, Kubernetes, edge).

```dockerfile
# Base
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# Dependencies
FROM base AS deps
RUN npm ci --only=production
RUN cp -R node_modules /prod_modules
RUN npm ci

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
```

### 5.2 Next.js Standalone Output

The `next.config.ts` SHALL be configured for standalone output:

```typescript
const nextConfig = {
  output: "standalone",
  // ... other config
};
```

### 5.3 Docker Compose (Development)

```yaml
version: "3.8"
services:
  voice-runtime:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - VOICE_PROVIDER_MODE=mock
    env_file:
      - .env.production
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

### 5.4 Container Compliance Rules

| # | Rule |
|---|---|
| C-01 | Container SHALL run as non-root user |
| C-02 | Container SHALL use `node:20-alpine` as base image |
| C-03 | Container SHALL expose port 3000 |
| C-04 | Container SHALL include a health check instruction |
| C-05 | Container image SHALL be < 500 MB compressed |
| C-06 | Container image SHALL be tagged with both `latest` and the release version |

---

## 6. Runtime Configuration

### 6.1 Configuration Sources

Configuration is resolved in this order (later sources override earlier):

1. **Compiled defaults** — Built into the application binary
2. **Environment variables** — `process.env.*` at runtime
3. **Configuration file** — JSON file mounted at `/etc/tradeos/config.json` (container deploys) or served via environment variable `VOICE_CONFIG_JSON`

### 6.2 Environment Variables

| Variable | Required | Environments | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | All | `development`, `staging`, or `production` |
| `VOICE_INSTANCE_ID` | No | All | Runtime instance identifier (default: hostname) |
| `VOICE_ENVIRONMENT` | No | All | Override environment label |
| `VOICE_LOG_LEVEL` | No | All | Log level override |
| `VOICE_HEALTH_INTERVAL_MS` | No | All | Health report interval |
| `VOICE_ENABLE_DETAILED_METRICS` | No | All | `true`/`false` |
| `VOICE_ENABLE_DEBUG_EVENTS` | No | All | `true`/`false` |
| `VOICE_MAX_SESSIONS` | No | All | Max concurrent sessions |
| `VOICE_DEFAULT_LANGUAGE` | No | All | Default BCP 47 language tag |
| `VOICE_PROVIDER_MODE` | No | Dev/Staging | `mock` or `real` |
| `VOICE_CONFIG_JSON` | No | All | Full config as JSON string |
| `GATEWAY_BASE_URL` | Yes | All | Conversation Gateway URL |
| `GATEWAY_API_KEY` | Yes | Staging/Prod | Gateway authentication |
| `STT_PROVIDER` | No | All | STT provider ID (default: first configured) |
| `TTS_PROVIDER` | No | All | TTS provider ID (default: first configured) |

### 6.3 AI Provider Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Conditional | Google Gemini API key |
| `OPENAI_API_KEY` | Conditional | OpenAI API key |
| `XAI_API_KEY` | Conditional | xAI/Grok API key |
| `ZAI_API_KEY` | Conditional | Z.ai/GLM API key |
| `AI_PROVIDER_ORDER` | No | Comma-separated provider priority |
| `AI_PROVIDER_TIMEOUT_MS` | No | Per-provider timeout |
| `AI_MAX_RETRIES_PER_PROVIDER` | No | Retries per provider |

### 6.4 Configuration File Format (Container Deployments)

```json
{
  "version": "1.0.0",
  "runtime": {
    "instanceId": "voice-prod-1",
    "environment": "production",
    "defaultLanguage": "en",
    "logLevel": "info",
    "initTimeoutMs": 10000,
    "healthReportIntervalMs": 30000,
    "enableDetailedMetrics": true,
    "enableDebugEvents": false
  },
  "providers": [
    {
      "providerId": "google-stt-1",
      "providerType": "stt",
      "providerKey": "google",
      "timeoutMs": 10000,
      "retryPolicy": {
        "maxAttempts": 3,
        "baseDelayMs": 500,
        "maxDelayMs": 10000,
        "exponentialBackoff": true
      },
      "credentialsRef": "google-stt-credentials"
    }
  ],
  "session": {
    "idleTimeoutMs": 30000,
    "sessionTimeoutMs": 600000,
    "maxSessions": 100,
    "maxSessionDurationMs": 3600000
  },
  "gateway": {
    "timeoutMs": 10000,
    "retryMaxAttempts": 3,
    "retryBaseDelayMs": 1000,
    "retryMaxDelayMs": 10000,
    "channel": "voice"
  }
}
```

### 6.5 Configuration Compliance Rules

| # | Rule |
|---|---|
| CF-01 | Never hardcode secrets in configuration files — always use `credentialsRef` |
| CF-02 | Configuration files SHALL NOT be committed to version control |
| CF-03 | Environment variable names SHALL use `UPPER_SNAKE_CASE` |
| CF-04 | Every environment variable SHALL have a documented default |
| CF-05 | Configuration validation SHALL run at startup and reject invalid config |

---

## 7. Secrets Management

### 7.1 Secrets Storage

| Environment | Storage Method | Rotation |
|---|---|---|
| Development | `.env.local` (gitignored) | Manual |
| Staging | Vercel Environment Variables (encrypted) | On rotation schedule |
| Production | Vercel Environment Variables (encrypted) + external secrets manager | On rotation schedule + incident-triggered |

### 7.2 Secrets Inventory

| Secret | Environments | Rotation | Access |
|---|---|---|---|
| `GEMINI_API_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `OPENAI_API_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `XAI_API_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `ZAI_API_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `GATEWAY_API_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging, Production | Every 90 days | CI/CD, Runtime |
| `NEXT_PUBLIC_SUPABASE_URL` | All | Infrequent | Client-side |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Infrequent | Client-side |

### 7.3 Secrets Compliance Rules

| # | Rule |
|---|---|
| S-01 | Secrets SHALL NEVER be committed to version control |
| S-02 | Secrets SHALL NEVER appear in logs, error messages, or metrics |
| S-03 | Secrets SHALL be stored encrypted at rest and in transit |
| S-04 | Development secrets SHALL be distinct from staging and production |
| S-05 | Service role keys SHALL NOT be used client-side |
| S-06 | Secrets SHALL be rotated within 24 hours of suspected exposure |
| S-07 | Access to production secrets SHALL require MFA |
| S-08 | Secrets SHALL use the minimum privilege required for the operation |

### 7.4 Provider Credential References

Provider credentials SHALL NOT be stored inline in provider configuration. Instead, each provider SHALL reference credentials by a `credentialsRef` key:

```typescript
interface ProviderConfiguration {
  providerId: string;
  // ...
  credentialsRef: string;  // key into the secret store
}
```

The runtime SHALL resolve `credentialsRef` to the actual credential at initialization time by querying the configured secrets manager.

---

## 8. Health Checks & Readiness

### 8.1 Endpoints

| Endpoint | Method | Purpose | Expected Response Time |
|---|---|---|---|
| `/api/health` | GET | Liveness + readiness probe | < 1000 ms |
| `/api/health/ready` | GET | Readiness probe (dependencies ready) | < 2000 ms |
| `/api/health/live` | GET | Liveness probe (process alive) | < 100 ms |

### 8.2 Health Responses

#### Liveness (`/api/health/live`)

```json
// HTTP 200
{ "status": "alive", "uptimeMs": 3600000 }
```

The liveness check verifies only that the process is running and accepting requests. It SHALL NOT check dependencies.

#### Readiness (`/api/health/ready`)

```json
// HTTP 200 — All dependencies available
{
  "status": "ready",
  "dependencies": {
    "database": { "healthy": true, "latencyMs": 5 },
    "gateway": { "healthy": true, "latencyMs": 42 },
    "providers": {
      "google-stt-1": { "healthy": true, "latencyMs": 120 }
    }
  }
}

// HTTP 503 — One or more dependencies unavailable
{
  "status": "not_ready",
  "dependencies": {
    "database": { "healthy": true },
    "gateway": { "healthy": false, "error": "Connection refused" }
  }
}
```

#### Aggregate Health (`/api/health`)

As defined in TVR-OBS-001 Section 10.3.

### 8.3 Probe Configuration

| Platform | Liveness | Readiness | Startup |
|---|---|---|---|
| Docker | `curl -f http://localhost:3000/api/health/live` | `curl -f http://localhost:3000/api/health/ready` | — |
| Kubernetes | `httpGet: /api/health/live` | `httpGet: /api/health/ready` | `httpGet: /api/health` |

#### Kubernetes Probe Configuration

```yaml
livenessProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 15
  timeoutSeconds: 5
  failureThreshold: 2

startupProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 10
  failureThreshold: 6
```

### 8.4 Health Check Compliance Rules

| # | Rule |
|---|---|
| HC-01 | Liveness SHALL never depend on external services |
| HC-02 | Readiness SHALL check all external dependencies (database, gateway, providers) |
| HC-03 | Aggregate health SHALL return `degraded` (200) when non-critical components fail |
| HC-04 | Aggregate health SHALL return `unhealthy` (503) only when the runtime cannot serve requests |

---

## 9. Scaling

### 9.1 Scaling Model

The Voice Runtime uses a **horizontal scaling** model. New instances are added to handle increased load.

| Aspect | Serverless (Vercel) | Container (Kubernetes) |
|---|---|---|
| Unit of scaling | Function instance | Pod |
| Auto-scaling trigger | Concurrent requests | CPU, memory, request rate |
| Max instances | Unbounded (Vercel managed) | Configurable (default: 10) |
| Min instances | 1 (warm) | 2 |
| Scaling cooldown | N/A (instant) | 60s scale-up, 180s scale-down |

### 9.2 Resource Estimates

| Resource | Per Instance (1 session) | Per Instance (10 sessions) | Per Instance (100 sessions) |
|---|---|---|---|
| CPU | 0.1 vCPU | 0.3 vCPU | 1.0 vCPU |
| Memory | 256 MB | 512 MB | 1 GB |
| Network | Low | Moderate | High |

### 9.3 Session-Aware Routing

The Voice Runtime is **stateless with respect to sessions**. Session state is held in-memory and is lost on instance restart. Session recovery mechanisms (TVR-SESR-001) handle failover.

- No session stickiness required
- Any instance can handle any request
- Session recovery uses the Conversation Gateway conversation ID to reconstruct state

### 9.4 Rate Limiting

| Level | Limit | Scope | Response |
|---|---|---|---|
| Global | 1000 req/s | Entire deployment | HTTP 429 |
| Per-session | 50 req/s | Single session | HTTP 429 |
| Per-provider | Provider-defined | Per provider instance | Provider error `RATE_LIMITED` |

### 9.5 Scaling Compliance Rules

| # | Rule |
|---|---|
| SC-01 | Runtime SHALL be stateless — no instance-local persistent storage |
| SC-02 | Session state SHALL be recoverable from the Conversation Gateway |
| SC-03 | Rate limiting SHALL be applied at global and per-session levels |
| SC-04 | Auto-scaling SHALL use concurrency (serverless) or CPU/memory (container) triggers |

---

## 10. CI/CD Pipeline

### 10.1 Pipeline Stages

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌───────────┐
│   Lint   │ → │  Type    │ → │  Test    │ → │  Build   │ → │  Deploy   │
│          │   │  Check   │   │          │   │          │   │           │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └───────────┘
                                                                  │
                                           ┌──────────────────────┼──────────────────────┐
                                           ▼                      ▼                      ▼
                                     ┌──────────┐          ┌──────────┐          ┌───────────┐
                                     │ Dev      │          │ Staging  │          │ Production │
                                     │ (preview)│          │ (auto)   │          │ (manual)  │
                                     └──────────┘          └──────────┘          └───────────┘
```

### 10.2 Branch Strategy

| Branch | Purpose | CI Trigger | Deploy To | Gate |
|---|---|---|---|---|
| `feature/*` | Feature development | Push | Vercel preview (dev) | Lint + typecheck + tests |
| `staging` | Integration | Push | `staging.tradeos.app` | All CI + smoke tests |
| `main` | Production releases | Tag `v*` | `api.tradeos.app` | All CI + smoke + manual approval |

### 10.3 CI Steps

```yaml
name: ci
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build

  deploy-staging:
    if: github.ref == 'refs/heads/staging'
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: "--prod"

  deploy-production:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: validate
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: "--prod"
```

### 10.4 CI/CD Compliance Rules

| # | Rule |
|---|---|
| CI-01 | Every push SHALL trigger CI (lint + typecheck + tests + build) |
| CI-02 | CI SHALL fail on any test failure or build error |
| CI-03 | Staging deployment SHALL be automatic on push to `staging` |
| CI-04 | Production deployment SHALL require a git tag (`v*`) and manual approval |
| CI-05 | CI SHALL use `npm ci` for deterministic dependency installation |

---

## 11. Rollback Strategy

### 11.1 Rollback Triggers

A rollback SHALL be initiated when:

| Trigger | Severity | Response Time | Approval |
|---|---|---|---|
| P0 incident (complete outage) | Critical | Immediate | On-call engineer |
| P1 incident (severe degradation) | High | Within 15 minutes | On-call engineer |
| Failed health checks after deploy | High | Within 10 minutes | Automated |
| Error rate > 5% after deploy | High | Within 15 minutes | Automated |
| Performance regression > 50% | Medium | Within 1 hour | Engineering lead |

### 11.2 Rollback Procedures

#### Vercel (Serverless)

```bash
# List deployments
vercel list

# Rollback to a specific deployment
vercel rollback <deployment-id>

# Verify rollback
curl -f https://api.tradeos.app/api/health
```

**Procedure:**
1. Identify the last known-good deployment ID from Vercel dashboard
2. Run `vercel rollback <deployment-id>`
3. Verify health endpoint returns 200
4. Verify error rate returns to baseline
5. Notify team via Slack #alerts

#### Kubernetes (Container)

```bash
# Rollback to previous revision
kubectl rollout undo deployment/voice-runtime

# Rollback to a specific revision
kubectl rollout undo deployment/voice-runtime --to-revision=<revision>

# Verify
kubectl rollout status deployment/voice-runtime
```

### 11.3 Rollback Compliance Rules

| # | Rule |
|---|---|
| RB-01 | Every deploy SHALL preserve the previous 3 releases for immediate rollback |
| RB-02 | Rollback SHALL be tested at least once per quarter in staging |
| RB-03 | Rollback SHALL not require database migrations (all migrations SHALL be backward-compatible) |
| RB-04 | After rollback, the root cause SHALL be documented in a post-mortem |
| RB-05 | Rollback SHALL complete within 10 minutes of the decision to roll back |

---

## 12. Disaster Recovery

### 12.1 Failure Scenarios

| Scenario | Impact | RTO | RPO | Recovery Strategy |
|---|---|---|---|---|
| Single instance failure | Minor degradation | < 1 min | N/A | Auto-scaling replaces instance |
| Region failure (Vercel) | Complete outage | < 15 min | N/A | DNS failover to secondary region |
| Database corruption | Data loss | < 1 hour | 5 min | PITR restore |
| Provider API outage | Partial degradation | < 5 min | N/A | Failover to alternate provider |
| Secrets leak | Security incident | < 1 hour | N/A | Secrets rotation + audit |

### 12.2 Recovery Runbooks

#### Provider API Outage

```
1. DETECT: Error rate spike for provider X
2. ASSESS: Is the provider returning errors or timing out?
3. ACTION: AI provider order automatically skips failed provider
4. ACTION: If all providers fail, return friendly error to user
5. MONITOR: Check error rate returns to baseline
6. RESOLVE: When provider recovers, normal operation resumes
7. DOCUMENT: Post-mortem with outage timeline
```

#### Database Corruption

```
1. DETECT: Data integrity check fails or query errors
2. STOP: Disable write endpoints
3. RESTORE: Restore from PITR backup (target: 5 min before corruption)
4. VERIFY: Run data integrity checks
5. RESUME: Enable write endpoints
6. AUDIT: Determine cause and scope of data loss
```

#### Complete Region Failure

```
1. DETECT: Health checks fail across all instances
2. FAILOVER: Update DNS A record to secondary region
3. VERIFY: Health endpoint returns 200 from secondary region
4. SCALE: Increase instance count in secondary region to handle load
5. MONITOR: Watch error rates and latency
6. RESTORE: When primary region recovers, fail back gracefully
```

### 12.3 Backup Strategy

| Data | Backup Frequency | Retention | Method |
|---|---|---|---|
| Database | Continuous (PITR) | 7 days | Supabase managed backups |
| Configuration | Per deployment | Indefinite (git history) | Version control |
| Provider credentials | N/A | N/A | Secrets manager (re-enterable) |

### 12.4 Disaster Recovery Compliance Rules

| # | Rule |
|---|---|
| DR-01 | Recovery runbooks SHALL be documented for every failure scenario |
| DR-02 | Runbooks SHALL be tested at least once per quarter |
| DR-03 | Database backups SHALL be tested for restore at least once per month |
| DR-04 | Provider failover SHALL be automatic — no manual intervention required |
| DR-05 | RTO for P0 incidents SHALL be <= 15 minutes |
| DR-06 | RPO for database data SHALL be <= 5 minutes |

---

## 13. Version Rollout Strategy

### 13.1 Release Versioning

Releases follow Semantic Versioning: `MAJOR.MINOR.PATCH`

- **MAJOR** — Breaking changes (API contract changes, database schema changes)
- **MINOR** — New features (backward-compatible)
- **PATCH** — Bug fixes (backward-compatible)

### 13.2 Release Cadence

| Type | Cadence | Examples |
|---|---|---|
| Major | Every 3–6 months | v2.0.0, v3.0.0 |
| Minor | Every 2–4 weeks | v1.1.0, v1.2.0 |
| Patch | As needed (hotfix) | v1.0.1, v1.0.2 |

### 13.3 Rollout Phases

Every production release SHALL follow a phased rollout:

```
Phase 0: Staging Validation (duration: 1–24 hours)
  ├── Deploy to staging.tradeos.app
  ├── Run smoke tests
  ├── Monitor error rate = 0% for 1 hour
  └── Engineering lead sign-off

Phase 1: Canary (duration: 15–30 minutes)
  ├── Deploy to 5% of production instances
  ├── Monitor error rate < 0.1% above baseline
  ├── Monitor p95 latency < 110% of baseline
  └── Automated pass/fail

Phase 2: Ramp (duration: 30–60 minutes)
  ├── Deploy to 25% of production instances
  ├── Same monitoring as Phase 1
  └── Automated pass/fail

Phase 3: Full (duration: immediate)
  ├── Deploy to 100% of production instances
  ├── Monitor for 30 minutes
  └── Announce in #releases
```

### 13.4 Hotfix Procedure

For P0/P1 incidents requiring an immediate fix:

```
1. Branch from the last known-good release tag
2. Apply the minimal fix
3. Bump PATCH version
4. Skip staging (deploy directly to production canary)
5. Monitor aggressively (1-minute window)
6. Promote to full after 5 minutes of clean monitoring
7. Backport to main branch
```

### 13.5 Rollout Compliance Rules

| # | Rule |
|---|---|
| RL-01 | Every release SHALL be tagged with a signed git tag (`vMAJOR.MINOR.PATCH`) |
| RL-02 | Every release SHALL have a changelog entry |
| RL-03 | Every release SHALL pass staging validation before production |
| RL-04 | Every production release SHALL use phased rollout (canary → ramp → full) |
| RL-05 | Hotfixes SHALL skip staging but SHALL still use canary |
| RL-06 | A release SHALL be aborted if error rate exceeds 0.5% above baseline |

---

## 14. Production Readiness Checklist

### 14.1 Pre-Deployment

| # | Item | Verified By |
|---|---|---|
| PR-01 | All CI checks pass (lint, typecheck, tests, build) | CI |
| PR-02 | Security scan passes (no critical/high findings) | CI |
| PR-03 | Provider compliance suite passes | CI |
| PR-04 | Staging smoke tests pass | CI |
| PR-05 | Changelog entry written | Engineering |
| PR-06 | Release tag created (`vMAJOR.MINOR.PATCH`) | Engineering |
| PR-07 | Database migrations backward-compatible | Engineering |
| PR-08 | Rollback plan documented | Engineering |

### 14.2 Post-Deployment

| # | Item | Verified By |
|---|---|---|
| PD-01 | Health endpoint returns 200 | Monitoring |
| PD-02 | Error rate within baseline | Monitoring |
| PD-03 | p95 latency within 110% of baseline | Monitoring |
| PD-04 | All providers healthy | Monitoring |
| PD-05 | Database connections normal | Monitoring |
| PD-06 | No P0/P1 alerts triggered | On-call |

### 14.3 Production Readiness Gates

| Gate | Requirement | Blocks Release |
|---|---|---|
| CI Pass | All CI steps green | Yes |
| Security | No critical or high findings | Yes |
| Staging | 1 hour clean monitoring | Yes |
| Canary | 15 minutes clean monitoring | Yes |
| Ramp | 30 minutes clean monitoring | Yes |
| Engineering Approval | Manual sign-off | Yes |

---

## 15. Compliance Requirements

### 15.1 Implementation Compliance

| # | Requirement | Verification |
|---|---|---|
| DPL-01 | Build process uses `npm ci` for deterministic deps | CI config audit |
| DPL-02 | Build runs validation before build | CI config audit |
| DPL-03 | Container runs as non-root user | Dockerfile review |
| DPL-04 | Health endpoints defined per Section 8 | Integration test |
| DPL-05 | Secrets never appear in logs | Log audit |
| DPL-06 | Secrets stored in encrypted environment variables | Config audit |
| DPL-07 | Rate limiting implemented at global + session level | Load test |
| DPL-08 | Previous 3 releases preserved for rollback | CI/CD audit |
| DPL-09 | Release tagged with signed git tag | Git audit |
| DPL-10 | Phased rollout implemented (canary → ramp → full) | CI/CD audit |
| DPL-11 | Provider failover automatic | Integration test |
| DPL-12 | Database backups tested monthly | Operations audit |

### 15.2 Release Gating

| Suite | Min Pass Rate | Critical Failures | Blocks Release |
|---|---|---|---|
| Build compliance | 100% | Any | Yes |
| Health endpoint compliance | 100% | Any | Yes |
| Secrets management audit | 100% | Any | Yes |
| Rollback capability test | 100% | Any | Yes |
| Provider failover test | 100% | 0 | Yes |

### 15.3 Security Compliance

| # | Requirement |
|---|---|
| SC-01 | All production traffic SHALL use TLS 1.2+ |
| SC-02 | HTTP Strict-Transport-Security header SHALL be set |
| SC-03 | CORS SHALL be restricted to known origins |
| SC-04 | Rate limiting SHALL be applied to prevent abuse |
| SC-05 | Secrets SHALL be rotated every 90 days |
| SC-06 | Access logs SHALL be retained for 90 days |

---

## 16. Appendix A — Vercel Configuration

### 16.1 vercel.json

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "installCommand": "npm ci",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["iad1", "hkg1"],
  "env": {
    "NODE_ENV": "production"
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### 16.2 Region Selection

| Region | Location | Primary Use |
|---|---|---|
| `iad1` | US East (Virginia) | Primary |
| `hkg1` | Hong Kong | Asia-Pacific failover |

---

## 17. Appendix B — Kubernetes Manifests (Reference)

### 17.1 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: voice-runtime
  namespace: tradeos
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: voice-runtime
  template:
    metadata:
      labels:
        app: voice-runtime
    spec:
      containers:
        - name: voice-runtime
          image: tradeos/voice-runtime:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: voice-runtime-secrets
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1000m
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 15
          startupProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 6
```

### 17.2 Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: voice-runtime-hpa
  namespace: tradeos
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: voice-runtime
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

---

## 18. Appendix C — Environment Variable Template

```bash
# === Runtime ===
NODE_ENV=development
VOICE_INSTANCE_ID=
VOICE_ENVIRONMENT=
VOICE_LOG_LEVEL=info
VOICE_HEALTH_INTERVAL_MS=30000
VOICE_ENABLE_DETAILED_METRICS=true
VOICE_ENABLE_DEBUG_EVENTS=false
VOICE_MAX_SESSIONS=100
VOICE_DEFAULT_LANGUAGE=en
VOICE_PROVIDER_MODE=mock

# === Gateway ===
GATEWAY_BASE_URL=http://localhost:3000
GATEWAY_API_KEY=

# === AI Providers (at least one required) ===
GEMINI_API_KEY=
OPENAI_API_KEY=
XAI_API_KEY=
ZAI_API_KEY=

# === AI Router ===
AI_PROVIDER_ORDER=gemini,openai,xai,zai
AI_PROVIDER_TIMEOUT_MS=20000
AI_MAX_RETRIES_PER_PROVIDER=1
AI_ENABLE_LOCAL_FALLBACK=true

# === Supabase ===
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 19. Appendix D — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-07-30 | Initial specification. Environment definitions, build artifacts, Docker containerization, runtime config sources, secrets management, health check endpoints with probe configs, horizontal scaling with rate limiting, CI/CD pipeline with branch strategy, rollback procedures, disaster recovery runbooks, phased rollout strategy, production readiness checklist, compliance requirements. |
