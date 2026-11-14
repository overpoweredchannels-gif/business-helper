import assert from "node:assert/strict";
import { buildApprovalSaleAmounts } from "../src/lib/sales/services/draft-sale-service";

// ---------------------------------------------------------------------------
// POS approval-mode save: the totals an approved draft converts into must be
// identical to the normal save (create_sales_invoice_atomic via
// calculateSaleAmounts): line subtotal minus the invoice discount, plus tax
// on the remainder; cash tender defaults to the total when the draft carries
// none, and to 0 for card/credit.
// ---------------------------------------------------------------------------

const items = [
  { quantity_ordered: 2, unit_price: 50, discount: 5 },
  { quantity_ordered: 1, unit_price: 40, discount: 0 },
];
// Line subtotal: 2x50 - 5 + 1x40 = 135.

// No discount, no tax, cash with no tender: total is the line subtotal,
// cash defaults to the total, no change.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 0, invoiceDiscountType: "flat", taxRate: 0, cashReceived: null, paymentType: "cash" },
    items,
  );
  assert.equal(amounts.lineSubtotal, 135);
  assert.equal(amounts.invoiceDiscount, 0);
  assert.equal(amounts.tax, 0);
  assert.equal(amounts.total, 135);
  assert.equal(amounts.cashReceived, 135);
  assert.equal(amounts.changeDue, 0);
}

// Flat invoice discount: 135 - 10 = 125.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 0, cashReceived: 125, paymentType: "cash" },
    items,
  );
  assert.equal(amounts.invoiceDiscount, 10);
  assert.equal(amounts.total, 125);
  assert.equal(amounts.cashReceived, 125);
  assert.equal(amounts.changeDue, 0);
}

// Percent invoice discount: 10% of 135 = 13.50; total 121.50.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "percent", taxRate: 0, cashReceived: null, paymentType: "cash" },
    items,
  );
  assert.equal(amounts.invoiceDiscount, 13.5);
  assert.equal(amounts.total, 121.5);
  assert.equal(amounts.cashReceived, 121.5);
}

// Tax on the remainder: flat 10 discount -> taxable 125; 10% tax = 12.50; total 137.50.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 10, cashReceived: null, paymentType: "cash" },
    items,
  );
  assert.equal(amounts.tax, 12.5);
  assert.equal(amounts.total, 137.5);
}

// Cash over-tender: 150 received on a 137.50 total -> 12.50 change.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 10, cashReceived: 150, paymentType: "cash" },
    items,
  );
  assert.equal(amounts.total, 137.5);
  assert.equal(amounts.cashReceived, 150);
  assert.equal(amounts.changeDue, 12.5);
}

// Card tender: same totals; the card is charged the total, so the
// recorded tender is the total — matching the direct atomic sale,
// which stores cash_received = total for card — and no change due.
// (2026-11-14: the old expectation of 0 was the same inconsistency
// that broke direct card sales — an explicit 0 tender is rejected by
// the RPC. A card sale carries the total as its tender.)
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 10, cashReceived: null, paymentType: "card" },
    items,
  );
  assert.equal(amounts.total, 137.5);
  assert.equal(amounts.cashReceived, 137.5);
  assert.equal(amounts.changeDue, 0);
}

// Card tender with an explicit stored tender: the stored amount is used.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 10, cashReceived: 137.5, paymentType: "card" },
    items,
  );
  assert.equal(amounts.total, 137.5);
  assert.equal(amounts.cashReceived, 137.5);
  assert.equal(amounts.changeDue, 0);
}

// Credit sale: same totals, no cash received.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "flat", taxRate: 10, cashReceived: null, paymentType: "credit" },
    items,
  );
  assert.equal(amounts.total, 137.5);
  assert.equal(amounts.cashReceived, 0);
  assert.equal(amounts.changeDue, 0);
}

// Raw draft-row (snake_case) shape, as approveDraft/listDrafts pass it:
// identical results to the camelCase shape above.
{
  const amounts = buildApprovalSaleAmounts(
    { invoice_discount: 10, invoice_discount_type: "flat", tax_rate: 10, cash_received: 150, payment_type: "cash" },
    items,
  );
  assert.equal(amounts.invoiceDiscount, 10);
  assert.equal(amounts.tax, 12.5);
  assert.equal(amounts.total, 137.5);
  assert.equal(amounts.cashReceived, 150);
  assert.equal(amounts.changeDue, 12.5);
}

// Percent-discount rounding parity with the RPC (half away from zero):
// 10% of 33.33 = 3.333 -> 3.33.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 10, invoiceDiscountType: "percent", taxRate: 0, cashReceived: null, paymentType: "cash" },
    [{ quantity_ordered: 1, unit_price: 33.33, discount: 0 }],
  );
  assert.equal(amounts.invoiceDiscount, 3.33);
  assert.equal(amounts.total, 30);
}

// QA scenario (S-100067): 1 x €0.65, flat invoice discount €0.05, 10% tax
// on the remainder: subtotal 0.65, taxable 0.60, tax 0.06, total 0.66.
// Exact cash tender 0.66 -> no change. This is the end-to-end figure set
// the browser QA checks after the owner approves a staff draft.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 0.05, invoiceDiscountType: "flat", taxRate: 10, cashReceived: 0.66, paymentType: "cash" },
    [{ quantity_ordered: 1, unit_price: 0.65, discount: 0 }],
  );
  assert.equal(amounts.lineSubtotal, 0.65);
  assert.equal(amounts.invoiceDiscount, 0.05);
  assert.equal(amounts.tax, 0.06);
  assert.equal(amounts.total, 0.66);
  assert.equal(amounts.cashReceived, 0.66);
  assert.equal(amounts.changeDue, 0);
}

// Owner-confirmed over-tender at approval time (Review modal): the tender
// the owner enters replaces the staff-entered tender, so a 1.00 tender on
// the same 0.66 total returns 0.34 change.
{
  const amounts = buildApprovalSaleAmounts(
    { invoiceDiscount: 0.05, invoiceDiscountType: "flat", taxRate: 10, cashReceived: 1, paymentType: "cash" },
    [{ quantity_ordered: 1, unit_price: 0.65, discount: 0 }],
  );
  assert.equal(amounts.total, 0.66);
  assert.equal(amounts.cashReceived, 1);
  assert.equal(amounts.changeDue, 0.34);
}

console.log("POS approval-save checks passed: flat/percent invoice discount, tax on the remainder, cash default/exact/over-tender change, card tender = total, credit zero cash, snake_case draft-row parity, percent rounding, QA S-100067 figures, owner-confirmed over-tender.");
