# Visits Product Lookup — Paginated Search — Review Report

- **Branch:** `review/visits-product-lookup` (separate worktree
  `~/workspace/tradeos-visits-product-lookup`)
- **Base:** `b11bf73bd664f25c190d82ba4488087618d83756` (latest published
  `review/product-catalog-loading` tip)
- **Scope:** the salesman visits draft-sale product lookup only. The visits
  1,000-row cap is resolved here by replacing the upfront load with paginated
  search; the API contract itself is unchanged.
- **No main merge, no deployment, no database changes, no migrations, no changes
  to Codex's worktree, no production access.**

## 1. Problem

`src/app/salesman/visits/[id]/page.tsx` loaded the first 1,000 products once
(`GET /api/products/list?limit=1000`) and filtered client-side with an unranked
substring match. Any product beyond row 1,000 was unfindable; the whole window
was transferred on every visit; there was no loading/failure/retry UI and no
keyboard selection.

## 2. Changes (implemented)

- **New `src/components/salesman/VisitProductLookup.tsx`**: search-as-you-type
  lookup (300 ms debounce) against the existing API contract —
  `?search=&offset=&limit=25` → `{ products, nextOffset }`. Nothing is fetched
  until the user types; each keystroke searches server-side.
  - **Tenant/permission filtering preserved**: every request goes through the
    unchanged `GET /api/products/list` route, which enforces `inventory_view`
    and filters by the actor's `organizationId` server-side. No API changes.
  - **Ranking**: each returned page is re-ranked client-side with the shared
    `rankSearchResults` helper (name/SKU fields), so an exact SKU match comes
    before name matches regardless of API position.
  - **Pagination**: a "Show more" button consumes `nextOffset`; appended pages
    are de-duplicated by id and re-ranked as a whole.
  - **Phone UI**: `role="combobox"`/`listbox`/`option` with `aria-expanded`,
    `aria-activedescendant`, and `aria-selected`; loading (`role="status"`),
    no-results, and failure (`role="alert"`) states; Retry re-issues the same
    query; result rows are `min-h-11`; ArrowDown/ArrowUp move the highlight,
    Enter adds the highlighted product, Escape clears.
  - **Safety**: every search bumps the shared `invalidationRef` (the scope
    guard's ref), so a changed query, logout, account switch, or unmount makes
    late responses no-ops. A failed search clears only its own results — the
    caller's already-added draft items are never touched.
- **Visits page wiring**: removed the upfront `?limit=1000` load and the
  client-side filter UI; the draft-sale section now renders
  `<VisitProductLookup key={lookupScopeVersion} .../>`. `searchVisitProducts`
  calls the API via `authorizedFetch`. On scope invalidation the lookup
  remounts (query/results reset) and draft items clear, via the existing
  `useCatalogScopeGuard`.

## 3. Validation

### Unit / synthetic (tested)

- `test:visits-product-lookup` (new, in the `npm test` chain) — **4/4 pass**:
  exact SKU first on a page, deep-offset rows rank by relevance not position,
  name relevance ordering on API rows, null-SKU safety and non-match exclusion.

### Browser / integration (tested)

- New `scripts/browser-visits-product-lookup.mjs` — **36/36 checks pass** on
  phone (390×844) and desktop (1440×900), zero page errors. It bundles the
  **real** `VisitProductLookup` (with the real ranking helper) and drives it
  against a mock implementing the API contract over a synthetic 1,500-product
  catalog:
  - product beyond position 1,000 found (`DEEP-1200` at index 1200);
  - typing shows 25-row pages; clearing empties the input and results;
  - exact SKU ranks first; click adds the correct product ID and price
    (`p-exact` @ 349.99); ArrowDown+Enter keyboard selection adds the
    highlighted product with its price;
  - rapid searches with reversed response order: the stale slow response is
    ignored, the latest query wins;
  - failure shows error + Retry with draft items preserved (2 drafts), retry
    recovers, drafts intact;
  - `nextOffset` pagination: "Show more" appends a de-duplicated second page
    (25 → 50 rows);
  - scope change mid-flight: in-flight search dropped, lookup reset, search
    works afterwards.
- Full `npm test` chain — **35/35 scripts, exit 0**.
- `npm run typecheck` — **pass**.
- ESLint on changed files — **0 errors** (visits page: 3 pre-existing warnings
  on untouched lines — `empId`, `any`, `<img>`).
- `npm run build` — **pass** (placeholder Supabase env).

### Not verified / not run

- **Authenticated backend checks: NOT RUN.** The isolated Supabase project is
  still not provisioned; production was not used. Once available, verify with
  two organizations and 1,000+ products each: a product beyond row 1,000 is
  searchable, `nextOffset` pages advance, tenant isolation holds on every
  page, and permission filtering (`inventory_view`) is enforced.
- The mock API filters name/sku like the real route's `ilike`; the real route
  does **not** search barcodes, so a pure barcode query returns no rows from
  the API today. Exact-barcode-first ranking applies to rows the API returns.
  Extending the API's search to barcodes is a server-side follow-up (API
  contract intentionally unchanged here).
- The browser lab exercises the real component and ranking helper, but the
  API itself is mocked; real latency/RLS behavior is covered only by the
  NOT-RUN checks above.

## 4. Suggested next step

Awaiting planner review. If accepted, run the isolated-project authenticated
checks above before considering the visits lookup complete.
**No merge into `main`, no deployment, no Vercel or database changes.**
