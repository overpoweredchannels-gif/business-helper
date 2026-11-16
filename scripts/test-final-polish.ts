import assert from "node:assert/strict";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { buildFinancialLedger } from "../src/lib/ai/financial-ledger";
import { buildSupplierLedger } from "../src/lib/ai/supplier-ledger";
import type { MemoryWriterRawData } from "../src/lib/brain/contracts/memory";
import {
  getPaymentStatusBadgeKind,
  paymentStatusBadgeClass,
} from "../src/lib/history/payment-status";
import { messages } from "../src/lib/regional/messages";

// Final Polish & Cleanup Pass.
//
// Item 1 — AI ledgers exclude voided payments. The void RPC marks a
// payment voided_at but leaves its allocation rows, so every consumer
// that derives a total from payment rows must skip voided ones. The
// page.tsx engines and the Supplier Ledger already did; the AI ledgers
// (customer, supplier, financial) read the same raw data through the
// brain loader, which did not even select voided_at. These scenarios
// mirror the live QA cases: a €0.40 live payment and a €0.50 voided
// payment against the same €0.81 credit sale (S-100090 shape) and the
// same €1.00 credit purchase (P-50034 shape).
//
// Item 2 — a fully-returned purchase shows "Returned", never "Paid".
// The badge formula is "remaining <= 0 → Paid", and a fully-returned
// purchase has remaining 0 — so P-50032/33/34 all showed "Paid" with
// Paid €0.00. The "returned" kind takes precedence over "paid".
//
// Item 3 — the Purchase History payment-status filter dropdown reads
// "Partial" (buy.statusPartial), matching the row badge — not
// "Partially Paid" (buy.statusPartiallyPaid), which the print status
// still uses and which is deliberately left alone.

const NOW = new Date("2026-11-15T12:00:00.000Z");
const VOIDED_AT = "2026-11-15T10:00:00.000Z";

// Money is IEEE-754 floating point (0.81 − 0.40 is 0.41000000000000003),
// so money assertions compare within a sub-cent tolerance.
function assertMoney(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  );
}

// Shared fixture: one credit sale (€0.81) and one credit purchase
// (€1.00), each with one live payment and one voided payment.
const fixture: MemoryWriterRawData = {
  organizationId: "org-1",
  organizationName: "Test Org",
  ownerName: "Owner",
  timezone: "Asia/Karachi",
  products: [{ id: "prod-1", name: "COCA COLA 1L" }],
  customers: [{ id: "cust-1", customer_name: "QA Shop A" }],
  suppliers: [{ id: "sup-1", supplier_name: "Test Pepsi Agency" }],
  salesTransactions: [
    {
      id: "tx-1",
      customer_id: "cust-1",
      invoice_number: "S-100090",
      created_at: "2026-11-15T09:00:00.000Z",
      sale_date: "2026-11-15",
      payment_type: "credit",
      credit_due_date: null,
    },
  ],
  salesItems: [
    {
      id: "si-1",
      sales_transaction_id: "tx-1",
      product_id: "prod-1",
      quantity: 1,
      selling_price: 0.81,
      purchase_price_snapshot: 0.5,
    },
  ],
  purchaseTransactions: [
    {
      id: "ptx-1",
      supplier_id: "sup-1",
      invoice_number: "P-50034",
      created_at: "2026-11-15T09:00:00.000Z",
      purchase_date: "2026-11-15",
      payment_type: "credit",
    },
  ],
  purchaseItems: [
    {
      id: "pi-1",
      purchase_transaction_id: "ptx-1",
      product_id: "prod-1",
      quantity: 1,
      purchase_price: 1.0,
      selling_price: 1.2,
    },
  ],
  expenses: [],
  staff: [],
  tasks: [],
  alerts: [],
  customerPayments: [
    {
      id: "cp-live",
      customer_id: "cust-1",
      amount: 0.4,
      payment_date: "2026-11-15",
      voided_at: null,
    },
    {
      id: "cp-voided",
      customer_id: "cust-1",
      amount: 0.5,
      payment_date: "2026-11-15",
      voided_at: VOIDED_AT,
    },
  ],
  supplierPayments: [
    {
      id: "sp-live",
      supplier_id: "sup-1",
      amount: 0.5,
      payment_date: "2026-11-15",
      voided_at: null,
    },
    {
      id: "sp-voided",
      supplier_id: "sup-1",
      amount: 0.5,
      payment_date: "2026-11-15",
      voided_at: VOIDED_AT,
    },
  ],
};

// --- Item 1a: AI customer ledger excludes the voided payment. ---
// Live €0.40 covers part of the €0.81 credit sale; the voided €0.50
// must not cover the rest. Outstanding = 0.81 − 0.40 = 0.41. Without
// the filter the pool would be 0.90 and the outstanding 0.
{
  const ledger = buildCustomerLedger(fixture, NOW);
  const entry = ledger.byId.get("cust-1");
  assert.ok(entry, "customer ledger has an entry for cust-1");
  assertMoney(entry.totalSales, 0.81, "customer totalSales");
  assertMoney(entry.outstandingBalance, 0.41, "customer outstandingBalance");
}

// --- Item 1b: AI supplier ledger excludes the voided payment. ---
// Live €0.50 covers half of the €1.00 credit purchase; the voided
// €0.50 must not cover the other half. Payable = 1.00 − 0.50 = 0.50,
// paid = 0.50. Without the filter the payable would be 0 and paid 1.00.
// The entry's payment history also lists only the live payment.
{
  const ledger = buildSupplierLedger(fixture, NOW);
  const entry = ledger.byId.get("sup-1");
  assert.ok(entry, "supplier ledger has an entry for sup-1");
  assertMoney(entry.totalPurchases, 1.0, "supplier totalPurchases");
  assertMoney(entry.payableAmount, 0.5, "supplier payableAmount");
  assertMoney(entry.paidAmount, 0.5, "supplier paidAmount");
  assert.deepEqual(
    entry.payments.map((payment) => payment.paymentId),
    ["sp-live"]
  );
}

// --- Item 1c: AI financial ledger cash excludes voided payments. ---
// The sale and the purchase are both credit, so no cash revenue or
// cash purchase enters the cash balance — cash in is the live customer
// payment only (€0.40, not €0.90) and cash out is the live supplier
// payment only (€0.50, not €1.00). Receivables/payables inherit the
// sub-ledger figures.
{
  const ledger = buildFinancialLedger(fixture, NOW);
  assertMoney(ledger.cash.cashIn, 0.4, "financial cashIn");
  assertMoney(ledger.cash.cashOut, 0.5, "financial cashOut");
  assertMoney(ledger.cash.balance, -0.1, "financial cash balance");
  assertMoney(ledger.receivables.total, 0.41, "financial receivables total");
  assertMoney(ledger.payables.total, 0.5, "financial payables total");
}

// --- Item 2a: a fully-returned purchase is "Returned", not "Paid". ---
// Remaining is 0 (the goods went back), which the plain paid rule
// would report as paid — the returned check runs first.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 0, remaining: 0, returned: 1.0 }),
    "returned"
  );
}

// --- Item 2b: partially paid AND fully returned is still "Returned". ---
// €0.50 was paid before the €1.00 goods went back. Returned covers the
// whole invoice, so the badge is "Returned" — not "Partial" or "Paid".
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 0.5, remaining: 0, returned: 1.0 }),
    "returned"
  );
}

// --- Item 2c: a partially returned purchase is NOT "Returned". ---
// Only half the goods went back and half is still owed → Partial.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 0.5, remaining: 0.5, returned: 0.5 }),
    "partial"
  );
}

// --- Item 2d: no return at all behaves exactly as before. ---
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 0, remaining: 1.0, returned: 0 }),
    "unpaid"
  );
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 1.0, remaining: 0 }),
    "paid"
  );
  // Over-returned (defensive): returned above the total still counts.
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 0, remaining: 0, returned: 1.5 }),
    "returned"
  );
  // Zero-total guard: returned 0 against total 0 is not "returned".
  assert.equal(
    getPaymentStatusBadgeKind({ total: 0, paid: 0, remaining: 0, returned: 0 }),
    "paid"
  );
}

// --- Item 2e: sales are unchanged — the quirk is observed, not fixed. ---
// A fully-returned SALE still reports "Paid": the sales path never
// passes a `returned` value, so remaining 0 reads as paid. UMAIR asked
// about purchases only; this locks in that sales behaviour is untouched.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 0.81, paid: 0, remaining: 0 }),
    "paid"
  );
}

// --- Item 2f: the "Returned" badge is the neutral muted tone. ---
// Neither green (Paid) nor red (Unpaid) — a returned purchase is
// neither paid nor owed.
{
  assert.equal(paymentStatusBadgeClass("returned"), "bg-muted text-muted-foreground");
  assert.notEqual(paymentStatusBadgeClass("returned"), paymentStatusBadgeClass("paid"));
  assert.notEqual(paymentStatusBadgeClass("returned"), paymentStatusBadgeClass("unpaid"));
}

// --- Item 3: the filter and badge labels exist in all 4 locales. ---
// The filter dropdown renders buy.statusPartial ("Partial") and the
// returned badge renders buy.returnedLabel ("Returned"); both keys
// must exist in every locale. The print status still uses
// buy.statusPartiallyPaid and is deliberately left alone.
{
  assert.equal(messages.en["buy.statusPartial"], "Partial");
  assert.equal(messages.en["buy.returnedLabel"], "Returned");
  assert.equal(messages.es["buy.returnedLabel"], "Devuelto");
  assert.equal(messages.it["buy.returnedLabel"], "Restituito");
  assert.equal(messages.ur["buy.returnedLabel"], "واپس شدہ");
  for (const language of Object.keys(messages) as Array<keyof typeof messages>) {
    assert.equal(typeof messages[language]["buy.statusPartial"], "string");
    assert.ok(messages[language]["buy.statusPartial"].length > 0);
    assert.equal(typeof messages[language]["buy.returnedLabel"], "string");
    assert.ok(messages[language]["buy.returnedLabel"].length > 0);
  }
}

console.log("test-final-polish: all assertions passed");
