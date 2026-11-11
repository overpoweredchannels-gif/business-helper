-- Phase 19 — supplier recycle bin + full-field supplier columns (additive).
--
-- What it does:
--   * Adds `deleted_at` to public.suppliers so a supplier can be moved to a
--     7-day recycle bin (deleted_at set) and restored (deleted_at cleared)
--     without losing the row. Archived suppliers keep deleted_at NULL and
--     is_active = false; the bin is the only state with deleted_at set.
--   * Adds the five supplier credit/payment columns the full-field supplier
--     API (src/lib/purchases/services/supplier-service.ts) already writes:
--     credit_days, credit_policy, preferred_payment_method, allow_over_limit,
--     allow_overdue_sales. The live table only had area + credit_limit, so
--     the full-field create/update path could never persist these fields.
--     Types mirror the customers table (credit_days integer, credit_limit
--     numeric, credit_policy text, allow_* boolean).
--
-- Safe to run more than once (IF NOT EXISTS everywhere). Purely additive:
-- no rows are changed, no constraints are added, nothing is dropped. The
-- service validates credit_policy ('cash_only' / 'unrestricted') before
-- writing, so no CHECK constraint is added here.
-- Run this file in the Supabase SQL Editor (production + QA).
-- NOTE: run it BEFORE promoting a build that calls the supplier API with
-- the new fields, or the API will fail on the missing columns.

begin;

alter table public.suppliers
  add column if not exists deleted_at timestamptz,
  add column if not exists credit_days integer,
  add column if not exists credit_policy text,
  add column if not exists preferred_payment_method text,
  add column if not exists allow_over_limit boolean,
  add column if not exists allow_overdue_sales boolean;

do $$
declare
  missing text[];
begin
  select array_agg(column_name)
    into missing
    from (
      values
        ('deleted_at', 'timestamp with time zone'),
        ('credit_days', 'integer'),
        ('credit_policy', 'text'),
        ('preferred_payment_method', 'text'),
        ('allow_over_limit', 'boolean'),
        ('allow_overdue_sales', 'boolean')
    ) as expected(column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'suppliers'
        and columns.column_name = expected.column_name
        and columns.data_type = expected.data_type
    );
  if missing is not null then
    raise exception 'suppliers is missing columns: %', array_to_string(missing, ', ');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
