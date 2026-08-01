import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { buildCustomerLedger } from "./customer-ledger";
import { buildSupplierLedger } from "./supplier-ledger";

/**
 * Financial ledger — a derived, authoritative financial view over the raw
 * business data (the same architecture as the customer and supplier ledgers).
 *
 * Everything here is computed from the raw transactions, never from the
 * Business Brain's in-memory summaries, so the numbers are independently
 * verifiable. The Brain layers themselves are not touched.
 *
 * Semantics documented up front:
 * - Cash balance = cash sales revenue + customer payments - cash purchases
 *   - supplier payments - expenses. The data contract has no opening bank
 *   balance, so "bank balance" is reported as not tracked.
 * - Gross profit per sale item = (selling price - cost) * quantity, where cost
 *   is the purchase_price_snapshot, falling back to the product's last
 *   purchase price when no snapshot was recorded.
 * - Net profit = gross profit - expenses (period-matched).
 * - Inventory value = units on hand * unit cost, where units on hand =
 *   total purchased - total sold (clamped at zero) and unit cost is the most
 *   recent purchase price recorded for the product.
 * - Receivables/payables reuse the customer and supplier ledgers (already
 *   proven in the earlier missions).
 */

export type FinancialPeriod = "today" | "thisWeek" | "thisMonth" | "lastMonth" | "last30Days" | "allTime";

export interface FinancialPeriodSummary {
  revenue: number;
  cashRevenue: number;
  creditRevenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  invoiceCount: number;
  itemsSold: number;
}

export interface FinancialRankItem {
  key: string;
  name: string;
  revenue: number;
  profit: number;
  quantity: number;
  marginPct: number | null;
}

export interface FinancialLedger {
  generatedAt: string;
  cash: {
    balance: number;
    cashIn: number;
    cashOut: number;
    bankTracked: boolean;
    bankBalance: number | null;
  };
  receivables: { total: number; overdue: number; count: number };
  payables: { total: number; overdue: number; count: number };
  periods: Record<FinancialPeriod, FinancialPeriodSummary>;
  inventory: { value: number; units: number; productCount: number; costPerUnit: Map<string, number> };
  byCategory: Record<string, FinancialRankItem>;
  byBrand: Record<string, FinancialRankItem>;
  byProduct: FinancialRankItem[];
  topProducts: FinancialRankItem[];
}

const PERIODS: FinancialPeriod[] = ["today", "thisWeek", "thisMonth", "lastMonth", "last30Days", "allTime"];

function isInPeriod(dateStr: string, period: FinancialPeriod, now: Date): boolean {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const todayStr = now.toISOString().split("T")[0];
  const dateOnly = d.toISOString().split("T")[0];
  switch (period) {
    case "today":
      return dateOnly === todayStr;
    case "thisWeek": {
      const sw = new Date(now);
      sw.setDate(now.getDate() - now.getDay());
      return d >= sw;
    }
    case "thisMonth":
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    case "lastMonth": {
      const lm = new Date(now);
      lm.setMonth(lm.getMonth() - 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    case "last30Days": {
      const td = new Date(now);
      td.setDate(td.getDate() - 30);
      return d >= td;
    }
    case "allTime":
      return true;
    default:
      return false;
  }
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOf(value: string | null | undefined, fallback: string): string {
  return value ? String(value) : fallback;
}

function emptyPeriod(): FinancialPeriodSummary {
  return {
    revenue: 0,
    cashRevenue: 0,
    creditRevenue: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    invoiceCount: 0,
    itemsSold: 0,
  };
}

function sortRanks(ranks: FinancialRankItem[]): FinancialRankItem[] {
  return ranks.slice().sort((a, b) => b.revenue - a.revenue);
}

export function buildFinancialLedger(data: MemoryWriterRawData, now: Date = new Date()): FinancialLedger {
  const products = data.products ?? [];
  const salesTransactions = data.salesTransactions ?? [];
  const salesItems = data.salesItems ?? [];
  const purchaseTransactions = data.purchaseTransactions ?? [];
  const purchaseItems = data.purchaseItems ?? [];
  const expenses = data.expenses ?? [];
  const customerPayments = data.customerPayments ?? [];
  const supplierPayments = data.supplierPayments ?? [];

  const productInfo = new Map<string, { name: string; category: string | null; brand: string | null }>();
  for (const p of products) {
    productInfo.set(String(p.id), {
      name: String(p.name ?? "Unknown product"),
      category: p.category_name ? String(p.category_name) : p.category_id != null ? `Category ${p.category_id}` : null,
      brand: p.brand_name ? String(p.brand_name) : p.brand_id != null ? `Brand ${p.brand_id}` : null,
    });
  }

  const saleItemsByTx = new Map<string, Array<{ productId: string; quantity: number; sellingPrice: number; cost: number }>>();
  for (const item of salesItems) {
    const txId = String(item.sales_transaction_id);
    const list = saleItemsByTx.get(txId) ?? [];
    const productId = String(item.product_id);
    const cost =
      toNumber(item.purchase_price_snapshot) ||
      toNumber(products.find((p) => String(p.id) === productId)?.last_purchase_price) ||
      0;
    list.push({ productId, quantity: toNumber(item.quantity), sellingPrice: toNumber(item.selling_price), cost });
    saleItemsByTx.set(txId, list);
  }

  const periods: Record<FinancialPeriod, FinancialPeriodSummary> = {
    today: emptyPeriod(),
    thisWeek: emptyPeriod(),
    thisMonth: emptyPeriod(),
    lastMonth: emptyPeriod(),
    last30Days: emptyPeriod(),
    allTime: emptyPeriod(),
  };

  const byCategory: Record<string, FinancialRankItem> = {};
  const byBrand: Record<string, FinancialRankItem> = {};
  const byProduct: Record<string, FinancialRankItem> = {};

  const upsertRank = (map: Record<string, FinancialRankItem>, key: string, name: string): FinancialRankItem => {
    let entry = map[key];
    if (!entry) {
      entry = { key, name, revenue: 0, profit: 0, quantity: 0, marginPct: null };
      map[key] = entry;
    }
    return entry;
  };

  let cashIn = 0;
  let cashOut = 0;

  for (const tx of salesTransactions) {
    const items = saleItemsByTx.get(String(tx.id)) ?? [];
    const isCash = String(tx.payment_type ?? "").toLowerCase() === "cash";
    const dateStr = dateOf(tx.sale_date, tx.created_at);
    const totals = items.reduce(
      (acc, it) => {
        acc.revenue += it.sellingPrice * it.quantity;
        acc.profit += (it.sellingPrice - it.cost) * it.quantity;
        acc.qty += it.quantity;
        return acc;
      },
      { revenue: 0, profit: 0, qty: 0 }
    );
    for (const p of PERIODS) {
      if (!isInPeriod(dateStr, p, now)) continue;
      const pd = periods[p];
      pd.revenue += totals.revenue;
      pd.grossProfit += totals.profit;
      pd.invoiceCount += 1;
      pd.itemsSold += totals.qty;
      if (isCash) pd.cashRevenue += totals.revenue;
      else pd.creditRevenue += totals.revenue;
    }
    if (isCash) cashIn += totals.revenue;

    for (const it of items) {
      const info = productInfo.get(it.productId);
      const revenue = it.sellingPrice * it.quantity;
      const profit = (it.sellingPrice - it.cost) * it.quantity;
      if (info?.category) {
        const e = upsertRank(byCategory, info.category, info.category);
        e.revenue += revenue;
        e.profit += profit;
        e.quantity += it.quantity;
      }
      if (info?.brand) {
        const e = upsertRank(byBrand, info.brand, info.brand);
        e.revenue += revenue;
        e.profit += profit;
        e.quantity += it.quantity;
      }
      const pe = upsertRank(byProduct, it.productId, info?.name ?? `Product ${it.productId}`);
      pe.revenue += revenue;
      pe.profit += profit;
      pe.quantity += it.quantity;
    }
  }

  for (const p of PERIODS) {
    periods[p].netProfit = periods[p].grossProfit - periods[p].expenses;
  }

  const purchaseCosts = new Map<string, number>();
  const purchaseDates = new Map<string, string>();
  for (const item of purchaseItems) {
    const productId = String(item.product_id);
    const price = toNumber(item.purchase_price);
    const dateStr = dateOf(item.created_at, "");
    if (price > 0) {
      const prev = purchaseDates.get(productId) ?? "";
      if (dateStr >= prev) {
        purchaseCosts.set(productId, price);
        purchaseDates.set(productId, dateStr);
      }
    }
  }

  const unitsOnHand = new Map<string, number>();
  for (const item of purchaseItems) {
    unitsOnHand.set(String(item.product_id), (unitsOnHand.get(String(item.product_id)) ?? 0) + toNumber(item.quantity));
  }
  for (const item of salesItems) {
    unitsOnHand.set(String(item.product_id), (unitsOnHand.get(String(item.product_id)) ?? 0) - toNumber(item.quantity));
  }

  let inventoryValue = 0;
  let inventoryUnits = 0;
  let inventoryProductCount = 0;
  const costPerUnit = new Map<string, number>();
  for (const [productId, units] of unitsOnHand) {
    if (units <= 0) continue;
    const cost =
      purchaseCosts.get(productId) ||
      toNumber(products.find((p) => String(p.id) === productId)?.last_purchase_price) ||
      0;
    costPerUnit.set(productId, cost);
    inventoryValue += units * cost;
    inventoryUnits += units;
    inventoryProductCount += 1;
  }

  const expenseByPeriod: Record<FinancialPeriod, number> = {
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    lastMonth: 0,
    last30Days: 0,
    allTime: 0,
  };
  let totalExpenseOut = 0;
  for (const e of expenses) {
    const amount = toNumber(e.amount);
    const dateStr = dateOf(e.expense_date, e.created_at ?? "");
    totalExpenseOut += amount;
    for (const p of PERIODS) {
      if (isInPeriod(dateStr, p, now)) expenseByPeriod[p] += amount;
    }
  }
  for (const p of PERIODS) {
    periods[p].expenses = expenseByPeriod[p];
    periods[p].netProfit = periods[p].grossProfit - expenseByPeriod[p];
  }

  for (const cp of customerPayments) {
    cashIn += toNumber(cp.amount);
  }
  for (const sp of supplierPayments) {
    cashOut += toNumber(sp.amount);
  }
  for (const tx of purchaseTransactions) {
    if (String(tx.payment_type ?? "").toLowerCase() === "cash") {
      const items = purchaseItems.filter((i) => String(i.purchase_transaction_id) === String(tx.id));
      const total = items.reduce((s, i) => s + toNumber(i.purchase_price) * toNumber(i.quantity), 0);
      cashOut += total;
    }
  }

  const customerLedger = buildCustomerLedger(data, now);
  const supplierLedger = buildSupplierLedger(data, now);

  const topProducts = sortRanks(Object.values(byProduct))
    .slice(0, 5)
    .map((e) => ({
      ...e,
      marginPct: e.revenue > 0 ? Math.round((e.profit / e.revenue) * 1000) / 10 : null,
    }));
  for (const e of Object.values(byCategory)) {
    e.marginPct = e.revenue > 0 ? Math.round((e.profit / e.revenue) * 1000) / 10 : null;
  }
  for (const e of Object.values(byBrand)) {
    e.marginPct = e.revenue > 0 ? Math.round((e.profit / e.revenue) * 1000) / 10 : null;
  }

  return {
    generatedAt: now.toISOString(),
    cash: {
      balance: cashIn - cashOut - totalExpenseOut,
      cashIn,
      cashOut: cashOut + totalExpenseOut,
      bankTracked: false,
      bankBalance: null,
    },
    receivables: {
      total: customerLedger.totals.totalOutstanding,
      overdue: customerLedger.totals.totalOverdue,
      count: customerLedger.totals.customersOwing,
    },
    payables: {
      total: supplierLedger.totals.totalPayable,
      overdue: supplierLedger.totals.totalOverdue,
      count: supplierLedger.totals.suppliersOwing,
    },
    periods,
    inventory: {
      value: inventoryValue,
      units: inventoryUnits,
      productCount: inventoryProductCount,
      costPerUnit,
    },
    byCategory,
    byBrand,
    byProduct: sortRanks(Object.values(byProduct)),
    topProducts,
  };
}
