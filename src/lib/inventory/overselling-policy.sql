-- TradeOS ERP — Overselling Policy (Inventory Improvements)
--
-- Owner-controlled overselling policy with three levels of resolution:
--   Product → Category (walking up the parent chain) → Organization.
--
-- Each level may be 'allow' (stock can go below zero) or 'block' (sales are
-- refused when a line would exceed current stock). NULL at the product and
-- category levels means "inherit from the parent level". The organization
-- column is NOT NULL and defaults to 'allow' to preserve the pre-existing
-- behavior (the UI had no stock guard before this policy existed).
--
-- No automated migration runner (see src/lib/identity/schema.sql). Run every
-- statement manually, once, in the Supabase SQL editor. Safe to re-run: all
-- statements are idempotent (IF NOT EXISTS / OR REPLACE / guarded DO blocks).

-- ---------------------------------------------------------------------------
-- 1. Organization-level policy
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Category-level override (NULL = inherit)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Product-level override (NULL = inherit)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Effective-policy resolver
--
--    Returns the effective policy ('allow' or 'block') for a product:
--    product override wins, then the product's category and its ancestors
--    (nearest ancestor wins), then the organization default. The walk is
--    capped at 20 hops so a corrupted/cyclic category tree can never loop.
--    SECURITY DEFINER: callers (including the AI sales route) must never be
--    able to bypass RLS on products/categories to read these columns.
-- ---------------------------------------------------------------------------
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
