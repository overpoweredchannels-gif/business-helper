# Investigation Report — "Business Brain is not ready. Load your business data first from the Dashboard."

Status: investigation only. No code modified, nothing committed. Date: 2026-08-02.

---

## 1. Where the message is generated

| Layer | Location | Content |
|---|---|---|
| UI copy | `src/components/ai/AIAssistant.tsx:172-186` | `if (!brainAvailable)` renders "Business Brain Not Ready" / "Load your business data first from the Dashboard. The AI Assistant needs your business context to provide insights." |
| Gate prop | `src/app/page.tsx:16225` | `<AIAssistant onChat={onBrainChat} brainAvailable={getGateway().getStatus().ready} />` |
| Readiness | `src/lib/conversation/gateway.ts:266-276` | `getStatus()` returns `ready: !!getBusinessBrain()` |
| Backend error | `src/lib/conversation/gateway.ts:174-186` | `BRAIN_NOT_INITIALIZED: "Business Brain is not initialized. Load business data first."` (same check in stream path at `:336-346`) |

The message is shown whenever `getBusinessBrain()` returns `null`.

## 2. Why exactly it is shown (root cause chain)

The Business Brain singleton is only ever assigned inside `initializeBusinessBrain()` (`src/lib/brain/bootstrap.ts:64-173`, assignment at `:167`).

Full callers of `initializeBusinessBrain` in the entire repo (verified by search):

- `src/lib/brain/supabase-loader.ts:121` — inside `bootstrapOrganizationData()` (only production caller)
- `src/lib/brain/validation/validate-bootstrap.ts` and `src/lib/conversation/validation/validate-gateway.ts` — test/validation scripts only

**`bootstrapOrganizationData()` has ZERO callers in the application** (no page, layout, middleware, hook, or API route imports it; it is only re-exported at `src/lib/brain/index.ts:18`). The Dashboard (`src/app/page.tsx`) fetches tables directly via `supabase` (30+ `.from(...)` queries) and never calls `initializeBusinessBrain` or `bootstrapOrganizationData`. The `use-business-memory` hook (`src/hooks/use-business-memory.ts`) has zero importers (dead code) and would not set the singleton anyway.

Therefore, in the running app `getBusinessBrain()` is **always `null`** → `getStatus().ready` is **always `false`** → the "not ready" screen is **always** shown, regardless of how much business data exists.

The ready flag has **no data-volume requirement at all**. `initializeBusinessBrain` accepts any `MemoryWriterRawData` and calls `writer.writeRaw(data)` unconditionally (`bootstrap.ts:74`); the gateway validation suite even initializes it with empty data (`validate-gateway.ts:22`). "Ready" simply means the bootstrap pipeline ran once.

## 3. Expected behaviour or actual bug?

**Neither a data problem nor an AI-implementation problem — it is a missing-integration defect.**

- Not "expected behaviour": the Brain implementation is complete and functional (bootstrap, MemoryStore, MemoryWriter, ContextRetriever, PreferenceStore, skill registry, conversation runtime, validation suites all pass). The message copy is actively misleading — loading data from the Dashboard does NOT initialize the Brain, so even a fully populated business shows this screen.
- Not an AI-feature gap: the provider-based AI endpoints that DO work (`/api/ai-business-query`, `/api/business-brain`, 5 `loadRawBusinessData` API routes) bypass the singleton entirely.
- It is a wiring gap: the initialization pipeline (`bootstrapOrganizationData` → `loadRawBusinessData` → `initializeBusinessBrain`) exists but is never invoked from the app.

### Secondary finding (same screen, unrelated to this bug)
All four AI nav sections (Voice Operator, Analytics, Business Query, Assistant — `src/components/dashboard/Sidebar.tsx:28,38-40`) render the **same** `AIAssistant` shell (`src/app/page.tsx:16223-16227`). The dedicated Analytics/Business Query/Voice Operator UIs are dead code: their state and fetch handlers exist (`askAiAnalyticsQuestion` at `page.tsx:7146`, `/api/ai-business-query` fetches at `7172,9083,9261,9824`) but results are never rendered (`aiAnalyticsResult` has a single occurrence — its declaration at `:4194`).

## 4. Business modules required before the Brain becomes ready

From code evidence — `MemoryWriterRawData` (`src/lib/brain/contracts/memory.ts:402-564`) and the 13 queries in `loadRawBusinessData` (`src/lib/brain/supabase-loader.ts:23-37`):

| Module | DB table | Loaded? |
|---|---|---|
| Organization | passed as args to `bootstrapOrganizationData` (orgId, orgName, ownerName, timezone) | required |
| Products | `products` | yes |
| Customers | `customers` | yes |
| Suppliers | `suppliers` | yes |
| Staff | `profiles` | yes |
| Sales | `sales_transactions` + `sales_items` | yes |
| Purchases | `purchase_transactions` + `purchase_items` | yes |
| Expenses | `expenses` | yes |
| Customer payments | `customer_payments` | yes |
| Supplier payments | `supplier_payments` | yes |
| Tasks | `tasks` | yes |
| AI alerts | `ai_alerts` | yes |

Not loaded by the loader (optional fields only): `dutySessions`, `locationPoints` (`staff_duty_sessions`, `staff_location_points` exist in the app but the loader never queries them). `brands`/`categories` are **not** queried either — product rows carry `brand_id`/`category_id` but names stay `null` in memory.

**Conditions for readiness (strictly per code):**
1. All 13 loader queries must succeed (`Promise.all`, any error → `null` → bootstrap returns `success:false`, `supabase-loader.ts:39-49,114-116`). All 13 tables exist in the app (verified via `.from(...)` usage in `page.tsx`).
2. `initializeBusinessBrain` must be called once (any data volume — even empty rows).
3. Row counts are NOT gating: no minimum exists anywhere in code.

## 5. Should we ignore this message for now?

**Yes.** The message is harmless placeholder UI for an AI milestone that is intentionally behind the core business system in the roadmap. Core development is unaffected — the AI sections share the same page and block no core feature. Two non-urgent notes for the future:
- The copy is misleading (Dashboard data load will never trigger readiness in the current code).
- The dead Analytics/Business Query/Voice Operator code (~4 handlers, 4 fetch sites) should be removed or wired when the AI milestone arrives.

## 6. Recommended next development milestone

Per the current architecture and roadmap (core business system first, AI later):

1. **Continue core modules** — the 13 tables above are all present; keep building them out (this message needs no action now).
2. **AI milestone integration (when reached)**: add one call to `bootstrapOrganizationData(supabase, orgId, orgName, ownerName)` after organization selection/login in `page.tsx` (alongside the existing data fetches), which makes `getStatus().ready` true; then replace the `brainAvailable` placeholder gate with the live chat shell, and decide whether to delete or wire the dead AI section UIs.

Estimated effort for the eventual fix: ~5 lines in `page.tsx` + a small route/hook, since `bootstrapOrganizationData` already does everything else.

## Evidence trail (file:line)

- `src/components/ai/AIAssistant.tsx:25-27,130,172-186` — prop gate + message
- `src/app/page.tsx:287-294` — `onBrainChat` → `getGateway().chat(...)`; `:16223-16227` — single render site for all 4 AI sections
- `src/lib/conversation/gateway.ts:46-53` — gateway singleton; `:174-186` — brain-null error; `:266-276` — `ready: !!getBusinessBrain()`
- `src/lib/brain/bootstrap.ts:52-60` — `_instance` singleton; `:64-74,167` — init + assignment
- `src/lib/brain/supabase-loader.ts:5-96` — `loadRawBusinessData` (13 tables); `:106-138` — `bootstrapOrganizationData` (zero app callers)
- `src/lib/brain/index.ts:15-18` — exports (API exists, unused)
- `src/app/api/ai-business-query/route.ts` — provider-router endpoint, no brain dependency
- `src/hooks/use-business-memory.ts` — zero importers (dead code)
- `src/lib/brain/validation/validate-bootstrap.ts:146-154` — singleton bootstrap test; `validate-gateway.ts:14,22` — init with mock/empty data
