-- Run manually in the Supabase SQL editor. No historical stock rebuild.
-- Existing rows start with zero recorded bonus deduction. Their bonus is
-- applied on the next edit; deleting an untouched old row cannot add phantom stock.
-- Review historical bonus sales separately against a physical stock count.
begin;

do $$
declare definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.inventory_sync_sale_item()')) into definition;
  if definition is null then raise exception 'Existing sales inventory trigger function is required'; end if;
  if definition ilike '%bonus%' and definition not ilike '%inventory_bonus_main%' then
    raise exception 'This database already has custom bonus inventory logic. Review it before applying this migration.';
  end if;
end $$;

alter table public.sales_items add column if not exists inventory_bonus_main numeric not null default 0;

create or replace function public.prepare_sale_inventory_bonus()
returns trigger language plpgsql security definer set search_path = public as $$
declare pack numeric;
begin
  if coalesce(new.bonus, 0) < 0 then raise exception 'Bonus cannot be negative'; end if;
  new.inventory_bonus_main := coalesce(new.bonus, 0);
  if coalesce(new.unit_mode, 'main') = 'subunit' then
    select units_per_pack into pack from public.products where id = new.product_id;
    if pack is null or pack <= 0 then raise exception 'Configure units per pack before selling sub-units'; end if;
    new.inventory_bonus_main := new.inventory_bonus_main / pack;
  end if;
  return new;
end $$;

create or replace function public.inventory_sync_sale_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_org uuid; new_org uuid; old_product uuid; new_product uuid;
  old_ref uuid; new_ref uuid; old_main numeric := 0; new_main numeric := 0;
  pack numeric; movement record;
begin
  if tg_op <> 'INSERT' then
    old_org := coalesce(old.organization_id, (select organization_id from public.sales_transactions where id = old.sales_transaction_id));
    old_product := old.product_id; old_ref := old.sales_transaction_id;
    old_main := coalesce(old.quantity, 0);
    if coalesce(old.unit_mode, 'main') = 'subunit' then
      select units_per_pack into pack from public.products where id = old_product;
      if pack > 0 then old_main := old_main / pack; end if;
    end if;
    old_main := old_main + coalesce(old.inventory_bonus_main, 0);
  end if;
  if tg_op <> 'DELETE' then
    new_org := coalesce(new.organization_id, (select organization_id from public.sales_transactions where id = new.sales_transaction_id));
    new_product := new.product_id; new_ref := new.sales_transaction_id;
    new_main := coalesce(new.quantity, 0);
    if coalesce(new.unit_mode, 'main') = 'subunit' then
      select units_per_pack into pack from public.products where id = new_product;
      if pack is null or pack <= 0 then raise exception 'Configure units per pack before selling sub-units'; end if;
      new_main := new_main / pack;
    end if;
    new_main := new_main + coalesce(new.inventory_bonus_main, 0);
  end if;
  -- Combine old and new quantities before checking stock. Unit changes and
  -- bonus/paid-quantity changes therefore apply their net effect exactly once.
  for movement in
    select org, product, reference, sum(delta) as delta
    from (values (old_org, old_product, old_ref, old_main), (new_org, new_product, new_ref, -new_main)) as changes(org, product, reference, delta)
    where org is not null and product is not null
    group by org, product, reference having sum(delta) <> 0
  loop
    if movement.delta < 0 and public.resolve_overselling_policy(movement.org, movement.product) = 'block' then
      update public.products set current_stock = coalesce(current_stock, 0) + movement.delta, updated_at = now()
      where id = movement.product and organization_id = movement.org and coalesce(current_stock, 0) + movement.delta >= 0;
      if not found then raise exception 'Insufficient stock, including bonus units, for product %', movement.product; end if;
    else
      update public.products set current_stock = coalesce(current_stock, 0) + movement.delta, updated_at = now()
      where id = movement.product and organization_id = movement.org;
      if not found then raise exception 'Product does not belong to this organization'; end if;
    end if;
    insert into public.inventory_transactions(organization_id, product_id, movement_type, quantity_delta, reason, batch_number, reference_type, reference_id, created_at)
    values (movement.org, movement.product, 'sale_out', movement.delta, null, null, 'sales_transaction', movement.reference, now());
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists prepare_sale_inventory_bonus on public.sales_items;
create trigger prepare_sale_inventory_bonus before insert or update on public.sales_items
for each row execute function public.prepare_sale_inventory_bonus();
drop trigger if exists inventory_sync_sale_item on public.sales_items;
create trigger inventory_sync_sale_item after insert or update or delete on public.sales_items
for each row execute function public.inventory_sync_sale_item();

commit;
