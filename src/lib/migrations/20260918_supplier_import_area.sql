-- Run this complete file in the Supabase SQL Editor.
-- Safe to run more than once. It preserves all existing supplier records.

begin;

alter table public.suppliers
  add column if not exists area text;

comment on column public.suppliers.area is
  'Supplier area or neighborhood, used by TradeOS supplier imports and filtering.';

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'suppliers'
      and column_name = 'area'
      and data_type = 'text'
  ) then
    raise exception 'suppliers.area was not created as text';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
