-- TradeOS ERP — Product Foundation schema (products / categories / brands)
--
-- This file makes the repository the source of truth for the Product
-- Foundation database schema.
--
-- There is no automated migration runner in this project (see
-- src/lib/identity/schema.sql for the established convention). Run every
-- statement below manually, once, in the Supabase SQL editor (or via `psql`)
-- against the target project database.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / guarded
-- DO blocks, so re-applying this file is a no-op once it has succeeded.

-- ---------------------------------------------------------------------------
-- 1. brands
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brands_org_idx on public.brands (organization_id);
create index if not exists brands_org_name_idx on public.brands (organization_id, lower(name));

-- ---------------------------------------------------------------------------
-- 2. categories (self-referencing parent/child hierarchy)
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  parent_category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categories_org_idx on public.categories (organization_id);
create index if not exists categories_org_name_idx on public.categories (organization_id, lower(name));
create index if not exists categories_parent_idx on public.categories (parent_category_id);

-- ---------------------------------------------------------------------------
-- 3. products
--
-- NOTE for existing deployments: id is a serial integer (per PROJECT_CONTEXT:
-- "UUIDs for all primary keys (except products: serial)"). The ALTER TABLE
-- statements below add the newer columns (sku, barcode, prices, stock,
-- status, timestamps) to databases created before this file existed, so the
-- repository and the deployed database converge.
-- ---------------------------------------------------------------------------
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

-- Columns for existing deployments (no-op on fresh installs)
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists barcode text;
alter table public.products add column if not exists units_per_pack integer;
alter table public.products add column if not exists default_purchase_price numeric(14, 2);
alter table public.products add column if not exists current_stock numeric(14, 2) not null default 0;
alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists created_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

-- Indexes
create index if not exists products_org_idx on public.products (organization_id);
create index if not exists products_org_name_idx on public.products (organization_id, lower(name));
create index if not exists products_brand_idx on public.products (brand_id);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_sku_idx on public.products (organization_id, sku);
create index if not exists products_barcode_idx on public.products (organization_id, barcode);

-- Uniqueness
--   - sku and barcode are unique per organization (nullable; partial index
--     so multiple NULLs are allowed).
--   - a product name is unique per (organization, brand): the same product
--     name may legitimately exist under different brands, but not twice for
--     the same brand (or twice with no brand).
-- NOTE: if an existing deployment already contains duplicate sku/barcode
-- values (or duplicate name+brand combinations), these statements will fail
-- and the duplicates must be resolved first.
create unique index if not exists products_org_sku_uidx on public.products (organization_id, sku) where sku is not null;
create unique index if not exists products_org_barcode_uidx on public.products (organization_id, barcode) where barcode is not null;
create unique index if not exists products_org_brand_name_uidx on public.products (organization_id, brand_id, lower(name)) where brand_id is not null;
create unique index if not exists products_org_nullbrand_name_uidx on public.products (organization_id, lower(name)) where brand_id is null;

-- ---------------------------------------------------------------------------
-- 4. updated_at maintenance trigger (shared by all three tables)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- Read: any member of the organization can see its own rows.
-- Write (insert/update/delete): requires the can_manage_products staff
-- permission, or the organization owner role.
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'organization_id', ''),
    nullif(auth.jwt() ->> 'organization_id', '')
  )::uuid;
$$;

-- SECURITY DEFINER: bypasses RLS on profiles/staff_permissions so the
-- permission check itself can never be blocked by tenant isolation.
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

-- products
drop policy if exists products_select_org on public.products;
create policy products_select_org on public.products
  for select using (organization_id = current_org_id());

drop policy if exists products_write_org on public.products;
create policy products_write_org on public.products
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

-- brands
drop policy if exists brands_select_org on public.brands;
create policy brands_select_org on public.brands
  for select using (organization_id = current_org_id());

drop policy if exists brands_write_org on public.brands;
create policy brands_write_org on public.brands
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

-- categories
drop policy if exists categories_select_org on public.categories;
create policy categories_select_org on public.categories
  for select using (organization_id = current_org_id());

drop policy if exists categories_write_org on public.categories;
create policy categories_write_org on public.categories
  for all using (organization_id = current_org_id() and has_product_permission(auth.uid()))
  with check (organization_id = current_org_id() and has_product_permission(auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Post-apply verification (run after the statements above)
-- ---------------------------------------------------------------------------
-- select table_name, policyname from pg_policies
--   where tablename in ('products', 'brands', 'categories') order by tablename;
