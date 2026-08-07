-- ===========================================================================
-- PRODUCTION PHASE 4 — SALES MANAGEMENT
--
-- Adds the complete sales subsystem on top of the v0.3.0 production schema:
--   Part A  — customers: is_active archive flag + notes
--   Part B  — sales_orders / sales_order_items (mirror of purchase_orders)
--   Part C  — sales_returns / sales_return_items (mirror of purchase_returns,
--             item rows carry organization_id like purchase_items)
--   Part D  — invoice_sequences: add 'sales_order' doc type
--   Part E  — inventory_transactions: extend movement_type/reference_type
--             checks with 'return_in' / 'sales_return'; stock sync trigger
--             inventory_sync_sale_return_item
--   Part F  — sales_transactions: discount_amount / tax_rate / tax_amount
--             (future-ready tax support)
--   Part G  — sales_items: per-line discount
--   Part H  — customer_payments: payment_method (cash/bank/other)
--   Part I  — RLS policies for every sales-family table (org-scoped,
--             current_org_id()-based, mirroring the purchasing tables)
--   Part J  — post-apply verification (PASS/FAIL)
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Run AFTER production_upgrade_consolidated.sql (v0.3.0 baseline).
-- ===========================================================================

-- ===========================================================================
-- PART A — CUSTOMER ARCHIVE + NOTES
-- ===========================================================================

alter table public.customers
  add column if not exists is_active boolean not null default true;

alter table public.customers
  add column if not exists notes text;

alter table public.customers
  add column if not exists updated_at timestamptz not null default now();

create index if not exists customers_org_is_active_idx
  on public.customers (organization_id, is_active);

-- ===========================================================================
-- PART B — SALES ORDERS
-- ===========================================================================

create table if not exists public.sales_orders (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  so_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  order_date date,
  expected_date date,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'delivered', 'cancelled')),
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
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_ordered numeric(14, 2) not null check (quantity_ordered > 0),
  quantity_delivered numeric(14, 2) not null default 0 check (quantity_delivered >= 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_order_items_order_idx on public.sales_order_items (sales_order_id);
create index if not exists sales_order_items_product_idx on public.sales_order_items (product_id);

-- ===========================================================================
-- PART C — SALES RETURNS
-- ===========================================================================

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
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists sales_return_items_return_idx on public.sales_return_items (sales_return_id);
create index if not exists sales_return_items_product_idx on public.sales_return_items (product_id);
create index if not exists sales_return_items_org_idx on public.sales_return_items (organization_id);

-- ===========================================================================
-- PART D — INVOICE SEQUENCES: add 'sales_order'
-- ===========================================================================

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
  check (invoice_type in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order'));

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

  if p_invoice_type not in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order') then
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

-- ===========================================================================
-- PART E — SALES RETURN STOCK SYNC TRIGGER
-- ===========================================================================

-- Widen the ledger movement_type / reference_type checks (existing rows keep
-- their values; the new values are only ever written by the trigger below).
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
end $$;

alter table public.inventory_transactions
  add constraint inventory_transactions_movement_type_check
  check (movement_type in ('purchase_in', 'sale_out', 'return_out', 'return_in', 'adjustment_in', 'adjustment_out'));

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
    or reference_type in ('purchase_transaction', 'sales_transaction', 'adjustment', 'purchase_return', 'sales_return')
  );

-- Stock sync trigger for sales returns (mirror of
-- inventory_sync_purchase_return_item, direction inverted): INSERT records a
-- positive return_in movement (stock restored), DELETE reverses it.
create or replace function public.inventory_sync_sale_return_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_product_id uuid;
  v_delta numeric;
  v_batch text;
  v_expiry date;
  v_ref uuid;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce(old.organization_id,
      (select organization_id from public.sales_returns where id = old.sales_return_id));
    v_product_id := old.product_id;
    v_delta := -coalesce(old.quantity, 0);  -- negative: reversing a previously recorded return-in
    v_batch := old.batch_number;
    v_expiry := old.expiry_date;
    v_ref := old.sales_return_id;
    v_created_at := coalesce(old.created_at, now());
  else
    v_org := coalesce(new.organization_id,
      (select organization_id from public.sales_returns where id = new.sales_return_id));
    v_product_id := new.product_id;
    v_delta := coalesce(new.quantity, 0);  -- positive: restoring stock to the ledger
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

set check_function_bodies = on;

do $$
begin
  if to_regclass('public.sales_return_items') is not null then
    execute 'drop trigger if exists inventory_sync_sale_return_item on public.sales_return_items';
    execute 'create trigger inventory_sync_sale_return_item after insert or update or delete on public.sales_return_items
             for each row execute function public.inventory_sync_sale_return_item()';
  end if;
end $$;

-- Backfill sales_return_items.organization_id from the parent return (keeps
-- the trigger's item-side coalesce meaningful for rows inserted before the
-- column existed or by clients that omit it).
do $$
begin
  update public.sales_return_items sri
    set organization_id = sr.organization_id
    from public.sales_returns sr
    where sri.sales_return_id = sr.id
      and sri.organization_id is null;
end $$;

-- ===========================================================================
-- PART F — SALES TRANSACTIONS: DISCOUNT + TAX (future-ready)
-- ===========================================================================

alter table public.sales_transactions
  add column if not exists discount_amount numeric(14, 2) not null default 0,
  add column if not exists tax_rate numeric(5, 2) not null default 0,
  add column if not exists tax_amount numeric(14, 2) not null default 0;

-- ===========================================================================
-- PART G — SALES ITEMS: PER-LINE DISCOUNT
-- ===========================================================================

alter table public.sales_items
  add column if not exists discount numeric(14, 2) not null default 0;

-- Load Form support: per-line bonus (free) quantity shown as "Bns" on the
-- load form and summed into its Bonus Value footer total.
alter table public.sales_items
  add column if not exists bonus numeric(14, 2) not null default 0 check (bonus >= 0);

-- ===========================================================================
-- PART H — PAYMENTS: METHOD + DATE (cash/bank, backdated entry)
-- ===========================================================================
-- customer_payments / supplier_payments are managed directly in Supabase
-- (not defined in repo SQL), so every statement here is guarded: the
-- migration must never fail even if one of the tables is absent.

do $$
begin
  if to_regclass('public.customer_payments') is not null then
    execute 'alter table public.customer_payments add column if not exists payment_method text';
    execute 'alter table public.customer_payments add column if not exists payment_date date';
  end if;

  if to_regclass('public.supplier_payments') is not null then
    execute 'alter table public.supplier_payments add column if not exists payment_method text';
    execute 'alter table public.supplier_payments add column if not exists payment_date date';
  end if;
end $$;

do $$
declare
  v_constraint text;
begin
  if to_regclass('public.customer_payments') is not null then
    for v_constraint in
      select conname
      from pg_constraint
      where conrelid = 'public.customer_payments'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%payment_method%'
    loop
      execute format('alter table public.customer_payments drop constraint %I', v_constraint);
    end loop;
    execute 'alter table public.customer_payments add constraint customer_payments_payment_method_check
             check (payment_method in (''cash'', ''bank'', ''other''))';
  end if;

  if to_regclass('public.supplier_payments') is not null then
    for v_constraint in
      select conname
      from pg_constraint
      where conrelid = 'public.supplier_payments'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%payment_method%'
    loop
      execute format('alter table public.supplier_payments drop constraint %I', v_constraint);
    end loop;
    execute 'alter table public.supplier_payments add constraint supplier_payments_payment_method_check
             check (payment_method in (''cash'', ''bank'', ''other''))';
  end if;
end $$;

-- ===========================================================================
-- PART I — RLS POLICIES (org-scoped, current_org_id()-based)
-- ===========================================================================

alter table public.customers enable row level security;
alter table public.sales_transactions enable row level security;
alter table public.sales_items enable row level security;
alter table public.customer_payments enable row level security;
alter table public.customer_payment_allocations enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;

-- customers
drop policy if exists customers_select_org on public.customers;
create policy customers_select_org on public.customers
  for select using (organization_id = current_org_id());
drop policy if exists customers_insert_org on public.customers;
create policy customers_insert_org on public.customers
  for insert with check (organization_id = current_org_id());
drop policy if exists customers_update_org on public.customers;
create policy customers_update_org on public.customers
  for update using (organization_id = current_org_id());
drop policy if exists customers_delete_org on public.customers;
create policy customers_delete_org on public.customers
  for delete using (organization_id = current_org_id());

-- sales_transactions
drop policy if exists sales_transactions_select_org on public.sales_transactions;
create policy sales_transactions_select_org on public.sales_transactions
  for select using (organization_id = current_org_id());
drop policy if exists sales_transactions_insert_org on public.sales_transactions;
create policy sales_transactions_insert_org on public.sales_transactions
  for insert with check (organization_id = current_org_id());
drop policy if exists sales_transactions_update_org on public.sales_transactions;
create policy sales_transactions_update_org on public.sales_transactions
  for update using (organization_id = current_org_id());
drop policy if exists sales_transactions_delete_org on public.sales_transactions;
create policy sales_transactions_delete_org on public.sales_transactions
  for delete using (organization_id = current_org_id());

-- sales_items (parent-based, mirroring purchase_order_items)
drop policy if exists sales_items_select_org on public.sales_items;
create policy sales_items_select_org on public.sales_items
  for select using (
    exists (
      select 1 from public.sales_transactions st
      where st.id = sales_items.sales_transaction_id
        and st.organization_id = current_org_id()
    )
  );
drop policy if exists sales_items_insert_org on public.sales_items;
create policy sales_items_insert_org on public.sales_items
  for insert with check (
    exists (
      select 1 from public.sales_transactions st
      where st.id = sales_items.sales_transaction_id
        and st.organization_id = current_org_id()
    )
  );
drop policy if exists sales_items_update_org on public.sales_items;
create policy sales_items_update_org on public.sales_items
  for update using (
    exists (
      select 1 from public.sales_transactions st
      where st.id = sales_items.sales_transaction_id
        and st.organization_id = current_org_id()
    )
  );
drop policy if exists sales_items_delete_org on public.sales_items;
create policy sales_items_delete_org on public.sales_items
  for delete using (
    exists (
      select 1 from public.sales_transactions st
      where st.id = sales_items.sales_transaction_id
        and st.organization_id = current_org_id()
    )
  );

-- customer_payments
drop policy if exists customer_payments_select_org on public.customer_payments;
create policy customer_payments_select_org on public.customer_payments
  for select using (organization_id = current_org_id());
drop policy if exists customer_payments_insert_org on public.customer_payments;
create policy customer_payments_insert_org on public.customer_payments
  for insert with check (organization_id = current_org_id());
drop policy if exists customer_payments_update_org on public.customer_payments;
create policy customer_payments_update_org on public.customer_payments
  for update using (organization_id = current_org_id());
drop policy if exists customer_payments_delete_org on public.customer_payments;
create policy customer_payments_delete_org on public.customer_payments
  for delete using (organization_id = current_org_id());

-- customer_payment_allocations
drop policy if exists customer_payment_allocations_select_org on public.customer_payment_allocations;
create policy customer_payment_allocations_select_org on public.customer_payment_allocations
  for select using (organization_id = current_org_id());
drop policy if exists customer_payment_allocations_insert_org on public.customer_payment_allocations;
create policy customer_payment_allocations_insert_org on public.customer_payment_allocations
  for insert with check (organization_id = current_org_id());
drop policy if exists customer_payment_allocations_update_org on public.customer_payment_allocations;
create policy customer_payment_allocations_update_org on public.customer_payment_allocations
  for update using (organization_id = current_org_id());
drop policy if exists customer_payment_allocations_delete_org on public.customer_payment_allocations;
create policy customer_payment_allocations_delete_org on public.customer_payment_allocations
  for delete using (organization_id = current_org_id());

-- sales_orders
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

-- sales_order_items (parent-based)
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

-- sales_returns
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

-- sales_return_items (parent-based)
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

-- ===========================================================================
-- PART J — POST-APPLY VERIFICATION
-- ===========================================================================

do $$
declare
  v_missing text[] := '{}';
begin
  -- tables
  if to_regclass('public.sales_orders') is null then v_missing := v_missing || 'table sales_orders'; end if;
  if to_regclass('public.sales_order_items') is null then v_missing := v_missing || 'table sales_order_items'; end if;
  if to_regclass('public.sales_returns') is null then v_missing := v_missing || 'table sales_returns'; end if;
  if to_regclass('public.sales_return_items') is null then v_missing := v_missing || 'table sales_return_items'; end if;

  -- functions / triggers
  if to_regprocedure('public.inventory_sync_sale_return_item()') is null then v_missing := v_missing || 'function inventory_sync_sale_return_item'; end if;

  -- columns
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'is_active') then v_missing := v_missing || 'customers.is_active'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'notes') then v_missing := v_missing || 'customers.notes'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'discount_amount') then v_missing := v_missing || 'sales_transactions.discount_amount'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'tax_rate') then v_missing := v_missing || 'sales_transactions.tax_rate'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_transactions' and column_name = 'tax_amount') then v_missing := v_missing || 'sales_transactions.tax_amount'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_items' and column_name = 'discount') then v_missing := v_missing || 'sales_items.discount'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_items' and column_name = 'bonus') then v_missing := v_missing || 'sales_items.bonus'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_return_items' and column_name = 'organization_id') then v_missing := v_missing || 'sales_return_items.organization_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_payments' and column_name = 'payment_method') then v_missing := v_missing || 'customer_payments.payment_method'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_payments' and column_name = 'payment_date') then v_missing := v_missing || 'customer_payments.payment_date'; end if;
  if to_regclass('public.supplier_payments') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_payments' and column_name = 'payment_method') then v_missing := v_missing || 'supplier_payments.payment_method'; end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_payments' and column_name = 'payment_date') then v_missing := v_missing || 'supplier_payments.payment_date'; end if;
  end if;

  -- triggers
  if not exists (select 1 from pg_trigger where tgname = 'inventory_sync_sale_return_item' and tgrelid = 'public.sales_return_items'::regclass) then v_missing := v_missing || 'trigger inventory_sync_sale_return_item'; end if;

  -- RLS policies
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_orders' and policyname = 'sales_orders_select_org') then v_missing := v_missing || 'policy sales_orders_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_returns' and policyname = 'sales_returns_select_org') then v_missing := v_missing || 'policy sales_returns_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_transactions' and policyname = 'sales_transactions_select_org') then v_missing := v_missing || 'policy sales_transactions_select_org'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_select_org') then v_missing := v_missing || 'policy customers_select_org'; end if;

  -- indexes
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sales_orders' and indexname = 'sales_orders_org_created_idx') then v_missing := v_missing || 'index sales_orders_org_created_idx'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sales_returns' and indexname = 'sales_returns_org_created_idx') then v_missing := v_missing || 'index sales_returns_org_created_idx'; end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'PHASE 4 MIGRATION INCOMPLETE — missing objects: %', array_to_string(v_missing, ', ');
  else
    raise notice 'ALL REQUIRED OBJECTS PRESENT — Phase 4 sales migration complete.';
  end if;
end $$;
