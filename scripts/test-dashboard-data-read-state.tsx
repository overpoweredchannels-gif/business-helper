import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DashboardView } from "../src/components/dashboard/DashboardView";
import { SectionSummaryCard } from "../src/components/dashboard/SectionSummaryCard";
import { loadDashboardExpenses } from "../src/lib/dashboard/expenses-loader";
import {
  DashboardReadTracker,
  dashboardReadSources,
  deriveDashboardMetricLastSuccessAt,
  deriveDashboardMetricStates,
  emptyDashboardSourceStates,
  runDashboardSourceRead,
  type DashboardReadSource,
  type DashboardSourceStates,
} from "../src/lib/dashboard/data-read-state";

function renderDashboard(states: DashboardSourceStates, onRetry = () => undefined) {
  const smartModule = (source: DashboardReadSource, title: string, summary: string) => ({
    id: source,
    title,
    summary,
    readStatus: states[source].status,
    lastSuccessfulAt: states[source].lastSuccessAt,
  });
  return renderToStaticMarkup(
    <DashboardView
      userName="Test Owner"
      metricReadStates={deriveDashboardMetricStates(states)}
      metricLastSuccessfulAt={deriveDashboardMetricLastSuccessAt(states)}
      onRetryFailedReads={onRetry}
      todaySales={{ value: "PKR 1,250.00" }}
      todayProfit={{ value: "PKR 375.00" }}
      inventoryValue={{ value: "PKR 4,000.00" }}
      healthMetrics={[
        { label: "Cash Flow", value: "PKR 600.00", status: "good" },
        { label: "Inventory Health", value: "2 low stock", status: "warning" },
        { label: "Profit Margin", value: "30.0%", status: "good" },
        { label: "Stock Health", value: "0 out of stock", status: "good" },
      ]}
      outstandingReceivables={{ value: "PKR 800.00" }}
      outstandingPayables={{ value: "PKR 200.00" }}
      lowStockAlerts={{ value: "2", count: 2 }}
      pendingApprovals={1}
      invoicesDue={2}
      paymentsDue={3}
      lowStockItems={4}
      customersToFollowUp={5}
      expiringProducts={6}
      smartModules={[
        smartModule("products", "Products", "0 products in catalog"),
        smartModule("customers", "Customers", "0 registered customers"),
        smartModule("suppliers", "Suppliers", "0 suppliers"),
        smartModule("sales-transactions", "Sales", "0 recent sales transactions"),
        smartModule("purchase-transactions", "Purchases", "0 recent purchases"),
      ]}
      droppedCards={[{
        id: "section:products",
        label: "Products",
        node: <SectionSummaryCard summary={{
          title: "Products",
          onOpen: () => undefined,
          metrics: [{ label: "Products", value: "0", readStatus: states.products.status, lastSuccessfulAt: states.products.lastSuccessAt }],
          rows: [],
          emptyText: "No products added yet.",
          rowsReadStatus: states.products.status,
          rowsLastSuccessfulAt: states.products.lastSuccessAt,
        }} />,
      }]}
      onKPIClick={() => undefined}
    />,
  );
}

function dashboardWidget(markup: string, widgetId: string) {
  const marker = `data-dashboard-widget="${widgetId}"`;
  const index = markup.indexOf(marker);
  return index < 0 ? "" : markup.slice(index);
}

type ExpenseRow = { id: string; amount: number };

function fakeExpensesClient<Row extends ExpenseRow>(organizationId: string, load: () => Promise<Row[]>) {
  return {
    from(table: string) {
      assert.equal(table, "expenses", "the dashboard loader queries expenses");
      return {
        select(columns: string) {
          assert.equal(columns, "*", "the expense loader retains its existing select");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "organization_id");
              assert.equal(value, organizationId, "the expense query stays org-scoped");
              return {
                order(column: string, options: { ascending: boolean }) {
                  assert.equal(column, "created_at");
                  assert.deepEqual(options, { ascending: false });
                  try {
                    return load().then(
                      (data) => ({ data, error: null }),
                      (error: unknown) => ({ data: null, error }),
                    );
                  } catch (error) {
                    return Promise.resolve({ data: null, error });
                  }
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

async function succeed<T>(tracker: DashboardReadTracker, states: DashboardSourceStates, source: keyof DashboardSourceStates, account: string, org: string, data: T[]) {
  const result = await runDashboardSourceRead(tracker, source, account, org, async () => data, () => undefined, () => undefined);
  assert.equal(result.status, "success");
}

async function main() {
  let states = emptyDashboardSourceStates();
  const tracker = new DashboardReadTracker((next) => { states = next; });
  tracker.activate("account-a", "org-a");

  let finishDelayed!: (rows: string[]) => void;
  const delayed = tracker.read("products", "account-a", "org-a", () => new Promise<string[]>((resolve) => { finishDelayed = resolve; }), () => undefined);
  assert.equal(states.products.status, "loading", "a pending loader publishes loading before it settles");
  assert.ok(renderDashboard(states).includes("Loading…"), "the shared KPI shows loading without rendering a zero");
  assert.doesNotMatch(renderDashboard(states), /0 products in catalog/, "unread module sources do not show a zero count");
  assert.match(renderDashboard(states), /Not loaded/, "unread module sources show an explicit state");
  await Promise.resolve();
  finishDelayed([]);
  assert.equal((await delayed).status, "success");
  assert.equal(states.products.status, "successful-empty", "an empty successful response differs from not-loaded");
  assert.equal(deriveDashboardMetricStates(states)["inventory-value"], "successful-empty");

  await succeed(tracker, states, "products", "account-a", "org-a", [{ id: 1 }]);
  await succeed(tracker, states, "sales-transactions", "account-a", "org-a", [{ id: 1 }]);
  const itemFailure = await tracker.read("sales-items", "account-a", "org-a", async () => { throw new Error("synthetic read failure"); }, () => assert.fail("failed rows must not be committed"));
  assert.equal(itemFailure.status, "failed", "a failed dependency resolves as a result, not an unhandled rejection");
  const partial = deriveDashboardMetricStates(states);
  assert.equal(partial["today-sales"], "failed");
  assert.equal(partial["today-profit"], "failed");
  assert.equal(partial["inventory-value"], "successful-populated", "an unrelated figure remains usable");
  const failedMarkup = renderDashboard(states, () => undefined);
  assert.match(failedMarkup, /Unavailable/);
  assert.doesNotMatch(failedMarkup, /PKR 1,250\.00/);
  assert.match(failedMarkup, /PKR 4,000\.00/, "successful unaffected figures remain visible");
  const healthCard = dashboardWidget(failedMarkup, "business-health");
  assert.match(healthCard, /Business health is unavailable\./, "the derived health score is withheld when one of its metric sources fails");
  assert.doesNotMatch(healthCard, />75</, "a failed dependency does not leave the previous score visible");
  assert.match(failedMarkup, /Retry dashboard reads/);
  assert.match(failedMarkup, /Collection Tasks/);
  assert.match(failedMarkup, /Retry/);

  await succeed(tracker, states, "sales-items", "account-a", "org-a", [{ id: 1 }]);
  const lastSuccess = states.products.lastSuccessAt;
  await tracker.read("products", "account-a", "org-a", async () => { throw new Error("refresh failed"); }, () => assert.fail("failed refresh must not commit"));
  assert.equal(states.products.status, "failed", "refresh failure is visible even after a prior success");
  assert.equal(states.products.lastSuccessAt, lastSuccess, "the last successful read time is retained");
  const refreshFailureMarkup = renderDashboard(states);
  assert.match(refreshFailureMarkup, /Last successful update:/, "retained source data is identified as stale");
  assert.doesNotMatch(refreshFailureMarkup, /PKR 4,000\.00/, "a failed refresh does not present retained inventory as current");

  await succeed(tracker, states, "products", "account-a", "org-a", [{ id: 2 }]);
  assert.equal(states.products.status, "successful-populated", "retry recovery returns the metric to usable state");
  assert.equal(deriveDashboardMetricStates(states)["inventory-value"], "successful-populated");

  let finishOld!: (rows: string[]) => void;
  let oldCommit = false;
  const oldRead = tracker.read("products", "account-a", "org-a", () => new Promise<string[]>((resolve) => { finishOld = resolve; }), () => { oldCommit = true; });
  tracker.activate("account-a", "org-b");
  let activeProducts: string[] = [];
  const currentRead = tracker.read("products", "account-a", "org-b", async () => ["org-b product"], (rows) => { activeProducts = rows; });
  assert.equal((await currentRead).status, "success");
  finishOld(["org-a product"]);
  assert.equal((await oldRead).status, "ignored", "a previous organization response cannot update the active dashboard");
  assert.deepEqual(activeProducts, ["org-b product"]);
  assert.equal(oldCommit, false);

  let finishSuperseded!: (rows: string[]) => void;
  let supersededCommit = false;
  const firstRequest = tracker.read("tasks", "account-a", "org-b", () => new Promise<string[]>((resolve) => { finishSuperseded = resolve; }), () => { supersededCommit = true; });
  const retryRequest = tracker.read("tasks", "account-a", "org-b", async () => ["new task"], () => undefined);
  assert.equal((await retryRequest).status, "success");
  finishSuperseded(["stale task"]);
  assert.equal((await firstRequest).status, "ignored", "a superseded same-scope read cannot overwrite a retry");
  assert.equal(supersededCommit, false);

  let finishPreviousAccount!: (rows: string[]) => void;
  let previousAccountCommit = false;
  const previousAccountRead = tracker.read("products", "account-a", "org-b", () => new Promise<string[]>((resolve) => { finishPreviousAccount = resolve; }), () => { previousAccountCommit = true; });
  tracker.activate("account-b", "org-b");
  const nextAccountRead = tracker.read("products", "account-b", "org-b", async () => ["account-b product"], (rows) => { activeProducts = rows; });
  assert.equal((await nextAccountRead).status, "success");
  finishPreviousAccount(["account-a product"]);
  assert.equal((await previousAccountRead).status, "ignored", "a previous account response cannot update the active dashboard when its org is unchanged");
  assert.equal(previousAccountCommit, false);
  assert.deepEqual(activeProducts, ["account-b product"]);

  let syncErrorState = emptyDashboardSourceStates();
  const syncTracker = new DashboardReadTracker((next) => { syncErrorState = next; });
  syncTracker.activate("account-c", "org-c");
  assert.equal((await syncTracker.read("tasks", "account-c", "org-c", () => { throw new Error("sync throw"); }, () => undefined)).status, "failed");
  assert.equal(syncErrorState.tasks.status, "failed", "a synchronous loader throw is also tracked");

  let healthStates = emptyDashboardSourceStates();
  const healthTracker = new DashboardReadTracker((next) => { healthStates = next; });
  healthTracker.activate("health-account-a", "health-org-a");
  const expenseRows: ExpenseRow[] = [];
  let expenseErrors = 0;
  const readExpenses = (load: () => Promise<ExpenseRow[]>) =>
    loadDashboardExpenses<ExpenseRow>(
      fakeExpensesClient("health-org-a", load),
      healthTracker,
      "health-account-a",
      "health-org-a",
      (rows) => { expenseRows.splice(0, expenseRows.length, ...rows); },
      () => { expenseErrors += 1; },
    );
  await Promise.all(dashboardReadSources.filter((source) => source !== "expenses").map((source) =>
    runDashboardSourceRead(healthTracker, source, "health-account-a", "health-org-a", async () => [{ id: source }], () => undefined, () => undefined),
  ));

  let finishExpenses!: (rows: ExpenseRow[]) => void;
  const pendingExpenseRead = readExpenses(() => new Promise((resolve) => { finishExpenses = resolve; }));
  await Promise.resolve();
  assert.equal(healthStates.expenses.status, "loading");
  assert.equal(deriveDashboardMetricStates(healthStates)["business-health"], "loading", "Business Health waits for expenses after every other source succeeds");
  const expenseLoadingCard = dashboardWidget(renderDashboard(healthStates), "business-health");
  assert.match(expenseLoadingCard, /Loading business health/);
  assert.doesNotMatch(expenseLoadingCard, /Profit Margin|Cash Flow|Score/);
  assert.ok(dashboardReadSources.filter((source) => source !== "expenses").every((source) =>
    healthStates[source].status === "successful-empty" || healthStates[source].status === "successful-populated"),
  "all non-expense sources succeeded while expenses are loading");
  finishExpenses([{ id: "expense-a", amount: 75 }]);
  assert.equal((await pendingExpenseRead).status, "success");
  assert.equal(expenseRows.length, 1);

  const expenseFailureStates = emptyDashboardSourceStates();
  const expenseFailureTracker = new DashboardReadTracker((next) => { Object.assign(expenseFailureStates, next); });
  expenseFailureTracker.activate("expense-account", "expense-org");
  await Promise.all(dashboardReadSources.filter((source) => source !== "expenses").map((source) =>
    runDashboardSourceRead(expenseFailureTracker, source, "expense-account", "expense-org", async () => [{ id: source }], () => undefined, () => undefined),
  ));
  let committedExpenses: ExpenseRow[] = [];
  const readFailedScenarioExpenses = (load: () => Promise<Array<{ id: string; amount: number }>>) =>
    loadDashboardExpenses<ExpenseRow>(
      fakeExpensesClient("expense-org", load),
      expenseFailureTracker,
      "expense-account",
      "expense-org",
      (rows) => { committedExpenses = rows; },
      () => { expenseErrors += 1; },
    );
  const initialExpenseFailure = await readFailedScenarioExpenses(async () => { throw new Error("initial expense read failed"); });
  assert.equal(initialExpenseFailure.status, "failed");
  assert.equal(expenseFailureStates.expenses.status, "failed", "initial expenses failure is tracked");
  assert.equal(expenseFailureStates.expenses.lastSuccessAt, undefined, "an initial failure has no stale success timestamp");
  const initialFailureCard = dashboardWidget(renderDashboard(expenseFailureStates), "business-health");
  assert.match(initialFailureCard, /Business health is unavailable\./);
  assert.doesNotMatch(initialFailureCard, /Profit Margin|Cash Flow|Score/);

  const emptyExpenseRetry = await readFailedScenarioExpenses(async () => []);
  assert.equal(emptyExpenseRetry.status, "success", "successful empty expenses are a valid zero input");
  assert.equal(expenseFailureStates.expenses.status, "successful-empty");
  assert.deepEqual(committedExpenses, []);
  const availableHealthCard = dashboardWidget(renderDashboard(expenseFailureStates), "business-health");
  assert.match(availableHealthCard, /Profit Margin/);
  assert.match(availableHealthCard, /Cash Flow/);
  assert.match(availableHealthCard, />Score</);

  const lastExpenseSuccess = expenseFailureStates.expenses.lastSuccessAt;
  const failedExpenseRefresh = await readFailedScenarioExpenses(async () => { throw new Error("expense refresh failed"); });
  assert.equal(failedExpenseRefresh.status, "failed");
  assert.equal(expenseFailureStates.expenses.lastSuccessAt, lastExpenseSuccess, "failed refresh retains the prior successful timestamp");
  const failedRefreshCard = dashboardWidget(renderDashboard(expenseFailureStates), "business-health");
  assert.match(failedRefreshCard, /Last successful update:/);
  assert.doesNotMatch(failedRefreshCard, /Profit Margin|Cash Flow|Score/);

  const expenseRetry = await readFailedScenarioExpenses(async () => [{ id: "expense-b", amount: 40 }]);
  assert.equal(expenseRetry.status, "success", "expense retry recovers through the shared loader wrapper");
  assert.equal(expenseFailureStates.expenses.status, "successful-populated");
  assert.equal((committedExpenses[0] as ExpenseRow | undefined)?.id, "expense-b");
  assert.ok(expenseErrors >= 2, "both initial and refresh failures are reported");

  let switchExpenseRows: ExpenseRow[] = [{ id: "org-a-old", amount: 25 }];
  const switchTracker = new DashboardReadTracker(() => undefined);
  switchTracker.activate("account-a", "org-a");
  let finishOldExpenseRead!: (rows: ExpenseRow[]) => void;
  const oldExpenseRead = loadDashboardExpenses<ExpenseRow>(
    fakeExpensesClient("org-a", () => new Promise<ExpenseRow[]>((resolve) => { finishOldExpenseRead = resolve; })),
    switchTracker,
    "account-a",
    "org-a",
    (rows) => { switchExpenseRows = rows; },
    () => assert.fail("ignored old expense response must not report an active read error"),
  );
  await Promise.resolve();
  switchExpenseRows = [];
  switchTracker.activate("account-b", "org-b");
  assert.deepEqual(switchExpenseRows, [], "account/organization switch clears previous expense data");
  const newExpenseRead = await loadDashboardExpenses<ExpenseRow>(
    fakeExpensesClient("org-b", async () => [{ id: "org-b-current", amount: 90 }]),
    switchTracker,
    "account-b",
    "org-b",
    (rows) => { switchExpenseRows = rows; },
    () => assert.fail("current account expense read should succeed"),
  );
  assert.equal(newExpenseRead.status, "success");
  finishOldExpenseRead([{ id: "org-a-late", amount: 999 }]);
  assert.equal((await oldExpenseRead).status, "ignored", "late expenses from the prior organization are ignored");
  assert.deepEqual((switchExpenseRows as ExpenseRow[]).map((row) => row.id), ["org-b-current"], "late prior-scope rows cannot overwrite current expenses");

  console.log("Dashboard read-state regressions passed: delayed, empty, partial failure, refresh failure, retry recovery, org/account scope, superseded reads, expense-aware Business Health, module summaries, and shared KPI/alert rendering.");
}

void main();
