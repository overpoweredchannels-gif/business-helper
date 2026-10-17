# REPORT: Product search relevance and usability — review evidence

Date: 2026-10-02 · Branch: `review/product-search-usability` (worktree `~/workspace/tradeos-product-search`)
Base SHA: **`ddb6264ee2c05b32954b30b81d352c869861d668`** (`origin/review/pos-percent-audit` — "fix(pos): validate receipt and restored employee drafts")

Base choice: `origin/review/pos-percent-audit` (tip `ddb6264`) descends from `aa977d5`
(`origin/review/pos-atomic-sales`) and contains all of its product-search/POS UI work plus
later discount/receipt fixes. `main` lacks that UI work. Git status was clean at branch
creation; no uncommitted edits needed preserving.

**Published 2026-10-02 (normal push, no force):** the scoped search change is committed as
`6c8beb4a45652fc1accda782db5a2061c9f99f8b` on `review/product-search-usability`, and
cherry-picked onto `review/product-search-integration` as
`a2e85d2b425e865578aa9e01651641d8631f9161` (clean base `042fb807`, only `package.json`
conflicted). Direct-review corrections (code prefix/substring ranks, prebuilt rank-field
maps) and the date-sensitive `test:sales-atomicity` fix were committed as follow-ups on
`review/product-search-integration` and pushed normally. **No merge into `main`, no
deployment, no Vercel or database changes.**

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

- **`src/lib/products/search-rank.ts` (new).** Shared, dependency-free ranking
  contract — 0: exact barcode/SKU (highest priority) → 1: exact normalized name →
  2: name starts-with → 3: SKU/barcode starts-with (code prefix) → 4: a name word
  starts-with → 5: query word inside a SKU/barcode (code substring) → 6: every
  query word present in the name (broader substring matches land here, *below* the
  precise ranks) → 7: every query word present across name/SKU/barcode/brand/
  category (combined-label parity; brand/category-only matches land here, the
  lowest rank). The agreed name ranking keeps its relative order; code ranks slot
  into the documented positions. For multiword queries every word must match some
  field, and the product rank is the best word rank. Deterministic within a rank
  by normalized name then id. Case/whitespace normalized. No fuzzy matching. Also
  exports `highlightSearchMatches`, which splits text into plain-string segments
  for safe `<mark>` rendering (no HTML parsing, no injection surface).
- **`src/app/page.tsx`.** `filteredProducts` uses `rankSearchResults`; brand/category
  names resolved via memoized `Map`s (replacing per-row `.find`). Product names render
  matched terms in `<mark class="rounded-sm bg-primary/10 px-px text-inherit">`
  (design-token classes only). The invoice-line selector now receives memoized option
  and rank-field structures built in one pass (`invoiceProductOptions`,
  `invoiceProductRankFields`) — no inline callbacks or per-render arrays.
- **`src/components/invoices/ProductSearchSelect.tsx`.** New optional `rankedFields`
  prop: a caller-built `Map<id, SearchRankFields>` (O(1) lookup per candidate; the
  per-keystroke O(n²) `.find` from the first iteration was fixed at the callers).
  Suggestions are memoized on `[products, query, rankedFields]`, so parent rerenders
  do not re-rank. Customer selectors omit the prop and keep the legacy label filter.
  Keyboard nav, Enter, Escape, focus, and ARIA paths untouched.
- **`src/components/sales/RetailPOS.tsx`.** POS "Find product" passes memoized
  `productOptions` + `productRankFields` built in one pass over `products`.
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

- `"Whey Protein"` matches `"Hey"` at **rank 6** (all query words in the name), ordered
  **below** word-prefix matches (rank 4): end-to-end order is
  `Hey` < `Hey Shampoo` < `Premium Hey Soap` < `They Detergent` < `Whey Protein`.
- **Partial SKU/barcode matching** (regressions where the product name does *not*
  contain the code): exact code keeps rank 0 (`"HEY-001"` → rank 0 even when the
  name is "Premium Soap"); code prefix is rank 3 (`"hey-00"`); code substring is
  rank 5 (`"00"`, `"0011"` against a barcode). Name ranks keep their relative
  order: for query `"Hey"`, `Hey` (1) < `Hey Shampoo` (2) < a code-prefix-only
  product (3) < `Premium Hey Soap` (4).
- **Multiword name+brand+SKU** (legacy combined-label parity): `"sufi 5l"` finds
  "Sufi Cooking Oil" / `SUF-OIL-5L` at rank 4 (name word + SKU substring across
  fields) and excludes the 1L variant; `"oil suf-oil-5l"` ranks at 0 (name word +
  exact SKU); `"sufi oil"` matches a brand word + name word; a query word matching
  no field excludes the product.
- Brand-only and category-only matches rank **7 (lowest)**; unrelated products excluded.
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

**58/58 checks pass** at **390×844 (phone)** and **1440×900 (desktop)**, driving the
*real* `ProductSearchSelect` and `search-rank` modules bundled from `src` with the
synthetic 5,000-SKU fixture (`scripts/browser-product-search.mjs`, Chromium,
inline bundle — no backend, no credentials involved):

Products list: typing "Hey" → exact "Hey" first; "Whey Protein" (full-rank index 389)
below word-prefix "Premium Hey Soap" (index 387); `<mark>` wraps the matched text with
no unescaped markup; Clear restores all 5,000; "nonexistent-xyz-123" → the exact
no-results message; both "Sufi Cooking Oil" variants listed and SKU-distinguishable;
price/stock row (`Price: 120 · Stock: 40`) byte-identical after ranking; ranked result
set equals the filtered set (ranking adds/removes nothing — tenant/role filtering
untouched, since `rankSearchResults` only reorders the caller's already-authorized array).
Multiword `"sufi 5l"` finds the 5L variant (36 ranked) and excludes the 1L variant.

Selectors — beyond typing inside an already-mounted selector: **initial mount** completes
cleanly (~53 ms phone, ~62 ms desktop, zero page errors); a **parent rerender** with
unchanged products/query performs **zero additional rank-field lookups** (counted via a
counting `Map`: 20000 → 20000) and leaves results unchanged; **POS flow** — type exact
SKU `SUF-OIL-5L`, Enter, "Add item" — the basket row keeps the correct product id
(`basket-p-oil-a`) and price (`Sufi Cooking Oil — 2850`); **three invoice lines**
select independently and resolve the correct ids
(`line-0: p-hey-exact`, `line-1: p-oil-a`, `line-2: p-whey`) with each line's label
reflecting its own selection. Standard selector behavior also verified: input receives
focus; suggestions rank exact "Hey" first; ArrowDown/ArrowUp move the active option;
**Enter selects the correct product id** (`p-hey-exact`); Escape closes the dropdown;
unknown query → "No matches found" status; zero page errors.

**Not altered by ranking/highlighting:** price, unit, quantity, stock text, or the set
of items the caller authorized. Verified by row-content and ID-set comparisons.

## 6. Performance measurement (clarified)

- **8–9 ms** = `rankSearchResults` **helper execution only**, measured in Node via
  `tsx` on this VM: 5,000 synthetic SKUs, 20 runs per keystroke query ("H"→"Hey Sha"),
  median 8–9 ms, p95 10–22 ms (`scripts/bench-product-search.ts`). It does **not**
  include React rendering.
- **Keystroke-to-paint in a real browser** (input event → 2×`requestAnimationFrame`
  after React commits, 5,000-SKU fixture, real components mounted): **phone median
  ~20 ms, p95 ~33 ms; desktop median ~26 ms, p95 ~46 ms** across 11 sampled
  keystrokes at both viewports. Well under the ~100 ms "instant" threshold.
- **Initial mount** (5,000 products, 5 selector instances): **~53–62 ms** to painted
  and interactive, zero page errors.
- **Parent rerenders do not re-rank**: with memoized option/field structures, a
  parent rerender performs zero additional rank-field lookups and suggestions stay
  identical (verified with a counting `Map` in the browser lab).
- **No debounce added** — measurements do not justify it. Rank-field lookup is O(1)
  per candidate; matching work is memoized on `[products, query, rankedFields]`.

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
- `test:sales-atomicity` — **pass** (was failing on 2026-10-02; fixed in its own
  commit, see below — test-only change, no production sales logic touched).
- Full suite: **34/34 scripts pass individually** (`npm test` chain runs to
  completion).
- `npm run typecheck` — **pass**.
- ESLint on changed TS/TSX files — **0 errors**; one pre-existing `RetailPOS.tsx`
  warning (also on the base branch).
- `npm run build` — **pass** with placeholder Supabase env vars (without env it fails
  during prerender on missing Supabase public vars — pre-existing environment
  limitation, unrelated to this change).
- Browser checks — **58/58 pass** (phone + desktop), real components, 5,000-SKU fixture.
- POS discount controls remain byte-identical to the integration base (zero diff
  lines touch discount logic); dashboard/navigation semantic compatibility verified
  through the dashboard test suites.

### `test:sales-atomicity` date-sensitivity — fixed in its own commit (test-only)

- **Was failing:** on 2026-10-02, `scripts/test-sales-atomicity.ts:434` threw
  `Customer has overdue credit invoices` from `create_sales_invoice_atomic` (function
  line 207). The fixture used a hard-coded `sale_date: "2026-09-26"` with the
  customer's `credit_days: 5`, so the first credit invoice's due date was 2026-10-01 —
  past due on the run date — and the overdue guard blocked the later override path.
  The error escaped `main()` (not wrapped in `assert.rejects`), exit code 1. The
  failure reproduced identically on the unmodified base `042fb807`: pre-existing,
  unrelated to search.
- **Fix (no production logic changed):** fixture dates are now derived from the
  database clock — `select (current_date - 4)::text as sale_date,
  (current_date + 1)::text as due_date` — so the first credit invoice's due date
  always lands tomorrow, on any run date. The due-date assertion checks
  `credit.transaction.credit_due_date` against the derived due date instead of the
  hard-coded `"2026-10-01"`. The deadline was **not** merely pushed further into the
  future; it is computed from `current_date` on every run.
- **Preserved:** the explicit overdue assertions (overdue customer's legacy invoice
  still due `current_date - 1`; override-confirmation flow still asserted) and the
  credit-limit assertions are unchanged.

## Known pre-existing limitations (not introduced here, not changed)

- **Loading state:** product fetch errors on the Products page are logged to console
  without a distinct request-failure UI state — a spinner/error distinction for the
  catalog load was not added.
- **Stale-response / account-switch race:** the product fetch has no stale-response
  guard if the organization (account) changes mid-flight; a slow response from the
  previous organization could overwrite the new organization's catalog. Ranking
  itself is synchronous and race-free, but the async *loading* path predates this
  change and was left untouched to avoid broadening the redesign.
- Product-history search filters transactions by product-name substring — a different
  path, intentionally unchanged.

## Suggested next step

Both review branches are published (`review/product-search-usability` @ `6c8beb4`,
`review/product-search-integration` @ `a2e85d2` + review-correction and atomicity-fix
follow-ups). If accepted, the visits-page 1,000-row cap (§7) needs a client-side
pagination/search pass against the existing `/api/products/list` parameters (or a
Codex-owned server-side ranked search) before product search can be called complete
for catalogs over 1,000 SKUs. Awaiting planner review — **no merge into `main`, no
deployment, no Vercel or database changes.**
