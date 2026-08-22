-- TradeOS Identity, Authentication, Roles & Permissions
-- This file documents the tables used by the identity system.
-- The in-memory identity modules (src/lib/identity/*) work standalone;
-- the API routes bridge to Supabase Auth + these tables where available.

-- ---------------------------------------------------------------------------
-- Existing tables (already in the database) reused by the identity system:
--
--   auth.users                  Supabase-managed user accounts (email, password)
--   profiles                    id, organization_id, auth_user_id, email,
--                               display_name, role (free-text role id),
--                               is_active, created_at, updated_at
--   staff_permissions           per-profile legacy boolean permissions plus
--                               granted_sections text[] (SectionId grants)
--   audit_logs                  organization_id, actor_profile_id, actor_email,
--                               action, entity_type, entity_id, entity_label,
--                               description, old_values, new_values, created_at

-- ---------------------------------------------------------------------------
-- Recommended new tables (run in Supabase SQL editor when ready):

-- Role library (persists built-in + custom roles)
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

-- Invitations (code-based onboarding)
create table if not exists public.role_invitations (
  code text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text
);

create index if not exists role_invitations_org_idx on public.role_invitations(organization_id);
create index if not exists role_invitations_email_idx on public.role_invitations(email);

-- Session registry (device sessions, revocation, remember-device)
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

-- Password reset tokens
create table if not exists public.password_reset_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Role -> legacy permission mapping (used by /api/identity/invitations/accept)
--   owner            -> all 11 legacy permissions
--   manager          -> all except can_manage_settings
--   salesman         -> can_create_sales, can_manage_customers
--   purchase_officer -> can_create_purchases, can_manage_suppliers
--   warehouse_staff  -> can_manage_products, can_view_reports
--   viewer           -> can_view_reports, can_view_profit
-- Custom roles map through src/lib/identity/legacy.ts.
