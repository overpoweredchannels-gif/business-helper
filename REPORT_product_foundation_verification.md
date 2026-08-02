# Product Foundation Post-Recovery Verification Report

Status: audit only — no code modified, nothing committed, no migrations. Date: 2026-08-02.
Commit verified: `main` @ `2380c92` (recovery merge `fd31125` + repair `2380c92` complete).

---

## 1. Repository Integrity

| Check | Result | Evidence |
|---|---|---|
| `main` is production branch | PASS | `On branch main`, up to date with `origin/main`; `origin/HEAD -> origin/main` |
| Repository clean | PASS (with untracked artifacts) | No staged/modified tracked files; 7 untracked root artifacts: `AI_PHASE1_IMPLEMENTATION_PLAN.md`, `AI_UNIFIED_ASSISTANT_PLAN.md`, `CHANGELOG.md`, `MISSION_10_PRODUCTION_REPORT.md`, `REPAIR_REPORT_sprint1.md`, `REPORT_business_brain_not_ready.md`, `ts-error.txt`, `validation-reports/` (intentionally untracked) |
| Recovery merge complete | PASS | `main` = `2380c92` includes `fd31125` (AI OS recovery, 196 files ff-merged) + repair commit; all 7 previously-missing modules present |
| No orphaned Sprint-1 refs | WARN | No sprint-1 branches (local/remote) and no for-each-ref matches. **But `git stash list` shows `stash@{0}: WIP on sprint-1-invoice-foundation`** — orphaned stash referencing the deleted branch |
| Broken imports | PASS | `tsc --noEmit` exit 0 (0 type errors); `npm run build` exit 0 — all imports resolve |
| Duplicate modules | WARN | No `src/services` duplication; but ~9 duplicate implementations exist (see §6.4) |

## 2. Product Foundation

**Architecture finding:** There is NO API layer and NO service layer for products/categories/brands — no `src/app/api/products|categories|brands` routes, no lib services. All CRUD lives inline in `src/app/page.tsx` (17,455-line single-file dashboard) via direct browser-side Supabase calls. The Product UI section is live at `page.tsx:14009-14180` (`activeSection === "products"`, gated by `can_manage_products` permission).

| Feature | Status | Location |
|---|---|---|
| Product Create | PASS | Form `page.tsx:14011-14139`, `handleSubmit` `:10323-10387` (insert `:10340`), audit log written |
| Product Read | PASS (partial) | `fetchProducts` `:4013-4036`; list `:14141-14178` |
| Product Update | **FAIL — no edit UI/feature exists** | Only blind side-effect updates of `default_selling_price` at `:5472` (manual purchase) and `:2675` (AI draft) — no product name/brand/category/unit edit anywhere |
| Product Delete | PASS (unguarded) | `handleDeleteProduct` `:5066-5107` — plain delete, no check for `sales_items`/`purchase_items` references |
| Product Search | **FAIL — no in-section search** | Header search (`Header.tsx`) only navigates to the section; nothing filters the product list |
| Product View | **FAIL — no detail view** | Plain list rows only (`:14141-14178`) |
| Category Create | PASS | `handleAddCategory` `:4983-5026`, UI `:13929-14007`; supports `parent_category_id` |
| Category Read | PASS | `fetchCategories` `:3988-4011` |
| Category Update | **FAIL — none** | |
| Category Delete | PASS (unguarded) | `:5028-5064` — no handling of child categories or products referencing it |
| Brand Create | PASS | `handleAddBrand` `:4904-4945`, UI `:12599-12652` |
| Brand Read | PASS | `fetchBrands` `:1319-1342` |
| Brand Update | **FAIL — none** | |
| Brand Delete | PASS (unguarded) | `:4947-4981` — no handling of products referencing it |
| Unit Types | PARTIAL | Free-text input (`:14063-14072`), no enum/constant, no normalization ("Carton"/"carton"/"cartons" are distinct values) |
| Parent/Child Categories | PARTIAL | DB column + insert + flat UI with single-level "Parent:" label (`:13943-13957,13981-13991`); no tree rendering, no cycle prevention (self-parent loops possible), no depth limit |
| Product validation | **FAIL — client-side only, minimal** | HTML `required` on name/unit_type only; `handleSubmit` has no empty-name/duplicate/range checks; `Number(x)` NaN/negatives written straight to DB (`:10345-10347`); stray debug `console.log({ brand_id, category_id })` at `:10329` |
| Product schema | WARN | No DDL in repo (see §3); `src/lib/tradeos/types.ts` `Product` interface is stale — missing `organization_id`, `current_stock`, `default_purchase_price`, `units_per_pack`, `is_active`, `created_at`, `updated_at` (all used by code) |

**Message-display defect:** product success/error messages render only in a vestigial second block at `page.tsx:17444-17449` (bottom of dashboard, far below the products section) — the section itself never shows feedback inline.

## 3. Database

**The authoritative schema for `products`/`categories`/`brands` is NOT in the repository.** `tradeos-schema.sql` is a 2-line empty stub. Only `identity/invoices/location/schema.sql` exist (no product tables). DDL lives in the deployed Supabase project only (created ad hoc via SQL editor per the repo's stated convention, `src/lib/invoices/schema.sql:6-9`).

| Aspect | Status | Evidence |
|---|---|---|
| CREATE TABLE products/categories/brands | **MISSING from repo** | Reconstructed columns from code only: `products` (id serial, name, organization_id, brand_id, category_id, unit_type, units_per_pack, last_purchase_price, default_purchase_price, default_selling_price, minimum_stock_level, reorder_level, track_batch, track_expiry, current_stock, is_active, created_at, updated_at); `brands` (id, name, organization_id); `categories` (id, name, parent_category_id, organization_id) |
| Foreign keys | UNVERIFIABLE from repo | Inferred: products.organization_id→organizations, brand_id→brands, category_id→categories, categories.parent_category_id→categories (self-ref). No DDL to confirm ON DELETE actions |
| Constraints | UNVERIFIABLE | No UNIQUE/CHECK/NOT NULL DDL in repo. `MISSION_10_PRODUCTION_REPORT.md` claims SKU/batch uniques + price/stock checks, but the referenced migration/service files don't exist |
| Indexes | UNVERIFIABLE | No CREATE INDEX for products/brands/categories anywhere in repo |
| RLS | UNVERIFIABLE | No `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` for these tables in repo; only illustrative examples in `ARCHITECTURE.md:213-240` and `SECURITY.md:49-68` (uses undefined `has_permission()` helper) |
| Cascades | UNVERIFIABLE | `MISSION_10_PRODUCTION_REPORT.md:204` claims "brand/category deletions cascade correctly (nullified)" → implies ON DELETE SET NULL, but no DDL. Code does plain deletes with zero manual cleanup — behavior depends entirely on deployed DB FK actions |
| Relationships | Inferred | products→brands (nullable join `page.tsx:14150-14151`), products→categories, categories→categories (parent). No inventory/stock_movements/price_lists tables exist anywhere |

## 4. End-to-End Flow

| Step | Verdict | Detail |
|---|---|---|
| Create Category | PASS | Form + insert + audit log; renders in list |
| Create Brand | PASS | Form + insert + audit log; renders in list |
| Create Product | PASS | Form + insert + audit log; renders in list |
| Edit Product | **BLOCKED** | No edit UI or update handler exists (only blind price side-effects) |
| Delete Product | PASS (risky) | Plain delete; if deployed FK is RESTRICT it fails silently per FK, if SET NULL it orphans, if CASCADE it destroys sales/purchase history — none handled in code |
| Search Product | **BLOCKED** | No in-section search/filter |
| View Product | **BLOCKED** | No detail view |

**Also broken in the chain:** `fetchPurchaseItems` (`page.tsx:4767-4771`) and `fetchSalesItems` (`:4865-4869`) have **no `.eq("organization_id", ...)` filter** — they load items across ALL organizations (cross-tenant exposure if RLS absent; correctness risk regardless).

## 5. Deployment

| Check | Result | Detail |
|---|---|---|
| Build | PASS | `npm run build` exit 0 (all pages/routes compiled; middleware listed) |
| Typecheck | PASS | `tsc --noEmit` exit 0 |
| Lint | PASS (with debt) | 203 files, **171 errors / 184 warnings** (pre-existing; needs `NODE_OPTIONS=--max-old-space-size=8192` to avoid a crash on the 17k-line page.tsx). Errors: 150 `no-explicit-any` + 19 react-hooks rules + 2 misc. Top files: page.tsx 36, executive-conversation.ts 32, executive-ai.ts 29, validate-skills.ts 21, validate-gateway.ts 7 |
| Environment variables | PASS | `.env.local` present with all keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, Gemini/OpenAI/xAI/ZAI keys + models, AI_PROVIDER_ORDER, retries/timeout, AI_ENABLE_LOCAL_FALLBACK |
| Runtime errors | PARTIAL (unverified live) | No live browser verification possible in this audit; build-time zero errors. Known runtime defect: `BRAIN_NOT_INITIALIZED` path always active (brain never bootstrapped) — does not affect product module |
| Browser console | WARN | 71 `console.log` remnants (page.tsx 28 incl. product-save debug at `:10329`, provision route 43) |
| Network requests | WARN | ~28 sequential full-table supabase fetches on login (`:1054-1083`) — slow first paint; 2 cross-org fetches (§4); 17 `package.json` test scripts point to missing files (`npm test`/`validate` fail) |

## 6. Technical Debt (not fixed — per constraints)

### 6.1 Bugs
1. Product save/delete feedback messages render at the bottom of the dashboard, not in the products section (`page.tsx:17444-17449` vestigial block).
2. `fetchPurchaseItems`/`fetchSalesItems` missing org filter — cross-tenant data exposure (`:4767`, `:4865`).
3. Two stock sources of truth conflict: dashboard computes stock from `purchase_items − sales_items`; AI routes maintain `products.current_stock`; manual flows never update `current_stock`.
4. `fetchProducts` omits `current_stock`/`units_per_pack` though both are written elsewhere.
5. `MISSION_10_PRODUCTION_REPORT.md` references non-existent files (`product-service.ts`, `product-search-service.ts`, migrations) — aspirational doc passed as done.
6. Stale `ts-error.txt` references deleted `scripts/demo-sales-acceptance.ts`.

### 6.2 TODOs (8)
- `src/lib/ai/conversation-engine.ts:1332-1338` — 7 stub executors (`executeExpenseDraft`, `executeTaskDraft`, `executeCreateCustomer`, `executeCreateSupplier`, `executeCreateProduct`, `executeBusinessQuery`, `executeMarketIntelligence` = `"TODO"`)
- `src/lib/ai/financial-intelligence.ts:103` — "Add top expense categories"

### 6.3 Placeholder/dead code
- User-facing "will be added later" strings: `page.tsx:2726,15072,16576`; `constants.ts:92,99-100`
- `defaultSecurityChecks` + `deploymentManualChecklistItems` shipped in production constants (`constants.ts:52-83`)
- 43+ zero-importer dead files: `src/lib/voice/**` (34 files), `src/hooks/use-business-memory.ts`, `src/lib/ai/customer-executor.ts`, `supplier-executor.ts`, `src/lib/ai/index.ts`, `src/components/location/LiveMap.tsx` + `LocationDashboard.tsx`, `src/lib/conversation/client.ts`, validation harness
- Dead exports: `executive-ai.ts:130,214,339`, `executive-conversation.ts:187,192`, `validators.ts:28`
- Empty dirs: `src/app/(auth)/brain/validate/`, `src/lib/brain/language/`
- 15/17 package.json test scripts → missing files; `validation-reports/` leftovers at root

### 6.4 Duplicate modules (~9)
AI sale/purchase creation (executors vs API routes); AI customer/supplier CRUD (dead executors vs routes); customer/supplier ledgers (lib vs inline page math); financial analytics (3 engines); conversation state machines (2); invoice ledger queries (service vs inline); currency formatter (3 copies: `pkrFormatter`, `formatPKR`, `formatRs`); `safeNumber` redefined locally.

### 6.5 Missing validation
No form validators (no validateProduct/Category/Brand, no duplicate-name checks, no ranges); brand/category forms lack `required`; category self-parent/cycle unchecked; server-side validation absent for all mutations (no API layer).

### 6.6 Performance
- Full-table loads, no pagination (products, customers, suppliers, transactions, expenses, tasks, payments)
- ~28 sequential awaits on login
- O(n×m) `brands.find()`/`categories.find()` per product in render loop (`:14150-14151`)
- 17,455-line monolith `page.tsx`
- API routes trust `organizationId` from body; `middleware.ts:12-20` exempts all `/api/*` from auth

## 7. Readiness Verdict

**Product Foundation is NOT production-ready.**

### Blockers (in priority order)
1. **No Product/Category/Brand edit capability** — update path entirely missing (required for a complete CRUD foundation).
2. **No Product search or detail view** — "search product" and "view product" steps of the flow cannot be completed.
3. **Cross-tenant data exposure** — `fetchSalesItems`/`fetchPurchaseItems` unfiltered by organization (security blocker, regardless of feature completeness).
4. **No verifiable database constraints/RLS/cascades** — the schema is not versioned in the repo; production DB behavior is unverifiable (FKs, RLS, ON DELETE semantics). A single wrong FK action silently corrupts data on delete.
5. **No server-side validation/authorization layer** — all mutations are direct browser-to-Supabase calls relying on UI checks only.

### Not blockers (defer)
- Unit-type normalization, category tree/cycle handling, delete referential guards (feature hardening)
- Message placement, stock source-of-truth reconciliation, dead code, duplicates, lint debt (cleanup)
- Business Brain / AI / Voice — explicitly out of scope per roadmap

### Recommended next milestone
**"Product Foundation Completion"** — before any further feature work: (1) fix the two org-filtered fetches; (2) add product/category/brand edit + in-section search + product detail view; (3) migrate the authoritative products/categories/brands DDL into versioned schema.sql (FKs with explicit ON DELETE actions, indexes on organization_id/brand_id/category_id, RLS policies, and delete-guard semantics); (4) add server-side validation. After that: delete-guard behaviors and unit-type normalization, then move to the next core module per roadmap.
