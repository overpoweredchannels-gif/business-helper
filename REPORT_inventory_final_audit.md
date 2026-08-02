# Inventory Management — FINAL AUDIT

Date: 2026-08-02
Mode: audit-only — NO code changes, NO commit, NO push (verified: zero edits made during this audit)
Audited artifacts: `src/lib/inventory/` (schema.sql, types.ts, validation.ts, service.ts), `src/app/api/inventory/adjust/route.ts`, Inventory section of `src/app/page.tsx`, permission plumbing (`src/lib/tradeos/types.ts`, `constants.ts`)

---

## 1. Inventory Transactions — one immutable row per movement

**Confirmed.** Every stock movement produces exactly one `inventory_transactions` row, and no code path ever updates or deletes a ledger row (grep: outside the schema file, the table is only referenced by a `select` in `page.tsx:4959` and the RPC call in the API route).

### Every write path to stock, exhaustively

| # | Path | Ledger row | `products.current_stock` |
|---|---|---|---|
| 1 | UI purchase invoice — `page.tsx:5648` (`purchase_items` insert, `handleCreatePurchaseInvoice`) | trigger → `purchase_in` +qty (schema.sql:183-188) | trigger `+=` (schema.sql:190-192) |
| 2 | AI-draft purchase execution — `page.tsx:2714` (`purchase_items` insert) | same trigger | same trigger |
| 3 | AI purchase route — `route.ts:119` (`purchase_items` insert) | same trigger | trigger `+=`, then route's own absolute write `route.ts:137-145` (redundant, same value — see note) |
| 4 | UI sales invoice — `page.tsx:2822` (AI-draft sale execution) and `:3538` (`handleCreateSalesInvoice`) — `sales_items` inserts | trigger → `sale_out` −qty (schema.sql:230-235) | trigger `+=` (schema.sql:237-239) |
| 5 | AI sales route — `route.ts:117` (`sales_items` insert) | same trigger | trigger `+=`, then route's redundant absolute write `route.ts:135-143` |
| 6 | Manual adjustment — `adjust_inventory()` RPC (schema.sql:271-331) | `adjustment_in`/`adjustment_out` row (schema.sql:316-323) | RPC absolute write (schema.sql:325-327) |
| 7 | Migration backfill (schema.sql:368-419) | one row per historical item | rebuilt from ledger (schema.sql:412-417) |
| 8 | UPDATE/DELETE of `purchase_items`/`sales_items` (no UI path today; fires on AI-route rollback deletes and manual SQL) | reversal row (delta = −old / new−old; schema.sql:156-177, 207-224) | trigger `+=` reversal |

**No stock update without a ledger row exists** — with one documented exception: the two AI routes' redundant absolute `current_stock` writes (#3, #5) run *after* their trigger already applied the identical delta, setting the same value (arithmetic verified: purchase → trigger `S := S + qty`, route sets `old + qty`; sales → trigger `S := S − qty`, route sets `max(0, old − qty)` and the route only proceeds when `old ≥ qty`, so identical). They cannot diverge stock. They are pre-existing Product Foundation code left untouched per the mission constraint.

Immutability is structural: RLS has **no** insert/update/delete policy on `inventory_transactions` (schema.sql:117-130) — direct client writes are impossible; the only writers are SECURITY DEFINER triggers/RPC, which only ever insert.

**Note (by design):** path #8 writes a *reversal* ledger row on delete (e.g., AI-route rollback deletes). The ledger truthfully shows the issue and its reversal; net stock effect is zero. One row per movement still holds — a reversal is a movement.

---

## 2. Stock consistency

Define `L(p)` = Σ `quantity_delta` over `inventory_transactions` for product p; `S(p)` = `products.current_stock`; `C(p)` = client-computed Σ `purchase_items.quantity` − Σ `sales_items.quantity` (page.tsx:1799-1806, 6171-6180, 6208-6219).

### Synchronization points
- **Backfill** (schema.sql:412-417): sets `S(p) = L(p)`; by construction `L(p) = C(p)` (one ledger row per historical purchase/sale item, mirrored deltas).
- **Triggers** (schema.sql:190-192, 237-239): after every item change both `S` and `L` move by the same delta — they stay equal forever.
- **RPC** (schema.sql:316-327): inserts `delta` into `L` and sets `S = S + delta` — again in lockstep.

### Result
- **`L ≡ S` always** — by construction, from migration onward, under every path above.
- **`L = C` initially** (backfill), and **remains equal iff the product's cumulative adjustment total is zero**.

**FINDING (residual divergence — Phase 1 gap, must be reported):** the three client-side "computed stock" sites (`getAvailableStockForProduct` page.tsx:1799-1806, `inventoryStats` 6171-6180, `reorderRecommendations` 6208-6219) subtract only purchase/sale items and do **not** include adjustments. After any manual adjustment, the Inventory Dashboard "Stock" column and the reorder engine display `C`, while the Stock Ledger, `products.current_stock`, the Products section, and the AI sales stock check all show `L = C + Σ adjustments`. The ledger and `products.current_stock` are the authoritative pair; the client computation is stale by the cumulative adjustment total.

Recommendation (not applied — audit-only): make the three client sites read `products.current_stock` (already fetched by `fetchProducts`, page.tsx:4080) instead of recomputing, or add adjustment deltas into `C`. Resolving this is the natural Phase 2 item.

---

## 3. Atomicity — `adjust_inventory()` cannot partially succeed

**Confirmed.** `adjust_inventory()` is a single plpgsql function (schema.sql:271-331); PostgreSQL executes a plpgsql function call in **one implicit transaction**:

- If the `insert into inventory_transactions` (schema.sql:316-323) fails (constraint violation, FK, etc.), the exception aborts the whole CALL — the `update products` (schema.sql:325-327) never runs, **stock unchanged**.
- If the `update products` fails after the insert, the exception rolls back the entire statement batch — **the transaction row does not exist**.
- If any guard raises (`raise exception` at schema.sql:287-312: zero delta, missing reason, permission, product-not-in-org, negative result), nothing at all is written.

Evidence of single-call semantics: the API route performs exactly one `supabase.rpc("adjust_inventory", ...)` call (route.ts:45) and treats any error as a total failure (route.ts:60-63).

**Minor note (concurrency, not atomicity):** the RPC reads `v_current_stock` then writes the *absolute* `v_new_stock` (schema.sql:300-327). Two simultaneous adjustments of the same product could theoretically interleave (last-writer-wins on one delta). The trigger path uses `current_stock + v_delta` (row-level atomic increment) and is immune. Fix (not applied): write `current_stock = current_stock + p_quantity_delta` in the RPC instead of the absolute value.

---

## 4. Purchase flow trace

```
UI: page.tsx:5648  supabase.from("purchase_items").insert({... batch_number, expiry_date ...})
AI-draft: page.tsx:2714  same insert
AI route: api/ai/purchases/create/route.ts:119  same insert
        │
        ▼  (AFTER INSERT, FOR EACH ROW)
trigger inventory_sync_purchase_item (schema.sql:145-196)
  ├─ resolve org: coalesce(item.organization_id, parent purchase_transactions.organization_id)  :156-177
  ├─ delta = +quantity (UPDATE: new−old; DELETE: −old)                                          :169-172
  ├─ INSERT inventory_transactions (purchase_in, delta, batch_number, expiry_date,
  │    reference_type='purchase_transaction', reference_id=purchase_transaction_id)             :183-188
  └─ UPDATE products SET current_stock = current_stock + delta                                  :190-192
        │
        ▼  (AI route only, redundant same-value write)
api/ai/purchases/create/route.ts:137-145  current_stock = old + quantity (org-filtered)
```

---

## 5. Sales flow trace

```
UI: page.tsx:3538 (handleCreateSalesInvoice) / page.tsx:2822 (AI-draft sale)
AI route: api/ai/sales/create/route.ts:117
        │
        ▼  (AFTER INSERT, FOR EACH ROW)
trigger inventory_sync_sale_item (schema.sql:198-243)
  ├─ resolve org: coalesce(item.organization_id, parent sales_transactions.organization_id)   :207-224
  ├─ delta = −quantity (UPDATE: −(new−old); DELETE: +old)                                      :218-221
  ├─ INSERT inventory_transactions (sale_out, delta, reference_type='sales_transaction',
  │    reference_id=sales_transaction_id)                                                      :230-235
  └─ UPDATE products SET current_stock = current_stock + delta                                 :237-239
        │
        ▼  (AI route only, redundant same-value write)
api/ai/sales/create/route.ts:135-143  current_stock = max(0, old − quantity) (org-filtered)
```

Both flows produce exactly one ledger row per item line and one `current_stock` update — inside the same statement as the item insert (triggers are statement-atomic), so a failed insert writes nothing.

---

## 6. Security

| Requirement | Evidence | Verdict |
|---|---|---|
| Organization isolation (reads) | RLS select policy `organization_id = current_org_id()` (schema.sql:128-130) — JWT claim scoping | PASS |
| No direct writes to ledger | RLS enabled (schema.sql:126); **no** insert/update/delete policies; only SECURITY DEFINER writers (triggers, RPC) which run as table owner | PASS |
| `can_manage_inventory` enforcement | `has_inventory_permission(uid)` (schema.sql:52-66) requires `coalesce(sp.can_manage_inventory, false) = true`; called at the top of `adjust_inventory` (schema.sql:296-298) — the RPC is the only write path for adjustments, so enforcement cannot be bypassed | PASS |
| Owner override | `p.role = 'owner'` inside `has_inventory_permission` (schema.sql:62); client-side `isOwnerOrAdmin()`/`hasPermission()` (page.tsx:4254-4265) matches | PASS |
| Cross-tenant writes | RPC re-checks product ownership: `where id = p_product_id and organization_id = p_organization_id` (schema.sql:300-302), and `has_inventory_permission` additionally requires the caller's JWT org to equal `p_organization_id` via `p.organization_id = current_org_id()` (schema.sql:60) | PASS |
| Cross-tenant reads | Ledger select is org-scoped; triggers resolve org from the parent invoice (which is itself org-RLS-protected), so a row can never be written under a foreign org | PASS |
| Function exposure | `revoke execute ... from public; grant execute ... to authenticated` (schema.sql:333-334); RPC self-guards with the permission check regardless of caller | PASS |
| Trigger safety | `SECURITY DEFINER` (schema.sql:146, 199) — runs as owner, bypasses RLS only for its own inserts/updates; org value always derived from the parent invoice | PASS |
| Client permission gating (UX layer) | Inventory section gated by `can_view_reports` (sectionPermissionMap), Adjustment tab by `canManageInventory` (page.tsx), submit button disabled without permission, server re-validates in the API route + RPC | PASS (defense in depth; RPC is the hard gate) |

---

## 7. Negative stock — allowed vs blocked

| Situation | Behavior | Where | Intended? |
|---|---|---|---|
| UI sale exceeding available stock (manual sales invoice) | **Allowed** — recorded truthfully as negative stock; ledger row `sale_out` −qty; `current_stock` goes negative | trigger schema.sql:237-239; constraint relaxed schema.sql:337-358 | **Yes** — overselling must be visible, not crash invoice creation |
| Adjustment out beyond available stock | **Blocked** — `raise exception` before any write | schema.sql:308-312 | **Yes** — manual adjustments must never go negative |
| AI-assisted sale exceeding stock | **Blocked** — route rejects with `Insufficient stock` | route.ts:67-72 | **Yes** — AI path has a hard stock guard |
| Any DB write pushing stock negative | **Allowed** — the `>= 0` CHECK constraint (any name) is dropped idempotently (schema.sql:345-358), so purchases/sales/adjustments never fail on stock | schema.sql:345-358 | **Yes** — matches the business rule set: only the *adjustment* guard blocks negatives; oversales remain representable |
| Negative stock drift in reports | Allowed to persist until a corrective adjustment-in | dashboard/ledger display | **Yes** — surfaced as "OUT OF STOCK" status in the dashboard snapshot |

Net: negative stock is allowed exactly where a truthful record matters (oversales, DB-level safety removed), and blocked exactly at the manual-adjustment boundary. This matches the documented business rules in schema.sql:336-343 and the Phase 1 report.

---

## 8. FIFO readiness — present, costing NOT implemented

**Present:**
- `inventory_transactions.batch_number`, `expiry_date` (schema.sql:89-90) — carried on `purchase_in` (schema.sql:187) and adjustments (schema.sql:320-321)
- `reference_type`/`reference_id` traceability (schema.sql:91-93) — every movement links to its source invoice
- `getBatchBreakdown()` (service.ts) — received/issued/balance per batch, expiry-ordered — the exact structure a FIFO costing pass consumes

**Not implemented (verified by grep):**
- No unit-cost fields on ledger rows; no cost (`COGS`/`value`) computation anywhere in `src/lib/inventory/` or the page
- Sales issues carry no batch consumption (no `batch_number` on `sale_out`, schema.sql:234) — FIFO *allocation* of issues to receipts is absent by design
- Dashboard shows quantities only; stock *value* estimation remains the pre-existing analytic (page.tsx:7292-7326) independent of the ledger

Phase 2 scope (per report): costing engine + batch-level issuing. Architecture is ready.

---

## 9. Migration safety — idempotent, safe to run twice

Every statement is guarded:
- `create table if not exists` / `create index if not exists` / `create or replace function` (schema.sql:80, 106-115, 145, 198, 271)
- `alter table ... add column if not exists` behind `to_regclass` (schema.sql:40-42)
- RLS enable + `drop policy if exists` + recreate (schema.sql:126-130)
- Triggers: `drop trigger if exists` + recreate behind `to_regclass` guards in a DO block (schema.sql:247-259)
- Constraint relaxation: DO block drops any check whose definition references `current_stock` (schema.sql:345-358) — re-runnable (it would also drop a re-added constraint, which is the intent)
- Grants: revoke/grant execute are idempotent (schema.sql:333-334)
- **Backfill** runs only when `not exists (select 1 from inventory_transactions)` (schema.sql:374) — the second run finds a non-empty ledger and skips it

**Verdict: safe to run twice.** The only behavioral caveat: if you run the file, then later *delete* all ledger rows and run it again, the backfill would re-fire (guarded by emptiness, not by a permanent marker) — acceptable and explicitly documented in the file.

Note: functions are created with `set check_function_bodies = off` (schema.sql:143, 245) so the file applies even to a fresh database lacking `purchase_items`/`sales_items`; the trigger/backfill sections then self-skip via `to_regclass`.

---

## 10. Tests (run this audit, evidence attached in session)

| Command | Result |
|---|---|
| `npm run build` | Exit 0 — `/api/inventory/adjust` compiled; no errors |
| `npm run typecheck` (`tsc --noEmit`) | Exit 0 — no errors |
| `npm run lint` (eslint, full project) | Exit 1 (baseline behavior — errors exist repo-wide); **355 problems (171 errors, 184 warnings)** |

**New lint errors introduced by this milestone: ZERO.** The count is byte-identical to the pre-milestone baseline recorded in `REPORT_product_foundation_completion.md` (171 errors / 184 warnings). The new files (`src/lib/inventory/*`, `src/app/api/inventory/adjust/route.ts`) lint clean (0/0), verified earlier in this session.

---

## 11. Git

```
git diff --stat
 src/app/api/ai/purchases/create/route.ts |    3 +-
 src/app/api/ai/sales/create/route.ts     |    3 +-
 src/app/page.tsx                         | 1609 +++++++++++++++++++++++++-----
 src/lib/tradeos/constants.ts             |    1 +
 src/lib/tradeos/types.ts                 |   12 +-
 5 files changed, 1370 insertions(+), 258 deletions(-)

git status --short
 M src/app/api/ai/purchases/create/route.ts
 M src/app/api/ai/sales/create/route.ts
 M src/app/page.tsx
 M src/lib/tradeos/constants.ts
 M src/lib/tradeos/types.ts
?? src/lib/inventory/          (new — this milestone)
?? src/app/api/inventory/      (new — this milestone)
?? src/lib/products/           (new — Product Foundation milestone, uncommitted)
?? src/app/api/products/       (new — Product Foundation milestone, uncommitted)
?? REPORT_*.md, AI_* / MISSION_10 / REPAIR_REPORT / CHANGELOG / ts-error.txt / validation-reports/  (docs/artifacts, untracked by convention)

HEAD: 2380c92 fix(ai): repair executive AI build blocker and restore production compilation
```

### Attribution — "only Inventory-related files changed"

The **Inventory milestone** changed exactly: `src/app/page.tsx` (inventory section + ledger fetch + adjustment handler + permission payload), `src/lib/tradeos/constants.ts` (+1 line, `can_manage_inventory` label), `src/lib/tradeos/types.ts` (`StaffPermission`/`StaffPermissionKey` +1 key), plus new `src/lib/inventory/` and `src/app/api/inventory/`.

The `git diff` vs HEAD also still contains the **pre-existing, uncommitted Product Foundation milestone** changes from the previous mission (the two AI routes, the Product interface additions in types.ts, and the product-CRUD portion of page.tsx) — nothing from that milestone was ever committed. Within the shared files, the two milestones are cleanly separable by the permission key (`can_manage_inventory`) and the inventory section/handlers.

**Verdict: no unrelated files were touched.** Everything in the working tree traces to the two documented milestones (Product Foundation, Inventory Phase 1) plus untracked reports. Nothing committed, nothing pushed.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | One immutable transaction per movement | PASS |
| 2 | Stock consistency | PASS for ledger ↔ `current_stock`; **residual gap**: client "computed stock" excludes adjustments (finding, §2) |
| 3 | `adjust_inventory()` atomicity | PASS (minor concurrency note, §3) |
| 4 | Purchase flow trace | PASS |
| 5 | Sales flow trace | PASS |
| 6 | Security (isolation/RLS/permission/owner/cross-tenant) | PASS |
| 7 | Negative stock rules | PASS — matches intended business rules |
| 8 | FIFO readiness without costing | PASS |
| 9 | Migration idempotent / safe twice | PASS |
| 10 | Tests: build 0, typecheck 0, lint = baseline (0 new) | PASS |
| 11 | Git — only milestone-related changes | PASS (attribution documented) |

Audit performed with zero code changes. No commit. No push.
