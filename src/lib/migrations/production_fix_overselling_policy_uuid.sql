-- TradeOS ERP — Production fix: resolve_overselling_policy uuid signature
--
-- PROBLEM
--   Production holds a stale overload of resolve_overselling_policy with
--   signature (uuid, integer) — or both overloads side by side. Product ids
--   are uuid, so the (uuid, integer) overload can never match a real product
--   and PostgREST cannot resolve the call unambiguously: approveDraft's
--   supabase.rpc("resolve_overselling_policy", { p_organization_id, p_product_id })
--   fails with PGRST202/PGRST203, which the owner sees as
--   "Could not verify stock policy. Retry approval." and no draft can be
--   approved.
--
-- FIX
--   Drop the stale (uuid, integer) overload, then (re)create exactly one
--   overload with signature (uuid, uuid) — the definition already used by
--   src/lib/migrations/production_upgrade_consolidated.sql — and re-apply
--   the grants. Safe to re-run: DROP ... IF EXISTS, CREATE OR REPLACE, and
--   a verification block that raises if the (uuid, uuid) overload is missing
--   or the (uuid, integer) overload still exists.
--
-- RUN BY THE USER in the Supabase SQL editor on the PRODUCTION database.
-- Do NOT run on the disposable QA database (it already has the correct
-- overload from the consolidated migration). No application code change is
-- needed alongside this file.

-- 1. Drop the stale overload.
drop function if exists public.resolve_overselling_policy(uuid, integer);

-- 2. Create (or replace) the correct overload.
create or replace function public.resolve_overselling_policy(
  p_organization_id uuid,
  p_product_id uuid
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

revoke execute on function public.resolve_overselling_policy(uuid, uuid) from public;
grant execute on function public.resolve_overselling_policy(uuid, uuid) to authenticated;
grant execute on function public.resolve_overselling_policy(uuid, uuid) to service_role;

-- 3. Verify exactly one overload remains.
do $$
begin
  if to_regprocedure('public.resolve_overselling_policy(uuid, uuid)') is null then
    raise exception 'resolve_overselling_policy(uuid, uuid) is missing after fix';
  end if;
  if to_regprocedure('public.resolve_overselling_policy(uuid, integer)') is not null then
    raise exception 'stale resolve_overselling_policy(uuid, integer) overload still exists';
  end if;
end $$;

notify pgrst, 'reload schema';
