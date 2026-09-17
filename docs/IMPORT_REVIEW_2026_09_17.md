# Import review fixes and linked onboarding plan — 2026-09-17

## Confirmed defect
The generic wizard and API defaulted to Skip existing. When every source row matched an existing record, preview correctly counted all rows as skipped but did not adequately explain why. This is reproduced with a prepared workbook. The user's exact source file was not available, so the precise matches in that file remain unverified.

## Implemented
- Review existing matches by default, with matched record IDs and explicit explanations.
- Retain every source row in paginated preview. Block saving until validation and source-duplicate conflicts are resolved; no silent partial import of invalid rows.
- Explicit Skip remains a user choice; an all-skipped run cannot report a successful empty import.
- Block repeated opening stock on existing-product updates, and unsupported financial-record updates.
- Preview cannot create missing brands/categories/territories.
- Detect database lookup errors rather than interpreting them as absent records.
- Respect an explicitly supplied product brand when matching by name.
- Invoice/purchase reference lookup reads all pages and rejects ambiguous names rather than silently picking one.
- Drag/drop one file per record type into the existing wizard.
- Refresh the review if the server detects conflicts at save time.
- Correct callback dependencies in the wizard; targeted lint has zero errors (existing type warnings remain).

## Validation
- scripts/test-import-review.ts: generated workbook round trip, leading zeroes, mapped stock, previous skip reproduction, retained duplicates, update stock safeguard, preview read-only reference creation, ambiguous-name rejection.
- scripts/test-prepared-import.ts and existing import suite.
- Full application regression passed. Production build is recorded in validation-reports/import-review-*.log.

## Next: one linked onboarding batch (proposal; not implemented)
1. Stage products, customers, suppliers, invoices, and payments as separate drag/drop slots. Each optional slot can be skipped. Uploading stages data and does not post ledger entries.
2. AI proposes mappings; deterministic validation checks required values, units, identifiers, dates, quantities and totals. Keep original files/row provenance in an organization-scoped batch.
3. Review source and normalized values together. Duplicate groups retain all rows. The user decides same record, distinct records with distinct identifiers, or deliberate combination; never auto-delete duplicate names.
4. Match links using source IDs, SKU/barcode, and customer/supplier identifiers. Name-only ambiguity requires confirmation. Group invoice lines by source invoice ID; do not create one invoice per line.
5. Confirm a cutover date and stock/balance model. Recommended: current stock as opening snapshot; older invoices as history-only, with no second stock movement. Opening receivables and supplier payables are balances, not credit-limit settings. Payment allocation must reconcile with invoice balances.
6. Show source row counts, linked/unresolved counts, product stock totals and customer/supplier balance reconciliation before final confirmation.
7. Commit using atomic, idempotent server operations with per-batch provenance and retry/recovery. Existing import endpoints are not an atomic multi-file migration system.

## Known limits
- Exact duplicate resolution UI (keep both/link/merge) is not built; conflicts are currently retained and require correction before saving.
- Historical invoice imports currently post transactions. Do not combine current stock snapshots and historical transactions without agreed cutover semantics.
- Product opening stock posting still uses the existing separate stock/ledger writes; this release prevents repeated stock on updates, but atomic new-product-plus-stock creation is separate work.
- No production records or database schema were changed by tests. No SQL migration is required for these review changes.
