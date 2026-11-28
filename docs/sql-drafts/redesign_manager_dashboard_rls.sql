-- DRAFT. Run only in a disposable database until UMAIR approves this exact text.
-- Requires the tenant policies and production_phase11_sales_access.sql.
begin;

-- Separate flags keep legacy granted_sections and its boolean fallback intact.
alter table public.staff_permissions
  add column if not exists dashboard_view boolean not null default false,
  add column if not exists dashboard_export boolean not null default false;

create schema if not exists tradeos_private;
revoke all on schema tradeos_private from public;

create or replace function tradeos_private.staff_dashboard_allowed(p_org uuid, p_permission text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.id = (select auth.uid())
      and p.organization_id = p_org
      and p.is_active is distinct from false
      and case p_permission
        when 'dashboard_view' then sp.dashboard_view
        when 'dashboard_export' then sp.dashboard_export
        else false
      end
  );
$$;
revoke all on function tradeos_private.staff_dashboard_allowed(uuid, text) from public, anon;
grant execute on function tradeos_private.staff_dashboard_allowed(uuid, text) to authenticated;

alter policy sales_access_read on public.sales_transactions using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (created_by_profile_id = auth.uid() and (
    public.sales_tool_allowed(organization_id, 'invoice') or public.sales_tool_allowed(organization_id, 'history') or
    public.sales_tool_allowed(organization_id, 'report') or public.sales_tool_allowed(organization_id, 'returns') or
    public.sales_tool_allowed(organization_id, 'loadform') or public.sales_tool_allowed(organization_id, 'invoices'))) or
  (select tradeos_private.staff_dashboard_allowed(organization_id, 'dashboard_view'))
);

alter policy sales_access_read on public.sales_orders using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (created_by_profile_id = auth.uid() and (public.sales_tool_allowed(organization_id, 'orders') or
    public.sales_tool_allowed(organization_id, 'invoice') or public.sales_tool_allowed(organization_id, 'history'))) or
  (select tradeos_private.staff_dashboard_allowed(organization_id, 'dashboard_view'))
);

-- The old ALL policy supplied both expressions to UPDATE, the check to
-- INSERT, and the visibility expression to DELETE. Keep all three.
drop policy sales_access_scope on public.sales_returns;
create policy sales_access_scope on public.sales_returns as restrictive for select to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid())) or
  (select tradeos_private.staff_dashboard_allowed(organization_id, 'dashboard_view'))
);

drop policy if exists sales_access_return_insert on public.sales_returns;
create policy sales_access_return_insert on public.sales_returns as restrictive for insert to authenticated with check (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
);

drop policy if exists sales_access_return_update on public.sales_returns;
create policy sales_access_return_update on public.sales_returns as restrictive for update to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
) with check (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
);

drop policy if exists sales_access_return_delete on public.sales_returns;
create policy sales_access_return_delete on public.sales_returns as restrictive for delete to authenticated using (
  public.sales_tool_allowed(organization_id, 'owner') or
  (public.sales_tool_allowed(organization_id, 'returns') and created_by_profile_id = auth.uid()
    and exists(select 1 from public.sales_transactions st where st.id = sales_transaction_id and st.organization_id = sales_returns.organization_id and st.created_by_profile_id = auth.uid()))
);

-- Keep sales_access_parent for child SELECT. Phase-11 used parent SELECT
-- visibility for return-item writes too. Preserve its original parent
-- predicate explicitly for writes now that parent SELECT is broader.
create or replace function tradeos_private.sales_return_write_allowed(p_return_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
    from public.sales_returns sr
    where sr.id = p_return_id
      and (
        public.sales_tool_allowed(sr.organization_id, 'owner') or
        (public.sales_tool_allowed(sr.organization_id, 'returns') and sr.created_by_profile_id = auth.uid()
          and exists (
            select 1 from public.sales_transactions st
            where st.id = sr.sales_transaction_id and st.organization_id = sr.organization_id and st.created_by_profile_id = auth.uid()
          ))
      )
  );
$$;
revoke all on function tradeos_private.sales_return_write_allowed(uuid) from public, anon;
grant execute on function tradeos_private.sales_return_write_allowed(uuid) to authenticated;

drop policy if exists sales_access_return_item_insert on public.sales_return_items;
create policy sales_access_return_item_insert on public.sales_return_items as restrictive for insert to authenticated
  with check ((select tradeos_private.sales_return_write_allowed(sales_return_id)));

drop policy if exists sales_access_return_item_update on public.sales_return_items;
create policy sales_access_return_item_update on public.sales_return_items as restrictive for update to authenticated
  using ((select tradeos_private.sales_return_write_allowed(sales_return_id)))
  with check ((select tradeos_private.sales_return_write_allowed(sales_return_id)));

drop policy if exists sales_access_return_item_delete on public.sales_return_items;
create policy sales_access_return_item_delete on public.sales_return_items as restrictive for delete to authenticated
  using ((select tradeos_private.sales_return_write_allowed(sales_return_id)));

notify pgrst, 'reload schema';
commit;
