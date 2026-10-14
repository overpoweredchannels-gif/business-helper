# Staff-import containment candidate — 2026-10-15

## Application assessment against deployed d1bd245

The only changed application source is src/lib/import-export/entities/staff.ts. Matched staff updates are rejected in preview before import execution; applyUpdate independently rejects callers that bypass preview. Unsupported create remains rejected before profile/permission writes. The previous profile-then-permission write sequence and redundant permission post-hook are removed together.

The user-facing restriction explains that updates are temporarily paused to prevent partially saved profiles and permissions, confirms the row was not changed, and directs users to individual Staff & Permissions editing. Create rejection directs users to Employees → Invite. Export, normalized organization-scoped login-email matching and lookup errors, skip mode, individual editing, and invitation flows are preserved. No dependencies, lockfiles, build/runtime configuration or deployment hooks change. No atomic import RPC is implemented or applied; it remains the separately reviewed follow-up in STAFF_IMPORT_FAILURE_d1bd245.md.

The accompanying changes are focused regression coverage, sanitized deployment evidence, the already-reviewed exact d1bd245 deployment binding and investigation documentation. They do not authorize database writes. The full new candidate SHA is the commit containing this assessment and is reported in the completion handoff; do not infer acceptance of any descendant.

## Separate identities and QA requirements

Application baseline remains da88c3d56df58cf29e7d32debfcc1045d0ea01b4. Reviewed database package remains e97be5c240810cdb543553b9d06119104f5c3bf4. Manifest SHA256 remains acbf586940b214d4dd58b12603057fa365715bb65630bcc799fb5c921017141e.

The runner remains bound to the genuinely attested d1bd245 deployment dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47, not to the new source candidate. Its historical read-only preflight PASS does not attest a future deployment. A new QA deployment needs its own exact SHA/ID/URL, client/server target evidence and key-source continuity review before updating that binding. Required hosted containment checks: matched preview rejection, bypass rejection if an authorized application test path is available, unmatched creation rejection, zero profile/permission changes, skip mode, export, and individual editing. No hosted pass for the new candidate is claimed here.

## Cleanup boundary

Only this worktree's .next directory was selected for regenerable-output removal. Inspection found a normal directory with no nested reparse points, 932591575 file bytes. node_modules is a separate junction to C:/TradeOS-worktrees/pos-visits-integration/node_modules and is excluded. Recursive deletion was rejected by automatic approval review as blocked by policy; no removal or recovered-space claim is made until separately verified. Source, evidence, credentials, other worktrees and the unrelated DB_RELEASE_PLAN_da88c3d.pdf are excluded from cleanup and from the scoped commit where unrelated.

## Validation

Focused invitation/import containment and generic import tests, full npm test, typecheck, runner binding/freshness tests, reviewed artifact hash verification and diff checks passed. Changed-file ESLint completed with zero errors and five existing warnings. Staged secret-pattern inspection found no JWT, Supabase secret-key value, credentialed PostgreSQL URL or private-key block.

Build is not verified: the previous webpack attempt compiled but failed writing .next/cache/.tsbuildinfo with ENOSPC. This finalization did not retry while the confirmed .next cleanup was blocked; recovered bytes are zero. C: initially had 522305536 bytes free and later only 10813440 bytes. A successful required build remains outstanding. Source scope is suitable for the next QA candidate assessment, but this document does not claim build readiness or a hosted containment pass.
