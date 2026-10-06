# Global search suggestions — review branch `review/global-search-suggestions`

Base: `d61a6c8` (tip of `review/visits-product-lookup` at branch creation).
Review-only: no merge, no deploy, no migration, no production access, no changes
to Codex's worktree.

## Problem

Typing a single character (e.g. "F") in the Products, Customers, POS, invoice,
or dashboard search fields only filtered the list in place — users had to scroll
the page to find matching records.

## What was built

A consistent, compact autocomplete suggestion panel directly below each relevant
search field, reusing the existing shared ranking helper (`rankSearchResults`,
`highlightSearchMatches`, `activeSuggestionIndex`) and the existing
`ProductSearchSelect` component. No new dependencies.

### New shared components (`src/components/search/`)

- `useSuggestionPlacement.ts` — measures the field against `visualViewport`
  (which shrinks when the phone keyboard opens) and flips the popover above the
  field when space below is cramped; caps its height to the space actually
  available. Pure `decideSuggestionPlacement` is unit-tested.
- `SuggestionPopover.tsx` — presentational panel: `listbox`/`option` roles,
  safe `<mark>` highlighting (plain-text segments, user input never rendered as
  HTML), detail lines (SKU · price / shop · phone), 44px rows (`min-h-11`),
  "No matches found", loading, and stale-on-error states, `data-suggestion-id`
  per option.
- `SearchSuggestField.tsx` — combobox filter field: opens on typing (and on
  focus when text is present), ArrowUp/ArrowDown/Enter/Escape, full
  combobox/listbox/option ARIA, top-N ranked suggestions (default 8), server
  backed `status` prop (`loading` / `error` / `ready`).
- `suggestion-items.ts` — one-pass builders for product and customer suggestion
  items + prebuilt rank-field maps (unit-tested, including ID/price wiring).

### Field-by-field wiring

| Field | Change |
|---|---|
| Products section search | Plain input → `SearchSuggestField`; suggestions from the already-loaded catalog via `buildProductSuggestionData`; status follows `productsReadStatus` (loading → "Loading…", failed → stale note over saved results, matching the stale-visible catalog design). Selecting commits the exact product name, putting that record first in the already-ranked list. |
| Customers section search | Plain input → `SearchSuggestField`; `filteredCustomers` now uses the shared rank contract over the section's full searchable surface (name, shop, phone, contact, organization, type, city/area/address) — nothing the old broad filter could find is lost; name matches rank first. |
| POS "Find product" | Already `ProductSearchSelect`: now capped at 12 rendered options, safe match highlighting, viewport-aware placement. |
| POS customer picker | Now passes customer rank fields (was legacy label filter): shop ranks as the code field, phone second, contact/city lowest. |
| Sales invoice product line | Already ranked `ProductSearchSelect`: same cap/highlight/placement upgrades. |
| Sales invoice customer picker | Now passes customer rank fields (was legacy label filter). |
| Dashboard header global search (desktop + mobile) | Replaced the ad-hoc dropdown with the shared panel: sections + products ranked by the shared contract (exact SKU/barcode keep rank 0 per the accepted contract; exact name is rank 1, first among name matches), safe highlighting, keyboard nav, combobox semantics, "No matches found", 44px rows. Selecting a product navigates to Products with the filter prefilled to the exact name — the record is the first row, no scrolling. |

Tenant, role, permission, and organization filtering are untouched: every panel
consumes the already-authorized lists; no new fetches, no filter changes, no
server-search pagination changes (the visits lookup keeps its paginated
server search).

## Requirement coverage

1. Single character immediately shows matches — yes, ranking is synchronous per keystroke.
2–5. Exact name first among name matches; name prefix < word prefix; SKU/barcode/brand/category lower — the accepted rank contract, unchanged. Exact SKU/barcode keeps rank 0 (highest) per the accepted contract and the "keep exact SKU/barcode priority" instruction.
6. Safe highlighting via `highlightSearchMatches` segments; hostile input (`<img src=x onerror=…>`) verified escaped in the browser lab.
7. "No matches found" state in every panel.
8. Loading/failure states: products section (tracker-backed), customers (loading), error shows stale note while saved results stay selectable. POS/invoice pickers are client-side over loaded lists — no per-keystroke server round-trip, nothing to show.
9. Mouse, touch (tap verified on the mobile viewport), ArrowUp/Down, Enter, Escape.
10. Correct `combobox` / `listbox` / `option` semantics with `aria-expanded`, `aria-controls`, `aria-activedescendant`.
11. Selection chooses the correct record: POS/invoice `onChange(id)` flows into the sale/invoice line with the catalog price (verified id + `Rs 60.00` in the lab); section fields commit the exact name so the correct record tops the filtered list.
12. Panels render at most 8/12 options with internal scroll — no page scrolling needed.
13. 44px minimum touch targets measured (52px in the lab).
14. Popover flips above the field when space below is cramped and its height is capped to the available viewport space (visualViewport-aware). Verified within the viewport at 390×844 and 1440×900. Playwright cannot open a real software keyboard, so the keyboard-open shrink path is covered by unit tests of the placement decision plus the visualViewport listener.
15. Filtering preserved exactly — see above.

Performance: rank-field maps are built in one pass and memoized; the panel reuses the same ranking the lists already compute; no per-keystroke O(n²) work; parent rerenders do not re-rank (verified in the lab).

## Out of scope (documented as not applicable)

These filter specialized lists with no record-selection model; inventing
suggestions for them would be guessing, so they keep their current filters:
suppliers search, purchase filters, activity-log search, tasks search, ledger
search, reorder-recommendation search, held-sales search, advisory-items search.

## Validation (2026-10-06)

- Unit: `npm run test:global-search-suggestions` — placement decisions, product/customer item builders (IDs, SKU·price / shop·phone details), customer and product tier ordering, exact-phone rank 0 — all pass.
- Browser: `node scripts/browser-global-search-suggestions.mjs` — **67/67** at 390×844 (touch) and 1440×900, zero page errors. Fixtures: 5,020 products, 7 customers. Queries exercised: `F`, `Fo`, `Fr`, `FZ`, exact product name, SKU-only, barcode-only, brand-only, exact phone, no-match, hostile HTML input. Interactions: initial mount, typing, clearing, parent rerender, mouse/tap selection, keyboard selection, Escape, loading, failure-with-stale-results, mobile popover placement.
- `npm run typecheck` — clean.
- Full `npm test` — exit 0, no failures (35 scripts, incl. the new one).
- Changed-file ESLint — 0 errors (page.tsx: 0 errors; its 169 warnings are pre-existing and none touch the edited lines).
- `git diff --check` — clean.
- Production build — passes with placeholder public Supabase variables.

## Not verified / not run

- **Authenticated backend and browser checks against the isolated project
  `rtfowunsyrdygyvubnvs` are pending Codex's release-harness completion.**
  The panels consume the same authorized lists as the existing filters, so no
  new tenant/permission surface was introduced; still, verify on the real
  harness with two organizations that suggestion ranking, tenant isolation,
  and permission filtering hold end to end. Production was not used.
- Receipt-clipping verification still needs UMAIR's real-printer sample.

## Codex review follow-up (2026-10-07)

Addressed Codex's review of `b39cd61` on this branch (no force-push, no merge,
no deploy, no database changes; Codex's database/security work untouched; no
shared loader code changed — the panels only *consume*
`dashboardSourceStates.*.status` from the existing `DashboardReadTracker`).

1. **Selected record identity.** `SearchSuggestField` gained
   `selectedId`/`onSelectItem`; choosing a suggestion reports its record ID
   and any keystroke clears it. Products/Customers sections pin the chosen ID
   first via the new pure `pinSelectedFirst` helper (unit-tested), so one of
   two identically named records shows the chosen record first. Dashboard
   product navigation now carries `recordId` through
   `onSearchSubmit(section, prefill, recordId)` and pins it in the Products
   section. A `searchScopeKey` (`userId:organizationId`) remounts the fields
   and clears the pinned selection on account/organization change; same-scope
   renders keep the key stable so drafts are preserved. POS/invoice selectors
   already select by ID — unchanged.
2. **Constrained popover placement.** The 132px minimum height is gone:
   `clampPopoverHeight` (pure, unit-tested) caps the popover at the space
   actually available, so a phone-keyboard viewport can never push it
   off-screen; options stay scrollable. Also fixed a real page-jump bug the
   cramped-viewport regression exposed: the active option used
   `scrollIntoView`, which scrolled the *window*; both panels now scroll only
   their own popover container.
3. **Global-search permissions.** The header's `onSearchChange` is now a
   stable `useCallback` that returns product suggestions (names, SKU/price
   details, Products destination) only when the centralized
   `canAccessSection("products")` passes; restricted users see sections only,
   and the "See all results in Products" footer is omitted for them. Nothing
   expands permissions.
4. **Accurate loading/failure states.** `SuggestionPopover` now distinguishes
   four states: loading with nothing loaded ("Loading…"), results present
   (interactive, even mid-refresh), initial failure with nothing loaded
   ("Couldn't load results."), and stale results after refresh failure (slim
   stale note + results). Customers use the authoritative
   `dashboardSourceStates.customers.status`; the header maps
   `productsReadStatus` but only surfaces loading/error messaging when it
   concerns what is actually shown (sections are local). Request identity and
   scope invalidation stay in `DashboardReadTracker` (untouched); panels
   remount on scope change so an old request can never clear a new request's
   state.
5. **Explicit result limits.** Panels show "Showing N of M matches": section
   fields offer "View all" (focuses the full ranked list below); the header
   offers "See all results in Products" (permission-gated); POS/invoice
   selectors offer progressive "Show more" (+12). Name-prefix tiers remain
   ahead of incidental name substrings (new unit assertion); exact
   SKU/barcode keeps rank 0.
6. **Performance and portability.** Header suggestions are memoized
   (`useCallback` in the page over stable inputs + `useMemo` in `Header`;
   `visibleNavigationItems` is memoized) so unrelated parent rerenders do not
   re-rank. The browser runner is portable: repository-relative paths,
   `SUGGEST_LAB_BROWSER` / `SUGGEST_LAB_OUT` / `SUGGEST_LAB_PLAYWRIGHT`
   overrides, and platform browser discovery (Windows Chrome/Edge paths,
   `/opt/meta-chromium`, `/usr/bin/*`, then Playwright's bundled Chromium).

### Follow-up validation (2026-10-07)

- Unit: `npm run test:global-search-suggestions` — new assertions for
  `clampPopoverHeight`, `pinSelectedFirst` (duplicates, unknown/absent IDs),
  and name-prefix > word-prefix > incidental-substring tiers — all pass.
- Browser: `node scripts/browser-global-search-suggestions.mjs` —
  **100/100** at 390×844 (touch) and 1440×900, zero page errors. Fixture:
  5,022 products, 9 customers. New regressions: duplicate product/customer
  names pin the chosen ID first and clear on edit; "Showing 8 of 25" +
  "View all"; POS "Show more" 12 → 24; account switch clears old-scope
  suggestions + selection immediately; initial-failure error state; header
  restricted (no product suggestions, no SKU/price leak, no See-all);
  header loading / stale-after-refresh states; cramped field flips and fits;
  220px keyboard-cramped viewport keeps the popover inside the available
  space with the active option visible and no page scroll movement.
- Performance (5,022 products): mount 496–584ms, typing fill→options
  108–308ms, parent rerender 187–209ms.
- Focused existing tests (`test:search-selection`, `test:product-search`,
  `test:product-catalog-loading`) — pass.
- `npm run typecheck` — clean.
- Full `npm test` — exit 0, no failures (35 scripts).
- Changed-file ESLint — 0 errors, 0 warnings on changed lines
  (`Header.tsx`'s `DollarSign` unused-import warning is pre-existing).
- `git diff --check` — clean.
- Production build — passes with placeholder public Supabase variables.
- Authenticated checks against isolated project `rtfowunsyrdygyvubnvs`
  remain pending Codex's release-harness completion — explicitly not run.

## Second review round (2026-10-07)

Seven further findings, addressed on this branch starting from `fb263de`
(normal push, no force; no merge, no deploy, no database changes; Codex's
database/security work untouched).

1. **Global header read states.** The product source now reports independently
   of local section results: `SuggestionPopover` gained an optional
   `statusNote` ("Loading products…" / "Couldn't load products.") rendered
   above the list while sections stay visible. A failed authorized source is
   never reported as "No matches". `page.tsx` passes
   `productStatus={canViewProducts ? headerProductStatus : undefined}`, so
   restricted users never see product-source status.
2. **Products/Customers list states.** Both section lists now show a persistent
   stale-data warning with a working Retry above retained matching rows when
   a same-scope refresh fails (`ProductCatalogErrorBanner` was already shown
   in the invoice section; the Products section list now renders it too, and
   a new `CustomerCatalogState`/`CustomerCatalogErrorBanner` pair gives the
   Customers section the same treatment, driven by the authoritative
   `customersReadStatus` tracker). Initial failure, successful empty catalog
   ("No products/customers added yet."), and query no-match are distinct.
   Same-scope drafts are preserved (stale-visible design unchanged).
3. **Global relevance.** `rankSearchResultsWithTiers` exposes each item's
   contract tier; the new pure `orderCrossTypeSuggestions` merges sections
   and products with one explicit, deterministic ordering: lower tier first
   (exact SKU/barcode = tier 0 outranks even exact section matches),
   then sections before products within a tier, then label, then id.
   Permissions and name-prefix ranking are preserved.
4. **Mobile placement.** `useSuggestionPlacement` now also re-measures on
   scroll (capture-phase listener, rAF-throttled; scrolls inside the popover
   itself are ignored so option-list scrolling stays container-only) and
   captures `visualViewport` once so add/removeEventListener stay symmetric
   on cleanup. The space computation is a pure, unit-tested
   `computeSuggestionSpaces` (documented coordinate assumption:
   `getBoundingClientRect` is in the visual viewport's space). Simulated
   shrunken-viewport tests are now labeled "simulated-keyboard" — no physical
   keyboard or real-device verification is claimed or performed.
5. **Portable browser runner.** The `/home/hatch` playwright fallback and the
   `/opt/meta-chromium` hard-coded path are removed. Resolution is now:
   `SUGGEST_LAB_PLAYWRIGHT` (or a bare `playwright-core` import from the
   repo's own dependencies) and `SUGGEST_LAB_BROWSER` (or generic platform
   install locations, then Playwright's bundled Chromium). Missing
   dependencies and unlaunchable browsers fail fast with actionable errors
   naming the env override to set.
6. **Scope reset and progressive results.** The `searchScopeKey` effect now
   clears parent-owned search text AND selected IDs on user/organization
   change; the key stays stable across ordinary same-user token refreshes and
   same-scope retries, so those preserve drafts. The POS customer picker
   (`RetailPOS`) and the invoice customer picker (`page.tsx`) option arrays
   are now memoized (they were rebuilt inline every render), so "Show more"
   no longer collapses on unrelated parent rerenders.
7. **Regression coverage.** The lab now exercises real caller wiring: header
   section-results + loading/failed product source; stale rows + persistent
   warning + working Retry (both lists); exact product code ("FZ-999")
   competing with a same-code section label; duplicate names + scope changes
   (text cleared too); Show more followed by an unrelated parent rerender;
   POS and invoice selectors retaining ID, price, and unit.

### Evidence tiers

- **Source review:** each finding was verified against the source before
  fixing (e.g. the products list rendered the failure banner only when no
  rows matched; the customers list used a boolean `customersLoading` with a
  single "No customers found."; the header concatenated sections-then-products
  so an exact SKU could never outrank a section; both customer pickers built
  their option arrays inline per render).
- **Unit (synthetic):** `npm run test:global-search-suggestions` — new
  assertions for `computeSuggestionSpaces` (including nonzero-offset/shrunken
  viewports), `rankSearchResultsWithTiers`, and `orderCrossTypeSuggestions`
  (tier-0-outranks-section, same-tier section-first, deterministic id
  tiebreak) — all pass.
- **Synthetic browser tests:** `node
  scripts/browser-global-search-suggestions.mjs` — **123/123** at 390×844
  (touch) and 1440×900, zero page errors. Fixture: 5,022 products (now with
  units), 9 customers. New checks: header exact-SKU-vs-section ordering;
  header loading-with-sections + "Loading products…"; header failed-source
  never "No matches"; restricted users see no product-source status; list
  stale-warning + Retry + recovery; empty-catalog vs query-no-match vs
  initial-failure; scope switch clears search text; POS Show more survives
  parent rerender; POS + invoice ID/price/unit; scroll-while-open placement
  re-measurement; container-only option-list scroll.
- **Authenticated tests:** not run — isolated project `rtfowunsyrdygyvubnvs`
  checks remain pending Codex's release-harness completion.
- **Real-device checks:** not performed. The "simulated-keyboard" checks use a
  shrunken 390×220 viewport in desktop Chromium; they do not verify a
  physical phone keyboard.

### Second-round validation (2026-10-07)

- Unit: `npm run test:global-search-suggestions` — pass (new assertions above).
- Browser: **123/123** (see evidence tiers).
- Performance (5,022-product fixture): mount 486–557ms, typing 93–140ms,
  parent rerender 175–225ms.
- Focused existing tests (`test:search-selection`, `test:product-search`,
  `test:product-catalog-loading`) — pass.
- `npm run typecheck` — clean.
- Full `npm test` — exit 0, no failures (35 scripts).
- Changed-file ESLint — 0 errors, 0 warnings on changed lines.
- `git diff --check` — clean.
- Production build — passes with placeholder public Supabase variables.
