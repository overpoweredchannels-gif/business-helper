-- TradeOS targeted production repair: persistent tenant-scoped roles and sales-order numbering.
-- Safe to run repeatedly in the Supabase SQL editor.

set check_function_bodies = off;

create table if not exists public.role_definitions (
  id text primary key,
  name text not null,
  description text,
  permissions jsonb not null default '[]'::jsonb,
  is_built_in boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.role_definitions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
create index if not exists role_definitions_org_idx on public.role_definitions(organization_id);
alter table public.role_definitions enable row level security;

create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_token text not null unique,
  device_name text not null,
  remember_device boolean not null default false,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists device_sessions_profile_idx on public.device_sessions(profile_id);
create index if not exists device_sessions_org_idx on public.device_sessions(organization_id);
create index if not exists device_sessions_token_idx on public.device_sessions(device_token);
alter table public.device_sessions enable row level security;

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.invoice_sequences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%invoice_type%'
  loop
    execute format('alter table public.invoice_sequences drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.invoice_sequences
  add constraint invoice_sequences_invoice_type_check
  check (invoice_type in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order'));

create or replace function public.next_invoice_number(
  p_organization_id uuid,
  p_invoice_type text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if p_organization_id is null then
    raise exception 'next_invoice_number: p_organization_id is required';
  end if;
  if p_invoice_type not in ('sales', 'purchase', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order') then
    raise exception 'next_invoice_number: unknown invoice_type "%"', p_invoice_type;
  end if;
  insert into public.invoice_sequences (organization_id, invoice_type, current_number, updated_at)
  values (p_organization_id, p_invoice_type, 1, now())
  on conflict (organization_id, invoice_type)
  do update set current_number = public.invoice_sequences.current_number + 1,
                updated_at = now()
  returning current_number into v_next;
  return v_next;
end;
$$;

grant execute on function public.next_invoice_number(uuid, text) to service_role;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;
