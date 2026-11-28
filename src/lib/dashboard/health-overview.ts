import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { stockStatusFor } from "../inventory/service";
import { legacyRegionalSettings, parseTimeZone } from "../regional/settings";
import { getUsableTimestamp, isDateInRange } from "../tradeos/formatters";
import { quantityToMainUnits, type UnitMode } from "../tradeos/units";
import { safeNumber } from "../tradeos/validators";
import { todayInTimezone } from "../ai/confirmation-content";
import type { DashboardHealthOverview } from "./health";

export function salesLineCogsInMainUnits(
  item: { quantity: unknown; purchase_price_snapshot?: unknown; unit_mode?: UnitMode | null },
  product?: { last_purchase_price?: number | null; units_per_pack?: number | null },
): number | null {
  const quantity = safeNumber(item.quantity);
  const snapshot = safeNumber(item.purchase_price_snapshot);
  const fallback = safeNumber(product?.last_purchase_price);
  const cost = snapshot > 0 ? snapshot : fallback > 0 ? fallback : null;
  return cost === null ? null : quantityToMainUnits(quantity, item.unit_mode ?? "main", product?.units_per_pack) * cost;
}

type HealthRows = Pick<MemoryWriterRawData, "salesTransactions" | "salesItems" | "customerPayments" | "expenses"> & {
  products: ReadonlyArray<Pick<MemoryWriterRawData["products"][number],
    "id" | "current_stock" | "last_purchase_price" | "units_per_pack" | "reorder_level" | "minimum_stock_level">>;
};

export function buildBusinessHealthOverview(rows: HealthRows, orgTimeZone?: string | null, now = new Date()): DashboardHealthOverview {
  const timeZone = parseTimeZone(orgTimeZone) ?? legacyRegionalSettings.timeZone;
  const end = todayInTimezone(timeZone, now);
  const first = new Date(`${end}T00:00:00.000Z`);
  first.setUTCDate(first.getUTCDate() - 29);
  const start = first.toISOString().slice(0, 10);
  const inRange = (...dates: unknown[]) => {
    const { value, time } = getUsableTimestamp(...dates);
    const date = value && value.length > 10 ? todayInTimezone(timeZone, new Date(time)) : value;
    return isDateInRange(date, start, end);
  };
  const sales = new Set(rows.salesTransactions
    .filter((sale) => inRange(sale.sale_date, sale.created_at))
    .map((sale) => sale.id));
  const products = new Map(rows.products.map((product) => [String(product.id), product]));
  let totalSalesAmount = 0;
  let knownCogs = 0;
  for (const line of rows.salesItems) {
    if (!sales.has(line.sales_transaction_id)) continue;
    totalSalesAmount += safeNumber(line.quantity) * safeNumber(line.selling_price) - safeNumber(line.discount);
    knownCogs += salesLineCogsInMainUnits(line, products.get(String(line.product_id))) ?? 0;
  }
  const customerCollectionsTotal = (rows.customerPayments ?? [])
    .filter((payment) => inRange(payment.payment_date, payment.created_at))
    .reduce((sum, payment) => sum + safeNumber(payment.amount), 0);
  const expensesTotal = rows.expenses
    .filter((expense) => inRange(expense.expense_date, expense.created_at))
    .reduce((sum, expense) => sum + safeNumber(expense.amount), 0);
  return {
    totalSalesAmount,
    estimatedNetProfit: totalSalesAmount - knownCogs - expensesTotal,
    outOfStockCount: rows.products.filter((product) => safeNumber(product.current_stock) <= 0).length,
    lowStockCount: rows.products.filter((product) =>
      stockStatusFor(safeNumber(product.current_stock), safeNumber(product.reorder_level ?? product.minimum_stock_level)).status === "urgent_reorder"
    ).length,
    customerCollectionsTotal,
    expensesTotal,
  };
}
