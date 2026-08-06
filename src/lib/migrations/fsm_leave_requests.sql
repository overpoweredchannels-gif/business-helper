-- ===========================================================================
-- LEAVE REQUESTS MODULE (Module 7)
-- Field staff request leave; supervisor/owner approve or reject.
-- ===========================================================================

create table if not exists public.leave_requests (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null default 'annual',
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (leave_type in ('annual', 'sick', 'casual', 'unpaid', 'other')),
  check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

create index if not exists leave_requests_org_idx on public.leave_requests (organization_id);
create index if not exists leave_requests_org_employee_idx on public.leave_requests (organization_id, employee_id);
create index if not exists leave_requests_org_status_idx on public.leave_requests (organization_id, status);

alter table public.leave_requests enable row level security;

drop policy if exists leave_requests_select_org on public.leave_requests;
create policy leave_requests_select_org on public.leave_requests
  for select using (organization_id in (
    select organization_id from public.profiles where id = auth.uid()
  ));

drop policy if exists leave_requests_insert_org on public.leave_requests;
create policy leave_requests_insert_org on public.leave_requests
  for insert with check (organization_id in (
    select organization_id from public.profiles where id = auth.uid()
  ));

drop policy if exists leave_requests_update_org on public.leave_requests;
create policy leave_requests_update_org on public.leave_requests
  for update using (organization_id in (
    select organization_id from public.profiles where id = auth.uid()
  ));