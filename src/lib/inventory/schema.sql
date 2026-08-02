-- TradeOS ERP — Inventory Management (Phase 1) schema
--
-- This file is the source of truth for the Inventory module database schema.
-- It follows the established convention (see src/lib/products/schema.sql and
-- src/lib/identity/schema.sql): there is no automated migration runner — run
-- every statement below manually, once, in the Supabase SQL editor (or via
-- `psql`) against the target project database.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / guarded
-- DO blocks, so re-applying this file is a no-op once it has succeeded.
--
-- What this file provides:
--   1. can_manage_inventory column on staff_permissions (new permission key)
--   2. has_inventory_permission() helper (mirrors has_product_permission)
--   3. inventory_transactions — the immutable stock ledger (single source of
--      truth for stock movements: purchase receipts, sales issues, manual
--      adjustments), with batch/expiry support ready for FIFO costing later
--   4. RLS: read is org-scoped; writes happen ONLY inside SECURITY DEFINER
--      functions (triggers + adjust_inventory RPC) — clients can never write
--      directly
--   5. Triggers on purchase_items / sales_items that automatically record
--      ledger movements and keep products.current_stock in sync (this also
--      fixes the gap where UI-created purchases/sales never updated
--      products.current_stock)
--   6. adjust_inventory() — atomic, permission-checked manual adjustment
--   7. One-time backfill: existing purchase_items/sales_items become ledger
--      rows and products.current_stock is rebuilt from the ledger
--
-- NOTE: products.current_stock is relaxed from >= 0 to allow truthful
-- negative balances (e.g. overselling recorded via the UI sale flow). Manual
-- adjustments are still guarded by adjust_inventory() so they can never
-- drive stock negative. The old CHECK constraint is dropped idempotently
-- regardless of its name.

-- ---------------------------------------------------------------------------
-- 1. staff_permissions.can_manage_inventory
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.staff_permissions') is not null then
    execute 'alter table public.staff_permissions add column if not exists can_manage_inventory boolean not null default false';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. has_inventory_permission(uid)
--
-- SECURITY DEFINER: bypasses RLS on profiles/staff_permissions so the
-- permission check itself can never be blocked by tenant isolation.
-- Mirrors public.has_product_permission from src/lib/products/schema.sql.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. inventory_transactions (the stock ledger)
--
-- One row per stock movement. quantity_delta is signed:
--   positive = stock in (purchase receipt, adjustment in)
--   negative = stock out (sales issue, adjustment out)
-- The current stock of a product is the sum of its deltas; this is the
-- authoritative source, mirrored into products.current_stock by the
-- triggers / RPC below. FIFO preparation: every purchase receipt carries
-- batch_number / expiry_date so future FIFO costing can consume the oldest
-- batch first — no costing is performed yet (Phase 1).
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_transactions (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  movement_type text not null check (
    movement_type in ('purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out')
  ),
  quantity_delta numeric(14, 2) not null check (quantity_delta <> 0),
  reason text check (reason is null or char_length(trim(reason)) <= 500),
  batch_number text check (batch_number is null or char_length(trim(batch_number)) <= 100),
  expiry_date date,
  reference_type text check (
    reference_type is null
    or reference_type in ('purchase_transaction', 'sales_transaction', 'adjustment')
  ),
  reference_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Adjustments must always carry a reason (purchase/sale movements come from
  -- their own tables and may have no reason).
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

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--
-- Read: any member of the organization can read its own ledger rows.
-- Write: intentionally NO insert/update/delete policies. The ledger is only
-- written by SECURITY DEFINER code (triggers and adjust_inventory), which
-- runs as the table owner and bypasses RLS. Direct client writes are
-- impossible.
-- ---------------------------------------------------------------------------
alter table public.inventory_transactions enable row level security;

drop policy if exists inventory_transactions_select_org on public.inventory_transactions;
create policy inventory_transactions_select_org on public.inventory_transactions
  for select using (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- 5. Stock sync triggers (purchase_items / sales_items -> ledger + products)
--
-- These make inventory_transactions the single source of truth going
-- forward: any purchase receipt or sales issue (from the UI or the AI
-- routes) automatically writes a ledger row and keeps products.current_stock
-- in sync. UPDATE is handled as a delta (new - old).
--
-- organization_id is resolved defensively from the parent transaction when
-- the item row does not carry one (inserts in the app never set it).
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

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

  -- Overselling enforcement: when stock leaves the business (sale or update
  -- that sells more), resolve the effective overselling policy
  -- (product -> category chain -> organization, via resolve_overselling_policy)
  -- and, if it is 'block', refuse to let current_stock go below zero. The
  -- update is scoped to rows where the result stays >= 0; if no row matches,
  -- FOUND is false and the whole statement (sale + ledger row) rolls back.
  -- When the policy is 'allow' (or stock is coming back in), the unguarded
  -- update preserves the existing negative-stock tolerance.
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

-- ---------------------------------------------------------------------------
-- 6. adjust_inventory() RPC — atomic, permission-checked manual adjustment
--
-- - Requires the can_manage_inventory permission (or owner/admin role).
-- - Validates the product belongs to the organization.
-- - Requires a non-empty reason.
-- - Never lets stock go negative.
-- - Inserts the ledger row and updates products.current_stock in a single
--   transaction (the whole function body is atomic).
-- ---------------------------------------------------------------------------
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

  -- Delta write (not absolute) so concurrent adjustments to the same product
  -- cannot lose updates: each statement atomically re-evaluates against the
  -- latest committed value. The negative-stock guard is enforced atomically
  -- here (the advisory pre-check above handles the common single-caller case
  -- with a clear message; the WHERE clause handles races).
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

-- ---------------------------------------------------------------------------
-- 7. Relax products.current_stock to allow truthful negative balances
--
-- The UI sale flow has no stock guard, so overselling can legitimately push
-- stock below zero; blocking that inside a trigger would break sales
-- creation. Instead the CHECK constraint (whatever its name) is removed and
-- negative balances remain visible in the ledger as the truth. Manual
-- adjustments are still prevented from going negative by adjust_inventory().
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8. One-time backfill from existing purchase_items / sales_items
--
-- Runs only when the ledger is empty (safe to re-apply). Converts all
-- historical purchases/sales into ledger rows and rebuilds
-- products.current_stock from the ledger so the two sources of truth
-- converge before the triggers start recording new movements.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9. Post-apply verification (run after the statements above)
-- ---------------------------------------------------------------------------
-- select movement_type, count(*) from public.inventory_transactions
--   group by movement_type order by movement_type;
-- select id, name, current_stock from public.products
--   where current_stock <> 0 order by name limit 20;
-- select tablename, policyname from pg_policies
--   where tablename = 'inventory_transactions';
-- select p.auth_user_id, p.role, coalesce(sp.can_manage_inventory, false) as can_manage_inventory
--   from public.profiles p
--   left join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
--   order by p.email;
