# Muse handoff: existing tradeos-qa deployment

Use branch `review/tradeos-search-security-integration` and the pushed commit supplied with this handoff. Continue against the existing `tradeos-qa` deployment; do not create a production deployment or merge main. Verify its revision before testing. This work did not deploy QA.

## Boundaries

Authenticated runtime testing may use only the verified disposable Supabase project `rtfowunsyrdygyvubnvs`. Verify the deployment's configured project before signing in or writing test data. No production writes or migration application are authorized by this handoff.

## Receipt acceptance

For both 58 mm and 80 mm, open a saved receipt; print once; cancel the native dialog; reprint; Close and reopen; press Escape during preparation and reopen. Confirm the action recovers after an unavailable printer/print API or interrupted preparation. Confirm errors appear in the receipt dialog. Verify saved totals, tax, discounts, tender, change, calendar date, zero stock and fractional stock (0.125), long names and a 40-line receipt. Compare output to saved data. Test a physical printer separately and record device/browser; synthetic print events and generated PDFs are not physical-print evidence.

## Staff acceptance

With disposable owner and restricted accounts, check employee creation defaults to salesman, missing profile roles receive no owner treatment, existing field roles remain editable, and explicit elevated assignments require owner access. As restricted staff, attempt employee create/update, invite, profile PATCH and staff/employee imports even when granted import_export: expect denial without writes. Verify permitted owner actions remain organization-scoped and self-demotion/deactivation is rejected. Check profile self-edit cannot change role, organization or account status.

## Database release dependency

`src/lib/migrations/20261011_staff_profile_role_access.sql` is review-only and unapplied. It changes future profile defaults to staff and removes recorded direct-client UPDATE privileges/policy, including per-column grants. Coordinate the server-writer cutover before any separately authorized application. Inspect inherited/PUBLIC privileges, INSERT policies and privileged functions too. Do not claim direct REST escalation is fixed on the existing deployment until the database restriction is applied and verified. Existing elevated assignments require manual review; the SQL does not rewrite them.

## Evidence from this continuation

Passed: focused identity and receipt tests, receipt date test in America/Los_Angeles, full npm test, typecheck, and synthetic Chromium receipt/PDF flows for both widths. Browser flow covers Close/Escape preparation cancellation, missing print capability, stalled animation timeout, simulated cancel/afterprint, missing-afterprint recovery, reopen, reprint and sale switching. Default Turbopack build is blocked by the pre-existing external node_modules junction; `npm run build -- --webpack` passed with a build-only placeholder key and disposable-project URL.

No authenticated deployment checks, fresh Supabase metadata queries, post-migration denial checks or physical-printer checks were performed in this continuation. Earlier metadata/HTTP evidence in STAFF_ROLE_ACCESS_REVIEW.md is inherited, not newly verified.

Changed-file ESLint passed with the repository React hooks rules enabled: 0 errors, 188 warnings (legacy any/unused values, hook dependencies and React compiler guidance). The CJS browser runner lint passed separately. An initial attempt to force hooks rules over CJS hit a plugin-scope configuration error; the successful run used the repository configuration, with rules-of-hooks verified at error severity and exhaustive-deps at warning severity. `git diff --check` passed.
