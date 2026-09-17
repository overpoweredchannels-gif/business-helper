# Retail POS and regression review — 17 September 2026

## What to test

1. Open **Retail POS / Create a sale** from the dashboard. A dedicated cash-only Walk-in customer is created once per business. Choose another active customer using the search if needed.
2. Scan a saved barcode ending with Enter, or search for a product. A repeated scan increases its quantity and preserves an edited price. Choose main unit or sub-unit before scanning.
3. Edit quantity, price or line discount in the compact table. Check the total, enter cash received, and check change. Insufficient cash disables Pay & Save. An empty cash field means exact payment.
4. Pay & Save uses the existing sales ledger and inventory. After success the basket clears, barcode focus returns, and a receipt button offers preview and browser printing. A failed save keeps the basket. Walk-in is restored for the next sale unless customer retention was intentionally enabled in the full invoice.
5. Hold an unfinished sale, serve another customer, then resume it. Held sales contain customer, date, lines, units, tax and discount settings, but do not post stock or payments. Current products reload when resuming; review saved prices. Held records are scoped to business and profile in this browser, limited to 50, and are not a cloud backup or shared till queue. Keep one active counter window per employee.
6. Employees with invoice permission see **Send for approval**; owner approval remains mandatory. They retain access to active organization customers. Invoice-level tax and discounts are explicitly unavailable in the current employee approval pipeline; line discounts work. This avoids silently losing adjustments previously entered in unsupported fields.
7. Open tutorial icons, scroll, and reopen help. The symbol is 14px within a 24px clickable target, anchored to its control's parent instead of a floating viewport layer. The simplified counter uses its visible labels and scanner controls without automatic badges over its table.

## Fixes

- Synchronous invoice submission lock prevents double clicks during asynchronous processing.
- One insert statement saves all invoice items; a rejected item rolls back that statement. Empty invoice-header cleanup is attempted on explicit item failure and cleanup failures are surfaced.
- Cash-payment or allocation failures are reported as reconciliation warnings; the successfully saved invoice is not presented as needing another sale submission.
- Receipt previews are limited to the current business/profile and distinguish payments needing reconciliation.
- Client stock checks aggregate repeated product lines and free bonus quantities in main units.
- Employee draft validation rejects non-finite/negative amounts and discounts exceeding a line's value. Approval checks aggregate paid and free quantities, reject inactive products and stop when stock-policy lookup fails.
- Employee pending-sales panel shows loading instead of falsely reporting no submissions during its request, and ignores responses after unmount.
- Tutorial icons move with native scrolling, avoid viewport clamping, and keep explicit sizing even within import workflows.

## SQL required for database bonus deductions

Run the complete file `src/lib/migrations/20260917_sales_bonus_stock.sql` manually in Supabase's SQL editor. The application release does not apply it.

The checked-in old trigger deducted paid quantity only. The migration includes free units and correctly computes net effects when units or quantities change. It adds an internal marker so deleting a legacy sale does not restore bonus stock that was never deducted. Existing balances are unchanged on migration; an old row's unrecorded bonus is deducted on its next edit. Reconcile historical bonus sales separately against actual stock. The migration stops for review if an unfamiliar bonus-aware trigger is already installed.

## Verification and limits

- Full existing regression suite passed, including identity/session/tenant controls, sales access, employee customer scope, purchases, imports, inventory snapshots, collections and monitoring.
- Production build and TypeScript passed during implementation; final release results are recorded in the release logs.
- Database regression: main/sub-unit bonuses, legacy deletion, quantity/unit updates, overselling, atomic multi-line rollback and migration rerun passed against an isolated PGlite database.
- Browser fixture: repeated scanning, insufficient cash, Hold/Resume, next-sale clearing, employee approval wording, help popup and stable scrolling passed. The help icon retained its 10px offset from the field during scrolling and measured 14px wide. Small-screen document width matched its viewport without page overflow; the item table scrolls horizontally.
- No production sales, payments or employee records were created for tests. Physical scanners, receipt printers and production SQL execution still require your checks.
- Invoice header, items and payment remain separate requests. This release improves explicit failure handling but does not claim end-to-end transactional recovery from every network interruption.
- This is a tested review of these workflows and the existing suite, not a guarantee that every screen is free of bugs.
