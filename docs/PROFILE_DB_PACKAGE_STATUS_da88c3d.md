# Database package finalization — 2026-10-13

Application baseline remains `da88c3d56df58cf29e7d32debfcc1045d0ea01b4`. The new database package commit is a separate revision containing reviewed SQL, guards, tests and evidence. Its commit identity is supplied by Git and the final handoff; it is not substituted into the runner's application revision pin. Artifact SHA-256 values are in `evidence/PROFILE_RELEASE_MANIFEST_da88c3d.json`; `.gitattributes` preserves their exact bytes across Windows/Git checkouts.

## Current evidence and blockers

The user confirmed no current Muse deployment verification report has been supplied. There is no verified deployment ID, deployed application SHA, client target, server target or server-writer baseline to attest. The outgoing Muse handoff is a request, not proof. The runner continues to require an independently verified `tradeos-qa` deployment of the exact application baseline above, with the disposable target. No fabricated evidence file was created and no pin was changed to pass a check.

Guarded preflight: **BLOCKED before invocation because deployment attestation is missing**. No metadata equality PASS or drift result is claimed.

Independent read-only connectivity probe: pinned `aws-0-ap-southeast-2.pooler.supabase.com:5432`, database postgres, project-qualified username `postgres.rtfowunsyrdygyvubnvs`, private target pgpass, `sslmode=verify-full sslrootcert=system`. The pooler resolved to `13.238.183.126` and returned `SSL error: certificate verify failed`. This is a certificate-verification failure before database authentication/SQL, replacing the earlier timeout as the latest observed blocker. The probe's intended read-only marker query never executed. TLS was not weakened and no trust-store/configuration changes were made. A verified Supabase database CA/trust-chain correction is needed; do not trust a certificate obtained from the failing connection alone. See [Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).

Browser inventory also failed with `Unable to load browser request-header policy`; it supplied no authenticated dashboard evidence. No remote baseline workflows, direct REST mutations, migrations or rollback were run. The user will obtain Muse's verification and server-writer baseline.

## Exact future disposable approval scope

Execution is not ready for approval until current deployment evidence, verified TLS connectivity, fresh exact-metadata preflight and legitimate server-writer baseline pass. A real metadata mismatch must be reported field by field without altering expected snapshots to hide drift.

After those prerequisites, proposed application is exactly the hashed migration on `rtfowunsyrdygyvubnvs`: staff future default; remove two profile write policies; revoke ordinary/PUBLIC non-read profile table/column privileges; correct only the owner/admin helper's NULL role/activity fallbacks. Preserve SELECT policy, RLS and server grants; no row rewrite or other authorization refactor.

Proposed post-application tests are the existing T1–T14 matrix using separate disposable identities, ordinary staff/owner JWTs with the public API key, and independent before/after state checks. This includes INSERT, both upsert branches, UPDATE and DELETE denial, protected fields through allowlisted APIs, and supported server-writer positive controls. Rollback is not included in that proposed test scope and needs a separate decision because it reopens exposure. No production access, merge or deployment is included.

Muse baseline should identify the exact deployed application SHA and both actual client/server Supabase targets, then record legitimate synthetic provisioning/re-provisioning, invitation creation/activation/acceptance, owner profile changes, self-edit/linking, import create/update and inactive-staff cleanup results. Each result needs request outcome and persisted state; list unavailable fixture-dependent cases explicitly. Do not use direct REST escalation tests for this baseline.

## Package boundaries

The supplied PDF remains untouched and outside this commit. Only the reviewed release artifacts and associated documentation/scripts plus byte-preservation attributes are staged. Existing application code and application revision pins remain unchanged. No secrets, private pgpass, synthetic credentials, deployment tokens, `.claude` content or validation-reports output belong in the package.
