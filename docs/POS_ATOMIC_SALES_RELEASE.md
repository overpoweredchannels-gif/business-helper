# POS atomic sales release checks

This procedure covers the atomic POS sale RPC and the three-decimal quantity contract. Run concurrency and authenticated permission checks only against a disposable, isolated Supabase/PostgreSQL clone with test users and test inventory. Do not point these steps at production.

**Production classification:** Supabase project `lhqmtgrstvwtysfjjmhz` is the live TradeOS production project. It may be used only as the read-only source for the authoritative schema baseline. Never configure it as a disposable target, restore into it, seed it, or run release/concurrency tests against it.

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
- Deactivated profile: both RPCs reject with SQLSTATE `42501` or an equivalent authorization failure. The RPCs intentionally exclude inactive profiles before organization lookup and return the same generic `Owner sales permission is required` denial used for missing owner permission. Keep this message generic so it does not reveal whether an inactive profile exists. The create test verifies that invoice, item, payment, stock, return, and audit state remains unchanged; active employee and cross-organization cases retain their separate error contracts.

Then compare the isolated clone's PostgreSQL version, relevant table column types, trigger bodies, helper functions, indexes, grants, and RLS policies with the target deployed schema. Record the exact migration revision and database snapshot used. Local PGlite integration tests validate the migration SQL and mocked `auth.uid()` branches; they do not prove hosted JWT behavior or compatibility with a deployed database.

## Repeatable isolated target harness

The executable release harness is `npm run test:sales-release-postgres`. It uses only explicitly named `POS_RELEASE_*` process variables and never loads `.env.local`. It requires `psql`, a disposable PostgreSQL/Supabase clone that has already been prepared with the application's real migrations and triggers, an app server connected to that same clone, and real test-user access tokens. It does not apply or deploy migrations.

The harness now checks the test app's Supabase URL through the read-only, test-gated `/api/pos-release-environment` route before running tests. Start the app in development mode with `POS_RELEASE_TEST_TARGET=disposable-pos-atomic-sales`, `SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_URL` set to the disposable API. It checks each JWT subject, session ID and expiry, validates each token with the Auth API, and matches each subject/profile/organization and live `auth.sessions` row through the direct database connection before any test mutation. It also requires a block-overselling product and exactly 10.00 remaining credit under the `limit_only` customer policy. Stock is restored to its starting value during cleanup.

`scripts/setup-pos-release-test.ps1` automates the disposable target check and synthetic fixture setup after the authoritative application schema has been restored. Its target ref, pooler endpoint, database, project-scoped user, and API URL are fixed to `rtfowunsyrdygyvubnvs`; it never reads `.env.local`. `Verify` is read-only. `Provision` uses hidden local prompts and supported Auth Admin endpoints to create four synthetic users, their organization/profile fixtures, customers, stock/credit/subunit products, marker, and ordinary-user sessions. It stores generated settings and the test database password in a user-only LocalAppData directory. It does not restore schema, apply application migrations, or create Auth users by writing Auth tables.

This repository still does not contain the initial TradeOS schema migration: `production_upgrade_consolidated.sql` documents an upgrade from an existing v0.3.0 schema, `src/lib/identity/schema.sql` describes core tables as pre-existing, and `tradeos-schema.sql` has no recoverable DDL. Do not use PGlite's test schema as a substitute. A new disposable project must first be restored from the privately reviewed schema-only baseline and receive only missing application migrations.

### Authoritative schema handoff

Before writing fixture-creation SQL or claiming deployed-schema verification, obtain the schema-only definition from the production project above, plus the migration order and database version. The minimum relevant object set is:

- `public.organizations`, `profiles`, `staff_permissions`, `customers`, `products`, `sales_transactions`, `sales_items`, `sales_returns`, `sales_return_items`, `inventory_transactions`, `customer_payments`, `customer_payment_allocations`, `purchase_transactions`, `purchase_items`, and `audit_logs`, including columns, defaults, types/scales, checks, foreign keys, unique constraints, indexes, and sequence ownership. `pos_release_test_marker` is synthetic and belongs only in the disposable clone.
- Definitions and signatures for `create_sales_invoice_atomic`, `get_sales_invoice_request_status`, `sales_atomic_result`, `sales_tool_allowed`, `next_invoice_number`, and every function called by their RLS policies or triggers. Include owner, `SECURITY DEFINER`/`INVOKER`, function configuration such as `search_path`, and execute ACLs.
- Trigger names, timing, event, enabled state, and trigger/function definitions for sale items, returns, payments, and any stock or audit writers. Include the installed trigger order.
- RLS enabled/forced state and every permissive or restrictive policy on the listed tables, including `USING`, `WITH CHECK`, target roles, and policy command.
- Object grants and revokes for schemas, tables, sequences, and functions, plus default privileges. The `--no-privileges` / `--no-acl` options omit these; do not use them. Database role membership is cluster-wide and is not fully represented by a database schema dump, so include a private `pg_dumpall --globals-only --no-role-passwords` record if custom roles or memberships are relevant.
- Installed PostgreSQL version and extension names, versions, and schemas. Include all non-public dependencies referenced by the listed DDL, especially the actual `auth.uid()`, `auth.users`, and `auth.sessions` definitions/behavior and any project-specific helper schemas. Do not assume the dependency list is limited to `public` or `auth`.
- The source migration history/order and the exact target project reference. `production_upgrade_consolidated.sql` is an upgrade path from v0.3.0, not the missing initial schema.

The owner should run this from a trusted workstation that already has authorized read-only database access and `pg_dump`, then transfer the plain SQL output through a private channel. Configure a private libpq service/password file for the read-only connection; do not put credentials in shell history, command arguments, chat, or this repository. The command preserves object ACL statements by default; do not add `--no-privileges`/`--no-acl`:

```text
pg_dump --schema-only --no-owner --dbname "service=tradeos_schema_ro" --file tradeos-authoritative-schema.sql
```

This is a read-only schema export: it contains no customer rows. It preserves object ACL statements by default. Review the private export for embedded literals before any portions are copied into the repository; never commit connection details, access tokens, role passwords, or customer data. Preserve the migration-history output and PostgreSQL/extension version record alongside the private export.

The provisioning script fails closed if the baseline-specific marker, profile identities, or expected columns do not match. Keep generated credentials in the protected local settings file or process memory; do not print them or commit them. Rebuilding the environment from scratch also requires Docker Desktop/Supabase tooling only if using a local Supabase stack, plus compatible PostgreSQL clients for a hosted disposable project.

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

`npm run test:pos-receipt` checks generated HTML for 58 mm and 80 mm page widths, long names and amounts, 40 receipt lines, and three-decimal quantity text. `npm --prefix e2e run test:pos-receipt` separately mounts the actual `POSReceipt` component with synthetic confirmed RPC-shaped sale results, exercises the generated `srcdoc`, produces browser PDFs at both widths, and opens those PDFs in Chrome's PDF viewer for top/bottom inspection. It checks width, row geometry/count, summary values, footnote, PDF media-box width/height, and that the second print document has no first-sale content. Its synthetic HTTP template route does not exercise authenticated integration.

The same Playwright runner mocks the print/afterprint lifecycle to verify preparation, rapid duplicate actions, cleanup after a cancel-equivalent `afterprint`, reprint, and switching to a second sale. This is a mocked lifecycle check, not a native dialog check. A headed Chrome attempt opened the actual print path, but Playwright's Escape did not return an `afterprint`; the runner stalled in the blocking browser print UI and only its test processes were stopped. Native cancel/reprint/second-sale dialog evidence remains NOT RUN. Physical 58 mm/80 mm printer output remains NOT RUN. Browser PDFs and physical printer results are distinct checks.

`node scripts/test-pos-release-browser.cjs` is the sanitized authenticated browser runner for the isolated app. It reads the ordinary owner session, public API key, disposable database URL, and fixture IDs from process environment only; it verifies the app/API/database project refs before use, captures evidence under `%LOCALAPPDATA%\TradeOS\pos-release-test\browser-evidence`, and removes only its request-ID-scoped test sale/return data while restoring the fractional product's starting stock. Set `POS_RELEASE_APP_URL` when the test server is not at `http://127.0.0.1:3001` and `POS_CHROME_PATH` when Chrome is installed elsewhere. Keep the test service-role key only in the app server process; this browser runner does not need or read it.

In a browser session connected to the isolated clone, separately exercise: submit one POS sale with the network response deliberately dropped, reload, recover the same request ID, and confirm the UI renders one receipt; print the first sale, cancel the native print dialog, print that sale again, then print a second sale and confirm the content changes; produce browser print-to-PDF output for 58 mm and 80 mm templates, long business/customer/product names, large amounts, and a 40-line receipt. Physical printer checks still require the corresponding 58 mm and 80 mm devices. Record these as browser-dialog, browser-PDF, and physical-printer results separately.

## Review verification record

- Tested application commit: `aa977d5dcf5eef51d73c3cbd3bfc1534afe6bc00` on the isolated Supabase test project `rtfowunsyrdygyvubnvs`. Production project `lhqmtgrstvwtysfjjmhz` remained read-only.
- `npm run test:sales-release-postgres`: PASS. Independent PostgreSQL sessions covered duplicate request replay, competing last-stock sales, and competing customer-credit sales. Real test-user JWT checks covered owner, restricted employee, inactive profile (generic fail-closed denial), and cross-organization create/status. Fractional sale/return and cancellation checks passed. Cleanup verification found no tracked sale, item, payment, allocation, movement, return, or audit rows and restored fixture stock.
- Authenticated browser run on the same commit: PASS for owner provisioning, one fractional sale, cash shortfall/change, lost-response recovery after reload, receipt preview/reprint, fractional return/delete, sales history/export, and 360px/1440px layout checks. Browser page errors: zero. The 80mm print document produced a browser PDF. Its evidence and transaction identifiers remain under the local private test evidence directory, outside Git.
- NOT RUN on this aa977d5 application: amount/percentage discount interaction, a second consecutive sale, 58mm PDF output, authenticated search/retry/account switching, visits product lookup beyond 1,000 products, native print-dialog cancel/reprint, and physical printer output. These are reserved for the separate integrated review branch and must not be inferred from the prior run.
- Focused local PGlite tests cover uncertain-sale recovery, request replay, basic authorization/tenant checks, quantity and stock conversion, money rounding, and repository migration column scales. They use one embedded database session and a test schema; they are not deployed-schema verification.
- Browser HTML/layout and PDF checks passed for synthetic confirmed receipts at both widths, including fractional quantity `0.125`, long business/customer/product names, a PKR 99,999,999,900.00 line, the confirmed totals, and a 40-line receipt. Output is local under `%TEMP%\tradeos-pos-receipt-browser`; it is not committed.
- Mocked print lifecycle checks passed for first print, duplicate-click suppression, cancel-equivalent `afterprint` cleanup, reprint, and switching to a second receipt. Native Chrome dialog cancel/reprint/second-sale, physical printers, lost-response recovery against an isolated database, and browser history/export integration remain NOT RUN.
- On 2026-09-28, the owner confirmed `lhqmtgrstvwtysfjjmhz` is live production. This runner had no Supabase MCP resources, database connection environment variables, Docker Desktop, Supabase CLI, `psql`, or `pg_dump`; `.env.local` was not read or used. The private authoritative schema-only export with ACLs and migration/version provenance has therefore not been obtained.
- Independent PostgreSQL-session races, real authenticated JWT checks, return trigger behavior, fixture automation, and deployed-schema comparison remain NOT RUN until the owner provides the private production schema export and an isolated Supabase/PostgreSQL target is available. The production project above must never be used as that target; do not substitute any unclassified `.env.local` project either.
