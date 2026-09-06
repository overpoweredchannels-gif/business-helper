# OP OWNER — Security Documentation (Canonical Source)

> **This is the single authoritative document for security posture. All other documents reference this.**

---

## Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Defense in Depth** | RLS + API validation + Audit logs + Infrastructure security |
| **Least Privilege** | 11 granular permissions, no wildcard roles |
| **Zero Trust** | Every request authenticated, authorized, audited |
| **Data Minimization** | Only collect what's needed for business operations |
| **Audit by Default** | Immutable logs on all mutations |
| **Fail Secure** | AI unavailable → local fallback, core ERP works |
| **Transparency** | Owner sees all AI actions before execution |

---

## Authentication

### Supabase Auth (Current)

| Aspect | Detail |
|--------|--------|
| **Provider** | Supabase Auth (email/password) |
| **Session** | JWT in httpOnly cookie (managed by Supabase client) |
| **Custom Claims** | `organization_id`, `role` injected at sign-in |
| **Password Policy** | Supabase default (min 8 chars), MFA planned |
| **Session Lifetime** | 1 hour access token, refresh token rotation |
| **Logout** | Client-side sign-out + server-side session revocation |

### Planned Enhancements

- [ ] **MFA** (TOTP via Supabase Auth)
- [ ] **SSO/SAML** (Enterprise phase)
- [ ] **Device Trust** (fingerprinting, geo-velocity)
- [ ] **Passwordless** (magic links, WebAuthn)

---

## Authorization

### Row Level Security (RLS) — Primary Enforcement

Every table scoped to `organization_id`. Policies enforce:

```sql
-- Example: Products table
CREATE POLICY "org_isolation" ON products
  FOR ALL USING (organization_id = current_org_id());

-- Write requires permission
CREATE POLICY "org_write_managed" ON products
  FOR INSERT WITH CHECK (
    organization_id = current_org_id() AND
    has_permission(auth.uid(), 'can_manage_products')
  );
```

Helper function:
```sql
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'organization_id'::uuid;
$$;
```

### Permission Matrix (11 Permissions × 6 Roles)

| Permission | Owner | Admin | Manager | Staff | Accountant | Sales |
|------------|-------|-------|---------|-------|------------|-------|
| `can_manage_products` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `can_manage_customers` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (view) |
| `can_manage_suppliers` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `can_create_purchases` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `can_create_sales` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `can_manage_payments` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `can_manage_expenses` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `can_view_profit` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `can_view_reports` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `can_manage_tasks` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `can_manage_settings` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Server-Side Authorization (Planned)

```typescript
// Server Action pattern
export async function createPurchase(data: unknown) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Verify permission via RPC
  const { data: hasPerm } = await supabase.rpc('check_permission', {
    p_user_id: user.id,
    p_permission: 'can_create_purchases'
  });
  
  if (!hasPerm) throw new Error('Insufficient permissions');
  
  // RLS also enforces org_id
  return supabase.from('purchase_transactions').insert({...});
}
```

---

## Database Security

### RLS Coverage (All Tables)

| Table | RLS Enabled | Policies | Notes |
|-------|-------------|----------|-------|
| `organizations` | ✅ | 2 | Owner-only |
| `profiles` | ✅ | 3 | Self + org members |
| `staff_permissions` | ✅ | 2 | Owner/Admin only |
| `products` | ✅ | 4 | CRUD per permission |
| `brands` | ✅ | 4 | CRUD per permission |
| `categories` | ✅ | 4 | CRUD per permission |
| `customers` | ✅ | 4 | CRUD per permission |
| `suppliers` | ✅ | 4 | CRUD per permission |
| `purchase_transactions` | ✅ | 4 | CRUD per permission |
| `purchase_items` | ✅ | 2 | Via parent |
| `sales_transactions` | ✅ | 4 | CRUD per permission |
| `sales_items` | ✅ | 2 | Via parent |
| `customer_payments` | ✅ | 4 | CRUD per permission |
| `customer_payment_allocations` | ✅ | 2 | Via parent |
| `supplier_payments` | ✅ | 4 | CRUD per permission |
| `supplier_payment_allocations` | ✅ | 2 | Via parent |
| `expenses` | ✅ | 4 | CRUD per permission |
| `tasks` | ✅ | 4 | CRUD per permission |
| `audit_logs` | ✅ | 2 | Insert only (trigger), select org |
| `market_news_sources` | ✅ | 4 | CRUD per permission |
| `market_intelligence_items` | ✅ | 4 | CRUD per permission |
| `market_import_queue` | ✅ | 4 | CRUD per permission |
| `market_ai_analyses` | ✅ | 4 | CRUD per permission |
| `ai_business_query_logs` | ✅ | 2 | Insert (API), select org |
| `ai_voice_operator_sessions` | ✅ | 4 | CRUD per permission |
| `ai_voice_operator_messages` | ✅ | 2 | Via session |
| `ai_action_drafts` | ✅ | 4 | CRUD per permission |
| `ai_action_messages` | ✅ | 2 | Via draft |
| `ai_alerts` | ✅ | 4 | CRUD per permission |
| `ai_daily_briefings` | ✅ | 4 | CRUD per permission |
| `security_checks` | ✅ | 4 | CRUD per permission |
| `staff_duty_sessions` | ✅ | 4 | CRUD per permission |
| `staff_location_points` | ✅ | 2 | Via session |

### Audit Logging

**Trigger Function** (on all mutable tables):

```sql
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_org_id uuid;
  v_actor_id uuid;
  v_actor_email text;
BEGIN
  v_org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  v_actor_id := auth.uid();
  v_actor_email := auth.jwt() ->> 'email';
  
  INSERT INTO audit_logs (
    organization_id, actor_profile_id, actor_email,
    action, entity_type, entity_id, entity_label,
    description, old_values, new_values
  ) VALUES (
    v_org_id, v_actor_id, v_actor_email,
    TG_OP, TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.name, NEW.invoice_number, NEW.title, ''),
    TG_OP || ' on ' || TG_TABLE_NAME,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  
  RETURN NULL;
END $$;
```

**Coverage**: All 27 business tables + AI tables have audit triggers.

---

## API Security

### Current State

| Endpoint | Auth | Validation | Rate Limit |
|----------|------|------------|------------|
| `/api/ai-business-query` | Supabase JWT | Manual (planned: Zod) | None (planned) |
| `/api/market-intelligence/analyze` | Supabase JWT | Manual (planned: Zod) | None (planned) |

### Planned Hardening

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // 1. Verify session
  const supabase = createServerClient(..., {
    cookies: { getAll, setAll }
  });
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user && isProtectedRoute(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // 2. Rate limiting (Upstash)
  if (isApiRoute(request.nextUrl.pathname)) {
    const ratelimit = await ratelimit.limit(user.id);
    if (!ratelimit.success) {
      return new Response('Rate limited', { status: 429 });
    }
  }
  
  // 3. Security headers
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  return response;
}
```

### Input Validation (Planned)

```typescript
// src/lib/validators/api.ts
import { z } from 'zod';

export const BusinessQuerySchema = z.object({
  question: z.string().min(1).max(1000),
  language: z.enum(['auto', 'en', 'ur', 'ur-Latn']).optional(),
  query_type: z.enum(['general', 'analytics_explainer']).optional(),
  date_range_start: z.string().date().optional(),
  date_range_end: z.string().date().optional(),
  business_summary: z.record(z.unknown()).optional(),
});

export const MarketAnalysisSchema = z.object({
  title: z.string().max(300).optional(),
  summary: z.string().max(1200).optional(),
  raw_text: z.string().max(3000).optional(),
  source_name: z.string().max(200).optional(),
  source_url: z.string().url().optional(),
  market_category: z.enum(MARKET_CATEGORIES).optional(),
  context_country: z.string().max(100).optional(),
  business_context: z.string().max(1200).optional(),
});
```

---

## AI Security

### Provider Router Safeguards

| Safeguard | Implementation |
|-----------|----------------|
| **Timeout** | 20s per attempt (configurable) |
| **Retry Limit** | 1 retry per model (configurable) |
| **Fallback Codes** | 429, 404, 500, 502, 503, 504 |
| **JSON Validation** | Fence stripping + schema-aware parsing |
| **Response Size Limit** | 50KB text, 10KB JSON |
| **Prompt Injection** | System prompt isolates user input |
| **Data Leakage** | Business summary only, no raw DB access |

### AI Data Handling

| Data Type | Sent to AI | Retention |
|-----------|------------|-----------|
| Business Summary | ✅ (anonymized org_id) | Not stored by providers |
| Market Signal Text | ✅ (owner-provided) | Not stored by providers |
| Voice Transcripts | ✅ (session-scoped) | Not stored by providers |
| Action Drafts | ❌ (local only) | Supabase only |

**Provider Agreements**: All 4 configured providers (5 supported) used via standard APIs with no training on customer data (verify per provider TOS).

### Local Fallback

When all providers fail, deterministic summary generated from `business_summary` — **no external call**.

---

## Secrets Management

### Current (Development)

| Secret | Location | Risk |
|--------|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Low (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | Low (public, RLS enforced) |
| `GEMINI_API_KEY` | `.env.local` | Local secret; ignored and not tracked |
| `OPENAI_API_KEY` | `.env.local` | Local secret; ignored and not tracked |
| `XAI_API_KEY` | `.env.local` | Local secret; ignored and not tracked |
| `GROQ_API_KEY` | `.env.local` | Local secret; ignored and not tracked |
| `ZAI_API_KEY` | `.env.local` | Local secret; ignored and not tracked |

### Required Production Migration

| Secret | Vercel Environment | Rotation |
|--------|-------------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | N/A |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | Quarterly |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server Only** (Production) | Quarterly |
| `GEMINI_API_KEY` | **Server Only** (Production) | Quarterly |
| `OPENAI_API_KEY` | **Server Only** (Production) | Quarterly |
| `XAI_API_KEY` | **Server Only** (Production) | Quarterly |
| `GROQ_API_KEY` | **Server Only** (Production) | Quarterly |
| `ZAI_API_KEY` | **Server Only** (Production) | Quarterly |
| `ZAI_BASE_URL` | **Server Only** (Production) | N/A |
| AI Router Config | **Server Only** (Production) | As needed |

### Immediate Action Required

```bash
# 1. Keep .env.local ignored and never print or commit its values
# 2. Rotate any key that was shared outside approved secret storage
# 3. Add production secrets in Vercel Project Settings → Environment Variables
# 4. Keep all AI keys server-side only
# 5. Recheck tracked files and git history before every production release
```

### Build-Time vs Runtime

```typescript
// next.config.ts
export default {
  // Only NEXT_PUBLIC_* available at build time
  env: {
    // Build-time: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
  },
  // Runtime: All server-only vars via process.env in API routes
};
```

---

## Network & Infrastructure Security

### Vercel (Current Hosting)

| Control | Status |
|---------|--------|
| **DDoS Protection** | ✅ Vercel Edge Network |
| **WAF** | ✅ Vercel WAF (managed rules) |
| **TLS** | ✅ Automatic, TLS 1.3 |
| **Certificate Management** | ✅ Automatic (Let's Encrypt) |
| **Edge Functions** | ✅ Available for API routes |
| **IP Allowlisting** | ⚠️ Planned for admin routes |

### Supabase (Database)

| Control | Status |
|---------|--------|
| **Network Isolation** | ✅ Private IP, no public access |
| **Encryption at Rest** | ✅ AES-256 (managed) |
| **Encryption in Transit** | ✅ TLS 1.2+ |
| **Backup Encryption** | ✅ AES-256 |
| **PITR** | ✅ Point-in-time recovery (7 days) |
| **Connection Pooling** | ✅ PgBouncer (100 connections) |
| **RLS Enforcement** | ✅ PostgreSQL native |

### Planned: Private Networking

- [ ] Vercel Secure Compute (private VPC)
- [ ] Supabase Private Link / VPC Peering
- [ ] IP allowlist for database access

---

## Logging & Monitoring

### Current Logging

| Source | Destination | Format |
|--------|-------------|--------|
| **API Routes** | Vercel Logs | JSON (structured) |
| **Supabase** | Supabase Dashboard | PostgreSQL logs |
| **Client Errors** | Console / Sentry (planned) | — |

### Required Enhancements

```typescript
// Structured logging pattern
interface LogEntry {
  timestamp: string;           // ISO 8601
  level: 'info' | 'warn' | 'error';
  service: 'api' | 'ai-router' | 'market-intel' | 'auth';
  organization_id?: string;
  user_id?: string;
  request_id: string;          // Correlation ID
  action: string;              // 'ai_query', 'market_analysis', etc.
  duration_ms: number;
  outcome: 'success' | 'failure' | 'fallback';
  error?: {
    code: string;
    message: string;
    provider?: string;
    model?: string;
  };
  metadata?: Record<string, unknown>;
}
```

### Alerting Rules (Planned)

| Alert | Condition | Severity |
|-------|-----------|----------|
| AI Fallback Rate | > 10% of queries use local fallback | 🔴 Critical |
| API Error Rate | > 5% 5xx errors in 5 min | 🔴 Critical |
| RLS Policy Violations | Any `permission denied` in logs | 🔴 Critical |
| Auth Failures | > 20 failed logins/min/org | 🟡 Warning |
| Database Connections | > 80% pool utilization | 🟡 Warning |
| AI Provider Latency | p99 > 15s | 🟡 Warning |
| Audit Log Gap | No audit entries for > 1 hour | 🟡 Warning |

---

## Backup & Disaster Recovery

### Supabase Managed

| Aspect | Configuration |
|--------|---------------|
| **Backup Frequency** | Daily (automatic) |
| **Retention** | 7 days PITR, 30 days full backups |
| **RTO** | < 1 hour |
| **RPO** | < 5 minutes (PITR) |
| **Cross-Region** | ⚠️ Single region (planned: multi-region) |

### Application-Level

| Data | Backup Strategy |
|------|-----------------|
| **Code** | GitHub (primary), mirrored to GitLab |
| **Environment Config** | Vercel (encrypted), 1Password (team) |
| **AI Prompts** | Versioned in `/prompts` (planned) |
| **Market Intelligence** | Supabase backup + CSV export |

### DR Test Schedule

| Test | Frequency | Owner |
|------|-----------|-------|
| **PITR Restore** | Quarterly | DevOps |
| **Full Region Failover** | Semi-annually | DevOps |
| **Secret Rotation** | Quarterly | Security |
| **RLS Policy Audit** | Monthly | Security |

---

## Incident Response

### Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|------------|---------------|------------|
| **SEV-1** | Data breach, RLS bypass, production down | 15 min | CTO, Security Lead |
| **SEV-2** | AI completely unavailable, auth broken | 1 hour | Security Lead, Dev Lead |
| **SEV-3** | Single API degraded, non-critical bug | 4 hours | Dev Lead |
| **SEV-4** | Minor issue, cosmetic | Next sprint | Team |

### Runbooks (Planned)

- [ ] **SEV-1: Data Breach** — Contain, assess, notify, remediate
- [ ] **SEV-1: RLS Bypass** — Immediate DB lockdown, audit, patch
- [ ] **SEV-2: AI Provider Outage** — Verify local fallback, status page
- [ ] **SEV-2: Auth Failure** — Check Supabase status, rotate secrets
- [ ] **SEV-3: API Degradation** — Check Vercel/Supabase status, scale

---

## Compliance & Privacy

### Data Classification

| Data Type | Classification | Retention | Encryption |
|-----------|----------------|-----------|------------|
| Business Transactions | Confidential | 7 years (tax law) | At rest + transit |
| Customer PII | Confidential | 7 years | At rest + transit |
| Supplier PII | Confidential | 7 years | At rest + transit |
| Staff Location (GPS) | Sensitive | 90 days | At rest + transit |
| Voice Recordings | Sensitive | 30 days | At rest + transit |
| AI Prompts/Responses | Internal | 90 days | At rest + transit |
| Audit Logs | Confidential | 7 years | At rest + transit |
| Market Intelligence | Internal | 2 years | At rest + transit |

### Pakistan Data Protection (PDPL 2023 Alignment)

| Requirement | Status |
|-------------|--------|
| **Consent** | Implicit via business relationship (B2B) |
| **Purpose Limitation** | ✅ Only for business operations |
| **Data Minimization** | ✅ No unnecessary collection |
| **Storage Limitation** | ✅ Retention policies defined |
| **Security Safeguards** | ✅ RLS, encryption, audit |
| **Breach Notification** | ⚠️ Runbook needed |
| **Data Subject Rights** | ⚠️ Export/delete API planned |
| **Cross-Border Transfer** | ⚠️ Supabase region selection needed |

### GDPR (If EU Customers)

| Right | Implementation |
|-------|----------------|
| Access | `/api/gdpr/export` (planned) |
| Rectification | Profile edit UI |
| Erasure | `/api/gdpr/delete` (planned) |
| Portability | JSON export (planned) |
| Objection | Opt-out flags (planned) |

---

## Security Checklist (Pre-Deployment)

### Critical (Must Pass)

- [ ] All AI API keys rotated and in Vercel Server-only env
- [ ] `.env.local` removed from git history
- [ ] Supabase Service Role key not in client bundle
- [ ] RLS enabled on all 27+ tables
- [ ] Audit triggers on all mutable tables
- [ ] No `service_role` key used in browser code
- [ ] CSP headers configured
- [ ] Rate limiting on `/api/*`
- [ ] Input validation (Zod) on all API routes
- [ ] Security Check 16/16 passing in app

### High (Should Pass)

- [ ] MFA enabled for owner account
- [ ] Vercel WAF managed rules enabled
- [ ] Sentry/LogRocket for error tracking
- [ ] Upstash Ratelimit configured
- [ ] Backup restore tested in last 90 days
- [ ] Secret rotation documented and scheduled
- [ ] Dependency audit (`npm audit fix`) clean

### Medium (Nice to Have)

- [ ] Penetration test completed
- [ ] SAST/DAST in CI/CD
- [ ] Security headers report A+ (securityheaders.com)
- [ ] GDPR/PDPL export/delete endpoints
- [ ] Vulnerability disclosure policy published

---

## Security Contacts

| Role | Contact | Responsibility |
|------|---------|----------------|
| **Security Lead** | [TBD] | Overall posture, incidents |
| **DevOps** | [TBD] | Infrastructure, secrets, DR |
| **DPO** | [TBD] | Privacy, compliance, PDPL/GDPR |
| **On-Call** | [TBD] | SEV-1/2 response |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-15 | Architecture Team | Initial comprehensive security doc |

---

**Classification**: INTERNAL — Do not distribute outside OP OWNER team  
**Next Review**: 2026-10-15 or after any SEV-1/2 incident
