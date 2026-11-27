import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { getBusinessHealthScore, type DashboardHealthOverview } from "../dashboard/health";
import { stockStatusFor } from "../inventory/service";
import { computeInventoryValuation } from "../inventory/valuation";
import { legacyRegionalSettings, parseTimeZone } from "../regional/settings";
import { getUsableTimestamp, isDateInRange } from "../tradeos/formatters";
import { quantityToMainUnits, type UnitMode } from "../tradeos/units";
import { safeNumber } from "../tradeos/validators";
import { formatAiMoney, resolveAiCurrency } from "./ai-money";
import { todayInTimezone } from "./confirmation-content";
import { buildCustomerLedger } from "./customer-ledger";
import { buildSupplierLedger } from "./supplier-ledger";

export type AssistantKpiInputs = {
  payables: number;
  receivables: number;
  customersOwing: number;
  inventoryValue: number;
  health: DashboardHealthOverview;
};

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

// Server chats have no dashboard filters. Use the dashboard's default
// 30-day overview with the same line cost and inventory classifiers.
export function buildDefaultAssistantKpiInputs(raw: MemoryWriterRawData, now = new Date()) {
  const timeZone = parseTimeZone(raw.timezone) ?? legacyRegionalSettings.timeZone;
  const customers = buildCustomerLedger(raw, now).totals;
  const suppliers = buildSupplierLedger(raw, now).totals;
  const end = todayInTimezone(timeZone, now);
  const first = new Date(`${end}T00:00:00.000Z`);
  first.setUTCDate(first.getUTCDate() - 29);
  const start = first.toISOString().slice(0, 10);
  const inRange = (...dates: unknown[]) => isDateInRange(getUsableTimestamp(...dates).value, start, end);
  const sales = new Set(raw.salesTransactions
    .filter((sale) => inRange(sale.sale_date, sale.created_at))
    .map((sale) => sale.id));
  const products = new Map(raw.products.map((product) => [String(product.id), product]));
  let totalSalesAmount = 0;
  let knownCogs = 0;
  for (const line of raw.salesItems) {
    if (!sales.has(line.sales_transaction_id)) continue;
    totalSalesAmount += safeNumber(line.quantity) * safeNumber(line.selling_price) - safeNumber(line.discount);
    knownCogs += salesLineCogsInMainUnits(line, products.get(String(line.product_id))) ?? 0;
  }
  const customerCollectionsTotal = (raw.customerPayments ?? [])
    .filter((payment) => inRange(payment.payment_date, payment.created_at))
    .reduce((sum, payment) => sum + safeNumber(payment.amount), 0);
  const expensesTotal = raw.expenses
    .filter((expense) => inRange(expense.expense_date, expense.created_at))
    .reduce((sum, expense) => sum + safeNumber(expense.amount), 0);
  const inventory = raw.products.map((product) => ({
    productId: product.id,
    productName: product.name,
    currentStock: safeNumber(product.current_stock),
    lastPurchasePrice: product.last_purchase_price,
    defaultSellingPrice: product.default_selling_price,
    reorderLevel: safeNumber(product.reorder_level ?? product.minimum_stock_level ?? 0),
  }));
  return {
    period: { start, end },
    knownCogs,
    payables: suppliers.totalPayable,
    receivables: customers.totalOutstanding,
    customersOwing: customers.customersOwing,
    inventoryValue: computeInventoryValuation(inventory).totalValue,
    health: {
      totalSalesAmount,
      estimatedNetProfit: totalSalesAmount - knownCogs - expensesTotal,
      outOfStockCount: inventory.filter(({ currentStock }) => currentStock <= 0).length,
      lowStockCount: inventory.filter(({ currentStock, reorderLevel }) =>
        stockStatusFor(currentStock, reorderLevel).status === "urgent_reorder"
      ).length,
      customerCollectionsTotal,
      expensesTotal,
    },
  };
}

export function buildAssistantKpiBlock(
  source: AssistantKpiInputs | MemoryWriterRawData | null,
  currency: unknown,
  orgTimezone: string | null | undefined,
  now = new Date(),
) {
  if (!source) return null;
  const timeZone = parseTimeZone(orgTimezone) ?? legacyRegionalSettings.timeZone;
  if ("products" in source && source.assistantKpiReady === false) return null;
  const input = "products" in source ? buildDefaultAssistantKpiInputs({ ...source, timezone: timeZone }, now) : source;
  const { score, label } = getBusinessHealthScore(input.health);
  const resolved = resolveAiCurrency(currency);
  const booksCurrency = resolved.kind === "known" ? resolved.currency : resolved.kind === "unknown" ? resolved.code : null;
  const computedAt = `${todayInTimezone(timeZone, now)} ${new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(now)} ${timeZone}`;
  const { payables, receivables, customersOwing, inventoryValue } = input;
  const cashFlow = receivables - payables;
  return {
    payables, receivables, cashFlow, customersOwing, inventoryValue,
    health: { score, label }, booksCurrency, computedAt,
    text: [
      `Outstanding Payables: ${formatAiMoney(payables, booksCurrency)}`,
      `Outstanding Receivables: ${formatAiMoney(receivables, booksCurrency)} (${customersOwing} customers with outstanding balances)`,
      `Cash Flow (receivables minus payables): ${formatAiMoney(cashFlow, booksCurrency)}`,
      `Inventory Value: ${formatAiMoney(inventoryValue, booksCurrency)}`,
      `Health: ${score}/100 (${label})`,
      `Books currency: ${booksCurrency ?? "unknown"}`,
      `Computed at: ${computedAt}`,
    ].join("\n"),
  };
}

export type AssistantKpiBlock = NonNullable<ReturnType<typeof buildAssistantKpiBlock>>;
