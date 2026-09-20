-- Archive-only file storage for legacy business records. Does not change live balances or stock.
begin;

create table if not exists public.historical_archive_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  file_name text not null check (length(btrim(file_name)) > 0),
  content_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 52428800),
  storage_path text not null unique,
  search_text text not null default '',
  row_count integer not null default 0 check (row_count >= 0),
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists historical_archive_files_search on public.historical_archive_files using gin (to_tsvector('simple', search_text));
create index if not exists historical_archive_files_org_date on public.historical_archive_files(organization_id, uploaded_at desc);
alter table public.historical_archive_files enable row level security;
revoke all on public.historical_archive_files from public, anon, authenticated, service_role;
grant select, insert on public.historical_archive_files to service_role;

insert into storage.buckets (id, name, public)
values ('historical-archive', 'historical-archive', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
commit;
