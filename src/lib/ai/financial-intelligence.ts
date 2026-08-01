import type { FinancialLedger, FinancialPeriod, FinancialRankItem } from "./financial-ledger";
import type { AssistantIntent } from "../assistant/types";

export type FinancialQueryKind =
  | "cash_balance"
  | "receivables"
  | "payables"
  | "profit_overview"
  | "expenses_overview"
  | "inventory_value"
  | "revenue_analytics"
  | "profit_analytics"
  | "trend_analysis"
  | "financial_summary"
  | "financial_insights";

export interface FinancialInsight {
  type: string; // e.g., "sales_drop", "receivables_growth"
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

function formatRs(amount: number): string {
  return `Rs ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercentage(value: number | null): string {
  if (value === null) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatPeriod(period: FinancialPeriod): string {
  switch (period) {
    case "today": return "today";
    case "thisWeek": return "this week";
    case "thisMonth": return "this month";
    case "lastMonth": return "last month";
    case "last30Days": return "last 30 days";
    case "allTime": return "all time";
  }
}

function getPeriodComparison(ledger: FinancialLedger, currentPeriod: FinancialPeriod, previousPeriod: FinancialPeriod, metric: keyof FinancialLedger["periods"]["today"]): string {
  const current = ledger.periods[currentPeriod][metric];
  const previous = ledger.periods[previousPeriod][metric];
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / previous) * 100 : current !== 0 ? 100 : 0;

  if (pct === 0) return `no change ${formatPeriod(currentPeriod)} vs ${formatPeriod(previousPeriod)}`;
  const sign = diff > 0 ? "up" : "down";
  return `${sign} by ${formatPercentage(Math.abs(pct))} ${formatPeriod(currentPeriod)} vs ${formatPeriod(previousPeriod)}`;
}

function rankItems(items: Record<string, FinancialRankItem>): FinancialRankItem[] {
  return Object.values(items).sort((a, b) => b.revenue - a.revenue);
}

export function processFinancialQuery(
  queryType: FinancialQueryKind,
  ledger: FinancialLedger,
  intent: AssistantIntent,
  message: string // Original message for context
): { ok: boolean; message: string; insights?: FinancialInsight[] } {
  let response = "";

  switch (queryType) {
    case "cash_balance": {
      const cash = ledger.cash;
      response += `Your current cash balance is ${formatRs(cash.balance)}.\n`;
      if (!cash.bankTracked) {
        response += `Bank balance is not tracked in the system.\n`;
      }
      response += `Cash inflows today: ${formatRs(ledger.periods.today.cashRevenue)} (from sales and customer payments).\n`;
      response += `Cash outflows today: ${formatRs(ledger.periods.today.expenses + ledger.periods.today.cashRevenue - ledger.periods.today.grossProfit)} (from expenses, purchases, supplier payments).`; // Simplified cash out for today
      break;
    }
    case "receivables": {
      const receivables = ledger.receivables;
      response += `Total outstanding receivables: ${formatRs(receivables.total)} from ${receivables.count} customer(s).\n`;
      response += `${formatRs(receivables.overdue)} is overdue.\n`;
      break;
    }
    case "payables": {
      const payables = ledger.payables;
      response += `Total outstanding payables: ${formatRs(payables.total)} to ${payables.count} supplier(s).\n`;
      response += `${formatRs(payables.overdue)} is overdue.\n`;
      break;
    }
    case "profit_overview": {
      const thisMonth = ledger.periods.thisMonth;
      const lastMonth = ledger.periods.lastMonth;
      response += `This month's gross profit: ${formatRs(thisMonth.grossProfit)}, net profit: ${formatRs(thisMonth.netProfit)}.\n`;
      response += `Compared to last month, gross profit is ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "grossProfit")}.\n`;
      response += `Compared to last month, net profit is ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "netProfit")}.`;
      break;
    }
    case "expenses_overview": {
      const thisMonth = ledger.periods.thisMonth;
      const lastMonth = ledger.periods.lastMonth;
      response += `This month's total expenses: ${formatRs(thisMonth.expenses)}.\n`;
      response += `Compared to last month, expenses are ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "expenses")}.\n`;
      // TODO: Add top expense categories if available
      break;
    }
    case "inventory_value": {
      const inventory = ledger.inventory;
      response += `Your total inventory value is ${formatRs(inventory.value)} across ${inventory.productCount} product(s).\n`;
      response += `Total units in stock: ${inventory.units}.`;
      break;
    }
    case "revenue_analytics": {
      // Determine dimension from message: category, brand, product
      const byCategory = rankItems(ledger.byCategory);
      const byBrand = rankItems(ledger.byBrand);
      const byProduct = ledger.topProducts; // already sorted and sliced

      let analyticsText = "";
      if (byCategory.length > 0) {
        analyticsText += `\nTop 3 categories by revenue:\n`;
        byCategory.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.revenue)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      if (byBrand.length > 0) {
        analyticsText += `\nTop 3 brands by revenue:\n`;
        byBrand.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.revenue)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      if (byProduct.length > 0) {
        analyticsText += `\nTop 3 products by revenue:\n`;
        byProduct.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.revenue)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      response += analyticsText.trim() || "No revenue analytics available.";
      break;
    }
    case "profit_analytics": {
      const byCategory = rankItems(ledger.byCategory);
      const byBrand = rankItems(ledger.byBrand);
      const byProduct = ledger.byProduct.sort((a, b) => b.profit - a.profit); // Sort by profit

      let analyticsText = "";
      if (byCategory.length > 0) {
        analyticsText += `\nTop 3 categories by profit:\n`;
        byCategory.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.profit)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      if (byBrand.length > 0) {
        analyticsText += `\nTop 3 brands by profit:\n`;
        byBrand.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.profit)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      if (byProduct.length > 0) {
        analyticsText += `\nTop 3 products by profit:\n`;
        byProduct.slice(0, 3).forEach((item, i) => {
          analyticsText += `${i + 1}. ${item.name}: ${formatRs(item.profit)} (${formatPercentage(item.marginPct)} profit margin)\n`;
        });
      }
      response += analyticsText.trim() || "No profit analytics available.";
      break;
    }
    case "trend_analysis": {
        response += `Sales revenue trend: ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "revenue")}.\n`;
        response += `Gross profit trend: ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "grossProfit")}.\n`;
        response += `Net profit trend: ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "netProfit")}.\n`;
        response += `Expenses trend: ${getPeriodComparison(ledger, "thisMonth", "lastMonth", "expenses")}.`;
        break;
    }
    case "financial_summary": {
      const thisMonth = ledger.periods.thisMonth;
      response += `Financial Summary (${formatPeriod("thisMonth")}):\n`;
      response += `- Revenue: ${formatRs(thisMonth.revenue)} (Cash: ${formatRs(thisMonth.cashRevenue)}, Credit: ${formatRs(thisMonth.creditRevenue)})\n`;
      response += `- Gross Profit: ${formatRs(thisMonth.grossProfit)}\n`;
      response += `- Expenses: ${formatRs(thisMonth.expenses)}\n`;
      response += `- Net Profit: ${formatRs(thisMonth.netProfit)}\n`;
      response += `- Cash Balance: ${formatRs(ledger.cash.balance)}\n`;
      response += `- Receivables: ${formatRs(ledger.receivables.total)} (${ledger.receivables.count} customers owing, ${formatRs(ledger.receivables.overdue)} overdue)\n`;
      response += `- Payables: ${formatRs(ledger.payables.total)} (${ledger.payables.count} suppliers owing, ${formatRs(ledger.payables.overdue)} overdue)\n`;
      response += `- Inventory Value: ${formatRs(ledger.inventory.value)} (${ledger.inventory.units} units)\n`;
      break;
    }
    case "financial_insights": {
        const insights = generateFinancialInsights(ledger);
        if (insights.length > 0) {
            response += `Here are some financial insights:\n`;
            insights.forEach((insight, i) => {
                response += `${i + 1}. ${insight.title} (${insight.severity}): ${insight.detail}\n`;
            });
        } else {
            response += `No particular financial insights to highlight at this moment.`;
        }
        break;
    }
    default:
      return { ok: false, message: `I don't know how to answer financial queries about ${queryType}.` };
  }

  return { ok: true, message: response.trim() };
}

export function generateFinancialInsights(ledger: FinancialLedger): FinancialInsight[] {
  const insights: FinancialInsight[] = [];
  const thisMonth = ledger.periods.thisMonth;
  const lastMonth = ledger.periods.lastMonth;
  const thisWeek = ledger.periods.thisWeek;
  const last30Days = ledger.periods.last30Days;

  // 1. Sales dropped vs last week
  if (thisWeek.revenue > 0 && lastMonth.revenue > 0) { // Using lastMonth for a broader comparison, as week-on-week can be noisy
    const salesChange = (thisWeek.revenue - lastMonth.revenue) / lastMonth.revenue;
    if (salesChange < -0.1) { // More than 10% drop
      insights.push({
        type: "sales_drop",
        severity: "warning",
        title: "Significant Sales Drop Detected",
        detail: `Revenue for ${formatPeriod("thisWeek")} is ${formatPercentage(Math.abs(salesChange) * 100)} lower than ${formatPeriod("lastMonth")}. Investigate causes.`,
      });
    }
  }

  // 2. Inventory investment increased
  // Simplified: compare inventory value to last month's purchases, if value is too high compared to recent purchases, implies slow movement.
  if (ledger.inventory.value > 0 && last30Days.revenue > 0) {
    const inventoryToRevenueRatio = ledger.inventory.value / last30Days.revenue;
    if (inventoryToRevenueRatio > 2) { // Inventory value is more than 2x last 30 days revenue (arbitrary threshold for a warning)
        insights.push({
            type: "inventory_over_investment",
            severity: "info", // Can be warning depending on context
            title: "High Inventory Value Detected",
            detail: `Your current inventory value (${formatRs(ledger.inventory.value)}) is high compared to last 30 days revenue (${formatRs(last30Days.revenue)}). Consider optimizing stock levels to free up cash.`,
        });
    }
  }

  // 3. Receivables growing (this month credit sales vs last month credit sales)
  if (thisMonth.creditRevenue > 0 && lastMonth.creditRevenue > 0) {
    const receivablesGrowth = (thisMonth.creditRevenue - lastMonth.creditRevenue) / lastMonth.creditRevenue;
    if (receivablesGrowth > 0.2) { // More than 20% increase in credit sales
      insights.push({
        type: "receivables_growth",
        severity: "warning",
        title: "Receivables Potentially Growing Too Fast",
        detail: `Credit sales for ${formatPeriod("thisMonth")} are ${formatPercentage(receivablesGrowth * 100)} higher than ${formatPeriod("lastMonth")}. Monitor customer payments closely.`,
      });
    }
  }

  // 4. Supplier payable overdue
  if (ledger.payables.overdue > 0) {
    insights.push({
      type: "supplier_payable_overdue",
      severity: "critical",
      title: "Overdue Supplier Payments",
      detail: `You have ${formatRs(ledger.payables.overdue)} in overdue payments to ${ledger.payables.count} supplier(s). Prioritize these payments to maintain good relationships.`,
    });
  }

  // 5. Customer credit risk increasing (simplified: high overdue receivables)
  if (ledger.receivables.overdue > ledger.receivables.total * 0.1) { // More than 10% of receivables are overdue
    insights.push({
      type: "customer_credit_risk",
      severity: "warning",
      title: "Increasing Customer Credit Risk",
      detail: `A significant portion (${formatPercentage((ledger.receivables.overdue / ledger.receivables.total) * 100)}) of your receivables (${formatRs(ledger.receivables.overdue)}) are overdue. Review credit policies and follow up with customers.`,
    });
  }

  // 6. Top/bottom category by profit (using byCategory data)
  const sortedCategories = rankItems(ledger.byCategory).sort((a, b) => b.profit - a.profit);
  if (sortedCategories.length > 0) {
    insights.push({
      type: "top_profit_category",
      severity: "info",
      title: `Highest Profit Category: ${sortedCategories[0].name}`,
      detail: `${sortedCategories[0].name} generated ${formatRs(sortedCategories[0].profit)} profit this period. Consider focusing marketing efforts here.`,
    });
    if (sortedCategories.length > 1) {
        const lowestProfitCategory = sortedCategories[sortedCategories.length - 1];
        insights.push({
            type: "lowest_profit_category",
            severity: "info",
            title: `Lowest Profit Category: ${lowestProfitCategory.name}`,
            detail: `${lowestProfitCategory.name} generated only ${formatRs(lowestProfitCategory.profit)} profit this period. Evaluate product mix or pricing.`,
        });
    }
  }

  // 7. Fastest-growing customer (simplified for now to highest revenue customer this month)
  // This would ideally require per-customer time series data. For now, use top customer by revenue this month.
  // This data is not directly in the ledger, needs rebuild from customer-ledger if truly needed
  // For now, skipping this insight as it's complex without dedicated ledger structure.

  // 8. Most profitable supplier (from supplier ledger if available easily)
  // Similarly, this would need per-supplier profit data from purchase items, which is complex
  // Skipping for now.

  // 9. Inventory carrying cost warning (simplified)
  if (ledger.inventory.value > 0 && thisMonth.expenses > 0) {
    const inventoryToExpenseRatio = ledger.inventory.value / thisMonth.expenses;
    if (inventoryToExpenseRatio > 5) { // Inventory value is more than 5x monthly expenses, suggesting high carrying cost
        insights.push({
            type: "inventory_carrying_cost",
            severity: "info",
            title: "High Inventory Carrying Cost",
            detail: `Your inventory value (${formatRs(ledger.inventory.value)}) is high relative to your monthly expenses (${formatRs(thisMonth.expenses)}). Excessive inventory can incur significant carrying costs.`,
        });
    }
  }


  return insights;
}
