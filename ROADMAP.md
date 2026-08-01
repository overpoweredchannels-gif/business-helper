# OP OWNER — Roadmap (Canonical Source)

> **This is the single authoritative planning document. Updated each sprint. "Planned" = designed, not implemented.**

---

## ✅ Completed

### Foundation (v0.1 - v0.5)

| Milestone | Version | Description |
|-----------|---------|-------------|
| Next.js 16 + Turbopack Setup | v0.1 | App Router, TypeScript strict, Tailwind 4, ESLint 9 |
| Supabase Integration | v0.2 | PostgreSQL, Auth, RLS policies, organization isolation |
| Core CRUD Modules | v0.3 | Products, Brands, Categories, Customers, Suppliers |
| Purchase Management | v0.4 | Multi-line invoices, batch/expiry, expense review workflow |
| Sales Management | v0.4 | Cash/credit invoices, credit limit snapshots, due dates |
| Inventory Tracking | v0.4 | Real-time stock, low/out-of-stock alerts, batch/expiry |
| Payment Allocation | v0.5 | Customer payments (FIFO), Supplier payments, running ledgers |
| Expense Tracking | v0.5 | Categorized expenses, purchase invoice linking |
| Profit & Loss | v0.5 | Period-based P&L with drill-down |
| Customer Credit | v0.5 | Aging buckets, overdue tracking, limit utilization |
| Supplier Ledger | v0.5 | Chronological debit/credit, running balance |
| Task Manager | v0.6 | CRUD, AI suggestions, priorities, relations, filtering |
| Audit Logging | v0.6 | Immutable logs on all entities, filters, expandable details |
| Staff & Permissions | v0.6 | 6 roles, 11 granular permissions, UI management |
| Staff Duty (GPS) | v0.7 | Duty sessions, location breadcrumbs, stop detection (V1) |
| PWA Configuration | v0.7 | Manifest, icons, standalone mode, install prompts |
| Business Settings | v0.7 | Org details, invoice footer, default payment terms |
| Security Checklist | v0.8 | 16-point production readiness verification |
| Deployment Readiness | v0.8 | Vercel checklist, env validation, manual test steps |

### Intelligence Layer (v0.9)

| Milestone | Version | Description |
|-----------|---------|-------------|
| Multi-Provider AI Router | v0.9 | 4 configured providers (5 supported: Gemini, OpenAI, xAI, Z.ai/GLM, Groq supported but not in configured order), fallback chain |
| AI Business Query API | v0.9 | Natural language Q&A, Analytics Explainer mode, local fallback |
| Market Intelligence API | v0.9 | 14-category analysis, threat/opportunity detection, scoring |
| Market Intelligence UI | v0.9 | Import queue, AI analysis review, intelligence items |
| AI Voice Operator Schema | v0.9 | Sessions, messages, intent detection, action routing |
| AI Action Drafts Schema | v0.9 | Multi-turn confirmation flow, execution tracking |

---

## 🔄 Current Phase (v1.0 — "Owner Control")

**Goal**: Production-hardened, owner-validated, deployment-ready.

| Milestone | Target | Status | Notes |
|-----------|--------|--------|-------|
| **Server Actions for Mutations** | Week 1-2 | 🟡 In Progress | Replace client-side Supabase writes with server actions + validation |
| **Zod Validation on All APIs** | Week 1 | 🟡 Planned | Input schemas for `/api/*`, server actions |
| **Error Boundaries** | Week 1 | 🟡 Planned | Per-section boundaries, graceful degradation |
| **React Query / SWR** | Week 2 | 🟡 Planned | Replace manual `useState` fetching, caching, deduping |
| **Code Splitting** | Week 2 | 🟡 Planned | Dynamic imports for 27 sections, reduce bundle |
| **Virtualized Tables** | Week 3 | 🟡 Planned | Audit logs, inventory, transactions (react-window) |
| **AI Streaming Responses** | Week 3 | 🟡 Planned | Vercel AI SDK `streamText` for perceived speed |
| **Rate Limiting on AI APIs** | Week 1 | 🟡 Planned | Upstash Ratelimit per organization |
| **CSP / Security Headers** | Week 1 | 🟡 Planned | `next.config.ts` headers |
| **Secret Rotation** | Immediate | 🔴 Critical | Rotate ALL keys in `.env.local`, move to Vercel Env |
| **CI/CD Pipeline** | Week 2 | 🟡 Planned | GitHub Actions: lint, typecheck, build, test |
| **Unit Tests (Core)** | Week 3 | 🟡 Planned | Validators, formatters, provider router logic |
| **E2E Tests (Critical Flows)** | Week 4 | 🟡 Planned | Purchase→Sale→Payment→P&L |
| **Owner UAT Sign-off** | Week 4 | 🟡 Planned | Real business data, Pakistani context |

---

## 🚀 Next Phase (v1.1 — "Voice & Intelligence")

**Goal**: Voice interaction, automated intelligence, daily insights.

| Milestone | Target | Dependencies |
|-----------|--------|--------------|
| **AI Voice Operator (Full)** | Month 1-2 | Server actions, WebRTC, STT/TTS selection |
| **Wake Word + Mobile Shortcut** | Month 2 | PWA, microphone permission, service worker |
| **AI Action Draft Execution** | Month 1 | Server actions, confirmation UI, audit trail |
| **Daily AI Briefing (Cron)** | Month 1 | Vercel Cron / Upstash QStash, push notifications |
| **Automated Market Ingestion** | Month 2 | RSS feeds (DAWN, Business Recorder), NewsAPI, dedup |
| **Anomaly Detection Alerts** | Month 2 | Statistical models on sales/expenses, threshold config |
| **Predictive Reorder Suggestions** | Month 3 | Sales velocity + lead time + safety stock |
| **Customer Churn Risk Scoring** | Month 3 | Recency, frequency, monetary (RFM) on customer data |
| **Margin Optimization Alerts** | Month 3 | Price elasticity from historical changes |
| **WhatsApp Business API (Read)** | Month 2-3 | Inbound message parsing → task/lead creation |

---

## 🔮 Future Phase (v1.5 — "Ecosystem")

**Goal**: Portals, integrations, compliance, multi-org.

| Milestone | Target | Notes |
|-----------|--------|-------|
| **Supplier Portal** | Quarter 3 | Self-service invoices, payment status, PO acceptance |
| **Customer Portal** | Quarter 3 | Order history, statements, credit limit view |
| **Bank Reconciliation** | Quarter 3 | Statement upload → auto-match payments |
| **GST / FBR Integration** | Quarter 3 | Pakistan tax compliance, e-invoicing (planned mandate) |
| **Multi-Organization** | Quarter 4 | Franchise, group companies, consolidated reporting |
| **Third-Party API** | Quarter 4 | Tally, QuickBooks, ERPNext sync |
| **White-Label Distribution** | Quarter 4 | Principals/distributors deploy branded instance |
| **Advanced BI** | Quarter 4 | Customer LTV, supplier scorecards, demand forecasting |

---

## 🏢 Enterprise Phase (v2.0+ — "Platform")

**Goal**: AI agents, federated intelligence, financial services.

| Milestone | Horizon | Vision |
|-----------|---------|--------|
| **AI Agent Swarm** | Year 2 | Specialized agents: Negotiator, Forecaster, Optimizer, Reconciler |
| **Federated Market Intelligence** | Year 2 | Anonymized cross-org price/margin benchmarks |
| **Embedded Finance** | Year 2-3 | Lending/insurance based on verified trade data |
| **Trade Data Protocol** | Year 3 | Open standard for B2B transaction exchange |
| **Global Expansion** | Year 3+ | UAE, KSA, Bangladesh — local tax, currency, language |

---

## Milestone Dependency Graph

```mermaid
gantt
    title OP OWNER Roadmap Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  %b %Y
    
    section Foundation (Done)
    Core ERP           :done,    f1, 2025-01-01, 90d
    AI Router + APIs   :done,    f2, 2025-04-01, 60d
    Security + Deploy  :done,    f3, 2025-06-01, 30d
    
    section Current (v1.0)
    Server Actions     :active,  c1, 2025-07-15, 14d
    Validation + Tests :active,  c2, 2025-07-15, 21d
    Performance        :active,  c3, 2025-07-22, 14d
    CI/CD + Secrets    :active,  c4, 2025-07-15, 7d
    UAT                :active,  c5, 2025-08-05, 14d
    
    section Next (v1.1)
    Voice Operator     :planned, n1, 2025-08-15, 60d
    Daily Briefing     :planned, n2, 2025-08-15, 30d
    Market Automation  :planned, n3, 2025-09-01, 45d
    Predictive AI      :planned, n4, 2025-10-01, 60d
    
    section Future (v1.5)
    Portals            :planned, fu1, 2025-10-01, 90d
    Compliance         :planned, fu2, 2025-11-01, 60d
    Multi-Org          :planned, fu3, 2026-01-01, 90d
    
    section Enterprise (v2.0)
    Agent Swarm        :planned, e1, 2026-04-01, 180d
    Federated Intel    :planned, e2, 2026-07-01, 180d
    Embedded Finance   :planned, e3, 2026-10-01, 180d
```

---

## Release Cadence

| Channel | Frequency | Criteria |
|---------|-----------|----------|
| **Canary** | Daily | Every main merge, auto-deploy to preview |
| **Staging** | Weekly | Friday, full test suite pass |
| **Production** | Bi-weekly | Owner sign-off, security check pass |
| **Hotfix** | As needed | Critical bug, security issue |

---

## Success Metrics (v1.0 Launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Build Time** | < 3 min | Turbopack production build |
| **API Latency (p95)** | < 500ms | Vercel Analytics |
| **AI Query Latency** | < 10s | Provider router telemetry |
| **Bundle Size** | < 500KB gz | `next build` output |
| **Test Coverage** | > 60% | Critical paths (payments, inventory, AI) |
| **Security Score** | 16/16 | Security Check checklist |
| **Owner NPS** | > 8/10 | Post-UAT survey |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Single-page bundle too large | High | Medium | Code splitting (Week 2) |
| AI provider API changes | Medium | High | Version pinning, abstraction layer |
| Supabase RLS bypass | Low | Critical | Security Check + pentest |
| Secrets leaked | Medium | Critical | Immediate rotation, Vercel Env only |
| No test coverage | High | High | CI pipeline + core tests (Week 2-3) |
| Owner UAT reveals gaps | Medium | High | Early prototype sessions, iterative |
| Pakistan regulatory change | Low | High | Modular tax/compliance layer |

---

## Resource Requirements

| Role | Current | v1.0 | v1.1 | v1.5 |
|------|---------|------|------|------|
| **Full-Stack Engineer** | 1 | 2 | 3 | 5 |
| **AI/ML Engineer** | 0 | 0 | 1 | 3 |
| **DevOps/SRE** | 0 | 0.5 | 1 | 2 |
| **QA/Automation** | 0 | 0.5 | 1 | 2 |
| **Product/Owner Proxy** | 1 | 1 | 1 | 1 |
| **Designer (UX/UI)** | 0 | 0.25 | 0.5 | 1 |

---

## Budget Considerations (Monthly)

| Service | Current | v1.0 | v1.1 | v1.5 |
|---------|---------|------|------|------|
| **Vercel Pro** | $20 | $20 | $50 | $150 |
| **Supabase Pro** | $25 | $25 | $599 | $1999 |
| **AI APIs (4 configured / 5 supported)** | $50 | $100 | $500 | $2000 |
| **Upstash (Redis/Queue/Ratelimit)** | $0 | $10 | $50 | $200 |
| **Monitoring (Sentry/Datadog)** | $0 | $26 | $100 | $500 |
| **Total** | ~$95 | ~$181 | ~$1,299 | ~$4,849 |

---

## Decision Gates

| Gate | Criteria | Next Phase |
|------|----------|------------|
| **v1.0 Launch** | 16/16 Security, CI green, UAT pass, secrets rotated | v1.1 Voice |
| **v1.1 Voice** | Voice operator > 80% intent accuracy, < 3s latency | v1.5 Ecosystem |
| **v1.5 Ecosystem** | 3+ portal users, FBR integration live | v2.0 Platform |
| **v2.0 Platform** | Agent swarm ROI positive, federated data > 100 orgs | Scale |

---

## Long-Term Vision (5 Years)

> **OP OWNER becomes the nervous system of Pakistani trade.**

- **10,000+ businesses** on platform
- **Real-time price discovery** across wholesale markets
- **AI-negotiated** supplier contracts
- **Instant credit** based on verified trade history
- **Cross-border** (Pakistan ↔ UAE ↔ KSA) seamless
- **Regulatory auto-compliance** (FBR, SECP, Provincial)
- **Open protocol** adopted by Tally, ERPNext, QuickBooks

---

*Last Updated: 2025-07-15 | Version: 0.9 (Pre-v1.0)*