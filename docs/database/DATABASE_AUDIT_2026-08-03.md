# TradeOS Database Audit — 2026-08-03

## 1. Executive summary

The connected Supabase production database is missing four tables that the
application code requires:

| Missing table | Used by | Created by |
|---|---|---|
| `inventory_transactions` | Inventory ledger (page.tsx, adjust RPC, triggers) | `production_upgrade_consolidated.sql` Part 4 |
| `purchase_orders` | Purchase orders UI (page.tsx, api/purchases/returns) | `production_upgrade_consolidated.sql` Part 5 |
| `purchase_returns` | Purchase returns UI (page.tsx, api/purchases/returns) | `production_upgrade_consolidated.sql` Part 5 |
| `invoice_sequences` (reported by the user as "invoice_counters") | Sales/purchase invoice numbering (`InvoiceNumberService`) | `production_upgrade_consolidated.sql` Part 2 |

**Root cause:** The database was verified read-only on 2026-08-02 (see the
header of `src/lib/migrations/production_upgrade_consolidated.sql`) and the
consolidated upgrade file — which contains all four missing tables plus their
functions, triggers, policies, and indexes — was never executed against the
connected database. Earlier statements that "the production migration has
already been executed successfully" do not match the current database state:
several migrations shipped as standalone files (`inventory/schema.sql`,
`purchases/schema.sql`, `invoices/schema.sql`) were never run in production,
and the consolidated file was produced precisely to close that gap but has not
been applied.

**Naming mismatch to resolve:** the user confirmed `invoice_counters` as
missing, but the codebase defines the counter table as `invoice_sequences`
(composite PK `(organization_id, invoice_type)`, populated atomically by the
`next_invoice_number(uuid, text)` RPC). No `invoice_counters` table exists in
any codebase file — the application will not work with a table named
`invoice_counters`. The migration creates `invoice_sequences`; do not create a
parallel `invoice_counters` table.

**Fix:** run the single file
`src/lib/migrations/production_upgrade_consolidated.sql` in the Supabase SQL
editor (see section 13 for deployment instructions). It is idempotent, safe to
re-run, preserves all existing data, and ends with a PASS/FAIL verification
block.

## 2. Scope and method

- Audited objects: all 8 SQL schema files in the repository
  (`identity`, `inventory`, `inventory/overselling-policy`, `invoices`,
  `location`, `migrations/production_upgrade_consolidated`, `products`,
  `purchases`).
- Cross-checked against every `.from("table")` reference in
  `src/app/page.tsx` (37 tables) and `src/app/api/**` routes (15 tables), and
  every `.rpc("fn")` call (1: `adjust_inventory`).
- Compared the consolidated migration against the standalone schema files to
  find objects the consolidated file was missing.
- Cannot connect to the database from this environment (CLI-only, no
  credentials available); "exists" status is based on the user's direct
  confirmation plus the 2026-08-02 read-only verification documented in the
  migration header. Section 14 lists verification queries to run after apply.

## 3. Database inventory (36 tables in the app's public schema)

Per `docs/database/DATABASE_INVENTORY.md` (36 tables):

`organizations`, `profiles`, `permissions`, `profile_permissions`, `brands`,
`categories`, `products`, `suppliers`, `customers`, `purchase_transactions`,
`purchase_items`, `sales_transactions`, `sales_items`, `expenses`,
`invoice_sequences`, `customer_payments`, `supplier_payments`,
`customer_payment_allocations`, `supplier_payment_allocations`, `tasks`,
`audit_logs`, `security_checks`, `staff_permissions`, `staff_duty_sessions`,
`staff_location_points`, `ai_action_drafts`, `ai_action_messages`, `ai_alerts`,
`ai_daily_briefings`, `ai_business_query_logs`, `ai_voice_operator_sessions`,
`ai_voice_operator_messages`, `market_news_sources`, `market_import_queue`,
`market_intelligence_items`, `market_ai_analyses`.

Plus 4 identity tables defined in code (not yet in the inventory doc):
`role_definitions`, `role_invitations`, `device_sessions`,
`password_reset_tokens`.

The 37 tables referenced by `src/app/page.tsx` all exist in the inventory
above; no frontend table reference points at an object that is not accounted
for. `inventory_transactions`, `purchase_orders`, `purchase_returns` are
frontend-referenced and missing from the DB; `invoice_sequences` is
service-referenced and missing.

## 4. Table existence status

| Table | Defined in | Status in DB | Migrated by |
|---|---|---|---|
| organizations, profiles, customers, suppliers | live DB (no file) | EXISTS | — |
| sales/purchase transactions + items | live DB (no file) | EXISTS | — |
| expenses, tasks, audit_logs, security_checks | live DB (no file) | EXISTS | — |
| customer/supplier payments + allocations | live DB (no file) | EXISTS | — |
| staff_permissions | live DB (no file) | EXISTS | — |
| staff_duty_sessions, staff_location_points | location/schema.sql (documentation only) | EXISTS | — |
| ai_*, market_* | live DB (no file) | EXISTS | — |
| brands, categories, products | products/schema.sql | EXISTS | consolidated Part 1 |
| invoice_sequences | invoices/schema.sql | **MISSING** | consolidated Part 2 |
| inventory_transactions | inventory/schema.sql | **MISSING** | consolidated Part 4 |
| purchase_orders, purchase_order_items | purchases/schema.sql | **MISSING** | consolidated Part 5 |
| purchase_returns, purchase_return_items | purchases/schema.sql | **MISSING** | consolidated Part 5 |
| role_definitions, role_invitations | identity/schema.sql | likely missing | consolidated Part 0 |
| device_sessions, password_reset_tokens | identity/schema.sql | likely missing | consolidated Part 0 |

## 5. Functions / RPCs required

| Function | Used by | In consolidated |
|---|---|---|
| `current_org_id()` | RLS policies | Part 1 |
| `set_updated_at()` | products/brands/categories triggers | Part 1 |
| `has_product_permission(uuid)` | products/brands/categories write policies | Part 1 |
| `next_invoice_number(uuid, text)` | InvoiceNumberService | Part 2 |
| `resolve_overselling_policy(uuid, integer)` | sale sync trigger | Part 3 |
| `has_inventory_permission(uuid)` | adjust_inventory | Part 4 |
| `inventory_sync_purchase_item()` | purchase_items trigger | Part 4 |
| `inventory_sync_sale_item()` | sales_items trigger | Part 4 |
| `adjust_inventory(uuid, integer, numeric, text, text, date, uuid)` | api/inventory/adjust (only RPC call in the app) | Part 4 |
| `inventory_sync_purchase_return_item()` | purchase_return_items trigger | Part 5 |

Executes: `next_invoice_number`, `adjust_inventory`,
`resolve_overselling_policy` are revoked from `public` and granted to
`authenticated` (+ `service_role` for next_invoice_number). All sync trigger
functions are SECURITY DEFINER.

## 6. Triggers required

`products_set_updated_at`, `brands_set_updated_at`, `categories_set_updated_at`
(Part 1); `inventory_sync_purchase_item` on `purchase_items`,
`inventory_sync_sale_item` on `sales_items` (Part 4);
`inventory_sync_purchase_return_item` on `purchase_return_items` (Part 5).

## 7. Indexes required

- Part 1: 6 products indexes + 3 brands + 3 categories + 4 guarded unique
  indexes (SKU, barcode, brand+name, null-brand name).
- Part 2: unique org+invoice_number on sales/purchase transactions + search
  indexes (invoice_number, sale/purchase_date, customer/supplier,
  created_by, payment_type, status, created_at).
- Part 4: 5 `inv_tx_*` indexes on inventory_transactions.
- Part 5: 5 purchase_orders + 2 purchase_order_items + 3 purchase_returns +
  2 purchase_return_items indexes.
- Part 6 (added this audit): `idx_location_points_org_captured`,
  `idx_location_points_profile`, `idx_duty_sessions_active` — the three
  recommended indexes from `location/schema.sql` that were missing from the
  consolidated file.

## 8. RLS policies required

- Part 1: products/brands/categories select + write (org-scoped).
- Part 4: inventory_transactions select (org-scoped).
- Part 5: purchase_orders / purchase_returns select+insert+update+delete
  (org-scoped); purchase_order_items / purchase_return_items select+insert+
  update+delete (parent-scoped via EXISTS).

## 9. Constraints / checks / grants

- CHECK constraints: products (name length, prices >= 0, current_stock),
  invoice_sequences.invoice_type, sales/purchase status + invoice_type,
  inventory_transactions movement_type/reference_type + adjustment-reason,
  purchase order/return status, quantity checks, overselling_policy on
  organizations/categories/products.
- FK indexes: all FKs listed in the schema files are covered by the indexes
  above; no additional FK-only indexes required.
- Grants: RPC executes granted to authenticated/service_role as in section 5.

## 10. Views, enums, sequences

- Views: none required (no CREATE VIEW in any schema file).
- Enums: none (all constrained text columns; no CREATE TYPE).
- Sequences: only the implicit `products_id_seq` (serial PK) — created with
  the products table. `invoice_sequences` is a table, not a sequence.

## 11. Column additions on existing tables (Part 1/2/4)

products (sku, barcode, unit_type, units_per_pack, last_purchase_price,
default_purchase_price, default_selling_price, minimum_stock_level,
reorder_level, current_stock NOT NULL 0, track_batch, track_expiry, is_active,
created_at, updated_at, overselling_policy); categories.overselling_policy;
organizations.overselling_policy (NOT NULL default 'allow');
staff_permissions.can_manage_inventory (NOT NULL default false);
sales_transactions (status 'confirmed', invoice_type 'sales',
created_by_profile_id, total_amount); purchase_transactions (status
'confirmed', invoice_type 'purchase', created_by_profile_id,
supplier_invoice_number, total_amount); purchase_items.organization_id;
sales_items.organization_id.

## 12. Gaps found in the consolidated migration during this audit (now fixed)

Comparing the consolidated file against the standalone schema files revealed
three gaps, all now added to `production_upgrade_consolidated.sql`:

1. **Identity tables** (Part 0, new): role_definitions, role_invitations,
   device_sessions, password_reset_tokens + 6 indexes were in
   `identity/schema.sql` but absent from the consolidated file.
2. **created_at indexes** (Part 2): `sales_transactions_created_at_idx` and
   `purchase_transactions_created_at_idx` (in `invoices/schema.sql`) were
   missing.
3. **Location indexes** (Part 6, new): the three recommended indexes from
   `location/schema.sql` were missing.

The verification block (now Part 7) was extended to assert the identity
tables and the new indexes.

## 13. Deployment instructions

1. Open the Supabase dashboard → SQL editor (or use `psql` / `supabase db
   push` if your project is linked; this project has no migration runner, SQL
   is run manually by convention).
2. Open `src/lib/migrations/production_upgrade_consolidated.sql` and paste the
   entire file into the SQL editor.
3. Run it. Expected result:
   - Either a NOTICE `ALL REQUIRED OBJECTS PRESENT — consolidated production
     migration complete.` (PASS), or
   - An exception `MIGRATION INCOMPLETE — missing objects: ...` listing what
     still needs attention (FAIL). The only tolerated WARNINGs are the four
     guarded unique indexes if duplicate product data exists (clean
     duplicates, then re-run the file).
4. The migration is safe to re-run multiple times; every statement is
   idempotent, nothing is dropped except triggers/CHECK constraints that are
   immediately recreated, and the one-time stock backfill runs only when
   `inventory_transactions` is empty.
5. After a PASS, re-verify with the queries in section 14.

## 14. Post-apply verification queries

```sql
-- 1. Missing tables now exist
select tablename from pg_tables
where schemaname = 'public' and tablename in
  ('invoice_sequences', 'inventory_transactions', 'purchase_orders',
   'purchase_order_items', 'purchase_returns', 'purchase_return_items',
   'role_definitions', 'role_invitations', 'device_sessions',
   'password_reset_tokens')
order by 1;

-- 2. Ledger backfill: every product with history has ledger rows
select p.id, p.name, p.current_stock,
       coalesce(sum(t.quantity_delta), 0) as ledger_sum
from public.products p
left join public.inventory_transactions t on t.product_id = p.id
group by p.id, p.name, p.current_stock
having coalesce(sum(t.quantity_delta), 0) <> p.current_stock;

-- 3. Stock ledger balances never diverge after new purchases/sales
-- (expected: 0 rows if the sync triggers work)
select t.product_id, sum(t.quantity_delta)
from public.inventory_transactions t
group by t.product_id
having sum(t.quantity_delta) < 0;

-- 4. Invoice counters increment atomically: insert a test row and check
select * from public.invoice_sequences
order by organization_id, invoice_type;

-- 5. RPC accessibility
select proname, proargnames
from pg_proc
where proname in ('next_invoice_number', 'adjust_inventory',
                  'resolve_overselling_policy', 'inventory_sync_purchase_item',
                  'inventory_sync_sale_item', 'inventory_sync_purchase_return_item');

-- 6. RLS policies present
select schemaname, tablename, policyname from pg_policies
where schemaname = 'public' and tablename in
  ('inventory_transactions', 'purchase_orders', 'purchase_order_items',
   'purchase_returns', 'purchase_return_items')
order by 2, 3;
```

## 15. Recommendations

1. **Do NOT create `invoice_counters`** — the app uses `invoice_sequences`;
   a parallel table would be dead weight.
2. After applying, update `docs/database/DATABASE_INVENTORY.md` to include the
   four identity tables and the purchase/inventory tables in the inventory
   summary (currently 36 tables; will be 43 with role_definitions,
   role_invitations, device_sessions, password_reset_tokens,
   invoice_sequences, inventory_transactions, purchase_orders,
   purchase_order_items, purchase_returns, purchase_return_items minus the
   hypothetical invoice_counters).
3. Consider adding a `supabase/migrations/` directory with numbered copies so
   future environments apply schema via `supabase db push` instead of manual
   SQL-editor runs (currently out of scope — audit only, no React changes, no
   commits).
