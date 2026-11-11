-- Phase 20 — returns cancel (atomic, no hard delete).
--
-- What it does:
--   * Adds `cancel_sales_return_atomic(p_return_id)` and
--     `cancel_purchase_return_atomic(p_return_id)`: cancelling a return flips
--     its status to 'cancelled' (the status column + CHECK already exist on
--     both tables; no new column is needed) and reverses the return's effects
--     in the same transaction:
--       - Money: nothing to write. The receivables/payables engines already
--         exclude cancelled returns (src/lib/sales/returns-offset.ts,
--         src/lib/purchases/returns-offset.ts), and both create routes
--         already exclude them from the returnable-quantity guard — so a
--         cancelled return stops offsetting the invoice the moment its
--         status flips, exactly like a voided payment stops covering
--         anything.
--       - Stock: the compensating inventory movement the item-DELETE trigger
--         would have written on a hard delete
--         (inventory_sync_sale_return_item / inventory_sync_purchase_return_item):
--         same movement_type ('return_in' for sales, 'return_out' for
--         purchases), same reference_type/reference_id, same batch/expiry,
--         same subunit normalization against the product's CURRENT
--         units_per_pack, same plain current_stock update (no floor — the
--         DELETE path has none either). The items stay, so the trigger does
--         not fire; the RPC writes the identical row instead. The one
--         deliberate difference from the trigger: the movement is dated at
--         cancellation time (now()), not backdated to the item's created_at —
--         a cancel is a real event that happens now (void_payment_atomic
--         likewise stamps voided_at = now()), and the ledger should show
--         the stock leaving/returning on the day it actually did.
--       - Audit: one 'cancelled' audit row is written inside the RPC, so a
--         cancel can never land without its audit trail (same as
--         void_payment_atomic).
--   * Adds `purchases_create_allowed(p_org)`: the SQL mirror of
--     requirePermission(request, "purchases_create") — owner, built-in
--     manager / purchase_officer roles, a custom role_definition whose
--     permissions contain 'purchases_create', staff_permissions
--     can_create_purchases, or a 'purchases' granted section. The sales
--     cancel reuses the existing sales_tool_allowed(v_org, 'returns')
--     (phase 11) — no new gate needed there.
--   * Defensive, additive-only hardening the cancel depends on:
--       - `staff_permissions.can_create_purchases` added IF NOT EXISTS
--         (the app reads it; phase 17 added the sibling payment columns
--         the same way).
--       - The inventory_transactions reference_type check is recreated with
--         the full set including 'sales_return'. The phase-4 sales file
--         allows it but the purchases/consolidated recreates drop it, so
--         which value is effective depends on migration order; the cancel
--         RPC inserts 'sales_return' reference rows and must not fail on
--         that. Widening only — no rows change.
--
-- What it does NOT do: no columns are added to the returns tables, no rows
-- are changed, nothing is dropped except the two recreated CHECK constraints
-- (immediately re-added, wider). The old hard-delete path is removed from
-- the UI in the same slice; the RPC is the only cancel path.
--
-- Safe to run more than once (CREATE OR REPLACE + IF NOT EXISTS everywhere).
-- Run this file in the Supabase SQL Editor (production + QA) BEFORE promoting
-- a build that calls the cancel RPCs, or the cancel buttons will fail with
-- "function not found in schema cache".
begin;

-- Defensive: the purchases gate reads this column (see legacy.ts /
-- api-context.ts); ensure it exists the same way phase 17 ensured the
-- payment columns.
alter table public.staff_permissions
  add column if not exists can_create_purchases boolean not null default false;

-- Defensive: make sure the ledger accepts 'sales_return' references
-- regardless of which migration recreated this check last.
do $$
declare
  v_constraint text;
begin
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
  add constraint inventory_transactions_reference_type_check
  check (
    reference_type is null
    or reference_type in ('purchase_transaction', 'sales_transaction', 'adjustment', 'purchase_return', 'sales_return', 'purchase_order')
  );

-- SQL mirror of requirePermission(request, "purchases_create"):
-- owner, built-in manager / purchase_officer, custom role with
-- 'purchases_create' in role_definitions.permissions, the legacy
-- can_create_purchases boolean, or a 'purchases' granted section.
create or replace function public.purchases_create_allowed(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
    left join public.role_definitions r on r.organization_id = p_org and r.id = p.role
      and r.is_built_in is distinct from true
    where p.id = auth.uid() and p.organization_id = p_org and p.is_active is distinct from false
    and (
      p.role = 'owner'
      or p.role in ('manager', 'purchase_officer')
      or (
        jsonb_typeof(coalesce(r.permissions, '[]'::jsonb)) = 'array'
        and coalesce(r.permissions, '[]'::jsonb) ? 'purchases_create'
      )
      or coalesce(sp.can_create_purchases, false)
      or 'purchases' = any(coalesce(sp.granted_sections, '{}'::text[]))
    )
  );
$$;
revoke all on function public.purchases_create_allowed(uuid) from public, anon;
grant execute on function public.purchases_create_allowed(uuid) to authenticated, service_role;

-- Cancel a confirmed sales return: status -> 'cancelled' + the compensating
-- stock movement the item-DELETE trigger would have written, + audit row.
-- The status guard is the idempotency: a second cancel errors instead of
-- reversing stock twice.
create or replace function public.cancel_sales_return_atomic(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_return_number text;
  v_status text;
  v_item record;
  v_delta numeric;
  v_upp integer;
begin
  if v_actor is null or p_return_id is null then
    raise exception 'Authenticated actor and return are required' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.sales_tool_allowed(v_org, 'returns') then
    raise exception 'Sales returns permission is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':sales_return:' || p_return_id::text, 0));

  -- Lock the return row, then flip it. A missing row or a non-confirmed
  -- status (already cancelled) errors; nothing is half-applied.
  select return_number, status into v_return_number, v_status
  from public.sales_returns
  where id = p_return_id and organization_id = v_org
  for update;
  if not found then raise exception 'Sales return is unavailable in this organization' using errcode = '22023'; end if;
  if v_status <> 'confirmed' then raise exception 'Sales return is already cancelled' using errcode = '22023'; end if;

  update public.sales_returns
  set status = 'cancelled', updated_at = now()
  where id = p_return_id and organization_id = v_org;

  -- Compensating stock movement per item, exactly as
  -- inventory_sync_sale_return_item writes it on item DELETE: 'return_in'
  -- with the negated quantity, normalized to main units when the line is a
  -- subunit, same batch/expiry, same reference — dated at cancel time.
  for v_item in
    select product_id, quantity, unit_mode, batch_number, expiry_date
    from public.sales_return_items
    where sales_return_id = p_return_id and organization_id = v_org
    order by created_at, id
  loop
    v_delta := -coalesce(v_item.quantity, 0);
    if coalesce(v_item.unit_mode, 'main') = 'subunit' then
      select units_per_pack into v_upp from public.products where id = v_item.product_id;
      if v_upp is not null and v_upp > 0 then
        v_delta := v_delta / v_upp;
      end if;
    end if;
    if v_delta = 0 then
      continue;
    end if;
    insert into public.inventory_transactions
      (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
       expiry_date, reference_type, reference_id, created_at)
    values
      (v_org, v_item.product_id, 'return_in', v_delta, null, v_item.batch_number,
       v_item.expiry_date, 'sales_return', p_return_id, now());
    update public.products
    set current_stock = current_stock + v_delta, updated_at = now()
    where id = v_item.product_id;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, action, entity_type, entity_id,
    entity_label, description, old_values, new_values
  ) values (
    v_org, v_actor, 'cancelled', 'sales_return', p_return_id,
    v_return_number,
    'Cancelled sales return ' || v_return_number,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled')
  );

  return jsonb_build_object(
    'return_id', p_return_id, 'return_number', v_return_number,
    'status', 'cancelled', 'cancelled', true
  );
end;
$$;
revoke all on function public.cancel_sales_return_atomic(uuid) from public, anon;
grant execute on function public.cancel_sales_return_atomic(uuid) to authenticated;

-- Cancel a confirmed purchase return: status -> 'cancelled' + the
-- compensating stock movement the item-DELETE trigger would have written
-- ('return_out' with the positive quantity — reversing a return-out), +
-- audit row. Same idempotency guard as the sales cancel.
create or replace function public.cancel_purchase_return_atomic(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_return_number text;
  v_status text;
  v_item record;
  v_delta numeric;
  v_upp integer;
begin
  if v_actor is null or p_return_id is null then
    raise exception 'Authenticated actor and return are required' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.purchases_create_allowed(v_org) then
    raise exception 'Purchases permission is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':purchase_return:' || p_return_id::text, 0));

  select return_number, status into v_return_number, v_status
  from public.purchase_returns
  where id = p_return_id and organization_id = v_org
  for update;
  if not found then raise exception 'Purchase return is unavailable in this organization' using errcode = '22023'; end if;
  if v_status <> 'confirmed' then raise exception 'Purchase return is already cancelled' using errcode = '22023'; end if;

  update public.purchase_returns
  set status = 'cancelled', updated_at = now()
  where id = p_return_id and organization_id = v_org;

  -- Compensating stock movement per item, exactly as
  -- inventory_sync_purchase_return_item writes it on item DELETE:
  -- 'return_out' with the positive quantity (reversing the return-out),
  -- normalized to main units when the line is a subunit, same
  -- batch/expiry, same reference — dated at cancel time.
  for v_item in
    select product_id, quantity, unit_mode, batch_number, expiry_date
    from public.purchase_return_items
    where purchase_return_id = p_return_id and organization_id = v_org
    order by created_at, id
  loop
    v_delta := coalesce(v_item.quantity, 0);
    if coalesce(v_item.unit_mode, 'main') = 'subunit' then
      select units_per_pack into v_upp from public.products where id = v_item.product_id;
      if v_upp is not null and v_upp > 0 then
        v_delta := v_delta / v_upp;
      end if;
    end if;
    if v_delta = 0 then
      continue;
    end if;
    insert into public.inventory_transactions
      (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
       expiry_date, reference_type, reference_id, created_at)
    values
      (v_org, v_item.product_id, 'return_out', v_delta, null, v_item.batch_number,
       v_item.expiry_date, 'purchase_return', p_return_id, now());
    update public.products
    set current_stock = current_stock + v_delta, updated_at = now()
    where id = v_item.product_id;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, action, entity_type, entity_id,
    entity_label, description, old_values, new_values
  ) values (
    v_org, v_actor, 'cancelled', 'purchase_return', p_return_id,
    v_return_number,
    'Cancelled purchase return ' || v_return_number,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled')
  );

  return jsonb_build_object(
    'return_id', p_return_id, 'return_number', v_return_number,
    'status', 'cancelled', 'cancelled', true
  );
end;
$$;
revoke all on function public.cancel_purchase_return_atomic(uuid) from public, anon;
grant execute on function public.cancel_purchase_return_atomic(uuid) to authenticated;

-- Verification: both RPCs + the gate must exist after this file runs.
do $$
begin
  if to_regprocedure('public.cancel_sales_return_atomic(uuid)') is null then
    raise exception 'cancel_sales_return_atomic(uuid) was not created';
  end if;
  if to_regprocedure('public.cancel_purchase_return_atomic(uuid)') is null then
    raise exception 'cancel_purchase_return_atomic(uuid) was not created';
  end if;
  if to_regprocedure('public.purchases_create_allowed(uuid)') is null then
    raise exception 'purchases_create_allowed(uuid) was not created';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
