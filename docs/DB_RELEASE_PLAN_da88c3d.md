# Database release plan — da88c3d

Status: **REVIEW ONLY. No remote migration, remote mutation test, production access, deployment or database configuration change performed.** Migration and rollback were executed only in an isolated local in-memory fixture: 128 checks passed. Revised 2026-10-13 from the supplied `DB_RELEASE_PLAN_da88c3d.pdf`; the PDF is preserved. See [guarded procedure and validation](PROFILE_DB_RELEASE_VALIDATION_da88c3d.md).

Target is exclusively disposable Supabase project `rtfowunsyrdygyvubnvs`. Application baseline: `da88c3d56df58cf29e7d32debfcc1045d0ea01b4`, branch `review/tradeos-search-security-integration`, existing `tradeos-qa` deployment. The deployment revision and database project must be verified separately before runtime tests. This plan does not authorize its proposed mutations.

## 1. Fresh read-only evidence and corrections

The connection used the existing private target-specific pgpass file and the fixed pooler username `postgres.rtfowunsyrdygyvubnvs`. The disposable marker was present. Each catalog capture used `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and ended with `ROLLBACK`; the captured `transaction_read_only` is `on`. A preliminary session-option check reported `off` because the pooler did not preserve that option; it executed only a SELECT. No credentials or profile rows were captured. Two snapshots are separate transactions, not a single atomic cross-file snapshot; recapture and compare before release.

Evidence: [complete sanitized catalog snapshot](evidence/PROFILE_AUTHORIZATION_da88c3d.json), [SHA-256](evidence/PROFILE_AUTHORIZATION_da88c3d.json.sha256), [human-readable findings](evidence/PROFILE_AUTHORIZATION_SUMMARY_da88c3d.md). Query sources: `scripts/capture-profile-authorization.sql` and `scripts/capture-profile-write-paths.sql`.

| Evidence | Verified result |
| --- | --- |
| PostgreSQL | 17.11 |
| `profiles` ownership / RLS | owner `postgres`; enabled; FORCE RLS false |
| Defaults | `role = 'owner'::text`, `role_name = 'staff'::text`; all other defaults captured |
| Table ACL | explicit SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN to `postgres`, `anon`, `authenticated`, `service_role`, grantor `postgres`, no grant options |
| Column ACL | all 12 `attacl` values NULL; **zero explicit column grants**. Effective column access comes from table grants. The prior claim that every column had an explicit UPDATE grant was incorrect. |
| PUBLIC / inheritance | no PUBLIC table or column grant; PUBLIC has public-schema USAGE. No role memberships inherited by anon/authenticated/service_role. `authenticator` can SET those roles but has no inherited table access. Full membership edges captured. |
| Server access | `service_role` is not superuser; BYPASSRLS true; public-schema USAGE true; independent effective SELECT/INSERT/UPDATE/DELETE and other table privileges verified. |
| Policies | exactly three permissive authenticated policies: INSERT WITH CHECK true; SELECT self/same-org; UPDATE self or same-org owner/admin. No DELETE/ALL policy. Full expressions and role lists captured. |

**BYPASSRLS bypasses row security, not ordinary schema/table/column/function grants.** The original PDF's claim that service_role bypasses grant checks is false. Its current explicit `profiles` grants are why the proposed client revocations preserve server-role table access. This is catalog evidence, not proof that a deployed server has the correct credentials or that every dependent writer succeeds.

The UPDATE-only proposal at da88c3d does **not** close all unauthorized profile writes: authenticated INSERT remains permitted with an unrestricted check. Changing a default cannot prevent an explicit `role: owner` or identity/tenant spoof on a new valid row. Upsert has both INSERT and conflict-UPDATE branches and must be tested separately. DELETE currently has table privilege but no applicable RLS policy, so an ordinary REST DELETE can report success with zero rows; this is not evidence of an actual deletion. TRUNCATE is not controlled by row policies and must lose its table privilege too.

## 2. Writer inventory and compatibility

All listed profile writers use the server client; that is necessary but not sufficient for safety. Validate their authorization and resulting state.

| Writer | Gate / role source / effect |
| --- | --- |
| `/api/auth/provision` | **Verified authenticated, email-confirmed user**, not an unauthenticated owner-creation endpoint. New own organization uses explicit owner role; existing-profile branch links missing auth_user_id and must not promote an existing staff profile. |
| `StaffOnboardingService.generateInvite` | owner + employee org match; explicit designation mapping, restricted default salesman; inactive profile INSERT; error cleanup DELETE. |
| staff invitation activation | invitation validation; activates the pre-provisioned profile. Include this UPDATE in compatibility tests. |
| `/api/identity/invitations/accept` | validated invitation; explicit invitation role; INSERT and error cleanup DELETE. |
| `PATCH /api/identity/profiles` | requireOwner plus service owner guard; org-scoped display_name/role/is_active; self-demotion/deactivation checks. |
| `PATCH /api/identity/profile/current` | resolved own actor; allowlists full_name/display_name/email. Forbidden fields may be silently ignored; do not require a rejection status. |
| current-profile auth linking | links actor's own profile only when auth_user_id is NULL; must not change role, tenant, or another profile. |
| staff import UPDATE | owner-gated import route; server callback to owner-checked ProfileService. |
| staff import CREATE | **Additional generic writer** in import processor INSERTs the staff payload with explicit role (default staff), behind the owner-gated import route. The original claim of exactly three application INSERT sites overlooked this path. Validate required Auth identity/constraints; no promise that an arbitrary new import row can create a login. |
| `/api/staff/delete-inactive` | owner + organization scope; deletes inactive profiles and permissions; verify exact IDs and cascades, not only its reported count. |

No new browser-direct profile writer was identified in the da88c3d cutover. Do not call the inventory proof of every possible runtime writer. Supabase Auth Admin deletion can also cascade from auth.users; it is a privileged server path, not an ordinary staff REST permission.

## 3. Exact proposed disposable migration scope

Review the revised `src/lib/migrations/20261011_staff_profile_role_access.sql`. It supersedes the insufficient UPDATE-only candidate and is **not applied**.

1. In one transaction, require the disposable marker (in addition to out-of-band project verification and snapshot drift checks).
2. Change only `public.profiles.role` future default to `'staff'`; do not rewrite existing rows.
3. Drop exactly `profiles_insert_authenticated` and `profiles_update_same_org_owner_admin_or_self`.
4. Revoke INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on **public.profiles only** from PUBLIC, anon and authenticated. Keep SELECT and its existing policy.
5. Revoke any per-column INSERT, UPDATE and REFERENCES from those same principals on profiles only (none exist in the captured baseline; this prevents overlooked independent grants). Keep column SELECT.
6. **Expanded scope:** replace only the two permissive NULL fallbacks in `public.is_current_user_owner_or_admin()`: require `p.role in ('owner', 'admin')` and `p.is_active is true`. Explicit active owner/admin behavior remains. Preserve its owner, ACL, SECURITY DEFINER, stability and search_path. Do not rewrite rows. Its surviving callers affect organization, security-check and staff-permission writes; their policies are unchanged.
7. Leave table ownership, RLS flags, service_role grants, memberships, schemas, default privileges and other functions unchanged. Before commit compare the entire canonical expected post-state, including anon/authenticated SELECT, unchanged SELECT policy, restricted default, server effective table/column/schema privileges and helper/caller definitions. These guards passed locally; remote execution remains unperformed.

Expected post-state: public clients have no effective non-read profile table or column privilege; server role retains captured effective grants; exactly the original SELECT policy remains; role default is staff. Both anon and ordinary authenticated **owner JWTs** are denied direct table writes: legitimate owner management must use the server API.

The captured inheritance graph needs no additional membership changes. Captured functions contain no direct profile writer, and no profile view/rule/trigger path was found. The helper correction addresses elevated authorization, not a direct function writer. Parent organization DELETE is currently blocked by RLS; auth.users DELETE lacks ordinary client grants. Revoking profile TRUNCATE also denies a cascade truncate requiring privilege on that target. Do not infer HTTP TRUNCATE availability from a SQL grant. No parent-table DDL or configuration change is proposed.

Assessment: the revision addresses the **identified direct** INSERT/upsert/UPDATE paths and removes unnecessary DELETE/non-read capabilities. It is not an unconditional claim that all unauthorized writes are impossible: external API exposure, Auth configuration, dynamic/extension paths, deployed server authorization, legacy rows and runtime outcomes remain release checks (§7).

## 4. Release sequence (future, separately authorized)

1. Read-only recapture immediately before execution. Compare full defaults, ACLs (including grantor/grant option), memberships, policies, flags, function definitions and object ownership with the saved snapshot. Stop on drift; regenerate the reviewed migration and rollback if necessary.
2. Verify the existing tradeos-qa revision contains da88c3d server writers and that its Supabase target is the disposable project. Verify effective service_role schema USAGE, profiles SELECT/INSERT/UPDATE/DELETE, relevant column privileges and needed function EXECUTE. Do not infer these from BYPASSRLS. Verify correct server credentials without recording them.
3. After separate mutation-test authorization, create distinct synthetic identities/fixtures for each destructive/escalation case and a separate legitimate-owner/self-service baseline. Run functional baseline, then quarantine any identity touched by a successful escalation. Never reuse it in later denial tests.
4. Only after explicit migration approval, apply the revised SQL transaction on the disposable project. Do not run rollback as a routine follow-up.
5. Recapture metadata; compare to exact expected delta. Run the authorized post-migration tests below with **fresh** restricted identities. Independently verify persisted state after every request.
6. Release is blocked by any forbidden change, broken authorized writer, unexplained zero-row outcome, or missing evidence required to interpret results. Investigate instead of assuming a rollback is harmless.

## 5. Direct REST and application acceptance matrix

**These are MUTATION TESTS, not read-only evidence. None were run in this inspection. T9 is explicitly an INSERT attempt.** Authorization for metadata capture is not authorization to provision users, issue writes, apply migration or run the following matrix.

Direct REST uses `https://rtfowunsyrdygyvubnvs.supabase.co/rest/v1/profiles`, header `apikey: <public publishable/anon key>` plus `Authorization: Bearer <ordinary synthetic staff or owner access JWT>`. Confirm issuer/project and authenticated role, token validity and synthetic identity privately. **Never put service_role in denial-test headers**; never print/store JWTs, passwords or request headers in evidence. For anon-only cases use the appropriate public-key anonymous context, never masquerade a server key as a public key. Application API tests use the ordinary session bearer token against verified tradeos-qa.

Use `Prefer: return=representation` (and suitable count preference) to observe returned rows, but also take a trusted read-only before/after snapshot scoped to the exact synthetic IDs and marker. A separate trusted observer may use the existing SQL connection in read-only mode; its credentials must never be reused for a denial request. Read full profile state and relevant fixture dependencies without RLS hiding changes, compare canonical values/hashes and existence, and record only sanitized synthetic labels/deltas. Capture method, route shape, actor label, HTTP status, database error code, returned/affected row count and verified state result.

An HTTP 200/204 or empty array is **not** proof of a successful write. Zero affected rows plus no state delta is an authorization no-op only if the fixture was known to exist and all non-authorization prerequisites were valid; otherwise inconclusive. Unauthorized acceptance always requires **zero forbidden changes and zero unintended rows/deletions**, regardless of response status. A 4xx caused only by a malformed payload or FK/unique violation does not prove authorization. Authorized success requires the expected row/field delta and no other delta; 2xx with zero change when change was intended fails functionality.

| Test | Request and identity | Required post-migration outcome AND state |
| --- | --- | --- |
| T1 | ordinary staff direct PATCH own role=owner; repeat identity/tenant/is_active fields independently | permission denial expected after ACL revoke; own and neighboring fixture rows unchanged. Any 2xx is investigated, never counted from status alone. |
| T2 | staff direct PATCH own display_name | direct write denied/no change; self-service API remains the supported path. |
| T3 | staff current-profile API PATCH display_name marker | success and exactly own allowed field changes; protected fields unchanged. |
| T4 | staff current-profile API PATCH role=owner, role_name/admin, id/auth_user_id; separately mixed with allowed display_name | response may reject or ignore; all forbidden fields unchanged. If mixed request succeeds, only allowed field changes. |
| T5 | current-profile API organization_id/is_active plus allowed field; explicit auth-link branch | tenant/status unchanged; auth linking changes only own NULL auth_user_id to actor ID when that fixture is valid. Non-NULL identity remains unchanged. |
| T6 | ordinary owner session, owner profile API for same-org synthetic staff | expected role/status/name actually persist; foreign-org target and self-demotion/deactivation rejected/no change. Separate identities for owner mutation cases. |
| T7 | restricted staff, same profile API incl elevated roles | 403 expected; no profile/permission change. Repeat inactive staff and cross-org target. |
| T8 | staff and employees imports by non-owner with import_export; owner control | non-owner 403 before writes; no profile/employee/permission/audit-success side effects. Owner UPDATE persists expected state; CREATE uses valid Auth-linked fixture and is tested separately. |
| T9 | **INSERT** direct REST, ordinary authenticated staff with a fresh Auth identity lacking a profile | test explicit owner, omitted role, spoofed auth_user_id and foreign tenant with valid fixture references. All unauthorized inserts denied/no new rows. Pre-migration result is measured, not assumed; if it succeeds quarantine that identity permanently from later tests. |
| T10 | direct REST POST upsert using `on_conflict=id`, `Prefer: resolution=merge-duplicates,return=representation` | test existing-own/peer row conflict and fresh nonconflicting Auth ID separately; neither UPDATE nor INSERT may change state. Repeat ignore-duplicates to distinguish no-op from denial. Preserve both target and neighboring rows. |
| T11 | direct REST DELETE own, peer and foreign-org fixtures, staff and ordinary owner JWT | denied/no deletion, including all FK-linked synthetic rows. A pre-migration 2xx with zero rows is not a successful deletion. |
| T12 | direct PATCH/INSERT/upsert as ordinary owner JWT; anon controls | same direct-table denial/no-change invariant as staff. Verify legitimate owner API remains functional separately. |
| T13 | signup provisioning/re-provision, invite creation/activation/acceptance, failure compensation | separately authorized positive controls: expected profiles/roles only; existing staff not promoted; inactive activation exact; intended cleanup scoped. Proves server writers rather than BYPASSRLS assumptions. |
| T14 | owner delete-inactive API; non-owner control | owner deletes only intended inactive same-org fixtures and expected dependencies; active/foreign fixtures persist. Non-owner changes nothing. Do not trust response deletedCount alone. |

For every negative test use distinct identity sets for pre/post phases and isolated targets per escalation family. A fresh JWT for an already-promoted profile is insufficient isolation. Do not repair an escalated identity and silently reuse it. Record pre-state role/tenant/identity through the trusted observer. Do not use real user IDs, email addresses or rows. No SQL TRUNCATE mutation test is required here; inspect its effective privilege. Extend to a specific RPC only if catalog/exposure review identifies a callable write path and a separate scoped test is approved.

## 6. Exact snapshot restoration, not blanket grants

[Generated rollback candidate](evidence/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql) is local review SQL tied to the evidence SHA-256. It was generated without database execution. **Rollback restores the vulnerable owner default, unrestricted authenticated INSERT and self-UPDATE policy; it may reopen the original vulnerability.** Treat it as a security-sensitive decision requiring separate approval, not an automatic response to any 403.

Before rollback verify disposable target, captured owner/grantor `postgres`, column set and **exact expected post-migration** ACL/policy/default state. Stop on intervening changes or unknown grantees/policies; regenerate from the actual approved preimage rather than overwrite other work. Transaction failure rolls back naturally; do not issue compensating blanket GRANTs for a failed transaction.

The candidate restores only release-changed objects: captured role default `'owner'::text`, the 14 removed table privileges (seven each for anon/authenticated), the two removed write policies, and the original helper definition including its vulnerable NULL fallbacks. Baseline explicit column grants are absent, so none are invented. It never drops/recreates the unchanged SELECT policy or revokes/regrants service_role/owner privileges. Full POST equality is required before rollback and full PRE equality before commit. Local tests confirm exact canonical restoration and preservation of the SELECT policy object identity. No `GRANT ALL`, system-catalog edits or blanket ACL resets are used.

After any separately authorized rollback, recapture and compare the entire preimage and effective privileges, not just UPDATE. Rollback does not undo test-created rows, reassigned roles or deleted data. Those require a separate fixture recovery plan; a security rollback cannot sanitize a contaminated identity.

## 7. Remaining gaps and precise limits

- M1/M2/M3/M5 from the PDF are now captured: raw/expanded table ACLs, explicit/effective column ACLs, inheritance/PUBLIC access, exact policies and RLS flags. No catalog permission-denied error occurred in either capture.
- M6 metadata is resolved: INSERT grant and permissive true policy are present. T9 runtime outcome remains unperformed because it is a mutation, not missing read-only evidence.
- M4 is bounded evidence: 39 non-extension public function definitions and 34 profile-referencing/public-definer candidates captured; no direct profile DML writer found. No profile-dependent view, rewrite rule or noninternal profile trigger found. Other-schema non-extension SECURITY DEFINER functions callable by ordinary roles with schema USAGE: zero. This is not a proof against arbitrary dynamic code, extension functions or external privileged services. Function bodies were never invoked.
- `pg_db_role_setting` returned no `pgrst.db_schemas` or `pgrst.db_extra_search_path` entries. Actual gateway/exposed-schema configuration was **not available from this catalog result**; no Management API settings were accessed or changed. Do not interpret empty settings as public being the only exposed schema.
- Auth triggers/functions referencing profiles were included in the source scan; auth.users parent DELETE grants were inspected, but Auth Admin endpoint behavior, credential deployment and full Auth configuration were not exercised.
- The helper correction is now included and locally tested. No remote profile rows were inspected; the existence of legacy NULL roles/activity remains unknown. App/API and other SQL helpers retain some NULL-active or role_name fallbacks; this release does not claim to normalize all platform authorization semantics. See the caller/fallback analysis in the validation report.
- Remote mutation/denial/positive-control checks remain unperformed. No authenticated QA, remote migration or remote rollback was executed. Local SQL migration/rollback tests passed. Browser discovery failed to load its request-header policy. Earlier read-only PostgreSQL captures succeeded, but the latest two refresh attempts timed out on all three pooler IPs. Fresh live preflight is therefore blocked, not passed.
- The canonical PRE combines successful read-only catalog captures; constraints/indexes came from the earlier complete snapshot after a later refresh timed out. It is an expected review baseline, not a claim of one current atomic remote snapshot. Executable preflight must match fresh metadata exactly or abort. Independent current QA deployment/environment evidence and TLS verify-full connectivity remain unverified.

## 8. Authorization and documentation sources

The user authorized this narrow metadata inspection and preparation of revisions. Migration application, rollback, user provisioning, REST write attempts, deployment and configuration changes remain outside this execution. Production is entirely excluded.

PostgreSQL distinguishes ordinary privileges from row security: [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [privileges](https://www.postgresql.org/docs/17/ddl-priv.html), [GRANT](https://www.postgresql.org/docs/17/sql-grant.html), [TRUNCATE](https://www.postgresql.org/docs/17/sql-truncate.html). Effective checks use catalog [access privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html). Supabase documents the distinction between [table and column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security). The Supabase changelog was checked; no relevant privilege-semantics change was identified.
