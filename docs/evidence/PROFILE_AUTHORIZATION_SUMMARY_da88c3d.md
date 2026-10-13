# Sanitized profile authorization evidence

Project: `rtfowunsyrdygyvubnvs` only. Captured 2026-10-13 at 03:52:22 and 03:53:07 Asia/Karachi (JSON retains UTC timestamps). PostgreSQL 17.11; connection role postgres; disposable marker verified. Both metadata snapshots explicitly report read-only transaction `on` and ended with ROLLBACK. No profile/user rows, JWTs, keys or passwords collected. The existing private pgpass was used without displaying it.

Machine-readable evidence: `PROFILE_AUTHORIZATION_da88c3d.json`.
SHA-256: `106ff638ef7ab425cf0ef53622481cbbc25af80e96d755cb3e0ee82f81f5e32f`.

## Grants, inheritance and server-role access

`profiles` owner is postgres. RLS enabled; FORCE RLS false. Exact raw table ACL:

    postgres=arwdDxtm/postgres
    anon=arwdDxtm/postgres
    authenticated=arwdDxtm/postgres
    service_role=arwdDxtm/postgres

Each has SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN; no grant option. PUBLIC has no table or column grant. All 12 column ACLs are NULL; `aclexplode(attacl)` yields zero entries. `has_column_privilege` returns true for SELECT/INSERT/UPDATE/REFERENCES for anon/authenticated/service_role because of their table privileges. Effective privilege checks must not be confused with explicit column grants.

PUBLIC has USAGE on public schema, not CREATE. anon/authenticated/service_role have public-schema USAGE and no CREATE. None has membership in another role. The graph runs in the opposite direction for authenticator: it can SET anon/authenticated/service_role, but inherits none of them; its effective profile table privileges are false. Full membership options and all role attributes are in JSON.

service_role: superuser false, BYPASSRLS true. Its schema and table privileges independently establish current access. BYPASSRLS alone would not establish it. The revised revocation does not name service_role or revoke its own grants. Server API functional compatibility still needs runtime validation.

Captured public-schema default ACLs grant broad privileges on future objects created by postgres/supabase_admin. They do not regrant permissions to an existing table after REVOKE, but dropping/recreating profiles could reintroduce exposure. No global/default-privilege change is proposed.

## Complete profile policy definitions

All policies are PERMISSIVE, TO authenticated:

    CREATE POLICY profiles_insert_authenticated ON public.profiles
      AS PERMISSIVE FOR INSERT TO authenticated
      WITH CHECK (true);

    CREATE POLICY profiles_select_same_org ON public.profiles
      AS PERMISSIVE FOR SELECT TO authenticated
      USING ((auth_user_id = auth.uid()) OR
             (organization_id = current_user_organization_id()));

    CREATE POLICY profiles_update_same_org_owner_admin_or_self ON public.profiles
      AS PERMISSIVE FOR UPDATE TO authenticated
      USING ((auth_user_id = auth.uid()) OR
             ((organization_id = current_user_organization_id()) AND is_current_user_owner_or_admin()))
      WITH CHECK ((auth_user_id = auth.uid()) OR
                  ((organization_id = current_user_organization_id()) AND is_current_user_owner_or_admin()));

No DELETE or ALL policy. No anon policy. Table ACL revocation is independent of these row policies. The INSERT policy is an identified gap in the original UPDATE-only migration. Existing primary/FK constraints do not constitute authorization for a well-formed INSERT with valid synthetic Auth and organization IDs.

## Defaults, identity and indirect paths

`role` default is `'owner'::text`; `role_name` default `'staff'::text`; `is_active` default true; `created_at` default now(); other defaults NULL. All types/nullability captured.

`profiles.id` is the primary key and FK to auth.users(id) ON DELETE CASCADE. organization_id references organizations(id) ON DELETE CASCADE. Full indexes and inbound/outbound constraints are captured. A partial UNIQUE index does enforce uniqueness of non-NULL auth_user_id, and another covers non-NULL login_id. Neither requires auth_user_id to equal id or establishes caller authorization. Spoofing tests must respect these index constraints to avoid confusing a uniqueness failure with authorization denial.

organizations: RLS enabled, no DELETE/ALL policy; clients have DELETE/TRUNCATE ACLs. Ordinary DELETE has no eligible row policy. auth.users: RLS enabled, no policies captured, ordinary client DELETE/TRUNCATE false (service_role also has neither ordinary table grant on auth.users). Auth Admin operations are a different privileged service; do not infer their behavior from service_role table grants. Profile TRUNCATE revocation blocks a truncate cascade requiring privileges on profiles. No parent-table action was executed.

No dependent profile view, rewrite rule or noninternal trigger was found. The source scan also covers functions mentioning profiles and their triggers. Captured 34 profile-reference/public-definer candidates and 39 non-extension public functions with full definitions, owners, ACLs, search_path settings and effective EXECUTE. No direct profile INSERT/UPDATE/DELETE/TRUNCATE body found. The only matched dynamic EXECUTE in the public inventory was rls_auto_enable's event-trigger ALTER TABLE RLS enablement; it is not a generic RPC profile writer. Zero other-schema non-extension definers were both executable and schema-accessible by ordinary client roles. These source/catalog checks are bounded, not a runtime noninterference proof.

Relevant postgres-owned SECURITY DEFINER readers include current_user_profile_id, current_user_organization_id, is_current_user_owner_or_admin, has_product_permission, has_inventory_permission and user_can_access_organization. Full definitions and effective EXECUTE are in JSON. The first three have search_path=public and PUBLIC EXECUTE plus explicit role EXECUTE. `is_current_user_owner_or_admin` uses `coalesce(p.role,'owner') in ('owner','admin')` and `coalesce(p.is_active,true)=true`. NULL role behavior requires separate review. No application function was executed.

## Evidence not obtained

- No actual PostgREST exposed-schema configuration: relevant pg_db_role_setting query returned NULL (not an access-denied error). Management API/configuration was not accessed.
- No authenticated direct REST or app write outcomes, no synthetic identity provisioning, no post-migration state, no rollback run.
- No user-row audit for NULL/elevated roles. No claim that old compromised identities are safe.
- Extension-managed functions and external privileged services were not exhaustively audited. Public non-extension source inspection cannot prove absence of every indirect/dynamic route.
- No catalog query failed for lack of permission. Browser inventory access failed on its request-header policy; direct targeted PostgreSQL inspection succeeded and is the evidence source.

The capture and exporter scripts are included for review. SQL migration and exact snapshot rollback remain **remote proposals only**. Subsequent isolated local validation passed 128 checks, including the prepared fail-closed NULL-role/activity helper correction, all captured caller policies and exact minimal rollback. See [validation and guarded procedure](../PROFILE_DB_RELEASE_VALIDATION_da88c3d.md). The earlier “not obtained” list describes remote evidence: no remote mutation or rollback occurred. Latest remote refresh attempts timed out; fresh executable preflight remains required. Rollback restores vulnerable grants/default/policies and helper fallbacks, and must not be treated as safe automatic recovery.
