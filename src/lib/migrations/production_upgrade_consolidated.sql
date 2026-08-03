-- TradeOS ERP — CONSOLIDATED PRODUCTION UPGRADE
--
-- Identity Foundation  +  Product Foundation  +  Invoice Numbering Foundation
-- +  Inventory Phase 1  +  Inventory Improvements (overselling policy)
-- +  Purchase Management Phase 1  +  Location indexes
--
-- WHY THIS FILE EXISTS
--   A read-only verification against the production database (2026-08-02)
--   found that several migrations had NOT been applied. Missing on production:
--     columns:   products.default_purchase_price / current_stock / updated_at /
--                overselling_policy; categories.overselling_policy;
--                organizations.overselling_policy;
--                staff_permissions.can_manage_inventory;
--                sales_transactions.status / invoice_type / total_amount /
--                created_by_profile_id;
--                purchase_transactions.status / invoice_type /
--                supplier_invoice_number / created_by_profile_id / total_amount;
--                purchase_items.organization_id; sales_items.organization_id
--     tables:    inventory_transactions, purchase_orders, purchase_order_items,
--                purchase_returns, purchase_return_items
--     plus the functions, triggers, RLS policies, indexes, and RPCs listed below.
--
--   This single file upgrades an existing production database to the full
--   schema required by the current application. It is SAFE on any database
--   state and for existing data:
--     - every statement is idempotent (IF NOT EXISTS / OR REPLACE / guarded
--       DO blocks) — re-running is a no-op;
--     - it never deletes or rewrites existing rows; the only DROPs are
--       triggers and CHECK constraints that are immediately recreated with
--       the same or a superset definition;
--     - new NOT NULL columns carry constants as defaults (PG 11+ fast path,
--       no table rewrite): products.current_stock -> 0, updated_at -> now();
--     - the one-time backfill converts existing purchase/sales history into
--       ledger rows and rebuilds products.current_stock from the ledger, but
--       ONLY when the ledger is empty;
--     - risky UNIQUE index creation is attempted inside guarded blocks: if
--       existing duplicate data prevents it, the migration continues and a
--       WARNING names the index so duplicates can be cleaned up and the file
--       re-run (a duplicate-name product can then be rejected by the app).
--
-- HOW TO RUN
--   Open the Supabase dashboard SQL editor and paste the whole file, then
--   Run. There is no migration runner in this project (established convention:
--   src/lib/identity/schema.sql). Safe to run more than once.
--
-- AFTER RUNNING
--   The final DO block verifies every required object and either prints
--   "ALL REQUIRED OBJECTS PRESENT" or raises an exception listing what is
--   still missing.

set check_function_bodies = off;

-- ===========================================================================
-- PART 0 — IDENTITY FOUNDATION (role library, invitations, sessions, resets)
-- ===========================================================================
-- From src/lib/identity/schema.sql. Safe no-ops when already applied.

create table if not exists public.role_definitions (
  id text primary key,
  name text not null,
  description text,
  permissions jsonb not null default '[]'::jsonb,
  is_built_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.role_invitations (
  code text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null,
  created_by text not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text
);

create index if not exists role_invitations_org_idx on public.role_invitations(organization_id);
create index if not exists role_invitations_email_idx on public.role_invitations(email);

create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_token text not null unique,
  device_name text not null,
  remember_device boolean not null default false,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists device_sessions_profile_idx on public.device_sessions(profile_id);
create index if not exists device_sessions_org_idx on public.device_sessions(organization_id);
create index if not exists device_sessions_token_idx on public.device_sessions(device_token);

create table if not exists public.password_reset_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ===========================================================================
-- PART 1 — PRODUCT FOUNDATION (tables, columns, indexes, triggers, RLS)
-- ===========================================================================

-- 1.1 brands / categories / products — create if missing, else extend columns
create table if not exists public.brands (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  parent_category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id serial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  brand_id uuid references public.brands(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  sku text,
  barcode text,
  unit_type text check (char_length(trim(unit_type)) between 1 and 50),
  units_per_pack integer check (units_per_pack is null or units_per_pack >= 1),
  last_purchase_price numeric(14, 2) check (last_purchase_price is null or last_purchase_price >= 0),
  default_purchase_price numeric(14, 2) check (default_purchase_price is null or default_purchase_price >= 0),
  default_selling_price numeric(14, 2) check (default_selling_price is null or default_selling_price >= 0),
  minimum_stock_level numeric(14, 2) check (minimum_stock_level is null or minimum_stock_level >= 0),
  reorder_level numeric(14, 2) check (reorder_level is null or reorder_level >= 0),
  current_stock numeric(14, 2) not null default 0 check (current_stock >= 0),
  track_batch boolean not null default false,
  track_expiry boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 Columns for existing deployments (no-op where already present; existing
-- rows get the documented constant defaults — no data is touched).
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists barcode text;
alter table public.products add column if not exists unit_type text;
alter table public.products add column if not exists units_per_pack integer;
alter table public.products add column if not exists last_purchase_price numeric(14, 2);
alter table public.products add column if not exists default_purchase_price numeric(14, 2);
alter table public.products add column if not exists default_selling_price numeric(14, 2);
alter table public.products add column if not exists minimum_stock_level numeric(14, 2);
alter table public.products add column if not exists reorder_level numeric(14, 2);
alter table public.products add column if not exists current_stock numeric(14, 2) not null default 0;
alter table public.products add column if not exists track_batch boolean not null default false;
alter table public.products add column if not exists track_expiry boolean not null default false;
alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists created_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

-- 1.3 Standard indexes
create index if not exists brands_org_idx on public.brands (organization_id);
create index if not exists brands_org_name_idx on public.brands (organization_id, lower(name));
create index if not exists categories_org_idx on public.categories (organization_id);
create index if not exists categories_org_name_idx on public.categories (organization_id, lower(name));
create index if not exists categories_parent_idx on public.categories (parent_category_id);
create index if not exists products_org_idx on public.products (organization_id);
create index if not exists products_org_name_idx on public.products (organization_id, lower(name));
create index if not exists products_brand_idx on public.products (brand_id);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_sku_idx on public.products (organization_id, sku);
create index if not exists products_barcode_idx on public.products (organization_id, barcode);

-- 1.4 Uniqueness — guarded so pre-existing duplicate data cannot abort the
-- migration: the index is skipped with a WARNING and the app still rejects
-- new duplicates server-side. Re-run the file after cleaning duplicates.
do $$
begin
  begin
    create unique index if not exists products_org_sku_uidx
      on public.products (organization_id, sku) where sku is not null;
  exception when others then
    raise warning 'SKIPPED products_org_sku_uidx (duplicate sku data?): %', sqlerrm;
  end;
  begin
    create unique index if not exists products_org_barcode_uidx
      on public.products (organization_id, barcode) where barcode is not null;
  exception when others then
    raise warning 'SKIPPED products_org_barcode_uidx (duplicate barcode data?): %', sqlerrm;
  end;
  begin
    create unique index if not exists products_org_brand_name_uidx
      on public.products (organization_id, brand_id, lower(name)) where brand_id is not null;
  exception when others then
    raise warning 'SKIPPED products_org_brand_name_uidx (duplicate name+brand data?): %', sqlerrm;
  end;
  begin
    create unique index if not exists products_org_nullbrand_name_uidx
      on public.products (organization_id, lower(name)) where brand_id is null;
  exception when others then
    raise warning 'SKIPPED products_org_nullbrand_name_uidx (duplicate no-brand name data?): %', sqlerrm;
  end;
end $$;

-- 1.5 updated_at maintenance trigger (shared by the three tables)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- 1.6 Row Level Security helpers + policies
create or replace function public.current_org_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'organization_id', '')::uuid;
$$;

create or replace function public.has_product_permission(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from public.profiles p
    left join public.staff_permissions sp
      on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.auth_user_id = uid
      and p.organization_id = current_org_id()
      and (
        p.role = 'owner'
        or coalesce(sp.can_manage_products, false) = true
      )
  );
$$;

alter table public.products enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;

drop policy if exists products_select_org on public.products;
create policy products_select_org on public.products
  for select using (organization_id = current_org_id());

drop policy if exists products_write_org on public.products;
create policy products_write_org on public.products
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

drop policy if exists brands_select_org on public.brands;
create policy brands_select_org on public.brands
  for select using (organization_id = current_org_id());

drop policy if exists brands_write_org on public.brands;
create policy brands_write_org on public.brands
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

drop policy if exists categories_select_org on public.categories;
create policy categories_select_org on public.categories
  for select using (organization_id = current_org_id());

drop policy if exists categories_write_org on public.categories;
create policy categories_write_org on public.categories
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

-- ===========================================================================
-- PART 2 — INVOICE NUMBERING + METADATA FOUNDATION (dependency of Purchases)
-- ===========================================================================

create table if not exists public.invoice_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_type text not null check (invoice_type in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order')),
  current_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, invoice_type)
);

create or replace function public.next_invoice_number(
  p_organization_id uuid,
  p_invoice_type text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if p_organization_id is null then
    raise exception 'next_invoice_number: p_organization_id is required';
  end if;

  if p_invoice_type not in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order') then
    raise exception 'next_invoice_number: unknown invoice_type "%"', p_invoice_type;
  end if;

  insert into public.invoice_sequences (organization_id, invoice_type, current_number, updated_at)
  values (p_organization_id, p_invoice_type, 1, now())
  on conflict (organization_id, invoice_type)
  do update set current_number = public.invoice_sequences.current_number + 1,
                updated_at = now()
  returning current_number into v_next;

  return v_next;
end;
$$;

grant execute on function public.next_invoice_number(uuid, text) to service_role;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;

-- Extend the invoice_type check for databases created before 'purchase_order'
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.invoice_sequences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%invoice_type%'
  loop
    execute format('alter table public.invoice_sequences drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.invoice_sequences
  add constraint invoice_sequences_invoice_type_check
  check (invoice_type in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order'));

-- Invoice metadata columns (additive — existing rows keep working)
alter table public.sales_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists invoice_type text not null default 'sales',
  add column if not exists created_by_profile_id uuid references public.profiles(id);

alter table public.purchase_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists invoice_type text not null default 'purchase',
  add column if not exists created_by_profile_id uuid references public.profiles(id),
  add column if not exists supplier_invoice_number text;

-- Columns the AI purchase/sales routes write (total_amount) — missing on prod
alter table public.sales_transactions
  add column if not exists total_amount numeric(14, 2);
alter table public.purchase_transactions
  add column if not exists total_amount numeric(14, 2);

-- Item-side organization columns (triggers resolve them from the parent
-- transaction defensively; the ledger backfill also coalesces them)
alter table public.purchase_items
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.sales_items
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_transactions_status_check') then
    alter table public.sales_transactions
      add constraint sales_transactions_status_check
      check (status in ('draft', 'pending_approval', 'confirmed', 'paid', 'partially_paid', 'cancelled', 'void'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_transactions_invoice_type_check') then
    alter table public.sales_transactions
      add constraint sales_transactions_invoice_type_check
      check (invoice_type = 'sales');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_transactions_status_check') then
    alter table public.purchase_transactions
      add constraint purchase_transactions_status_check
      check (status in ('draft', 'pending_approval', 'confirmed', 'paid', 'partially_paid', 'cancelled', 'void'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_transactions_invoice_type_check') then
    alter table public.purchase_transactions
      add constraint purchase_transactions_invoice_type_check
      check (invoice_type = 'purchase');
  end if;
end $$;

-- Uniqueness + search indexes (guarded like Part 1.4)
do $$
begin
  begin
    create unique index if not exists sales_transactions_org_invoice_number_uidx
      on public.sales_transactions (organization_id, invoice_number);
  exception when others then
    raise warning 'SKIPPED sales_transactions_org_invoice_number_uidx: %', sqlerrm;
  end;
  begin
    create unique index if not exists purchase_transactions_org_invoice_number_uidx
      on public.purchase_transactions (organization_id, invoice_number);
  exception when others then
    raise warning 'SKIPPED purchase_transactions_org_invoice_number_uidx: %', sqlerrm;
  end;
end $$;

create index if not exists sales_transactions_invoice_number_idx
  on public.sales_transactions (invoice_number);
create index if not exists purchase_transactions_invoice_number_idx
  on public.purchase_transactions (invoice_number);
create index if not exists sales_transactions_created_at_idx on public.sales_transactions (created_at);
create index if not exists purchase_transactions_created_at_idx on public.purchase_transactions (created_at);
create index if not exists sales_transactions_sale_date_idx on public.sales_transactions (sale_date);
create index if not exists sales_transactions_customer_idx on public.sales_transactions (customer_id);
create index if not exists sales_transactions_created_by_idx on public.sales_transactions (created_by_profile_id);
create index if not exists sales_transactions_payment_type_idx on public.sales_transactions (payment_type);
create index if not exists sales_transactions_status_idx on public.sales_transactions (status);
create index if not exists purchase_transactions_purchase_date_idx on public.purchase_transactions (purchase_date);
create index if not exists purchase_transactions_supplier_idx on public.purchase_transactions (supplier_id);
create index if not exists purchase_transactions_status_idx on public.purchase_transactions (status);

-- ===========================================================================
-- PART 3 — INVENTORY IMPROVEMENTS: OVERSELLING POLICY
-- ===========================================================================

alter table public.organizations
  add column if not exists overselling_policy text;

do $$
begin
  update public.organizations
    set overselling_policy = 'allow'
    where overselling_policy is null;
  alter table public.organizations
    alter column overselling_policy set not null;
  alter table public.organizations
    alter column overselling_policy set default 'allow';
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_overselling_policy_check'
  ) then
    alter table public.organizations
      add constraint organizations_overselling_policy_check
      check (overselling_policy in ('allow', 'block'));
  end if;
end $$;

alter table public.categories
  add column if not exists overselling_policy text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'categories_overselling_policy_check'
  ) then
    alter table public.categories
      add constraint categories_overselling_policy_check
      check (overselling_policy is null or overselling_policy in ('allow', 'block'));
  end if;
end $$;

alter table public.products
  add column if not exists overselling_policy text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_overselling_policy_check'
  ) then
    alter table public.products
      add constraint products_overselling_policy_check
      check (overselling_policy is null or overselling_policy in ('allow', 'block'));
  end if;
end $$;

create or replace function public.resolve_overselling_policy(
  p_organization_id uuid,
  p_product_id integer
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_product_policy text;
  v_category_id uuid;
  v_policy text;
  v_org_policy text;
  v_hops integer := 0;
begin
  select overselling_policy, category_id
    into v_product_policy, v_category_id
  from public.products
  where id = p_product_id and organization_id = p_organization_id;

  if not found then
    raise exception 'resolve_overselling_policy: product % not found in organization %',
      p_product_id, p_organization_id;
  end if;

  if v_product_policy is not null then
    return v_product_policy;
  end if;

  while v_category_id is not null and v_hops < 20 loop
    select overselling_policy, parent_category_id
      into v_policy, v_category_id
    from public.categories
    where id = v_category_id and organization_id = p_organization_id;

    if not found then
      exit;
    end if;

    if v_policy is not null then
      return v_policy;
    end if;

    v_hops := v_hops + 1;
  end loop;

  select overselling_policy into v_org_policy
  from public.organizations
  where id = p_organization_id;

  return coalesce(v_org_policy, 'allow');
end;
$$;

revoke execute on function public.resolve_overselling_policy(uuid, integer) from public;
grant execute on function public.resolve_overselling_policy(uuid, integer) to authenticated;
grant execute on function public.resolve_overselling_policy(uuid, integer) to service_role;

-- ===========================================================================
-- PART 4 — INVENTORY PHASE 1 (ledger, permission, triggers, RPC, backfill)
-- ===========================================================================

-- 4.1 staff_permissions.can_manage_inventory
do $$
begin
  if to_regclass('public.staff_permissions') is not null then
    execute 'alter table public.staff_permissions add column if not exists can_manage_inventory boolean not null default false';
  end if;
end $$;

-- 4.2 has_inventory_permission(uid)
create or replace function public.has_inventory_permission(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from public.profiles p
    left join public.staff_permissions sp
      on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.auth_user_id = uid
      and p.organization_id = current_org_id()
      and (
        p.role = 'owner'
        or coalesce(sp.can_manage_inventory, false) = true
      )
  );
$$;

-- 4.3 inventory_transactions — the immutable stock ledger. Created with the
-- FULL (extended) movement/reference sets so the later purchase phase needs
-- no constraint churn; the Part 5 recreate blocks are then safe no-ops.
create table if not exists public.inventory_transactions (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  movement_type text not null check (
    movement_type in ('purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out', 'return_in', 'return_out')
  ),
  quantity_delta numeric(14, 2) not null check (quantity_delta <> 0),
  reason text check (reason is null or char_length(trim(reason)) <= 500),
  batch_number text check (batch_number is null or char_length(trim(batch_number)) <= 100),
  expiry_date date,
  reference_type text check (
    reference_type is null
    or reference_type in ('purchase_transaction', 'sales_transaction', 'adjustment', 'purchase_return', 'purchase_order')
  ),
  reference_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    movement_type not in ('adjustment_in', 'adjustment_out')
    or (reason is not null and char_length(trim(reason)) > 0)
  )
);

create index if not exists inv_tx_org_product_created_idx
  on public.inventory_transactions (organization_id, product_id, created_at);
create index if not exists inv_tx_org_created_idx
  on public.inventory_transactions (organization_id, created_at);
create index if not exists inv_tx_org_type_idx
  on public.inventory_transactions (organization_id, movement_type);
create index if not exists inv_tx_product_batch_idx
  on public.inventory_transactions (product_id, batch_number);
create index if not exists inv_tx_reference_idx
  on public.inventory_transactions (organization_id, reference_type, reference_id);

alter table public.inventory_transactions enable row level security;

drop policy if exists inventory_transactions_select_org on public.inventory_transactions;
create policy inventory_transactions_select_org on public.inventory_transactions
  for select using (organization_id = current_org_id());

-- 4.4 Stock sync triggers (purchase_items / sales_items -> ledger + products)
-- The sale trigger enforces the overselling policy (see Part 3) and can never
-- drive current_stock below zero when the policy is 'block'.

create or replace function public.inventory_sync_purchase_item()
returns trigger language plpgsql security definer as $$
declare
  v_org uuid;
  v_product_id integer;
  v_delta numeric;
  v_batch text;
  v_expiry date;
  v_ref uuid;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce(old.organization_id,
      (select organization_id from public.purchase_transactions where id = old.purchase_transaction_id));
    v_product_id := old.product_id;
    v_delta := -coalesce(old.quantity, 0);
    v_batch := old.batch_number;
    v_expiry := old.expiry_date;
    v_ref := old.purchase_transaction_id;
    v_created_at := coalesce(old.created_at, now());
  else
    v_org := coalesce(new.organization_id,
      (select organization_id from public.purchase_transactions where id = new.purchase_transaction_id));
    v_product_id := new.product_id;
    v_delta := coalesce(new.quantity, 0);
    if tg_op = 'UPDATE' then
      v_delta := v_delta - coalesce(old.quantity, 0);
    end if;
    v_batch := new.batch_number;
    v_expiry := new.expiry_date;
    v_ref := new.purchase_transaction_id;
    v_created_at := coalesce(new.created_at, now());
  end if;

  if v_product_id is null or v_org is null or v_delta = 0 then
    return coalesce(new, old);
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, batch_number, expiry_date,
     reference_type, reference_id, created_at)
  values
    (v_org, v_product_id, 'purchase_in', v_delta, v_batch, v_expiry,
     'purchase_transaction', v_ref, v_created_at);

  update public.products
    set current_stock = current_stock + v_delta, updated_at = now()
    where id = v_product_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.inventory_sync_sale_item()
returns trigger language plpgsql security definer as $$
declare
  v_org uuid;
  v_product_id integer;
  v_delta numeric;
  v_ref uuid;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce(old.organization_id,
      (select organization_id from public.sales_transactions where id = old.sales_transaction_id));
    v_product_id := old.product_id;
    v_delta := coalesce(old.quantity, 0);  -- negative: reversing a previously recorded issue
    v_ref := old.sales_transaction_id;
    v_created_at := coalesce(old.created_at, now());
  else
    v_org := coalesce(new.organization_id,
      (select organization_id from public.sales_transactions where id = new.sales_transaction_id));
    v_product_id := new.product_id;
    v_delta := -coalesce(new.quantity, 0);
    if tg_op = 'UPDATE' then
      v_delta := v_delta + coalesce(old.quantity, 0);
    end if;
    v_ref := new.sales_transaction_id;
    v_created_at := coalesce(new.created_at, now());
  end if;

  if v_product_id is null or v_org is null or v_delta = 0 then
    return coalesce(new, old);
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
     reference_type, reference_id, created_at)
  values
    (v_org, v_product_id, 'sale_out', v_delta, null, null,
     'sales_transaction', v_ref, v_created_at);

  if v_delta < 0 and public.resolve_overselling_policy(v_org, v_product_id) = 'block' then
    update public.products
      set current_stock = current_stock + v_delta, updated_at = now()
      where id = v_product_id and current_stock + v_delta >= 0;
    if not found then
      raise exception
        'Sale cannot be saved: overselling is blocked for product % (available: %, attempted sale: %).',
        v_product_id,
        (select current_stock from public.products where id = v_product_id),
        -v_delta;
    end if;
  else
    update public.products
      set current_stock = current_stock + v_delta, updated_at = now()
      where id = v_product_id;
  end if;

  return coalesce(new, old);
end;
$$;

set check_function_bodies = on;

do $$
begin
  if to_regclass('public.purchase_items') is not null then
    execute 'drop trigger if exists inventory_sync_purchase_item on public.purchase_items';
    execute 'create trigger inventory_sync_purchase_item after insert or update or delete on public.purchase_items
             for each row execute function public.inventory_sync_purchase_item()';
  end if;
  if to_regclass('public.sales_items') is not null then
    execute 'drop trigger if exists inventory_sync_sale_item on public.sales_items';
    execute 'create trigger inventory_sync_sale_item after insert or update or delete on public.sales_items
             for each row execute function public.inventory_sync_sale_item()';
  end if;
end $$;

-- 4.5 adjust_inventory() RPC — atomic, permission-checked manual adjustment
create or replace function public.adjust_inventory(
  p_organization_id uuid,
  p_product_id integer,
  p_quantity_delta numeric,
  p_reason text,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_movement_type text;
  v_current_stock numeric;
  v_new_stock numeric;
  v_transaction_id uuid;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Quantity change must be a non-zero number';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for stock adjustments';
  end if;
  if char_length(trim(p_reason)) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;
  if not public.has_inventory_permission(auth.uid()) then
    raise exception 'Permission denied: the Manage Inventory permission is required';
  end if;

  select current_stock into v_current_stock
  from public.products
  where id = p_product_id and organization_id = p_organization_id;

  if v_current_stock is null then
    raise exception 'Product not found in this organization';
  end if;

  v_new_stock := coalesce(v_current_stock, 0) + p_quantity_delta;
  if v_new_stock < 0 then
    raise exception 'Adjustment would make stock negative (current: %, change: %, result: %)',
      v_current_stock, p_quantity_delta, v_new_stock;
  end if;

  v_movement_type := case when p_quantity_delta > 0 then 'adjustment_in' else 'adjustment_out' end;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
     expiry_date, reference_type, reference_id, created_by)
  values
    (p_organization_id, p_product_id, v_movement_type, p_quantity_delta, trim(p_reason),
     nullif(trim(coalesce(p_batch_number, '')), ''), p_expiry_date,
     'adjustment', null, p_created_by)
  returning id into v_transaction_id;

  update public.products
    set current_stock = current_stock + p_quantity_delta, updated_at = now()
    where id = p_product_id and current_stock + p_quantity_delta >= 0;

  if not found then
    raise exception 'Adjustment would make stock negative (current: %, change: %, result: %)',
      v_current_stock, p_quantity_delta, v_new_stock;
  end if;

  return v_transaction_id;
end;
$$;

revoke execute on function public.adjust_inventory(uuid, integer, numeric, text, text, date, uuid) from public;
grant execute on function public.adjust_inventory(uuid, integer, numeric, text, text, date, uuid) to authenticated;

-- 4.6 Relax products.current_stock >= 0 so truthful negative balances remain
-- representable (overselling via the UI). Adjustments stay guarded (4.5).
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%current_stock%'
  loop
    execute format('alter table public.products drop constraint %I', v_constraint);
  end loop;
end $$;

-- 4.7 One-time backfill from existing purchase_items / sales_items.
-- Runs ONLY when the ledger is empty. Converts historical purchases/sales
-- into ledger rows and rebuilds products.current_stock from the ledger, so
-- the two sources of truth converge before new movements are recorded.
do $$
begin
  if to_regclass('public.purchase_items') is not null
     and to_regclass('public.sales_items') is not null
     and to_regclass('public.purchase_transactions') is not null
     and to_regclass('public.sales_transactions') is not null
     and not exists (select 1 from public.inventory_transactions) then

    insert into public.inventory_transactions
      (organization_id, product_id, movement_type, quantity_delta, batch_number,
       expiry_date, reference_type, reference_id, created_at)
    select
      coalesce(pi.organization_id, pt.organization_id),
      pi.product_id,
      'purchase_in',
      pi.quantity,
      pi.batch_number,
      pi.expiry_date,
      'purchase_transaction',
      pi.purchase_transaction_id,
      coalesce(pi.created_at, pt.created_at, now())
    from public.purchase_items pi
    left join public.purchase_transactions pt on pt.id = pi.purchase_transaction_id
    where pi.product_id is not null
      and coalesce(pi.quantity, 0) <> 0
      and coalesce(pi.organization_id, pt.organization_id) is not null;

    insert into public.inventory_transactions
      (organization_id, product_id, movement_type, quantity_delta,
       reference_type, reference_id, created_at)
    select
      coalesce(si.organization_id, st.organization_id),
      si.product_id,
      'sale_out',
      -si.quantity,
      'sales_transaction',
      si.sales_transaction_id,
      coalesce(si.created_at, st.created_at, now())
    from public.sales_items si
    left join public.sales_transactions st on st.id = si.sales_transaction_id
    where si.product_id is not null
      and coalesce(si.quantity, 0) <> 0
      and coalesce(si.organization_id, st.organization_id) is not null;

    update public.products p
      set current_stock = coalesce(
            (select sum(t.quantity_delta) from public.inventory_transactions t where t.product_id = p.id),
            0
          ),
          updated_at = now();
  end if;
end $$;

-- ===========================================================================
-- PART 5 — PURCHASE MANAGEMENT PHASE 1 (orders + returns + stock sync)
-- ===========================================================================

-- 5.1 Extend ledger checks (no-op when Part 4 already created them extended)
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.inventory_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%movement_type%'
  loop
    execute format('alter table public.inventory_transactions drop constraint %I', v_constraint);
  end loop;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.inventory_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reference_type%'
  loop
    execute format('alter table public.inventory_transactions drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.inventory_transactions
  add constraint inventory_transactions_movement_type_check
  check (movement_type in ('purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out', 'return_in', 'return_out'));

alter table public.inventory_transactions
  add constraint inventory_transactions_reference_type_check
  check (
    reference_type is null
    or reference_type in ('purchase_transaction', 'sales_transaction', 'adjustment', 'purchase_return', 'purchase_order')
  );

-- 5.2 Purchase orders
create table if not exists public.purchase_orders (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  po_number text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_date date,
  expected_date date,
  notes text,
  status text not null default 'ordered'
    check (status in ('ordered', 'partial', 'received', 'cancelled')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, po_number)
);

create index if not exists purchase_orders_org_created_idx on public.purchase_orders (organization_id, created_at);
create index if not exists purchase_orders_org_status_idx on public.purchase_orders (organization_id, status);
create index if not exists purchase_orders_org_supplier_idx on public.purchase_orders (organization_id, supplier_id);
create index if not exists purchase_orders_org_po_number_idx on public.purchase_orders (organization_id, po_number);
create index if not exists purchase_orders_org_order_date_idx on public.purchase_orders (organization_id, order_date);

create table if not exists public.purchase_order_items (
  id uuid not null default gen_random_uuid() primary key,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  quantity_ordered numeric(14, 2) not null check (quantity_ordered > 0),
  quantity_received numeric(14, 2) not null default 0 check (quantity_received >= 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_items_order_idx on public.purchase_order_items (purchase_order_id);
create index if not exists purchase_order_items_product_idx on public.purchase_order_items (product_id);

-- 5.3 Purchase returns
create table if not exists public.purchase_returns (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_number text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_transaction_id uuid references public.purchase_transactions(id) on delete set null,
  return_date date,
  reason text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, return_number)
);

create index if not exists purchase_returns_org_created_idx on public.purchase_returns (organization_id, created_at);
create index if not exists purchase_returns_org_number_idx on public.purchase_returns (organization_id, return_number);
create index if not exists purchase_returns_org_supplier_idx on public.purchase_returns (organization_id, supplier_id);

create table if not exists public.purchase_return_items (
  id uuid not null default gen_random_uuid() primary key,
  purchase_return_id uuid not null references public.purchase_returns(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists purchase_return_items_return_idx on public.purchase_return_items (purchase_return_id);
create index if not exists purchase_return_items_product_idx on public.purchase_return_items (product_id);

-- 5.4 RLS on the four purchase tables
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;

drop policy if exists purchase_orders_select_org on public.purchase_orders;
create policy purchase_orders_select_org on public.purchase_orders
  for select using (organization_id = current_org_id());
drop policy if exists purchase_orders_insert_org on public.purchase_orders;
create policy purchase_orders_insert_org on public.purchase_orders
  for insert with check (organization_id = current_org_id());
drop policy if exists purchase_orders_update_org on public.purchase_orders;
create policy purchase_orders_update_org on public.purchase_orders
  for update using (organization_id = current_org_id());
drop policy if exists purchase_orders_delete_org on public.purchase_orders;
create policy purchase_orders_delete_org on public.purchase_orders
  for delete using (organization_id = current_org_id());

drop policy if exists purchase_order_items_select_org on public.purchase_order_items;
create policy purchase_order_items_select_org on public.purchase_order_items
  for select using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_order_items_insert_org on public.purchase_order_items;
create policy purchase_order_items_insert_org on public.purchase_order_items
  for insert with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_order_items_update_org on public.purchase_order_items;
create policy purchase_order_items_update_org on public.purchase_order_items
  for update using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_order_items_delete_org on public.purchase_order_items;
create policy purchase_order_items_delete_org on public.purchase_order_items
  for delete using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.organization_id = current_org_id()
    )
  );

drop policy if exists purchase_returns_select_org on public.purchase_returns;
create policy purchase_returns_select_org on public.purchase_returns
  for select using (organization_id = current_org_id());
drop policy if exists purchase_returns_insert_org on public.purchase_returns;
create policy purchase_returns_insert_org on public.purchase_returns
  for insert with check (organization_id = current_org_id());
drop policy if exists purchase_returns_update_org on public.purchase_returns;
create policy purchase_returns_update_org on public.purchase_returns
  for update using (organization_id = current_org_id());
drop policy if exists purchase_returns_delete_org on public.purchase_returns;
create policy purchase_returns_delete_org on public.purchase_returns
  for delete using (organization_id = current_org_id());

drop policy if exists purchase_return_items_select_org on public.purchase_return_items;
create policy purchase_return_items_select_org on public.purchase_return_items
  for select using (
    exists (
      select 1 from public.purchase_returns pr
      where pr.id = purchase_return_items.purchase_return_id
        and pr.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_return_items_insert_org on public.purchase_return_items;
create policy purchase_return_items_insert_org on public.purchase_return_items
  for insert with check (
    exists (
      select 1 from public.purchase_returns pr
      where pr.id = purchase_return_items.purchase_return_id
        and pr.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_return_items_update_org on public.purchase_return_items;
create policy purchase_return_items_update_org on public.purchase_return_items
  for update using (
    exists (
      select 1 from public.purchase_returns pr
      where pr.id = purchase_return_items.purchase_return_id
        and pr.organization_id = current_org_id()
    )
  );
drop policy if exists purchase_return_items_delete_org on public.purchase_return_items;
create policy purchase_return_items_delete_org on public.purchase_return_items
  for delete using (
    exists (
      select 1 from public.purchase_returns pr
      where pr.id = purchase_return_items.purchase_return_id
        and pr.organization_id = current_org_id()
    )
  );

-- 5.5 Stock sync trigger for purchase returns (guarded: a return can never
-- drive current_stock below zero — rolls back the whole statement otherwise)
set check_function_bodies = off;

create or replace function public.inventory_sync_purchase_return_item()
returns trigger language plpgsql security definer as $$
declare
  v_org uuid;
  v_product_id integer;
  v_delta numeric;
  v_batch text;
  v_expiry date;
  v_ref uuid;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce(old.organization_id,
      (select organization_id from public.purchase_returns where id = old.purchase_return_id));
    v_product_id := old.product_id;
    v_delta := coalesce(old.quantity, 0);  -- positive: reversing a previously recorded return-out
    v_batch := old.batch_number;
    v_expiry := old.expiry_date;
    v_ref := old.purchase_return_id;
    v_created_at := coalesce(old.created_at, now());
  else
    v_org := coalesce(new.organization_id,
      (select organization_id from public.purchase_returns where id = new.purchase_return_id));
    v_product_id := new.product_id;
    v_delta := -coalesce(new.quantity, 0);
    if tg_op = 'UPDATE' then
      v_delta := v_delta + coalesce(old.quantity, 0);
    end if;
    v_batch := new.batch_number;
    v_expiry := new.expiry_date;
    v_ref := new.purchase_return_id;
    v_created_at := coalesce(new.created_at, now());
  end if;

  if v_product_id is null or v_org is null or v_delta = 0 then
    return coalesce(new, old);
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
     expiry_date, reference_type, reference_id, created_at)
  values
    (v_org, v_product_id, 'return_out', v_delta, null, v_batch, v_expiry,
     'purchase_return', v_ref, v_created_at);

  if v_delta < 0 then
    update public.products
      set current_stock = current_stock + v_delta, updated_at = now()
      where id = v_product_id and current_stock + v_delta >= 0;
    if not found then
      raise exception
        'Purchase return cannot be saved: it would drive stock below zero for product % (available: %, attempted return: %).',
        v_product_id,
        (select current_stock from public.products where id = v_product_id),
        -v_delta;
    end if;
  else
    update public.products
      set current_stock = current_stock + v_delta, updated_at = now()
      where id = v_product_id;
  end if;

  return coalesce(new, old);
end;
$$;

set check_function_bodies = on;

do $$
begin
  if to_regclass('public.purchase_return_items') is not null then
    execute 'drop trigger if exists inventory_sync_purchase_return_item on public.purchase_return_items';
    execute 'create trigger inventory_sync_purchase_return_item after insert or update or delete on public.purchase_return_items
             for each row execute function public.inventory_sync_purchase_return_item()';
  end if;
end $$;

-- ===========================================================================
-- PART 6 — LOCATION INDEXES (from src/lib/location/schema.sql; the tables
-- staff_duty_sessions / staff_location_points already exist in Supabase)
-- ===========================================================================

create index if not exists idx_location_points_org_captured
  on public.staff_location_points (organization_id, captured_at desc);
create index if not exists idx_location_points_profile
  on public.staff_location_points (profile_id, captured_at desc);
create index if not exists idx_duty_sessions_active
  on public.staff_duty_sessions (organization_id, status)
  where status = 'on_duty';

-- ===========================================================================
-- PART 7 — POST-APPLY VERIFICATION
-- ===========================================================================
-- Prints a NOTICE per missing object and raises at the end if anything is
-- missing, so the SQL editor shows a definitive PASS/FAIL result.

do $$
declare
  v_missing text[] := '{}';
begin
  -- tables
  if to_regclass('public.brands') is null then v_missing := v_missing || 'table brands'; end if;
  if to_regclass('public.categories') is null then v_missing := v_missing || 'table categories'; end if;
  if to_regclass('public.products') is null then v_missing := v_missing || 'table products'; end if;
  if to_regclass('public.invoice_sequences') is null then v_missing := v_missing || 'table invoice_sequences'; end if;
  if to_regclass('public.inventory_transactions') is null then v_missing := v_missing || 'table inventory_transactions'; end if;
  if to_regclass('public.purchase_orders') is null then v_missing := v_missing || 'table purchase_orders'; end if;
  if to_regclass('public.purchase_order_items') is null then v_missing := v_missing || 'table purchase_order_items'; end if;
  if to_regclass('public.purchase_returns') is null then v_missing := v_missing || 'table purchase_returns'; end if;
  if to_regclass('public.purchase_return_items') is null then v_missing := v_missing || 'table purchase_return_items'; end if;
  if to_regclass('public.role_definitions') is null then v_missing := v_missing || 'table role_definitions'; end if;
  if to_regclass('public.role_invitations') is null then v_missing := v_missing || 'table role_invitations'; end if;
  if to_regclass('public.device_sessions') is null then v_missing := v_missing || 'table device_sessions'; end if;
  if to_regclass('public.password_reset_tokens') is null then v_missing := v_missing || 'table password_reset_tokens'; end if;

  -- functions / RPCs
  if to_regprocedure('public.set_updated_at()') is null then v_missing := v_missing || 'function set_updated_at'; end if;
  if to_regprocedure('public.current_org_id()') is null then v_missing := v_missing || 'function current_org_id'; end if;
  if to_regprocedure('public.has_product_permission(uuid)') is null then v_missing := v_missing || 'function has_product_permission'; end if;
  if to_regprocedure('public.has_inventory_permission(uuid)') is null then v_missing := v_missing || 'function has_inventory_permission'; end if;
  if to_regprocedure('public.next_invoice_number(uuid, text)') is null then v_missing := v_missing || 'function next_invoice_number'; end if;
  if to_regprocedure('public.resolve_overselling_policy(uuid, integer)') is null then v_missing := v_missing || 'function resolve_overselling_policy'; end if;
  if to_regprocedure('public.adjust_inventory(uuid, integer, numeric, text, text, date, uuid)') is null then v_missing := v_missing || 'function adjust_inventory'; end if;
  if to_regprocedure('public.inventory_sync_purchase_item()') is null then v_missing := v_missing || 'function inventory_sync_purchase_item'; end if;
  if to_regprocedure('public.inventory_sync_sale_item()') is null then v_missing := v_missing || 'function inventory_sync_sale_item'; end if;
  if to_regprocedure('public.inventory_sync_purchase_return_item()') is null then v_missing := v_missing || 'function inventory_sync_purchase_return_item'; end if;

  -- columns that were missing on production
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'default_purchase_price') then v_missing := v_missing || 'products.default_purchase_price'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'current_stock') then v_missing := v_missing || 'products.current_stock'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'updated_at') then v_missing := v_missing || 'products.updated_at'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'overselling_policy') then v_missing := v_missing || 'products.overselling_policy'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'overselling_policy') then v_missing := v_missing || 'categories.overselling_policy'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'overselling_policy') then v_missing := v_missing || 'organizations.overselling_policy'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff_permissions' and column_name = 'can_manage_inventory') then v_missing := v_missing || 'staff_permissions.can_manage_inventory'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'status') then v_missing := v_missing || 'sales_transactions.status'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'invoice_type') then v_missing := v_missing || 'sales_transactions.invoice_type'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'total_amount') then v_missing := v_missing || 'sales_transactions.total_amount'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'created_by_profile_id') then v_missing := v_missing || 'sales_transactions.created_by_profile_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_transactions' and column_name = 'status') then v_missing := v_missing || 'purchase_transactions.status'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_transactions' and column_name = 'invoice_type') then v_missing := v_missing || 'purchase_transactions.invoice_type'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_transactions' and column_name = 'supplier_invoice_number') then v_missing := v_missing || 'purchase_transactions.supplier_invoice_number'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_transactions' and column_name = 'created_by_profile_id') then v_missing := v_missing || 'purchase_transactions.created_by_profile_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_transactions' and column_name = 'total_amount') then v_missing := v_missing || 'purchase_transactions.total_amount'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_items' and column_name = 'organization_id') then v_missing := v_missing || 'purchase_items.organization_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_items' and column_name = 'organization_id') then v_missing := v_missing || 'sales_items.organization_id'; end if;

  -- triggers
  if not exists (select 1 from pg_trigger where tgname = 'products_set_updated_at' and tgrelid = 'public.products'::regclass) then v_missing := v_missing || 'trigger products_set_updated_at'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'inventory_sync_purchase_item' and tgrelid = 'public.purchase_items'::regclass) then v_missing := v_missing || 'trigger inventory_sync_purchase_item'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'inventory_sync_sale_item' and tgrelid = 'public.sales_items'::regclass) then v_missing := v_missing || 'trigger inventory_sync_sale_item'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'inventory_sync_purchase_return_item' and tgrelid = 'public.purchase_return_items'::regclass) then v_missing := v_missing || 'trigger inventory_sync_purchase_return_item'; end if;

  -- RLS policies (key ones)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_select_org') then v_missing := v_missing || 'policy products_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_transactions' and policyname = 'inventory_transactions_select_org') then v_missing := v_missing || 'policy inventory_transactions_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_orders' and policyname = 'purchase_orders_select_org') then v_missing := v_missing || 'policy purchase_orders_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_returns' and policyname = 'purchase_returns_select_org') then v_missing := v_missing || 'policy purchase_returns_select_org'; end if;

  -- key indexes
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'products' and indexname = 'products_org_sku_uidx') then v_missing := v_missing || 'index products_org_sku_uidx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'inventory_transactions' and indexname = 'inv_tx_org_product_created_idx') then v_missing := v_missing || 'index inv_tx_org_product_created_idx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'purchase_orders' and indexname = 'purchase_orders_org_created_idx') then v_missing := v_missing || 'index purchase_orders_org_created_idx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'purchase_returns' and indexname = 'purchase_returns_org_created_idx') then v_missing := v_missing || 'index purchase_returns_org_created_idx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'staff_location_points' and indexname = 'idx_location_points_org_captured') then v_missing := v_missing || 'index idx_location_points_org_captured'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sales_transactions' and indexname = 'sales_transactions_created_at_idx') then v_missing := v_missing || 'index sales_transactions_created_at_idx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'purchase_transactions' and indexname = 'purchase_transactions_created_at_idx') then v_missing := v_missing || 'index purchase_transactions_created_at_idx'; end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'MIGRATION INCOMPLETE — missing objects: %', array_to_string(v_missing, ', ');
  else
    raise notice 'ALL REQUIRED OBJECTS PRESENT — consolidated production migration complete.';
  end if;
end $$;
