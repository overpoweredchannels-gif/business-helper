import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "../src/components/dashboard/DashboardView";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { buildSupplierLedger } from "../src/lib/ai/supplier-ledger";
import { getBusinessHealthScore } from "../src/lib/dashboard/health";
import { computeInventoryValuation } from "../src/lib/inventory/valuation";
import {
  DashboardReadTracker,
  dashboardMetricDependencies,
  dashboardMetricLastSuccessAt,
  dashboardReadSources,
  dashboardReadStatusLabel,
  deriveDashboardMetricStates,
  type DashboardSourceStates,
} from "../src/lib/dashboard/data-read-state";
import { buildMixedCashRuleFixture, buildPayablesReceivablesFixture } from "./fixtures/j1b-payables-receivables";

// A €190.69 credit invoice with a €2.97 confirmed return leaves €187.72.
// Until both return reads complete, none of that invoice's balance is displayable.
// J1b settles at €250 + €100 receivable and €450 + €0 + €200 payable.
const salesReturns = ["sales-returns", "sales-return-items"] as const;
const purchaseReturns = ["purchase-returns", "purchase-return-items"] as const;
const receivables = ["customers", "sales-transactions", "sales-items", "customer-payments", "customer-payment-allocations", ...salesReturns] as const;
const payables = ["suppliers", "purchase-transactions", "purchase-items", "supplier-payments", "supplier-payment-allocations", ...purchaseReturns] as const;
const cashFlow = [...receivables, ...payables] as const;
const expected = {
  "today-sales": ["sales-transactions", "sales-items"],
  "today-profit": ["sales-transactions", "sales-items", "products"],
  "inventory-value": ["products"],
  receivables,
  payables,
  "unpaid-purchases": payables,
  "cash-flow": cashFlow,
  "business-health": [...cashFlow, "products", "expenses", "brands", "categories"],
} as const;

const oldest = "2026-11-24T12:00:00.000Z";
const now = new Date(oldest);
const fixture = buildPayablesReceivablesFixture();
const mixed = buildMixedCashRuleFixture();
assert.equal(buildCustomerLedger(fixture, now).totals.totalOutstanding, 350);
assert.equal(buildSupplierLedger(fixture, now).totals.totalPayable + buildSupplierLedger(mixed, now).totals.totalPayable, 650);
assert.equal(buildSupplierLedger({ ...fixture, purchaseReturns: [] }, now).totals.totalPayable, 500);
// The J2 extension has 7 units at €100 and Health 50 + 10 + 20 - 20 + 10 + 5.
assert.equal(computeInventoryValuation([{ productId: 1, currentStock: 7, lastPurchasePrice: 100 }]).totalValue, 700);
assert.equal(getBusinessHealthScore({
  totalSalesAmount: 500, estimatedNetProfit: 250, outOfStockCount: 1,
  lowStockCount: 0, customerCollectionsTotal: 500, expensesTotal: 0,
}).score, 75);

const flicker = {
  ...fixture,
  salesTransactions: [{ ...fixture.salesTransactions[0], total_amount: 190.69 }],
  salesItems: [],
  salesReturns: fixture.salesReturns?.slice(0, 1),
  salesReturnItems: fixture.salesReturnItems?.slice(0, 1).map((item) => ({
    ...item, quantity: 1, unit_price: 2.97,
  })),
  customerPayments: [],
  customerPaymentAllocations: [],
};
const settled = buildCustomerLedger(flicker, now).totals.totalOutstanding.toFixed(2);
const blind = buildCustomerLedger({ ...flicker, salesReturnItems: [] }, now).totals.totalOutstanding.toFixed(2);
assert.equal(blind, "190.69");
assert.equal(settled, "187.72");

const complete = Object.fromEntries(dashboardReadSources.map((source) => [
  source, { status: "successful-populated", lastSuccessAt: oldest },
])) as DashboardSourceStates;
const empty = Object.fromEntries(dashboardReadSources.map((source) => [
  source, { status: "successful-empty" },
])) as DashboardSourceStates;
const labels = { loading: "Loading…", "not-loaded": "Not loaded", failed: "Unavailable" } as const;

function renderMoneyTiles(states: DashboardSourceStates, amount: string) {
  const metricReadStates = deriveDashboardMetricStates(states);
  return renderToStaticMarkup(createElement(DashboardView, {
    userName: "Fixture Owner",
    metricReadStates,
    healthScore: 75,
    onRetryFailedReads: () => {},
    outstandingReceivables: { value: `€${amount}` },
    healthMetrics: [{
      label: "Cash Flow", value: `€${amount}`, status: "good",
      readStatus: metricReadStates["cash-flow"],
    }],
  }));
}
for (const source of salesReturns) {
  for (const status of ["loading", "not-loaded", "failed"] as const) {
    const html = renderMoneyTiles({ ...complete, [source]: { status } }, blind);
    assert.ok(html.includes(labels[status]));
    assert.ok(!html.includes(blind));
  }
}
assert.equal(renderMoneyTiles(complete, settled).split(settled).length - 1, 2);

for (const metric of Object.keys(expected) as Array<keyof typeof expected>) {
  assert.deepEqual([...dashboardMetricDependencies[metric]].sort(), [...expected[metric]].sort(), metric);
  assert.equal(deriveDashboardMetricStates(complete)[metric], "successful-populated");
  assert.equal(deriveDashboardMetricStates(empty)[metric], "successful-empty");
  for (const source of expected[metric]) {
    assert.ok(dashboardReadSources.includes(source));
    for (const status of ["loading", "not-loaded", "failed"] as const) {
      const states = { ...complete, [source]: { status, lastSuccessAt: oldest } };
      assert.equal(dashboardReadStatusLabel(deriveDashboardMetricStates(states)[metric]), labels[status], `${metric} / ${source}`);
    }
  }
}

async function testRetry() {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const retry = page.split("const retryFailedDashboardReads =")[1].split("const staffDashboardData =")[0];
  const loaders = {
    "sales-returns": "fetchSalesReturns",
    "sales-return-items": "fetchSalesReturnItems",
    "purchase-returns": "fetchPurchaseReturns",
    "purchase-return-items": "fetchPurchaseReturnItems",
  } as const;
  let states = complete;
  const tracker = new DashboardReadTracker((next) => { states = next; });
  tracker.activate("account", "org");
  for (const source of dashboardReadSources) {
    const request = tracker.begin(source, "account", "org")!;
    tracker.succeed(request, ["old"], () => {}, oldest);
  }
  const display = (metric: "receivables" | "payables", amount: string) =>
    dashboardReadStatusLabel(deriveDashboardMetricStates(states)[metric]) ?? amount;
  for (const source of [...salesReturns, ...purchaseReturns]) {
    assert.ok(retry.includes(`case "${source}": void ${loaders[source]}(currentOrganizationId);`));
    assert.ok(page.includes(`readDashboardSource("${source}", orgId,`));
    const metric = source.startsWith("sales") ? "receivables" : "payables";
    const amount = metric === "receivables" ? settled : "650.00";
    let rows = ["old"];
    const fail = tracker.read<string>(source, "account", "org", async () => {
      throw new Error("Offline and no cached returns");
    }, (next) => { rows = next; });
    assert.equal(display(metric, metric === "receivables" ? blind : amount), "Loading…");
    assert.equal((await fail).status, "failed");
    assert.deepEqual(rows, ["old"]);
    assert.equal(display(metric, amount), "Unavailable");
    assert.equal(dashboardMetricLastSuccessAt(metric, states), oldest);
    const result = await tracker.read(source, "account", "org", async () => ["reloaded"], (next) => { rows = next; });
    assert.equal(result.status, "success");
    assert.deepEqual(rows, ["reloaded"]);
    assert.equal(display(metric, amount), amount);
  }
}

void testRetry().then(() => console.log("Completeness gate checks passed")).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
