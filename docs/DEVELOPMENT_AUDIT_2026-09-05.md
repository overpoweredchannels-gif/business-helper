# Development audit — 2026-09-05

## Current stage

**Late MVP / pre-production hardening (assessment, not release certification).**

The working tree has substantial ERP, role-specific workspaces, identity/tenant authorization, purchases, invoices, imports, staff duty tracking, AI business memory, conversation gateway, and an Expo mobile client. This is beyond a prototype. Version 0.1.0 in the package manifests is a package label, not an accurate measure of feature completeness.

The root roadmap describes a v1.0 hardening target, but its status entries lag the code: tests, security headers, monitoring, server-side business services, and a native mobile client already exist. Its dates and completion claims should not substitute for current verification.

## Scope and workspace

- Configured `D:\tradeos` was unavailable; the accessible saved repository is `E:\tradeos`.
- Existing uncommitted changes were preserved. Authentication, AI endpoint authorization, Next.js proxy migration, and mobile dependency edits present before this audit are not claimed as new fixes here.
- No deployment, production data mutation, migration application, or credential rotation was performed.

## Fixes made in this audit

1. **Purchase validation:** reject malformed line objects, unsupported unit modes, negative/fractional/non-numeric/excessive credit terms, and non-finite totals before issuing invoice numbers or inserting transactions. Added 21 assertions covering these cases.
2. **Repeated outage alert suppression:** deduplicate against the last alert rather than the last error occurrence. Sustained errors now become eligible for another alert after 60 seconds. Added a mocked-clock/mock-webhook regression; no messages were sent externally.
3. **Broken validation commands:** restored missing Business Brain and gateway runner files with nonzero exit status on failed validation. Removed voice/assistant commands whose runner files do not exist; those suites are not represented as verified.
4. **Incomplete default test coverage:** included existing import, atomic-collection contract, browser-geolocation, monitoring, brain, and gateway checks in `npm test`.
5. **Reproducible test runtime:** added an exact local `tsx` development dependency and replaced `npx tsx` in package scripts.
6. **Lint scope:** excluded generated native/mobile bundles and Playwright output. Source remains linted; no lint rules were weakened. `npm run validate` now includes lint.
7. **Dependencies:** applied compatible npm audit fixes, resolving the high-severity Browserslist advisory. Two moderate dependency entries remain; see below.
8. **Setup documentation:** supplied the missing root `.env.example`, documented the required server-side Supabase key, corrected the Next.js version, and replaced the unsupported production-grade claim with this assessment.

## Verification

| Check | Result |
| --- | --- |
| Web TypeScript | Passed after code changes |
| Production build | Passed again after fixes and dependency updates |
| Mobile TypeScript | Passed; mobile source unchanged by this audit |
| Full source lint | 0 errors, 626 warnings |
| Default tests | 15 commands passed |
| Purchase service suite | 62 assertions passed |
| Supplier service suite | 43 assertions passed |
| Invoice numbering suite | 63 assertions passed |
| Invoice ledger suite | 53 assertions passed |
| Business Brain validation | 73 checks passed |
| Conversation gateway validation | 40 checks passed |
| Playwright discovery | 10 tests discovered; authenticated execution not run |
| Other suites | Identity, credentials, tenant context, salesman scope, duty tracking, imports, collection SQL contract, browser geolocation, and monitoring passed |

Most checks use fixtures, mocks, or source/SQL contract assertions. They do not prove live database behavior, concurrency safety, provider availability, or complete user journeys. The gateway suite also emits state-transition warnings despite passing its protocol assertions.

## Outstanding release gates

1. **Authenticated end-to-end verification:** dedicated owner, manager, and employee credentials are absent from the environment. Existing Playwright tests are read-only smoke journeys; purchase → sale → payment → ledger mutation/reconciliation acceptance still needs an isolated test organization.
2. **Purchase atomicity/concurrency:** `PurchaseService.createPurchase` uses separate transaction, item, balance, and audit writes. Item failure has compensating deletion, but later balance/audit failures can leave partial results. Supplier balance uses a read-modify-write calculation, allowing lost updates under concurrency. Deletion also spans separate writes. Move the full operation into tenant-authorized transactional database functions and test rollback/concurrency against a staging database. This audit did not apply a live schema change.
3. **Dependency advisories:** `@googlemaps/google-maps-services-js` pulls `query-string@7.1.3` and `decode-uri-component@0.2.2`, leaving two moderate npm audit entries. Compatible `npm audit fix` did not remove them. The current patched decoder is ESM while this dependency chain is CommonJS, so blindly overriding it would risk a runtime failure. A tested dependency migration/replacement remains necessary.
4. **Frontend maintainability:** 626 lint warnings remain. The main dashboard source is approximately 1.18 MB and triggers Babel's large-file warning during lint. Split sections and address warnings incrementally, then measure actual browser loading and interaction performance.
5. **AI/voice readiness:** runtime code exists, but dedicated voice/assistant acceptance runner files are absent; legacy conversation executor TODO markers remain. Passing brain/gateway fixture tests does not certify voice quality, live providers, or all business action execution paths.
6. **Mobile acceptance:** TypeScript passes, but Android release builds and real-device background tracking, permissions, cutoff, stop, and offline recovery were not verified here.
7. **Operations:** verify applied migrations/RLS, backup restoration, production alert delivery, owner UAT, and a release CI pipeline. A local build is insufficient evidence of these conditions.

## Reproduction

From the repository root, run `npm ci`, `npm run validate`, and `npm run build`. Run `npm --prefix mobile run typecheck` after installing mobile dependencies. See `e2e/README.md` for the isolated-account browser test setup.

The removed voice/assistant script names should be restored only together with their actual acceptance tests. Do not use placeholder scripts that always pass.
