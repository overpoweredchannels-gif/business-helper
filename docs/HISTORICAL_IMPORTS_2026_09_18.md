# Historical imports — 18 September 2026

## What is built
Setup & Data Import → Historical invoices and payments now has four archive-only imports:
- Historical sales
- Historical purchases
- Historical customer payments
- Historical supplier payments

These preserve prior business records without writing to live sales, purchase, payment, inventory or cash ledgers. Current customer and supplier balances do not change. This implements the approved current-stock-plus-historical-records approach.

## Required manual SQL
Run the entire `src/lib/migrations/20260918_historical_records.sql` file in Supabase SQL Editor. It is a transaction and can be rerun. It adds an archive table, an atomic import function, indexes and permissions. It does not rewrite existing business data or stock triggers. This SQL has NOT been applied to production by the coding agent.

Without the SQL, the app reports that historical storage needs installation. It never falls back to a live financial import.

## User workflow
1. Import customers, suppliers and products using existing setup steps. Product opening stock should represent the stock on the chosen start date. Reconcile any existing stock separately; importing history cannot repair or double it.
2. Open a Historical import. Drag/drop one CSV, Excel, ODS or Excel XML file, or choose the file normally.
3. Review mappings. Keep the same Source System name across related files and repeat imports. Invoice and payment references must be stable and unique within that source and record type. Missing source name defaults to External records, visibly included in the prepared workbook.
4. Enter the stock/balance start date and confirm history-only mode. Historical dates must be before that date. Every subsequent historical file for this organization uses the same date.
5. Review every row, customer/supplier/product links, grouped invoice count and total. Repeated invoice numbers group product lines; repeated product lines are retained with a warning. Conflicting header values and totals stop the import.
6. Import invoices before payments. For payments, Related Invoice Number is optional. When supplied it must identify an archived invoice for the same party and source system. Without it, payment history links to the party only.
7. Confirm save. Each historical file commits in one database transaction; any failed record rolls back that file's archive records.
8. Browse Imported historical records in Setup, the selected customer's history, or View imported supplier history in Suppliers. Filter by type, party name and date, and expand an invoice for its lines/source file. Access follows import_export permission; no additional employee permissions are granted.

## Meaning of amounts
- Invoice Total, Invoice Discount, Invoice Tax and Paid Amount are invoice-level values, repeated identically or supplied on one line. Invoice totals count once, not once per source row.
- Unit Price and Line Discount are per-line inputs; Line Discount is a currency amount, not a percentage. Quantity and bonus remain in the source's main/subunit mode; history never converts these into inventory movements.
- Blank Paid Amount means unknown, including cash sales. Source paid amounts and individual imported payment records are shown separately; do not add them together.
- Historical credit sales do not create collectible opening balances. Opening receivables/payables still need separate reconciliation. Customer credit-limit settings are not opening balances.
- Payment references are required. Repeated references are reviewed, not silently overwritten. History is read-only; the current app does not offer archive correction/deletion.
- Dates use YYYY-MM-DD or standard Excel (1900-date-system) serial dates. Ambiguous dates are rejected for correction.

## Validation
- `scripts/test-historical-import.ts`: all four archive types, grouped/repeated lines, linked party/product/invoice resolution, totals, date checks, duplicate prevention, organization checks, unchanged current stock/cash/balances, permissions and atomic rollback, using isolated PostgreSQL (PGlite).
- Existing complete `npm test` suite passed.
- Prepared-file and duplicate-review tests passed.
- Production build and final TypeScript checks passed; targeted lint has zero errors (existing warnings remain).
- Local synthetic browser checks: upload, missing-date/confirmation block, preview, save result, history type filter and required-default workbook preview.
- No production test invoices, payments or stock movements were created.

## Scope still separate
This release handles history-only financial imports one file at a time. A simultaneous multi-file staging area, duplicate merge/keep-both controls for master records, opening balance posting, historical returns and archive correction tools are not included. Live operational import buttons remain in their original sections and are clearly labelled.
