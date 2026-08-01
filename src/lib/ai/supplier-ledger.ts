import type { MemoryWriterRawData } from "../brain/contracts/memory";

/**
 * Supplier ledger — derived financial view over the raw business data.
 *
 * Computes per-supplier purchase totals, history, payments, payable balances
 * (FIFO allocation over credit purchase invoices, mirroring the customer
 * ledger architecture) and credit-intelligence flags. Purchase transactions
 * carry no explicit due date, so the due date is derived as purchase date +
 * the supplier's credit days (defaulting to 30 when the supplier has no
 * credit terms). Everything is derived directly from the raw transactions,
 * so balances are authoritative.
 */

export interface SupplierInvoiceItem {
  productId: string;
  productName: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  total: number;
}

export interface SupplierInvoice {
  transactionId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  paymentType: string | null;
  creditDueDate: string | null;
  items: SupplierInvoiceItem[];
}

export interface SupplierPaymentRecord {
  paymentId: string;
  date: string;
  amount: number;
}

export interface SupplierLedgerEntry {
  supplierId: string;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  notes: string | null;
  creditLimit: number | null;
  creditDays: number | null;
  createdAt: string | null;
  totalPurchases: number;
  totalProfit: number;
  invoiceCount: number;
  averageOrderValue: number;
  lastPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  lastInvoice: SupplierInvoice | null;
  frequency30d: number;
  payableAmount: number;
  paidAmount: number;
  overdueAmount: number;
  overdueInvoiceCount: number;
  overdueDays: number | null;
  creditUtilizationPct: number | null;
  creditDaysRemaining: number | null;
  isNearCreditLimit: boolean;
  isOverCreditLimit: boolean;
  isBlocked: boolean;
  invoices: SupplierInvoice[];
  payments: SupplierPaymentRecord[];
}

export interface SupplierLedger {
  suppliers: SupplierLedgerEntry[];
  byId: Map<string, SupplierLedgerEntry>;
  totals: {
    totalPurchases: number;
    totalProfit: number;
    totalPayable: number;
    totalOverdue: number;
    totalInvoices: number;
    suppliersOwing: number;
  };
}

const DEFAULT_CREDIT_DAYS = 30;

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

function addDays(value: string, days: number): string {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function buildSupplierLedger(data: MemoryWriterRawData, now: Date = new Date()): SupplierLedger {
  const productNames = new Map<string, string>();
  for (const product of data.products ?? []) {
    productNames.set(String(product.id), product.name);
  }

  const itemsByTransaction = new Map<string, SupplierInvoiceItem[]>();
  for (const item of data.purchaseItems ?? []) {
    const key = String(item.purchase_transaction_id);
    const list = itemsByTransaction.get(key) ?? [];
    list.push({
      productId: String(item.product_id),
      productName: productNames.get(String(item.product_id)) ?? `Product ${item.product_id}`,
      quantity: toNumber(item.quantity),
      purchasePrice: toNumber(item.purchase_price),
      sellingPrice: toNumber(item.selling_price),
      total: toNumber(item.quantity) * toNumber(item.purchase_price),
    });
    itemsByTransaction.set(key, list);
  }

  const transactionsBySupplier = new Map<string, SupplierInvoice[]>();
  for (const tx of data.purchaseTransactions ?? []) {
    const supplierId = String(tx.supplier_id ?? "");
    if (!supplierId) continue;
    const items = itemsByTransaction.get(String(tx.id)) ?? [];
    const invoice: SupplierInvoice = {
      transactionId: String(tx.id),
      invoiceNumber: String(tx.invoice_number ?? ""),
      date: String(tx.purchase_date ?? tx.created_at ?? ""),
      amount: items.reduce((sum, item) => sum + item.total, 0),
      paymentType: tx.payment_type ?? null,
      creditDueDate: null,
      items,
    };
    const list = transactionsBySupplier.get(supplierId) ?? [];
    list.push(invoice);
    transactionsBySupplier.set(supplierId, list);
  }

  const paymentsBySupplier = new Map<string, SupplierPaymentRecord[]>();
  for (const payment of data.supplierPayments ?? []) {
    const supplierId = String(payment.supplier_id ?? "");
    if (!supplierId) continue;
    const list = paymentsBySupplier.get(supplierId) ?? [];
    list.push({
      paymentId: String(payment.id ?? ""),
      date: String(payment.payment_date ?? payment.created_at ?? ""),
      amount: toNumber(payment.amount),
    });
    paymentsBySupplier.set(supplierId, list);
  }

  const suppliers: SupplierLedgerEntry[] = [];
  const byId = new Map<string, SupplierLedgerEntry>();

  for (const raw of data.suppliers ?? []) {
    const supplierId = String(raw.id ?? "");
    if (!supplierId) continue;
    const invoices = (transactionsBySupplier.get(supplierId) ?? []).sort((a, b) =>
      (dateOnly(a.date) ?? "").localeCompare(dateOnly(b.date) ?? "")
    );

    const totalPurchases = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const totalProfit = invoices.reduce(
      (sum, inv) =>
        sum +
        inv.items.reduce(
          (itemSum, item) =>
            itemSum + item.quantity * Math.max(0, item.sellingPrice - item.purchasePrice),
          0
        ),
      0
    );
    const invoiceCount = invoices.length;
    const averageOrderValue = invoiceCount > 0 ? totalPurchases / invoiceCount : 0;
    const lastInvoice = invoiceCount > 0 ? invoices[invoiceCount - 1] : null;
    const lastPurchaseDate = lastInvoice?.date ?? null;
    const daysSinceLastPurchase = lastPurchaseDate ? daysBetween(lastPurchaseDate, now) : null;
    const frequency30d = invoices.filter((inv) => {
      const d = daysBetween(inv.date, now);
      return d >= 0 && d <= 30;
    }).length;

    const creditLimit = raw.credit_limit != null ? toNumber(raw.credit_limit) : null;
    const creditDays = raw.credit_days != null ? toNumber(raw.credit_days) : null;
    const allowOverLimit = Boolean(raw.allow_over_limit);
    const allowOverdueSales = Boolean(raw.allow_overdue_sales);

    // FIFO credit allocation over credit purchase invoices (mirrors the
    // customer ledger architecture; due date = purchase date + credit days).
    const creditInvoices = invoices.filter((inv) => inv.paymentType === "credit");
    const payments = paymentsBySupplier.get(supplierId) ?? [];
    let pool = payments.reduce((sum, payment) => sum + payment.amount, 0);
    let paidAmount = pool;
    let payableAmount = 0;
    let overdueAmount = 0;
    let overdueInvoiceCount = 0;
    let lastCreditPurchaseDate: string | null = null;
    let latestDueDate: string | null = null;

    for (const inv of creditInvoices) {
      const allocated = Math.min(pool, inv.amount);
      pool = Math.max(0, pool - allocated);
      const remaining = Math.max(0, inv.amount - allocated);
      payableAmount += remaining;
      const dueDate = addDays(inv.date || now.toISOString(), creditDays ?? DEFAULT_CREDIT_DAYS);
      inv.creditDueDate = dueDate;
      const dueDay = dateOnly(dueDate);
      const today = dateOnly(now.toISOString());
      if (dueDay && today && dueDay < today && remaining > 0) {
        overdueAmount += remaining;
        overdueInvoiceCount += 1;
        if (!latestDueDate || dueDay > latestDueDate) latestDueDate = dueDay;
      }
      if (inv.date && (!lastCreditPurchaseDate || inv.date > lastCreditPurchaseDate)) {
        lastCreditPurchaseDate = inv.date;
      }
    }

    const overdueDays =
      latestDueDate && overdueAmount > 0 ? Math.max(0, daysBetween(latestDueDate, now)) : null;
    const creditUtilizationPct = creditLimit !== null && creditLimit > 0 ? (payableAmount / creditLimit) * 100 : null;
    const creditDaysRemaining =
      creditDays !== null && lastCreditPurchaseDate
        ? creditDays - daysBetween(lastCreditPurchaseDate, now)
        : null;
    const isOverCreditLimit = creditUtilizationPct !== null && creditUtilizationPct > 100;
    const isNearCreditLimit = creditUtilizationPct !== null && creditUtilizationPct >= 80;
    const isBlocked =
      (overdueAmount > 0 && !allowOverdueSales) || (isOverCreditLimit && !allowOverLimit);

    const entry: SupplierLedgerEntry = {
      supplierId,
      supplierName: String(raw.supplier_name ?? ""),
      contactPerson: raw.contact_person ?? null,
      phone: raw.phone ?? null,
      city: raw.city ?? null,
      area: raw.area ?? null,
      notes: raw.notes ?? null,
      creditLimit,
      creditDays,
      createdAt: raw.created_at ?? null,
      totalPurchases,
      totalProfit,
      invoiceCount,
      averageOrderValue,
      lastPurchaseDate,
      daysSinceLastPurchase,
      lastInvoice,
      frequency30d,
      payableAmount,
      paidAmount,
      overdueAmount,
      overdueInvoiceCount,
      overdueDays,
      creditUtilizationPct,
      creditDaysRemaining,
      isNearCreditLimit,
      isOverCreditLimit,
      isBlocked,
      invoices,
      payments,
    };
    suppliers.push(entry);
    byId.set(supplierId, entry);
  }

  const totals = suppliers.reduce(
    (acc, entry) => {
      acc.totalPurchases += entry.totalPurchases;
      acc.totalProfit += entry.totalProfit;
      acc.totalPayable += entry.payableAmount;
      acc.totalOverdue += entry.overdueAmount;
      acc.totalInvoices += entry.invoiceCount;
      if (entry.payableAmount > 0) acc.suppliersOwing += 1;
      return acc;
    },
    { totalPurchases: 0, totalProfit: 0, totalPayable: 0, totalOverdue: 0, totalInvoices: 0, suppliersOwing: 0 }
  );

  return { suppliers, byId, totals };
}
