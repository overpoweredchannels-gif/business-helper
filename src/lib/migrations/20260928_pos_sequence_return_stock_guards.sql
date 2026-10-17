-- Apply after production_phase13_atomic_sales.sql and
-- 20260926_sales_quantity_precision.sql.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.invoice_sequences') is null
    or to_regclass('public.sales_returns') is null
    or to_regclass('public.sales_return_items') is null
    or to_regclass('public.products') is null
    or to_regclass('public.inventory_transactions') is null then
    raise exception 'POS sequence and return stock prerequisites are missing';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null
    or to_regprocedure('public.resolve_overselling_policy(uuid,uuid)') is null then
    raise exception 'POS authorization or stock policy helper is missing';
  end if;
end
$$;

-- The deployed UUID policy resolver already schema-qualifies its relation
-- references; keep its SECURITY DEFINER lookup path pinned as well.
alter function public.resolve_overselling_policy(uuid, uuid)
  set search_path = pg_catalog, pg_temp;

-- Authenticated users may allocate numbers only for their active organization.
-- Trusted service-role and SECURITY DEFINER callers remain supported.
create or replace function public.next_invoice_number(
  p_organization_id uuid,
  p_invoice_type text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_next integer;
  v_actor uuid := auth.uid();
  v_jwt_role text := auth.jwt() ->> 'role';
begin
  if p_organization_id is null then
    raise exception 'Invoice organization is required' using errcode = '22023';
  end if;
  if p_invoice_type is null or p_invoice_type not in (
    'sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order'
  ) then
    raise exception 'Unknown invoice type' using errcode = '22023';
  end if;

  if v_jwt_role is distinct from 'service_role' and (
    v_actor is null or not exists (
      select 1
      from public.profiles p
      where p.id = v_actor
        and p.organization_id = p_organization_id
        and p.is_active is true
    )
  ) then
    raise exception 'Active organization membership is required' using errcode = '42501';
  end if;

  insert into public.invoice_sequences (organization_id, invoice_type, current_number, updated_at)
  values (p_organization_id, p_invoice_type, 1, pg_catalog.now())
  on conflict (organization_id, invoice_type)
  do update set current_number = public.invoice_sequences.current_number + 1,
                updated_at = pg_catalog.now()
  returning current_number into v_next;

  return v_next;
end;
$$;

revoke all on function public.next_invoice_number(uuid, text) from public, anon;
grant execute on function public.next_invoice_number(uuid, text) to authenticated, service_role;

-- All return item stock effects use this writer. Lock every affected product
-- in organization/id order, then validate and apply the net delta atomically.
create or replace function public.apply_sales_return_inventory_changes(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_stock record;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Invalid sales return inventory changes' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_changes) = 0 then
    return;
  end if;

  -- Serialize item mutations with cancellation/deletion before locking stock.
  -- This prevents a concurrent insert from restoring stock after cancellation.
  perform sr.id
  from public.sales_returns sr
  where sr.id in (
    select c.reference_id
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
  )
  order by sr.id
  for no key update;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
    left join public.sales_returns sr on sr.id = c.reference_id
    where c.organization_id is null or c.product_id is null or c.reference_id is null
      or c.signed_quantity is null
      or c.signed_quantity::text in ('NaN', 'Infinity', '-Infinity')
      or sr.id is null
      or sr.organization_id is distinct from c.organization_id
  ) then
    raise exception 'Sales return organization or product is invalid' using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
    join public.sales_returns sr on sr.id = c.reference_id
    where c.signed_quantity > 0 and sr.status = 'cancelled'
  ) then
    raise exception 'Items cannot be added to a cancelled sales return' using errcode = '42501';
  end if;

  -- This ordering is shared by insert, update, delete, cancellation and parent
  -- deletion. It also matches the atomic sales and purchase writers.
  perform p.id
  from public.products p
  where exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
    where c.organization_id = p.organization_id and c.product_id = p.id
  )
  order by p.organization_id, p.id
  for update;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
    left join public.products p
      on p.id = c.product_id and p.organization_id = c.organization_id
    where p.id is null
      or (coalesce(c.unit_mode, 'main') = 'subunit' and coalesce(p.units_per_pack, 0) <= 0)
  ) then
    raise exception 'Sales return product or subunit configuration is invalid' using errcode = '22023';
  end if;

  for v_stock in
    with changes as (
      select c.organization_id, c.product_id,
        case when coalesce(c.unit_mode, 'main') = 'subunit'
          then pg_catalog.round(c.signed_quantity / p.units_per_pack, 6)
          else c.signed_quantity end as delta
      from pg_catalog.jsonb_to_recordset(p_changes) as c(
        organization_id uuid, product_id uuid, reference_id uuid,
        signed_quantity numeric, unit_mode text, batch_number text,
        expiry_date date, created_at timestamptz
      )
      join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
    ), totals as (
      select organization_id, product_id, sum(delta) as delta
      from changes group by organization_id, product_id having sum(delta) <> 0
    )
    select p.id, p.organization_id, coalesce(p.current_stock, 0) as current_stock,
      totals.delta, public.resolve_overselling_policy(p.organization_id, p.id) as stock_policy
    from totals
    join public.products p on p.id = totals.product_id and p.organization_id = totals.organization_id
    order by p.organization_id, p.id
  loop
    if v_stock.delta < 0 and v_stock.stock_policy = 'block'
      and v_stock.current_stock + v_stock.delta < 0 then
      raise exception 'Return reversal would violate the stock policy for product %', v_stock.id
        using errcode = '23514';
    end if;

    update public.products p
    set current_stock = coalesce(p.current_stock, 0) + v_stock.delta,
        updated_at = pg_catalog.now()
    where p.id = v_stock.id and p.organization_id = v_stock.organization_id;
    if not found then
      raise exception 'Sales return product is unavailable' using errcode = '23503';
    end if;
  end loop;

  with changes as (
    select c.organization_id, c.product_id, c.reference_id, c.batch_number, c.expiry_date,
      coalesce(c.created_at, pg_catalog.now()) as created_at,
      case when coalesce(c.unit_mode, 'main') = 'subunit'
        then pg_catalog.round(c.signed_quantity / p.units_per_pack, 6)
        else c.signed_quantity end as delta
    from pg_catalog.jsonb_to_recordset(p_changes) as c(
      organization_id uuid, product_id uuid, reference_id uuid,
      signed_quantity numeric, unit_mode text, batch_number text,
      expiry_date date, created_at timestamptz
    )
    join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
  ), movements as (
    select organization_id, product_id, reference_id, batch_number, expiry_date,
      pg_catalog.max(created_at) as created_at, pg_catalog.sum(delta) as delta
    from changes
    group by organization_id, product_id, reference_id, batch_number, expiry_date
    having pg_catalog.sum(delta) <> 0
  )
  insert into public.inventory_transactions (
    organization_id, product_id, movement_type, quantity_delta, reason,
    batch_number, expiry_date, reference_type, reference_id, created_at
  )
  select organization_id, product_id, 'return_in', delta, null,
    batch_number, expiry_date, 'sales_return', reference_id, created_at
  from movements;
end;
$$;

create or replace function public.inventory_sync_sale_return_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changes jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'organization_id', coalesce(i.organization_id, sr.organization_id),
    'product_id', i.product_id, 'reference_id', i.sales_return_id,
    'signed_quantity', i.quantity, 'unit_mode', coalesce(i.unit_mode, 'main'),
    'batch_number', i.batch_number, 'expiry_date', i.expiry_date, 'created_at', i.created_at
  )), '[]'::jsonb)
  into v_changes
  from new_rows i
  left join public.sales_returns sr on sr.id = i.sales_return_id;

  perform public.apply_sales_return_inventory_changes(v_changes);
  return null;
end;
$$;

create or replace function public.inventory_sync_sale_return_item_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changes jsonb;
begin
  perform sr.id
  from public.sales_returns sr
  where sr.id in (
    select i.sales_return_id from old_rows i
    union
    select i.sales_return_id from new_rows i
  )
  order by sr.id
  for no key update;

  if exists (
    select 1 from new_rows i join public.sales_returns sr on sr.id = i.sales_return_id
    where sr.status = 'cancelled'
  ) then
    raise exception 'Items cannot be edited on a cancelled sales return' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(c.change), '[]'::jsonb)
  into v_changes
  from (
    select pg_catalog.jsonb_build_object(
      'organization_id', coalesce(i.organization_id, sr.organization_id),
      'product_id', i.product_id, 'reference_id', i.sales_return_id,
      'signed_quantity', -i.quantity, 'unit_mode', coalesce(i.unit_mode, 'main'),
      'batch_number', i.batch_number, 'expiry_date', i.expiry_date, 'created_at', i.created_at
    ) as change
    from old_rows i left join public.sales_returns sr on sr.id = i.sales_return_id
    union all
    select pg_catalog.jsonb_build_object(
      'organization_id', coalesce(i.organization_id, sr.organization_id),
      'product_id', i.product_id, 'reference_id', i.sales_return_id,
      'signed_quantity', i.quantity, 'unit_mode', coalesce(i.unit_mode, 'main'),
      'batch_number', i.batch_number, 'expiry_date', i.expiry_date, 'created_at', i.created_at
    )
    from new_rows i left join public.sales_returns sr on sr.id = i.sales_return_id
  ) c;

  perform public.apply_sales_return_inventory_changes(v_changes);
  return null;
end;
$$;

create or replace function public.inventory_sync_sale_return_item_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changes jsonb;
begin
  perform sr.id
  from public.sales_returns sr
  where sr.id in (select i.sales_return_id from old_rows i)
  order by sr.id
  for no key update;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'organization_id', coalesce(i.organization_id, sr.organization_id),
    'product_id', i.product_id, 'reference_id', i.sales_return_id,
    'signed_quantity', -i.quantity, 'unit_mode', coalesce(i.unit_mode, 'main'),
    'batch_number', i.batch_number, 'expiry_date', i.expiry_date, 'created_at', i.created_at
  )), '[]'::jsonb)
  into v_changes
  from old_rows i
  join public.sales_returns sr on sr.id = i.sales_return_id
  where sr.status is distinct from 'cancelled';

  perform public.apply_sales_return_inventory_changes(v_changes);
  return null;
end;
$$;

create or replace function public.cancel_sales_return_inventory()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changes jsonb;
begin
  if exists (
    select 1 from old_rows o join new_rows n on n.id = o.id
    where o.status = 'cancelled' and n.status is distinct from 'cancelled'
  ) then
    raise exception 'Cancelled sales returns cannot be reactivated' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'organization_id', coalesce(i.organization_id, sr.organization_id),
    'product_id', i.product_id, 'reference_id', i.sales_return_id,
    'signed_quantity', -i.quantity, 'unit_mode', coalesce(i.unit_mode, 'main'),
    'batch_number', i.batch_number, 'expiry_date', i.expiry_date, 'created_at', i.created_at
  )), '[]'::jsonb)
  into v_changes
  from old_rows o
  join new_rows n on n.id = o.id
  join public.sales_return_items i on i.sales_return_id = n.id
  join public.sales_returns sr on sr.id = i.sales_return_id
  where o.status is distinct from 'cancelled' and n.status = 'cancelled';

  perform public.apply_sales_return_inventory_changes(v_changes);
  return null;
end;
$$;

create or replace function public.delete_sales_return_items_before_parent_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  delete from public.sales_return_items i where i.sales_return_id = old.id;
  return old;
end;
$$;

revoke all on function public.apply_sales_return_inventory_changes(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.inventory_sync_sale_return_item() from public, anon, authenticated, service_role;
revoke all on function public.inventory_sync_sale_return_item_update() from public, anon, authenticated, service_role;
revoke all on function public.inventory_sync_sale_return_item_delete() from public, anon, authenticated, service_role;
revoke all on function public.cancel_sales_return_inventory() from public, anon, authenticated, service_role;
revoke all on function public.delete_sales_return_items_before_parent_delete() from public, anon, authenticated, service_role;

drop trigger if exists inventory_sync_sale_return_item on public.sales_return_items;
drop trigger if exists inventory_sync_sale_return_item_update on public.sales_return_items;
drop trigger if exists inventory_sync_sale_return_item_delete on public.sales_return_items;
create trigger inventory_sync_sale_return_item
after insert on public.sales_return_items
referencing new table as new_rows
for each statement execute function public.inventory_sync_sale_return_item();
create trigger inventory_sync_sale_return_item_update
after update on public.sales_return_items
referencing old table as old_rows new table as new_rows
for each statement execute function public.inventory_sync_sale_return_item_update();
create trigger inventory_sync_sale_return_item_delete
after delete on public.sales_return_items
referencing old table as old_rows
for each statement execute function public.inventory_sync_sale_return_item_delete();

drop trigger if exists sales_return_cancel_reverses_items on public.sales_returns;
create trigger sales_return_cancel_reverses_items
after update on public.sales_returns
referencing old table as old_rows new table as new_rows
for each statement execute function public.cancel_sales_return_inventory();

drop trigger if exists sales_return_delete_reverses_items on public.sales_returns;
create trigger sales_return_delete_reverses_items
before delete on public.sales_returns
for each row execute function public.delete_sales_return_items_before_parent_delete();

commit;
