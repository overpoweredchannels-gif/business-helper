-- TradeOS ERP V2 — Sales Management (Phase 4)
--
-- Dev-parity schema mirroring src/lib/migrations/production_phase4_sales.sql
-- (Part B/C only — production-owned tables). Products use serial ids in dev,
-- uuid in production; keep column types in sync with the local database.
-- RLS / triggers are defined here for fresh local databases; production
-- applies the consolidated migration files.

-- ---------------------------------------------------------------------------
-- 1. Sales orders (mirror of purchase_orders)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_orders (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  so_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  order_date date,
  expected_date date,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'converted', 'confirmed', 'delivered', 'cancelled')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, so_number)
);

create index if not exists sales_orders_org_created_idx on public.sales_orders (organization_id, created_at);
create index if not exists sales_orders_org_number_idx on public.sales_orders (organization_id, so_number);
create index if not exists sales_orders_org_customer_idx on public.sales_orders (organization_id, customer_id);
create index if not exists sales_orders_org_status_idx on public.sales_orders (organization_id, status);
create index if not exists sales_orders_org_order_date_idx on public.sales_orders (organization_id, order_date);

create table if not exists public.sales_order_items (
  id uuid not null default gen_random_uuid() primary key,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  quantity_ordered numeric(14, 2) not null check (quantity_ordered > 0),
  quantity_delivered numeric(14, 2) not null default 0 check (quantity_delivered >= 0),
  bonus numeric(14, 2) not null default 0 check (bonus >= 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  unit_mode text not null default 'main' check (unit_mode in ('main', 'subunit')),
  created_at timestamptz not null default now()
);

create index if not exists sales_order_items_order_idx on public.sales_order_items (sales_order_id);
create index if not exists sales_order_items_product_idx on public.sales_order_items (product_id);

-- ---------------------------------------------------------------------------
-- 2. Sales returns (mirror of purchase_returns)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_returns (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  sales_transaction_id uuid references public.sales_transactions(id) on delete set null,
  return_date date,
  reason text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, return_number)
);

create index if not exists sales_returns_org_created_idx on public.sales_returns (organization_id, created_at);
create index if not exists sales_returns_org_number_idx on public.sales_returns (organization_id, return_number);
create index if not exists sales_returns_org_customer_idx on public.sales_returns (organization_id, customer_id);

create table if not exists public.sales_return_items (
  id uuid not null default gen_random_uuid() primary key,
  sales_return_id uuid not null references public.sales_returns(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  unit_mode text not null default 'main' check (unit_mode in ('main', 'subunit')),
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists sales_return_items_return_idx on public.sales_return_items (sales_return_id);
create index if not exists sales_return_items_product_idx on public.sales_return_items (product_id);
create index if not exists sales_return_items_org_idx on public.sales_return_items (organization_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;

drop policy if exists sales_orders_select_org on public.sales_orders;
create policy sales_orders_select_org on public.sales_orders
  for select using (organization_id = current_org_id());
drop policy if exists sales_orders_insert_org on public.sales_orders;
create policy sales_orders_insert_org on public.sales_orders
  for insert with check (organization_id = current_org_id());
drop policy if exists sales_orders_update_org on public.sales_orders;
create policy sales_orders_update_org on public.sales_orders
  for update using (organization_id = current_org_id());
drop policy if exists sales_orders_delete_org on public.sales_orders;
create policy sales_orders_delete_org on public.sales_orders
  for delete using (organization_id = current_org_id());

drop policy if exists sales_order_items_select_org on public.sales_order_items;
create policy sales_order_items_select_org on public.sales_order_items
  for select using (
    exists (
      select 1 from public.sales_orders so
      where so.id = sales_order_items.sales_order_id
        and so.organization_id = current_org_id()
    )
  );
drop policy if exists sales_order_items_insert_org on public.sales_order_items;
create policy sales_order_items_insert_org on public.sales_order_items
  for insert with check (
    exists (
      select 1 from public.sales_orders so
      where so.id = sales_order_items.sales_order_id
        and so.organization_id = current_org_id()
    )
  );
drop policy if exists sales_order_items_update_org on public.sales_order_items;
create policy sales_order_items_update_org on public.sales_order_items
  for update using (
    exists (
      select 1 from public.sales_orders so
      where so.id = sales_order_items.sales_order_id
        and so.organization_id = current_org_id()
    )
  );
drop policy if exists sales_order_items_delete_org on public.sales_order_items;
create policy sales_order_items_delete_org on public.sales_order_items
  for delete using (
    exists (
      select 1 from public.sales_orders so
      where so.id = sales_order_items.sales_order_id
        and so.organization_id = current_org_id()
    )
  );

drop policy if exists sales_returns_select_org on public.sales_returns;
create policy sales_returns_select_org on public.sales_returns
  for select using (organization_id = current_org_id());
drop policy if exists sales_returns_insert_org on public.sales_returns;
create policy sales_returns_insert_org on public.sales_returns
  for insert with check (organization_id = current_org_id());
drop policy if exists sales_returns_update_org on public.sales_returns;
create policy sales_returns_update_org on public.sales_returns
  for update using (organization_id = current_org_id());
drop policy if exists sales_returns_delete_org on public.sales_returns;
create policy sales_returns_delete_org on public.sales_returns
  for delete using (organization_id = current_org_id());

drop policy if exists sales_return_items_select_org on public.sales_return_items;
create policy sales_return_items_select_org on public.sales_return_items
  for select using (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = sales_return_items.sales_return_id
        and sr.organization_id = current_org_id()
    )
  );
drop policy if exists sales_return_items_insert_org on public.sales_return_items;
create policy sales_return_items_insert_org on public.sales_return_items
  for insert with check (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = sales_return_items.sales_return_id
        and sr.organization_id = current_org_id()
    )
  );
drop policy if exists sales_return_items_update_org on public.sales_return_items;
create policy sales_return_items_update_org on public.sales_return_items
  for update using (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = sales_return_items.sales_return_id
        and sr.organization_id = current_org_id()
    )
  );
drop policy if exists sales_return_items_delete_org on public.sales_return_items;
create policy sales_return_items_delete_org on public.sales_return_items
  for delete using (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = sales_return_items.sales_return_id
        and sr.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Stock sync trigger for sales returns (mirror of the purchase version,
-- direction inverted: a return restores stock to the ledger).
-- ---------------------------------------------------------------------------
create or replace function public.inventory_sync_sale_return_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_product_id uuid;
  v_delta numeric;
  v_upp numeric;
  v_batch text;
  v_expiry date;
  v_ref uuid;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce(old.organization_id,
      (select organization_id from public.sales_returns where id = old.sales_return_id));
    v_product_id := old.product_id;
    v_delta := -coalesce(old.quantity, 0);
    v_batch := old.batch_number;
    v_expiry := old.expiry_date;
    v_ref := old.sales_return_id;
    v_created_at := coalesce(old.created_at, now());
  else
    v_org := coalesce(new.organization_id,
      (select organization_id from public.sales_returns where id = new.sales_return_id));
    v_product_id := new.product_id;
    v_delta := coalesce(new.quantity, 0);
    if tg_op = 'UPDATE' then
      v_delta := v_delta - coalesce(old.quantity, 0);
    end if;
    v_batch := new.batch_number;
    v_expiry := new.expiry_date;
    v_ref := new.sales_return_id;
    v_created_at := coalesce(new.created_at, now());
  end if;

  if v_product_id is null or v_org is null or v_delta = 0 then
    return coalesce(new, old);
  end if;

  -- Normalize subunit quantity to main units for the ledger / current_stock.
  if coalesce((case when tg_op = 'DELETE' then old.unit_mode else new.unit_mode end), 'main') = 'subunit' then
    select units_per_pack into v_upp from public.products where id = v_product_id;
    if v_upp is not null and v_upp > 0 then
      v_delta := v_delta / v_upp;
    end if;
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
     expiry_date, reference_type, reference_id, created_at)
  values
    (v_org, v_product_id, 'return_in', v_delta, null, v_batch, v_expiry,
     'sales_return', v_ref, v_created_at);

  update public.products
    set current_stock = current_stock + v_delta, updated_at = now()
    where id = v_product_id;

  return coalesce(new, old);
end;
$$;

do $$
begin
  if to_regclass('public.sales_return_items') is not null then
    execute 'drop trigger if exists inventory_sync_sale_return_item on public.sales_return_items';
    execute 'create trigger inventory_sync_sale_return_item after insert or update or delete on public.sales_return_items
             for each row execute function public.inventory_sync_sale_return_item()';
  end if;
end $$;
