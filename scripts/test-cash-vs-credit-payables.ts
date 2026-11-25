import "./validation-environment";
import assert from "node:assert/strict";
import { buildSupplierLedger } from "../src/lib/ai/supplier-ledger";
import { buildFinancialLedger } from "../src/lib/ai/financial-ledger";
import {
  computeReturnedValueByPurchaseTransaction,
  isPaidAtEntryPurchasePaymentType,
  isPayablePurchasePaymentType,
  netPurchaseInvoiceAllocation,
  normalizePurchasePaymentType,
  paidAtEntryCreditForPurchase,
  payableBySupplierId,
} from "../src/lib/purchases/returns-offset";
import {
  PURCHASE_PAYMENT_TYPE_DEFAULT,
  PURCHASE_PAYMENT_TYPE_OPTIONS,
  validatePurchaseTransactionInput,
} from "../src/lib/purchases/validation";
import type { MemoryWriterRawData } from "../src/lib/brain/contracts/memory";

// Cash vs credit payables (2026-11-25, Claude msg 50 order — separate slice
// FIRST, J1b rebases on top).
//
// Rule 1 (UMAIR-approved 2026-11-16, permanent): outstanding = Credit
// Sales − Confirmed Returns − Non-Voided Payments; cash/card sales are
// Paid by construction and contribute 0. The purchase tile engine is the
// ONLY place that drifted from it: it counts EVERY purchase as payable,
// so all 57 cash purchases on production show as €9,475.86 payable while
// the true payable is €0.00.
//
// Defect, in one place — the shared allocation engine's input
// normalization (src/lib/purchases/returns-offset.ts): the tile engine,
// the supplier-payment candidates and the Suppliers list all consume
// netPurchaseInvoiceAllocation, which never looked at payment_type.
// The web purchase form also hardcodes payment_type "cash"
// (page.tsx handleCreatePurchaseInvoice + PO receive), so a credit
// purchase can today only be created via AI chat — the 57/57 cash on
// production is a forced value, not a user choice. And the brain's
// cash-out double-counts: it adds non-voided supplier payments AND cash
// purchase totals, so a payment recorded against a cash purchase (the
// UI invited it — the supplier-payment screen lists cash purchases as
// payable candidates) counts twice.
//
// Fix: the filter lives in ONE place — the engine input normalization.
// Positive match: only explicit "credit" is payable; everything else
// (cash, card) is paid at entry with remaining 0; unknown/null type is
// treated as paid AND logged as an anomaly. The form gains a
// payment-type selector (cash/credit), the candidates exclude cash, the
// Suppliers list reads the engine's per-supplier result, a cash purchase
// shows as "Paid at entry" (zero balance effect) on the supplier
// statement, and the brain cash-out ignores payments allocated to cash
// purchases and reports the anomaly count.
//
// NOT in this slice: payment-method recording (bank transfer / Easypaisa
// / JazzCash / online sub-select) — separate scope (UMAIR 15:02/15:05);
// no migration; no auto-recorded payment rows; receivables untouched
// (already credit-only on every layer).
//
// Fixture (fixed now = 2026-11-25, EUR org). Hand-computed expectations:
//   pt-a1 (sup-a, credit, 1000): −50 confirmed return −400 explicit
//     −100 legacy pool = 450 remaining, paid 500
//   pt-a2 (sup-a, credit, 500): cancelled €30 return deducts nothing;
//     voided €500 payment + its €500 allocation count toward nothing;
//     pool exhausted by pt-a1 → 500 remaining, paid 0
//   pt-b1 (sup-b, cash, 200): €200 explicit allocation is the anomaly —
//     remaining 0, paid 200, pool untouched (150 stays)
//   pt-b2 (sup-b, cash, 300): no payments → remaining 0, paid 300
//   pt-b3 (sup-b, cash, 100): confirmed €100 return → remaining 0,
//     paid 0 (fully returned)
//   pt-c1 (sup-c, payment_type null, 400): treated as paid + anomaly
//     logged → remaining 0, paid 400
//   pt-c2 (sup-c, "CARD", 100): card is paid at entry → remaining 0,
//     paid 100, no anomaly (card is a known immediate type)
//   Tile payables total = 450 + 500 = 950
//   Brain supplier ledger (credit-only FIFO, returns-blind — J1b scope):
//     sup-a payable 1000 (pool 500 covers pt-a1 first), sup-b 0, sup-c 0
//   Brain cash-out: cash purchase totals 600 + counted payments
//     (400 + 100 + 150) = 1250; the €200 on pt-b1 is ignored and
//     reported as 1 anomalous allocation; the voided €500 counts nowhere
//   (before the fix the cash-out was 600 + 850 = 1450)
//
// Run: npx tsx scripts/test-cash-vs-credit-payables.ts

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

const NOW = new Date("2026-11-25T12:00:00.000Z");

function buildFixture(): MemoryWriterRawData {
  return {
    organizationId: "org-cash-rule",
    organizationName: "Cash Rule Fixture Org",
    ownerName: "Test Owner",
    timezone: "Asia/Karachi",
    currency: "EUR",
    products: [
      {
        id: 1,
        name: "Widget",
        last_purchase_price: 100,
        default_selling_price: 120,
        reorder_level: 0,
      },
    ],
    customers: [],
    suppliers: [
      { id: "sup-a", supplier_name: "Supplier A", credit_days: 30 },
      { id: "sup-b", supplier_name: "Supplier B", credit_days: 30 },
      { id: "sup-c", supplier_name: "Supplier C", credit_days: 30 },
    ],
    staff: [],
    salesTransactions: [],
    salesItems: [],
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
        id: "pt-a2",
        supplier_id: "sup-a",
        invoice_number: "INV-A2",
        created_at: "2026-11-01T10:00:00.000Z",
        purchase_date: "2026-11-01",
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
      {
        id: "pt-b2",
        supplier_id: "sup-b",
        invoice_number: "INV-B2",
        created_at: "2026-11-21T10:00:00.000Z",
        purchase_date: "2026-11-21",
        payment_type: "cash",
      },
      {
        id: "pt-b3",
        supplier_id: "sup-b",
        invoice_number: "INV-B3",
        created_at: "2026-11-22T10:00:00.000Z",
        purchase_date: "2026-11-22",
        payment_type: "cash",
      },
      {
        id: "pt-c1",
        supplier_id: "sup-c",
        invoice_number: "INV-C1",
        created_at: "2026-11-23T10:00:00.000Z",
        purchase_date: "2026-11-23",
        payment_type: null,
      },
      {
        id: "pt-c2",
        supplier_id: "sup-c",
        invoice_number: "INV-C2",
        created_at: "2026-11-24T10:00:00.000Z",
        purchase_date: "2026-11-24",
        payment_type: "CARD",
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
        id: "pi-a2",
        purchase_transaction_id: "pt-a2",
        product_id: 1,
        quantity: 5,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-01T10:00:00.000Z",
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
      {
        id: "pi-b2",
        purchase_transaction_id: "pt-b2",
        product_id: 1,
        quantity: 3,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-21T10:00:00.000Z",
      },
      {
        id: "pi-b3",
        purchase_transaction_id: "pt-b3",
        product_id: 1,
        quantity: 1,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-22T10:00:00.000Z",
      },
      {
        id: "pi-c1",
        purchase_transaction_id: "pt-c1",
        product_id: 1,
        quantity: 4,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-23T10:00:00.000Z",
      },
      {
        id: "pi-c2",
        purchase_transaction_id: "pt-c2",
        product_id: 1,
        quantity: 1,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-24T10:00:00.000Z",
      },
    ],
    expenses: [],
    customerPayments: [],
    tasks: [],
    alerts: [],
    supplierPayments: [
      {
        id: "sp-a1",
        supplier_id: "sup-a",
        amount: 400,
        payment_date: "2026-11-12",
        voided_at: null,
        created_at: "2026-11-12T10:00:00.000Z",
      },
      {
        id: "sp-a2",
        supplier_id: "sup-a",
        amount: 100,
        payment_date: "2026-11-13",
        voided_at: null,
        created_at: "2026-11-13T10:00:00.000Z",
      },
      {
        id: "sp-a3",
        supplier_id: "sup-a",
        amount: 500,
        payment_date: "2026-11-15",
        voided_at: "2026-11-16T09:00:00.000Z",
        created_at: "2026-11-15T10:00:00.000Z",
      },
      {
        id: "sp-b1",
        supplier_id: "sup-b",
        amount: 200,
        payment_date: "2026-11-21",
        voided_at: null,
        created_at: "2026-11-21T10:00:00.000Z",
      },
      {
        id: "sp-b2",
        supplier_id: "sup-b",
        amount: 150,
        payment_date: "2026-11-22",
        voided_at: null,
        created_at: "2026-11-22T10:00:00.000Z",
      },
    ],
    supplierPaymentAllocations: [
      {
        id: "spa-a1",
        supplier_payment_id: "sp-a1",
        purchase_transaction_id: "pt-a1",
        amount: 400,
      },
      {
        id: "spa-a3",
        supplier_payment_id: "sp-a3",
        purchase_transaction_id: "pt-a2",
        amount: 500,
      },
      {
        id: "spa-b1",
        supplier_payment_id: "sp-b1",
        purchase_transaction_id: "pt-b1",
        amount: 200,
      },
    ],
  };
}

// The tile's input construction, mirrored from page.tsx: voided payments
// (and their allocation rows) count toward nothing; the legacy pool is
// total non-voided payments minus explicit allocations, per supplier.
function buildTileInputs(data: MemoryWriterRawData) {
  const voidedPaymentIds = new Set(
    (data.supplierPayments ?? [])
      .filter((payment) => payment.voided_at)
      .map((payment) => String(payment.id))
  );
  const explicitByTx: Record<string, number> = {};
  for (const allocation of data.supplierPaymentAllocations ?? []) {
    if (voidedPaymentIds.has(String(allocation.supplier_payment_id ?? ""))) continue;
    const txId = String(allocation.purchase_transaction_id ?? "");
    if (!txId) continue;
    explicitByTx[txId] = (explicitByTx[txId] ?? 0) + Number(allocation.amount ?? 0);
  }
  const totalBySupplier: Record<string, number> = {};
  for (const payment of data.supplierPayments ?? []) {
    if (payment.voided_at) continue;
    const supplierId = String(payment.supplier_id ?? "");
    if (!supplierId) continue;
    totalBySupplier[supplierId] = (totalBySupplier[supplierId] ?? 0) + Number(payment.amount ?? 0);
  }
  const explicitBySupplier: Record<string, number> = {};
  for (const allocation of data.supplierPaymentAllocations ?? []) {
    if (voidedPaymentIds.has(String(allocation.supplier_payment_id ?? ""))) continue;
    const tx = (data.purchaseTransactions ?? []).find(
      (t) => String(t.id) === String(allocation.purchase_transaction_id ?? "")
    );
    if (!tx) continue;
    const supplierId = String(tx.supplier_id ?? "");
    explicitBySupplier[supplierId] =
      (explicitBySupplier[supplierId] ?? 0) + Number(allocation.amount ?? 0);
  }
  const poolBySupplier: Record<string, number> = {};
  for (const supplier of data.suppliers ?? []) {
    poolBySupplier[String(supplier.id)] = Math.max(
      0,
      (totalBySupplier[String(supplier.id)] ?? 0) -
        (explicitBySupplier[String(supplier.id)] ?? 0)
    );
  }
  const returnedByTx = computeReturnedValueByPurchaseTransaction(
    FIXTURE_PURCHASE_RETURNS,
    FIXTURE_PURCHASE_RETURN_ITEMS
  );
  const totalsByTx: Record<string, number> = {};
  for (const item of data.purchaseItems ?? []) {
    const txId = String(item.purchase_transaction_id);
    totalsByTx[txId] =
      (totalsByTx[txId] ?? 0) +
      Number(item.quantity ?? 0) * Number(item.purchase_price ?? 0);
  }
  return { explicitByTx, poolBySupplier, returnedByTx, totalsByTx };
}

// Capture console.warn calls made inside fn, then restore it.
function captureWarnings(fn: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

const data = buildFixture();

// Purchase returns live outside the MemoryWriterRawData fixture: the
// brain never loads them on main (J1b adds those collections when it
// rebases on top of this slice). The tile engine consumes them, so the
// test passes them to computeReturnedValueByPurchaseTransaction directly.
const FIXTURE_PURCHASE_RETURNS = [
  { id: "pr-a1", purchase_transaction_id: "pt-a1", status: "confirmed" },
  { id: "pr-a2", purchase_transaction_id: "pt-a2", status: "cancelled" },
  { id: "pr-b3", purchase_transaction_id: "pt-b3", status: "confirmed" },
];
const FIXTURE_PURCHASE_RETURN_ITEMS = [
  { purchase_return_id: "pr-a1", quantity: 1, unit_price: 50 },
  { purchase_return_id: "pr-a2", quantity: 1, unit_price: 30 },
  { purchase_return_id: "pr-b3", quantity: 1, unit_price: 100 },
];

// ─── 1. Payment-type normalization ────────────────────────────────────────
check(normalizePurchasePaymentType("credit") === "credit", "normalize: credit stays credit");
check(normalizePurchasePaymentType("CREDIT") === "credit", "normalize: CREDIT lowercases to credit");
check(normalizePurchasePaymentType("cash") === "cash", "normalize: cash stays cash");
check(normalizePurchasePaymentType("Cash") === "cash", "normalize: Cash lowercases to cash");
check(normalizePurchasePaymentType("card") === "card", "normalize: card stays card");
check(normalizePurchasePaymentType("CARD") === "card", "normalize: CARD lowercases to card");
check(normalizePurchasePaymentType(null) === "unknown", "normalize: null is unknown");
check(normalizePurchasePaymentType(undefined) === "unknown", "normalize: undefined is unknown");
check(normalizePurchasePaymentType("") === "unknown", "normalize: empty string is unknown");
check(normalizePurchasePaymentType("bank") === "unknown", "normalize: bank is unknown");
check(normalizePurchasePaymentType("wallet") === "unknown", "normalize: wallet is unknown");
check(isPayablePurchasePaymentType("credit") === true, "payable: explicit credit is payable");
check(isPayablePurchasePaymentType("CREDIT") === true, "payable: CREDIT is payable");
check(isPayablePurchasePaymentType("cash") === false, "payable: cash is not payable");
check(isPayablePurchasePaymentType("card") === false, "payable: card is not payable");
check(isPayablePurchasePaymentType(null) === false, "payable: null is not payable");
check(isPayablePurchasePaymentType("bank") === false, "payable: bank is not payable");
check(isPaidAtEntryPurchasePaymentType("cash") === true, "paid-at-entry: cash is paid at entry");
check(isPaidAtEntryPurchasePaymentType("card") === true, "paid-at-entry: card is paid at entry");
check(isPaidAtEntryPurchasePaymentType(null) === true, "paid-at-entry: null is paid at entry");
check(isPaidAtEntryPurchasePaymentType("credit") === false, "paid-at-entry: credit is not paid at entry");

// ─── 2. Form contract: options + default + validation ────────────────────
check(
  JSON.stringify(PURCHASE_PAYMENT_TYPE_OPTIONS) === JSON.stringify(["cash", "credit"]),
  "form: selector offers exactly cash + credit"
);
check(PURCHASE_PAYMENT_TYPE_DEFAULT === "cash", "form: default payment type is cash");
const line = { product_id: 1, quantity: 2, purchase_price: 100, selling_price: 120 };
const baseInput = {
  supplier_id: "sup-a",
  purchase_date: "2026-11-25",
  lines: [line],
};
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: "cash" }).ok === true,
  "validation: cash purchase is valid"
);
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: "credit" }).ok === true,
  "validation: credit purchase is valid"
);
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: "CREDIT" }).ok === true,
  "validation: CREDIT (case-insensitive) is valid"
);
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: "bank" }).ok === false,
  "validation: bank is rejected (only cash|credit exist)"
);
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: "card" }).ok === false,
  "validation: card is rejected for purchases (only cash|credit exist)"
);
check(
  validatePurchaseTransactionInput({ ...baseInput, payment_type: null }).ok === true,
  "validation: missing payment type is valid (server defaults to cash)"
);

// ─── 3. Engine: credit-only payable ──────────────────────────────────────
const { explicitByTx, poolBySupplier, returnedByTx, totalsByTx } = buildTileInputs(data);
const poolRemaining = { ...poolBySupplier };

function tileNet(txId: string) {
  const tx = (data.purchaseTransactions ?? []).find((t) => String(t.id) === txId)!;
  const net = netPurchaseInvoiceAllocation({
    purchaseTotal: totalsByTx[txId] ?? 0,
    returnedAmount: returnedByTx[txId] ?? 0,
    explicitAllocatedAmount: explicitByTx[txId] ?? 0,
    legacyPoolAvailable: poolRemaining[String(tx.supplier_id)] ?? 0,
    paymentType: tx.payment_type ?? null,
  });
  poolRemaining[String(tx.supplier_id)] = net.legacyPoolRemaining;
  return net;
}

// In purchase-date order, as the tile iterates.
const netA1 = tileNet("pt-a1");
check(netA1.remainingPayableAmount === 450, "engine: credit pt-a1 remaining 450");
check(netA1.paidAmount === 500, "engine: credit pt-a1 paid 500 (400 explicit + 100 pool)");
check(netA1.fallbackAllocatedAmount === 100, "engine: credit pt-a1 fallback 100");
check(netA1.paidAtEntry === false, "engine: credit pt-a1 is not paid at entry");
check(netA1.ignoredAllocatedAmount === 0, "engine: credit pt-a1 ignores nothing");
check(netA1.legacyPoolRemaining === 0, "engine: credit pt-a1 exhausts sup-a pool");

const netA2 = tileNet("pt-a2");
check(netA2.remainingPayableAmount === 500, "engine: credit pt-a2 remaining 500");
check(netA2.paidAmount === 0, "engine: credit pt-a2 paid 0 (cancelled return + voided payment count for nothing)");
check(netA2.returnedAmount === 0, "engine: credit pt-a2 cancelled return offsets nothing");
check(netA2.paidAtEntry === false, "engine: credit pt-a2 is not paid at entry");

const netB1 = tileNet("pt-b1");
check(netB1.remainingPayableAmount === 0, "engine: cash pt-b1 remaining 0");
check(netB1.paidAmount === 200, "engine: cash pt-b1 paid 200 (paid at entry)");
check(netB1.fallbackAllocatedAmount === 0, "engine: cash pt-b1 takes nothing from the pool");
check(netB1.legacyPoolRemaining === 150, "engine: cash pt-b1 leaves the sup-b pool untouched");
check(netB1.paidAtEntry === true, "engine: cash pt-b1 is paid at entry");
check(netB1.ignoredAllocatedAmount === 200, "engine: cash pt-b1 ignores the €200 allocation (anomaly)");

const netB2 = tileNet("pt-b2");
check(netB2.remainingPayableAmount === 0, "engine: cash pt-b2 remaining 0 with no payments");
check(netB2.paidAmount === 300, "engine: cash pt-b2 paid 300 (paid at entry)");
check(netB2.legacyPoolRemaining === 150, "engine: cash pt-b2 still leaves the pool untouched");

const netB3 = tileNet("pt-b3");
check(netB3.remainingPayableAmount === 0, "engine: cash pt-b3 remaining 0");
check(netB3.paidAmount === 0, "engine: cash pt-b3 paid 0 (fully returned, paid at entry nets to 0)");
check(netB3.returnedAmount === 100, "engine: cash pt-b3 returned 100");

const warningsC1: string[] = captureWarnings(() => {
  const netC1 = netPurchaseInvoiceAllocation({
    purchaseTotal: 400,
    returnedAmount: 0,
    explicitAllocatedAmount: 0,
    legacyPoolAvailable: 0,
    paymentType: null,
  });
  check(netC1.remainingPayableAmount === 0, "engine: null-type pt-c1 remaining 0");
  check(netC1.paidAmount === 400, "engine: null-type pt-c1 paid 400");
  check(netC1.paidAtEntry === true, "engine: null-type pt-c1 is paid at entry");
});
check(warningsC1.length === 1, "engine: null payment_type logs exactly one anomaly warning");
check(
  warningsC1[0]?.includes("cash-vs-credit") === true,
  "engine: null-type warning names the cash-vs-credit rule"
);

const warningsBank: string[] = captureWarnings(() => {
  const netBank = netPurchaseInvoiceAllocation({
    purchaseTotal: 100,
    returnedAmount: 0,
    explicitAllocatedAmount: 0,
    legacyPoolAvailable: 0,
    paymentType: "bank",
  });
  check(netBank.remainingPayableAmount === 0, "engine: unknown-type remaining 0");
  check(netBank.paidAtEntry === true, "engine: unknown-type is paid at entry");
});
check(warningsBank.length === 1, "engine: unknown payment_type logs exactly one anomaly warning");

const warningsCard: string[] = captureWarnings(() => {
  const netCard = netPurchaseInvoiceAllocation({
    purchaseTotal: 100,
    returnedAmount: 0,
    explicitAllocatedAmount: 0,
    legacyPoolAvailable: 0,
    paymentType: "CARD",
  });
  check(netCard.remainingPayableAmount === 0, "engine: CARD remaining 0");
  check(netCard.paidAtEntry === true, "engine: CARD is paid at entry");
});
check(warningsCard.length === 0, "engine: CARD is a known immediate type, no anomaly warning");

const netCreditUpper = netPurchaseInvoiceAllocation({
  purchaseTotal: 100,
  returnedAmount: 0,
  explicitAllocatedAmount: 0,
  legacyPoolAvailable: 0,
  paymentType: "CREDIT",
});
check(netCreditUpper.remainingPayableAmount === 100, "engine: CREDIT (uppercase) is payable");
check(netCreditUpper.paidAtEntry === false, "engine: CREDIT is not paid at entry");

const netNoNegative = netPurchaseInvoiceAllocation({
  purchaseTotal: 100,
  returnedAmount: 150,
  explicitAllocatedAmount: 50,
  legacyPoolAvailable: 500,
  paymentType: "credit",
});
check(netNoNegative.remainingPayableAmount === 0, "engine: over-return + over-payment never goes negative");
check(netNoNegative.paidAmount === 50, "engine: over-return case keeps explicit paid 50");

const netPartial = netPurchaseInvoiceAllocation({
  purchaseTotal: 1000,
  returnedAmount: 0,
  explicitAllocatedAmount: 400,
  legacyPoolAvailable: 0,
  paymentType: "credit",
});
check(netPartial.remainingPayableAmount === 600, "engine: partial credit payment leaves 600");
check(netPartial.paidAmount === 400, "engine: partial credit payment paid 400");

// Missing paymentType entirely (old callers): paid at entry + warning.
const warningsMissing: string[] = captureWarnings(() => {
  const netMissing = netPurchaseInvoiceAllocation({
    purchaseTotal: 250,
    returnedAmount: 0,
    explicitAllocatedAmount: 0,
    legacyPoolAvailable: 0,
  });
  check(netMissing.remainingPayableAmount === 0, "engine: omitted paymentType remaining 0");
  check(netMissing.paidAtEntry === true, "engine: omitted paymentType is paid at entry");
});
check(warningsMissing.length === 1, "engine: omitted paymentType logs exactly one anomaly warning");

// Tile total payables = credit remaining only.
const tilePayables =
  netA1.remainingPayableAmount +
  netA2.remainingPayableAmount +
  netB1.remainingPayableAmount +
  netB2.remainingPayableAmount +
  netB3.remainingPayableAmount;
check(tilePayables === 950, "engine: tile payables total is 950 (credit only)");

// ─── 4. Candidates: cash excluded ─────────────────────────────────────────
const payableTxIds = (data.purchaseTransactions ?? [])
  .filter((tx) => isPayablePurchasePaymentType(tx.payment_type ?? null))
  .map((tx) => String(tx.id));
check(
  JSON.stringify(payableTxIds.sort()) === JSON.stringify(["pt-a1", "pt-a2"]),
  "candidates: only credit invoices are payable candidates"
);
check(payableTxIds.includes("pt-b1") === false, "candidates: cash pt-b1 is excluded");
check(payableTxIds.includes("pt-c1") === false, "candidates: null-type pt-c1 is excluded");
check(payableTxIds.includes("pt-c2") === false, "candidates: CARD pt-c2 is excluded");

// ─── 5. Suppliers list: engine result, not the dead column ───────────────
const payablesStats = [
  { supplierId: "sup-a", remainingPayable: 950 },
  { supplierId: "sup-b", remainingPayable: 0 },
  { supplierId: "sup-c", remainingPayable: 0 },
];
const outstandingBySupplier = payableBySupplierId(payablesStats);
check(outstandingBySupplier["sup-a"] === 950, "suppliers list: sup-a outstanding 950 from engine");
check(outstandingBySupplier["sup-b"] === 0, "suppliers list: sup-b outstanding 0 from engine");
check(outstandingBySupplier["sup-c"] === 0, "suppliers list: sup-c outstanding 0 from engine");
check(outstandingBySupplier["sup-unknown"] === undefined, "suppliers list: unknown supplier has no entry");

// ─── 6. Supplier statement: cash purchase is "Paid at entry" ─────────────
check(paidAtEntryCreditForPurchase(netB1) === 200, "statement: cash pt-b1 credits 200 (paid at entry)");
check(paidAtEntryCreditForPurchase(netB2) === 300, "statement: cash pt-b2 credits 300 (paid at entry)");
check(paidAtEntryCreditForPurchase(netB3) === 0, "statement: cash pt-b3 credits 0 (fully returned)");
check(paidAtEntryCreditForPurchase(netA1) === 0, "statement: credit pt-a1 credits 0 (still owed)");
check(paidAtEntryCreditForPurchase(netA2) === 0, "statement: credit pt-a2 credits 0 (still owed)");

// ─── 7. Brain supplier ledger: cash contributes 0 payable ────────────────
const supplierLedger = buildSupplierLedger(data, NOW);
const ledgerA = supplierLedger.byId.get("sup-a")!;
const ledgerB = supplierLedger.byId.get("sup-b")!;
const ledgerC = supplierLedger.byId.get("sup-c")!;
check(ledgerB.payableAmount === 0, "brain ledger: sup-b (all cash) payable 0");
check(ledgerC.payableAmount === 0, "brain ledger: sup-c (null + card) payable 0");
check(ledgerA.payableAmount === 1000, "brain ledger: sup-a payable 1000 (credit FIFO, returns-blind — J1b scope)");
check(supplierLedger.totals.totalPayable === 1000, "brain ledger: total payable 1000 (credit only)");

// ─── 8. Brain cash-out: ignore payments on cash purchases + anomaly ──────
const financialLedger = buildFinancialLedger(data, NOW);
check(financialLedger.cash.cashOut === 1250, "brain cash-out: 1250 (600 cash totals + 650 counted payments)");
check(
  financialLedger.cash.ignoredCashPurchasePayments.count === 1,
  "brain cash-out: 1 anomalous allocation to a cash purchase"
);
check(
  financialLedger.cash.ignoredCashPurchasePayments.amount === 200,
  "brain cash-out: €200 ignored (the pt-b1 allocation)"
);
check(financialLedger.cash.cashIn === 0, "brain cash-out: cash-in 0 (no sales in fixture)");
check(financialLedger.cash.balance === -1250, "brain cash-out: balance −1250");
check(financialLedger.payables.total === 1000, "brain cash-out: payables total still 1000 (credit only)");

console.log(`Cash-vs-credit payables tests passed: ${passed} checks.`);
