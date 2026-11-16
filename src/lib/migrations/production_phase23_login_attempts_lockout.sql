-- production_phase23_login_attempts_lockout.sql
--
-- Brute-force lockout (P0-7, approved by UMAIR 2026-11-16).
-- Dedicated login_attempts table: 5 failed sign-in attempts lock that
-- identifier for 15 minutes, per-email (so other staff on a shared shop IP
-- are NOT blocked). The lock auto-expires after 15 minutes; the owner can
-- also unlock manually from the Staff / Security Check screen.
--
-- ADDITIVE ONLY. Idempotent: safe to re-run. Transaction-wrapped.
-- UMAIR runs this on production himself in the Supabase SQL Editor.
-- The application code FAILS OPEN when this table / function is absent:
-- a missing table must never block sign-in.
--
-- Key semantics (see src/lib/identity/login-lockout.ts):
-- * The key is the normalized login identifier: the resolved staff email
--   (lowercased) when the Profile ID resolves to an account, otherwise the
--   entered Profile ID (lowercased). Hidden staff emails contain
--   "@staff.tradeos.internal" so a bare Profile ID (e.g. MU04) can never
--   collide with an email key.
-- * record_login_attempt() is atomic: if a previous lock has expired, the
--   count restarts at 1; otherwise it increments; at 5 it sets
--   locked_until = now() + 15 minutes. A further failure while already
--   locked does NOT extend the lock: it still expires 15 minutes after
--   it was first set, so the auto-unlock time is fixed.
-- * A successful login DELETEs the row (attempt count cleared).
-- * RLS is enabled with NO policies: only the service-role key (which the
--   server routes use) can read/write this table.

begin;

create table if not exists public.login_attempts (
  email text primary key,
  organization_id uuid null,
  failed_attempts integer not null default 0,
  locked_until timestamptz null,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Locked-row lookups for the owner unlock panel (per org, currently locked).
create index if not exists login_attempts_locked_idx
  on public.login_attempts (organization_id, locked_until)
  where locked_until is not null;

alter table public.login_attempts enable row level security;

-- Atomic record-a-failed-attempt. Returns the row after the update so the
-- caller knows whether the lock just engaged. If a previous lock has
-- expired, the count restarts at 1 instead of accumulating forever.
create or replace function public.record_login_attempt(
  p_email text,
  p_organization_id uuid default null
)
returns table (
  email text,
  failed_attempts integer,
  locked_until timestamptz,
  last_attempt_at timestamptz
)
language plpgsql
as $$
declare
  v_attempts integer;
  v_locked_until timestamptz;
begin
  insert into public.login_attempts (email, organization_id, failed_attempts, locked_until, last_attempt_at)
  values (lower(trim(p_email)), p_organization_id, 1, null, now())
  on conflict (email) do update
    set organization_id = coalesce(public.login_attempts.organization_id, excluded.organization_id),
        failed_attempts = case
          when public.login_attempts.locked_until is not null
               and public.login_attempts.locked_until <= now() then 1
          else public.login_attempts.failed_attempts + 1
        end,
        locked_until = case
          when public.login_attempts.locked_until is not null
               and public.login_attempts.locked_until <= now() then null
          when public.login_attempts.locked_until is not null
               and public.login_attempts.locked_until > now() then public.login_attempts.locked_until
          when public.login_attempts.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else public.login_attempts.locked_until
        end,
        last_attempt_at = now(),
        updated_at = now()
  returning public.login_attempts.failed_attempts, public.login_attempts.locked_until
    into v_attempts, v_locked_until;

  return query
    select la.email, la.failed_attempts, la.locked_until, la.last_attempt_at
    from public.login_attempts la
    where la.email = lower(trim(p_email));
end;
$$;

commit;

-- Verification block: raises if anything is missing (run output shows
-- "Success. No rows returned" when all checks pass, same as phase 22).
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'login_attempts'
  ) then
    raise exception 'login_attempts table missing after phase 23 migration';
  end if;
  if not exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'record_login_attempt'
  ) then
    raise exception 'record_login_attempt function missing after phase 23 migration';
  end if;
end
$$;
