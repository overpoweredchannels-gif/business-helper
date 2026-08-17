-- TradeOS ERP — Main Unit / Subunit selling (unit_mode)
--
-- Adds the ability to buy/sell a product in its MAIN unit (e.g. "Cottons")
-- or its SUBUNIT (e.g. "Pieces", where 1 cotton = 20 pieces per the product's
-- units_per_pack). Every product-line entry form (sales invoice, sales order,
-- purchase, purchase order, sales return, purchase return) gains a per-line
-- unit_mode selector; each item table stores the chosen mode alongside the
-- quantity, which stays in the unit the user selected.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / guarded DO blocks.

-- ---------------------------------------------------------------------------
-- 1. products.subunit_type — the name of the subunit (e.g. "Pieces")
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists subunit_type text check (
    subunit_type is null or char_length(trim(subunit_type)) between 1 and 50
  );

-- ---------------------------------------------------------------------------
-- 2. unit_mode on every item table (default 'main' = existing behavior)
-- ---------------------------------------------------------------------------
alter table public.sales_items
  add column if not exists unit_mode text not null default 'main';
alter table public.sales_order_items
  add column if not exists unit_mode text not null default 'main';
alter table public.sales_return_items
  add column if not exists unit_mode text not null default 'main';
alter table public.purchase_items
  add column if not exists unit_mode text not null default 'main';
alter table public.purchase_order_items
  add column if not exists unit_mode text not null default 'main';
alter table public.purchase_return_items
  add column if not exists unit_mode text not null default 'main';

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid in (
      'public.sales_items'::regclass,
      'public.sales_order_items'::regclass,
      'public.sales_return_items'::regclass,
      'public.purchase_items'::regclass,
      'public.purchase_order_items'::regclass,
      'public.purchase_return_items'::regclass
    )
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%unit_mode%'
  loop
    execute format('alter table public.%I drop constraint %I',
      (select relname from pg_class where oid = (select conrelid from pg_constraint where conname = v_constraint)),
      v_constraint);
  end loop;
end $$;

alter table public.sales_items
  add constraint sales_items_unit_mode_check check (unit_mode in ('main', 'subunit'));
alter table public.sales_order_items
  add constraint sales_order_items_unit_mode_check check (unit_mode in ('main', 'subunit'));
alter table public.sales_return_items
  add constraint sales_return_items_unit_mode_check check (unit_mode in ('main', 'subunit'));
alter table public.purchase_items
  add constraint purchase_items_unit_mode_check check (unit_mode in ('main', 'subunit'));
alter table public.purchase_order_items
  add constraint purchase_order_items_unit_mode_check check (unit_mode in ('main', 'subunit'));
alter table public.purchase_return_items
  add constraint purchase_return_items_unit_mode_check check (unit_mode in ('main', 'subunit'));

-- ---------------------------------------------------------------------------
-- 3. Normalize stock to MAIN units in the inventory sync triggers.
--
-- current_stock is denominated in main units (e.g. cottons). When a line is
-- recorded in subunit mode (e.g. 25 pieces with 20 pieces per cotton), the
-- ledger delta and current_stock change must be quantity / units_per_pack.
-- Sub-unit lines that carry their own units_per_pack number are converted;
-- lines without a pack size are treated as already-main.
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

create or replace function public.inventory_sync_purchase_item()
returns trigger language plpgsql security definer as $$
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

  -- Convert subunit quantity to main units for the ledger / current_stock.
  if coalesce((case when tg_op = 'DELETE' then old.unit_mode else new.unit_mode end), 'main') = 'subunit' then
    select units_per_pack into v_upp from public.products where id = v_product_id;
    if v_upp is not null and v_upp > 0 then
      v_delta := v_delta / v_upp;
    end if;
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
  v_product_id uuid;
  v_delta numeric;
  v_upp numeric;
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

  -- Convert subunit quantity to main units for the ledger / current_stock.
  if coalesce((case when tg_op = 'DELETE' then old.unit_mode else new.unit_mode end), 'main') = 'subunit' then
    select units_per_pack into v_upp from public.products where id = v_product_id;
    if v_upp is not null and v_upp > 0 then
      v_delta := v_delta / v_upp;
    end if;
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason, batch_number,
     reference_type, reference_id, created_at)
  values
    (v_org, v_product_id, 'sale_out', v_delta, null, null,
     'sales_transaction', v_ref, v_created_at);

  -- Overselling enforcement: when stock leaves the business (sale or update
  -- that sells more), resolve the effective overselling policy and, if it is
  -- 'block', refuse to let current_stock go below zero.
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

-- ---------------------------------------------------------------------------
-- 4. Sync triggers for return items also convert subunit quantities to main
--    units, keeping the ledger consistent with the sale/purchase normalization.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_sync_purchase_return_item()
returns trigger language plpgsql security definer as $$
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

create or replace function public.inventory_sync_sale_return_item()
returns trigger language plpgsql security definer as $$
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