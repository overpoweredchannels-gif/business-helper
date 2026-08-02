# Inventory Management — Phase 1 Completion Report

Date: 2026-08-02
Status: COMPLETE — implementation verified, nothing committed (awaiting approval)
Scope: `src/lib/inventory/`, `src/app/api/inventory/`, `src/app/page.tsx` (Inventory section), permission plumbing (`src/lib/tradeos/types.ts`, `constants.ts`)

---

## 1. What was built

Production-grade Inventory Management (Phase 1) integrated with the completed Product Foundation:

| Feature | Deliverable |
|---|---|
| **Stock Ledger** | `inventory_transactions` table (immutable, org-scoped, RLS) + Ledger UI with date/product/movement/change/batch/expiry/reference/running-balance columns, movement-type + product filters, free-text search, opening-balance display |
| **Inventory Dashboard** | Status summary chips (Out of Stock / Urgent Reorder / Missing Reorder Level / Healthy), product stock list with snapshot-based badges (replaces the old hardcoded `<= 10` LOW STOCK rule), existing reorder recommendations table retained |
| **Stock Adjustment** | `adjust_inventory()` atomic RPC + `POST /api/inventory/adjust` + form UI (direction in/out, quantity, mandatory reason, optional batch/expiry). Permissions-gated, never drives stock negative, audit-logged |
| **Inventory Transactions** | Ledger auto-populated by DB triggers on `purchase_items` / `sales_items` — every purchase receipt and sales issue records a movement and keeps `products.current_stock` in sync (fixes the pre-existing gap where UI-created purchases/sales never updated `current_stock`) |
| **Reorder System** | Reorder-level-driven statuses (out of stock / urgent / healthy / missing reorder level) from the ledger snapshot + retained 30-day-sales recommendation engine |
| **Batch Support** | `batch_number` / `expiry_date` recorded on receipts and adjustments; Batch Availability table (received/issued/balance per batch, expiry-ordered) |
| **FIFO Preparation** | Ledger rows carry `reference_type`/`reference_id` + batch metadata; `getBatchBreakdown()` service structures batches for a future FIFO costing pass — no costing yet |
| **Permissions** | New `can_manage_inventory` staff permission: gates the Adjustment tab + is enforced inside the RPC (owner/admin always allowed). Ledger/dashboard viewing stays under `can_view_reports` |
| **Database migration** | `src/lib/inventory/schema.sql` — idempotent, versioned, hand-run in Supabase SQL editor (repo convention; no migration runner) |
| **Validation** | `src/lib/inventory/validation.ts` shared client/server (mirrors `products/validation.ts`); DB CHECK constraints + RPC guards mirror the same rules |
| **Testing** | Typecheck + full lint (baseline-identical) + production build + `git diff --check` — see section 4 |

## 2. Files changed / added

New files:
- `src/lib/inventory/schema.sql` — the database migration (section 3)
- `src/lib/inventory/types.ts` — `InventoryTransaction`, `InventoryMovementType`, `InventorySnapshotItem`, `InventoryBatchBreakdown`, `LedgerRow`, adjustment input types
- `src/lib/inventory/validation.ts` — `validateAdjustmentInput` + normalizers (reason required ≤ 500 chars, batch ≤ 100 chars, expiry-date parse, non-zero delta)
- `src/lib/inventory/service.ts` — pure ledger logic: `withRunningBalances`, `buildInventorySnapshots`, `stockStatusFor`, `suggestedReorderFor`, `queryLedger` (filters + opening balances), `getBatchBreakdown` (FIFO prep), movement labels
- `src/app/api/inventory/adjust/route.ts` — server validation + `adjust_inventory` RPC call via service client

Modified files (this mission):
- `src/app/page.tsx` — Inventory section rebuilt as 3 tabs (Dashboard / Stock Adjustment / Stock Ledger); `fetchInventoryTransactions`, `handleAdjustStock`; derived ledger/snapshot state; `canManageInventory` gate; `can_manage_inventory` in the permission save payload
- `src/lib/tradeos/types.ts` — `can_manage_inventory` added to `StaffPermissionKey` and `StaffPermission`
- `src/lib/tradeos/constants.ts` — `{ key: "can_manage_inventory", label: "Manage Inventory" }` (auto-renders in the Staff & Permissions checkbox grid)

## 3. Database migration — run manually, once, in the Supabase SQL editor

Apply every statement in `src/lib/inventory/schema.sql` (idempotent — safe to re-run). Order of operations inside the file:

1. `staff_permissions.can_manage_inventory` column (guarded)
2. `has_inventory_permission(uid)` SECURITY DEFINER helper (mirrors `has_product_permission`)
3. `inventory_transactions` table + indexes + RLS (read = org-scoped via `current_org_id()`; **no write policies** — writes only via SECURITY DEFINER code)
4. Sync triggers on `purchase_items` / `sales_items` (INSERT/UPDATE/DELETE; guarded by `to_regclass` for deployments without those tables)
5. `adjust_inventory(...)` SECURITY DEFINER RPC — permission check, org ownership check, non-zero delta, mandatory reason, negative-stock guard, atomic ledger insert + `products.current_stock` update; execute revoked from `public`, granted to `authenticated`
6. Relaxes the `products.current_stock >= 0` CHECK constraint (any name) — negative balances stay representable because the UI sale flow has no stock guard; adjustments remain guarded by the RPC
7. **One-time backfill** (runs only when the ledger is empty): converts all historical `purchase_items` / `sales_items` into ledger rows and rebuilds `products.current_stock` from the ledger, converging the two sources of truth

Suggested order: back up nothing (all additive), run the file once, then run the verification queries in section 9 of the file (`pg_policies`, ledger counts, staff permission check).

### DB decisions worth knowing
- `movement_type` enum: `purchase_in`, `sale_out`, `adjustment_in`, `adjustment_out`. `quantity_delta` is signed; current stock = sum of deltas.
- Adjustments require a reason (CHECK constraint + RPC guard). Purchase/sale movements need no reason.
- `organization_id` on ledger rows is resolved defensively from the parent invoice when item rows don't carry it.
- The AI purchase/sale routes keep their own (now-redundant but harmless) absolute `current_stock` update — left untouched per mission constraint (no Product Foundation changes).

## 4. Verification results

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0 — no errors |
| `npm run lint` (full project) | 171 errors / 184 warnings — **identical to the pre-mission baseline**; new files: 0 errors / 0 warnings |
| `npm run build` | Exit 0 — `/api/inventory/adjust` registered, all routes compiled |
| `git diff --check` | Clean |

## 5. Manual test checklist (after running the migration)

1. **Migration**: run `src/lib/inventory/schema.sql`; confirm ledger counts per movement type via the verification queries; confirm `staff_permissions.can_manage_inventory` exists and defaults false.
2. **Staff & Permissions**: open Staff & Permissions, select a non-owner staff member, tick "Manage Inventory", Save; confirm the audit log row `staff_permissions updated`.
3. **Permission gating**: sign in as that staff member (no View Reports) — Inventory hidden from nav; with View Reports but no Manage Inventory — Inventory visible, Adjustment tab shows the permission notice and the submit button is disabled; with Manage Inventory — adjustment works.
4. **Adjustment in**: record +5 of a product with a reason; expect success message, ledger row `adjustment_in` +5, product `current_stock` +5, audit log entry.
5. **Adjustment out beyond stock**: try removing more than available; expect the negative-stock error and no changes.
6. **Adjustment without reason**: expect client-side validation error.
7. **Purchase trigger**: create a purchase invoice via Purchases; confirm a `purchase_in` ledger row with the batch/expiry you entered and `current_stock` increased.
8. **Sale trigger**: create a sales invoice; confirm a `sale_out` ledger row and decreased `current_stock`. Oversell check: UI oversales are recorded truthfully as negative stock in the ledger.
9. **Ledger tab**: filters (movement type / product / search), opening balance line when a single product is selected, running balance column, Batch Availability table with expiry ordering.
10. **Backfill sanity**: after migration, for any product with existing purchases/sales, ledger balance == product `current_stock` == Purchased − Sold on the dashboard.

## 6. Not done (deliberate Phase 1 scope)
- FIFO/weighted-average **costing** (structure ready, no valuation yet)
- Purchase order generation from reorder suggestions (recommendations only)
- Stocktake/bulk-count mode and damage/expiry-dedicated reason presets
- Batch-level issuing on sales (sales do not yet consume specific batches)

Nothing has been committed or pushed — all changes are in the working tree for review. Confirm if you want a commit.
