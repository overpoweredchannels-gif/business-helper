-- TradeOS ERP — Purchase Management (Phase 1) schema
--
-- Purchase Orders (with a receive workflow), Purchase Returns, and the
-- supporting stock-ledger integration. Follows the established convention
-- (src/lib/identity/schema.sql): no automated migration runner — run every
-- statement manually, once, in the Supabase SQL editor (or via `psql`).
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / guarded
-- DO blocks, so re-applying this file is a no-op once it has succeeded.
--
-- What this file provides:
--   1. Ledger enum extension: inventory_transactions.movement_type gains
--      return_out (purchase returns reduce stock) and return_in (reserved
--      for sales returns in a later phase); reference_type gains
--      purchase_return / purchase_order.
--   2. purchase_orders + purchase_order_items — PO tracking with per-line
--      received quantities. Receiving writes purchase_transactions +
--      purchase_items, so the existing inventory_sync_purchase_item trigger
--      automatically records the ledger movement and bumps current_stock.
--   3. purchase_returns + purchase_return_items — supplier returns that
--      reduce stock via a dedicated trigger (inventory_sync_purchase_return_item).
--   4. RLS: every new table is org-scoped for select/insert/update/delete.
--      inventory_transactions itself keeps its write-free policy — its rows
--      are only ever written by SECURITY DEFINER triggers / RPCs.
--
-- NOTE: invoice_sequences / next_invoice_number are extended for the
-- 'purchase_order' family in src/lib/invoices/schema.sql (same file owns the
-- numbering machinery).

-- ---------------------------------------------------------------------------
-- 1. Extend the stock ledger enum for returns
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  -- Recreate the movement_type check with the extended allowed set.
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

-- ---------------------------------------------------------------------------
-- 2. Purchase orders
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Purchase returns
-- ---------------------------------------------------------------------------
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
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id integer not null references public.products(id) on delete cascade,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists purchase_return_items_return_idx on public.purchase_return_items (purchase_return_id);
create index if not exists purchase_return_items_product_idx on public.purchase_return_items (product_id);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--
-- All four new tables: members of the owning organization can read, create,
-- update, and delete their own rows. (purchase_transactions and its legacy
-- siblings follow the same pattern; inventory_transactions is the exception
-- — ledger writes only happen inside SECURITY DEFINER code.)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Stock sync trigger for purchase returns
--
-- Mirrors inventory_sync_sale_item: INSERT records a negative (return_out)
-- movement and decrements current_stock; UPDATE writes the delta; DELETE
-- reverses the previously recorded movement.
--
-- Overselling guard: the return can never drive current_stock below zero. The
-- update is scoped to rows where the result stays >= 0; if no row matches,
-- FOUND is false and the whole statement (return + ledger row) rolls back
-- with a clear error. This is race-safe under concurrent inserts, exactly
-- like the adjust_inventory() guard. The client (handleCreatePurchaseReturn)
-- and the POST /api/purchases/returns route validate the same rule up front
-- for a friendly message; this trigger is the authoritative backstop.
-- ---------------------------------------------------------------------------
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
