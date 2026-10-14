# QA candidate approval and Option B handoff — 2026-10-15

## Exact revision assessment

Approved application candidate: c8af1bb256a6d66929a90b1d3aa8c83230f7ab27, for tradeos-qa only. This is source approval, not deployment or runtime verification. Do not deploy the subsequent runner/documentation commit instead.

Comparison with previously reviewed e97be5c240810cdb543553b9d06119104f5c3bf4: application source is changed, not identical. The three changed application files add the organization-scoped invitation projection, use it in StaffOnboardingService, propagate import lookup failures and reject unsupported unmatched profile creation. General employee projections remain unchanged. Matching remains normalized profiles.email within organization, not employee contact email. Initial concurrent invite creation and concurrent expired renewal are not serialized. See STAFF_INVITE_IMPORT_FIXES.md for scope, consumer review and limitations.

Application baseline remains da88c3d56df58cf29e7d32debfcc1045d0ea01b4. Database package remains e97be5c240810cdb543553b9d06119104f5c3bf4 with the existing PROFILE_RELEASE_MANIFEST_da88c3d.json and all its artifact hashes unchanged. Source approval does not replace either identity.

The runner now accepts only the frozen candidate SHA as an application revision. Deployment ID/URL are deliberately null: even otherwise complete evidence cannot run preflight until fresh evidence is reviewed and the exact binding is committed. Historical da88c3d/e97be5c deployments and arbitrary descendants are rejected. No new deployment attestation has been created.

## Authorized operator/Muse sequence

1. In the existing tradeos-qa project, the user privately copies the existing service_role key from Supabase project rtfowunsyrdygyvubnvs into the protected SUPABASE_SERVICE_ROLE_KEY field. Preserve its existing environment/branch scopes and QA protection. Do not print or transmit the value in chat, screenshots, files or command arguments. No rotation, shared-variable change or business-helper modification.
2. Record a sanitized user statement after saving: source project, destination project/variable, unchanged scopes and protection, completion time. The present statement of intent is not confirmation of completion. If the existing variable is shared or scopes cannot be preserved, stop for review.
3. Deploy exactly c8af1bb256a6d66929a90b1d3aa8c83230f7ab27 to tradeos-qa. Confirm the actual full Git SHA in deployment details; redeploying an older deployment is insufficient. Record the new deployment ID, immutable URL, timestamp, protection and project identity.
4. Capture deployment-specific client configuration usage and server target configuration privately. Server factory uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Associate the saved key-source verification with the environment scopes actually used by this new deployment. Masked names or successful login alone are insufficient. Do not claim the previous hidden value was decoded or its historical provenance verified.
5. Retest through authorized application workflows with ordinary synthetic sessions, only against the verified disposable target. Record requests without credentials, response outcomes and resulting state. Pending invite reuse, accepted rejection and expired renewal must each create zero additional Auth/profile rows. Do not clean up fixtures. Do not claim concurrent initial calls are serialized. For import, use an existing profile login email from Staff export: verify matched UPDATE and resulting values; verify contact-email mismatch and unmatched rows fail preview without writes. Exercise legitimate server-writer baselines and identify every case not performed. No direct REST mutation tests.
6. Return sanitized evidence with full SHA, deployment ID/URL, both targets, client usage evidence, completed private key-source statement, verifier/time and baseline results. Codex then reviews and pins the exact deployment binding, runs runner regressions and fresh read-only guarded preflight. Evidence must be verified within one hour of preflight; never refresh timestamps without re-verification. Stop on metadata drift and report differences.

## Checks and blockers

Prior application checks at c8af1bb: full npm test, typecheck and webpack build passed; focused ESLint had no errors and eight existing warnings. Those were local checks, not new deployed baseline results. The focused invitation/import fixture regression and runner/manifest tests are rerun for this source assessment.

Outstanding: completed private key copy confirmation; new exact deployment identity; deployment-specific client/server evidence; fresh synthetic application/server-writer results; reviewed exact binding; fresh guarded preflight. No diagnostic endpoint, environment change, deployment, remote mutation, migration or rollback is performed by this package update.
