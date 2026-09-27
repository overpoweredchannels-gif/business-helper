# POS atomic sales release checks

This procedure covers the atomic POS sale RPC and the three-decimal quantity contract. Run concurrency and authenticated permission checks only against a disposable, isolated Supabase/PostgreSQL clone with test users and test inventory. Do not point these steps at production.

## Migration prerequisites and order

The atomic RPC depends on the existing sales, customer, product, inventory-ledger, payment-allocation, profile, and audit tables; the stock-writing sales-item trigger; `auth.uid()`; and `sales_tool_allowed()`. The actor must have an active owner/admin profile in the sale organization. Staff draft sales continue through their existing route.

On an isolated clone:

1. Restore a recent schema/data snapshot or build the schema through the existing sales and access migrations. Confirm the stock trigger is still the only stock writer for `sales_items` inserts.
2. Apply or re-run `src/lib/migrations/production_phase13_atomic_sales.sql`. This version validates three decimal places for entered quantity and bonus while keeping prices, discounts, tender, and tax rates at two decimals. It installs request replay/status functions and authenticated grants.
3. Apply `src/lib/migrations/20260926_sales_quantity_precision.sql`. It checks the live column types/scales and refuses values that would lose quantity or stock precision, then widens `sales_items.quantity`, `sales_items.bonus`, and `sales_return_items.quantity` to `numeric(16,3)`, and `products.current_stock` and `inventory_transactions.quantity_delta` to `numeric(18,6)`.
4. Run the focused and concurrent checks below, then verify authenticated permissions and compare the clone's schema with the deployed schema prerequisites.
5. Deploy the application only after the precision migration succeeds. Do not narrow these columns as a rollback without first proving no stored values need the additional scale. The precision migration has not been applied to production as part of this review.

For schema compatibility, capture this read-only inventory on the clone before and after step 3 and compare it with the intended schema:

```sql
select table_name, column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and ( (table_name = 'sales_items' and column_name in ('quantity', 'bonus'))
     or (table_name = 'sales_return_items' and column_name = 'quantity')
     or (table_name = 'products' and column_name = 'current_stock')
     or (table_name = 'inventory_transactions' and column_name = 'quantity_delta') )
order by table_name, column_name;
```

The expected post-migration scales are 3 for `sales_items.quantity`, `sales_items.bonus`, and `sales_return_items.quantity`, and 6 for `products.current_stock` and `inventory_transactions.quantity_delta`. Confirm the other RPC dependencies and trigger definitions match `production_phase13_atomic_sales.sql`; a matching column list alone is not deployed-schema compatibility evidence.

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

## Repeatable isolated target harness

The executable release harness is `npm run test:sales-release-postgres`. It uses only explicitly named `POS_RELEASE_*` process variables and never loads `.env.local`. It requires `psql`, a disposable PostgreSQL/Supabase clone that has already been prepared with the application's real migrations and triggers, an app server connected to that same clone, and real test-user access tokens. It does not apply or deploy migrations.

The harness now checks the test app's Supabase URL through the read-only, test-gated `/api/pos-release-environment` route before running tests. Start the app in development mode with `POS_RELEASE_TEST_TARGET=disposable-pos-atomic-sales`, `SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_URL` set to the disposable API. It checks each JWT subject, session ID and expiry, validates each token with the Auth API, and matches each subject/profile/organization and live `auth.sessions` row through the direct database connection before any test mutation. It also requires a block-overselling product and exactly 10.00 remaining credit under the `limit_only` customer policy. Stock is restored to its starting value during cleanup.

Fixture provisioning is not automated from a clean Supabase database yet. This repository does not contain the initial TradeOS schema migration: `production_upgrade_consolidated.sql` documents that it upgrades an existing v0.3.0 schema, and `src/lib/identity/schema.sql` describes core tables as pre-existing. Do not use PGlite's test schema as a substitute. A fresh isolated runner needs Docker Desktop, the Supabase CLI and PostgreSQL client, plus the actual TradeOS baseline schema/migration source before the scoped application migrations and synthetic fixture setup can run.

Add this one-row guard only inside the disposable clone, using an account that can create a test-only table:

```sql
create table public.pos_release_test_marker (
  marker text primary key check (marker = 'disposable-pos-atomic-sales')
);
insert into public.pos_release_test_marker(marker) values ('disposable-pos-atomic-sales');
```

The clone needs dedicated fixtures and corresponding environment values:

- Database/API: `POS_RELEASE_TEST_TARGET=disposable-pos-atomic-sales`, `POS_RELEASE_TEST_DATABASE_URL`, `POS_RELEASE_SUPABASE_URL`, `POS_RELEASE_SUPABASE_ANON_KEY`, and `POS_RELEASE_APP_URL`. The app URL must serve the same isolated Supabase project.
- Organization/profile IDs: `POS_RELEASE_ORGANIZATION_ID`, `POS_RELEASE_OWNER_PROFILE_ID`, `POS_RELEASE_EMPLOYEE_PROFILE_ID`, `POS_RELEASE_INACTIVE_PROFILE_ID`, `POS_RELEASE_OTHER_ORG_ID`, and `POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID`.
- Fixture IDs: `POS_RELEASE_CASH_CUSTOMER_ID`, `POS_RELEASE_CREDIT_CUSTOMER_ID`, `POS_RELEASE_STOCK_PRODUCT_ID`, `POS_RELEASE_CREDIT_PRODUCT_ID`, and `POS_RELEASE_AUTH_PRODUCT_ID`.
- Real access tokens: `POS_RELEASE_OWNER_ACCESS_TOKEN`, `POS_RELEASE_EMPLOYEE_ACCESS_TOKEN`, `POS_RELEASE_INACTIVE_ACCESS_TOKEN`, and `POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN`. Use ordinary authenticated user JWTs, never a service-role key.

Use an active owner/admin, an active restricted employee, a deactivated owner profile with a still-valid test-user JWT, and an active owner from a second organization. The cash customer must be active and cash-only. The stock product must be active with `overselling_policy='block'`; the script sets its isolated-clone stock to one before the race and removes test sales after. The credit customer must be active with `credit_policy='limit_only'`, a limit of 10, and zero pre-existing outstanding; its separate product needs at least 20 units. The authenticated fractional-sale product must be active, have `units_per_pack=12`, and enough stock. The DB connection account needs permission to `SET ROLE authenticated`, inspect system catalogs, and clean only test rows created by this script.

Set these values in the test runner's process environment, then run `npm run test:sales-release-postgres`. A missing variable, missing marker, missing migration scale, or missing stock trigger fails closed. The harness exercises independent database sessions for duplicate request, final stock, and customer credit races; real owner/employee/inactive/cross-organization JWT calls; fractional sub-unit sale and return through the app API; and return deletion/cancellation through the authenticated Supabase API. It reports the PostgreSQL version, database name, expected repository migration column scales, and trigger definitions. Keep its output as clone evidence. It is not deployed-schema evidence unless the clone is independently compared with the target deployment.

## Browser and output checks

`npm run test:pos-receipt` checks generated HTML for 58 mm and 80 mm page widths, long names and amounts, 40 receipt lines, and three-decimal quantity text. This is an HTML-generation test only. It does not open a browser print dialog or produce a browser PDF. The PostgreSQL release harness checks persisted sale/return quantities and stock triggers but does not render the history table or export workflow in a browser.

In a browser session connected to the isolated clone, separately exercise: submit one POS sale with the network response deliberately dropped, reload, recover the same request ID, and confirm the UI renders one receipt; print the first sale, cancel the native print dialog, print that sale again, then print a second sale and confirm the content changes; produce browser print-to-PDF output for 58 mm and 80 mm templates, long business/customer/product names, large amounts, and a 40-line receipt. Physical printer checks still require the corresponding 58 mm and 80 mm devices. Record these as browser-dialog, browser-PDF, and physical-printer results separately.

## Review verification record

- Focused local PGlite tests cover uncertain-sale recovery, request replay, basic authorization/tenant checks, quantity and stock conversion, money rounding, and repository migration column scales. They use one embedded database session and a test schema; they are not deployed-schema verification.
- Independent PostgreSQL-session races, real authenticated JWT checks, return trigger behavior, and deployed-schema comparison remain NOT RUN until the isolated target and fixture settings above exist. Do not substitute the application's unclassified `.env.local` Supabase project for that target.
- Short and long receipt output is covered by HTML-generation regressions, including both paper widths and 40 lines. Browser-native repeated printing, browser PDFs, the actual reload/recovery UI path, and physical 58 mm/80 mm printers remain separate NOT RUN checks until a browser session and devices are available.
