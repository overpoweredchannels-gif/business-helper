# Guided setup and external data imports

Open **Setup & Data Import** from the dashboard or sidebar. Owners/admins can use this central workspace; existing section imports remain available. Backend import permissions still apply.

1. Review business settings, currency, invoice preferences and units.
2. Import or enter brands and categories.
3. Import customers and suppliers. Supplier imports support basic contact information and active status. Review credit/payment policies separately. Customer assignments are optional.
4. Import products and opening stock. Check pack conversion, prices, reorder levels, barcode, batch and expiry settings.
5. Optionally import historical purchases, sales, payment history and credit settings. Decide your cutover date first. Reconcile stock and balances; do not count the same stock in both opening stock and historical transactions. Payment history does not automatically allocate to invoices or recreate balances.
6. Optionally import employees, staff records, territories and routes. Invite/link login accounts and set permissions separately. Review a sample sale before normal operation.

Each step offers existing Import/Export tools and a link for manual entry. Counts reflect stored business data. The last ten import attempts show status, created and failed counts. Checklist review marks are saved per business/user in the current browser, not synchronized across devices. Marking a step reviewed does not import data or certify ledger correctness.

## AI guidance

After uploading a supported file, choose **Suggest column mappings**. The configured Gemini service receives headings and supported field definitions only; it does not receive the data rows. It proposes supported, nonduplicate field mappings. The user reviews suggestions and explicitly applies them to unmapped columns. Existing mappings are preserved. Saved templates and normal matching remain usable if the provider fails. Provider credentials/configuration were not changed for this feature.

AI does not save records, invent opening balances, choose ambiguous unit meanings, or bypass validation. Files remain subject to the existing row and size limits. AI guidance supports up to 100 headings of 200 characters each; larger files can still use manual mapping within the normal import limits.

## Workspace controls

The sidebar footer groups menu reordering/hiding with tutorial controls. Existing saved ordering and hidden sections are preserved. Reorder arrows retain their built-in labels/tooltips and are excluded from overlapping tutorial badges. Main setup/import actions use consistent spacing, labels and keyboard focus states.

## Acceptance checks

- Reorder a section, hide/show it, reload and confirm the saved menu preference.
- Mark a setup step reviewed, reload, and verify the review count.
- Import a small customer or supplier file, preview it, confirm it, and inspect the result before closing the dialog.
- Re-import using Skip duplicates and confirm no duplicate records are created.
- Request AI mapping, review suggestions, and verify it preserves existing mappings.
- Review failed-row counts in the import result and recent history.
- Verify opening stock and a sample sale in the intended unit before importing historical transactions.

No new SQL migration is required. Existing import history tables must be available; imports now stop before saving if an audit entry cannot be created.
