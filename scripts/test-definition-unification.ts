import assert from "node:assert/strict";
import { computeInventoryValuation } from "../src/lib/inventory/valuation";
import {
  productInsightsStatusFor,
  reorderTableStatusFor,
  stockStatusFor,
} from "../src/lib/inventory/service";
import {
  computeCreditAllocationsByTransaction,
  computeCustomerRemainingByTransaction,
  computeReturnedValueBySalesTransaction,
} from "../src/lib/sales/returns-offset";

// M1 definition unifications (UMAIR-approved 2026-10-22). Fixtures are
// shaped like the real rows the app stores / fetches:
//  - valuation inputs mirror page.tsx inventoryStats + the products select
//    (id, name, current_stock, last_purchase_price, default_selling_price);
//  - return rows mirror POST /api/sales/returns (status "confirmed",
//    sales_transaction_id = source invoice, items quantity/unit_price/
//    discount), exactly as in test-sales-return-offset.ts;
//  - history rows mirror GET /api/customers/history (transactions carry
//    total_amount / payment_type / status / sale_date / created_at;
//    payments carry customer_id / amount; allocations carry
//    sales_transaction_id / amount).

// ═══ Decision 1 — inventory valuation: ONE cost basis ═════════════════════

const valuationFixture = [
  { productId: "A", productName: "Known cost", currentStock: 10, lastPurchasePrice: 100, defaultSellingPrice: 150 },
  { productId: "B", productName: "Unknown cost, stocked", currentStock: 5, lastPurchasePrice: 0, defaultSellingPrice: 80 },
  { productId: "C", productName: "Negative stock, known cost", currentStock: -4, lastPurchasePrice: 50, defaultSellingPrice: 60 },
  { productId: "D", productName: "Zero stock, known cost", currentStock: 0, lastPurchasePrice: 70, defaultSellingPrice: 90 },
  { productId: "E", productName: "Unknown cost, no selling price", currentStock: 3, lastPurchasePrice: null, defaultSellingPrice: 0 },
  { productId: "F", productName: "Negative stock, unknown cost", currentStock: -2, lastPurchasePrice: null, defaultSellingPrice: 90 },
];

const valuation = computeInventoryValuation(valuationFixture);
assert.equal(valuation.totalValue, 1000, "headline = known-cost stock only, negatives clamped");
assert.equal(valuation.unknownCostProductCount, 2, "B and E have stock but no known cost");
assert.equal(valuation.unknownCostUnits, 8, "5 + 3 units of unknown-cost stock");
assert.equal(valuation.unknownCostSellingEstimate, 400, "flagged estimate at selling price: 5×80 + 3×0");
assert.deepEqual(
  valuation.unknownCostProducts.map((p) => p.productId),
  ["B", "E"]
);

// The two pre-fix formulas, reproduced to prove the fixture is a genuine
// divergence set and that the unified headline adopts the BI basis:
//  - old Dashboard: selling-price fallback, negative stock subtracts → 1020
//  - old BI: cost-only, negatives clamped → 1000
const legacyDashboard = valuationFixture.reduce(
  (sum, p) => sum + p.currentStock * (Number(p.lastPurchasePrice ?? 0) > 0 ? Number(p.lastPurchasePrice) : Number(p.defaultSellingPrice ?? 0) || 0),
  0
);
const legacyBi = valuationFixture.reduce(
  (sum, p) => sum + Math.max(0, p.currentStock) * (Number(p.lastPurchasePrice ?? 0) > 0 ? Number(p.lastPurchasePrice) : 0),
  0
);
assert.equal(legacyDashboard, 1020);
assert.equal(legacyBi, 1000);
assert.equal(valuation.totalValue, legacyBi, "unified headline = the BI cost-only basis");
assert.notEqual(valuation.totalValue, legacyDashboard, "the old Dashboard figure is gone");

// Dashboard and BI feed the same lib over the same catalogue, so equality
// is by construction; assert the raw-products mapping shape gives the same.
const fromRawProducts = computeInventoryValuation(
  valuationFixture.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    currentStock: p.currentStock,
    lastPurchasePrice: p.lastPurchasePrice,
    defaultSellingPrice: p.defaultSellingPrice,
  }))
);
assert.equal(fromRawProducts.totalValue, valuation.totalValue);

// ═══ Decision 2 — "healthy stock": ONE classifier ══════════════════════════

// The two pre-fix inline rules, reproduced from page.tsx before the fix:
const oldInsightsStatus = (stock: number, level: number, sold30: number) => {
  const daily = sold30 / 30;
  const daysLeft = daily > 0 ? stock / daily : stock > 0 ? Infinity : 0;
  return stock <= 0 ? "Out of Stock" : level > 0 && stock <= level ? "Reorder Needed" : daysLeft <= 7 ? "Low (≈7 days left)" : "Healthy";
};
const oldReorderStatus = (stock: number, level: number, sold30: number) => {
  const daily = sold30 / 30;
  const daysLeft = daily > 0 ? stock / daily : null;
  return stock <= 0 ? "Out of Stock" : stock <= level ? "Urgent Reorder" : daily > 0 && daysLeft !== null && daysLeft <= 7 ? "Low Stock Soon" : "Healthy";
};

const classifierFixture = [
  // No reorder level, no sales: old rules said "Healthy" on both surfaces;
  // the shared classifier never calls stock without a level healthy.
  { name: "A no-level idle", stock: 20, level: 0, sold30: 0, shared: "missing_reorder_level", table: "Missing Reorder Level", insights: "No Reorder Level" },
  // At/below reorder level: every rule agreed — urgent.
  { name: "B below level", stock: 5, level: 10, sold30: 0, shared: "urgent_reorder", table: "Urgent Reorder", insights: "Reorder Needed" },
  // Above level but ~1 day of cover: velocity demoted it to "Low" on both
  // old surfaces; the shared classifier calls it healthy — velocity is now
  // only the days-left figure.
  { name: "C fast mover above level", stock: 8, level: 5, sold30: 240, shared: "healthy", table: "Healthy", insights: "Healthy" },
  // Out of stock: every rule agreed.
  { name: "D out of stock", stock: 0, level: 5, sold30: 0, shared: "out_of_stock", table: "Out of Stock", insights: "Out of Stock" },
  // No reorder level with fast sales: old rules said Low/Healthy; shared
  // classifier says the level is missing.
  { name: "E no-level fast mover", stock: 3, level: 0, sold30: 90, shared: "missing_reorder_level", table: "Missing Reorder Level", insights: "No Reorder Level" },
] as const;

for (const row of classifierFixture) {
  assert.equal(stockStatusFor(row.stock, row.level).status, row.shared, `${row.name}: shared verdict`);
  assert.equal(reorderTableStatusFor(row.stock, row.level), row.table, `${row.name}: reorder table label`);
  assert.equal(productInsightsStatusFor(row.stock, row.level), row.insights, `${row.name}: insights label`);
}
// The fixture genuinely disagrees under the old rules:
assert.equal(oldInsightsStatus(20, 0, 0), "Healthy");
assert.equal(oldReorderStatus(20, 0, 0), "Healthy");
assert.equal(oldInsightsStatus(8, 5, 240), "Low (≈7 days left)");
assert.equal(oldReorderStatus(8, 5, 240), "Low Stock Soon");
assert.equal(oldInsightsStatus(3, 0, 90), "Low (≈7 days left)");
// …and agreed where the shared classifier also agrees:
assert.equal(oldInsightsStatus(5, 10, 0), "Reorder Needed");
assert.equal(oldReorderStatus(0, 5, 0), "Out of Stock");

// ═══ Decision 3 — Customer History = receivables engine semantics ══════════

const C1 = "cust-1";
const INV1 = "inv-1"; // credit 300, 2026-10-01, return 50
const INV2 = "inv-2"; // credit 200, 2026-10-05
const returnedByTransaction = computeReturnedValueBySalesTransaction(
  [{ id: "ret-1", sales_transaction_id: INV1, status: "confirmed" }],
  [{ sales_return_id: "ret-1", quantity: 1, unit_price: 50, discount: 0 }]
);
assert.deepEqual(returnedByTransaction, { [INV1]: 50 });

const historyInput = {
  transactions: [
    { id: INV1, customerId: C1, invoiceTotal: 300, paymentType: "credit", status: "confirmed", sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: INV2, customerId: C1, invoiceTotal: 200, paymentType: "credit", status: "confirmed", sortDate: "2026-10-05", createdAt: "2026-10-05T09:00:00.000Z" },
    // REHAN-shaped: fully covered by an unallocated payment.
    { id: "inv-3", customerId: "cust-2", invoiceTotal: 265850, paymentType: "credit", status: "confirmed", sortDate: "2026-09-01", createdAt: "2026-09-01T09:00:00.000Z" },
    // Explicit allocation + pool interplay.
    { id: "inv-4", customerId: "cust-3", invoiceTotal: 500, paymentType: "credit", status: "confirmed", sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: "inv-5", customerId: "cust-3", invoiceTotal: 500, paymentType: "credit", status: "confirmed", sortDate: "2026-10-03", createdAt: "2026-10-03T09:00:00.000Z" },
    // Cash invoice never draws on the pool.
    { id: "inv-6", customerId: "cust-4", invoiceTotal: 150, paymentType: "cash", status: "confirmed", sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: "inv-7", customerId: "cust-4", invoiceTotal: 100, paymentType: "credit", status: "confirmed", sortDate: "2026-10-02", createdAt: "2026-10-02T09:00:00.000Z" },
    // Cancelled documents are outside History's universe and consume no pool.
    { id: "inv-8", customerId: "cust-5", invoiceTotal: 200, paymentType: "credit", status: "cancelled", sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: "inv-9", customerId: "cust-5", invoiceTotal: 100, paymentType: "credit", status: "confirmed", sortDate: "2026-10-02", createdAt: "2026-10-02T09:00:00.000Z" },
    // Same-date FIFO tie-break by creation time.
    { id: "inv-10", customerId: "cust-6", invoiceTotal: 100, paymentType: "credit", status: "confirmed", sortDate: "2026-10-01", createdAt: "2026-10-01T15:00:00.000Z" },
    { id: "inv-11", customerId: "cust-6", invoiceTotal: 100, paymentType: "credit", status: "confirmed", sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
  ],
  payments: [
    { customerId: C1, amount: 350 }, // fully unallocated
    { customerId: "cust-2", amount: 265850 }, // fully unallocated
    { customerId: "cust-3", amount: 400 }, // explicitly allocated to inv-5
    { customerId: "cust-3", amount: 300 }, // unallocated → pool
    { customerId: "cust-4", amount: 40 }, // unallocated → pool (credit only)
    { customerId: "cust-5", amount: 150 }, // unallocated
    { customerId: "cust-6", amount: 100 }, // unallocated
  ],
  allocations: [{ salesTransactionId: "inv-5", amount: 400 }],
  returnedValueByTransaction: returnedByTransaction,
};

const remaining = computeCustomerRemainingByTransaction(historyInput);

// Task fixture: pool 350 FIFO — inv1: 300 − 50 returned = 250 covered → 0;
// inv2: 200 − 100 pool left → 100.
assert.equal(remaining[INV1].remaining, 0, "inv1 remaining");
assert.equal(remaining[INV1].allocatedAmount, 250, "inv1 covered by pool after the return");
assert.equal(remaining[INV1].returnedAmount, 50);
assert.equal(remaining[INV2].remaining, 100, "inv2 remaining");
assert.equal(remaining[INV2].allocatedAmount, 100, "inv2 gets the pool remainder");

// Cross-check against the receivables engine itself (the shared FIFO the
// page.tsx engine now runs) on identical inputs — must be identical.
const engine = computeCreditAllocationsByTransaction(
  [
    { id: INV1, customerId: C1, invoiceTotal: 300, returnedAmount: 50, explicitAllocatedAmount: 0, sortDate: "2026-10-01", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: INV2, customerId: C1, invoiceTotal: 200, returnedAmount: 0, explicitAllocatedAmount: 0, sortDate: "2026-10-05", createdAt: "2026-10-05T09:00:00.000Z" },
  ],
  { [C1]: 350 }
);
assert.equal(remaining[INV1].remaining, engine[INV1].remainingUnpaidAmount, "History ≡ engine (inv1)");
assert.equal(remaining[INV2].remaining, engine[INV2].remainingUnpaidAmount, "History ≡ engine (inv2)");
assert.equal(remaining[INV1].allocatedAmount, engine[INV1].allocatedAmount, "History ≡ engine allocations (inv1)");

// REHAN-shaped: History used to report 265,850 owed; engine semantics → 0.
assert.equal(remaining["inv-3"].remaining, 0, "unallocated payment fully covers the invoice");

// Explicit allocation is honoured first; the pool then flows FIFO to the
// OLDEST invoice (inv-4), not the explicitly-paid one.
assert.equal(remaining["inv-4"].remaining, 200, "inv4: 500 − 300 pool");
assert.equal(remaining["inv-5"].remaining, 100, "inv5: 500 − 400 explicit");

// Cash invoices never draw on the pool; the pool still reaches credit ones.
assert.equal(remaining["inv-6"].remaining, 150, "cash invoice untouched by pool");
assert.equal(remaining["inv-7"].remaining, 60, "credit invoice: 100 − 40 pool");

// Cancelled documents are excluded and consume nothing.
assert.equal(remaining["inv-8"], undefined, "cancelled invoice has no remaining entry");
assert.equal(remaining["inv-9"].remaining, 0, "pool flows past the cancelled invoice: 100 − 100 of 150");

// Same-date invoices: the earlier-created is paid first.
assert.equal(remaining["inv-11"].remaining, 0, "earlier-created invoice wins the pool");
assert.equal(remaining["inv-10"].remaining, 100, "later-created invoice keeps its balance");

console.log("Definition unification tests passed (valuation, classifier parity, history FIFO netting).");
