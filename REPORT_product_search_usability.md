# REPORT: Product search relevance and usability — review evidence

Date: 2026-10-02 · Branch: `review/product-search-usability` (worktree `~/workspace/tradeos-product-search`)
Base SHA: **`ddb6264ee2c05b32954b30b81d352c869861d668`** (`origin/review/pos-percent-audit` — "fix(pos): validate receipt and restored employee drafts")

Base choice: `origin/review/pos-percent-audit` (tip `ddb6264`) descends from `aa977d5`
(`origin/review/pos-atomic-sales`) and contains all of its product-search/POS UI work plus
later discount/receipt fixes. `main` lacks that UI work. Git status was clean at branch
creation; no uncommitted edits needed preserving.

**No commit, push, merge, or deployment has been performed.** Work remains uncommitted in
the worktree for planner review.

## 1. Git status, base, and diff

```
On branch review/product-search-usability (HEAD = ddb6264ee2c05b32954b30b81d352c869861d668)

Modified:   package.json
            src/app/page.tsx
            src/components/invoices/ProductSearchSelect.tsx
            src/components/sales/RetailPOS.tsx

Untracked:  REPORT_product_search_usability.md
            scripts/bench-product-search.ts
            scripts/browser-product-search.mjs
            scripts/fixtures/product-search-catalog.ts
            scripts/repro-product-search.ts
            scripts/repro-visits-product-limit.ts
            scripts/test-product-search.ts
            src/lib/products/search-rank.ts
```

Diff stat (tracked files): `package.json | 3 +-`, `src/app/page.tsx | 39 +++---`,
`src/components/invoices/ProductSearchSelect.tsx | 9 +++--`,
`src/components/sales/RetailPOS.tsx | 2 +-` — 33 insertions, 20 deletions.

Focused diff summary (full diffs verified in the worktree):

- **`src/lib/products/search-rank.ts` (new, 107 lines).** Shared, dependency-free ranking
  contract — 0: exact barcode/SKU → 1: exact normalized name → 2: name starts-with →
  3: a name word starts-with → 4: every query word present in the name (broader
  substring matches land here, *below* the precise ranks) → 5: brand/category name
  match (legacy behavior, lowest rank). Deterministic within a rank by normalized name
  then id. Case/whitespace normalized. No fuzzy matching. Also exports
  `highlightSearchMatches`, which splits text into plain-string segments for safe
  `<mark>` rendering (no HTML parsing, no injection surface).
- **`src/app/page.tsx`.** `filteredProducts` uses `rankSearchResults`; brand/category
  names resolved via memoized `Map`s (replacing per-row `.find`). Product names render
  matched terms in `<mark class="rounded-sm bg-primary/10 px-px text-inherit">`
  (design-token classes only). Invoice-line selector passes structured rank fields.
- **`src/components/invoices/ProductSearchSelect.tsx`.** New optional `rankFields` prop.
  When provided, suggestions are relevance-ranked; rank fields are resolved once per
  list into a `Map` (O(1) lookup per candidate — a per-keystroke O(n²) `.find` from the
  first iteration was fixed). Customer selectors omit the prop and keep the legacy
  label filter. Keyboard nav, Enter, Escape, focus, and ARIA paths untouched.
- **`src/components/sales/RetailPOS.tsx`.** POS "Find product" passes structured
  name/SKU/barcode fields. One-line change.
- **`package.json`.** Adds `test:product-search`, wired into the full `test` chain.

No database schemas, migrations, credentials, Supabase config, or Vercel settings were
touched. No new dependencies. No secrets or private data are in the report or scripts.

## 2. Base vs `review/dashboard-data-states` (042fb807)

- Ancestry: **linear**. `ddb6264` is the direct ancestor (merge-base) of `042fb80`
  (`origin/review/dashboard-data-states`, verified after fresh `git fetch`; remote HEAD
  equals the recorded commit `042fb807bd5d85c3576d2e5b5596a90dcdff3e55`).
- `042fb80` has **8 commits** on top of `ddb6264` (dashboard data-states, navigation
  grouping, owner-home tests); `ddb6264` has 0 commits beyond the merge-base.
- Overlapping files: **`package.json`** and **`src/app/page.tsx`** only.
  - `package.json`: both sides add test scripts in *different* script entries
    (ours: `test:product-search` after `test:search-selection`; theirs: extends
    `test:dashboard`, adds `test:dashboard-browser`). Adjacent lines, no semantic conflict.
  - `src/app/page.tsx`: theirs is a 398+/218− dashboard data-states change; ours is a
    ~40-line products-search change in different hunks. No overlapping hunks.
- **No rebase, merge, or overwrite performed**, per instructions.

## 3. Catalog completeness (Products / POS / invoice selectors)

Traced by code, not assumed:

- **Products page** — `fetchProducts` (`src/app/page.tsx:4673`) loads via `allPages`
  (`src/lib/supabase/all-pages.ts`): 500-row pages looped until a short page, filtered
  by `organization_id`. **Complete authorized catalog; no truncation.**
- **Retail POS selector** — `RetailPOS` receives `products={activeProducts}`
  (`src/app/page.tsx:17640`), i.e. the same complete catalog filtered to active.
- **Invoice line selector** — uses `activeProducts` directly (`src/app/page.tsx:17866`).
- Ranking therefore operates on the **full** catalog on all three paths — sorting an
  incomplete catalog is not the situation here. The one exception is the salesman
  visits page (separate issue, §7).

## 4. Substring fallback contract

Verified by `scripts/test-product-search.ts` (all assertions pass):

- `"Whey Protein"` matches `"Hey"` at **rank 4** (all query words present), ordered
  **below** word-prefix matches (rank 3): end-to-end order is
  `Hey` < `Hey Shampoo` < `Premium Hey Soap` < `They Detergent` < `Whey Protein`.
- Brand-only and category-only matches rank **5 (lowest)**; unrelated products excluded.
- Blank/whitespace queries return the caller's list untouched (no filtering, no reorder).
- Missing optional fields (`sku`/`barcode`/`brandName`/`categoryName` null) are safe —
  products matching by name alone still rank correctly.
- Deterministic ties: duplicate names (e.g. two "Sufi Cooking Oil" variants) keep
  stable name-then-id order across keystrokes; variants remain distinguishable by SKU.
- No fuzzy matching: `"hye"` matches nothing.
- Highlighting: segments round-trip to the original text; HTML-looking content
  (`<img src=x>`) survives as literal plain-text segments that React escapes on render.
  (A vacuous `|| true` assertion from the first draft was replaced with real checks.)

## 5. Browser checks — phone and desktop

**38/38 checks pass** at **390×844 (phone)** and **1440×900 (desktop)**, driving the
*real* `ProductSearchSelect` and `search-rank` modules bundled from `src` with the
synthetic 5,000-SKU fixture (`scripts/browser-product-search.mjs`, Chromium 152,
inline bundle — no backend, no credentials involved):

Products list: typing "Hey" → exact "Hey" first; "Whey Protein" (full-rank index 389)
below word-prefix "Premium Hey Soap" (index 387); `<mark>` wraps the matched text with
no unescaped markup; Clear restores all 5,000; "nonexistent-xyz-123" → the exact
no-results message; both "Sufi Cooking Oil" variants listed and SKU-distinguishable;
price/stock row (`Price: 120 · Stock: 40`) byte-identical after ranking; ranked result
set equals the filtered set (ranking adds/removes nothing — tenant/role filtering
untouched, since `rankSearchResults` only reorders the caller's already-authorized array).

Selectors: input receives focus; suggestions rank exact "Hey" first; ArrowDown/ArrowUp
move the active option; **Enter selects the correct product id** (`p-hey-exact`);
Escape closes the dropdown; unknown query → "No matches found" status; zero page errors.

**Not altered by ranking/highlighting:** price, unit, quantity, stock text, or the set
of items the caller authorized. Verified by row-content and ID-set comparisons.

## 6. Performance measurement (clarified)

- **8–9 ms** = `rankSearchResults` **helper execution only**, measured in Node via
  `tsx` on this VM: 5,000 synthetic SKUs, 20 runs per keystroke query ("H"→"Hey Sha"),
  median 8–9 ms, p95 10–22 ms (`scripts/bench-product-search.ts`). It does **not**
  include React rendering.
- **Keystroke-to-paint in a real browser** (input event → 2×`requestAnimationFrame`
  after React commits, 5,000-SKU fixture, real components mounted): **median ~31 ms,
  p95 ~44–52 ms** across 12 sampled keystrokes at both viewports (one 157 ms outlier
  on desktop, consistent with GC/first-paint). Well under the ~100 ms "instant"
  threshold.
- **No debounce added** — measurements do not justify it. The prebuilt field `Map`
  keeps selector ranking O(n) per keystroke.

## 7. Salesman visits 1,000-product limit — separate issue (recorded, not fixed)

- `src/app/salesman/visits/[id]/page.tsx:117` (`loadProducts`): fetches
  `/api/products/list?limit=1000` — **no offset, no search term**.
- `src/app/api/products/list/route.ts`: already supports `search` (name/sku `ilike`),
  `offset`, `limit` (capped at 1,000), and returns `nextOffset`. The API paginates;
  the client never advances past the first page.
- The visits selector (`page.tsx:434-436`) then filters that 1,000-row slice
  client-side with an unranked substring match and `.slice(0, 15)`.
- **Reproduction** (`scripts/repro-visits-product-limit.ts`, exits 2): with a 1,500-SKU
  catalog in API name-ascending order, the product at position 1,251 ("Shan Chana Dal
  1L") is **undiscoverable** — the client's query finds a different same-named product
  in the first 1,000, but never the hidden one. Ranking cannot fix this; the item is
  never loaded.
- No new endpoint is prescribed: the existing pagination/search parameters should be
  inspected first (the client can page with `offset`/`nextOffset` or pass `search`).
  Database work stays with Codex, per instructions.

## 8. Validation summary

- `test:product-search` (new) — **pass**; `test:search-selection` — **pass**.
- Full `npm test` chain: **does not complete** — it stops at `test:sales-atomicity`,
  which exits 1. **This failure is pre-existing on the base branch** (verified by
  stashing this change and re-running: same exit 1 on unmodified `ddb6264`). It is a
  PGlite sales-atomicity scenario (`create_sales_invoice_atomic` overdue-invoice
  override path) untouched by this change; the thrown `Customer has overdue credit
  invoices` error escapes `main()` instead of being absorbed by its `assert.rejects`.
- Every other script in the chain was run individually: the 7 scripts before the
  failure **pass**, and all 25 scripts after it **pass** — including `test:product-search`,
  `test:search-selection`, `test:pos-discount-render`, `test:pos-receipt`,
  `test:invoice-entry`, `test:retail-summary`, and `test:dashboard`.

### Exact `test:sales-atomicity` failure (pre-existing, unrelated)

- **Command:** `npm run test:sales-atomicity` (i.e. `tsx scripts/test-sales-atomicity.ts`).
- **Environment:** this VM, Node via tsx, PGlite in-process Postgres, run date 2026-10-02.
- **Failing point:** `scripts/test-sales-atomicity.ts:434` —
  `const creditOverride = await create("70000000-0000-4000-8000-000000000021",
  { ...creditInput, credit_override_confirmed: true, ... })`.
- **Error:** the `create_sales_invoice_atomic` plpgsql function raises
  `Customer has overdue credit invoices` (function line 207). The invoice created at
  line 424 (`...020`, sale_date 2026-09-26, customer credit_days 5 → due 2026-10-01,
  asserted at line 425) is past due when the test runs on 2026-10-02, so the overdue
  guard blocks the override path. The raw error escapes `main()` (not wrapped in
  `assert.rejects`), so `main().catch` prints it and sets exit code 1.
- **Date sensitivity:** the test passes when run on or before 2026-10-01 and fails
  from 2026-10-02 onward — a fixture-date issue, not a logic regression.
- **Base reproduction:** stashed all tracked changes (untracked review files remain on
  disk but are not imported by this script) and re-ran on unmodified `ddb6264` →
  identical exit 1 with the same error. Sales code and its tests were **not** modified
  or weakened.
- `npm run typecheck` — **pass**.
- ESLint on all changed/new TS/TSX files — **0 errors**. `page.tsx`: 168 warnings,
  none on changed lines, all pre-existing on the base branch (verified by linting the
  stashed base). `RetailPOS.tsx`: 1 pre-existing warning (base branch).
- `npm run build` — **pass** with placeholder Supabase env vars (without env it fails
  during prerender on missing Supabase public vars — pre-existing environment
  limitation, unrelated to this change).
- Browser checks — **38/38 pass** (phone + desktop), real components, 5,000-SKU fixture.

## Known pre-existing limitations (not introduced here, not changed)

- Product fetch errors on the Products page are logged to console without a distinct
  request-failure UI state, and the fetch has no stale-response guard if the
  organization changes mid-flight. Ranking itself is synchronous and race-free, but
  the async *loading* path predates this change and was left untouched to avoid
  broadening the redesign.
- Product-history search filters transactions by product-name substring — a different
  path, intentionally unchanged.

## Suggested next step

Review the uncommitted worktree. If accepted, the visits-page 1,000-row cap (§7) needs
a client-side pagination/search pass against the existing `/api/products/list`
parameters (or a Codex-owned server-side ranked search) before product search can be
called complete for catalogs over 1,000 SKUs. Awaiting review — **no commit, push,
merge, or deploy performed.**
