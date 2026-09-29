import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "../src/components/dashboard/DashboardView";
import {
  DashboardReadTracker,
  deriveDashboardMetricLastSuccessAt,
  deriveDashboardMetricStates,
  emptyDashboardSourceStates,
  type DashboardSourceStates,
} from "../src/lib/dashboard/data-read-state";

function renderDashboard(states: DashboardSourceStates, onRetry = () => undefined) {
  return renderToStaticMarkup(
    <DashboardView
      userName="Test Owner"
      metricReadStates={deriveDashboardMetricStates(states)}
      metricLastSuccessfulAt={deriveDashboardMetricLastSuccessAt(states)}
      onRetryFailedReads={onRetry}
      todaySales={{ value: "PKR 1,250.00" }}
      todayProfit={{ value: "PKR 375.00" }}
      inventoryValue={{ value: "PKR 4,000.00" }}
      outstandingReceivables={{ value: "PKR 800.00" }}
      outstandingPayables={{ value: "PKR 200.00" }}
      lowStockAlerts={{ value: "2", count: 2 }}
      pendingApprovals={1}
      invoicesDue={2}
      paymentsDue={3}
      lowStockItems={4}
      customersToFollowUp={5}
      expiringProducts={6}
      onKPIClick={() => undefined}
    />,
  );
}

async function succeed<T>(tracker: DashboardReadTracker, states: DashboardSourceStates, source: keyof DashboardSourceStates, account: string, org: string, data: T[]) {
  const result = await tracker.read(source, account, org, async () => data, (rows) => {
    states[source] = { status: rows.length ? "successful-populated" : "successful-empty", rowCount: rows.length, lastSuccessAt: "2026-09-30T08:00:00.000Z" };
  });
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
  const healthCard = failedMarkup.match(/data-dashboard-widget="business-health"[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
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

  console.log("Dashboard read-state regressions passed: delayed, empty, partial failure, refresh failure, retry recovery, org/account scope, superseded reads, and shared KPI/alert rendering.");
}

void main();
