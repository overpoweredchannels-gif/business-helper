# PROJECT STATE — PHASE 3 (v0.3.0)

> Recovery point for TradeOS (business-helper). Generated after Phase 3
> purchasing/inventory stabilization. If anything breaks later, this document
> describes the intended architecture, the deployed state, and known caveats.

- **Git HEAD**: `7222be2` (main), tag `v0.3.0` — "TradeOS Phase 3 - Purchasing & Inventory Complete"
- **Package version**: `0.1.0` (package.json — the repo tag v0.3.0 is the source of truth for releases)
- **Stack**: Next.js 16.2.9 (App Router, Turbopack), React 19.2.4, TypeScript 5, Supabase (Postgres + GoTrue + RLS), Tailwind v4
- **Deploy**: Vercel (main branch = production URL)

---

## 1. Folder Structure

```
E:\tradeos
├── package.json                  # deps + scripts (typecheck, build, validate:*)
├── .env.local                    # env vars (see §10)
├── next.config.ts / tsconfig.json / eslint.config.mjs
├── tradeos-schema.sql            # legacy full-dump reference (superseded by lib/*/schema.sql)
├── ARCHITECTURE.md, README.md, ROADMAP.md, SECURITY.md, PROJECT_CONTEXT.md
├── REPORT_*.md                   # phase reports (product foundation, inventory, purchase phase 1…)
├── TRADEOS_AI_*.md               # AI operating system specs
├── scripts/                      # tsx acceptance/validation scripts (npm run test:*)
└── src/
    ├── app/
    │   ├── (auth)/               # login, signup, reset, invite, onboarding (route groups)
    │   ├── auth/callback/        # OAuth + email callback → provision + claim refresh
    │   ├── auth/                 # email verification page
    │   ├── brain/                # business-brain validation page
    │   ├── page.tsx              # the ENTIRE main SPA (single ~20k-line client component)
    │   └── api/                  # all API routes (see §4)
    ├── components/
    │   ├── ai/                   # AIAssistant, etc.
    │   ├── dashboard/            # Header, charts
    │   ├── identity/             # RoleManagement, InvitationPanel
    │   ├── inventory/            # ImportWizard
    │   ├── location/             # location UI
    │   └── ui/                   # shadcn-style primitives + auth-fuse.tsx (auth forms)
    ├── hooks/                    # shared React hooks
    └── lib/
        ├── ai/                   # conversation engine, providers, financial/BI queries
        ├── assistant/            # assistant runtime
        ├── audit/                # audit log helpers
        ├── brain/                # business brain
        ├── conversation/         # chat gateway
        ├── identity/             # api-context.ts (resolveActor), schema.sql, invitations
        ├── import-wizard/        # xlsx import
        ├── inventory/            # schema.sql, overselling-policy.sql, ledger logic
        ├── invoices/             # invoice-number-service.ts (client-safe numbering), schema.sql
        ├── location/             # schema.sql
        ├── migrations/           # production_upgrade_consolidated.sql (PRODUCTION SOURCE OF TRUTH)
        ├── products/             # schema.sql
        ├── purchases/            # schema.sql, validation.ts
        ├── supabase/             # client.ts (browser), server.ts (service/user clients), session-claim.ts
        └── tradeos/              # domain helpers
```

---

## 2. Database Schema (Supabase Postgres)

App-defined tables (all in `public`; `create table if not exists` — idempotent):

| Table | Key columns | Notes |
|---|---|---|
| `organizations` | id uuid PK | pre-existing; has `overselling_policy` ('allow'/'block', default 'allow') |
| `profiles` | id uuid PK (= auth.users.id), organization_id, role | owner + employees |
| `staff_permissions` | organization_id, profile_id, ~13 `can_*` flags | see §5 |
| `brands` | id uuid, organization_id | unique per org (name) |
| `categories` | id uuid, organization_id, parent_category_id | self-referencing tree |
| `products` | id **serial int** (dev schema) / **uuid** (prod, aligned by migration b98fd3b), organization_id, sku, barcode, brand_id, category_id, default_purchase_price, default_selling_price, last_purchase_price, current_stock numeric(14,2) default 0, minimum_stock_level, reorder_level, track_batch, track_expiry, is_active, overselling_policy | current_stock is the stock truth mirror (ledger-backed); `>= 0` CHECK relaxed in prod |
| `purchase_transactions` | id uuid, organization_id, invoice_number, supplier_id, total_amount, status, invoice_type='purchase', supplier_invoice_number, created_by_profile_id | pre-existing purchase invoices |
| `purchase_items` | id uuid, purchase_transaction_id, product_id, quantity, purchase_price, batch_number, expiry_date, **organization_id** (added Phase 2) | |
| `sales_transactions` | id uuid, organization_id, invoice_number, customer_id, total_amount, status, invoice_type='sales', created_by_profile_id | |
| `sales_items` | id uuid, sales_transaction_id, product_id, quantity, sale_price, **organization_id** | |
| `suppliers` | id uuid, organization_id, supplier_name, phone, shop, is_active (archive flag, never hard-deleted) | |
| `customers` | id uuid, organization_id, name, phone, shop | |
| `invoice_sequences` | organization_id, doc_type, last_value | client-safe numbering (RPC `next_invoice_number`) |
| `inventory_transactions` | id uuid, organization_id, product_id (int), movement_type ('purchase_in','sale_out','adjustment_in','adjustment_out','return_out' — check constraint widened), quantity_delta <> 0, reason, batch_number, expiry_date, reference_type ('purchase_transaction','sales_transaction','adjustment','purchase_return'), reference_id, created_by, created_at | **ledger truth**; writes only via SECURITY DEFINER |
| `purchase_orders` | id uuid, organization_id, po_number, supplier_id, order_date, expected_date, notes, status ('ordered'|'partial'|'received'|'cancelled'), created_by_profile_id | unique (organization_id, po_number) |
| `purchase_order_items` | id uuid, purchase_order_id, product_id, quantity_ordered > 0, quantity_received >= 0, unit_price, batch_number, expiry_date | RLS via parent subquery |
| `purchase_returns` | id uuid, organization_id, return_number, supplier_id, purchase_transaction_id, return_date, reason, status ('confirmed'|'cancelled'), created_by_profile_id | unique (organization_id, return_number) |
| `purchase_return_items` | id uuid, purchase_return_id, product_id, quantity > 0, unit_price, batch_number, expiry_date, **organization_id** (added v0.3.0 — required by stock trigger) | RLS via parent subquery |
| `role_definitions` | id uuid, organization_id, name, description | custom roles |
| `role_invitations` | id uuid, organization_id, email, token, role_id, status, created_by (uuid = profiles.id), expires_at | |
| `device_sessions` | id uuid, organization_id, profile_id, device info | |
| `password_reset_tokens` | id uuid, email, token, expires_at | |
| `staff_duty_sessions` / `staff_location_points` | location tracking | pre-existing |
| `audit_logs` | id uuid, organization_id, action, entity_type, entity_id, entity_label, description, old_values, new_values, actor_profile_id, created_at | every mutation audited from app |

Pre-existing (not defined in repo schemas): `audit_logs`, `profiles`, `organizations`, `staff_permissions`, `purchase_transactions/items`, `sales_transactions/items`, `suppliers`, `customers`, `expenses`, `tasks`, `role_definitions` (now repo-defined), location tables.

**Key functions** (security definer):
- `current_org_id()` — reads `auth.jwt()` → `app_metadata.organization_id`, falls back to `user_metadata.organization_id`, then top-level `organization_id` claim. THE org-resolution function used by every RLS policy.
- `has_product_permission(uid)` / `has_inventory_permission(uid)` — staff_permissions lookups.
- `next_invoice_number(org, doc_type)` — atomic sequence increment for invoice/PO/return numbers.
- `resolve_overselling_policy(org, product)` — org → category → product override chain.
- `adjust_inventory(org, product, delta, reason, batch, expiry, created_by)` — permission-checked manual stock adjustment.
- `set_updated_at()` — updated_at maintenance.
- `inventory_sync_purchase_item()`, `inventory_sync_sale_item()`, `inventory_sync_purchase_return_item()` — ledger + stock triggers.

**RLS model**: every app table has `*_org` policies comparing `organization_id = current_org_id()`. Item tables (purchase_order_items, purchase_return_items) use EXISTS on parent org. `inventory_transactions` has **select-only** RLS — writes happen exclusively inside SECURITY DEFINER functions/triggers.

---

## 3. Migrations

- **`src/lib/migrations/production_upgrade_consolidated.sql`** — THE production source of truth. Idempotent, rerunnable in Supabase SQL editor. Parts:
  - Part 1: product foundation (brands, categories, products, columns, indexes, RLS, set_updated_at, current_org_id, has_product_permission)
  - Part 2: sales/purchase transaction columns + invoice sequences + next_invoice_number + item-side organization_id columns (purchase_items, sales_items) + status/invoice_type CHECKs + uniqueness indexes
  - Part 3: overselling policy (resolve_overselling_policy, org/category/product columns)
  - Part 4: inventory (inventory_transactions, has_inventory_permission, inventory_sync_* triggers, adjust_inventory, current_stock >= 0 relaxation, one-time ledger backfill 4.7)
  - Part 4.8: purchase items org backfill + purchase_transactions.total_amount backfill (idempotent)
  - Part 5: purchasing (purchase_orders, purchase_order_items, purchase_returns, purchase_return_items + **organization_id column (5.3b, v0.3.0)** + RLS + return stock trigger 5.5 + supplier archive 5.6)
  - Part 6: location indexes
  - Part 7: post-apply verification (raises `MIGRATION INCOMPLETE` if any object/column/index/trigger/policy missing) — prints `ALL REQUIRED OBJECTS PRESENT`
- Dev-parity schema files (fresh local DBs, NOT applied to prod): `src/lib/{products,inventory,invoices,purchases,identity,location}/*.schema.sql`, `src/lib/inventory/overselling-policy.sql`
- Historical: `tradeos-schema.sql` (legacy full dump), applied via manual "Apply this migration in Supabase" steps in phase reports.

---

## 4. API Routes (Next.js route handlers)

```
POST /api/auth/provision          — identity provisioning: org/profile lookup-or-create,
                                     org claim write (ensureOrgClaim via admin.updateUserById),
                                     returns { alreadyProvisioned, needsOnboarding }
POST /api/identity/invite         — invite employee (role_invitations)
POST /api/identity/invitations/accept — join via token; creates user + sets org claim in app_metadata
GET  /api/identity/profiles       — org member list
GET  /api/identity/employees, /api/identity/employees/[id]
GET  /api/identity/roles, /api/identity/roles/[id]
GET  /api/identity/sessions       — device sessions
GET  /api/identity/organization/current, POST /api/identity/organization/settings
GET  /api/identity/profile/current
POST /api/identity/reset-password
POST /api/inventory/adjust        — manual adjustment (user token)
GET  /api/invoices/purchases, /api/invoices/sales — invoice numbering/number availability
POST /api/purchases, GET /api/purchases, GET/PUT/DELETE /api/purchases/[id]   — purchase invoices (user token)
POST /api/purchases/returns       — purchase returns (user token, stock validation)
GET  /api/suppliers, POST /api/suppliers, GET/PUT/DELETE /api/suppliers/[id]
GET  /api/products/validate       — SKU/barcode uniqueness (user token)
GET  /api/location/current, POST /api/location/device-session, POST /api/location/upload
GET  /api/audit                   — audit log search
POST /api/market-intelligence/analyze
POST /api/business-brain          — business brain query
POST /api/ai-business-query
POST /api/conversation/chat, /api/conversation/chat/stream, GET /api/conversation/status
POST /api/ai/business-intelligence/dashboard, /query
POST /api/ai/executive
POST /api/ai/financial/query, /summary
POST /api/ai/purchases/create, /api/ai/sales/create
POST /api/ai/customers/{create,update,delete}, /api/ai/suppliers/{create,update,delete}
```

Auth model for routes: most use the **user's own token** (`createSupabaseUserClient(bearer)` via `resolveActor`/`getAccessToken` — RLS applies). Only `/api/auth/provision` and invite-accept use the service-role client (identity bootstrap). No service-role leaks in purchase/inventory/supplier routes (stabilization release).

---

## 5. Permissions

- **Auth layer**: Supabase Auth (email/password + Google OAuth), JWT with custom claim `organization_id` embedded in `app_metadata` at token issuance.
- **Org claim mechanics (v0.3.0)**: GoTrue only embeds app_metadata in tokens minted AFTER the claim write → browser must refresh the session post-provision (`src/lib/supabase/session-claim.ts` → `ensureOrganizationClaimInSession()` in `/auth/callback` + `provisionWorkspace`). Server verifies the write (`[PROVISION] verified auth.users app_metadata.organization_id …`).
- **staff_permissions flags**: can_manage_products, can_manage_customers, can_manage_suppliers, can_create_purchases, can_create_sales, can_manage_payments, can_manage_expenses, can_view_profit, can_view_reports, can_manage_tasks, can_manage_settings, can_manage_inventory.
- **RLS**: org-scoped `*_org` policies everywhere; `current_org_id()` from JWT; ledger write-protected; `has_product_permission`/`has_inventory_permission` guard RPCs.
- **Client**: user-token clients; UI gates by profile role/permission flags.

---

## 6. Inventory Flow

1. **Purchase receive** → `purchase_items` INSERT/UPDATE → `inventory_sync_purchase_item` trigger → ledger row `purchase_in` + `products.current_stock += delta`. (Also legacy direct purchase save.)
2. **Sale** → `sales_items` → `inventory_sync_sale_item` → ledger `sale_out` + stock `-= qty`; enforces overselling policy ('block' → exception if stock would go negative).
3. **Purchase return** → `purchase_return_items` → `inventory_sync_purchase_return_item` → ledger `return_out` + stock `-= qty`, guarded (never below zero, whole statement rolls back).
4. **Manual adjustment** → `adjust_inventory()` RPC → ledger `adjustment_in/out` + stock; requires can_manage_inventory + reason + non-negative result.
5. Ledger backfill (migration 4.7) rebuilds stock from ledger when ledger was empty — one-time, idempotent.
6. UI reads `products.current_stock` (single source of truth for display); ledger viewable in Inventory tab.

---

## 7. Purchasing Flow

1. **Purchase invoice (legacy save)**: client generates invoice number via `generateInvoiceNumberWithClient` (server-confirmed sequence), inserts `purchase_transactions` + `purchase_items` with `organization_id` + `total_amount` persisted (Phase 2 fix).
2. **Purchase order**: `handleCreatePurchaseOrder` → `purchase_orders` (status 'ordered') + `purchase_order_items` (quantity_ordered, unit_price) → refetch. **v0.3.0 fix**: item fetchers resolve parent ids from DB instead of stale React closure state so history/details/print/totals all show persisted data immediately.
3. **Receive PO** (`handleConfirmReceive`): creates purchase invoice + `purchase_items` (stock in), updates `purchase_order_items.quantity_received`, sets PO status 'partial'/'received'.
4. **Purchase return**: POST `/api/purchases/returns` (user token) → validation + stock guard → `purchase_returns` + `purchase_return_items` (now with organization_id) → trigger syncs stock/ledger.
5. **History/print**: reads `purchaseOrderItems` state (loaded by the fixed fetchers); print via `openPrintPreview` (branding + tables).
6. **Numbering**: `next_invoice_number(org, type)` for purchase invoices, POs, returns — client-safe (supabase rpc, server-confirmed).

---

## 8. Authentication Flow

1. **Email signup**: `/signup` → `supabase.auth.signUp({ email, password, options.data: { full_name, organization_name } })` → email confirm → callback → provision.
2. **Google**: `auth-fuse.tsx` → `signInWithOAuth({ provider: "google", redirectTo: /auth/callback })`.
3. **Callback** (`/auth/callback`): `getSession()` → POST `/api/auth/provision` (Bearer token) → **`ensureOrganizationClaimInSession()`** forces token refresh so the JWT carries `organization_id` → redirect to `/` or `/onboarding`.
4. **Provision** (`/api/auth/provision`, service role): resolve/ensure org + owner profile + staff_permissions; write `app_metadata.organization_id` via `admin.updateUserById` (both already-provisioned and fresh paths); verify by re-fetch; log `[PROVISION] verified …`.
5. **App mount** (`page.tsx` `checkAuthUser`): `getSession` → `getUser` → `provisionWorkspace` (also refreshes claim) → `loadProfile` → all fetchers.
6. **Invite**: `/invite` (token page) → `/api/identity/invitations/accept` creates auth user + sets org claim + role.
7. **Password reset**: `/reset` → `/api/identity/reset-password` → token table → re-auth.
8. Sessions: `@supabase/ssr` browser client (cookie-based persistence); service client for admin ops only.

---

## 9. Dependencies

Runtime: `@supabase/ssr ^0.12.3`, `@supabase/supabase-js ^2.108.1`, `next 16.2.9`, `react/react-dom 19.2.4`, `lucide-react ^1.27.0`, `xlsx ^0.18.5`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-label`, `@radix-ui/react-slot`.
Dev: `typescript ^5`, `eslint ^9` + `eslint-config-next`, `tailwindcss ^4` + `@tailwindcss/postcss`, `@types/*`, `tsx` (scripts).
No ORM — direct Supabase client + SQL.

---

## 10. Environment Variables (.env.local)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public Supabase config
- `SUPABASE_SERVICE_ROLE_KEY` — **server only**; used ONLY in provision + invite-accept
- AI stack: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `ZAI_API_KEY` (+ per-provider `*_PRIMARY_MODEL`, `*_FALLBACK_MODEL`), `AI_PROVIDER_ORDER`, `AI_MAX_RETRIES_PER_PROVIDER`, `AI_PROVIDER_TIMEOUT_MS`, `AI_ENABLE_LOCAL_FALLBACK`

---

## 11. Unresolved TODOs

- `src/lib/ai/conversation-engine.ts:1332-1338` — `execute*Draft` capability map: `executeExpenseDraft`, `executeTaskDraft`, `executeCreateCustomer`, `executeCreateSupplier`, `executeCreateProduct`, `executeBusinessQuery`, `executeMarketIntelligence` all marked `"TODO"` (AI drafts not executed; engine currently surfaces them as capabilities).
- `src/lib/ai/financial-intelligence.ts:103` — "TODO: Add top expense categories if available".
- AI operating-system specs (`TRADEOS_AI_*`) describe planned execution engine — not yet wired.

---

## 12. Current Version

- **Git tag**: `v0.3.0` (pushed) — "TradeOS Phase 3 - Purchasing & Inventory Complete"
- **Commit**: `7222be2` on `main`; working tree clean; `main == origin/main`
- package.json still `0.1.0` (cosmetic drift — tags are authoritative)
- Previous tags: `v1.0.0-ai-operating-system`, `milestone-post-recovery-2026-08`, `recovery-pre-vercel-2026-07`

---

## 13. Known Caveats & Recovery Notes

- **Products PK**: dev schema says serial, production is uuid (migration b98fd3b aligns FKs to uuid). Never re-run old dev schema against prod.
- **`purchase_return_items.organization_id`**: added in v0.3.0; if prod migration 5.3b is NOT applied, purchase returns fail with `record "new" has no field "organization_id"` — run the 5.3b block.
- **JWT claim**: if RLS regresses to 403/42501 across org tables, check the browser token carries `app_metadata.organization_id`; re-login or rely on `ensureOrganizationClaimInSession`.
- **Service role**: never introduce service-role writes in purchase/inventory/supplier routes (stabilization contract).
- **Post-apply verification**: rerun `production_upgrade_consolidated.sql` Part 7 (or the whole file — idempotent) and confirm `ALL REQUIRED OBJECTS PRESENT`.
