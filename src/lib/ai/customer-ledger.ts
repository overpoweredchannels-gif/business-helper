import type { MemoryWriterRawData } from "../brain/contracts/memory";

/**
 * Customer ledger — derived financial view over the raw business data.
 *
 * Computes per-customer sales totals, history, payments, outstanding balances
 * (FIFO allocation over credit invoices, mirroring the app's authoritative
 * creditAllocationByTransaction logic) and credit-intelligence flags. It does
 * NOT use the Brain's derived CustomerMemory analytics fields (which are not
 * computed by the memory writer); it derives everything directly from the raw
 * transactions, so balances are authoritative.
 */

export interface CustomerInvoiceItem {
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  purchasePrice: number | null;
  total: number;
}

export interface CustomerInvoice {
  transactionId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  paymentType: string | null;
  creditDueDate: string | null;
  items: CustomerInvoiceItem[];
}

export interface CustomerLedgerEntry {
  customerId: string;
  customerName: string;
  shopName: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  customerType: string | null;
  creditPolicy: string | null;
  creditLimit: number | null;
  creditDays: number | null;
  allowOverLimit: boolean;
  allowOverdueSales: boolean;
  createdAt: string | null;
  totalSales: number;
  totalProfit: number;
  invoiceCount: number;
  averageOrderValue: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  lastInvoice: CustomerInvoice | null;
  frequency30d: number;
  outstandingBalance: number;
  overdueAmount: number;
  overdueInvoiceCount: number;
  overdueDays: number | null;
  creditUtilizationPct: number | null;
  creditDaysRemaining: number | null;
  isNearCreditLimit: boolean;
  isOverCreditLimit: boolean;
  isBlocked: boolean;
  invoices: CustomerInvoice[];
}

export interface CustomerLedger {
  customers: CustomerLedgerEntry[];
  byId: Map<string, CustomerLedgerEntry>;
  totals: {
    totalSales: number;
    totalProfit: number;
    totalOutstanding: number;
    totalOverdue: number;
    totalInvoices: number;
    customersOwing: number;
  };
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, now: Date): number {
  const fromDay = dateOnly(from);
  if (!fromDay) return 0;
  const a = new Date(fromDay).getTime();
  const b = new Date(dateOnly(now.toISOString())!).getTime();
  return Math.floor((b - a) / 86400000);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildCustomerLedger(data: MemoryWriterRawData, now: Date = new Date()): CustomerLedger {
  const productNames = new Map<string, string>();
  for (const product of data.products ?? []) {
    productNames.set(String(product.id), product.name);
  }

  const itemsByTransaction = new Map<string, CustomerInvoiceItem[]>();
  for (const item of data.salesItems ?? []) {
    const key = String(item.sales_transaction_id);
    const list = itemsByTransaction.get(key) ?? [];
    list.push({
      productId: String(item.product_id),
      productName: productNames.get(String(item.product_id)) ?? `Product ${item.product_id}`,
      quantity: toNumber(item.quantity),
      sellingPrice: toNumber(item.selling_price),
      purchasePrice: item.purchase_price_snapshot != null ? toNumber(item.purchase_price_snapshot) : null,
      total: toNumber(item.quantity) * toNumber(item.selling_price),
    });
    itemsByTransaction.set(key, list);
  }

  const transactionsByCustomer = new Map<string, CustomerInvoice[]>();
  for (const tx of data.salesTransactions ?? []) {
    const customerId = String(tx.customer_id ?? "");
    if (!customerId) continue;
    const items = itemsByTransaction.get(String(tx.id)) ?? [];
    const invoice: CustomerInvoice = {
      transactionId: String(tx.id),
      invoiceNumber: String(tx.invoice_number ?? ""),
      date: String(tx.sale_date ?? tx.created_at ?? ""),
      amount: items.reduce((sum, item) => sum + item.total, 0),
      paymentType: tx.payment_type ?? null,
      creditDueDate: tx.credit_due_date ?? null,
      items,
    };
    const list = transactionsByCustomer.get(customerId) ?? [];
    list.push(invoice);
    transactionsByCustomer.set(customerId, list);
  }

  const paymentsByCustomer = new Map<string, number>();
  for (const payment of data.customerPayments ?? []) {
    const customerId = String(payment.customer_id ?? "");
    if (!customerId) continue;
    paymentsByCustomer.set(customerId, (paymentsByCustomer.get(customerId) ?? 0) + toNumber(payment.amount));
  }

  const customers: CustomerLedgerEntry[] = [];
  const byId = new Map<string, CustomerLedgerEntry>();

  for (const raw of data.customers ?? []) {
    const customerId = String(raw.id ?? "");
    if (!customerId) continue;
    const invoices = (transactionsByCustomer.get(customerId) ?? []).sort((a, b) =>
      (dateOnly(a.date) ?? "").localeCompare(dateOnly(b.date) ?? "")
    );

    const totalSales = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const totalProfit = invoices.reduce(
      (sum, inv) =>
        sum +
        inv.items.reduce(
          (itemSum, item) =>
            itemSum + item.quantity * Math.max(0, item.sellingPrice - (item.purchasePrice ?? 0)),
          0
        ),
      0
    );
    const invoiceCount = invoices.length;
    const averageOrderValue = invoiceCount > 0 ? totalSales / invoiceCount : 0;
    const lastInvoice = invoiceCount > 0 ? invoices[invoiceCount - 1] : null;
    const lastSaleDate = lastInvoice?.date ?? null;
    const daysSinceLastSale = lastSaleDate ? daysBetween(lastSaleDate, now) : null;
    const frequency30d = invoices.filter((inv) => {
      const d = daysBetween(inv.date, now);
      return d >= 0 && d <= 30;
    }).length;

    const creditLimit = raw.credit_limit != null ? toNumber(raw.credit_limit) : null;
    const creditDays = raw.credit_days != null ? toNumber(raw.credit_days) : null;
    const allowOverLimit = Boolean(raw.allow_over_limit);
    const allowOverdueSales = Boolean(raw.allow_overdue_sales);

    // FIFO credit allocation (mirrors the app's creditAllocationByTransaction).
    const creditInvoices = invoices.filter((inv) => inv.paymentType === "credit");
    let pool = paymentsByCustomer.get(customerId) ?? 0;
    let outstandingBalance = 0;
    let overdueAmount = 0;
    let overdueInvoiceCount = 0;
    let lastCreditSaleDate: string | null = null;
    let latestDueDate: string | null = null;

    for (const inv of creditInvoices) {
      const allocated = Math.min(pool, inv.amount);
      pool = Math.max(0, pool - allocated);
      const remaining = Math.max(0, inv.amount - allocated);
      outstandingBalance += remaining;
      if (inv.creditDueDate) {
        const dueDay = dateOnly(inv.creditDueDate);
        const today = dateOnly(now.toISOString());
        if (dueDay && today && dueDay < today && remaining > 0) {
          overdueAmount += remaining;
          overdueInvoiceCount += 1;
          if (!latestDueDate || dueDay > latestDueDate) latestDueDate = dueDay;
        }
      }
      if (inv.date && (!lastCreditSaleDate || inv.date > lastCreditSaleDate)) {
        lastCreditSaleDate = inv.date;
      }
    }

    const overdueDays =
      latestDueDate && overdueAmount > 0 ? Math.max(0, daysBetween(latestDueDate, now)) : null;
    const creditUtilizationPct = creditLimit !== null && creditLimit > 0 ? (outstandingBalance / creditLimit) * 100 : null;
    const creditDaysRemaining =
      creditDays !== null && lastCreditSaleDate ? creditDays - daysBetween(lastCreditSaleDate, now) : null;
    const isOverCreditLimit = creditUtilizationPct !== null && creditUtilizationPct > 100;
    const isNearCreditLimit = creditUtilizationPct !== null && creditUtilizationPct >= 80;
    const isBlocked =
      (overdueAmount > 0 && !allowOverdueSales) || (isOverCreditLimit && !allowOverLimit);

    const entry: CustomerLedgerEntry = {
      customerId,
      customerName: String(raw.customer_name ?? ""),
      shopName: raw.shop_name ?? null,
      phone: raw.phone ?? null,
      city: raw.city ?? null,
      area: raw.area ?? null,
      customerType: raw.customer_type ?? null,
      creditPolicy: raw.credit_policy ?? null,
      creditLimit,
      creditDays,
      allowOverLimit,
      allowOverdueSales,
      createdAt: raw.created_at ?? null,
      totalSales,
      totalProfit,
      invoiceCount,
      averageOrderValue,
      lastSaleDate,
      daysSinceLastSale,
      lastInvoice,
      frequency30d,
      outstandingBalance,
      overdueAmount,
      overdueInvoiceCount,
      overdueDays,
      creditUtilizationPct,
      creditDaysRemaining,
      isNearCreditLimit,
      isOverCreditLimit,
      isBlocked,
      invoices,
    };
    customers.push(entry);
    byId.set(customerId, entry);
  }

  const totals = customers.reduce(
    (acc, entry) => {
      acc.totalSales += entry.totalSales;
      acc.totalProfit += entry.totalProfit;
      acc.totalOutstanding += entry.outstandingBalance;
      acc.totalOverdue += entry.overdueAmount;
      acc.totalInvoices += entry.invoiceCount;
      if (entry.outstandingBalance > 0) acc.customersOwing += 1;
      return acc;
    },
    { totalSales: 0, totalProfit: 0, totalOutstanding: 0, totalOverdue: 0, totalInvoices: 0, customersOwing: 0 }
  );

  return { customers, byId, totals };
}
