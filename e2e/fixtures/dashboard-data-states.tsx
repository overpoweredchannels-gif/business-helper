import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardView } from "../../src/components/dashboard/DashboardView";
import {
  DashboardReadTracker,
  dashboardReadSources,
  deriveDashboardMetricLastSuccessAt,
  deriveDashboardMetricStates,
  emptyDashboardSourceStates,
  type DashboardReadSource,
  type DashboardSourceStates,
} from "../../src/lib/dashboard/data-read-state";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function Fixture() {
  const emptyScenario = new URLSearchParams(location.search).has("empty");
  const [sourceStates, setSourceStates] = useState<DashboardSourceStates>(emptyDashboardSourceStates);
  const [activeScope, setActiveScope] = useState({ accountId: "account-a", organizationId: "org-a" });
  const [lastCommittedScope, setLastCommittedScope] = useState("none");
  const [retryCount, setRetryCount] = useState(0);
  const [committedExpenseIds, setCommittedExpenseIds] = useState<string[]>([]);
  const trackerRef = useRef<DashboardReadTracker | null>(null);
  if (trackerRef.current == null) trackerRef.current = new DashboardReadTracker(setSourceStates);
  const tracker = trackerRef.current;
  const metrics = deriveDashboardMetricStates(sourceStates);
  const lastSuccessfulAt = deriveDashboardMetricLastSuccessAt(sourceStates);
  const counts = emptyScenario ? 0 : 1;

  const read = (source: DashboardReadSource, scope = activeScope, options: { delay?: number; fail?: boolean } = {}) =>
    tracker.read(source, scope.accountId, scope.organizationId, async () => {
      await wait(options.delay ?? 25);
      if (options.fail) throw new Error(`synthetic ${source} failure`);
      return emptyScenario ? [] : counts ? [{ id: source === "expenses" ? `${scope.accountId}-${scope.organizationId}` : source }] : [];
    }, (rows) => {
      setLastCommittedScope(`${scope.accountId}/${scope.organizationId}`);
      if (source === "expenses") setCommittedExpenseIds(rows.map((row) => row.id));
    });

  const loadAll = async (failSource?: DashboardReadSource) => {
    tracker.activate(activeScope.accountId, activeScope.organizationId);
    setCommittedExpenseIds([]);
    await Promise.all(dashboardReadSources.map((source) => read(source, activeScope, { delay: source === "sales-items" ? 180 : 45, fail: source === failSource })));
  };

  const loadWithExpensesPending = async () => {
    tracker.activate(activeScope.accountId, activeScope.organizationId);
    setCommittedExpenseIds([]);
    await Promise.all(dashboardReadSources.filter((source) => source !== "expenses").map((source) => read(source, activeScope, { delay: 20 })));
    void read("expenses", activeScope, { delay: 500 });
  };

  const failProductsRefresh = async () => {
    await read("products", activeScope, { fail: true });
  };

  const retryFailed = async () => {
    setRetryCount((value) => value + 1);
    await Promise.all(dashboardReadSources.filter((source) => sourceStates[source].status === "failed").map((source) => read(source)));
  };

  const switchOrganizationWhilePending = async () => {
    const oldScope = activeScope;
    const oldRead = read("expenses", oldScope, { delay: 180 });
    await wait(0);
    const newScope = { accountId: "account-b", organizationId: "org-b" };
    setActiveScope(newScope);
    tracker.activate(newScope.accountId, newScope.organizationId);
    setCommittedExpenseIds([]);
    await read("expenses", newScope);
    await oldRead;
  };

  return <main className="responsive-content space-y-4 p-4">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="min-h-11 rounded bg-primary px-3 text-primary-foreground" onClick={() => void loadAll()}>Load successful data</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void loadAll("sales-items")}>Load with one failure</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void loadWithExpensesPending()}>Load with expenses pending</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void loadAll("expenses")}>Load with expense failure</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void read("expenses", activeScope, { fail: true })}>Fail expenses refresh</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void failProductsRefresh()}>Fail products refresh</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void retryFailed()}>Retry failed reads</button>
      <button type="button" className="min-h-11 rounded border border-input px-3" onClick={() => void switchOrganizationWhilePending()}>Switch organization during read</button>
    </div>
    <p data-testid="committed-scope">Committed scope: {lastCommittedScope}</p>
    <p data-testid="committed-expenses">Expenses: {committedExpenseIds.join(",") || "none"}</p>
    <p data-testid="retry-count">Retry count: {retryCount}</p>
    <DashboardView
      userName="Synthetic Owner"
      metricReadStates={metrics}
      metricLastSuccessfulAt={lastSuccessfulAt}
      onRetryFailedReads={() => void retryFailed()}
      healthMetrics={[
        { label: "Cash Flow", value: "PKR 600.00", status: "good" },
        { label: "Inventory Health", value: "2 low stock", status: "warning" },
        { label: "Profit Margin", value: "30.0%", status: "good" },
        { label: "Stock Health", value: "0 out of stock", status: "good" },
      ]}
      smartModules={[
        { id: "products", title: "Products", summary: "0 products in catalog", readStatus: sourceStates.products.status, lastSuccessfulAt: sourceStates.products.lastSuccessAt },
        { id: "customers", title: "Customers", summary: "0 registered customers", readStatus: sourceStates.customers.status, lastSuccessfulAt: sourceStates.customers.lastSuccessAt },
        { id: "suppliers", title: "Suppliers", summary: "0 suppliers", readStatus: sourceStates.suppliers.status, lastSuccessfulAt: sourceStates.suppliers.lastSuccessAt },
        { id: "sales", title: "Sales", summary: "0 recent sales transactions", readStatus: sourceStates["sales-transactions"].status, lastSuccessfulAt: sourceStates["sales-transactions"].lastSuccessAt },
        { id: "purchases", title: "Purchases", summary: "0 recent purchases", readStatus: sourceStates["purchase-transactions"].status, lastSuccessfulAt: sourceStates["purchase-transactions"].lastSuccessAt },
      ]}
      todaySales={{ value: emptyScenario ? "PKR 0.00" : "PKR 1,250.00" }}
      todayProfit={{ value: emptyScenario ? "PKR 0.00" : "PKR 375.00" }}
      inventoryValue={{ value: emptyScenario ? "PKR 0.00" : "PKR 4,000.00" }}
      outstandingReceivables={{ value: emptyScenario ? "PKR 0.00" : "PKR 800.00" }}
      outstandingPayables={{ value: emptyScenario ? "PKR 0.00" : "PKR 200.00" }}
      lowStockAlerts={{ value: emptyScenario ? "0" : "2", count: emptyScenario ? 0 : 2 }}
      pendingApprovals={emptyScenario ? 0 : 1}
      invoicesDue={emptyScenario ? 0 : 1}
      paymentsDue={emptyScenario ? 0 : 1}
      lowStockItems={emptyScenario ? 0 : 1}
      customersToFollowUp={emptyScenario ? 0 : 1}
      expiringProducts={emptyScenario ? 0 : 1}
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
