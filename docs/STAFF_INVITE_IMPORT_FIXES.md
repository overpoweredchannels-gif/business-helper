# Scoped invitation and staff-import fixes — 2026-10-14

## Invitation projection and exposure

StaffOnboardingService now uses EmployeeRepository.findForInvitation(id, organizationId), which explicitly reads login_id, hidden_email, invite_code, invite_status and invite_expires_at. Its organization predicate is mandatory. The general employee projection is unchanged. Existing findById/findByOrganization/create/update consumers therefore gain no invitation secrets. Only the owner-gated staff invitation flow calls the dedicated lookup; its existing invitation response intentionally includes the invite code/link for the owner to share.

Consumer inspection: employee services continue using the general repository methods; staff/me uses its own explicit employee projection without invite fields; employee export uses an explicit projection; business-records reporting does not export employees. No general browser/report response was widened by this fix.

The missing projection made accepted-rejection and pending-reuse branches unable to inspect stored status. Local synthetic regressions exercise the real repository projection and onboarding service with a projected client fixture. Pending reuse, accepted rejection and expired renewal each create zero Auth users and zero profiles. Renewal changes only the invitation code/expiry/update timestamp. Concurrent calls against an already-pending unexpired invitation also return the existing code with zero creation.

Concurrency limitation: initial creation is still a multi-step check/create/update sequence with no transaction or lock. Two calls can both read an uninvited employee; login uniqueness may reject one or cause a suffix/retry, and does not serialize the employee workflow. Concurrent expired renewals may return a superseded code. This patch restores sequential idempotence for stored pending invitations; it does not claim cross-process serialization or clean up QA10. A database-backed claim/serialization design needs separate review and is not included in the reviewed profile authorization migration.

## Staff import matching and failure handling

The matching key remains input email trimmed/lowercased, compared to profiles.email within the actor's organization. It is NOT employee contact email, employee name or displayed Profile ID. Use the existing profile login email from Staff export. Hidden login addresses can differ from employee contact addresses.

findExisting now propagates lookup errors, including multiple-row and permission failures. An unmatched profile throws an actionable Employees → Invite provisioning message during preview; the import route already converts this to a row error and refuses run mode before import audit/writes. A createRecord guard also prevents generic profile INSERT if a caller bypasses preview. No arbitrary profile/Auth IDs are generated and no employee-email matching fallback was added.

Local synthetic matched UPDATE regression uses an existing profile UUID and normalized profile login email, runs the actual import processor/config through the existing update callback, and verifies the resulting name/role plus unchanged login email and zero profile INSERTs. Mismatched contact email, wrong organization, lookup errors and direct unsupported create are rejected. These are local fixture tests, not authenticated hosted QA results. No remote fixtures were modified.

## Database release separation

Application baseline da88c3d and reviewed QA deployment e97be5c remain historical reviewed revisions. This application change is not silently added to the deployment allowlist. Any new deployment needs its exact source/revision assessment, deployment ID and fresh client/server provenance. Reviewed migration, rollback, preflight SQL and snapshot hashes are unchanged. No migration/rollback/cleanup or production changes are part of this work.

Fresh guarded preflight remains blocked by incomplete fresh deployment-specific server credential provenance/attestation. TLS verify-full connectivity is resolved. Existing Muse workflow observations and local tests do not fill that gap.

## Validation

Passed: focused invitation/import regression (included in npm run test:identity), full npm test, npm run typecheck, changed-file repository ESLint (0 errors, 8 existing staff-import warnings), git diff checks and database manifest verification. `npm run build -- --webpack` passed with the disposable Supabase URL and build-only placeholder keys. Webpack was used because the worktree's existing external node_modules junction blocks the default Turbopack build; the default build was not rerun. Missing Google Maps key and a Node deprecation were build warnings, not failures. No authenticated deployed API baseline or remote fixture mutation was performed.
