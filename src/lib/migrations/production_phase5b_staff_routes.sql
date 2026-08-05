-- ===========================================================================
-- PRODUCTION PHASE 5B — STAFF SELF-ONBOARDING + CUSTOM ROUTE STOPS
--
--   Part A — employees: Profile ID (login_id), hidden email, invite code/status
--   Part B — profiles: login_id + phone (Profile ID + Password login, no email)
--   Part C — sales_route_stops: nullable customer + custom stops (label, lat/lng)
--   Part D — sales_routes: assigned_salesman_id
--   Part E — verification (plain SQL)
--
-- Idempotent. Run AFTER production_phase5_fsm.sql in the Supabase SQL editor.
-- ===========================================================================

-- ===========================================================================
-- PART A — EMPLOYEES: PROFILE ID + INVITE STATE
-- ===========================================================================

alter table public.employees
  add column if not exists login_id text;

alter table public.employees
  add column if not exists hidden_email text;

alter table public.employees
  add column if not exists invite_code text;

alter table public.employees
  add column if not exists invite_status text not null default 'none';

alter table public.employees
  add column if not exists invite_expires_at timestamptz;

alter table public.employees
  drop constraint if exists employees_invite_status_check;
alter table public.employees
  add constraint employees_invite_status_check
  check (invite_status in ('none', 'pending', 'accepted', 'revoked', 'expired'));

create unique index if not exists employees_org_login_id_uidx
  on public.employees (organization_id, login_id);

create unique index if not exists employees_invite_code_uidx
  on public.employees (invite_code) where invite_code is not null;

-- ===========================================================================
-- PART B — PROFILES: LOGIN ID + PHONE (Profile ID + Password login)
-- ===========================================================================

alter table public.profiles
  add column if not exists login_id text;

alter table public.profiles
  add column if not exists phone text;

create unique index if not exists profiles_login_id_uidx
  on public.profiles (login_id) where login_id is not null;

-- ===========================================================================
-- PART C — SALES ROUTE STOPS: CUSTOM STOPS WITH COORDINATES
-- ===========================================================================

alter table public.sales_route_stops
  alter column customer_id drop not null;

alter table public.sales_route_stops
  add column if not exists label text;

alter table public.sales_route_stops
  add column if not exists latitude double precision;

alter table public.sales_route_stops
  add column if not exists longitude double precision;

alter table public.sales_route_stops
  add column if not exists address text;

alter table public.sales_route_stops
  drop constraint if exists sales_route_stops_route_customer_uidx;

alter table public.sales_route_stops
  drop constraint if exists sales_route_stops_customer_id_key;

-- ===========================================================================
-- PART D — SALES ROUTES: ASSIGNED SALESMAN
-- ===========================================================================

alter table public.sales_routes
  add column if not exists assigned_salesman_id uuid references public.employees(id) on delete set null;

create index if not exists sales_routes_org_salesman_idx
  on public.sales_routes (organization_id, assigned_salesman_id);

-- ===========================================================================
-- PART E — VERIFICATION
-- ===========================================================================

with missing_items as (
  select 'employees.login_id' as item
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'login_id'
  )
  union all
  select 'employees.invite_code'
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'invite_code'
  )
  union all
  select 'profiles.login_id'
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'login_id'
  )
  union all
  select 'profiles.phone'
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'phone'
  )
  union all
  select 'sales_route_stops.latitude'
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_route_stops'
      and column_name = 'latitude'
  )
  union all
  select 'sales_route_stops.customer_id nullable'
  where exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_route_stops'
      and column_name = 'customer_id' and is_nullable = 'NO'
  )
  union all
  select 'sales_routes.assigned_salesman_id'
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_routes'
      and column_name = 'assigned_salesman_id'
  )
)
select case
  when count(*) = 0 then 'PHASE 5B OK - staff onboarding + custom route stops ready'
  else 'PHASE 5B FAILED - missing: ' || string_agg(item, ', ')
end as result
from missing_items;
