# POS atomic sales release checks

This procedure covers the atomic POS sale RPC and the three-decimal quantity contract. Run concurrency and authenticated permission checks only against a disposable, isolated Supabase/PostgreSQL clone with test users and test inventory. Do not point these steps at production.

## Migration prerequisites and order

The atomic RPC depends on the existing sales, customer, product, inventory-ledger, payment-allocation, profile, and audit tables; the stock-writing sales-item trigger; `auth.uid()`; and `sales_tool_allowed()`. The actor must have an active owner/admin profile in the sale organization. Staff draft sales continue through their existing route.

On an isolated clone:

1. Restore a recent schema/data snapshot or build the schema through the existing sales and access migrations. Confirm the stock trigger is still the only stock writer for `sales_items` inserts.
2. Apply or re-run `src/lib/migrations/production_phase13_atomic_sales.sql`. This version validates three decimal places for entered quantity and bonus while keeping prices, discounts, tender, and tax rates at two decimals. It installs request replay/status functions and authenticated grants.
3. Apply `src/lib/migrations/20260926_sales_quantity_precision.sql`. It checks the live column types/scales and refuses values that would lose quantity or stock precision, then widens `sales_items.quantity` and `bonus` to `numeric(16,3)`, and `products.current_stock` and `inventory_transactions.quantity_delta` to `numeric(18,6)`.
4. Run the focused and concurrent checks below, then verify authenticated permissions and compare the clone's schema with the deployed schema prerequisites.
5. Deploy the application only after the precision migration succeeds. Do not narrow these columns as a rollback without first proving no stored values need the additional scale. The precision migration has not been applied to production as part of this review.

For schema compatibility, capture this read-only inventory on the clone before and after step 3 and compare it with the intended schema:

```sql
select table_name, column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and ( (table_name = 'sales_items' and column_name in ('quantity', 'bonus'))
     or (table_name = 'products' and column_name = 'current_stock')
     or (table_name = 'inventory_transactions' and column_name = 'quantity_delta') )
order by table_name, column_name;
```

The expected post-migration scales are 3 for `sales_items.quantity` and `sales_items.bonus`, and 6 for `products.current_stock` and `inventory_transactions.quantity_delta`. Confirm the other RPC dependencies and trigger definitions match `production_phase13_atomic_sales.sql`; a matching column list alone is not deployed-schema compatibility evidence.

## Independent PostgreSQL-session concurrency checks

Create dedicated test fixtures in the isolated clone: an active owner profile and authenticated test user, an active customer, and active products with the stated stock. Keep the fixture IDs and request UUIDs stable for each run. Use direct PostgreSQL sessions with `SET ROLE authenticated` and the test user's `request.jwt.claim.sub` to test database function serialization. These claims exercise the database permission checks but do not replace the real-JWT checks in the next section.

Use a fresh request UUID per scenario. Replace the uppercase placeholders. In each session, set the actor claim before calling the RPC:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'OWNER_PROFILE_UUID', true);
select public.create_sales_invoice_atomic(
  'REQUEST_UUID',
  '{"customer_id":"CUSTOMER_UUID","sale_date":"2026-09-26","payment_type":"cash","invoice_discount":0,"invoice_discount_type":"flat","tax_rate":0,"cash_received":1,"credit_override_confirmed":false,"lines":[{"product_id":"PRODUCT_UUID","quantity":1,"selling_price":1,"discount":0,"bonus":0,"unit_mode":"main"}]}'::jsonb
);
```

Run the calls below in **two independent sessions**. Keep session A's transaction open after its RPC returns; start session B, confirm it is waiting on a lock, then commit A. Record both RPC results and any constraint/stock error.

### Duplicate request ID

Use the same request UUID and identical input in A and B, with a product that has at least two units. A must return the newly created invoice. After A commits, B must return the same invoice with `replayed=true`. Verify exactly one `sales_transactions` row for `(organization_id, request_id)`, one set of sale items, and one stock movement. Reusing that UUID with changed JSON must be rejected.

### Competing last-stock sales

Use distinct request UUIDs, the same one-unit product, cash customer, and identical one-unit sale input in A and B. Hold A open while B starts. After A commits, B must fail the stock policy. Verify one confirmed sale, one stock movement, and zero remaining main-unit stock; no negative stock or second invoice may appear.

### Competing customer-credit sales

Set up a customer with `credit_policy='limit_only'`, a credit limit exactly equal to one test invoice, zero existing outstanding balance, and enough stock for both requests. Use distinct request UUIDs and `payment_type='credit'` for the same invoice amount in A and B. Hold A open while B starts. After A commits, B must fail the credit-limit check. Verify total confirmed outstanding for that customer is at most the limit and only one of the two invoices exists.

These race checks are meaningful only when A and B are separate database connections and B is started before A commits. Save session logs and the final row/stock/balance queries as release evidence.

## Authenticated permission and deployed-schema checks

On the isolated clone, use real test-user access tokens through the authenticated Supabase client or PostgREST RPC endpoint. Do not use a service-role client for these checks.

- Active owner in the organization: create sale and read request status successfully.
- Active employee without owner sales access: both RPCs reject with permission denied.
- Owner from another organization: cannot create against another tenant's customer/product or read its request status.
- Different active owner attempting another actor's request UUID: status and replay reject rather than disclosing the sale.
- Deactivated profile: both RPCs reject.

Then compare the isolated clone's PostgreSQL version, relevant table column types, trigger bodies, helper functions, indexes, grants, and RLS policies with the target deployed schema. Record the exact migration revision and database snapshot used. Local PGlite integration tests validate the migration SQL and mocked `auth.uid()` branches; they do not prove hosted JWT behavior or compatibility with a deployed database.

## Review verification record

- Focused local PGlite tests cover uncertain-sale recovery, request replay, basic authorization/tenant checks, quantity and stock conversion, and money rounding. They use one embedded database session.
- Independent PostgreSQL-session races, real authenticated JWT checks, and deployed-schema comparison were not run in this review because no isolated PostgreSQL/Supabase test target was configured. Do not substitute the application's unclassified `.env.local` Supabase project for that target.
- Short and long receipt output is covered by HTML-generation regressions, including both paper widths and 40 lines. Browser-native repeated printing and physical 58 mm/80 mm printers were not available for verification.
