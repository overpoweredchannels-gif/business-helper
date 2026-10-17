-- Active subunit returns rely on the product conversion used by the stock
-- writer. Keep that conversion stable until the return is cancelled/deleted.
do $$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.sales_returns') is null
    or to_regclass('public.sales_return_items') is null then
    raise exception 'POS return history guard prerequisites are missing';
  end if;
end;
$$;

create or replace function public.reject_sales_return_item_reassignment()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.sales_return_id is distinct from new.sales_return_id then
    raise exception 'Sales return items cannot be reassigned' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_active_return_conversion_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.units_per_pack is distinct from new.units_per_pack and exists (
    select 1
    from public.sales_return_items i
    join public.sales_returns sr on sr.id = i.sales_return_id
    where i.product_id = old.id
      and coalesce(i.unit_mode, 'main') = 'subunit'
      and sr.status is distinct from 'cancelled'
  ) then
    raise exception 'Cannot change units_per_pack while an active subunit sales return exists'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_active_return_conversion_change() from public, anon, authenticated, service_role;
revoke all on function public.reject_sales_return_item_reassignment() from public, anon, authenticated, service_role;

drop trigger if exists products_guard_active_return_conversion on public.products;
create trigger products_guard_active_return_conversion
before update of units_per_pack on public.products
for each row
when (old.units_per_pack is distinct from new.units_per_pack)
execute function public.prevent_active_return_conversion_change();

drop trigger if exists sales_return_items_reassignment_guard on public.sales_return_items;
create trigger sales_return_items_reassignment_guard
before update of sales_return_id on public.sales_return_items
for each row execute function public.reject_sales_return_item_reassignment();
