import { salesLineCogsInMainUnits } from "@/lib/ai/assistant-kpi-block";
import { calendarDayOfRecord } from "@/lib/regional/dates";
import { safeNumber } from "@/lib/tradeos/validators";
import type { Product } from "@/lib/tradeos/types";
import { inDashboardRange, type DashboardRange } from "./period";
import type { DashboardSalesData } from "./sales-read";

export function dashboardPeriodSalesTotals(
  transactions: DashboardSalesData["salesTransactions"],
  items: DashboardSalesData["salesItems"],
  products: ReadonlyMap<string, Product>,
  range: DashboardRange,
  includeProfit: boolean,
) {
  const ids = new Set(transactions.filter(tx =>
    inDashboardRange(calendarDayOfRecord([tx.sale_date, tx.created_at]), range)
  ).map(tx => tx.id));
  let sales = 0;
  let profit = 0;
  let unknownCostLines = 0;
  let unknownCostRevenue = 0;
  for (const item of items) {
    if (!ids.has(item.sales_transaction_id)) continue;
    const revenue = safeNumber(item.quantity) * safeNumber(item.selling_price) - safeNumber(item.discount);
    sales += revenue;
    if (!includeProfit) continue;
    const cost = salesLineCogsInMainUnits(item, products.get(String(item.product_id)));
    if (cost === null) {
      unknownCostLines++;
      unknownCostRevenue += revenue;
    } else {
      profit += revenue - cost;
    }
  }
  return { sales, profit, unknownCostLines, unknownCostRevenue };
}
