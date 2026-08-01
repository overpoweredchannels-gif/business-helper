# OP OWNER — Project Context (Canonical Source)

> **This is the single authoritative document for project vision, business philosophy, target customers, industry focus, core modules, and development principles. All other documents reference this.**

---

## Project Vision

**OP OWNER** is the operating system for Pakistani wholesale and trading businesses. It replaces fragmented spreadsheets, WhatsApp threads, and memory with a single system where:

- Every transaction is recorded once and used everywhere
- AI answers business questions in the owner's language (Urdu, Roman Urdu, English)
- Market intelligence is analyzed for local FMCG context
- Voice interaction works on the shop floor
- The owner retains full control — AI suggests, owner decides

**Core Promise**: "Tumhara business, tumhara control, AI tumhara sahayak." (Your business, your control, AI your assistant.)

---

## Business Philosophy

| Principle | Description |
|-----------|-------------|
| **Owner Sovereignty** | AI never executes without explicit confirmation. Drafts only. |
| **Data Truth** | AI answers ONLY from recorded business data. Never hallucinates. |
| **Local First** | Pakistani Rupee, Urdu terminology, FMCG categories, local tax context. |
| **Progressive Disclosure** | Simple by default, powerful when needed. No feature bloat. |
| **Offline-Resilient** | PWA-first, works on mobile data, syncs when online. |
| **Audit Everything** | Every action traceable. No silent mutations. |

---

## Target Customers

| Segment | Characteristics | Pain Points |
|---------|----------------|-------------|
| **Wholesale Distributors** | 5-50 SKUs, 50-500 customers, credit-based | Credit tracking, stockouts, supplier payables |
| **General Trade / Kiryana Suppliers** | High volume, low margin, daily deliveries | Cash flow, expense tracking, route management |
| **Commission Agents / Arthis** | Multi-principal, settlement complexity | Principal-wise ledgers, commission calc |
| **Small Manufacturers** | Raw material → finished goods | BOM, batch tracking, costing |

**Geography**: Pakistan (primary), UAE/Diaspora (secondary)

---

## Industry Focus

**Primary**: FMCG Trading — Cooking Oil/Ghee, Sugar, Wheat Flour, Rice, Pulses, Spices, Beverages, Dairy, Packaging

**Secondary**: Fuel/Transport, Currency/Import-linked goods, Agriculture inputs

**Market Intelligence Categories** (14 tracked — defined in `src/lib/tradeos/constants.ts`):

1. Cooking Oil & Ghee (`cooking_oil_ghee`)
2. Sugar (`sugar`)
3. Wheat Flour (`wheat_flour`)
4. Rice (`rice`)
5. Pulses (`pulses`)
6. Spices (`spices`)
7. Beverages (`beverages`)
8. Dairy (`dairy`)
9. Fuel & Transport (`fuel_transport`)
10. Packaging (`packaging`)
11. Currency & Imports (`currency_imports`)
12. Taxes & Policy (`taxes_policy`)
13. Weather & Agriculture (`weather_agriculture`)
14. General FMCG (`general_fmcg`)

---

## Core Modules (Implemented)

### 1. Product Catalog
- Hierarchical categories (parent → child)
- Brands
- Units (carton, piece, kg, liter, etc.)
- Batch tracking toggle (`track_batch`)
- Expiry tracking toggle (`track_expiry`)
- Last purchase price, default selling price
- Min stock level, reorder level

### 2. Customer Management
- Customer name, shop name
- Phone, WhatsApp, city, area
- Customer type (wholesale, retail, institutional)
- Credit policy (strict, flexible, custom)
- Credit limit, credit days
- Over-limit allowance, overdue-sale allowance
- Preferred payment method

### 3. Supplier Management
- Supplier name, contact person
- Phone, WhatsApp, city
- Notes

### 4. Purchase Management
- Multi-line invoices
- Per-line: product, quantity, purchase price, selling price, batch, expiry
- Expense review workflow (pending → reviewed)
- Supplier invoice number tracking
- Purchase date vs created date

### 5. Sales Management
- Cash / Credit sales
- Credit due date, credit limit snapshot at sale time
- Multi-line with batch/expiry selection
- Customer payment allocation (FIFO by default)

### 6. Inventory
- Real-time stock from purchase/sales/expense movements
- Low stock alerts (≤ reorder level)
- Out of stock alerts (= 0)
- Batch/expiry visibility

### 7. Payments & Ledgers
- **Customer Payments**: Multi-invoice allocation, running balance
- **Supplier Payments**: Purchase invoice allocation, running ledger
- **Expenses**: Categorized, linkable to purchase invoices

### 8. Profit & Loss
- Period-based (monthly, custom range)
- Revenue, COGS, gross profit, expenses, net profit
- Drill-down to transaction level

### 9. Customer Credit
- Aging buckets (current, 30, 60, 90+ days)
- Overdue highlighting
- Credit limit utilization

### 10. Supplier Ledger
- Chronological debit/credit entries
- Running balance
- Purchase vs payment allocation

---

## AI Systems (Implemented)

### 1. AI Business Query (`/api/ai-business-query`)
**Purpose**: Answer business questions from live data.

**Two Modes**:
- **General Assistant**: Practical owner answers (totals, trends, alerts)
- **Analytics Explainer**: Structured Evidence → Recommendations → Confidence

**Input**: question, language, query_type, date_range, business_summary (JSON)

**Output**: `{ answer, query_type, language, key_points[], warnings[] }`

**Provider Router**: 4 configured providers (5 supported), fallback chain, local fallback if all fail.

**Critical Rule**: "Answer ONLY from provided business_summary. If data missing, say so."

### 2. Market Intelligence Analysis (`/api/market-intelligence/analyze`)
**Purpose**: Convert owner-provided market signals into structured business impact analysis.

**Input**: title, summary, raw_text, source, category, country, business_context

**Output**: 30+ fields including:
- Market category, impact direction/level, confidence
- Threat detection (price up, shortage, demand shift, currency, tax, weather, transport)
- Opportunity detection (high demand, cheaper inventory, supplier opportunity, margin improvement)
- Risk score (0-100), Opportunity score (0-100)
- Urgency (Very High → Monitor)
- Affected business areas, products, categories
- Suggested owner actions (increase inventory, delay purchasing, review pricing, etc.)
- Business health impact (Positive/Neutral/Negative/Mixed)
- Executive summary, why it matters

### 3. AI Voice Operator (Schema Only — Planned Implementation)
**Tables**: `ai_voice_operator_sessions`, `ai_voice_operator_messages`
**Fields**: session_title, language, status, role, message_type, detected_intent, routed_to, related_*_ids
**Planned**: WebRTC + STT → LLM → TTS loop with intent routing to action drafts

### 4. AI Action Drafts (Schema Only — Planned Implementation)
**Purpose**: Multi-turn conversation to build confirmed actions before execution.

**Flow**: Command → Parsed Draft → Missing Fields → Follow-up Q/A → Owner Confirmation → Execute → Log

**Tables**: `ai_action_drafts`, `ai_action_messages`

**Status Flow**: `draft` → `needs_info` → `ready_to_execute` → `executed` | `cancelled` | `failed`

---

## Operational Modules (Implemented)

| Module | Key Capabilities |
|--------|------------------|
| **Task Manager** | CRUD, AI-suggested tasks, 9 types, 4 priorities, 4 statuses, relations |
| **Activity Logs** | Full audit trail, filters (entity, action, date, search), expandable details |
| **Staff & Permissions** | 6 roles, 11 granular permissions, UI management, profile linking to auth |
| **Staff Duty (GPS V1)** | Duty sessions, location breadcrumbs, stop detection (50m/5min), map links |
| **Security Check** | 16-point production readiness verification |
| **Deployment** | Vercel checklist, env validation, manual test steps |
| **Business Settings** | Org details, invoice footer, default payment terms |
| **Mobile App (PWA)** | Manifest, icons, standalone mode, install guides, roadmap |

---

## Architecture Summary

> **See [ARCHITECTURE.md](ARCHITECTURE.md) for complete technical architecture.**

- **Frontend**: Next.js 16 App Router (React 19), single-page at `/` with 27 conditional sections
- **Backend**: API Routes (Node.js runtime) for AI endpoints; Server Actions planned for mutations
- **Database**: Supabase (PostgreSQL) with Row Level Security on all 27+ tables
- **Auth**: Supabase Auth (email/password), JWT with `organization_id` custom claim
- **AI Layer**: 4 configured providers (5 supported) — Gemini, OpenAI, xAI/Grok, Z.ai/GLM (Groq supported but not in configured order) with fallback chain
- **PWA**: Manifest + icons configured; Service Worker planned

---

## Database Schema (27+ Tables)

> **See [ARCHITECTURE.md](ARCHITECTURE.md) for complete schema with RLS policies.**

All tables scoped by `organization_id`. Key tables:
- Core: `organizations`, `profiles`, `staff_permissions`
- Catalog: `products`, `brands`, `categories`
- Parties: `customers`, `suppliers`
- Transactions: `purchase_transactions`, `purchase_items`, `sales_transactions`, `sales_items`
- Payments: `customer_payments`, `customer_payment_allocations`, `supplier_payments`, `supplier_payment_allocations`
- Operations: `expenses`, `tasks`, `audit_logs`
- AI: `ai_business_query_logs`, `market_import_queue`, `market_intelligence_items`, `market_ai_analyses`, `ai_voice_operator_sessions`, `ai_voice_operator_messages`, `ai_action_drafts`, `ai_action_messages`, `ai_alerts`, `ai_daily_briefings`
- Security: `security_checks`
- Mobile: `staff_duty_sessions`, `staff_location_points`

---

## Authentication & Authorization

> **See [SECURITY.md](SECURITY.md) for complete security model.**

- **Auth**: Supabase Auth (email/password), JWT in httpOnly cookie
- **Org Link**: `profiles.organization_id` → `organizations.id`
- **Owner**: First user in organization = owner (implicit)
- **Permissions**: 11 granular permissions, 6 roles (owner, admin, manager, staff, accountant, sales)
- **RLS**: Primary enforcement — every query filtered by `organization_id = current_org_id()`

---

## Development Principles

| Principle | Application |
|-----------|-------------|
| **Type Safety First** | All DB types in `types.ts`, strict TS, no `any` |
| **Server-First** | RSC by default, client only for interactivity |
| **RLS Enforced** | Never trust client; Supabase RLS is the security boundary |
| **Owner Confirmation** | No AI action executes without explicit owner approval |
| **Audit by Default** | Every mutation → audit_logs via trigger |
| **Local Fallback** | AI degrades gracefully to local summary |
| **Language Agnostic** | Urdu/Roman Urdu/English in all AI prompts |
| **Pakistani Context** | PKR, FMCG categories, local terminology in prompts |

---

## Coding Standards

### TypeScript
- Strict mode enabled
- Interfaces in `src/lib/tradeos/types.ts`
- Path alias: `@/*` → `src/*`
- No `any` — use `unknown` + narrowing

### React/Next.js
- Server Components default
- `'use client'` only for: state, effects, browser APIs, event handlers
- Props typed with interfaces
- No inline styles — Tailwind classes only

### API Routes
- `export const runtime = 'nodejs'`
- Zod validation (planned) on all inputs
- Structured error responses: `{ ok: false, error, details?, attempts? }`
- Success: `{ ok: true, provider, model, result, raw? }`

### Database
- All queries scoped to `organization_id` (via RLS)
- UUIDs for all primary keys (except products: serial)
- Timestamps: `created_at`, `updated_at` (auto)
- Soft deletes via `status` field (active/archived)

### Naming Conventions
| Element | Convention |
|---------|------------|
| Tables | snake_case, plural (`purchase_transactions`) |
| Columns | snake_case (`customer_id`, `created_at`) |
| Types | PascalCase, singular (`PurchaseTransaction`) |
| API Routes | kebab-case (`ai-business-query`) |
| Env Vars | UPPER_SNAKE_CASE (`GEMINI_API_KEY`) |
| Components | PascalCase (`TaskManager.tsx`) |
| Hooks/Utils | camelCase (`useAuth`, `formatPKR`) |

---

## Performance Principles

| Area | Target | Strategy |
|------|--------|----------|
| **Initial Load** | < 3s | Turbopack, code splitting (planned), PWA caching |
| **AI Query** | < 10s | Provider timeout 20s, parallel attempts, streaming (planned) |
| **Dashboard** | < 1s | Materialized views, indexed queries |
| **Tables** | 1000+ rows | Virtualization (planned: react-window) |
| **Bundle** | < 500KB gz | Dynamic imports for heavy sections |
| **Database** | < 100ms p95 | Proper indexes, connection pooling |

---

## UX Philosophy

| Guideline | Detail |
|-----------|--------|
| **Urdu-First Language** | All AI prompts support Urdu/Roman Urdu; UI English with Urdu labels planned |
| **Mobile-First** | PWA installable, touch targets 48dp, responsive tables |
| **Owner Mental Model** | Terminology: "Customer" not "Client", "Purchase" not "Procurement", "Stock" not "Inventory" |
| **Progressive Disclosure** | Dashboard → Section → Detail → Action |
| **Confirmation Over Prevention** | Allow draft states, confirm before commit |
| **Offline Awareness** | Show sync status, queue mutations locally |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main dashboard (all 27 sections, single-page app) |
| `src/lib/ai/provider-router.ts` | Multi-provider AI fallback logic |
| `src/app/api/ai-business-query/route.ts` | Business Q&A API |
| `src/app/api/market-intelligence/analyze/route.ts` | Market analysis API |
| `src/lib/supabase/client.ts` | Supabase browser client |
| `src/lib/tradeos/types.ts` | All TypeScript interfaces |
| `src/lib/tradeos/constants.ts` | Navigation, permissions, enums, market categories |
| `src/lib/tradeos/formatters.ts` | PKR, dates, distance, CSV |
| `src/lib/tradeos/validators.ts` | UUID, number, text validation |
| `tradeos-schema.sql` | Database schema reference |

---

## Decision Log (Architectural)

| Decision | Rationale | Revisit When |
|----------|-----------|--------------|
| Single-page app | Simplicity, no routing complexity, owner sees everything | Bundle > 1MB or section count > 40 |
| Supabase RLS only | Proven, scales, no custom auth server | Multi-org or complex hierarchies |
| 5 AI providers | Resilience, cost optimization, model diversity | New SOTA model release |
| Local AI fallback | Business continuity during outages | N/A — keep forever |
| No Zod yet | Speed to MVP | First production bug from bad input |
| PWA not native | Reach, cost, update speed | App Store requirement |

---

## Contact

**Project**: OP OWNER  
**Repository**: Private  
**Stack**: Next.js 16, React 19, Supabase, Tailwind 4, TypeScript 5