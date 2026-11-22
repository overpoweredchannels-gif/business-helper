# Disposable profiles rollback — state BEFORE the mirror (2026-11-22 ~23:03 PKT)
# Source: disposable queries 5-6 (23:03–23:07 PKT, project tradeos-test rtfowunsyrdygyvubnvs)
#
# Policies (exactly 1):
#   profiles_select_same_org — SELECT, PERMISSIVE, {authenticated},
#     qual ((auth_user_id = auth.uid()) OR (organization_id = current_user_organization_id())),
#     with_check NULL
#   NO profiles_insert_authenticated, NO profiles_update_same_org_owner_admin_or_self
#
# Grants on public.profiles:
#   anon: SELECT only. authenticated: SELECT only.
#   (No INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE for either.)
#
# Restore SQL (disposable ONLY — never run on production):
#   begin;
#     drop policy if exists profiles_insert_authenticated on public.profiles;
#     drop policy if exists profiles_update_same_org_owner_admin_or_self on public.profiles;
#     revoke insert, update on public.profiles from authenticated;
#   commit;
#
# Note: the mirror also runs CREATE OR REPLACE FUNCTION for
# is_current_user_owner_or_admin() with production's exact text. If that changed
# disposable's prior body, restore the prior body from the mirror task's
# before-state report (record it here after the mirror runs).
#
# PRIOR disposable body (read 2026-11-22 ~23:11 PKT, before the mirror):
#   CREATE OR REPLACE FUNCTION public.is_current_user_owner_or_admin()
#    RETURNS boolean
#    LANGUAGE sql
#    STABLE SECURITY DEFINER
#    SET search_path TO 'public'
#   AS $function$
#     select exists (
#       select 1
#       from public.profiles p
#       where p.auth_user_id = auth.uid()
#         and p.role in ('owner', 'admin')
#         and p.is_active is true
#     )
#   $function$
# Drift vs production: disposable did NOT treat a NULL role as 'owner' and
# required is_active to be literally true; production uses
# coalesce(p.role, 'owner') in ('owner', 'admin') and
# coalesce(p.is_active, true) = true. The mirror replaced it with production's
# version (2026-11-22 ~23:12 PKT, verified: disposable profiles now has exactly
# production's 3 policies; authenticated gained INSERT + UPDATE only — NOT
# DELETE/REFERENCES/TRIGGER/TRUNCATE, unlike production's all seven).
