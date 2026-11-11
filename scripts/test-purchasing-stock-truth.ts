import assert from "node:assert/strict";
import {
  validatePurchaseOrderInput,
  validateReceiveQuantities,
  validatePurchaseTransactionInput,
  validatePurchaseReturnInput,
} from "../src/lib/purchases/validation";
import { validateAdjustmentInput } from "../src/lib/inventory/validation";
import { getBatchBreakdown } from "../src/lib/inventory/service";
import type { InventoryTransaction } from "../src/lib/inventory/types";

// Purchasing stock-truth slice.
//
// Rule under test: a batch expiry date that has already passed — before the
// transaction's own date (purchase / order / return date), or before today
// when the input carries no date — is rejected on purchase, PO, receipt,
// return and adjustment lines. A missing expiry stays allowed: expiry is
// optional everywhere in the code (the `*Optional` labels in messages.ts),
// so no required-date rule is invented here.
//
// Batch breakdown under test: per-batch received quantities sum exactly to
// the purchased total, and a batch received twice with different expiries
// shows the earliest expiry (the date its stock first expires).

const isoDaysFromToday = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const yesterday = isoDaysFromToday(-1);
const tomorrow = isoDaysFromToday(1);

const purchaseBase = {
  supplier_id: "supplier",
  purchase_date: "2026-09-06",
  payment_type: "cash",
  lines: [{ product_id: "product", quantity: 2, purchase_price: 150 }],
};

function main() {
  // ─── 1. Purchase transactions ────────────────────────────────────────────
  // Expiry the day before the purchase date: already expired when received.
  assert.equal(
    validatePurchaseTransactionInput({
      ...purchaseBase,
      lines: [{ ...purchaseBase.lines[0], expiry_date: "2026-09-05" }],
    }).ok,
    false,
  );
  assert.match(
    validatePurchaseTransactionInput({
      ...purchaseBase,
      lines: [{ ...purchaseBase.lines[0], expiry_date: "2026-09-05" }],
    }).errors.join(" "),
    /expiry date has already passed/i,
  );
  // Same-day expiry is not yet expired; a future expiry is fine; a missing
  // expiry stays allowed; a malformed date keeps its old message.
  assert.equal(
    validatePurchaseTransactionInput({
      ...purchaseBase,
      lines: [{ ...purchaseBase.lines[0], expiry_date: "2026-09-06" }],
    }).ok,
    true,
  );
  assert.equal(
    validatePurchaseTransactionInput({
      ...purchaseBase,
      lines: [{ ...purchaseBase.lines[0], expiry_date: "2027-01-01" }],
    }).ok,
    true,
  );
  assert.equal(validatePurchaseTransactionInput(purchaseBase).ok, true);
  assert.match(
    validatePurchaseTransactionInput({
      ...purchaseBase,
      lines: [{ ...purchaseBase.lines[0], expiry_date: "2026-13-40" }],
    }).errors.join(" "),
    /expiry date is not a valid date/i,
  );
  // No purchase date given: the reference is today.
  assert.equal(
    validatePurchaseTransactionInput({
      supplier_id: "supplier",
      payment_type: "cash",
      lines: [{ product_id: "product", quantity: 1, purchase_price: 10, expiry_date: yesterday }],
    }).ok,
    false,
  );
  assert.equal(
    validatePurchaseTransactionInput({
      supplier_id: "supplier",
      payment_type: "cash",
      lines: [{ product_id: "product", quantity: 1, purchase_price: 10, expiry_date: tomorrow }],
    }).ok,
    true,
  );

  // ─── 2. Purchase orders ──────────────────────────────────────────────────
  assert.equal(
    validatePurchaseOrderInput({
      supplier_id: "supplier",
      order_date: "2026-09-06",
      lines: [{ product_id: "product", quantity: 5, unit_price: 100, expiry_date: "2026-09-05" }],
    }).ok,
    false,
  );
  assert.equal(
    validatePurchaseOrderInput({
      supplier_id: "supplier",
      order_date: "2026-09-06",
      lines: [{ product_id: "product", quantity: 5, unit_price: 100, expiry_date: "2026-09-06" }],
    }).ok,
    true,
  );

  // ─── 3. PO receiving ─────────────────────────────────────────────────────
  // An expired date on a row actually being received is rejected; the same
  // date on a zero-quantity row (not received) does not block the receipt.
  assert.equal(
    validateReceiveQuantities([
      { product_id: "product", remaining: 10, receive_quantity: 5, unit_price: 100, batch_number: "B1", expiry_date: yesterday },
    ]).ok,
    false,
  );
  assert.equal(
    validateReceiveQuantities([
      { product_id: "product", remaining: 10, receive_quantity: 5, unit_price: 100, batch_number: "B1", expiry_date: tomorrow },
    ]).ok,
    true,
  );
  assert.equal(
    validateReceiveQuantities([
      { product_id: "product", remaining: 10, receive_quantity: 0, unit_price: 100, batch_number: "B1", expiry_date: yesterday },
      { product_id: "product", remaining: 10, receive_quantity: 5, unit_price: 100, batch_number: "B2", expiry_date: tomorrow },
    ]).ok,
    true,
  );
  assert.equal(
    validateReceiveQuantities([
      { product_id: "product", remaining: 10, receive_quantity: 5, unit_price: 100, batch_number: "x".repeat(101), expiry_date: tomorrow },
    ]).ok,
    false,
  );
  assert.equal(
    validateReceiveQuantities([
      { product_id: "product", remaining: 10, receive_quantity: 5, unit_price: 100 },
    ]).ok,
    true,
  );

  // ─── 4. Purchase returns ─────────────────────────────────────────────────
  assert.equal(
    validatePurchaseReturnInput({
      supplier_id: "supplier",
      return_date: "2026-09-06",
      reason: "damaged",
      lines: [{ product_id: "product", quantity: 1, unit_price: 100, expiry_date: "2026-09-05" }],
    }).ok,
    false,
  );
  assert.equal(
    validatePurchaseReturnInput({
      supplier_id: "supplier",
      return_date: "2026-09-06",
      reason: "damaged",
      lines: [{ product_id: "product", quantity: 1, unit_price: 100, expiry_date: "2027-01-01" }],
    }).ok,
    true,
  );

  // ─── 5. Stock adjustments ────────────────────────────────────────────────
  assert.equal(
    validateAdjustmentInput({ product_id: "product", quantity_delta: 5, reason: "count", expiry_date: yesterday }).ok,
    false,
  );
  assert.equal(
    validateAdjustmentInput({ product_id: "product", quantity_delta: 5, reason: "count", expiry_date: tomorrow }).ok,
    true,
  );
  assert.equal(
    validateAdjustmentInput({ product_id: "product", quantity_delta: 5, reason: "count" }).ok,
    true,
  );

  // ─── 6. Per-batch breakdown sums exactly ────────────────────────────────
  // Drift example from verification: one product received as two lines —
  // 60 units batch B1 and 40 units batch B2 — must sum exactly to the
  // 100-unit purchase, with no rounding and no dropped remainder. B1 was
  // received twice with different expiries, so the breakdown must show the
  // earliest (2026-06-01), the date its stock first expires.
  const tx = (id: string, batch: string | null, expiry: string | null, delta: number): InventoryTransaction => ({
    id,
    organization_id: "org",
    product_id: 1,
    movement_type: "purchase_in",
    quantity_delta: delta,
    reason: null,
    batch_number: batch,
    expiry_date: expiry,
    reference_type: "purchase_transaction",
    reference_id: null,
    created_by: null,
    created_at: "2026-09-06T00:00:00.000Z",
  });
  const breakdown = getBatchBreakdown(
    [
      tx("t1", "B1", "2027-01-01", 60),
      tx("t2", "B1", "2026-06-01", 40),
      tx("t3", "B2", "2026-12-01", 40),
    ],
    1,
  );
  assert.equal(breakdown.length, 2);
  const b1 = breakdown.find((batch) => batch.batchNumber === "B1");
  const b2 = breakdown.find((batch) => batch.batchNumber === "B2");
  assert.equal(b1?.received, 100);
  assert.equal(b1?.expiryDate, "2026-06-01");
  assert.equal(b2?.received, 40);
  assert.equal(b2?.expiryDate, "2026-12-01");
  assert.equal(
    breakdown.reduce((sum, batch) => sum + batch.received, 0),
    140,
  );
  // Earliest expiry sorts first.
  assert.equal(breakdown[0]?.batchNumber, "B1");

  // ─── 7. KNOWN GAP, documented — FEFO sale attribution (separate slice) ──
  // The verification drift example: receive 100 units into batch B1, then
  // sell 30. Sales are written with batch_number NULL
  // (inventory_sync_sale_item, src/lib/inventory/schema.sql), so the sale
  // lands in the "(no batch)" bucket and B1 still shows a balance of 100
  // although only 70 units of B1 can remain — overstated by the full sold
  // amount. The TOTAL across buckets is exact (100 - 30 = 70 = stock); the
  // lie is per-batch. Fixing it means FEFO attribution of sales to batches
  // (a Category 3 feature touching sales behaviour), so it is pinned here
  // as the current behaviour and left for the FEFO slice — flip these
  // assertions when FEFO lands.
  const withSale = getBatchBreakdown(
    [
      tx("t1", "B1", "2027-01-01", 100),
      { ...tx("t2", null, null, -30), movement_type: "sale_out", reference_type: "sales_transaction" },
    ],
    1,
  );
  const soldB1 = withSale.find((batch) => batch.batchNumber === "B1");
  const noBatch = withSale.find((batch) => batch.batchNumber === "(no batch)");
  assert.equal(soldB1?.balance, 100);
  assert.equal(noBatch?.issued, 30);
  assert.equal(
    withSale.reduce((sum, batch) => sum + batch.balance, 0),
    70,
  );

  console.log("Purchasing stock-truth: expired-batch rejection (purchase/PO/receive/return/adjustment), exact batch sums and earliest-expiry breakdown tests passed.");
}

main();
