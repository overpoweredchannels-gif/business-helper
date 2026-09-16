# Prepared imports and bulk editing

## File workflow

1. Open Setup & Data Import and choose a record type.
2. Upload CSV, XLSX, XLS, ODS or Excel XML. The existing importer reads the first worksheet; arbitrary PDFs/images are not supported for data imports.
3. Review guessed/saved mappings or request AI heading suggestions. AI does not receive record rows or invent missing financial/product values.
4. Review **Your TradeOS file** below the mapping table. All converted records can be reviewed, 25 per page.
5. Download **prepared Excel**, or a **draft Excel** when required values are missing. The workbook uses TradeOS field keys in supported order; optional unmapped fields are omitted so updates do not clear unrelated settings.
6. Run **Preview Import** and confirm only after reviewing duplicates/errors. You can import the current file with its reviewed mapping without downloading/re-uploading. Downloading alone saves no database records.

String cells preserve leading zeroes and formula-like text stays text. Fields explicitly marked Keep in notes follow the existing notes limits. Mapping a source to an already-used target now removes the earlier assignment, avoiding duplicate target columns.

## Bulk editing

Product/customer bulk-edit controls now have prominent action buttons, visible input borders and consistent minimum button heights. Select all operates across the filtered records, not just the visible page. Changes to selection, field, value or filter invalidate the previous confirmation. Inputs are disabled while saving; repeat save clicks are guarded. Invalid values are rejected before showing the confirmation.

## Verification and limits

- Full existing regression suite passed (authorization, tenant scope, purchases, invoices, employee approvals, imports, stock, tracking, collections and AI gateway tests).
- Prepared-workbook unit/round-trip tests cover sparse columns, required blanks, duplicate mapping rejection, preserved notes, leading zeroes and non-formula string cells.
- Browser fixture verified converted rows and invalidation of stale bulk confirmations using synthetic data. It displayed the download-request confirmation, but the automation download event timed out; completed browser download was not independently confirmed.
- Production business records were not modified during testing. This is not certification that every screen and external integration is bug-free.
- No new database migration.
