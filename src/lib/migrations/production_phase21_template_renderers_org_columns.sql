-- Phase 21 — organization settings columns the app already reads/writes
-- (template renderers + Business Settings) (additive).
--
-- What it does:
--   * Adds the four columns the Business Settings load/save tolerated as
--     missing (Postgres 42703) — staff_sales_mode, drawer_no_sale_staff_allowed,
--     books_currency, regional_preferences. Until they exist, the tolerant
--     read silently drops each missing column (a staff sale stays "approval",
--     staff No Sale stays blocked, books currency falls back to PKR) and the
--     tolerant save silently drops the two owner toggles while still showing
--     "Business settings saved". After this migration the code selects and
--     updates all four directly, and any failure surfaces as a visible error
--     instead of silently producing wrong output.
--   * Adds invoice_footer_note and default_payment_terms (IF NOT EXISTS, so
--     a database that already has them — e.g. via the provision insert — is
--     untouched). The template renderers read these two columns through the
--     invoice/load-form query routes; the floor of the old tolerant read
--     already assumed they exist, so this makes that assumption true by
--     construction.
--   * Types mirror what the code already expects: staff_sales_mode is text
--     ('direct' / anything-else-means-'approval', see
--     src/lib/sales/staff-sale-gate.ts); drawer_no_sale_staff_allowed is
--     boolean (see src/lib/sales/drawer-gate.ts); books_currency is a text
--     currency code (see src/lib/books/currency.ts); regional_preferences
--     is jsonb (keys timeZone / language / accountingCurrency, read with
--     optional chaining everywhere).
--
-- Safe to run more than once (IF NOT EXISTS everywhere). Purely additive:
-- no rows are changed, no constraints are added, nothing is dropped. All
-- six columns are nullable with no default, so existing rows read exactly
-- as the old tolerant code treated a missing column (absent) — the only
-- change is that reads and writes no longer fail or silently drop.
-- Run this file in the Supabase SQL Editor (production + QA).
-- NOTE: run it BEFORE promoting a build that selects these columns
-- directly, or the Business Settings load will fail with a visible 42703
-- error instead of loading.

begin;

alter table public.organizations
  add column if not exists staff_sales_mode text,
  add column if not exists drawer_no_sale_staff_allowed boolean,
  add column if not exists books_currency text,
  add column if not exists regional_preferences jsonb,
  add column if not exists invoice_footer_note text,
  add column if not exists default_payment_terms text;

do $$
declare
  missing text[];
begin
  select array_agg(column_name)
    into missing
    from (
      values
        ('staff_sales_mode', 'text'),
        ('drawer_no_sale_staff_allowed', 'boolean'),
        ('books_currency', 'text'),
        ('regional_preferences', 'jsonb'),
        ('invoice_footer_note', 'text'),
        ('default_payment_terms', 'text')
    ) as expected(column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'organizations'
        and columns.column_name = expected.column_name
        and columns.data_type = expected.data_type
    );
  if missing is not null then
    raise exception 'organizations is missing columns: %', array_to_string(missing, ', ');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
