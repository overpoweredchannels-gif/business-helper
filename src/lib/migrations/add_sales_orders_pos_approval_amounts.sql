-- POS approval-mode save: persist invoice discount, tax and cash tender on
-- staff-created draft sales (public.sales_orders) so approval converts them
-- into an invoice identical to a normal (owner/direct) save.
--
-- What it does:
--   * Adds `invoice_discount` + `invoice_discount_type` to sales_orders so
--     a staff POS sale keeps its invoice-level discount through approval.
--     Types mirror the normal save path (create_sales_invoice_atomic, phase
--     13): discount numeric(14,2), type 'flat' | 'percent'.
--   * Adds `tax_rate` (numeric(5,2), mirroring sales_transactions.tax_rate)
--     so a staff POS sale keeps its tax rate through approval.
--   * Adds `cash_received` (numeric(14,2), NULLABLE) so a staff POS cash
--     sale keeps its tender through approval. NULL means "not tendered at
--     POS" — exactly like the normal save, where a non-quick-sale cash
--     invoice sends cash_received NULL and the RPC defaults it to the total;
--     card/credit sales store 0 on the converted invoice, never here.
--
-- Safe to run more than once (IF NOT EXISTS everywhere). Purely additive:
-- no rows are changed, no constraints are added beyond the discount-type
-- CHECK on the new column, nothing is dropped. The draft service validates
-- the values (discount >= 0, percent <= 100, flat <= line subtotal,
-- tax 0-999.99, cash >= 0) before writing, mirroring the RPC.
-- Run this file in the Supabase SQL Editor (production + QA).
-- NOTE: run it BEFORE promoting a build that calls the draft API with the
-- new fields, or the API will fail on the missing columns.

begin;

alter table public.sales_orders
  add column if not exists invoice_discount numeric(14,2) not null default 0,
  add column if not exists invoice_discount_type text not null default 'flat'
    check (invoice_discount_type in ('flat', 'percent')),
  add column if not exists tax_rate numeric(5,2) not null default 0,
  add column if not exists cash_received numeric(14,2);

do $$
declare
  missing text[];
begin
  select array_agg(column_name)
    into missing
    from (
      values
        ('invoice_discount', 'numeric'),
        ('invoice_discount_type', 'text'),
        ('tax_rate', 'numeric'),
        ('cash_received', 'numeric')
    ) as expected(column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'sales_orders'
        and columns.column_name = expected.column_name
        and columns.data_type = expected.data_type
    );
  if missing is not null then
    raise exception 'sales_orders is missing columns: %', array_to_string(missing, ', ');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
