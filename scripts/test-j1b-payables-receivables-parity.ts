import "./validation-environment";
import assert from "node:assert/strict";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { buildSupplierLedger } from "../src/lib/ai/supplier-ledger";
import { buildFinancialLedger } from "../src/lib/ai/financial-ledger";
import {
  computeReturnedValueByPurchaseTransaction,
  netPurchaseInvoiceAllocation,
} from "../src/lib/purchases/returns-offset";
import {
  computeCreditAllocationsByTransaction,
  computeReturnedValueBySalesTransaction,
  computeSalesInvoiceNetTotal,
} from "../src/lib/sales/returns-offset";
import type { MemoryWriterRawData } from "../src/lib/brain/contracts/memory";
import { buildPayablesReceivablesFixture as buildFixture, buildMixedCashRuleFixture } from "./fixtures/j1b-payables-receivables";

// J1b — Payables/Receivables parity (2026-11-24, Claude msg 47 order).
//
// Defect (J1 inventory): the dashboard tile, the AI alert generator and
// the AI-chat context share ONE returns-aware allocation engine
// (netPurchaseInvoiceAllocation / computeCreditAllocationsByTransaction):
//   remaining = max(0, total − confirmed returns − explicit allocations)
//               − min(legacy unallocated-payment pool, that)
// with voided payments (and their allocation rows) excluded everywhere
// and cancelled returns offsetting nothing. The brain runs a SECOND,
// returns-blind credit-only FIFO (supplier-ledger.ts /
// customer-ledger.ts) that ignores returns AND explicit allocations, so
// its Payables/Receivables differ from the tiles whenever a confirmed
// return or an explicitly allocated payment exists.
//
// Fix: the brain ledgers call the SAME shared engines, fed by the same
// inputs the tile uses. That needs the data the brain never loaded:
// purchase/sales returns + return items and both payment-allocation
// tables (MemoryWriterRawData + loadRawBusinessData gain six optional
// collections; the ledgers tolerate them missing).
//
// Fixture (J1 inventory §(c), extended with a voided payment and a
// cancelled return on EACH side). Fixed now = 2026-11-24, EUR org.
// Hand-computed expectations (the definition, not any implementation):
//   A1 (credit): 1000 − 50 confirmed return − 400 explicit − 100 legacy pool = 450
//       (cancelled €30 return deducts nothing; voided €500 payment and
//       its €500 allocation row count toward nothing)
//   B1 (cash): payable 0 — paid at entry under the cash rule (2026-11-25);
//       the pool is not consumed by a cash invoice
//   Payables total = 450; supplier A overdue 450 (due 2026-11-09)
//   Mixed cash-rule case (supplier D, added on the 6e3c542 rebase):
//       D1 cash 300 − 50 confirmed return, €100 explicit allocation
//       ignored, pool untouched; D2 credit 400 − 150 explicit − 50
//       pool = 200 payable (a cash invoice consuming the pool would
//       leave 250). Supplier D payable 200, overdue 0.
//   S1: 500 − 50 confirmed return − 200 explicit − 0 pool = 250
//       (cancelled €30 return deducts nothing; voided €300 payment and
//       its €300 allocation row count toward nothing)
//   S2: 100 − 0 − 0 − 0 = 100, overdue (due 2026-10-31)
//   Receivables total = 350; overdue = 100
//
// DISCOUNT/TAX FIX (2026-11-25, Claude msg 49 — J1b ships only at
// receivables parity 0.00): the tile's sales invoice total nets line
// discounts, invoice discount and tax; the brain's invoice amount was
// the plain item sum. The two agree when discount = 0 and tax = 0 —
// this fixture's case, and the common case — but on production data
// the divergence is +€1.33 on receivables (aggregate invoice-total
// divergence −€1.52 over credit invoices). The loader now carries
// total_amount / discount_amount / tax_rate (+ line discount) and the
// customer ledger uses computeSalesInvoiceNetTotal, the tile's same
// formula (see the discount/tax section below).
//
// Run: npx tsx scripts/test-j1b-payables-receivables-parity.ts

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

const NOW = new Date("2026-11-24T12:00:00.000Z");

// ─── Shared-engine cross-checks (the tile engine itself, same inputs) ───

const fixture = buildFixture();

const returnedByPurchaseTx = computeReturnedValueByPurchaseTransaction(
  fixture.purchaseReturns ?? [],
  fixture.purchaseReturnItems ?? []
);
check(
  returnedByPurchaseTx["pt-a1"] === 50,
  `confirmed purchase return offsets 50 (cancelled 30 ignored), got ${returnedByPurchaseTx["pt-a1"]}`
);

const returnedBySalesTx = computeReturnedValueBySalesTransaction(
  fixture.salesReturns ?? [],
  fixture.salesReturnItems ?? []
);
check(
  returnedBySalesTx["st-s1"] === 50,
  `confirmed sales return offsets 50 (cancelled 30 ignored), got ${returnedBySalesTx["st-s1"]}`
);

const a1Net = netPurchaseInvoiceAllocation({
  purchaseTotal: 1000,
  returnedAmount: 50,
  explicitAllocatedAmount: 400,
  legacyPoolAvailable: 100,
  paymentType: "credit",
});
check(a1Net.remainingPayableAmount === 450, `A1 net remaining 450, got ${a1Net.remainingPayableAmount}`);

// ─── Cash rule (2026-11-25): only an explicit credit invoice is a payable ───
//
// The tile engine's input carries the invoice's payment_type. Cash/card
// (and an unknown/missing type) are paid at entry: remaining 0, the
// legacy pool untouched, paidAmount = total − confirmed returns, and
// explicit allocations against the invoice reported as ignored (the
// money was already counted at entry).
const d1CashNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 300,
  returnedAmount: 50,
  explicitAllocatedAmount: 100,
  legacyPoolAvailable: 50,
  paymentType: "cash",
});
check(
  d1CashNet.remainingPayableAmount === 0,
  `cash invoice remaining 0, got ${d1CashNet.remainingPayableAmount}`
);
check(d1CashNet.paidAtEntry === true, "cash invoice is paid at entry");
check(
  d1CashNet.legacyPoolRemaining === 50,
  `cash invoice must not consume the pool (50 left), got ${d1CashNet.legacyPoolRemaining}`
);
check(
  d1CashNet.paidAmount === 250,
  `cash invoice paid-at-entry net 250 (300 − 50 return), got ${d1CashNet.paidAmount}`
);
check(
  d1CashNet.ignoredAllocatedAmount === 100,
  `cash invoice ignored allocation 100, got ${d1CashNet.ignoredAllocatedAmount}`
);
const unknownTypeNet = netPurchaseInvoiceAllocation({
  purchaseTotal: 400,
  returnedAmount: 0,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
});
check(
  unknownTypeNet.remainingPayableAmount === 0,
  `missing payment_type: remaining 0, got ${unknownTypeNet.remainingPayableAmount}`
);
check(
  unknownTypeNet.paidAtEntry === true,
  "missing payment_type is paid at entry, never silently a payable"
);

const creditAllocations = computeCreditAllocationsByTransaction(
  [
    {
      id: "st-s1",
      customerId: "cus-c1",
      invoiceTotal: 500,
      returnedAmount: 50,
      explicitAllocatedAmount: 200,
      sortDate: "2026-11-10",
      createdAt: "2026-11-10T10:00:00.000Z",
    },
    {
      id: "st-s2",
      customerId: "cus-c1",
      invoiceTotal: 100,
      returnedAmount: 0,
      explicitAllocatedAmount: 0,
      sortDate: "2026-10-01",
      createdAt: "2026-10-01T10:00:00.000Z",
    },
  ],
  { "cus-c1": 0 }
);
check(
  creditAllocations["st-s1"]?.remainingUnpaidAmount === 250,
  `S1 engine remaining 250, got ${creditAllocations["st-s1"]?.remainingUnpaidAmount}`
);
check(
  creditAllocations["st-s2"]?.remainingUnpaidAmount === 100,
  `S2 engine remaining 100, got ${creditAllocations["st-s2"]?.remainingUnpaidAmount}`
);

// ─── Brain ledgers must equal the tile engine on the same fixture ───

const supplierLedger = buildSupplierLedger(fixture, NOW);
const supplierA = supplierLedger.byId.get("sup-a");
const supplierB = supplierLedger.byId.get("sup-b");
check(supplierA !== undefined, "supplier A entry exists");
check(supplierB !== undefined, "supplier B entry exists");
check(
  supplierA?.payableAmount === 450,
  `supplier A payable 450, got ${supplierA?.payableAmount}`
);
check(
  supplierA?.paidAmount === 500,
  `supplier A paid 500 (voided 500 excluded), got ${supplierA?.paidAmount}`
);
check(
  supplierA?.overdueAmount === 450,
  `supplier A overdue 450, got ${supplierA?.overdueAmount}`
);
check(
  supplierB?.payableAmount === 0,
  `supplier B payable 0 (cash: paid at entry), got ${supplierB?.payableAmount}`
);
check(
  supplierB?.paidAmount === 200,
  `supplier B paid 200, got ${supplierB?.paidAmount}`
);
check(
  supplierLedger.totals.totalPayable === 450,
  `brain payables total 450, got ${supplierLedger.totals.totalPayable}`
);
check(
  supplierLedger.totals.totalOverdue === 450,
  `brain payables overdue 450, got ${supplierLedger.totals.totalOverdue}`
);

const customerLedger = buildCustomerLedger(fixture, NOW);
const customerC1 = customerLedger.byId.get("cus-c1");
check(customerC1 !== undefined, "customer C1 entry exists");
check(
  customerC1?.outstandingBalance === 350,
  `customer C1 outstanding 350, got ${customerC1?.outstandingBalance}`
);
check(
  customerC1?.overdueAmount === 100,
  `customer C1 overdue 100, got ${customerC1?.overdueAmount}`
);
check(
  customerLedger.totals.totalOutstanding === 350,
  `brain receivables total 350, got ${customerLedger.totals.totalOutstanding}`
);
check(
  customerLedger.totals.totalOverdue === 100,
  `brain receivables overdue 100, got ${customerLedger.totals.totalOverdue}`
);

// ─── Financial ledger totals flow from the same ledgers ───

const financialLedger = buildFinancialLedger(fixture, NOW);
check(
  financialLedger.payables.total === 450,
  `financial ledger payables total 450, got ${financialLedger.payables.total}`
);
check(
  financialLedger.payables.overdue === 450,
  `financial ledger payables overdue 450, got ${financialLedger.payables.overdue}`
);
check(
  financialLedger.receivables.total === 350,
  `financial ledger receivables total 350, got ${financialLedger.receivables.total}`
);
check(
  financialLedger.receivables.overdue === 100,
  `financial ledger receivables overdue 100, got ${financialLedger.receivables.overdue}`
);

// ─── Discount/tax invoice totals: the brain must use the tile's net total ───
//
// The tile's sales invoice total (page.tsx salesInvoiceTotalsByTransaction)
// is the STORED total_amount when finite and > 0, else a recompute
// matching the save path: Σ(qty × price − line discount) − |invoice
// discount|, floored at 0, plus tax%. The brain used the plain item sum
// (qty × price), so a discounted/taxed credit invoice overstated the
// receivable — on production data this is the +€1.33 J1b receivables
// delta (aggregate invoice-total divergence −€1.52). The loader now
// carries total_amount / discount_amount / tax_rate (+ line discount),
// and buildCustomerLedger uses computeSalesInvoiceNetTotal, the same
// formula, extracted to src/lib/sales/returns-offset.ts.
//
// Hand-computed (tile formula):
//   S3: stored 189 → 189 (fallback would be 187: (200−10−20) × 1.10)
//   S4: stored 0 → fallback (200−10−20) × 1.10 = 187
//   C2 outstanding = 189 + 187 = 376 (no payments, no returns)

// The helper itself, both paths + the missing/degenerate inputs.
check(
  computeSalesInvoiceNetTotal(
    { total_amount: 189, discount_amount: 20, tax_rate: 10 },
    [{ quantity: 2, selling_price: 100, discount: 10 }]
  ) === 189,
  "stored total wins over the recompute"
);
check(
  computeSalesInvoiceNetTotal(
    { total_amount: 0, discount_amount: 20, tax_rate: 10 },
    [{ quantity: 2, selling_price: 100, discount: 10 }]
  ) === 187,
  `stored 0 falls back to the recompute (187), got ${computeSalesInvoiceNetTotal(
    { total_amount: 0, discount_amount: 20, tax_rate: 10 },
    [{ quantity: 2, selling_price: 100, discount: 10 }]
  )}`
);
check(
  computeSalesInvoiceNetTotal(
    {},
    [{ quantity: 2, selling_price: 100, discount: 10 }]
  ) === 190,
  "missing columns fall back to the recompute (190: line discount only, no invoice discount/tax to apply)"
);
check(
  computeSalesInvoiceNetTotal(
    { total_amount: -5, discount_amount: 20, tax_rate: 10 },
    [{ quantity: 2, selling_price: 100, discount: 10 }]
  ) === 187,
  "negative stored total falls back to the recompute (187)"
);

const discountTaxData: MemoryWriterRawData = {
  ...buildFixture(),
  customers: [
    {
      id: "cus-c2",
      customer_name: "Customer Two",
      credit_days: 30,
      credit_limit: null,
      allow_over_limit: false,
      allow_overdue_sales: false,
    },
  ],
  salesTransactions: [
    {
      id: "st-s3",
      customer_id: "cus-c2",
      invoice_number: "INV-S3",
      created_at: "2026-11-15T10:00:00.000Z",
      sale_date: "2026-11-15",
      payment_type: "credit",
      credit_due_date: "2026-12-15",
      total_amount: 189,
      discount_amount: 20,
      tax_rate: 10,
    },
    {
      id: "st-s4",
      customer_id: "cus-c2",
      invoice_number: "INV-S4",
      created_at: "2026-11-16T10:00:00.000Z",
      sale_date: "2026-11-16",
      payment_type: "credit",
      credit_due_date: "2026-12-16",
      total_amount: 0,
      discount_amount: 20,
      tax_rate: 10,
    },
  ],
  salesItems: [
    {
      id: "si-s3",
      sales_transaction_id: "st-s3",
      product_id: 1,
      quantity: 2,
      selling_price: 100,
      purchase_price_snapshot: 100,
      discount: 10,
      created_at: "2026-11-15T10:00:00.000Z",
    },
    {
      id: "si-s4",
      sales_transaction_id: "st-s4",
      product_id: 1,
      quantity: 2,
      selling_price: 100,
      purchase_price_snapshot: 100,
      discount: 10,
      created_at: "2026-11-16T10:00:00.000Z",
    },
  ],
  salesReturns: [],
  salesReturnItems: [],
  customerPayments: [],
  customerPaymentAllocations: [],
} as MemoryWriterRawData;

const discountTaxLedger = buildCustomerLedger(discountTaxData, NOW);
const customerC2 = discountTaxLedger.byId.get("cus-c2");
check(customerC2 !== undefined, "customer C2 entry exists");
check(
  customerC2?.outstandingBalance === 376,
  `customer C2 outstanding 376 (189 stored + 187 recomputed), got ${customerC2?.outstandingBalance}`
);
check(
  customerC2?.overdueAmount === 0,
  `customer C2 overdue 0 (due dates in future), got ${customerC2?.overdueAmount}`
);
check(
  discountTaxLedger.totals.totalOutstanding === 376,
  `brain receivables total 376, got ${discountTaxLedger.totals.totalOutstanding}`
);
check(
  customerC2?.totalSales === 376,
  `customer C2 total sales 376 (net, not gross 400), got ${customerC2?.totalSales}`
);
check(
  customerC2?.invoices.map((inv) => inv.amount).join(",") === "189,187",
  `customer C2 invoice amounts 189,187, got ${customerC2?.invoices.map((inv) => inv.amount).join(",")}`
);

// ─── Mixed cash-rule fixture: credit + cash, partial payments, returns, void ───
//
// Supplier D carries the cash-rule case the old "parity, not definition"
// section deliberately left open (the cash rule, 2026-11-25, settled it:
// cash is paid at entry, only credit is a payable):
//   D1 (cash, 2026-11-05): 3 × 100 = 300, confirmed return 50,
//       explicit allocation 100 (ignored), voided payment 500 with its
//       allocation row (counts toward nothing), cancelled return 30
//       (offsets nothing). Payable 0; paid-at-entry net 250.
//   D2 (credit, 2026-11-10): 4 × 100 = 400, explicit allocation 150
//       (partial payment), due 2026-12-10 (not overdue).
//   Pool: non-voided payments 300 − explicit 250 = 50. D1 (cash) must
//       NOT consume it, so D2 gets the 50: 400 − 150 − 50 = 200 payable.
//       (If a cash invoice consumed the pool, D2 would read 250.)
//   Supplier D: payable 200, overdue 0, paid 300 (voided 500 excluded).
//   Financial ledger: payables 200; ignoredCashPurchasePayments 1 / 100
//       (D1's allocation — money recorded twice, reported not hidden).
// Discount/tax stay covered by the S3/S4 section above (sales side;
// purchase totals carry no discount/tax in either engine).

const mixedCashRuleData = buildMixedCashRuleFixture();

const mixedSupplierLedger = buildSupplierLedger(mixedCashRuleData, NOW);
const supplierD = mixedSupplierLedger.byId.get("sup-d");
check(supplierD !== undefined, "supplier D entry exists");
check(
  supplierD?.payableAmount === 200,
  `supplier D payable 200 (D1 cash 0 + D2 credit 200), got ${supplierD?.payableAmount}`
);
check(
  supplierD?.overdueAmount === 0,
  `supplier D overdue 0 (D2 due 2026-12-10), got ${supplierD?.overdueAmount}`
);
check(
  supplierD?.paidAmount === 300,
  `supplier D paid 300 (voided 500 excluded), got ${supplierD?.paidAmount}`
);
check(
  mixedSupplierLedger.totals.totalPayable === 200,
  `mixed fixture brain payables total 200, got ${mixedSupplierLedger.totals.totalPayable}`
);
check(
  mixedSupplierLedger.totals.suppliersOwing === 1,
  `mixed fixture suppliers owing 1, got ${mixedSupplierLedger.totals.suppliersOwing}`
);

const mixedFinancialLedger = buildFinancialLedger(mixedCashRuleData, NOW);
check(
  mixedFinancialLedger.payables.total === 200,
  `mixed fixture financial ledger payables 200, got ${mixedFinancialLedger.payables.total}`
);
check(
  mixedFinancialLedger.cash.ignoredCashPurchasePayments.count === 1,
  `mixed fixture ignored cash-purchase payments 1, got ${mixedFinancialLedger.cash.ignoredCashPurchasePayments.count}`
);
check(
  mixedFinancialLedger.cash.ignoredCashPurchasePayments.amount === 100,
  `mixed fixture ignored cash-purchase payments €100, got ${mixedFinancialLedger.cash.ignoredCashPurchasePayments.amount}`
);

// ─── Missing J1b collections must not change behaviour ───

const legacyData = buildFixture();
delete (legacyData as unknown as Record<string, unknown>).purchaseReturns;
delete (legacyData as unknown as Record<string, unknown>).purchaseReturnItems;
delete (legacyData as unknown as Record<string, unknown>).salesReturns;
delete (legacyData as unknown as Record<string, unknown>).salesReturnItems;
delete (legacyData as unknown as Record<string, unknown>).supplierPaymentAllocations;
delete (legacyData as unknown as Record<string, unknown>).customerPaymentAllocations;
const legacySupplier = buildSupplierLedger(legacyData, NOW);
const legacyCustomer = buildCustomerLedger(legacyData, NOW);
check(
  legacySupplier.totals.totalPayable === 500,
  `without returns/allocations, brain payables fall back to the old FIFO total 500, got ${legacySupplier.totals.totalPayable}`
);
check(
  legacyCustomer.totals.totalOutstanding === 400,
  `without returns/allocations, brain receivables fall back to the old FIFO total 400, got ${legacyCustomer.totals.totalOutstanding}`
);

console.log(`J1b payables/receivables parity: ${passed} checks passed`);
