# Task navigation review

Base: `review/pos-percent-audit` at `ddb6264`.

The owner menu contains 36 destinations. Normal expanded navigation now shows Dashboard and six task disclosures. The current section's group opens automatically. Search finds page labels and task names across the supplied, visible menu items.

| Task | Destinations |
| --- | --- |
| Home | Dashboard |
| Sell | Sales (including the existing Retail POS view) |
| Stock | Products, Inventory, Brands, Categories |
| Buy | Purchases, Suppliers, Supplier Ledger |
| Customers | Customers, Customer Credit |
| Money | Customer Payments, Supplier Payments, Expenses, Profit & Loss |
| More | Setup & Data Import, Business Intelligence, Export Business Records, AI Analytics, Business Settings, Task Manager, Activity Logs, Staff & Permissions, Security Check, Deployment, Staff Duty, AI Assistant, AI Business Query, AI Voice Operator, Market Intelligence, Live Tracking, Mobile App, Employees, Territories, Routes, Notifications |

`page.tsx` continues to filter permissions before passing items into Sidebar. Grouping does not construct additional destinations or change permissions, section IDs, hash navigation, or data calls. Hidden IDs are filtered before grouping and searching. Saved relative order is retained within each task; task group order is fixed. Customization and the collapsed icon sidebar retain the original flat ordered list. Customization can still show hidden permitted entries. Both desktop and the existing mobile overlay use the same Sidebar.

Checks: `npm run test:dashboard` includes destination coverage and restricted/hidden menu render regressions. `node e2e/navigation-visual.cjs` checks 360/390/768/1440 widths, keyboard disclosure, active state, search, customization, and a restricted menu. Set `POS_CHROME_PATH` to the installed Chrome executable on Windows if needed. This fixture tests the menu with prefiltered input; it is not authenticated role/RLS evidence and does not test the mobile overlay's focus trap.

The owner dashboard content, tutorial, product form and performance profiling remain separate audit tasks. Actual first-sale timing and user discovery of grouped pages still need observation. Existing POS database and physical-print release gates remain open.

## Implementation verification

- Passed: `npm run typecheck`, changed-file ESLint (zero errors/warnings), `git diff --check`, and production build with localhost placeholder Supabase settings.
- Passed directly with `node --import tsx`: `scripts/test-navigation-groups.tsx` and `scripts/test-dashboard-customization.ts`.
- Blocked: `npm test` fails in the runner's IPC startup (`listen EPERM` on `/tmp/tsx-0/31.pipe`), before application assertions.
- Browser runner bundled successfully but could not launch: Chromium is absent and the browser download returned a truncated archive. Browser interaction and screenshots remain unverified here; run `node e2e/navigation-visual.cjs` on Windows with installed Chrome.
- Git push failed because this environment lacks GitHub write credentials. The commit is supplied as a git-am patch based on `ddb6264` for the Windows review worktree.

These blocked checks are historical results from the earlier navigation-review runner and checkout. The owner-home follow-up below was checked in a separate Windows worktree; it does not retroactively turn the earlier navigation or authenticated integration checks into passes.

## Owner dashboard follow-up — Windows (2026-09-30)

The default owner-home order now presents the existing Quick Actions first, then daily figures and current actionable alerts. New Sale is the only filled primary action in that shortcut group; inventory, purchase and payment actions remain available. KPI copy distinguishes today-based sales/profit from current inventory, receivable and payable balances. Completed setup, quick-sale guidance and export panels appear after the business dashboard, while incomplete setup remains above it. Existing hidden-widget and added-section preferences remain in storage and continue to take effect; the new order is only the default render order.

Browser evidence is from a synthetic component fixture in Playwright Chromium, not an authenticated application session. `node e2e/owner-home-visual.cjs` passed at 360, 390, 768 and 1440 CSS px with no horizontal overflow. It checked shortcut destinations, keyboard activation and visible focus for a KPI, actionable alert destinations, omission of zero-count alerts and unavailable optional KPIs in empty data, and saved hidden/added cards through reload plus restoration through Edit home. The fixture does not model authenticated roles, Supabase loading, or Supabase query failures. `DashboardView` has no explicit loading/error state inputs; those states remain unverified and require a disposable authenticated app environment if they are to be tested end to end.

Before/after browser screenshots are generated under `e2e/test-results/owner-home/` in the Windows worktree: `before-360.png`, `before-390.png`, `before-768.png`, `before-1440.png`, `after-360.png`, `after-390.png`, `after-768.png` and `after-1440.png`. They are local test artifacts and are not committed.

Verification in the owner-home worktree: `npm run typecheck`, changed-file ESLint, `npm run test:dashboard`, `npm test`, and `$env:POS_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'; node e2e/owner-home-visual.cjs` passed. The first default Playwright launch could not find its bundled Chromium executable; retrying with the installed Windows Chrome passed. ESLint reported no errors; the large existing `src/app/page.tsx` reports 168 warnings, with the only warning in the edited region at an unchanged line. `npm run build` passed with localhost-only Supabase placeholders and no `.env*` files in the worktree. Static generation logged that `GOOGLE_MAPS_API_KEY` is unset; map features are outside this dashboard change.
