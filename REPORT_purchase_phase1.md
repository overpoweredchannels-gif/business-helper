# Purchase Management Phase 1 — Completion Report

Date: 2026-08-02
Status: COMPLETE — implementation verified, nothing committed (awaiting approval)
Scope: `src/lib/purchases/`, `src/lib/invoices/` (numbering), `src/app/page.tsx` (Purchases section), `src/lib/tradeos/types.ts`

---

## 1. What was built

Production-grade purchase workflow on top of the existing purchase-invoice foundation:

| Feature | Deliverable |
|---|---|
| **Purchase Orders** | `purchase_orders` + `purchase_order_items` tables (supplier, order/expected dates, notes, status `ordered/partial/received/cancelled`, quantity_ordered/quantity_received, unit_price, batch_number, expiry_date per line). Create form with dynamic product lines, live order list with status badges, cancel (orders/partial only), printable PO document, audit-logged. |
| **Receive workflow** | "Receive" on an order opens a per-line receive form pre-filled with remaining quantity, PO unit price, batch, and expiry. Confirming receive validates via `validateReceiveQuantities`, generates the purchase invoice number (PUR-xxxxxx), creates the `purchase_transactions` row (`expense_review_status: "pending"`, notes `Received from purchase order {PO}`, `created_by_profile_id`), inserts `purchase_items` (stock + ledger via the existing sync trigger), updates `purchase_order_items.quantity_received` / unit price / batch / expiry, and advances the PO to `partial` or `received`. |
| **Purchase Returns** | `purchase_returns` + `purchase_return_items` tables (return_number, optional linked purchase invoice, date, reason, status `confirmed/cancelled`). Create form with lines, history list with totals, printable return document, delete (reverses stock via DB trigger), audit-logged. |
| **Return stock sync** | `inventory_sync_purchase_return_item()` trigger (INSERT: `return_out` movement with `-quantity` delta + `current_stock` decrement; UPDATE: delta = `(-new.qty) + old.qty`; DELETE: reversal `+old.qty`). The ledger enum + reference_type extended to `return_in`/`return_out` and `purchase_return`. |
| **Automatic numbering** | `InvoiceNumberService` extended with `purchase_order` (PO-xxxxxx) and `generatePurchaseReturnInvoice` (PRN-xxxxxx) beside `generatePurchaseInvoice` (PUR-xxxxxx). The old free-text "Invoice Number" field is replaced by an optional **Supplier Invoice Number** stored in `supplier_invoice_number` — system numbers are always server-generated and never collided. |
| **Shared validation** | `src/lib/purchases/validation.ts`: `validatePurchaseOrderInput` (supplier required, dates, expected ≥ order, line rules), `validateReceiveQuantities` (at least one line, receive ≤ remaining, price ≥ 0), `validatePurchaseReturnInput`. Constants: notes/reason ≤ 500 chars, batch ≤ 100 chars; dates normalized to `YYYY-MM-DD`. |
| **Types** | `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseReturn`, `PurchaseReturnItem` added to `src/lib/tradeos/types.ts`; `InvoiceType` extended with `"purchase_order"`. |
| **UI** | Purchases section reorganized into 3 tabs — Invoice / Orders / Returns — with `purchaseOrders`/`purchaseReturns` lists, `receivePoId` inline receive panel, and print previews reusing the existing `openPrintPreview` + business branding/footer. |

## 2. Files changed / added

New files:
- `src/lib/purchases/schema.sql` — full migration: ledger enum extension gate, PO/PO-item/return/return-item tables, RLS (org-scoped via `current_org_id()`, items also verify parent via EXISTS), return stock trigger (SECURITY DEFINER, `check_function_bodies` toggled), indexes
- `src/lib/purchases/validation.ts` — the three validators + normalizers

Modified files:
- `src/lib/invoices/schema.sql` — invoice_sequences CHECK extended to 5 types (guarded drop/recreate for existing DBs); `next_invoice_number` updated
- `src/lib/invoices/types.ts` — `InvoiceType` + `"purchase_order"`
- `src/lib/invoices/invoice-number-service.ts` — `INVOICE_PREFIXES.purchase_order = "PO"`, `generatePurchaseOrder()` class + helper method
- `src/app/page.tsx` — purchase 3-tab UI, PO/return/receive state + handlers, fetchers with optional id lists, initial-load wiring, print handlers, supplier-ref handling in `handleCreatePurchaseInvoice`
- `src/lib/tradeos/types.ts` — new purchase types

## 3. Database migration — run manually, once, in the Supabase SQL editor

Apply every statement in `src/lib/purchases/schema.sql`, then the extended part of `src/lib/invoices/schema.sql` (both idempotent — safe to re-run):
1. `inventory_transactions.movement_type` check replaced with `('purchase_in','sale_out','adjustment_in','adjustment_out','return_in','return_out')`; `reference_type` replaced with `(null,'purchase_transaction','sales_transaction','adjustment','purchase_return','purchase_order')` (drop + recreate, data preserved)
2. `purchase_orders` / `purchase_order_items` — org-scoped RLS, unique `(organization_id, po_number)`, FKs cascade on product/item delete, status CHECK, indexes on org+created, status, supplier, po_number, order_date
3. `purchase_returns` / `purchase_return_items` — same conventions; `purchase_transaction_id` FK set-null
4. `inventory_sync_purchase_return_item()` trigger — INSERT/UPDATE/DELETE handling with signed-delta math; organization resolved from the parent return
5. `invoice_sequences` CHECK extension + updated `next_invoice_number` (guarded)

### DB decisions worth knowing
- Ledger stays truthful: the app validates returns against available stock before saving, but if the business is already negative the ledger records the truth (stock can go further negative).
- PO receiving goes through the same `inventory_sync_purchase_item` trigger as manual invoices, so ledger and `current_stock` stay consistent.
- RLS relies on the established `current_org_id()` session convention (same as products/inventory tables).

## 4. Verification

- `npx tsc --noEmit` — 0 errors
- `npx next build` — PASS (all routes compile, static pages generated)
- `npx eslint .` — 171 errors / 186 warnings, all pre-existing; zero findings in `src/lib/purchases/*`, `src/lib/invoices/*`, or the page.tsx purchase additions
- `git diff --check` — clean

## 5. Known notes / next-phase candidates

- `fetchPurchaseOrderItems` / `fetchPurchaseReturnItems` fetch with `.in(...)` over all ids — fine at current scale; chunk if a tenant ever grows past Supabase's `in`-list limits.
- PO receive sets `expense_review_status: "pending"` on the generated invoice but doesn't push a `new_purchase_expense` reminder (the manual-invoice review reminder is untouched) — the pending row is visible in the ledger if the review flow scans for it.
- Returns don't yet create negative financial impact entries (payables/credit notes) — scope decision, revisit in a later phase.
- PO lines intentionally store planned batch/expiry; the received values (which may differ) are captured at receive time.
