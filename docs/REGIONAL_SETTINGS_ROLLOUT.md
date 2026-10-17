# Language and accounting currency rollout

Decision, 16 October 2026: one accounting currency per business. PKR, EUR, USD and GBP are mandatory. English remains available; add Spanish, Italian and Urdu with RTL. Language, formatting locale, timezone and accounting currency are independent. Production remains unchanged until reviewed.

## First implementation increment

Added typed regional settings, complete four-language catalogs for the new settings/validation domain, explicit currency precision, decimal-string to minor-unit rounding, document-currency formatting, calendar-date and event-time formatting, and focused tests. PKR/EUR/USD/GBP plus AED/SAR/JPY/KWD are in the initial extensible registry. This is NOT support for every currency or a translation of the whole app yet. No application formatter or financial writer was switched.

The local UI increment now integrates all 38 navigation labels, navigation search/accessibility labels, a browser language preference and Urdu document direction. A separate regional settings API and owner-only form use optimistic concurrency. Both are enabled only for the exact disposable Supabase target. This code has not been deployed. Language preference is currently browser-local; business defaults are not yet consumed by all screens. Receipts, exports, operational forms and their validation messages still require catalog integration and acceptance.

Catalogs use stable message keys with identical typed key sets; do not translate by replacing rendered DOM text. Existing routes remain stable; authenticated app uses an explicit locale provider rather than moving login/invite/API paths. Language preference belongs to a user, with a business default; never store a process-global current currency/locale. Resolve server settings per authenticated organization. Urdu direction is RTL; identifiers, barcodes, email and mixed currency values need bidi isolation. Arabic-script font shaping, keyboard focus order and mobile overflow need browser/device checks.

References: https://nextjs.org/docs/app/guides/internationalization and https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat . Intl is for display; it does not implement bookkeeping or exchange rates. Use explicit currencies, not ambiguous dollar/pound symbols. Financial calculations use decimal values; new rounding helper declares half-away-from-zero at monetary boundaries, but does not replace existing invoice/tax rounding until parity tests pass.

## Persistence and historical safety gate

Repository inspection found hardcoded PKR in shared formatters, the workspace and retail-summary messages. Read-only disposable metadata inspection found neither `organizations.settings` nor `organizations.updated_at`; the legacy repository references cannot be reused as evidence of persistence. The new dedicated repository uses a proposed `regional_preferences` column and fails closed when it is absent. Currency changes must not go through arbitrary settings JSON or browser-local storage.

`docs/proposals/REGIONAL_PREFERENCES_QA.sql` is an unapplied, separate additive proposal for language/locale/timezone preferences with PKR locked. Its local fixture tests cover owner authorization, inactive/NULL-role rejection, currency rejection and repeat-application rejection. It is not the approved profile authorization migration and is not ready for remote execution: capture its own preflight metadata/grants, review the scope and add guarded execution before deployment. Until then, the hosted settings form will report unavailable persistence rather than pretend to save. No remote regional schema or configuration changes have occurred.

Prepare a separate reviewed additive schema package: organization accounting currency, document-level currency for every monetary root, and server-side immutable currency validation in every write path. Cover sales invoices/orders/returns, purchases/returns, payments/collections, expenses, account opening balances, ledger entries, inventory valuation, recurring records and exports. Credit notes/refunds inherit the original document currency. Child lines inherit their parent; requests must not override it. Currency setup and first transaction must serialize on the same organization row, including direct/RPC paths. Existing generic settings updates cannot override canonical currency.

Legacy documents must retain their historically established currency. PKR is the legacy application default, but confirm the business history before applying any backfill; never infer EUR from Spanish language, a customer location, or today's business preference. No amount conversion, historical repricing, or balance rewrite. Document readers use the immutable document currency; legacy reads use only a reviewed fixed legacy-currency classification. Reject mismatched currencies in balances/totals rather than summing across codes.

For a new empty business: owner chooses accounting currency at setup before catalog monetary values/opening balances/financial activity. Once monetary data exists, lock currency. Initial rollout does not offer in-place currency switching or FX. A business needing a different currency requires a separately reviewed transition/new business, not a symbol toggle. Database checks must enforce the lock; the pure TypeScript guard alone is not enforcement. Existing schema migration hashes remain untouched. No schema has been applied for this feature.

## Ordered delivery gates

1. Foundation (implemented locally): settings/currency catalog, messages, deterministic decimal rounding, explicit document formatting and tests. Preserve existing behavior.
2. Read-only QA language/settings preview and user preference plumbing: persist language/locale independently; translate navigation, settings and validation; Urdu RTL/layout coverage. Currency selector remains unavailable for financial use until gate 3. Clearly mark untranslated surfaces in QA; never claim complete language support from a translated menu.
3. Review additive persistence package and atomic writers; test empty-business currency setup and post-activity lock with concurrent first-write attempts. Only then enable new-business currency selection in QA.
4. Replace explicit PKR labels and implicit currency formatting across POS, invoices, purchases, payments, inventory valuation, dashboards, statements, receipts and exports. Match totals before/after in all four required currencies; validate zero/negative/refunds/discount/tax rounding and JPY/KWD precision. Inputs must parse locale-specific separators explicitly; ambiguous inputs fail. Stored numbers remain locale-neutral.
5. Complete catalog coverage: onboarding/login, staff/owner workspaces, dialogs/toasts, empty/loading/error states, validation, print/PDF/CSV/XLSX output and help. User-entered names/data are not translated. Receipt language can differ from staff UI language. No fiscal-compliance claim from translated receipts.
6. QA acceptance per language/currency and 58/80 mm receipts, Urdu shaping/bidi, historical invariance, export round-trip and permission/tenant boundaries. Spanish/Italian/Urdu translations need fluent review. Physical output remains separate from browser preview.
7. Present exact reviewed candidate, migration scope, limitations and test evidence for production approval. No main merge or production deployment in current authorization.

The database release's post-migration HTTP matrix remains independently blocked by secure ordinary-session access. Do not overwrite its snapshots or confuse a future localization deployment with its pinned 7e4aa95 evidence. Coordinate one explicit QA candidate transition with Muse after local checks and scope review; do not push bookkeeping repeatedly.

## Ownership and next action

Codex: implement gate 2 then prepare gate 3 schema/writer review without applying it. Muse: preserve existing QA fixtures; when assigned a new exact candidate, run language/settings visual acceptance and gather device evidence. User: production release review only; routine architecture decisions remain with Codex. No new credentials requested in chat.
