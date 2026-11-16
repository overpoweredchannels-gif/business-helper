import assert from "node:assert/strict";
import { creditBalanceTimeline, type CreditBalanceEntry } from "../src/lib/sales/credit-balance";

const entry = (overrides: Partial<CreditBalanceEntry> = {}): CreditBalanceEntry => ({
  id: "tx-1",
  customerId: "customer-1",
  paymentType: "credit",
  createdAt: "2026-11-16T10:00:00.000Z",
  invoiceNumber: "S-100092",
  remaining: 1.13,
  ...overrides,
});

let timeline = creditBalanceTimeline([
  entry({ id: "tx-1", invoiceNumber: "S-100092", remaining: 1.13 }),
  entry({ id: "tx-2", createdAt: "2026-11-16T11:00:00.000Z", invoiceNumber: "S-100093", remaining: 0.81 }),
]);
assert.deepEqual(timeline["tx-1"], { previous: 0, next: 1.13 }, "First credit invoice starts from a zero balance");
assert.deepEqual(timeline["tx-2"], { previous: 1.13, next: 1.94 }, "Second credit invoice builds on the first one's remainder");

timeline = creditBalanceTimeline([
  entry({ id: "tx-1", invoiceNumber: "S-100092", remaining: 1.13 }),
  entry({ id: "tx-2", createdAt: "2026-11-16T11:00:00.000Z", invoiceNumber: "S-100093", remaining: 0 }),
]);
assert.deepEqual(timeline["tx-2"], { previous: 1.13, next: 1.13 }, "A fully paid credit invoice leaves the balance unchanged");

timeline = creditBalanceTimeline([
  entry({ id: "tx-1", invoiceNumber: "S-100092", remaining: 1.13 }),
  entry({ id: "tx-2", paymentType: "cash", createdAt: "2026-11-16T11:00:00.000Z", invoiceNumber: "S-100093", remaining: 0 }),
]);
assert.equal(timeline["tx-2"], undefined, "Cash invoices never enter the credit timeline");

timeline = creditBalanceTimeline([
  entry({ id: "tx-1", invoiceNumber: "S-100092", remaining: 1.13 }),
  entry({ id: "tx-2", customerId: "customer-2", createdAt: "2026-11-16T11:00:00.000Z", invoiceNumber: "S-100093", remaining: 5 }),
]);
assert.deepEqual(timeline["tx-2"], { previous: 0, next: 5 }, "Each customer's balance runs independently");

// Same-second invoices still order by the invoice number, not
// lexicographically (S-100100 comes after S-100099, not before it).
timeline = creditBalanceTimeline([
  entry({ id: "tx-late", createdAt: "2026-11-16T10:00:00.000Z", invoiceNumber: "S-100100", remaining: 0.2 }),
  entry({ id: "tx-early", createdAt: "2026-11-16T10:00:00.000Z", invoiceNumber: "S-100099", remaining: 0.1 }),
]);
assert.deepEqual(timeline["tx-early"], { previous: 0, next: 0.1 });
assert.deepEqual(timeline["tx-late"], { previous: 0.1, next: 0.3 }, "Running totals stay exact to the cent");

console.log("Credit balance timeline passed: running previous/next balances per customer, paid and cash invoices, and same-second ordering.");
