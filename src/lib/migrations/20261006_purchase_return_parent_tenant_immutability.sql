begin;

do $migration$
begin
  if to_regclass('public.purchase_returns') is null
     or to_regclass('public.purchase_return_items') is null
     or to_regclass('public.products') is null then
    raise exception 'Purchase-return parent guard prerequisites are missing';
  end if;

  if exists (
    select 1
    from public.purchase_return_items pri
    left join public.purchase_returns pr on pr.id = pri.purchase_return_id
    left join public.products p on p.id = pri.product_id
    where pr.id is null
       or p.id is null
       or pri.organization_id is distinct from pr.organization_id
       or p.organization_id is distinct from pr.organization_id
  ) then
    raise exception 'Existing purchase-return rows have inconsistent organization ownership';
  end if;
end;
$migration$;

-- Parent organization changes would leave existing lines and their stock
-- history associated with the old tenant. No application workflow moves a
-- return between organizations, so reject reassignment for every database
-- role, including roles that bypass row-level security.
create or replace function public.guard_purchase_return_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Purchase return organization cannot be reassigned';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_purchase_return_organization()
  from public, anon, authenticated, service_role;

drop trigger if exists purchase_return_organization_guard
  on public.purchase_returns;
create trigger purchase_return_organization_guard
before update of organization_id on public.purchase_returns
for each row execute function public.guard_purchase_return_organization();

commit;
