import assert from "node:assert/strict";

// Speed Fix 2026-11-16: the credit branch of create_sales_invoice_atomic
// used to loop over every credit invoice of the customer (three
// subqueries per invoice) to work out the outstanding balance and the
// overdue count. The replacement is ONE query with a running total
// (src/lib/migrations/credit_balance_single_query_rpc.sql). This test
// simulates BOTH algorithms in plain arithmetic on the same fixtures
// and asserts they agree exactly — the SQL itself has not been run
// against a live database from this machine, so UMAIR runs the file on
// the disposable project first, then production.
//
// Fixture invoice shape mirrors the RPC's per-invoice inputs:
// total_amount (stored total; 0/null means "recompute from lines"),
// line_total / discount_amount / tax_amount (the recompute inputs),
// allocated (explicit allocations), credit_due_date (null = none).
// Dates are ISO "YYYY-MM-DD" so lexicographic comparison matches SQL.

type Invoice = {
  id: string;
  saleDate: string;
  createdAt: string;
  dueDate: string | null;
  totalAmount: number | null;
  lineTotal: number;
  discountAmount: number;
  taxAmount: number;
  allocated: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const invoiceTotal = (inv: Invoice): number => {
  const stored = inv.totalAmount ?? 0;
  if (stored > 0) return stored;
  return round2(Math.max(0, inv.lineTotal - inv.discountAmount) + inv.taxAmount);
};

const sortInvoices = (invoices: Invoice[]): Invoice[] =>
  [...invoices].sort((a, b) => {
    const aDate = a.saleDate || a.createdAt.slice(0, 10);
    const bDate = b.saleDate || b.createdAt.slice(0, 10);
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

// The old PL/pgSQL loop, step for step.
function outstandingLoop(invoices: Invoice[], pool: number, today: string) {
  let remainingPool = pool;
  let outstanding = 0;
  let overdue = 0;
  for (const inv of sortInvoices(invoices)) {
    let remaining = round2(Math.max(0, invoiceTotal(inv) - inv.allocated));
    const fallback = Math.min(remainingPool, remaining);
    remainingPool = round2(Math.max(0, remainingPool - fallback));
    remaining = round2(Math.max(0, remaining - fallback));
    outstanding = round2(outstanding + remaining);
    if (remaining > 0 && inv.dueDate !== null && inv.dueDate < today) overdue += 1;
  }
  return { outstanding, overdue };
}

// The replacement single query, as a running total.
function outstandingSingleQuery(invoices: Invoice[], pool: number, today: string) {
  const sorted = sortInvoices(invoices);
  const remaining = sorted.map((inv) => round2(Math.max(0, invoiceTotal(inv) - inv.allocated)));
  let running = 0;
  let outstanding = 0;
  let overdue = 0;
  sorted.forEach((inv, i) => {
    running = round2(running + remaining[i]);
    const afterPool = round2(Math.max(0, remaining[i] - Math.max(0, pool - (running - remaining[i]))));
    outstanding = round2(outstanding + afterPool);
    if (afterPool > 0 && inv.dueDate !== null && inv.dueDate < today) overdue += 1;
  });
  return { outstanding, overdue };
}

const inv = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  saleDate: "2026-11-10",
  createdAt: "2026-11-10T10:00:00.000Z",
  dueDate: null,
  totalAmount: 1.0,
  lineTotal: 1.0,
  discountAmount: 0,
  taxAmount: 0,
  allocated: 0,
  ...overrides,
});

const TODAY = "2026-11-16";
const check = (label: string, invoices: Invoice[], pool: number) => {
  assert.deepEqual(
    outstandingSingleQuery(invoices, pool, TODAY),
    outstandingLoop(invoices, pool, TODAY),
    label,
  );
};

check("No credit invoices", [], 5);
check("Single invoice, no pool, not overdue", [inv()], 0);
check("Single invoice, pool covers it", [inv()], 1.0);
check(
  "Pool covers the oldest invoice partially, then the next",
  [
    inv({ id: "inv-a", saleDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", dueDate: "2026-11-05", totalAmount: 1.0 }),
    inv({ id: "inv-b", saleDate: "2026-11-05", createdAt: "2026-11-05T10:00:00.000Z", dueDate: "2026-11-10", totalAmount: 2.0 }),
    inv({ id: "inv-c", saleDate: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z", dueDate: "2026-12-01", totalAmount: 3.0 }),
  ],
  1.5,
);
check(
  "Pool covers every invoice",
  [
    inv({ id: "inv-a", saleDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", dueDate: "2026-11-05", totalAmount: 1.0 }),
    inv({ id: "inv-b", saleDate: "2026-11-05", createdAt: "2026-11-05T10:00:00.000Z", dueDate: "2026-11-10", totalAmount: 2.0 }),
  ],
  99,
);
check(
  "No pool, overdue mix — a fully allocated overdue invoice does not count",
  [
    inv({ id: "inv-a", saleDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", dueDate: "2026-11-05", totalAmount: 1.0, allocated: 1.0 }),
    inv({ id: "inv-b", saleDate: "2026-11-05", createdAt: "2026-11-05T10:00:00.000Z", dueDate: "2026-11-10", totalAmount: 2.0, allocated: 0.5 }),
    inv({ id: "inv-c", saleDate: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z", dueDate: "2026-12-01", totalAmount: 3.0 }),
  ],
  0,
);
check(
  "Stored total is zero or null, so the total is recomputed from lines",
  [
    inv({ id: "inv-a", saleDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", dueDate: "2026-11-05", totalAmount: 0, lineTotal: 5.0, discountAmount: 1.0, taxAmount: 0.5 }),
    inv({ id: "inv-b", saleDate: "2026-11-05", createdAt: "2026-11-05T10:00:00.000Z", dueDate: "2026-11-10", totalAmount: null, lineTotal: 2.13, discountAmount: 0, taxAmount: 0 }),
  ],
  1.0,
);
check(
  "Same-second invoices order by id, and the pool follows that order",
  [
    inv({ id: "inv-b", saleDate: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z", dueDate: "2026-12-01", totalAmount: 0.2 }),
    inv({ id: "inv-a", saleDate: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z", dueDate: "2026-11-05", totalAmount: 0.1 }),
  ],
  0.15,
);

console.log("Credit outstanding single query passed: loop and single-query math agree on empty, partial-pool, full-pool, overdue-mix, recomputed-total and same-second-ordering fixtures.");
