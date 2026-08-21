-- Add missing customer fields for enhanced customer management
-- Safe to run multiple times (idempotent)

-- 1. Address fields
alter table public.customers
  add column if not exists address text;

alter table public.customers
  add column if not exists shipping_address text;

-- 2. Contact person (name of the person at the customer's shop)
alter table public.customers
  add column if not exists contact_person text;

-- 3. Organization/Company name (separate from shop name)
alter table public.customers
  add column if not exists organization_name text;

-- 4. Ensure assigned_territory_id exists (from import config)
alter table public.customers
  add column if not exists assigned_territory_id uuid references public.territories(id) on delete set null;

-- 5. Customer-specific pricing table: last sold price per product per customer
create table if not exists public.customer_product_prices (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  last_selling_price numeric(14, 2) not null check (last_selling_price >= 0),
  last_sold_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  unique (organization_id, customer_id, product_id)
);

create index if not exists customer_product_prices_org_customer_idx
  on public.customer_product_prices (organization_id, customer_id);
create index if not exists customer_product_prices_org_product_idx
  on public.customer_product_prices (organization_id, product_id);

alter table public.customer_product_prices enable row level security;

drop policy if exists customer_product_prices_select_org on public.customer_product_prices;
create policy customer_product_prices_select_org on public.customer_product_prices
  for select using (organization_id = current_org_id());

drop policy if exists customer_product_prices_insert_org on public.customer_product_prices;
create policy customer_product_prices_insert_org on public.customer_product_prices
  for insert with check (organization_id = current_org_id());

drop policy if exists customer_product_prices_update_org on public.customer_product_prices;
create policy customer_product_prices_update_org on public.customer_product_prices
  for update using (organization_id = current_org_id());

-- 6. Verification
do $$
declare
  v_missing text := '';
begin
  -- Check columns
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'address') then
    v_missing := v_missing || ' customers.address';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'shipping_address') then
    v_missing := v_missing || ' customers.shipping_address';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'contact_person') then
    v_missing := v_missing || ' customers.contact_person';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'organization_name') then
    v_missing := v_missing || ' customers.organization_name';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'assigned_territory_id') then
    v_missing := v_missing || ' customers.assigned_territory_id';
  end if;
  -- Check table
  if to_regclass('public.customer_product_prices') is null then
    v_missing := v_missing || ' customer_product_prices table';
  end if;
  if v_missing = '' then
    raise notice 'CUSTOMER_FIELDS_MIGRATION: PASS';
  else
    raise warning 'CUSTOMER_FIELDS_MIGRATION: MISSING =>%', v_missing;
  end if;
end $$;