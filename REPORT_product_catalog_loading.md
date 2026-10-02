# Product Catalog Loading & Account-Switch Behavior — Review Report

- **Branch:** `review/product-catalog-loading` (new review branch, separate worktree
  `~/workspace/tradeos-product-catalog-loading`)
- **Base:** `c4f79e79c78a285720c9ba16a599c0cf8674c9eb`
  (`review/product-search-integration` tip, including the two accepted corrections)
- **Scope:** product catalog loading and account/organization-switch behavior only.
  Ranking, pagination (`allPages`), and permission/tenant filters are untouched.
- **No main merge, no deployment, no database changes, no changes to Codex's worktree.**

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
`authorizedFetch("/api/products/list?limit=1000")` with no stale-response guard.

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
5. The visits page catalog load could commit a late response after unmount/logout.

## 3. Changes

- **New `src/components/products/ProductCatalogState.tsx`**: presentational states for
  the catalog list, following the dashboard's existing conventions (`role="status"` /
  `aria-live="polite"` for loading, `role="alert"` + `text-destructive` for failure,
  dashboard-style retry button):
  - `loading` / `not-loaded` → "Loading products..."
  - `failed` → error message + **Retry** (fail-closed: the list is hidden so invoice
    and POS flows cannot silently use a stale catalog)
  - `successful-empty` → "No products added yet."
  - `successful-populated` with an unmatched query → `No products match "...".`
- **`src/app/page.tsx`**:
  - Removed the `productsLoading` boolean; derived from the tracker instead:
    `productsReadStatus = dashboardSourceStates.products.status`,
    `productsLoading = status === "loading" || status === "not-loaded"` (used for the
    POS `busy` flag and barcode input `disabled`, as before).
  - `fetchProducts` no longer toggles a local flag; loading/failed/empty states come
    from the tracker, so a late response from a previous account or request can neither
    commit rows nor flip the loading flag.
  - Products section renders `ProductCatalogState` for every non-list state; retry
    calls `fetchProducts(currentOrganizationId)` — the currently authorized
    organization only. Even a stale retry is safe: the tracker's scope check ignores
    reads for a superseded organization without invoking the loader.
  - `clearDashboardSourceData()` now also clears `salesLines`, `purchaseLines`,
    `selectedCustomerIdForSale`, and `selectedSupplierId`, so POS/invoice selections
    cannot retain another organization's products across account/org switch or logout.
  - `handleArchiveProduct` uses a per-row `archivingProductId` state ("Archiving..."
    on that row's button) instead of the catalog-wide flag.
- **`src/app/salesman/visits/[id]/page.tsx`**: request-id guard on the catalog load +
  invalidation on unmount, so a late response cannot update state after the account or
  page changed.
- **Tests**: new `scripts/test-product-catalog-loading.ts` (`test:product-catalog-loading`,
  wired into the `npm test` chain after `test:product-search`), all synthetic fixtures:
  out-of-order delayed responses across an account switch, switch-while-loading,
  logout during loading (late success *and* failure ignored), failure→retry (failed
  keeps prior rows; retry loads the current org only; superseded-org retry never runs
  its loader), genuinely empty catalog (`successful-empty`), scope-mismatch reads, and
  static-markup assertions for all five `ProductCatalogState` presentations.

## 4. Validation

- `test:product-catalog-loading` — **9/9 pass**.
- `test:dashboard` (incl. dashboard read-state regressions: delayed, empty, partial
  failure, refresh failure, retry recovery, org/account scope, superseded reads) — **pass**.
- Full `npm test` chain — **34/34 scripts, exit 0**.
- `npm run typecheck` — **pass**.
- ESLint: changed files — **0 errors** (`page.tsx` full-file lint, `ProductCatalogState`,
  visits page; 4 pre-existing warnings in the visits page, none on changed lines).
- `npm run build` — **pass** (placeholder Supabase env).

## 5. Not run

- **Authenticated backend checks: NOT RUN.** The isolated Supabase project
  `rtfowunsyrdygyvubnvs` is not provisioned yet (no reference anywhere in the
  workspace; Codex's worktree has no env for it). Per instructions, production was not
  used. Once Codex finishes provisioning, the checks to run against the isolated
  project are: delayed/out-of-order catalog responses across an org switch, switch
  while loading, logout during loading, failure→retry, and empty-catalog rendering —
  with two organizations and real row-level scoping.
- Real-device receipt printing and the visits-page 1,000-row cap remain as previously
  reported.

## 6. Suggested next step

Awaiting planner review of this branch. If accepted, run the isolated-project
authenticated checks above before considering catalog loading complete.
**No merge into `main`, no deployment, no Vercel or database changes.**
