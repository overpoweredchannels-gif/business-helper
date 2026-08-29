-- TradeOS Phase 8: authoritative duty lifecycle and background tracking cutoff
--
-- Run this migration in the Supabase SQL editor before deploying the matching
-- web/mobile code. It is idempotent and schedules the cutoff worker every
-- minute through Supabase Cron.

create extension if not exists pg_cron;

do $$
begin
  if to_regclass('cron.job') is null then
    raise exception 'Supabase Cron is not enabled. Enable Integrations > Cron (pg_cron) in the Supabase Dashboard, then rerun this migration.';
  end if;
end;
$$;

alter table public.staff_duty_sessions
  add column if not exists attendance_record_id uuid references public.attendance_records(id) on delete set null,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists timezone_snapshot text,
  add column if not exists ended_reason text,
  add column if not exists device_name text,
  add column if not exists device_status text default 'unknown',
  add column if not exists last_location_at timestamptz,
  add column if not exists last_error text;

create index if not exists staff_duty_sessions_cutoff_idx
  on public.staff_duty_sessions (scheduled_end_at)
  where status = 'on_duty';

-- Older application versions could race between the active-session lookup and
-- insert. Keep the newest active row and safely close older duplicates before
-- enforcing the invariant in the database.
with ranked_active as (
  select
    id,
    row_number() over (
      partition by organization_id, profile_id
      order by started_at desc, created_at desc, id desc
    ) as row_number
  from public.staff_duty_sessions
  where status = 'on_duty'
)
update public.staff_duty_sessions as session
set
  status = 'off_duty',
  ended_at = coalesce(session.ended_at, now()),
  ended_reason = coalesce(session.ended_reason, 'duplicate_cleanup'),
  updated_at = now()
from ranked_active
where session.id = ranked_active.id
  and ranked_active.row_number > 1;

create unique index if not exists staff_duty_sessions_one_active_per_employee_idx
  on public.staff_duty_sessions (organization_id, profile_id)
  where status = 'on_duty';

create or replace function public.tradeos_duty_schedule(
  p_moment timestamptz,
  p_working_hours jsonb
)
returns table (
  local_date date,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  timezone_name text,
  is_working_day boolean
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_hours jsonb := coalesce(p_working_hours, '{}'::jsonb);
  v_timezone text := coalesce(nullif(p_working_hours->>'timezone', ''), 'Asia/Karachi');
  v_start_text text := coalesce(nullif(p_working_hours->>'duty_start', ''), '08:00');
  v_end_text text := coalesce(nullif(p_working_hours->>'duty_end', ''), '16:00');
  v_start_time time;
  v_end_time time;
  v_local_date date;
  v_dow integer;
  v_is_working_day boolean := true;
begin
  if v_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or v_end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Organization duty hours must use HH24:MI format';
  end if;

  -- This also validates the configured IANA timezone name.
  v_local_date := (p_moment at time zone v_timezone)::date;
  v_dow := extract(dow from (p_moment at time zone v_timezone))::integer;
  v_start_time := v_start_text::time;
  v_end_time := v_end_text::time;

  if jsonb_typeof(v_hours->'working_days') = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(v_hours->'working_days') as configured(day_number)
      where configured.day_number::integer = v_dow
    ) into v_is_working_day;
  end if;

  return query select
    v_local_date,
    (v_local_date + v_start_time) at time zone v_timezone,
    (v_local_date + v_end_time) at time zone v_timezone,
    v_timezone,
    v_is_working_day;
end;
$$;

create or replace function public.close_expired_duty_sessions(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session record;
  v_employee_id uuid;
  v_attendance_start timestamptz;
  v_closed integer := 0;
begin
  for v_session in
    update public.staff_duty_sessions
    set
      status = 'off_duty',
      ended_at = scheduled_end_at,
      ended_reason = 'automatic_cutoff',
      device_status = 'off_duty',
      updated_at = p_now
    where status = 'on_duty'
      and scheduled_end_at is not null
      and scheduled_end_at <= p_now
    returning *
  loop
    select id into v_employee_id
    from public.employees
    where organization_id = v_session.organization_id
      and profile_id = v_session.profile_id
    limit 1;

    if v_session.attendance_record_id is not null then
      select duty_start into v_attendance_start
      from public.attendance_records
      where id = v_session.attendance_record_id;

      update public.attendance_records
      set
        duty_end = v_session.scheduled_end_at,
        total_hours = round(
          greatest(
            extract(epoch from (v_session.scheduled_end_at - coalesce(v_attendance_start, v_session.started_at))) / 3600,
            0
          )::numeric,
          2
        ),
        updated_at = p_now
      where id = v_session.attendance_record_id;
    elsif v_employee_id is not null then
      update public.attendance_records
      set
        duty_end = v_session.scheduled_end_at,
        total_hours = round(
          greatest(
            extract(epoch from (v_session.scheduled_end_at - coalesce(duty_start, v_session.started_at))) / 3600,
            0
          )::numeric,
          2
        ),
        updated_at = p_now
      where organization_id = v_session.organization_id
        and employee_id = v_employee_id
        and date = (v_session.started_at at time zone coalesce(v_session.timezone_snapshot, 'Asia/Karachi'))::date
        and duty_end is null;
    end if;

    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$$;

create or replace function public.start_employee_duty(
  p_organization_id uuid,
  p_profile_id uuid,
  p_started_at timestamptz,
  p_start_latitude double precision default null,
  p_start_longitude double precision default null,
  p_start_accuracy double precision default null,
  p_device_name text default null
)
returns table (
  duty_session_id uuid,
  attendance_record_id uuid,
  started_at timestamptz,
  scheduled_end_at timestamptz,
  timezone_name text,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_working_hours jsonb;
  v_schedule record;
  v_employee_id uuid;
  v_existing_session public.staff_duty_sessions%rowtype;
  v_existing_attendance public.attendance_records%rowtype;
  v_attendance_id uuid;
  v_session_id uuid;
  v_late_minutes integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_profile_id::text));
  perform public.close_expired_duty_sessions(p_started_at);

  select working_hours into v_working_hours
  from public.organizations
  where id = p_organization_id;

  if not found then
    raise exception 'Organization not found';
  end if;

  select * into v_schedule
  from public.tradeos_duty_schedule(p_started_at, v_working_hours);

  if not v_schedule.is_working_day then
    raise exception 'Duty cannot start on a configured non-working day';
  end if;

  if p_started_at >= v_schedule.scheduled_end_at then
    raise exception 'Duty cannot start after today''s scheduled cutoff';
  end if;

  select id into v_employee_id
  from public.employees
  where organization_id = p_organization_id
    and profile_id = p_profile_id
    and is_active is not false
    and (status is null or status <> 'archived')
  limit 1;

  if v_employee_id is null then
    raise exception 'No active employee record is linked to this profile';
  end if;

  select * into v_existing_session
  from public.staff_duty_sessions
  where organization_id = p_organization_id
    and profile_id = p_profile_id
    and status = 'on_duty'
  order by staff_duty_sessions.started_at desc
  limit 1
  for update;

  if v_existing_session.id is not null then
    update public.staff_duty_sessions
    set
      scheduled_end_at = coalesce(v_existing_session.scheduled_end_at, v_schedule.scheduled_end_at),
      timezone_snapshot = coalesce(v_existing_session.timezone_snapshot, v_schedule.timezone_name),
      device_name = coalesce(p_device_name, v_existing_session.device_name),
      device_status = 'tracking',
      last_error = null,
      updated_at = p_started_at
    where id = v_existing_session.id;

    return query select
      v_existing_session.id,
      v_existing_session.attendance_record_id,
      v_existing_session.started_at,
      coalesce(v_existing_session.scheduled_end_at, v_schedule.scheduled_end_at),
      coalesce(v_existing_session.timezone_snapshot, v_schedule.timezone_name),
      false;
    return;
  end if;

  select * into v_existing_attendance
  from public.attendance_records
  where organization_id = p_organization_id
    and employee_id = v_employee_id
    and date = v_schedule.local_date
  for update;

  if v_existing_attendance.duty_end is not null then
    raise exception 'Duty has already ended today. A manager must correct or reopen attendance.';
  end if;

  v_late_minutes := greatest(
    floor(extract(epoch from (p_started_at - v_schedule.scheduled_start_at)) / 60)::integer,
    0
  );

  insert into public.attendance_records (
    organization_id,
    employee_id,
    date,
    status,
    duty_start,
    scheduled_start,
    scheduled_end,
    late_minutes,
    notes,
    updated_at
  ) values (
    p_organization_id,
    v_employee_id,
    v_schedule.local_date,
    case when v_late_minutes > 0 then 'late' else 'present' end,
    p_started_at,
    v_schedule.scheduled_start_at,
    v_schedule.scheduled_end_at,
    v_late_minutes,
    case
      when p_start_latitude is not null and p_start_longitude is not null
        then format('Duty start lat:%s, lng:%s', p_start_latitude, p_start_longitude)
      else null
    end,
    p_started_at
  )
  on conflict (organization_id, employee_id, date) do update
  set
    status = case when excluded.late_minutes > 0 then 'late' else 'present' end,
    duty_start = coalesce(public.attendance_records.duty_start, excluded.duty_start),
    scheduled_start = excluded.scheduled_start,
    scheduled_end = excluded.scheduled_end,
    late_minutes = excluded.late_minutes,
    notes = coalesce(public.attendance_records.notes, excluded.notes),
    updated_at = excluded.updated_at
  returning id into v_attendance_id;

  insert into public.staff_duty_sessions (
    organization_id,
    profile_id,
    status,
    started_at,
    start_latitude,
    start_longitude,
    start_accuracy,
    attendance_record_id,
    scheduled_end_at,
    timezone_snapshot,
    device_name,
    device_status,
    notes,
    updated_at
  ) values (
    p_organization_id,
    p_profile_id,
    'on_duty',
    p_started_at,
    p_start_latitude,
    p_start_longitude,
    p_start_accuracy,
    v_attendance_id,
    v_schedule.scheduled_end_at,
    v_schedule.timezone_name,
    p_device_name,
    'tracking',
    case when p_device_name is not null then 'Device: ' || p_device_name else null end,
    p_started_at
  )
  returning id into v_session_id;

  return query select
    v_session_id,
    v_attendance_id,
    p_started_at,
    v_schedule.scheduled_end_at,
    v_schedule.timezone_name,
    true;
end;
$$;

create or replace function public.stop_employee_duty(
  p_organization_id uuid,
  p_profile_id uuid,
  p_ended_at timestamptz,
  p_reason text default 'manual_stop'
)
returns table (
  duty_session_id uuid,
  attendance_record_id uuid,
  ended_at timestamptz,
  ended_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.staff_duty_sessions%rowtype;
  v_effective_end timestamptz;
  v_attendance_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_profile_id::text));
  perform public.close_expired_duty_sessions(p_ended_at);

  select * into v_session
  from public.staff_duty_sessions
  where organization_id = p_organization_id
    and profile_id = p_profile_id
    and status = 'on_duty'
  order by staff_duty_sessions.started_at desc
  limit 1
  for update;

  if v_session.id is null then
    return;
  end if;

  v_effective_end := greatest(
    v_session.started_at,
    least(p_ended_at, coalesce(v_session.scheduled_end_at, p_ended_at))
  );

  update public.staff_duty_sessions
  set
    status = 'off_duty',
    ended_at = v_effective_end,
    ended_reason = p_reason,
    device_status = 'off_duty',
    updated_at = p_ended_at
  where id = v_session.id;

  if v_session.attendance_record_id is not null then
    select duty_start into v_attendance_start
    from public.attendance_records
    where id = v_session.attendance_record_id;

    update public.attendance_records
    set
      duty_end = v_effective_end,
      early_exit_minutes = greatest(
        floor(extract(epoch from (coalesce(v_session.scheduled_end_at, v_effective_end) - v_effective_end)) / 60)::integer,
        0
      ),
      total_hours = round(
        greatest(
          extract(epoch from (v_effective_end - coalesce(v_attendance_start, v_session.started_at))) / 3600,
          0
        )::numeric,
        2
      ),
      updated_at = p_ended_at
    where id = v_session.attendance_record_id;
  end if;

  return query select
    v_session.id,
    v_session.attendance_record_id,
    v_effective_end,
    p_reason;
end;
$$;

-- Backfill the cutoff for any active sessions created before this migration.
with computed_schedule as (
  select
    session.id,
    schedule.scheduled_end_at,
    schedule.timezone_name
  from public.staff_duty_sessions as session
  join public.organizations as organization
    on organization.id = session.organization_id
  cross join lateral public.tradeos_duty_schedule(session.started_at, organization.working_hours) as schedule
  where session.status = 'on_duty'
    and session.scheduled_end_at is null
)
update public.staff_duty_sessions as session
set
  scheduled_end_at = computed_schedule.scheduled_end_at,
  timezone_snapshot = computed_schedule.timezone_name,
  updated_at = now()
from computed_schedule
where session.id = computed_schedule.id;

select public.close_expired_duty_sessions(now());

revoke all on function public.tradeos_duty_schedule(timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.close_expired_duty_sessions(timestamptz) from public, anon, authenticated;
revoke all on function public.start_employee_duty(uuid, uuid, timestamptz, double precision, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.stop_employee_duty(uuid, uuid, timestamptz, text) from public, anon, authenticated;

grant execute on function public.tradeos_duty_schedule(timestamptz, jsonb) to service_role;
grant execute on function public.close_expired_duty_sessions(timestamptz) to service_role;
grant execute on function public.start_employee_duty(uuid, uuid, timestamptz, double precision, double precision, double precision, text) to service_role;
grant execute on function public.stop_employee_duty(uuid, uuid, timestamptz, text) to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'tradeos-close-expired-duty-sessions';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'tradeos-close-expired-duty-sessions',
    '* * * * *',
    'select public.close_expired_duty_sessions(now());'
  );
end;
$$;

select
  case
    when exists (select 1 from cron.job where jobname = 'tradeos-close-expired-duty-sessions')
      then 'PHASE 8 DUTY TRACKING OK — automatic cutoff job installed'
    else 'PHASE 8 DUTY TRACKING ERROR — cutoff job missing'
  end as result;
