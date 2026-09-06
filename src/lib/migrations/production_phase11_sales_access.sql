-- Run this entire file in the Supabase SQL editor. Safe to run again.
-- Adds restrictive rules alongside existing tenant policies. No business rows are changed.
begin;

create or replace function public.sales_tool_allowed(p_org uuid, p_tool text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.id = auth.uid() and p.organization_id = p_org and p.is_active is distinct from false
    and (p.role in ('owner', 'admin') or (
      p_tool <> 'owner' and
      (case when cardinality(coalesce(sp.granted_sections, '{}'::text[])) > 0
        then 'sales' = any(sp.granted_sections) else coalesce(sp.can_create_sales, false) end)
      and (case when 'sales:configured' = any(coalesce(sp.granted_sections, '{}'::text[]))
        then ('sales:' || p_tool) = any(sp.granted_sections)
        else p_tool in ('invoice', 'history') end)
    ))
  );
$$;
revoke all on function public.sales_tool_allowed(uuid,text) from public;
grant execute on function public.sales_tool_allowed(uuid,text) to authenticated, service_role;

-- Only owners/admins post confirmed invoices. Employee submissions use the
-- existing server-side draft/owner-approval workflow.
drop policy if exists sales_access_read on public.sales_transactions;
create policy sales_access_read on public.sales_transactions as restrictive for select to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (created_by_profile_id = auth.uid() and (
    public.sales_tool_allowed(organization_id, 'invoice') or public.sales_tool_allowed(organization_id, 'history') or
    public.sales_tool_allowed(organization_id, 'report') or public.sales_tool_allowed(organization_id, 'returns') or
    public.sales_tool_allowed(organization_id, 'loadform') or public.sales_tool_allowed(organization_id, 'invoices')))
);

do $$ declare t text; cmd text; begin
  foreach t in array array['sales_transactions','sales_orders','staff_permissions'] loop
    foreach cmd in array array['insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', 'sales_access_' || cmd, t);
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
        'sales_access_' || cmd, t, cmd,
        case cmd
          when 'insert' then 'with check (public.sales_tool_allowed(organization_id, ''owner''))'
          when 'update' then 'using (public.sales_tool_allowed(organization_id, ''owner'')) with check (public.sales_tool_allowed(organization_id, ''owner''))'
          else 'using (public.sales_tool_allowed(organization_id, ''owner''))' end);
    end loop;
  end loop;
end $$;

drop policy if exists sales_access_read on public.sales_orders;
create policy sales_access_read on public.sales_orders as restrictive for select to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (created_by_profile_id = auth.uid() and (public.sales_tool_allowed(organization_id, 'orders') or
    public.sales_tool_allowed(organization_id, 'invoice') or public.sales_tool_allowed(organization_id, 'history')))
);

drop policy if exists sales_access_scope on public.sales_returns;
create policy sales_access_scope on public.sales_returns as restrictive for all to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
) with check (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
);

-- Child rows inherit their parent's visibility even where an older broad
-- organization policy also exists.
do $$ declare r record; cmd text; expr text; begin
  for r in select * from (values
    ('sales_items','sales_transactions','sales_transaction_id'),
    ('sales_order_items','sales_orders','sales_order_id'),
    ('sales_return_items','sales_returns','sales_return_id')
  ) as v(child, parent, fk) loop
    expr := format('exists(select 1 from public.%I parent where parent.id = %I.%I)', r.parent, r.child, r.fk);
    execute format('drop policy if exists sales_access_parent on public.%I', r.child);
    execute format('create policy sales_access_parent on public.%I as restrictive for all to authenticated using (%s) with check (%s)', r.child, expr, expr);
    if r.child <> 'sales_return_items' then
      expr := format('exists(select 1 from public.%I parent where parent.id = %I.%I and public.sales_tool_allowed(parent.organization_id, ''owner''))', r.parent, r.child, r.fk);
      foreach cmd in array array['insert','update','delete'] loop
        execute format('drop policy if exists %I on public.%I', 'sales_access_' || cmd, r.child);
        execute format('create policy %I on public.%I as restrictive for %s to authenticated %s', 'sales_access_' || cmd, r.child, cmd,
          case cmd when 'insert' then format('with check (%s)',expr)
          when 'update' then format('using (%s) with check (%s)',expr,expr)
          else format('using (%s)',expr) end);
      end loop;
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;

select to_regprocedure('public.sales_tool_allowed(uuid,text)') is not null as sales_access_ready;
