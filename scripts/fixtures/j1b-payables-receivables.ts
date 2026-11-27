import type { MemoryWriterRawData } from "../../src/lib/brain/contracts/memory";

export function buildPayablesReceivablesFixture(): MemoryWriterRawData {
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

export function buildMixedCashRuleFixture(): MemoryWriterRawData {
  return {
    ...buildPayablesReceivablesFixture(),
    suppliers: [{ id: "sup-d", supplier_name: "Supplier D", credit_days: 30 }],
    purchaseTransactions: [
      {
        id: "pt-d1",
        supplier_id: "sup-d",
        invoice_number: "INV-D1",
        created_at: "2026-11-05T10:00:00.000Z",
        purchase_date: "2026-11-05",
        payment_type: "cash",
      },
      {
        id: "pt-d2",
        supplier_id: "sup-d",
        invoice_number: "INV-D2",
        created_at: "2026-11-10T10:00:00.000Z",
        purchase_date: "2026-11-10",
        payment_type: "credit",
      },
    ],
    purchaseItems: [
      {
        id: "pi-d1",
        purchase_transaction_id: "pt-d1",
        product_id: 1,
        quantity: 3,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-05T10:00:00.000Z",
      },
      {
        id: "pi-d2",
        purchase_transaction_id: "pt-d2",
        product_id: 1,
        quantity: 4,
        purchase_price: 100,
        selling_price: 120,
        created_at: "2026-11-10T10:00:00.000Z",
      },
    ],
    supplierPayments: [
      {
        id: "sp-d1",
        supplier_id: "sup-d",
        amount: 300,
        payment_date: "2026-11-06",
        voided_at: null,
        created_at: "2026-11-06T10:00:00.000Z",
      },
      {
        id: "sp-d2",
        supplier_id: "sup-d",
        amount: 500,
        payment_date: "2026-11-08",
        voided_at: "2026-11-12T09:00:00.000Z",
        created_at: "2026-11-08T10:00:00.000Z",
      },
    ],
    purchaseReturns: [
      { id: "pr-d1", purchase_transaction_id: "pt-d1", status: "confirmed" },
      { id: "pr-d2", purchase_transaction_id: "pt-d1", status: "cancelled" },
    ],
    purchaseReturnItems: [
      { id: "pri-d1", purchase_return_id: "pr-d1", quantity: 1, unit_price: 50 },
      { id: "pri-d2", purchase_return_id: "pr-d2", quantity: 1, unit_price: 30 },
    ],
    supplierPaymentAllocations: [
      { id: "spa-d1", supplier_payment_id: "sp-d1", purchase_transaction_id: "pt-d1", amount: 100 },
      { id: "spa-d2", supplier_payment_id: "sp-d1", purchase_transaction_id: "pt-d2", amount: 150 },
      { id: "spa-d3", supplier_payment_id: "sp-d2", purchase_transaction_id: "pt-d1", amount: 500 },
    ],
  } as MemoryWriterRawData;
}
