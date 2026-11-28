import { buildBusinessHealthOverview } from "../dashboard/health-overview";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { getBusinessHealthScore, type DashboardHealthOverview } from "../dashboard/health";
import { computeInventoryValuation } from "../inventory/valuation";
import { legacyRegionalSettings, parseTimeZone } from "../regional/settings";
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

export { salesLineCogsInMainUnits } from "../dashboard/health-overview";

// Server chats have no dashboard filters. Use the dashboard's default
// 30-day overview with the same line cost and inventory classifiers.
function rawKpiInputs(raw: MemoryWriterRawData, timeZone: string, now: Date): AssistantKpiInputs {
  const customers = buildCustomerLedger(raw, now).totals;
  const suppliers = buildSupplierLedger(raw, now).totals;
  const inventory = raw.products.map((product) => ({
    productId: product.id,
    productName: product.name,
    currentStock: safeNumber(product.current_stock),
    lastPurchasePrice: product.last_purchase_price,
    defaultSellingPrice: product.default_selling_price,
    reorderLevel: safeNumber(product.reorder_level ?? product.minimum_stock_level ?? 0),
  }));
  return {
    payables: suppliers.totalPayable,
    receivables: customers.totalOutstanding,
    customersOwing: customers.customersOwing,
    inventoryValue: computeInventoryValuation(inventory).totalValue,
    health: buildBusinessHealthOverview(raw, timeZone, now),
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
  const input = "products" in source ? rawKpiInputs(source, timeZone, now) : source;
  const { score, label } = getBusinessHealthScore(input.health);
  const resolved = resolveAiCurrency(currency);
  const booksCurrency = resolved.kind === "known" ? resolved.currency : resolved.kind === "unknown" ? resolved.code : null;
  const computedAt = `${todayInTimezone(timeZone, now)} ${new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(now)} ${timeZone}`;
  const { payables, receivables, customersOwing, inventoryValue } = input;
  return {
    payables, receivables, customersOwing, inventoryValue,
    health: { score, label }, booksCurrency, computedAt,
    text: [
      `Outstanding Payables: ${formatAiMoney(payables, booksCurrency)}`,
      `Outstanding Receivables: ${formatAiMoney(receivables, booksCurrency)} (${customersOwing} customers with outstanding balances)`,
      `Inventory Value: ${formatAiMoney(inventoryValue, booksCurrency)}`,
      `Health: ${score}/100 (${label})`,
      `Books currency: ${booksCurrency ?? "unknown"}`,
      `Computed at: ${computedAt}`,
    ].join("\n"),
  };
}

export type AssistantKpiBlock = NonNullable<ReturnType<typeof buildAssistantKpiBlock>>;
