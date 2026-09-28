# TradeOS usability review — 29 September 2026

## Scope and evidence

- Inspected the authenticated production dashboard, Retail POS, Products and Inventory dashboard through read-only browser interaction as an owner. Production was on an older release than `review/pos-atomic-sales`; observations of the live UI are not verification of branch features. No business records were changed.
- Inspected the current review branch's POS, sales calculation and route composition. Other roles, every tab, mobile live pages, physical printers and real task timings are still untested. No measured performance benchmark was run.

## Priorities

| Priority | Observation | Recommended change and evidence to collect |
| --- | --- | --- |
| P0 | The new sale path is on an unmerged branch, and the live database lacks its RPC and precision columns. | Finish isolated database checks and rollout before treating branch POS work as production ready. Record sale, payment, stock, receipt, retry and return evidence with real authenticated test users on a disposable clone. |
| P1 | Retail POS puts invoice discounts behind the full invoice screen even though its shared calculator already supports amount and percentage. | Show the amount/percentage choice in POS, with the calculated discount and payable total visible. Check invalid percentages, tender/change, receipt and employee restrictions. The implementation is in this review worktree. |
| P1 | The owner sidebar exposes 36 primary destinations in the browser snapshot, with extra help buttons on many items. The dashboard starts with setup, quick sale and export cards before the daily business summary. | Group navigation by daily task (Sell, Stock, Buy, Customers, Money) and put less frequent tools under More. Give each role a focused home and test the five most common tasks with new users. Keep existing section routes and permissions. |
| P1 | A 12-step tutorial dialog covered the dashboard on opening in the observed session. | Make the first step optional or brief and provide contextual help at the moment a user needs it. Test time to first sale and whether people can dismiss and find help again. |
| P1 | Products opens with a long Add Product form (name, brand, category, SKU, barcode, units, multiple prices, reorder controls and policy) and shows 73 of 73 products with unset settings in this organization's live view. | Provide a short basic product flow with optional stock and unit details. Investigate what "unset" means before interpreting its count; separate optional blanks from fields that prevent sales. |
| P1 | Inventory showed raw values such as 1.1666666666666667 carton and a forecast of 7684.2 days. | Apply consistent quantity presentation and cap/unavailable states for weak forecasts; retain precise values for calculations and exports. Verify products with subunits and little sales history. |
| P2 | `src/app/page.tsx` is 25,435 lines and contains no dynamic imports in that file. This is a maintainability and potential loading risk, not a measured speed failure. | Profile production navigation and bundle sizes on desktop and low-end mobile. Split or defer only the screens confirmed to contribute materially to interaction delays. |
| P2 | The POS, receipt and several role pages hardcode `en-PK`/`PKR`; the root document declares `lang="en"`. | Before launching outside Pakistan, define an organization locale, currency, timezone and date/number formatting contract. Test English and Urdu/RTL, and one non-PKR currency with tax rules appropriate to the selected market. |

## Working method

Review one role and workflow at a time: cashier sale/receipt, owner stock/purchases/payments, wholesaler order/credit, distributor assigned route and collection. Capture steps, errors, screen widths, and task completion times before changing navigation. Validate each screen with keyboard, phone, low bandwidth and a real printer where relevant. Avoid adding more top-level destinations to solve complexity.
