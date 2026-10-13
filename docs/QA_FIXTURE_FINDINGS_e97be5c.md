# QA fixture inspection and deployment guard — 2026-10-14

Target: disposable `rtfowunsyrdygyvubnvs` only. Inspection used psql TLS verify-full with the pinned official CA, explicit READ ONLY transactions and ROLLBACK. No fixtures were edited/deleted, no remote API writes were issued, and no migration or rollback was applied.

## Deployment evidence assessment

User-supplied Muse/OPPRESSO report: `EVIDENCE_FOR_CODEX_e97be5c.md`, compiled approximately 2026-10-13 19:35–20:05 Asia/Karachi. Report identifies tradeos-qa deployment `dpl_DMKZMTBoccKMPquTUBXKeDLzXKp8`, application deployment SHA `e97be5c240810cdb543553b9d06119104f5c3bf4`, Vercel Authentication ON and the exact preview URL recorded by the runner. These are supplied independent observations, not a new dashboard inspection by this agent.

Supplied report file SHA-256: `fd939efd995f15a7cf16bb096cba85b4ceaab8b3349fa8f5e48adf0da6593ad3`. The original attachment is unchanged and not copied into this release.

The report observes a browser bundle instantiating the client with the disposable Supabase URL. Source inspection confirms browser URL/key use NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY; server uses NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. SUPABASE_URL is not the relevant server factory input. Shared variable naming and a browser build-time value are supporting evidence, not direct deployment-specific server configuration/credential provenance.

The report explicitly says the server key value is unverified. Its claims that auth.admin.createUser and particular service-client functions executed are deductions from source plus observed workflows: request/response captures were not recorded. Live matching Auth/profile rows and invite audit entries corroborate provisioning, but do not independently bind a particular deployment request, server credential and project. Successful login, masked env names and successful profile writes alone are insufficient while client profile writes remain possible. Do not synthesize a complete attestation from this report. Its approximate timestamp is also outside the runner's one-hour freshness window; do not replace it with the current time without renewed verification.

Fresh guarded preflight remains BLOCKED: current complete deployment-specific server target/credential provenance and fresh attestation are missing. TLS connectivity is resolved. No fresh metadata equality PASS/drift is claimed.

## Exact fixture identity and persisted state

All three profile rows belong to organization `6d428742-236b-41fb-82d2-60115e0272d8`. Each profile id equals auth_user_id, the corresponding Auth row exists, and Auth email equals profile email. Times below are UTC as returned by PostgreSQL.

| Login ID | Profile/Auth UUID | role / role_name | Active | Profile creation UTC | Auth creation UTC |
|---|---|---|---|---|---|
| QA10 | 585a0469-bf0f-4bf0-8a0a-2312e1c7e52b | salesman / staff | false | 2026-10-13 14:39:20.179288 | 2026-10-13 14:39:19.148919 |
| QA101 | 90ca631c-898d-4347-895c-1e9bf7f8f6ca | salesman / staff | false | 2026-10-13 14:40:10.761748 | 2026-10-13 14:40:09.772459 |
| QA111 | e41dc563-9871-40ab-ac70-c36c38d7bbd6 | staff / staff | true | 2026-10-09 19:28:07.610677 | 2026-10-09 19:28:07.110910 |

QA10/QA101 display_name and full_name are QA API Staff. Their Auth metadata has staff_onboarding=true and the same organization UUID. Their profile emails are generated hidden addresses, not the contact email. QA111 full_name is QA Employee A; display_name is QA Employee A v3; current profile email is `qa111_6d4287422@staff.tradeos.internal`.

Employee `2a94025d-4eba-4b81-9ee7-4d363bd838e5` is QA API Staff, contact email `qa-api-staff-9138427@example.com`, designation salesman, employee is_active=true, invite_status=pending, and currently points to QA101. Created 2026-10-13 14:38:44.261395 UTC, updated 14:40:11.569 UTC. QA10 is no longer referenced by that employee. The employee has non-null hidden_email/invite_code and expiry 2026-10-16 14:40:09.282 UTC; no invite secret was retrieved. Staff invite audit events for this exact employee occurred at 14:39:20.996790 and 14:40:12.859685 UTC.

Employee `64fd41d3-6029-44ca-a398-74d03877e7f0` is QA Employee A, contact email `qa-employee-a@example.com`, designation salesman, employee is_active=true, invite_status=accepted, and links to QA111. Created 2026-10-09 19:27:02.575681 UTC, updated 19:29:35.090 UTC.

No noninternal live triggers were found on public.profiles, public.employees or auth.users. A trigger-based role rewrite is not supported by this inspection. Existing rows do not prove historical state never differed.

## Invite cause and UI limits

Confirmed source defect: EmployeeRepository's EMPLOYEE_COLUMNS omits login_id, hidden_email, invite_code, invite_status and invite_expires_at. StaffOnboardingService.generateInvite reads through that projection, then tests invite_status and those fields to reject accepted invitations or reuse pending ones. Those branches cannot see the required fields. A subsequent call can provision another Auth/profile row and replace employee.profile_id; the login collision logic produces a suffixed login ID. This mechanism is consistent with the two audit events and QA10/QA101 rows. Exact browser retry/action sequence remains uncaptured.

Required scoped fix for review: include the required invitation fields in the repository projection and regression-test pending reuse, accepted rejection and expired renewal with no additional Auth/profile creation. Concurrent calls also need a separately reviewed idempotency/serialization strategy if a concurrency test demonstrates duplicate creation; the projection repair alone must not be claimed concurrency-safe. No app patch or row cleanup is included in this runner package.

UI source at e97be5c: Staff & Permissions uses profile.role (fallback staff) to initialize a local editable draft; role select uses draft.role. The Owner/Admin badge tests the fetched profile.role explicitly. Active text/checkbox uses draft.is_active initialized from profile.is_active !== false. role_name is not its role source. Salesman is a supported option; owner is merely the first option, not evidence of selection. Employee activity is separate from profile login activation and is true here while pending profiles are false.

Therefore persisted elevated role or activation is NOT confirmed for QA10/QA101. The supplied Active/owner observation cannot be reconstructed from current rows and this UI source. Unsaved edits, stale client state, misreading select options or mistaken row association remain hypotheses, not findings. Resolving the exact historical display needs selected option/checkbox properties and fetched response correlated with these UUIDs. Do not label it a proven display fallback or invent an activation event.

## Import: fixture mismatch plus missing-ID INSERT defect

Actual matching key is normalized input email against profiles.email within organization_id (case-sensitive equality against the normalized input). It does not match employee contact email, login_id or name. QA111's hidden profile email differs from the supplied CSV email, which exists on its employee row. Exact same-org profile matches for `qa-employee-a@example.com`: zero. QA10/QA101 each have one match for their own stored normalized profile email.

This establishes a fixture-key mismatch, not a demonstrated failure to match equal profile emails. `duplicate_mode=update` means update matching rows; unmatched rows still enter CREATE. Staff config has no createRecord/Auth provisioning and builds no id; processor generic INSERT sends this payload to profiles. Captured profiles.id is NOT NULL, has no generated default and references auth.users.id. A random UUID would not provide the required Auth identity and is not a valid fix.

Two audit records corroborate repeated attempts of the same one-row failing scenario: `c0750d0c-c399-4ab3-9a95-0c832dbda6bb` at 2026-10-13 14:42:49.254 UTC and `36528681-6404-45cc-861c-3242ec4e240b` at 14:52:11.540 UTC. Both staff/update, total 1, created 0, updated 0, failed 1, SQLSTATE 23502/null profiles.id. The latter corresponds to the supplied report. QA111 still displays QA Employee A v3 in stored data. This is a confirmed failing scenario, not proof that every matched UPDATE fails or a complete proof of no side effects: import audit rows themselves persist.

Additional source risk: findExisting destructures data but ignores the Supabase error; a lookup error or multiple matches can be misclassified as new. This was not established as the cause of these attempts. Required scoped follow-up: surface lookup errors, make unmatched staff rows fail preview with an actionable provisioning requirement, and document the actual profile-email key. Supporting employee contact email requires an explicit unambiguous resolution design, not an ad hoc OR match. Legitimate creation should use the existing authorized Auth/invitation workflow.

## Corrected writer inventory and baseline status

The report's “only three INSERT sites” claim is outdated. In addition to the explicit provisioning/invitation paths, the generic import processor inserts into config.tableName=profiles for staff. Count all dynamic writer paths, not only literal from('profiles') call sites. Existing release-plan inventory already includes import CREATE, Auth Admin delete cascades and cleanup DELETE paths.

Muse reports successful W4 owner edit and invite operations; current fixture state/audits corroborate resulting values, but this agent did not replay authenticated application workflows. Failed staff-import case is corroborated. No new HTTP mutation harness run was performed: complete deployment target provenance, authorized ordinary synthetic session access and a fresh attestation remain unavailable. The user's latest inspection is read-only and these fixture rows must remain unchanged. Required baseline rerun should use a separate authorized synthetic profile, exact application routes, ordinary sessions held only in memory and independent read-only state comparison; do not issue direct database REST mutations.

## Scoped runner release

The runner retains da88c3d as applicationBaselineCommit and SQL context. It explicitly allows only da88c3d or reviewed e97be5c; the latter is bound to the exact supplied deployment ID and URL. Arbitrary descendants are rejected. Evidence now separately requires client URL, server URL, server credential project ref and sanitized evidence references. These fields are trusted verifier statements, not automatic proof; missing provenance cannot be replaced with guessed strings. SQL/snapshot/manifest hashes remain unchanged. The official CA is pinned; no TLS verification is disabled.

Validation: runner tests pass for both exact reviewed application/deployment revisions and rejection of arbitrary SHAs, wrong deployment identity/URL, wrong baseline, missing/different targets, absent provenance, stale/future evidence and absent write-mode approval. Artifact hash checks, Node syntax checks and git diff checks pass. Focused repository ESLint completed with exit code 0 and no errors after a long silent run; it finished before an attempted stop, so this follow-up has a verified lint PASS. No app code changed, so full app tests/build were not rerun; earlier 128 local SQL fixture checks remain the package's database validation, not a hosted-runtime result.
