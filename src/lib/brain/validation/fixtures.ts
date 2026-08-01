import type { MemoryWriterRawData } from "../contracts/memory";

let _counter = 0;
function nextId(): string { return `test_${++_counter}`; }
function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export function createMockRawData(
  productCount: number = 5,
  customerCount: number = 3,
  supplierCount: number = 2,
  transactionCount: number = 10
): MemoryWriterRawData {
  const orgId = nextId();
  const products = Array.from({ length: productCount }, (_, i) => ({
    id: i + 1,
    name: `Test Product ${i + 1}`,
    brand_id: null,
    category_id: null,
    unit_type: "piece" as const,
    last_purchase_price: 50 + i * 10,
    default_selling_price: 100 + i * 20,
    minimum_stock_level: 5,
    reorder_level: 10,
    track_batch: false,
    track_expiry: false,
    is_active: true as const,
    created_at: pastDate(60),
    updated_at: pastDate(1),
  }));

  const customers = Array.from({ length: customerCount }, (_, i) => ({
    id: nextId(),
    customer_name: `Test Customer ${i + 1}`,
    shop_name: `Shop ${i + 1}`,
    phone: `0300${String(1000000 + i).slice(0, 7)}`,
    city: "Lahore",
    area: "Gulberg",
    customer_type: "Retailer" as const,
    credit_policy: "cash_only" as const,
    credit_limit: 50000,
    credit_days: null,
    allow_over_limit: false,
    allow_overdue_sales: false,
    preferred_payment_method: "cash" as const,
    created_at: pastDate(90),
    updated_at: pastDate(5),
  }));

  const suppliers = Array.from({ length: supplierCount }, (_, i) => ({
    id: nextId(),
    supplier_name: `Test Supplier ${i + 1}`,
    contact_person: `Contact ${i + 1}`,
    phone: `0301${String(2000000 + i).slice(0, 7)}`,
    notes: null,
    created_at: pastDate(120),
    updated_at: pastDate(10),
  }));

  const staff = [
    {
      id: nextId(),
      display_name: "Owner User",
      role: "owner" as const,
      phone: null,
      is_active: true,
      created_at: pastDate(180),
      updated_at: pastDate(1),
    },
  ];

  const salesTransactions = Array.from({ length: transactionCount }, (_, i) => ({
    id: nextId(),
    customer_id: customers[i % customers.length].id,
    invoice_number: `INV-${1000 + i}`,
    created_at: pastDate(i * 2),
    sale_date: pastDate(i * 2),
    payment_type: i % 3 === 0 ? ("credit" as const) : ("cash" as const),
    credit_due_date: i % 3 === 0 ? pastDate(i * 2 - 15) : null,
  }));

  const salesItems: MemoryWriterRawData["salesItems"] = [];
  for (let i = 0; i < transactionCount; i++) {
    const productIdx = i % productCount;
    const qty = Math.floor(Math.random() * 10) + 1;
    salesItems.push({
      id: nextId(),
      sales_transaction_id: salesTransactions[i].id,
      product_id: productIdx + 1,
      quantity: qty,
      selling_price: products[productIdx]?.default_selling_price ?? 100,
      purchase_price_snapshot: products[productIdx]?.last_purchase_price ?? 50,
      created_at: pastDate(i * 2),
    });
  }

  const purchaseTransactions = Array.from({ length: Math.max(1, Math.floor(transactionCount / 3)) }, (_, i) => ({
    id: nextId(),
    supplier_id: suppliers[i % suppliers.length].id,
    invoice_number: `PO-${2000 + i}`,
    created_at: pastDate(i * 5),
    purchase_date: pastDate(i * 5),
    payment_type: "cash" as const,
  }));

  const purchaseItems: MemoryWriterRawData["purchaseItems"] = [];
  for (let i = 0; i < purchaseTransactions.length; i++) {
    const productIdx = i % productCount;
    purchaseItems.push({
      id: nextId(),
      purchase_transaction_id: purchaseTransactions[i].id,
      product_id: productIdx + 1,
      quantity: Math.floor(Math.random() * 20) + 5,
      purchase_price: products[productIdx]?.last_purchase_price ?? 50,
      selling_price: products[productIdx]?.default_selling_price ?? 100,
      created_at: pastDate(i * 5),
    });
  }

  const expenses: MemoryWriterRawData["expenses"] = [
    { id: nextId(), expense_type: "Electricity", amount: 15000, created_at: pastDate(2) },
    { id: nextId(), expense_type: "Rent", amount: 45000, created_at: pastDate(5) },
    { id: nextId(), expense_type: "Salary", amount: 60000, created_at: pastDate(1) },
    { id: nextId(), expense_type: "Transport", amount: 5000, created_at: pastDate(3) },
    { id: nextId(), expense_type: "Electricity", amount: 12000, created_at: pastDate(15) },
    { id: nextId(), expense_type: "Other", amount: 3000, created_at: pastDate(25) },
  ];

  const customerPayments: MemoryWriterRawData["customerPayments"] = customers.map((c) => ({
    id: nextId(),
    customer_id: c.id,
    amount: Math.floor(Math.random() * 50000) + 5000,
    created_at: pastDate(Math.floor(Math.random() * 20)),
  }));

  const supplierPayments: MemoryWriterRawData["supplierPayments"] = suppliers.map((s) => ({
    id: nextId(),
    supplier_id: s.id,
    amount: Math.floor(Math.random() * 100000),
    created_at: pastDate(Math.floor(Math.random() * 15)),
  }));

  const tasks: MemoryWriterRawData["tasks"] = [
    { id: nextId(), title: "Follow up with customer", task_type: "follow_up", priority: "high", status: "pending", due_date: pastDate(-3), created_at: pastDate(5), completed_at: null },
    { id: nextId(), title: "Reorder stock", task_type: "purchase", priority: "medium", status: "pending", due_date: null, created_at: pastDate(3), completed_at: null },
    { id: nextId(), title: "Check expenses", task_type: "review", priority: "low", status: "completed", due_date: null, created_at: pastDate(10), completed_at: pastDate(2) },
  ];

  const alerts: MemoryWriterRawData["alerts"] = [
    { id: nextId(), alert_type: "low_stock", title: "Product X is low in stock", severity: "high", status: "active", created_at: pastDate(1) },
    { id: nextId(), alert_type: "overdue_payment", title: "Customer payment overdue", severity: "medium", status: "active", created_at: pastDate(3) },
  ];

  return {
    organizationId: orgId,
    organizationName: "Test Business",
    ownerName: "Test Owner",
    timezone: "Asia/Karachi",
    products,
    customers,
    suppliers,
    staff,
    salesTransactions,
    salesItems,
    purchaseTransactions,
    purchaseItems,
    expenses,
    customerPayments,
    supplierPayments,
    tasks,
    alerts,
  };
}
