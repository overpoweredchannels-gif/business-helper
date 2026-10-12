-- Review only: do not apply until the profile writer cutover is approved.
-- Read-only evidence from disposable project rtfowunsyrdygyvubnvs (2026-10-11):
--   profiles.role had DEFAULT 'owner'; role_name had DEFAULT 'staff'.
--   anon and authenticated had table UPDATE and column UPDATE on every profile column.
--   profiles_update_same_org_owner_admin_or_self allowed auth_user_id = auth.uid()
--   in USING and WITH CHECK, so a caller could update their own role row.
-- App profile writes must use the owner-gated /api/identity/profiles route or
-- the current-profile self-service route before these client grants are removed.
-- Staff import updates use the same owner-checked ProfileService on the server.

begin;

alter table public.profiles
  alter column role set default 'staff';

drop policy if exists profiles_update_same_org_owner_admin_or_self on public.profiles;

revoke update on table public.profiles from anon, authenticated;

-- Revoke column-level grants too; PostgreSQL table-level REVOKE does not remove them.
do $profile_update_grants$
declare
  profile_columns text;
begin
  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
    into profile_columns
  from pg_attribute as attribute
  where attribute.attrelid = 'public.profiles'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if profile_columns is not null then
    execute format(
      'revoke update (%s) on table public.profiles from anon, authenticated',
      profile_columns
    );
  end if;
end;
$profile_update_grants$;

commit;
