-- ===========================================================================
-- PRODUCTION PHASE 5C — FSM CORE: VISITS, TARGETS, ATTENDANCE, WORKING HOURS
--
--   Part A — customer_visits: GPS-verified visit lifecycle
--   Part B — sales_targets: daily/weekly/monthly targets by metric
--   Part C — organizations.working_hours: org-level duty config
--   Part D — attendance_records: auto-calculated daily attendance
--   Part E — collections: cash/cheque/bank transfer recording + approval
--   Part F — customer_feedback: post-visit complaints/feedback/follow-up
--   Part G — RLS policies for all new tables
--   Part H — verification
--
-- Idempotent. Run AFTER production_phase5b_staff_routes.sql.
-- ===========================================================================

-- ===========================================================================
-- PART A — CUSTOMER VISITS
-- ===========================================================================

create table if not exists public.customer_visits (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  route_id uuid references public.sales_routes(id) on delete set null,
  stop_id uuid references public.sales_route_stops(id) on delete set null,
  visit_status text not null default 'planned',
  started_at timestamptz,
  ended_at timestamptz,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  notes text,
  images jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visit_status in ('planned', 'in_progress', 'completed', 'missed', 'cancelled'))
);

create index if not exists customer_visits_org_idx on public.customer_visits (organization_id);
create index if not exists customer_visits_org_employee_idx on public.customer_visits (organization_id, employee_id);
create index if not exists customer_visits_org_customer_idx on public.customer_visits (organization_id, customer_id);
create index if not exists customer_visits_org_date_idx on public.customer_visits (organization_id, created_at desc);
create index if not exists customer_visits_org_status_idx on public.customer_visits (organization_id, visit_status);
create index if not exists customer_visits_route_idx on public.customer_visits (route_id);
create index if not exists customer_visits_stop_idx on public.customer_visits (stop_id);

-- ===========================================================================
-- PART B — SALES TARGETS
-- ===========================================================================

create table if not exists public.sales_targets (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  period text not null,
  metric text not null,
  target_value numeric not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period in ('daily', 'weekly', 'monthly')),
  check (metric in ('revenue', 'orders', 'customers', 'products', 'collections')),
  unique (organization_id, employee_id, period, metric, start_date)
);

create index if not exists sales_targets_org_idx on public.sales_targets (organization_id);
create index if not exists sales_targets_org_employee_idx on public.sales_targets (organization_id, employee_id);
create index if not exists sales_targets_org_period_idx on public.sales_targets (organization_id, period, start_date, end_date);

-- ===========================================================================
-- PART C — ORGANIZATIONS WORKING HOURS
-- ===========================================================================

alter table public.organizations
  add column if not exists working_hours jsonb default '{
    "duty_start": "08:00",
    "duty_end": "16:00",
    "working_days": [1,2,3,4,5,6],
    "weekly_off": 0,
    "timezone": "Asia/Karachi"
  }'::jsonb;

-- ===========================================================================
-- PART D — ATTENDANCE RECORDS
-- ===========================================================================

create table if not exists public.attendance_records (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  status text not null,
  duty_start timestamptz,
  duty_end timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  late_minutes integer default 0,
  early_exit_minutes integer default 0,
  total_hours numeric(5,2) default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('present', 'absent', 'late', 'half_day', 'leave', 'holiday')),
  unique (organization_id, employee_id, date)
);

create index if not exists attendance_records_org_idx on public.attendance_records (organization_id);
create index if not exists attendance_records_org_employee_idx on public.attendance_records (organization_id, employee_id);
create index if not exists attendance_records_org_date_idx on public.attendance_records (organization_id, date desc);
create index if not exists attendance_records_org_status_idx on public.attendance_records (organization_id, status);

-- ===========================================================================
-- PART E — COLLECTIONS
-- ===========================================================================

create table if not exists public.collections (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  visit_id uuid references public.customer_visits(id) on delete set null,
  amount numeric not null,
  method text not null,
  reference_number text,
  cheque_date date,
  cheque_bank text,
  bank_transfer_ref text,
  status text not null default 'pending',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  notes text,
  images jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method in ('cash', 'cheque', 'bank_transfer')),
  check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists collections_org_idx on public.collections (organization_id);
create index if not exists collections_org_employee_idx on public.collections (organization_id, employee_id);
create index if not exists collections_org_customer_idx on public.collections (organization_id, customer_id);
create index if not exists collections_org_status_idx on public.collections (organization_id, status);
create index if not exists collections_visit_idx on public.collections (visit_id);

-- ===========================================================================
-- PART F — CUSTOMER FEEDBACK
-- ===========================================================================

create table if not exists public.customer_feedback (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  visit_id uuid references public.customer_visits(id) on delete set null,
  type text not null,
  title text,
  description text,
  priority text not null default 'medium',
  status text not null default 'open',
  follow_up_date date,
  images jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type in ('complaint', 'feedback', 'note', 'request')),
  check (priority in ('high', 'medium', 'low')),
  check (status in ('open', 'in_progress', 'resolved', 'closed'))
);

create index if not exists customer_feedback_org_idx on public.customer_feedback (organization_id);
create index if not exists customer_feedback_org_employee_idx on public.customer_feedback (organization_id, employee_id);
create index if not exists customer_feedback_org_customer_idx on public.customer_feedback (organization_id, customer_id);
create index if not exists customer_feedback_org_status_idx on public.customer_feedback (organization_id, status);
create index if not exists customer_feedback_visit_idx on public.customer_feedback (visit_id);

-- ===========================================================================
-- PART G — RLS POLICIES
-- ===========================================================================

-- customer_visits
alter table public.customer_visits enable row level security;
drop policy if exists customer_visits_select_org on public.customer_visits;
create policy customer_visits_select_org on public.customer_visits
  for select using (organization_id = current_org_id());
drop policy if exists customer_visits_insert_org on public.customer_visits;
create policy customer_visits_insert_org on public.customer_visits
  for insert with check (organization_id = current_org_id());
drop policy if exists customer_visits_update_org on public.customer_visits;
create policy customer_visits_update_org on public.customer_visits
  for update using (organization_id = current_org_id());
drop policy if exists customer_visits_delete_org on public.customer_visits;
create policy customer_visits_delete_org on public.customer_visits
  for delete using (organization_id = current_org_id());

-- sales_targets
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_select_org on public.sales_targets;
create policy sales_targets_select_org on public.sales_targets
  for select using (organization_id = current_org_id());
drop policy if exists sales_targets_insert_org on public.sales_targets;
create policy sales_targets_insert_org on public.sales_targets
  for insert with check (organization_id = current_org_id());
drop policy if exists sales_targets_update_org on public.sales_targets;
create policy sales_targets_update_org on public.sales_targets
  for update using (organization_id = current_org_id());
drop policy if exists sales_targets_delete_org on public.sales_targets;
create policy sales_targets_delete_org on public.sales_targets
  for delete using (organization_id = current_org_id());

-- attendance_records
alter table public.attendance_records enable row level security;
drop policy if exists attendance_records_select_org on public.attendance_records;
create policy attendance_records_select_org on public.attendance_records
  for select using (organization_id = current_org_id());
drop policy if exists attendance_records_insert_org on public.attendance_records;
create policy attendance_records_insert_org on public.attendance_records
  for insert with check (organization_id = current_org_id());
drop policy if exists attendance_records_update_org on public.attendance_records;
create policy attendance_records_update_org on public.attendance_records
  for update using (organization_id = current_org_id());
drop policy if exists attendance_records_delete_org on public.attendance_records;
create policy attendance_records_delete_org on public.attendance_records
  for delete using (organization_id = current_org_id());

-- collections
alter table public.collections enable row level security;
drop policy if exists collections_select_org on public.collections;
create policy collections_select_org on public.collections
  for select using (
    organization_id = current_org_id()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
      or employee_id in (
        select id from public.employees where profile_id = auth.uid()
      )
    )
  );
drop policy if exists collections_insert_org on public.collections;
create policy collections_insert_org on public.collections
  for insert with check (
    organization_id = current_org_id()
    and employee_id in (
      select id from public.employees where profile_id = auth.uid()
    )
  );
drop policy if exists collections_update_org on public.collections;
create policy collections_update_org on public.collections
  for update using (
    organization_id = current_org_id()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
      or employee_id in (
        select id from public.employees where profile_id = auth.uid()
      )
    )
  );
drop policy if exists collections_delete_org on public.collections;
create policy collections_delete_org on public.collections
  for delete using (
    organization_id = current_org_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.organization_id = current_org_id()
        and p.role = 'owner'
    )
  );

-- customer_feedback
alter table public.customer_feedback enable row level security;
drop policy if exists customer_feedback_select_org on public.customer_feedback;
create policy customer_feedback_select_org on public.customer_feedback
  for select using (organization_id = current_org_id());
drop policy if exists customer_feedback_insert_org on public.customer_feedback;
create policy customer_feedback_insert_org on public.customer_feedback
  for insert with check (
    organization_id = current_org_id()
    and employee_id in (
      select id from public.employees where profile_id = auth.uid()
    )
  );
drop policy if exists customer_feedback_update_org on public.customer_feedback;
create policy customer_feedback_update_org on public.customer_feedback
  for update using (organization_id = current_org_id());
drop policy if exists customer_feedback_delete_org on public.customer_feedback;
create policy customer_feedback_delete_org on public.customer_feedback
  for delete using (
    organization_id = current_org_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.organization_id = current_org_id()
        and p.role = 'owner'
    )
  );

-- ===========================================================================
-- PART H — VERIFICATION
-- ===========================================================================

with missing_items as (
  select 'table customer_visits' as item
  where to_regclass('public.customer_visits') is null
  union all
  select 'table sales_targets' where to_regclass('public.sales_targets') is null
  union all
  select 'table attendance_records' where to_regclass('public.attendance_records') is null
  union all
  select 'table collections' where to_regclass('public.collections') is null
  union all
  select 'table customer_feedback' where to_regclass('public.customer_feedback') is null
  union all
  select 'organizations.working_hours' where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'working_hours'
  )
  union all
  select 'customer_visits.visit_status check' where not exists (
    select 1 from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
    where ccu.table_name = 'customer_visits' and cc.check_clause like '%visit_status%'
  )
)
select case
  when count(*) = 0 then 'PHASE 5C FSM CORE OK — visits, targets, attendance, working_hours, collections, feedback all present'
  else 'PHASE 5C FSM CORE FAILED — missing: ' || string_agg(item, ', ')
end as result
from missing_items;