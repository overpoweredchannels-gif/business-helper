# Inventory Improvements — Completion Report

Date: 2026-08-02
Status: COMPLETE — implementation verified, nothing committed (awaiting approval)
Scope: `src/lib/inventory/`, `src/lib/import-wizard/`, `src/components/inventory/ImportWizard.tsx`, `src/app/api/ai/sales/create/route.ts`, `src/app/page.tsx` (Inventory + purchases/sales sections)

---

## 1. What was built

Follow-up hardening on top of the Inventory Phase 1 deliverable:

| Feature | Deliverable |
|---|---|
| **Single stock source of truth** | All three client sites that show stock now prefer `products.current_stock` (with fallback to purchase − sale arithmetic only when the column is `NULL`): `getAvailableStockForProduct`, `inventoryStats`, and the reorder-recommendation site. Computed purchase/sale totals are kept for reporting (moving averages, history). |
| **Race-safe `adjust_inventory`** | The RPC now writes an atomic delta (`current_stock = current_stock + p_quantity_delta`) instead of an absolute value, and guards negativity inside the UPDATE (`where current_stock + p_quantity_delta >= 0` + raise exception when no row matched). This closes a lost-update race between two concurrent adjustments (the `>= 0` CHECK was dropped in Phase 1). |
| **Overselling policy** | New org → category → product policy chain (`allow` / `block` / inherit). Server: `resolve_overselling_policy(uuid, integer)` SECURITY DEFINER function (revoked from public, granted to authenticated + service_role). Client: `getEffectiveOversellingPolicy()` + `getOversellingViolationMessage()` mirror the chain locally (product → category parent chain, ≤ 20 hops → org default `allow`). Enforced in the sales invoice submit, the AI sales-create route, and the AI draft-sale execution. Admin controls: Business Settings select (org-level, audited old→new), category row + add-form select, product form select, and the product detail view shows the effective policy. |
| **Product Import Wizard** | New 4-step wizard (File → Mapping → Preview → Done) under Inventory → Import Products: supports `.csv` (hand-rolled RFC-4180-ish parser), `.xlsx` / `.xls` / `.ods` (via `xlsx`), header auto-guessing with alias tables, column mapping overrides, saved templates (localStorage, max 10), duplicate handling (skip / update-by-SKU), live row validation (missing name, duplicate names/SKUs in file, numeric/bool/policy parse errors, unknown brand/category), per-row status (New / Update / Skipped / Error), import disabled while any row has errors, results summary + failure list. `initial_stock > 0` is applied via the `adjust_inventory` RPC with a dedicated reason. Audited as `product_import` with file name + created/updated/skipped/failed counts. Gated by `can_manage_inventory`. |
| **Dependency** | `xlsx@0.18.5` added to `package.json` (npm audit shows non-blocking advisories — accepted for a board-level import tool). |

## 2. Files changed / added

New files:
- `src/lib/inventory/overselling-policy.sql` — columns (`organizations.overselling_policy` NOT NULL default `'allow'`, `categories.overselling_policy`, `products.overselling_policy`), CHECKs, and the `resolve_overselling_policy` function (idempotent)
- `src/lib/import-wizard/csv.ts` — CSV parser (BOM, CRLF/LF, quoted fields, `""` escapes)
- `src/lib/import-wizard/types.ts` — wizard types (`ProductImportField`, `ColumnMapping`, `DuplicateMode`, `ImportPreviewResult`, `ImportRunResult`, `SavedImportTemplate`, …)
- `src/lib/import-wizard/validation.ts` — header normalization/guessing, row validation, existing-match lookup (SKU → name+brand), policy/number/bool parsers
- `src/lib/import-wizard/templates.ts` — localStorage template store (key `tradeos.import_templates.v1`, max 10)
- `src/components/inventory/ImportWizard.tsx` — the wizard component

Modified files:
- `src/lib/inventory/schema.sql` — `adjust_inventory` delta write + atomic negative guard
- `src/app/api/ai/sales/create/route.ts` — RPC policy check (blocks when policy = block and stock < quantity)
- `src/app/page.tsx` — consistency fix at 3 sites; overselling state/handlers/toggles (business settings, categories, products, detail view); 4th Inventory tab "Import Products" with `ImportWizard` wiring; enforcement inside `handleCreateSalesInvoice` and the AI draft-sale execution
- `src/lib/tradeos/types.ts` — `Category.overselling_policy`, `Product.overselling_policy`
- `package.json` / `package-lock.json` — `xlsx@0.18.5`

## 3. Database migration — run manually, once, in the Supabase SQL editor

Apply every statement in `src/lib/inventory/overselling-policy.sql` (idempotent — safe to re-run):
1. `organizations.overselling_policy` text NOT NULL default `'allow'` + CHECK `('allow','block')`
2. `categories.overselling_policy` / `products.overselling_policy` text nullable + CHECK
3. `resolve_overselling_policy(p_organization_id uuid, p_product_id integer)` SECURITY DEFINER — walks product → category chain (≤ 20 hops, cycle-safe) → organization; NULL means inherit; default `allow` for legacy rows
4. Privilege hardening: revoke execute from public, grant to authenticated + service_role

The `adjust_inventory` change is inside `src/lib/inventory/schema.sql` (re-run section 5 — the `create or replace function` line swaps in the delta implementation; the trigger drops/recreates are guarded).

## 4. Verification

- `npx tsc --noEmit` — 0 errors
- `npx next build` — PASS (all routes compile, static pages generated)
- `npx eslint .` — 171 errors / 186 warnings, all pre-existing (`any` usages and unused vars in legacy AI/voice/analytics code); zero findings in any file touched by this mission
- `git diff --check` — clean
- Import wizard parser + validation exercised standalone via `npx tsx` — all assertions PASS (CSV quoting/BOM, header guessing, duplicate modes, error rows)

## 5. Known notes

- Overselling policy is advisory-safe: block applies to sales submissions and AI sales; manual stock adjustments are unaffected (they have their own guard).
- Deleting a product whose category policy is referenced is handled by NULL propagation semantics (category → org fallback).
- `xlsx` audit advisories: accepted; re-evaluate if the tool is ever exposed beyond the board.
