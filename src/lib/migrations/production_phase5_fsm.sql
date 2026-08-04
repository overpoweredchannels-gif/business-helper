-- ===========================================================================
-- PRODUCTION PHASE 5 — FIELD SALES MANAGEMENT (FSM) — FOUNDATION + ACCESS
--
--   Part A  — employees: rich HR profile (designation, supervisor, photo,
--             emergency contact) + territories + sales_routes + route stops
--   Part B  — customers: FSM assignment columns (assigned_salesman_id,
--             assigned_territory_id, visit_frequency, priority, lat/lng)
--   Part C  — notifications: in-app notification center + provider-agnostic
--             channel metadata (in_app now, push/whatsapp/email/sms later)
--   Part D  — role_invitations: add employee metadata + confirmation wiring
--   Part E  — RLS policies for every new table (org-scoped,
--             current_org_id()-based, mirroring sales/purchase tables)
--   Part F  — post-apply verification (PASS/FAIL)
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Run AFTER production_upgrade_consolidated.sql and
-- production_phase4_sales.sql.
-- ===========================================================================

-- ===========================================================================
-- PART A — EMPLOYEES, TERRITORIES, ROUTES
-- ===========================================================================

create table if not exists public.territories (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists territories_org_idx on public.territories (organization_id);

create table if not exists public.sales_routes (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  territory_id uuid references public.territories(id) on delete set null,
  description text,
  route_frequency text not null default 'daily',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists sales_routes_org_idx on public.sales_routes (organization_id);
create index if not exists sales_routes_org_territory_idx on public.sales_routes (organization_id, territory_id);

alter table public.sales_routes
  drop constraint if exists sales_routes_route_frequency_check;
alter table public.sales_routes
  add constraint sales_routes_route_frequency_check
  check (route_frequency in ('daily', 'weekly', 'monthly'));

create table if not exists public.employees (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_id text,
  full_name text not null,
  phone text,
  cnic text,
  email text,
  designation text not null default 'salesman',
  department text,
  joining_date date,
  status text not null default 'active',
  assigned_supervisor_id uuid references public.employees(id) on delete set null,
  assigned_territory_id uuid references public.territories(id) on delete set null,
  assigned_route_id uuid references public.sales_routes(id) on delete set null,
  photo_url text,
  emergency_contact jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id)
);

create index if not exists employees_org_idx on public.employees (organization_id);
create index if not exists employees_org_designation_idx on public.employees (organization_id, designation);
create index if not exists employees_org_status_idx on public.employees (organization_id, status);
create index if not exists employees_profile_idx on public.employees (profile_id);
create index if not exists employees_supervisor_idx on public.employees (assigned_supervisor_id);

alter table public.employees
  drop constraint if exists employees_status_check;
alter table public.employees
  add constraint employees_status_check
  check (status in ('active', 'inactive', 'archived'));

create table if not exists public.sales_route_stops (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null references public.sales_routes(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  stop_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (route_id, customer_id)
);

create index if not exists sales_route_stops_org_idx on public.sales_route_stops (organization_id);
create index if not exists sales_route_stops_route_idx on public.sales_route_stops (route_id);
create index if not exists sales_route_stops_customer_idx on public.sales_route_stops (customer_id);

-- ===========================================================================
-- PART B — CUSTOMER FSM ASSIGNMENT COLUMNS
-- ===========================================================================

alter table public.customers
  add column if not exists assigned_salesman_id uuid references public.employees(id) on delete set null;

alter table public.customers
  add column if not exists assigned_territory_id uuid references public.territories(id) on delete set null;

alter table public.customers
  add column if not exists visit_frequency text not null default 'weekly';

alter table public.customers
  add column if not exists priority text not null default 'medium';

alter table public.customers
  add column if not exists latitude double precision;

alter table public.customers
  add column if not exists longitude double precision;

alter table public.customers
  drop constraint if exists customers_visit_frequency_check;
alter table public.customers
  add constraint customers_visit_frequency_check
  check (visit_frequency in ('daily', 'weekly', 'monthly', 'none'));

alter table public.customers
  drop constraint if exists customers_priority_check;
alter table public.customers
  add constraint customers_priority_check
  check (priority in ('high', 'medium', 'low'));

create index if not exists customers_org_salesman_idx on public.customers (organization_id, assigned_salesman_id);
create index if not exists customers_org_territory_idx on public.customers (organization_id, assigned_territory_id);
create index if not exists customers_org_visit_frequency_idx on public.customers (organization_id, visit_frequency);

-- ===========================================================================
-- PART C — NOTIFICATIONS
-- ===========================================================================

create table if not exists public.notifications (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id text,
  channel text not null default 'in_app',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists notifications_org_idx on public.notifications (organization_id);
create index if not exists notifications_recipient_idx on public.notifications (recipient_profile_id, is_read, created_at desc);
create index if not exists notifications_org_recipient_idx on public.notifications (organization_id, recipient_profile_id, created_at desc);

alter table public.notifications
  drop constraint if exists notifications_category_check;
alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'draft_sale', 'approval', 'target', 'route', 'duty',
    'off_route', 'missed_customer', 'inventory', 'attendance', 'leave',
    'collection', 'general'
  ));

-- ===========================================================================
-- PART D — ROLE INVITATIONS: EMPLOYEE METADATA + CONFIRMED LINK
-- ===========================================================================

alter table public.role_invitations
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

alter table public.role_invitations
  add column if not exists full_name text;

alter table public.role_invitations
  add column if not exists phone text;

alter table public.role_invitations
  add column if not exists designation text;

alter table public.role_invitations
  add column if not exists status text not null default 'pending';

alter table public.role_invitations
  drop constraint if exists role_invitations_status_check;
alter table public.role_invitations
  add constraint role_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'expired'));

-- ===========================================================================
-- PART E — RLS POLICIES
-- ===========================================================================

-- employees
alter table public.employees enable row level security;
drop policy if exists employees_select_org on public.employees;
create policy employees_select_org on public.employees
  for select using (organization_id = current_org_id());
drop policy if exists employees_insert_org on public.employees;
create policy employees_insert_org on public.employees
  for insert with check (organization_id = current_org_id());
drop policy if exists employees_update_org on public.employees;
create policy employees_update_org on public.employees
  for update using (organization_id = current_org_id());
drop policy if exists employees_delete_org on public.employees;
create policy employees_delete_org on public.employees
  for delete using (organization_id = current_org_id());

-- territories
alter table public.territories enable row level security;
drop policy if exists territories_select_org on public.territories;
create policy territories_select_org on public.territories
  for select using (organization_id = current_org_id());
drop policy if exists territories_insert_org on public.territories;
create policy territories_insert_org on public.territories
  for insert with check (organization_id = current_org_id());
drop policy if exists territories_update_org on public.territories;
create policy territories_update_org on public.territories
  for update using (organization_id = current_org_id());
drop policy if exists territories_delete_org on public.territories;
create policy territories_delete_org on public.territories
  for delete using (organization_id = current_org_id());

-- sales_routes
alter table public.sales_routes enable row level security;
drop policy if exists sales_routes_select_org on public.sales_routes;
create policy sales_routes_select_org on public.sales_routes
  for select using (organization_id = current_org_id());
drop policy if exists sales_routes_insert_org on public.sales_routes;
create policy sales_routes_insert_org on public.sales_routes
  for insert with check (organization_id = current_org_id());
drop policy if exists sales_routes_update_org on public.sales_routes;
create policy sales_routes_update_org on public.sales_routes
  for update using (organization_id = current_org_id());
drop policy if exists sales_routes_delete_org on public.sales_routes;
create policy sales_routes_delete_org on public.sales_routes
  for delete using (organization_id = current_org_id());

-- sales_route_stops (parent-based)
alter table public.sales_route_stops enable row level security;
drop policy if exists sales_route_stops_select_org on public.sales_route_stops;
create policy sales_route_stops_select_org on public.sales_route_stops
  for select using (
    exists (
      select 1 from public.sales_routes r
      where r.id = sales_route_stops.route_id
        and r.organization_id = current_org_id()
    )
  );
drop policy if exists sales_route_stops_insert_org on public.sales_route_stops;
create policy sales_route_stops_insert_org on public.sales_route_stops
  for insert with check (
    exists (
      select 1 from public.sales_routes r
      where r.id = sales_route_stops.route_id
        and r.organization_id = current_org_id()
    )
  );
drop policy if exists sales_route_stops_update_org on public.sales_route_stops;
create policy sales_route_stops_update_org on public.sales_route_stops
  for update using (
    exists (
      select 1 from public.sales_routes r
      where r.id = sales_route_stops.route_id
        and r.organization_id = current_org_id()
    )
  );
drop policy if exists sales_route_stops_delete_org on public.sales_route_stops;
create policy sales_route_stops_delete_org on public.sales_route_stops
  for delete using (
    exists (
      select 1 from public.sales_routes r
      where r.id = sales_route_stops.route_id
        and r.organization_id = current_org_id()
    )
  );

-- notifications (recipient-scoped: users read/write their own; owner sees org)
alter table public.notifications enable row level security;
drop policy if exists notifications_select_org on public.notifications;
create policy notifications_select_org on public.notifications
  for select using (
    organization_id = current_org_id()
    and (
      recipient_profile_id = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
    )
  );
drop policy if exists notifications_insert_org on public.notifications;
create policy notifications_insert_org on public.notifications
  for insert with check (
    organization_id = current_org_id()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
      or recipient_profile_id = auth.uid()
    )
  );
drop policy if exists notifications_update_org on public.notifications;
create policy notifications_update_org on public.notifications
  for update using (
    organization_id = current_org_id()
    and (
      recipient_profile_id = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
    )
  );
drop policy if exists notifications_delete_org on public.notifications;
create policy notifications_delete_org on public.notifications
  for delete using (
    organization_id = current_org_id()
    and (
      recipient_profile_id = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = current_org_id()
          and p.role = 'owner'
      )
    )
  );

-- ===========================================================================
-- PART F — POST-APPLY VERIFICATION
-- ===========================================================================

do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.employees') is null then v_missing := v_missing || 'table employees'; end if;
  if to_regclass('public.territories') is null then v_missing := v_missing || 'table territories'; end if;
  if to_regclass('public.sales_routes') is null then v_missing := v_missing || 'table sales_routes'; end if;
  if to_regclass('public.sales_route_stops') is null then v_missing := v_missing || 'table sales_route_stops'; end if;
  if to_regclass('public.notifications') is null then v_missing := v_missing || 'table notifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'assigned_salesman_id'
  ) then v_missing := v_missing || 'customers.assigned_salesman_id'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'visit_frequency'
  ) then v_missing := v_missing || 'customers.visit_frequency'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_invitations'
      and column_name = 'employee_id'
  ) then v_missing := v_missing || 'role_invitations.employee_id'; end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'PHASE 5 FSM FAILED — missing: %', array_to_string(v_missing, ', ');
  else
    raise notice 'PHASE 5 FSM OK — employees, territories, routes, notifications, customer FSM columns all present';
  end if;
end $$;
