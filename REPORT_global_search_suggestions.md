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
