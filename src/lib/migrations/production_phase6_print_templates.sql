-- ===========================================================================
-- PRODUCTION PHASE 6 — PRINT TEMPLATES
--
-- Per-organization printable template registry for Sales Invoices and Load
-- Forms. Templates are plain JSONB "config" objects described by the shared
-- PrintTemplate type; the renderer combines a template with live document data
-- at print time, so storekeepers can reproduce their old paper layouts.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- ===========================================================================

create table if not exists public.print_templates (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  doc_type text not null check (doc_type in ('sales_invoice', 'load_form')),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  config jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, doc_type, name)
);

create index if not exists print_templates_org_idx
  on public.print_templates (organization_id);
create index if not exists print_templates_org_doc_type_idx
  on public.print_templates (organization_id, doc_type);

alter table public.print_templates enable row level security;

drop policy if exists print_templates_select_org on public.print_templates;
create policy print_templates_select_org on public.print_templates
  for select using (organization_id = current_org_id());

drop policy if exists print_templates_insert_org on public.print_templates;
create policy print_templates_insert_org on public.print_templates
  for insert with check (organization_id = current_org_id());

drop policy if exists print_templates_update_org on public.print_templates;
create policy print_templates_update_org on public.print_templates
  for update using (organization_id = current_org_id());

drop policy if exists print_templates_delete_org on public.print_templates;
create policy print_templates_delete_org on public.print_templates
  for delete using (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- Post-apply verification (PASS/FAIL)
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text := '';
begin
  if to_regclass('public.print_templates') is null then
    v_missing := v_missing || ' print_templates';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'print_templates'
        and column_name = 'config') then
    v_missing := v_missing || ' print_templates.config';
  end if;
  if not exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'print_templates'
        and policyname = 'print_templates_select_org') then
    v_missing := v_missing || ' print_templates RLS-select';
  end if;
  if v_missing = '' then
    raise notice 'PRINT_TEMPLATES: PASS';
  else
    raise warning 'PRINT_TEMPLATES: MISSING =>%', v_missing;
  end if;
end $$;