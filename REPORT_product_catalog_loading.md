# Product Catalog Loading & Account-Switch Behavior — Review Report

- **Branch:** `review/product-catalog-loading` (separate worktree
  `~/workspace/tradeos-product-catalog-loading`)
- **Base:** `c4f79e79c78a285720c9ba16a599c0cf8674c9eb`
  (`review/product-search-integration` tip, including the two accepted corrections)
- **Scope:** product catalog loading and account/organization-switch behavior only.
  Ranking, pagination (`allPages`), permission/tenant filters, and the visits
  1,000-product cap are untouched (the cap is a separate follow-up).
- **No main merge, no deployment, no database changes, no changes to Codex's worktree,
  no production access.**

## 1. Traced loading path

`src/app/page.tsx` loads the catalog in `fetchProducts(organizationId?)`, which delegates
to the shared dashboard read helper `readDashboardSource("products", orgId, loader,
setProducts, reportError)` → `runDashboardSourceRead` → `DashboardReadTracker`
(`src/lib/dashboard/data-read-state.ts`). The tracker already implements the hard parts:

- `activate(accountId, organizationId)` / `invalidate()` set and clear the scope.
- `begin()` returns `null` on scope mismatch, so a read for a superseded account/org
  never invokes its loader.
- `isCurrent()` drops late responses from earlier requests or scopes (`succeed`/`fail`
  return `false` without committing).
- Published statuses: `not-loaded` / `loading` / `successful-empty` /
  `successful-populated` / `failed`.

The staff visits page (`src/app/salesman/visits/[id]/page.tsx`) loads via
`authorizedFetch("/api/products/list?limit=1000")`.

## 2. Gaps found (all in the wiring, not the tracker)

1. `fetchProducts` wrapped the tracker in a local `productsLoading` boolean:
   `setProductsLoading(true)` before, `setProductsLoading(false)` unconditionally after.
   A stale/ignored read could clear the flag while a newer read was in flight, and the
   flag carried no failure information.
2. The products section UI only branched on that boolean: a failed fetch rendered the
   identical "No products found." as a genuinely empty catalog. No error state, no retry.
3. `clearDashboardSourceData()` (called on account/org switch via `loadProfile` and on
   logout via `invalidateDashboardSession`) cleared fetched rows but **not** invoice/POS
   selections: `salesLines`, `purchaseLines`, `selectedCustomerIdForSale`,
   `selectedSupplierId` survived an organization switch and could be invoiced against the
   newly authorized organization. (RetailPOS itself remounts via its org-scoped `key`,
   and its localStorage drafts are scope-keyed, but the in-memory lines live in page
   state.)
4. `handleArchiveProduct` reused the catalog-wide `productsLoading` boolean for a
   single-row mutation.
5. The visits page catalog load had no stale-response guard, and the salesman layout
   does not observe auth changes — verified by reading `src/app/salesman/layout.tsx`
   (one-shot `/api/identity/staff/me` fetch, no subscription, no polling). An account
   change while the visits page stays mounted would leave old-scope products and draft
   items in place.

## 3. Changes (implemented)

- **New `src/components/products/ProductCatalogState.tsx`**: distinct catalog states for
  the products section, following the dashboard's existing conventions (`role="status"`
  / `aria-live="polite"` for loading, `role="alert"` for failure, dashboard-style retry
  button, `bg-destructive-bg`/`border-destructive/30` banner per the invite/reset/
  collections pages):
  - `loading` / `not-loaded` → "Loading products..."
  - `failed` → `ProductCatalogErrorBanner` + retry. The banner is always shown; the
    caller additionally keeps rendering the stale list when rows exist.
  - `successful-empty` → "No products added yet."
  - `successful-populated` with an unmatched query → `No products match "...".`
- **New `ProductCatalogErrorBanner`** (same file): compact failure banner with retry,
  reused in the sales section so POS and invoice selectors are covered.
- **Failure semantics (same account): stale-but-visible, drafts preserved.** A
  same-account transient failure keeps previously loaded rows visible and selectable in
  the Products list, the Retail POS (`activeProducts`, POS stays interactive), and the
  invoice line selectors — but the failure is never silent: the `role="alert"` banner
  with Retry appears in the products section and at the top of the sales section.
  Entered draft lines are preserved (nothing clears them on a same-scope failure).
- **`src/app/page.tsx`**:
  - Removed the `productsLoading` boolean; derived from the tracker instead:
    `productsReadStatus = dashboardSourceStates.products.status`,
    `productsLoading = status === "loading" || status === "not-loaded"` (used for the
    POS `busy` flag and barcode input `disabled`, as before).
  - `fetchProducts` no longer toggles a local flag; loading/failed/empty states come
    from the tracker, so a late response from a previous account or request can neither
    commit rows nor flip the loading flag.
  - Retry (`retryProductsLoad`) calls `fetchProducts(currentOrganizationId)` — the
    currently authorized organization only. Even a stale retry is safe: the tracker's
    scope check ignores reads for a superseded organization without invoking the loader.
  - `clearDashboardSourceData()` now also clears `salesLines`, `purchaseLines`,
    `selectedCustomerIdForSale`, and `selectedSupplierId`, so POS/invoice selections
    cannot retain another organization's products across account/org switch or logout.
  - `handleArchiveProduct` uses a per-row `archivingProductId` state ("Archiving..."
    on that row's button) instead of the catalog-wide flag.
- **Selection clearing happens only on genuine scope change** (verified by reading all
  call sites): mount-time auth check, login, logout, auth failure (session/getUser/
  provision errors), and `loadProfile` start. `checkAuthUser` runs once on mount —
  there is no `onAuthStateChange` subscription in `page.tsx`, so token refreshes never
  trigger clearing; ordinary refreshes (`fetchProducts` after archive, retry) never
  clear selections.
- **New `src/lib/catalog/use-catalog-scope-guard.ts`** + visits page adoption: the
  request-counter guard plus explicit auth observation. Sign-out or sign-in as a
  different user while the visits page stays mounted clears old-scope products and
  draft items immediately and invalidates in-flight loads; a same-user token refresh
  invalidates nothing; unmount invalidates in-flight requests.

## 4. Validation

### Unit / synthetic (tested)

- `test:product-catalog-loading` — **10/10 pass**: out-of-order delayed responses
  across an account switch, switch-while-loading, logout during loading (late success
  *and* failure ignored), failure→retry (failed keeps prior rows; retry loads the
  current org only; superseded-org retry never runs its loader), genuinely empty
  catalog (`successful-empty`), scope-mismatch reads, and static-markup assertions for
  the banner + all catalog states (stale vs first-load failure copy, empty vs
  no-match).
- `test:dashboard` (incl. dashboard read-state regressions: delayed, empty, partial
  failure, refresh failure, retry recovery, org/account scope, superseded reads) — **pass**.
- Full `npm test` chain — **34/34 scripts, exit 0**.
- `npm run typecheck` — **pass**.
- ESLint on changed files — **0 errors** (visits page: 5 pre-existing warnings, none
  on changed lines; `page.tsx` full-file lint clean).
- `npm run build` — **pass** (placeholder Supabase env).

### Browser / integration (tested)

- New `scripts/browser-product-catalog-loading.mjs` — **38/38 checks pass** on phone
  (390×844) and desktop (1440×900), zero page errors. It bundles the **real**
  `DashboardReadTracker`, `runDashboardSourceRead`, `ProductCatalogState`, and the
  **real** `useCatalogScopeGuard` hook from `src` (the hook's Supabase client is
  aliased to a controllable auth mock; everything else is the shipped code) with a
  synthetic per-org backend, and exercises the actual wiring:
  - Main-page wiring (mirrors `page.tsx` call-for-call: activate/invalidate/read/
    retry/clear-on-scope-change): initial load; failed refresh with loaded products →
    banner shown, stale list selectable, draft preserved, retry offered; retry →
    fresh catalog, banner cleared, draft preserved; org switch during an outstanding
    request → immediate clear, new org loads, late old-scope response ignored;
    logout during loading → cleared, late response ignored; genuinely empty catalog.
  - Visits wiring (real hook): sign-out while mounted clears products + draft items;
    sign-in as another user then token refresh preserves catalog + drafts; user
    change mid-flight → late load ignored.

### Not verified / not run

- **Authenticated backend checks: NOT RUN.** The isolated Supabase project
  `rtfowunsyrdygyvubnvs` is not provisioned yet (no reference anywhere in the
  workspace; Codex's worktree has no env for it). Production was not used. Once
  Codex finishes provisioning, run against the isolated project with two
  organizations: delayed/out-of-order catalog responses across an org switch, switch
  while loading, logout during loading, failure→retry, empty-catalog rendering, and
  the visits-page sign-out-while-mounted flow — with real row-level scoping.
- The browser lab mirrors `page.tsx`'s wiring call-for-call but cannot mount the
  21k-line page itself (it needs Supabase); the page-specific JSX branches
  (banner placement, list conditional) are covered by typecheck + the shared
  components' tests, not by a mounted-page test.
- Real-device receipt printing and the visits-page 1,000-row cap remain as previously
  reported (the cap is a separate follow-up).

## 5. Suggested next step

Awaiting planner review of this branch. If accepted, run the isolated-project
authenticated checks above before considering catalog loading complete.
**No merge into `main`, no deployment, no Vercel or database changes.**
