-- REVIEW ONLY. Separate from the approved profile authorization release.
-- This enables language/locale/timezone preferences, NOT non-PKR accounting.
-- No profile, financial record, grant, existing policy or existing function changes.
begin;
do $$ begin
  if not exists(select 1 from public.pos_release_test_marker where marker='disposable-pos-atomic-sales')
     or current_setting('tradeos.regional_project_ref',true) is distinct from 'rtfowunsyrdygyvubnvs'
  then raise exception 'Verified disposable connection and explicit project context required'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='organizations' and column_name='regional_preferences') then
    raise exception 'Regional preferences already exist: inspect drift, do not reapply';
  end if;
end $$;

alter table public.organizations add column regional_preferences jsonb not null
  default '{"language":"en","locale":"en-PK","timeZone":"Asia/Karachi","accountingCurrency":"PKR"}'::jsonb;

create function public.validate_regional_preferences_qa() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='UPDATE' and new.regional_preferences is not distinct from old.regional_preferences then return new; end if;
  if jsonb_typeof(new.regional_preferences)<>'object'
     or (new.regional_preferences - array['language','locale','timeZone','accountingCurrency'])<>'{}'::jsonb
     or not (new.regional_preferences ?& array['language','locale','timeZone','accountingCurrency'])
     or jsonb_typeof(new.regional_preferences->'language')<>'string'
     or jsonb_typeof(new.regional_preferences->'locale')<>'string'
     or jsonb_typeof(new.regional_preferences->'timeZone')<>'string'
     or new.regional_preferences->>'language' not in ('en','es','it','ur')
     or new.regional_preferences->>'locale' not in ('en-PK','en-US','en-GB','es-ES','it-IT','ur-PK')
     or new.regional_preferences->>'accountingCurrency' is distinct from 'PKR'
     or not exists(select 1 from pg_timezone_names where name=new.regional_preferences->>'timeZone')
  then raise exception 'Invalid regional preferences or accounting currency is locked'; end if;
  if TG_OP='INSERT' and new.regional_preferences='{"language":"en","locale":"en-PK","timeZone":"Asia/Karachi","accountingCurrency":"PKR"}'::jsonb then return new; end if;
  -- Database enforcement also covers direct clients. Do not trust JWT role metadata.
  if current_user in ('anon','authenticated') and not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=new.id
      and p.role='owner' and p.is_active is true
  ) then raise exception 'Active organization owner required'; end if;
  return new;
end $$;
revoke all on function public.validate_regional_preferences_qa() from public,anon,authenticated;
create trigger validate_regional_preferences_qa before insert or update of regional_preferences
on public.organizations for each row execute function public.validate_regional_preferences_qa();

-- Metadata-only default addition; no financial amounts or document currencies rewritten.
commit;
