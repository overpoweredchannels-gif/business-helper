# Profile authorization release: guarded procedure and local validation

2026-10-13. Review only. No remote changes authorized or performed.

## Final artifacts

- Migration: `src/lib/migrations/20261011_staff_profile_role_access.sql`.
- Rollback: `docs/evidence/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql`.
- Read-only preflight: `docs/evidence/PROFILE_RELEASE_PREFLIGHT_da88c3d.sql`.
- Exact expected snapshots: `docs/evidence/PROFILE_RELEASE_PRE_da88c3d.json` and `PROFILE_RELEASE_POST_da88c3d.json`; integrity manifest alongside them.
- Readable generator: `scripts/build-profile-release.mjs`; canonical catalog projection: `scripts/profile-release-state.sql`.
- Guarded runner: `scripts/run-profile-db-release.mjs`.

SQL is supplied as plain-text `.sql` files. The large embedded JSON equality guards intentionally pin the complete reviewed projection rather than merely checking selected privileges.

## Smallest helper correction and expanded scope

The original helper promoted NULL roles to owner and NULL activity to active. It now requires an explicit owner/admin role and `is_active IS TRUE`. No rows are rewritten; no role_name fallback is introduced. CREATE OR REPLACE preserves the captured function ownership, ACL and attributes.

Read-only caller capture (`OWNER_HELPER_CALLERS_da88c3d.json`, 2026-10-13 09:37 UTC) found four policy callers and no function/view callers: profiles UPDATE, organizations UPDATE, security_checks ALL, staff_permissions ALL. The profile UPDATE policy is removed; the three surviving policies retain their exact definitions. **Expanded scope is the helper's authorization behavior in those three tables**, including DELETE through ALL policies. No other table policy is edited.

Application inspection found `normalizeRole` preserves null/empty as unprivileged. API context treats only explicit false activity as inactive and recognizes explicit owner (not admin) for its owner gate. Provisioning has a legacy `role ?? role_name` fallback. `user_can_access_organization` still treats NULL activity as active, while current-user organization/profile helpers lack an activity filter. The surviving write-policy conjunction with the corrected owner helper denies NULL activity there. Other reads/API behavior is unchanged; this is not a global role/active-status rewrite.

## Evidence provenance and identity boundary

The original sanitized catalog capture is hashed in `PROFILE_AUTHORIZATION_da88c3d.json.sha256`. Canonical PRE derives from successful read-only captures; constraints and indexes were added from that original evidence after the latest refresh timed out. These are separate capture transactions, not a fresh atomic snapshot. Partial unique auth_user_id/login_id indexes are included. No profile data or secrets are in the evidence.

The runner pins the pooler host, port, database and `postgres.rtfowunsyrdygyvubnvs` username, removes inherited libpq options, requires the target-specific private pgpass and uses TLS `verify-full` with system roots. It verifies artifact hashes, deployment attestation freshness and exact project/commit values. SQL requires this connection context, postgres executor and the disposable marker, then compares fresh catalog metadata before changing anything. Migration and rollback take a cooperative advisory lock and an exclusive profiles lock, and assert the full expected final state before COMMIT.

The deployment evidence is a **trusted operator attestation**, not an automatic live Vercel lookup. Session settings and a marker alone do not prove project identity. Independent inspection of the actual tradeos-qa deployment and its configured Supabase environment must establish the attestation. The fixed TLS connection supplies the database connection boundary. No current attestation was fabricated or obtained during this work.

## Guarded execution procedure (future separate approval required)

1. Independently inspect the existing tradeos-qa deployment revision and Supabase environment without logging secrets. Create a private JSON evidence file containing `projectRef` = `rtfowunsyrdygyvubnvs`, `configuredSupabaseUrl` = `https://rtfowunsyrdygyvubnvs.supabase.co`, `projectName` = `tradeos-qa`, `gitCommit` = `da88c3d56df58cf29e7d32debfcc1045d0ea01b4`, the actual `deploymentId` beginning `dpl_`, `environmentVerified` = true, actual `verifiedBy`, ISO `verifiedAt` within one hour, and `source` = `independent-read-only-QA-deployment-and-environment-inspection`. Do not populate from desired configuration or guesses.
2. From this worktree run `node scripts/run-profile-db-release.mjs --mode=preflight --evidence=<private-evidence.json>`. This uses an explicit READ ONLY transaction and aborts on missing marker, identity context, artifact mismatch or metadata drift. A timeout/certificate failure is a blocker; do not downgrade TLS. Do not regenerate the expected snapshot merely to make a failed check pass.
3. Review any drift and prepare a newly reviewed before/after pair if necessary. Arrange no concurrent authorization DDL: the advisory lock coordinates these runners, not unrelated administrators changing roles/functions/policies.
4. Only after explicit remote migration approval, use the same runner with `--mode=apply --approval=APPLY_rtfowunsyrdygyvubnvs` and the verified evidence file. The approval argument is an accident-prevention gate, not a substitute for human authorization. Embedded preflight repeats immediately before changes; final-state mismatch rolls the transaction back.
5. Remote REST/API mutation acceptance remains separately authorized work, following T1–T14 in the release plan with ordinary synthetic JWTs and independently verified resulting state. Local SQL tests do not establish HTTP behavior or deployed server compatibility.
6. Rollback requires its own approval and fresh deployment evidence. Use `--mode=rollback --approval=ROLLBACK_rtfowunsyrdygyvubnvs`. Its executable guard requires exact reviewed POST state before changes and PRE state before commit. **Rollback reopens the original owner default, INSERT/self-UPDATE exposure and NULL owner/active fallback.** Do not run it routinely or to undo a failed transaction.

Rollback changes only the default, 14 removed client table privileges, two removed policies and the helper definition. It does not touch unchanged service_role grants or the SELECT policy. Explicit column ACLs were absent and remain absent. It cannot undo separately created/deleted/modified test rows.

## Local validation results

`npx tsx scripts/test-profile-db-release.ts`: **128 checks passed** in an isolated in-memory PGlite fixture, with no network or remote SQL. The fixture's canonical metadata equals captured PRE before migration and exact POST afterward. It reconstructs the profile schema/indexes/constraints, ACLs, role membership, RLS, helper definitions and caller policies. Surrounding tables/Auth behavior are reduced fixtures, not a complete Supabase deployment. The projection excludes PostgreSQL 18's separate not-null constraint catalog entries; column nullability remains asserted, allowing comparison with captured PostgreSQL 17.11 metadata.

- All 21 combinations of seven role values (including NULL, empty, unknown, owner/admin) and three activity values tested against helper and surviving write-policy callers. Only explicit active owner/admin passes.
- No profile row rewrites; direct ordinary-role INSERT, both upsert branches, UPDATE and DELETE denied with resulting profile state unchanged; SELECT retained.
- Server UPDATE works with its captured grants. Removing its UPDATE grant causes denial despite BYPASSRLS.
- Rollback restores exact PRE; SELECT policy object identity survives; vulnerable NULL fallback is demonstrably restored.
- Ten deliberate metadata drift cases tested before both migration and rollback, plus wrong project/deployment/commit and missing marker; rejection leaves state unchanged.
- Five injected postflight failures (default, RLS, SELECT grant, SELECT policy, server grant) abort and undo the whole migration.

`node scripts/test-profile-release-runner.mjs`: passed evidence validation, freshness, exact target/revision, write-mode approval guards and artifact hash checks. This tests runner logic without spawning psql or accessing the network.

`npm run typecheck`: passed. Focused ESLint on the new generator/runner/tests: passed. Full application tests/build were not rerun for this SQL/documentation-only revision; no new UI changes were made.

## Remaining runtime blockers

Latest two read-only refresh attempts timed out on all three addresses for the disposable pooler; fresh remote equality preflight has not passed. Independent current QA deployment/environment verification, TLS verify-full connection and real psql runner execution remain unverified. Remote migration/rollback, ordinary-JWT REST denials, server-writer positive controls, Auth configuration and actual API exposed-schema configuration remain untested. Local PGlite execution is not native hosted PostgreSQL 17.11 or PostgREST testing. No authenticated UI or physical-printer checks are claimed.
