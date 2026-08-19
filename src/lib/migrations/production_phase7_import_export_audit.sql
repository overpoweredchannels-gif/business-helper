-- ===========================================================================
-- PRODUCTION PHASE 7 — IMPORT/EXPORT AUDIT TABLES
--
-- Tracks all import and export operations per organization for auditability.
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- ===========================================================================

create table if not exists public.import_exports (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_type text not null check (operation_type in ('import', 'export')),
  entity_key text not null, -- e.g., 'products', 'customers', 'sales_invoices'
  file_name text,
  file_size_bytes bigint,
  file_hash text, -- SHA256 of file content for deduplication
  status text not null check (status in ('pending', 'preview', 'running', 'completed', 'failed', 'cancelled')),
  duplicate_mode text check (duplicate_mode in ('skip', 'update', 'error')),
  total_rows integer default 0,
  created_count integer default 0,
  updated_count integer default 0,
  skipped_count integer default 0,
  failed_count integer default 0,
  error_details jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_exports_org_idx
  on public.import_exports (organization_id);
create index if not exists import_exports_org_entity_idx
  on public.import_exports (organization_id, entity_key);
create index if not exists import_exports_org_created_idx
  on public.import_exports (organization_id, created_at desc);

alter table public.import_exports enable row level security;

drop policy if exists import_exports_select_org on public.import_exports;
create policy import_exports_select_org on public.import_exports
  for select using (organization_id = current_org_id());

drop policy if exists import_exports_insert_org on public.import_exports;
create policy import_exports_insert_org on public.import_exports
  for insert with check (organization_id = current_org_id());

drop policy if exists import_exports_update_org on public.import_exports;
create policy import_exports_update_org on public.import_exports
  for update using (organization_id = current_org_id());

-- ===========================================================================
-- Import/Export Templates (saved column mappings per entity per org)
-- ===========================================================================

create table if not exists public.import_export_templates (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_key text not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  mapping jsonb not null, -- { fileColumn: fieldKey }
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_key, name)
);

create index if not exists import_export_templates_org_idx
  on public.import_export_templates (organization_id);
create index if not exists import_export_templates_org_entity_idx
  on public.import_export_templates (organization_id, entity_key);

alter table public.import_export_templates enable row level security;

drop policy if exists import_export_templates_select_org on public.import_export_templates;
create policy import_export_templates_select_org on public.import_export_templates
  for select using (organization_id = current_org_id());

drop policy if exists import_export_templates_insert_org on public.import_export_templates;
create policy import_export_templates_insert_org on public.import_export_templates
  for insert with check (organization_id = current_org_id());

drop policy if exists import_export_templates_update_org on public.import_export_templates;
create policy import_export_templates_update_org on public.import_export_templates
  for update using (organization_id = current_org_id());

drop policy if exists import_export_templates_delete_org on public.import_export_templates;
create policy import_export_templates_delete_org on public.import_export_templates
  for delete using (organization_id = current_org_id());

-- ===========================================================================
-- Post-apply verification (PASS/FAIL)
-- ===========================================================================
do $$
declare
  v_missing text := '';
begin
  if to_regclass('public.import_exports') is null then
    v_missing := v_missing || ' import_exports';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'import_exports'
        and column_name = 'entity_key') then
    v_missing := v_missing || ' import_exports.entity_key';
  end if;
  if to_regclass('public.import_export_templates') is null then
    v_missing := v_missing || ' import_export_templates';
  end if;
  if not exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'import_exports'
        and policyname = 'import_exports_select_org') then
    v_missing := v_missing || ' import_exports RLS';
  end if;
  if not exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'import_export_templates'
        and policyname = 'import_export_templates_select_org') then
    v_missing := v_missing || ' import_export_templates RLS';
  end if;
  if v_missing = '' then
    raise notice 'IMPORT_EXPORT_AUDIT: PASS';
  else
    raise warning 'IMPORT_EXPORT_AUDIT: MISSING =>%', v_missing;
  end if;
end $$;