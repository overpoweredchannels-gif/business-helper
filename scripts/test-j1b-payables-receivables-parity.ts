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
//   A1: 1000 − 50 confirmed return − 400 explicit − 100 legacy pool = 450
//       (cancelled €30 return deducts nothing; voided €500 payment and
//       its €500 allocation row count toward nothing)
//   B1 (cash): 200 − 0 − 0 − 200 pool = 0
//   Payables total = 450; supplier A overdue 450 (due 2026-11-09)
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

function buildFixture(): MemoryWriterRawData {
  return {
    organizationId: "org-j1b",
    organizationName: "J1b Fixture Org",
    ownerName: "Test Owner",
    timezone: "Asia/Karachi",
    currency: "EUR",
    products: [
      {
        id: 1,
        name: "Widget",
        last_purchase_price: 100,
        default_selling_price: 100,
        reorder_level: 0,
      },
    ],
    customers: [
      {
        id: "cus-c1",
        customer_name: "Customer One",
        credit_days: 30,
        credit_limit: null,
        allow_over_limit: false,
        allow_overdue_sales: false,
      },
    ],
    suppliers: [
      { id: "sup-a", supplier_name: "Supplier A", credit_days: 30 },
      { id: "sup-b", supplier_name: "Supplier B", credit_days: 30 },
    ],
    staff: [],
    salesTransactions: [
      {
        id: "st-s1",
        customer_id: "cus-c1",
        invoice_number: "INV-S1",
        created_at: "2026-11-10T10:00:00.000Z",
        sale_date: "2026-11-10",
        payment_type: "credit",
        credit_due_date: "2026-12-10",
      },
      {
        id: "st-s2",
        customer_id: "cus-c1",
        invoice_number: "INV-S2",
        created_at: "2026-10-01T10:00:00.000Z",
        sale_date: "2026-10-01",
        payment_type: "credit",
        credit_due_date: "2026-10-31",
      },
    ],
    salesItems: [
      {
        id: "si-s1",
        sales_transaction_id: "st-s1",
        product_id: 1,
        quantity: 5,
        selling_price: 100,
        purchase_price_snapshot: 100,
        created_at: "2026-11-10T10:00:00.000Z",
      },
      {
        id: "si-s2",
        sales_transaction_id: "st-s2",
        product_id: 1,
        quantity: 1,
        selling_price: 100,
        purchase_price_snapshot: 100,
        created_at: "2026-10-01T10:00:00.000Z",
      },
    ],
    purchaseTransactions: [
      {
        id: "pt-a1",
        supplier_id: "sup-a",
        invoice_number: "INV-A1",
        created_at: "2026-10-10T10:00:00.000Z",
        purchase_date: "2026-10-10",
        payment_type: "credit",
      },
      {
        id: "pt-b1",
        supplier_id: "sup-b",
        invoice_number: "INV-B1",
        created_at: "2026-11-20T10:00:00.000Z",
        purchase_date: "2026-11-20",
        payment_type: "cash",
      },
    ],
    purchaseItems: [
      {
        id: "pi-a1",
        purchase_transaction_id: "pt-a1",
        product_id: 1,
        quantity: 10,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-10-10T10:00:00.000Z",
      },
      {
        id: "pi-b1",
        purchase_transaction_id: "pt-b1",
        product_id: 1,
        quantity: 2,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-20T10:00:00.000Z",
      },
    ],
    expenses: [],
    customerPayments: [
      {
        id: "cp-1",
        customer_id: "cus-c1",
        amount: 200,
        payment_date: "2026-11-12",
        voided_at: null,
        created_at: "2026-11-12T10:00:00.000Z",
      },
      {
        id: "cp-2",
        customer_id: "cus-c1",
        amount: 300,
        payment_date: "2026-11-15",
        voided_at: "2026-11-05T09:00:00.000Z",
        created_at: "2026-11-15T10:00:00.000Z",
      },
    ],
    supplierPayments: [
      {
        id: "sp-p1",
        supplier_id: "sup-a",
        amount: 400,
        payment_date: "2026-10-15",
        voided_at: null,
        created_at: "2026-10-15T10:00:00.000Z",
      },
      {
        id: "sp-p2",
        supplier_id: "sup-a",
        amount: 100,
        payment_date: "2026-10-20",
        voided_at: null,
        created_at: "2026-10-20T10:00:00.000Z",
      },
      {
        id: "sp-p3",
        supplier_id: "sup-a",
        amount: 500,
        payment_date: "2026-10-25",
        voided_at: "2026-11-01T09:00:00.000Z",
        created_at: "2026-10-25T10:00:00.000Z",
      },
      {
        id: "sp-p4",
        supplier_id: "sup-b",
        amount: 200,
        payment_date: "2026-11-20",
        voided_at: null,
        created_at: "2026-11-20T10:00:00.000Z",
      },
    ],
    tasks: [],
    alerts: [],
    // J1b collections (optional on MemoryWriterRawData; absent = no
    // returns / no explicit allocations, behaviour unchanged).
    purchaseReturns: [
      { id: "pr-r1", purchase_transaction_id: "pt-a1", status: "confirmed" },
      { id: "pr-r2", purchase_transaction_id: "pt-a1", status: "cancelled" },
    ],
    purchaseReturnItems: [
      { id: "pri-r1", purchase_return_id: "pr-r1", quantity: 1, unit_price: 50 },
      { id: "pri-r2", purchase_return_id: "pr-r2", quantity: 1, unit_price: 30 },
    ],
    salesReturns: [
      { id: "sr-1", sales_transaction_id: "st-s1", status: "confirmed" },
      { id: "sr-2", sales_transaction_id: "st-s1", status: "cancelled" },
    ],
    salesReturnItems: [
      { id: "sri-1", sales_return_id: "sr-1", quantity: 1, unit_price: 50, discount: 0 },
      { id: "sri-2", sales_return_id: "sr-2", quantity: 1, unit_price: 30, discount: 0 },
    ],
    supplierPaymentAllocations: [
      { id: "spa-1", supplier_payment_id: "sp-p1", purchase_transaction_id: "pt-a1", amount: 400 },
      { id: "spa-2", supplier_payment_id: "sp-p3", purchase_transaction_id: "pt-a1", amount: 500 },
    ],
    customerPaymentAllocations: [
      { id: "cpa-1", customer_payment_id: "cp-1", sales_transaction_id: "st-s1", amount: 200 },
      { id: "cpa-2", customer_payment_id: "cp-2", sales_transaction_id: "st-s1", amount: 300 },
    ],
  } as MemoryWriterRawData;
}

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
});
check(a1Net.remainingPayableAmount === 450, `A1 net remaining 450, got ${a1Net.remainingPayableAmount}`);

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
  `supplier B payable 0 (cash invoice covered by its pool), got ${supplierB?.payableAmount}`
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

// ─── Cash-invoice treatment: parity, not definition ───
//
// The tile engine runs over ALL purchase transactions (cash included),
// so an unpaid cash invoice counts as payable until a payment covers
// it. Parity means the brain does the same — whether a cash purchase
// SHOULD be payable is a write-path question (the atomic purchase
// flow records the payment), not a J1b question. Assert the brain
// equals the shared engine here, whatever that value is.

const cashOnlyData: MemoryWriterRawData = {
  ...buildFixture(),
  suppliers: [{ id: "sup-c", supplier_name: "Supplier C", credit_days: 30 }],
  purchaseTransactions: [
    {
      id: "pt-c1",
      supplier_id: "sup-c",
      invoice_number: "INV-C1",
      created_at: "2026-11-20T10:00:00.000Z",
      purchase_date: "2026-11-20",
      payment_type: "cash",
    },
  ],
  purchaseItems: [
    {
      id: "pi-c1",
      purchase_transaction_id: "pt-c1",
      product_id: 1,
      quantity: 2,
      purchase_price: 100,
      selling_price: 120,
      created_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  purchaseReturns: [],
  purchaseReturnItems: [],
  supplierPayments: [],
  supplierPaymentAllocations: [],
} as MemoryWriterRawData;
const cashEngineRemaining = netPurchaseInvoiceAllocation({
  purchaseTotal: 200,
  returnedAmount: 0,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
}).remainingPayableAmount;
const cashLedger = buildSupplierLedger(cashOnlyData, NOW);
check(
  cashLedger.byId.get("sup-c")?.payableAmount === cashEngineRemaining,
  `unpaid cash invoice: brain ${cashLedger.byId.get("sup-c")?.payableAmount} must equal tile engine ${cashEngineRemaining}`
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
