# OP OWNER — Changelog (Canonical Source)

> **This is the single authoritative historical record. Chronological order. Format: `Version — Date — Feature — Description — Impact`**

---

## v0.9 — 2025-07-10 — AI Intelligence Layer

| Feature | Description | Impact |
|---------|-------------|--------|
| **Multi-Provider AI Router** | 5 providers (Gemini, OpenAI, xAI, Groq, Z.ai) with priority fallback, retry, timeout, JSON parsing, local fallback | AI resilience; no single point of failure; cost optimization via provider diversity |
| **AI Business Query API** | `/api/ai-business-query` — Natural language Q&A on live business data; two modes: General Assistant + Analytics Explainer; Urdu/English/Roman Urdu support | Owner asks questions in plain language; gets structured answers with evidence, recommendations, confidence |
| **Market Intelligence Analysis API** | `/api/market-intelligence/analyze` — 14-category FMCG analysis, 30+ output fields (threats, opportunities, scores, urgency, actions, health impact) | Owner pastes news/supplier msg → gets structured business impact analysis |
| **Market Intelligence UI** | Import queue → AI analysis review → Intelligence items (Active/Watching/Archived); example chips for quick entry | End-to-end market signal capture → analysis → actionable intelligence |
| **AI Voice Operator Schema** | `ai_voice_operator_sessions`, `ai_voice_operator_messages` with intent detection, action routing | Foundation for voice-first interaction |
| **AI Action Drafts Schema** | `ai_action_drafts`, `ai_action_messages` — Multi-turn confirmation flow (draft → needs_info → ready → executed) | Safe AI actions: owner confirms before execution |

---

## v0.8 — 2025-06-25 — Production Readiness

| Feature | Description | Impact |
|---------|-------------|--------|
| **Security Checklist (16 Items)** | App loads, owner linked, org isolation, child table security, staff permissions UI, all CRUD flows, dashboard/reports, print/export, build passes, deployment ready | Systematic pre-launch verification; owner can confirm each item |
| **Deployment Readiness** | Local build commands, Vercel env vars checklist, GitHub push, deployment test checklist (12 items), mobile install test, pre-launch warnings | Zero-surprise production deployment |
| **Staff Duty GPS Tracking V1** | Duty sessions with start/end location, continuous breadcrumb capture, accuracy/speed/heading, stop detection (50m/5min), map links | Field staff accountability; location history for verification |
| **Mobile App Readiness** | PWA manifest, icons, standalone mode, install guides (Android/iOS), roadmap items (live tracking, voice shortcut, push) | Installable on mobile home screen; works offline-capable |

---

## v0.7 — 2025-06-10 — Operational Excellence

| Feature | Description | Impact |
|---------|-------------|--------|
| **Task Manager with AI Suggestions** | Full CRUD, 9 task types, 4 priorities, 4 statuses, relations (customer/supplier/product/invoice), AI-suggested tasks from business context | Proactive task generation; never miss follow-ups |
| **Activity Logs (Audit Trail)** | Immutable logs on all entities, filters (entity, action, date, search), expandable old/new values, summary cards | Complete accountability; regulatory compliance |
| **Staff & Permissions** | 6 roles (owner, admin, manager, staff, accountant, sales), 11 granular permissions, UI management, profile linking to auth | Least-privilege access control; multi-staff operations |
| **Business Settings** | Org name/phone/address/city, invoice footer, default payment terms | Professional invoices; consistent terms |

---

## v0.6 — 2025-05-20 — Financial Core

| Feature | Description | Impact |
|---------|-------------|--------|
| **Profit & Loss Statement** | Period selector, revenue (sales), COGS (purchases + expenses), gross profit, operating expenses, net profit, drill-down | Owner sees profitability at a glance |
| **Customer Credit Management** | Aging buckets (current, 1-30, 31-60, 61-90, 90+), credit limit utilization, overdue flags, allow overdue sales toggle | Credit risk visibility; prevents bad debt |
| **Supplier Ledger** | Chronological purchases + payments, running balance, allocation breakdown (explicit vs fallback), payable aging | Payables transparency; supplier relationship management |
| **Expense Tracking** | Categorized expenses, purchase invoice linking, review status | Complete cost picture for P&L |

---

## v0.5 — 2025-04-25 — Transaction Layer

| Feature | Description | Impact |
|---------|-------------|--------|
| **Customer Payments** | Multi-invoice allocation (FIFO), payment methods (cash, bank, UPI, card, cheque, other), outstanding balance auto-calc | Faster collections; accurate receivables |
| **Supplier Payments** | Purchase invoice allocation, running payable balance, payment history per supplier | Timely vendor payments; supply chain trust |
| **Inventory Intelligence** | Real-time stock per product, low stock threshold alerts, out-of-stock detection, batch/expiry visibility | Prevent stockouts; reduce waste |

---

## v0.4 — 2025-04-05 — Core Trading Operations

| Feature | Description | Impact |
|---------|-------------|--------|
| **Purchase Invoices** | Multi-line items, per-line batch/expiry, purchase price + selling price, expense review workflow (pending/reviewed) | Complete procurement record; cost basis for margins |
| **Sales Invoices** | Cash/credit, credit due date, credit limit/day snapshots at invoice time, multi-line with batch selection | Professional invoicing; credit risk captured at point of sale |
| **Products with Batch/Expiry** | `track_batch`, `track_expiry` flags, per-line batch/expiry on transactions | FMCG compliance; expiry management |

---

## v0.3 — 2025-03-15 — Master Data

| Feature | Description | Impact |
|---------|-------------|--------|
| **Products** | Name, brand, category, unit type, last purchase price, default selling price, min stock, reorder level, batch/expiry flags | Foundation for all trading operations |
| **Brands** | Simple name registry, linked to products | Organized catalog |
| **Categories** | Hierarchical (parent_category_id), unlimited depth | Flexible product taxonomy |
| **Customers** | Name, shop name, phone, WhatsApp, city, area, type, credit policy, limit, days, over-limit/overdue allowances, preferred payment method | Rich customer profiles for credit & marketing |
| **Suppliers** | Name, contact person, phone, WhatsApp, city, notes | Supplier relationship management |

---

## v0.2 — 2025-02-20 — Platform Foundation

| Feature | Description | Impact |
|---------|-------------|--------|
| **Supabase Integration** | PostgreSQL, Auth, Realtime, Storage, Row Level Security | Managed backend; enterprise-grade security |
| **RLS Policies** | Organization isolation via `organization_id` on all tables, `auth.uid()` → `staff_profiles` → `organization_id` | Multi-tenant security by default |
| **Supabase Client** | Browser client with anon key, TypeScript types | Type-safe database access |

---

## v0.1 — 2025-01-15 — Project Initialization

| Feature | Description | Impact |
|---------|-------------|--------|
| **Next.js 16 + Turbopack** | App Router, React 19, TypeScript strict, Tailwind 4, ESLint 9 | Modern, fast, type-safe foundation |
| **Project Structure** | `src/app`, `src/lib/ai`, `src/lib/supabase`, `src/lib/tradeos` | Scalable architecture |
| **PWA Setup** | Manifest, icons, theme color, viewport config | Installable from day one |

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Released to production |
| 🟡 | In current sprint |
| 🟢 | Planned for next release |
| 🔵 | Designed, not scheduled |
| 🔴 | Blocked / needs decision |

---

*Generated from project analysis on 2025-07-15. All features documented reflect implemented code in the repository.*