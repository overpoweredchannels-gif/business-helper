# OP OWNER

> **Business Operating System for Pakistani Wholesalers, Traders & Distributors**

OP OWNER is an AI-powered business operating system under active development for Pakistani wholesale and trading businesses. It combines ERP functionality with AI analytics, voice interaction, and market intelligence.

**Current assessment (2026-09-05): late MVP / pre-production hardening.** Local build and regression checks pass, but production readiness is not yet verified. See [the development audit](docs/DEVELOPMENT_AUDIT_2026-09-05.md) for evidence, fixes, and outstanding release gates.

---

## Vision

To become the definitive operating system for Pakistani trading businesses — where every decision is data-driven, every operation is streamlined, and AI acts as a trusted co-pilot that understands local business context, language, and market dynamics.

**Core Promise**: *"Tumhara business, tumhara control, AI tumhara sahayak."* (Your business, your control, AI your assistant.)

---

## Quick Start

```bash
# Clone and install
git clone <repository-url>
cd tradeos
npm install

# Configure environment (see Environment Variables below)
cp .env.example .env.local

# Run development server
npm run dev
# Open http://localhost:3000
```

---

## Environment Variables

Create `.env.local` in the project root:

```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key

# AI Providers (At least one required)
GEMINI_API_KEY=your-gemini-key
GEMINI_PRIMARY_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite

OPENAI_API_KEY=your-openai-key
OPENAI_PRIMARY_MODEL=gpt-5.4-mini
OPENAI_FALLBACK_MODEL=gpt-5.4-nano

XAI_API_KEY=your-xai-key
XAI_PRIMARY_MODEL=grok-4.5
XAI_FALLBACK_MODEL=grok-4.5

GROQ_API_KEY=your-groq-key
GROQ_PRIMARY_MODEL=llama-3.3-70b-versatile
GROQ_FALLBACK_MODEL=llama-3.1-8b-instant

ZAI_API_KEY=your-zai-key
ZAI_BASE_URL=https://api.z.ai
ZAI_PRIMARY_MODEL=GLM-5.2
ZAI_FALLBACK_MODEL=GLM-4.5-Air

# AI Router Configuration
AI_PROVIDER_ORDER=gemini,openai,xai,zai
AI_MAX_RETRIES_PER_PROVIDER=1
AI_PROVIDER_TIMEOUT_MS=20000
AI_ENABLE_LOCAL_FALLBACK=true
```

> **Security**: Never commit `.env.local`. Use Vercel Environment Variables for production. See [SECURITY.md](SECURITY.md#secrets-management).

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16.3.3 (App Router, Turbopack) |
| **Runtime** | React 19.2.4, Node.js (API routes) |
| **Styling** | Tailwind CSS 4 (PostCSS) |
| **Database** | Supabase (PostgreSQL) with Row Level Security |
| **Authentication** | Supabase Auth (email/password, org-based RLS) |
| **AI Providers** | 4 configured providers via custom router: Gemini, OpenAI, xAI/Grok, Z.ai/GLM (Groq supported but not in configured order) |
| **AI Router** | Custom fallback chain with retry, timeout, JSON parsing; default order: gemini,openai,groq — overridden by env |
| **PWA** | Manifest + icons configured; Service Worker planned (next-pwa not installed) |
| **TypeScript** | Strict mode, path aliases (`@/*`) |
| **Linting** | ESLint 9 + Next.js config |
| **Build** | Turbopack (dev), Next.js build (prod) |

---

## Features Overview

### Core Business Modules
- **Products** — Full CRUD, brands, hierarchical categories, batch/expiry tracking, stock levels, reorder points
- **Customers** — Profiles, credit limits, payment terms, credit policies, shop details, contact management
- **Suppliers** — Profiles, contact persons, payment tracking, city-based organization
- **Purchases** — Invoice creation with line items, expense review workflow, batch/expiry per line
- **Sales** — Cash/credit invoices, credit limit snapshots, payment terms, due date tracking
- **Inventory** — Real-time stock, low stock alerts, out-of-stock tracking, batch/expiry visibility
- **Customer Payments** — Multi-invoice allocation, payment methods, outstanding balances
- **Supplier Payments** — Purchase invoice allocation, running ledger, payable tracking
- **Expenses** — Categorized expense tracking with purchase invoice linking
- **Profit & Loss** — Period-based P&L with drill-down capability
- **Customer Credit** — Aging analysis, overdue tracking, credit limit enforcement
- **Supplier Ledger** — Running balance, debit/credit entries, allocation history

### Intelligence & AI Modules
- **AI Business Query** — Natural language Q&A on business data (Urdu/English/Roman Urdu)
- **AI Analytics** — AI-powered insights and trend analysis
- **AI Voice Operator** — Voice-based interaction sessions with intent detection
- **Market Intelligence** — News ingestion, AI analysis, threat/opportunity detection
- **Business Intelligence** — Dashboard KPIs, analytics, reporting

### Operational Modules
- **Task Manager** — CRUD, AI-suggested tasks, filtering, priorities, relations
- **Activity Logs** — Full audit trail with filters, search, expandable details
- **Staff & Permissions** — 6 roles, 11 granular permissions per staff member
- **Staff Duty** — GPS-tracked duty sessions, location history, stop detection
- **Security Check** — 16-point production readiness checklist
- **Deployment** — Vercel deployment checklist, environment validation
- **Business Settings** — Organization details, invoice footer, default payment terms
- **Mobile App** — PWA readiness, install guides, mobile roadmap

---

## Documentation Map

| Document | Purpose | Audience |
|----------|---------|----------|
| **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** | Canonical vision, business philosophy, target customers, industry focus, core modules, architecture overview, database schema, auth/permissions, AI systems, voice system, market intelligence, BI, development principles, coding standards, performance principles, UX philosophy, key files, decision log | Product, Engineering, AI, New Team Members |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture diagrams, frontend/backend/Supabase/AI/voice/market intelligence/BI/mobile architectures, data flow diagrams, security architecture, deployment architecture, scaling considerations, technology decisions log | Engineering, Architecture, DevOps |
| **[SECURITY.md](SECURITY.md)** | Security principles, authentication, authorization (RLS + server-side), database security, API security, AI security, secrets management, network security, logging/monitoring, backup/DR, incident response, compliance (PDPL/GDPR), pre-deployment checklist | Security, Engineering, DevOps, Compliance |
| **[AI_RULES.md](AI_RULES.md)** | Binding rules for ALL AI systems: truth/data integrity, action/mutation safety, permissions, language/localization, market intelligence, voice operator, analytics, provider router, error handling, continuous improvement, decision tree, enforcement | AI Engineering, Product, QA |
| **[ROADMAP.md](ROADMAP.md)** | Completed milestones, current phase (v1.0), next phase (v1.1), future phase (v1.5), enterprise phase (v2.0+), Gantt chart, release cadence, success metrics, risk register, resource/budget estimates, decision gates, 5-year vision | Product, Engineering, Leadership |
| **[CHANGELOG.md](CHANGELOG.md)** | Chronological record of all major milestones with version, date, feature, description, impact | Engineering, Product, Stakeholders |

---

## Project Structure

```
tradeos/
├── .env.local                    # Environment variables (not committed)
├── .gitignore
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── tsconfig.json
├── tradeos-schema.sql            # Database schema reference
├── public/                       # Static assets, PWA manifest, icons
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ai-business-query/route.ts      # AI Business Query API
│   │   │   └── market-intelligence/analyze/route.ts  # Market Intelligence API
│   │   ├── globals.css
│   │   ├── layout.tsx                          # Root layout, PWA metadata
│   │   └── page.tsx                            # Main dashboard (single-page app)
│   └── lib/
│       ├── ai/
│       │   └── provider-router.ts              # Multi-provider AI router
│       ├── supabase/
│       │   └── client.ts                       # Supabase browser client
│       └── tradeos/
│           ├── constants.ts                    # Navigation, permissions, enums
│           ├── formatters.ts                   # PKR formatting, date helpers
│           ├── types.ts                        # All TypeScript interfaces
│           └── validators.ts                   # Validation utilities
```

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel Dashboard
4. Deploy

**Required Vercel Environment Variables:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- At least one AI provider key (e.g., `GEMINI_API_KEY`)

### Pre-Deployment Checklist

See [SECURITY.md](SECURITY.md#security-checklist-pre-deployment) for the complete 16-item security checklist.

---

## Contributing

### Development Principles

1. **Owner-First** — Every feature serves the business owner's decision-making
2. **No Hallucination** — AI must only use provided business data
3. **Local Context** — Pakistani Rupee, Urdu/Roman Urdu, FMCG terminology
4. **Confirmation Required** — No autonomous mutations without owner approval
5. **Audit Everything** — All actions logged with full context

### Code Standards

- TypeScript strict mode
- Path aliases: `@/*` → `src/*`
- Tailwind CSS for styling
- Server Components by default, Client Components only when needed
- Zod for validation (planned)
- ESLint + Prettier

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `npm run lint` and `npm run build`
4. Submit PR with description
5. Code review required
6. Squash merge to `main`

---

## License

Private — All rights reserved.
