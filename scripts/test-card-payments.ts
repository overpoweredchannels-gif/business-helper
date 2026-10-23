import assert from "node:assert/strict";
import { validateSalesInvoiceInput } from "../src/lib/sales/validation";
import { validateSaleDraft } from "../src/lib/sales/sale-draft";
import { parseHeldSales, type HeldSale } from "../src/lib/sales/held-sales";
import { buildAtomicSaleReceipt, buildPrintableReceiptHtml, getReceiptSummaryRows } from "../src/lib/print/retail-receipt";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import { customerPaymentsImportConfig } from "../src/lib/import-export/entities/customer-payments";
import { messages } from "../src/lib/regional/messages";

// ---------------------------------------------------------------------------
// Sale validator: card is a first-class tender; garbage is still rejected.
// ---------------------------------------------------------------------------

const validSale = {
  customer_id: "c1",
  sale_date: "2026-10-23",
  lines: [{ product_id: "p1", quantity: 1, selling_price: 100 }],
};

for (const tender of ["cash", "card", "credit", "CARD"]) {
  const result = validateSalesInvoiceInput({ ...validSale, payment_type: tender });
  assert.equal(result.ok, true, `validator accepts payment_type ${tender}: ${result.errors.join("; ")}`);
}
const rejected = validateSalesInvoiceInput({ ...validSale, payment_type: "cheque" });
assert.equal(rejected.ok, false, "validator rejects an unknown tender");
assert.ok(
  rejected.errors.some(error => error === "Payment type must be 'cash', 'card' or 'credit'."),
  "rejection names the full tender vocabulary",
);

// ---------------------------------------------------------------------------
// POS draft validation: a card sale carries no tendered/change semantics.
// Even with validateCash on (owner POS) and stray cash text present, a
// card draft must not produce cash issues or a cash summary.
// ---------------------------------------------------------------------------

const cardDraft = validateSaleDraft({
  lines: [{ product_id: "p1", quantity: "2", selling_price: "50", discount: "", bonus: "" }],
  invoiceDiscount: "",
  invoiceDiscountType: "flat",
  taxRate: "",
  paymentType: "card",
  cashReceived: "not-a-number",
  validateCash: true,
  allowInvoiceAdjustments: true,
});
assert.equal(cardDraft.valid, true, `card draft is valid: ${cardDraft.issues.map(i => i.message).join("; ")}`);
assert.equal(cardDraft.cashSummary, undefined, "card draft has no cash drawer summary");
assert.ok(!cardDraft.issues.some(issue => issue.field === "cash_received"), "card draft raises no cash_received issue");
assert.equal(cardDraft.amounts?.total, 100, "card draft total is the exact sale total");

const cashDraft = validateSaleDraft({
  lines: [{ product_id: "p1", quantity: "2", selling_price: "50", discount: "", bonus: "" }],
  invoiceDiscount: "",
  invoiceDiscountType: "flat",
  taxRate: "",
  paymentType: "cash",
  cashReceived: "150",
  validateCash: true,
  allowInvoiceAdjustments: true,
});
assert.equal(cashDraft.cashSummary?.change, 50, "cash draft keeps the tendered/change summary");

// ---------------------------------------------------------------------------
// Held sales: a held card sale round-trips the strict parser; an unknown
// tender is still refused.
// ---------------------------------------------------------------------------

const heldRow = (paymentType: string): HeldSale => ({
  id: "55555555-5555-4555-8555-555555555555",
  savedAt: "2026-10-23T07:00:00.000Z",
  sale: {
    lines: [{ product_id: "p1", quantity: "2", selling_price: "155", discount: "", unit_mode: "main" }],
    customerId: "c1",
    date: "2026-10-23",
    paymentType: paymentType as HeldSale["sale"]["paymentType"],
    discount: "",
    discountType: "flat",
    tax: "",
  },
});
assert.equal(parseHeldSales(JSON.stringify([heldRow("card")]))[0]?.sale.paymentType, "card", "held card sale parses");
assert.throws(() => parseHeldSales(JSON.stringify([heldRow("cheque")])), /Invalid held sales/, "held sale with unknown tender is rejected");

// ---------------------------------------------------------------------------
// Receipt: a card sale prints "Paid by card" at the exact total and no
// cash tendered/change rows; the cash receipt is unchanged.
// ---------------------------------------------------------------------------

const cardReceipt = buildAtomicSaleReceipt({
  customer_name: "Walk-in",
  transaction: {
    invoice_number: "S-100200", sale_date: "2026-10-23", payment_type: "card",
    discount_amount: "0.00", tax_rate: "0.00", tax_amount: "0.00",
    total_amount: "250.00", cash_received: "0.00", change_due: "0.00",
  },
  items: [{ product_name: "Rice 5kg", quantity: "1", selling_price: "250.00", discount: "0.00", bonus: "0.000", unit_mode: "main", unit_type: "Bag" }],
}, { scope: "org:owner", business: "Corner Shop", fallbackDate: "2026-10-23", fallbackPayment: "cash" });
assert.equal(cardReceipt.payment, "card");
const cardRows = getReceiptSummaryRows(cardReceipt);
assert.deepEqual(cardRows.map(row => row.key), ["itemsSubtotal", "lineDiscounts", "subtotal", "invoiceDiscount", "tax", "total", "paidByCard"], "card receipt summary rows end with paidByCard only");
assert.equal(cardRows.find(row => row.key === "paidByCard")?.label, "Paid by card");
assert.equal(cardRows.find(row => row.key === "paidByCard")?.amount, 250, "paid-by-card line carries the exact total");
const cardHtml = buildPrintableReceiptHtml(cardReceipt, cloneDefaultTemplate("retail_receipt"));
assert.ok(cardHtml.includes("Paid by card"), "printed card receipt shows the card line");
assert.ok(!cardHtml.includes("Tendered") && !cardHtml.includes("Change due"), "printed card receipt has no cash tendered/change lines");

const cashReceipt = buildAtomicSaleReceipt({
  customer_name: "Walk-in",
  transaction: {
    invoice_number: "S-100126", sale_date: "2026-09-26", payment_type: "cash",
    discount_amount: "5.00", tax_rate: "10.00", tax_amount: "12.00",
    total_amount: "131.99", cash_received: "135.00", change_due: "3.01",
  },
  items: [{ product_name: "Small Pack", quantity: "0.125", selling_price: "1000.00", discount: "0.01", bonus: "0.000", unit_mode: "main", unit_type: "Case" }],
}, { scope: "org:owner", business: "Corner Shop", fallbackDate: "today", fallbackPayment: "credit" });
assert.deepEqual(getReceiptSummaryRows(cashReceipt).map(row => row.amount), [125, 0.01, 124.99, 5, 12, 131.99, 135, 3.01], "cash receipt summary amounts are unchanged");
assert.deepEqual(getReceiptSummaryRows(cashReceipt).map(row => row.label), ["Items subtotal", "Line discounts", "Subtotal", "Invoice discount", "Tax (10%)", "Total", "Tendered", "Change due"], "cash receipt summary labels are unchanged");

// ---------------------------------------------------------------------------
// Customer payments vocabulary: card is a recordable method (Money UI
// select + import config share the same vocabulary).
// ---------------------------------------------------------------------------

const methodField = customerPaymentsImportConfig.fields.find(field => field.key === "payment_method");
assert.ok(methodField, "customer payments import config has a payment_method field");
assert.equal(typeof methodField.parse, "function");
assert.equal((methodField.parse as (raw: string) => unknown)("card"), "card", "import parse accepts card");
assert.equal((methodField.parse as (raw: string) => unknown)("Card"), "card", "import parse normalizes case");
assert.equal((methodField.parse as (raw: string) => unknown)("cheque"), null, "import parse still rejects unknown methods");
assert.ok(Array.isArray(methodField.options) && methodField.options.includes("card"), "import options include card");

// ---------------------------------------------------------------------------
// i18n: every card key exists and is non-empty in all four languages.
// ---------------------------------------------------------------------------

for (const [language, table] of Object.entries(messages)) {
  for (const key of ["sell.paymentCard", "sell.cardNotEnabled", "receipt.paidByCard", "money.card", "payments.cardNotEnabled"] as const) {
    assert.ok(typeof table[key] === "string" && table[key].length > 0, `${language} has a non-empty ${key}`);
  }
}

console.log("test-card-payments: all assertions passed");
