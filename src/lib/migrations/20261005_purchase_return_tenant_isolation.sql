begin;

-- This guard intentionally targets the deployed UUID schema. Stop on an old
-- integer-ID schema instead of casting deployed product IDs to match it.
do $migration$
declare
  v_bad_rows boolean;
begin
  if to_regclass('public.purchase_returns') is null
     or to_regclass('public.purchase_return_items') is null
     or to_regclass('public.products') is null
     or to_regclass('public.inventory_transactions') is null then
    raise exception 'Purchase-return tenant migration prerequisites are missing';
  end if;

  if exists (
       select 1
       from (values
         ('public.purchase_returns'::regclass, 'id'),
         ('public.purchase_returns'::regclass, 'organization_id'),
         ('public.purchase_return_items'::regclass, 'purchase_return_id'),
         ('public.purchase_return_items'::regclass, 'product_id'),
         ('public.purchase_return_items'::regclass, 'organization_id'),
         ('public.products'::regclass, 'id'),
         ('public.products'::regclass, 'organization_id')
       ) as expected(relid, attname)
       left join pg_catalog.pg_attribute a
         on a.attrelid = expected.relid
        and a.attname = expected.attname
        and not a.attisdropped
       where a.atttypid is distinct from 'uuid'::regtype
     ) then
    raise exception 'Purchase-return tenant migration requires UUID identifiers';
  end if;

  select exists (
    select 1
    from public.purchase_return_items pri
    left join public.purchase_returns pr on pr.id = pri.purchase_return_id
    left join public.products p on p.id = pri.product_id
    where pr.id is null
       or p.id is null
       or p.organization_id is distinct from pr.organization_id
       or (pri.organization_id is not null
           and pri.organization_id is distinct from pr.organization_id)
  ) into v_bad_rows;

  if v_bad_rows then
    raise exception 'Existing purchase-return rows have inconsistent organization ownership';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.purchase_return_items'::regclass
      and t.tgname = 'inventory_sync_purchase_return_item'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.inventory_sync_purchase_return_item()'::regprocedure
      and (t.tgtype & 29) = 29
  ) then
    raise exception 'The existing purchase-return stock writer is missing or disabled';
  end if;
end;
$migration$;

-- The child organization is needed when a parent delete cascades: the parent
-- is no longer visible to the child DELETE trigger at that point.
update public.purchase_return_items pri
set organization_id = pr.organization_id
from public.purchase_returns pr
where pr.id = pri.purchase_return_id
  and pri.organization_id is null;

alter table public.purchase_return_items
  alter column organization_id set not null;

create or replace function public.guard_purchase_return_item_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent_organization_id uuid;
  v_product_organization_id uuid;
begin
  if tg_op = 'UPDATE'
     and (new.purchase_return_id is distinct from old.purchase_return_id
       or new.product_id is distinct from old.product_id
       or new.organization_id is distinct from old.organization_id) then
    raise exception using
      errcode = '23514',
      message = 'Purchase return line ownership cannot be reassigned';
  end if;

  select pr.organization_id
    into v_parent_organization_id
    from public.purchase_returns pr
   where pr.id = new.purchase_return_id
   for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Purchase return line parent is unavailable';
  end if;

  select p.organization_id
    into v_product_organization_id
    from public.products p
   where p.id = new.product_id
   for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Purchase return line product is unavailable';
  end if;

  if v_product_organization_id is distinct from v_parent_organization_id
     or (new.organization_id is not null
         and new.organization_id is distinct from v_parent_organization_id) then
    raise exception using
      errcode = '23514',
      message = 'Purchase return line is not permitted for this organization';
  end if;

  new.organization_id := v_parent_organization_id;
  return new;
end;
$function$;

revoke all on function public.guard_purchase_return_item_tenant()
  from public, anon, authenticated, service_role;

drop trigger if exists purchase_return_item_tenant_guard
  on public.purchase_return_items;
create trigger purchase_return_item_tenant_guard
before insert or update on public.purchase_return_items
for each row execute function public.guard_purchase_return_item_tenant();

-- Preserve the one existing AFTER trigger as the only stock writer. Both the
-- stock mutation and ledger row remain in the originating DML transaction.
create or replace function public.inventory_sync_purchase_return_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_product_id uuid;
  v_parent_id uuid;
  v_stock_delta numeric;
  v_old_stock_quantity numeric := 0;
  v_new_stock_quantity numeric := 0;
  v_units_per_pack numeric;
  v_current_stock numeric;
  v_batch_number text;
  v_expiry_date date;
  v_created_at timestamptz;
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
    v_product_id := old.product_id;
    v_parent_id := old.purchase_return_id;
    v_batch_number := old.batch_number;
    v_expiry_date := old.expiry_date;
    v_created_at := old.created_at;
  else
    v_organization_id := new.organization_id;
    v_product_id := new.product_id;
    v_parent_id := new.purchase_return_id;
    v_batch_number := new.batch_number;
    v_expiry_date := new.expiry_date;
    v_created_at := new.created_at;
  end if;

  if v_organization_id is null or v_product_id is null then
    raise exception using
      errcode = '23514',
      message = 'Purchase return line is missing its organization or product';
  end if;

  if tg_op = 'UPDATE'
     and (new.purchase_return_id is distinct from old.purchase_return_id
       or new.product_id is distinct from old.product_id
       or new.organization_id is distinct from old.organization_id) then
    raise exception using
      errcode = '23514',
      message = 'Purchase return line ownership cannot be reassigned';
  end if;

  select p.units_per_pack, p.current_stock
    into v_units_per_pack, v_current_stock
    from public.products p
   where p.id = v_product_id
     and p.organization_id = v_organization_id
   for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Purchase return line product is not in its organization';
  end if;

  if tg_op <> 'DELETE' then
    v_new_stock_quantity := coalesce(new.quantity, 0);
    if coalesce(new.unit_mode, 'main') = 'subunit'
       and v_units_per_pack is not null
       and v_units_per_pack > 0 then
      v_new_stock_quantity := v_new_stock_quantity / v_units_per_pack;
    end if;
  end if;

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_old_stock_quantity := coalesce(old.quantity, 0);
    if coalesce(old.unit_mode, 'main') = 'subunit'
       and v_units_per_pack is not null
       and v_units_per_pack > 0 then
      v_old_stock_quantity := v_old_stock_quantity / v_units_per_pack;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_stock_delta := v_old_stock_quantity;
  else
    v_stock_delta := v_old_stock_quantity - v_new_stock_quantity;
  end if;

  if v_stock_delta = 0 then
    return coalesce(new, old);
  end if;

  if v_stock_delta < 0 and v_current_stock + v_stock_delta < 0 then
    raise exception using
      errcode = '23514',
      message = 'Purchase return cannot reduce stock below zero';
  end if;

  update public.products p
     set current_stock = p.current_stock + v_stock_delta,
         updated_at = pg_catalog.now()
   where p.id = v_product_id
     and p.organization_id = v_organization_id
     and (v_stock_delta >= 0 or p.current_stock + v_stock_delta >= 0);

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Purchase return stock update was rejected';
  end if;

  insert into public.inventory_transactions
    (organization_id, product_id, movement_type, quantity_delta, reason,
     batch_number, expiry_date, reference_type, reference_id, created_at)
  values
    (v_organization_id, v_product_id, 'return_out', v_stock_delta, null,
     v_batch_number, v_expiry_date, 'purchase_return', v_parent_id,
     coalesce(v_created_at, pg_catalog.now()));

  return coalesce(new, old);
end;
$function$;

revoke all on function public.inventory_sync_purchase_return_item()
  from public, anon, authenticated, service_role;

commit;
