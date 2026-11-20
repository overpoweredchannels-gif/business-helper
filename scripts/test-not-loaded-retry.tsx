import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "../src/components/dashboard/DashboardView";
import { BusinessHealthCard } from "../src/components/dashboard/widgets/BusinessHealthCard";
import { KPICard } from "../src/components/dashboard/widgets/KPICard";
import {
  DashboardReadTracker,
  dashboardReadSources,
  deriveDashboardMetricLastSuccessAt,
  deriveDashboardMetricStates,
  emptyDashboardSourceStates,
  shouldRetryAuthForNotLoadedReads,
  type DashboardSourceStates,
} from "../src/lib/dashboard/data-read-state";

/**
 * Slice 3 (HYBRID) — "Not loaded" Retry fix + dead-code delete + honest
 * error page. Rules:
 *  1. `shouldRetryAuthForNotLoadedReads` is true only when a source is
 *     "not-loaded" AND no profile is loaded (tracker never activated).
 *  2. The tracker ignores reads until activated — the mechanism that made
 *     Retry a no-op when the profile load failed (B5).
 *  3. page.tsx: handleLogin/handleSignUp are gone (dead code), and no
 *     "Logged in" message can appear when the profile failed to load.
 *  4. page.tsx loadProfile: a profile-load failure of ANY kind (not just
 *     network) falls back to the cached identity on desktop.
 *  5. page.tsx checkAuthUser: the getSession-error branch falls back to
 *     the cached identity on desktop.
 *  6. page.tsx retryFailedDashboardReads re-runs checkAuthUser when a
 *     source is "not-loaded" with no profile loaded.
 *  7. Cards show a Retry button for "not-loaded" reads (KPICard,
 *     BusinessHealthCard, DashboardView needs-attention tasks), and the
 *     dashboard renders one when every source is "not-loaded".
 *  8. electron/main.ts error page: no "will open automatically" promise;
 *     honest text + a Retry button that re-probes the server URL.
 */

function sectionAfter(source: string, marker: string, length: number): string {
  const index = source.indexOf(marker);
  assert.ok(index >= 0, `expected marker ${marker}`);
  return source.slice(index, index + length);
}

function renderDashboardAllNotLoaded(): string {
  const states = emptyDashboardSourceStates();
  return renderToStaticMarkup(
    <DashboardView
      userName="Test Owner"
      metricReadStates={deriveDashboardMetricStates(states)}
      metricLastSuccessfulAt={deriveDashboardMetricLastSuccessAt(states)}
      onRetryFailedReads={() => undefined}
      todaySales={{ value: "PKR 1,250.00" }}
      todayProfit={{ value: "PKR 375.00" }}
      inventoryValue={{ value: "PKR 4,000.00" }}
      healthMetrics={[{ label: "Cash Flow", value: "PKR 600.00", status: "good" }]}
      outstandingReceivables={{ value: "PKR 800.00" }}
      outstandingPayables={{ value: "PKR 200.00" }}
      lowStockAlerts={{ value: "2", count: 2 }}
      pendingApprovals={1}
      invoicesDue={2}
      paymentsDue={3}
      lowStockItems={4}
      customersToFollowUp={5}
      expiringProducts={6}
      smartModules={[]}
      droppedCards={[]}
      onKPIClick={() => undefined}
    />,
  );
}

async function main() {
  // Rule 1 — the Retry routing decision.
  const allNotLoaded = emptyDashboardSourceStates();
  assert.equal(
    shouldRetryAuthForNotLoadedReads(allNotLoaded, false),
    true,
    "all sources not-loaded + no profile → Retry re-runs checkAuthUser",
  );
  assert.equal(
    shouldRetryAuthForNotLoadedReads(allNotLoaded, true),
    false,
    "all sources not-loaded + profile loaded → normal failed-only retry (transient state)",
  );
  const allFailed: DashboardSourceStates = Object.fromEntries(
    dashboardReadSources.map((source) => [source, { status: "failed" }]),
  ) as DashboardSourceStates;
  assert.equal(
    shouldRetryAuthForNotLoadedReads(allFailed, false),
    false,
    "all sources failed + no profile → failed-only retry, no re-auth",
  );
  const allLoaded: DashboardSourceStates = Object.fromEntries(
    dashboardReadSources.map((source) => [source, { status: "successful-populated" }]),
  ) as DashboardSourceStates;
  assert.equal(
    shouldRetryAuthForNotLoadedReads(allLoaded, false),
    false,
    "all sources loaded + no profile → no re-auth",
  );
  const oneNotLoaded: DashboardSourceStates = {
    ...allLoaded,
    products: { status: "not-loaded" },
  };
  assert.equal(
    shouldRetryAuthForNotLoadedReads(oneNotLoaded, false),
    true,
    "one source not-loaded + no profile → Retry re-runs checkAuthUser",
  );

  // Rule 2 — the tracker ignores reads until activated.
  let states = emptyDashboardSourceStates();
  const tracker = new DashboardReadTracker((next) => {
    states = next;
  });
  assert.equal(
    tracker.begin("products", "account-a", "org-a"),
    null,
    "begin() before activate() is ignored — a Retry that re-ran reads would do nothing",
  );
  assert.equal(states.products.status, "not-loaded", "an ignored read leaves the source not-loaded");
  tracker.activate("account-a", "org-a");
  assert.notEqual(tracker.begin("products", "account-a", "org-a"), null, "begin() works after activate()");
  assert.equal(states.products.status, "loading", "an accepted read publishes loading");
  tracker.invalidate();
  assert.equal(
    tracker.begin("products", "account-a", "org-a"),
    null,
    "begin() after invalidate() is ignored again",
  );
  assert.equal(states.products.status, "not-loaded", "invalidate() resets every source to not-loaded");

  // Rule 3 — dead code deleted; no "Logged in" message path remains.
  const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /const handleLogin\s*=/, "handleLogin dead code is deleted");
  assert.doesNotMatch(page, /const handleSignUp\s*=/, "handleSignUp dead code is deleted");
  assert.doesNotMatch(page, /page\.loggedIn/, "no 'Logged in' message can appear when the profile failed to load");
  assert.doesNotMatch(page, /const \[email, setEmail\]|const \[password, setPassword\]|const \[fullName, setFullName\]|const \[organizationName, setOrganizationName\]/, "the dead login form state is deleted too");

  // Rule 4 — loadProfile falls back to the cached identity on ANY error kind.
  const profileErrorBranch = sectionAfter(page, "if (profileError) {", 2000);
  assert.ok(
    profileErrorBranch.includes("readIdentityCacheAsync") && profileErrorBranch.includes("restoreCachedIdentity"),
    "loadProfile profileError branch restores the cached identity",
  );
  assert.doesNotMatch(
    profileErrorBranch,
    /isNetworkError\(profileError\)/,
    "the cached fallback is NOT gated on network errors anymore",
  );

  // Rule 5 — checkAuthUser getSession-error branch falls back to the cache.
  const sessionErrorBranch = sectionAfter(page, "if (sessionError) {", 1600);
  assert.ok(
    sessionErrorBranch.includes("readIdentityCacheAsync") && sessionErrorBranch.includes("restoreCachedIdentity"),
    "checkAuthUser sessionError branch restores the cached identity",
  );

  // Rule 6 — Retry re-runs checkAuthUser when a source is not-loaded.
  const retryHandler = sectionAfter(page, "const retryFailedDashboardReads", 1400);
  assert.ok(
    retryHandler.includes("shouldRetryAuthForNotLoadedReads"),
    "retryFailedDashboardReads consults the not-loaded decision",
  );
  assert.ok(retryHandler.includes("checkAuthUser()"), "retryFailedDashboardReads re-runs checkAuthUser");

  // Rule 7 — cards offer Retry for "not-loaded" reads.
  const kpiCard = readFileSync(new URL("../src/components/dashboard/widgets/KPICard.tsx", import.meta.url), "utf8");
  assert.ok(
    kpiCard.includes('readStatus === "not-loaded"') && kpiCard.includes("dashboard.retryReads"),
    "KPICard renders Retry for not-loaded reads",
  );
  const healthCard = readFileSync(
    new URL("../src/components/dashboard/widgets/BusinessHealthCard.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    healthCard.includes('readStatus === "not-loaded"') && healthCard.includes("dashboard.retryReads"),
    "BusinessHealthCard renders Retry for not-loaded reads",
  );
  const dashboardView = readFileSync(
    new URL("../src/components/dashboard/DashboardView.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    dashboardView.includes('task.status === "not-loaded"'),
    "DashboardView needs-attention tasks render Retry for not-loaded reads",
  );
  const kpiNotLoaded = renderToStaticMarkup(
    <KPICard title="Today's sales" value="—" readStatus="not-loaded" onRetry={() => undefined} />,
  );
  assert.ok(kpiNotLoaded.includes("Retry dashboard reads"), "KPICard shows the Retry button when not-loaded");
  const kpiLoaded = renderToStaticMarkup(
    <KPICard title="Today's sales" value="PKR 100.00" readStatus="successful-populated" onRetry={() => undefined} />,
  );
  assert.doesNotMatch(kpiLoaded, /Retry dashboard reads/, "KPICard shows no Retry button once the read succeeds");
  const healthNotLoaded = renderToStaticMarkup(
    <BusinessHealthCard
      score={0}
      metrics={[{ label: "Cash Flow", value: "—", status: "good" }]}
      readStatus="not-loaded"
      onRetry={() => undefined}
    />,
  );
  assert.ok(healthNotLoaded.includes("Retry dashboard reads"), "BusinessHealthCard shows the Retry button when not-loaded");
  const dashboardMarkup = renderDashboardAllNotLoaded();
  assert.ok(dashboardMarkup.includes("Not loaded"), "the dashboard shows Not loaded when every source is not-loaded");
  assert.ok(
    dashboardMarkup.includes("Retry dashboard reads"),
    "the dashboard offers Retry when every source is not-loaded",
  );

  // Rule 8 — honest launch-failure page, no auto-open promise.
  const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /will open automatically|open automatically/i, "the error page promises no automatic open");
  assert.ok(main.includes('id="aankh-retry"'), "the error page has a Retry button");
  assert.ok(main.includes("mode:'no-cors'"), "Retry re-probes the server with a no-cors fetch");
  assert.ok(main.includes("window.location.href=appUrl"), "Retry opens the app when the server answers");
  assert.ok(main.includes("Still not responding"), "Retry reports honestly when the server still does not answer");
  const errorPageCallSites = main.match(/errorHtml\(lastServerError \|\| null, pendingAppUrl\)/g) ?? [];
  assert.equal(errorPageCallSites.length, 2, "both error-page call sites pass the server URL so Retry can probe it");

  console.log(
    "Slice 3 not-loaded Retry passed: auth-retry routing, tracker ignore-until-activated, dead login code deleted, any-kind cached fallback in loadProfile + getSession-error branch, Retry re-runs checkAuthUser, Retry buttons for not-loaded cards, honest error page with probing Retry.",
  );
}

void main();
