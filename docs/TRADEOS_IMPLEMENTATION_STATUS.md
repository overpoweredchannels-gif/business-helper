# TradeOS implementation assessment — 15 September 2026

This is a source-based assessment with regression and focused browser checks. “Implemented” means the workflow exists; it is not a claim that every production scenario is certified or that the entire application is bug-free. The repository contains a large shared workspace page, separate staff pages, API routes, database migrations and a separate mobile project.

## Implemented business workflows

| Area | Current state and evidence | Acceptance work still needed |
|---|---|---|
| Organization identity and staff access | Login/organization resolution, permission checks, staff profiles, roles, invitations/sessions and audit paths exist. Identity, tenant and sales-access suites cover important boundaries. | Test each customer's real roles and deployed migration/configuration state. |
| Product/catalog management | Product identifiers including SKU/barcode, units/conversions, prices, brands/categories and stock settings exist. Product validation checks organization-scoped duplicates. | Reconcile imported records and configure missing product settings. |
| Stock and purchasing | Inventory movement logic, stock snapshots, purchase services and transactional purchase migrations exist. Stock/import/purchase regressions are available. | Reconcile real opening quantities and batch/expiry data; do not synthesize lost stock. |
| Sales and approvals | Invoice lines, pricing/units, discounts/bonus, orders, returns and owner approval of employee drafts exist. Sales-access and draft tests cover permissions and unassigned customers. | Run live cashier and salesman-to-owner approval scenarios with each business's data. |
| Barcode/quick-sale release | Dashboard shortcut, scan entry, exact barcode match, leading-zero preservation, duplicate/inactive rejection, repeat-scan quantities and editable prices/units added. Uses the existing sale/approval workflow. | Physical scanner acceptance; no serial-device or camera integration. It is not a separate offline POS/payment-terminal system. |
| Customers, suppliers and money | Master records, credit settings, payment/collection and ledger/expense/report workflows exist. | Check opening balances, allocations, imported payment references and policies against the actual books. |
| Imports and bulk setup | Saved mappings, preview/default guidance, reference pagination, sparse update preservation, setup review and bulk edits exist. | Generic XML beyond Excel XML and arbitrary external schemas are not automatically guaranteed. Payments without references need manual duplicate review. |
| Print templates and reporting | Saved invoice/load-form layouts, reference review, local spreadsheet recognition, AI document recognition and date-range printable business reports exist. | Verify production AI credentials and compare actual customer templates. Exact arbitrary layout reproduction remains outside the current renderer's guarantee. |
| Employee/field operations | Separate staff workspaces, profiles/performance, territory/route management, visits, attendance/duty and location/collection code exist. | End-to-end tests on intended devices, consent/permissions, connectivity, background tracking and production data. |
| Tutorial/help release | Global authenticated help, first-visit tutorial, searchable workflow topics and contextual question marks on visible labeled controls/headings/navigation added. Completion is per account in this browser. | Review specialized screen wording with users. Less-common controls use general action/field guidance; native select choices are explained within the selector's help popup rather than icons inside the browser's native menu. Completion does not sync across devices. |

## Partial, dependent or remaining work

1. **AI execution completeness:** query/draft/action modules and endpoints exist, but `src/lib/ai/conversation-engine.ts` still contains TODO execution references. Customer/supplier executor files also exist, so TODO entries alone do not prove those entire features are absent. Their wiring and authenticated end-to-end execution need a focused audit before promising universal AI automation.
2. **AI provider deployment:** local PDF/PNG recognition succeeded through Gemini in the preceding release. Production environment keys and live signed-in recognition still require production acceptance. The previously configured Experiential key returned 401; this release does not change global provider routing.
3. **Native mobile and background behavior:** mobile source and web/PWA metadata exist. Store publication, installation and sustained background tracking on target hardware are not established by the web build. Roadmap text still lists voice shortcuts, push notifications and offline-friendly improvements.
4. **Retail hardware:** keyboard-wedge barcode input is implemented. Camera recognition, serial scanner protocols, receipt-printer/cash-drawer protocols, scale integration and integrated payment-terminal checkout are not established features.
5. **Fully offline sales:** do not promise offline invoice creation, conflict resolution or sync across registers without a separate implementation/acceptance effort.
6. **Exact reference copying:** supported columns/layout settings can be proposed and edited. Unsupported columns, arbitrary positioning and unavailable fonts need manual adjustment or renderer extensions.
7. **Historical data reconstruction:** imports cannot recover transactions that were never stored. Payment allocations/opening balances and missing stock history need deliberate reconciliation.
8. **Complete audit/backup:** recorded activity and report exports are not an exhaustive event recorder or database backup/restore solution.
9. **Ongoing assurance:** a passing build and regression suite do not certify every workflow. Continue role-based UAT, production monitoring and fixes from real user reports.

## Tests for the new tutorial/barcode work

- Unit regression: `npx tsx scripts/test-barcode-guide.ts`.
- Existing invoice entry, sales permission and draft approval regressions remain required.
- Browser fixture: `TRADEOS_FIXTURE_NAME=tutorial-barcode`, `TRADEOS_FIXTURE_PORT=4326`, then `node e2e/serve-sales-access-fixture.mjs`.
- Confirm first-visit tutorial, Next/topic navigation, dismissal/reopen and per-browser persistence.
- Open Main unit help: it must explain packs/pieces without changing the selected value or saving anything.
- Scan `001234` twice: one sub-unit line should have quantity 2 at price 10 for the synthetic box-of-12 product. Scanner Enter must leave save count at zero.
- Enter `009876` in the product barcode field: leading zeroes must remain. Only explicit Save should save a form.
- On the real application, choose a customer, test both scan units, test edited pricing, save, then verify customer retention is optional and product lines reset. Employees must still submit for approval.

Customer-facing summary: [TRADEOS_CUSTOMER_FEATURES.md](TRADEOS_CUSTOMER_FEATURES.md).
