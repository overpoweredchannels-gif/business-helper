-- Customer management profile fields required by the application.
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.

begin;

alter table public.customers
  add column if not exists organization_name text,
  add column if not exists contact_person text,
  add column if not exists address text,
  add column if not exists shipping_address text;

create index if not exists customers_org_customer_name_idx
  on public.customers (organization_id, customer_name);

commit;

do $$
declare
  missing_columns text[] := array[]::text[];
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'organization_name') then
    missing_columns := array_append(missing_columns, 'organization_name');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'contact_person') then
    missing_columns := array_append(missing_columns, 'contact_person');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'address') then
    missing_columns := array_append(missing_columns, 'address');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'shipping_address') then
    missing_columns := array_append(missing_columns, 'shipping_address');
  end if;

  if cardinality(missing_columns) = 0 then
    raise notice 'CUSTOMER_MANAGEMENT_FIX: PASS';
  else
    raise exception 'CUSTOMER_MANAGEMENT_FIX: missing columns: %', array_to_string(missing_columns, ', ');
  end if;
end $$;
