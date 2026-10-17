// Browser/integration regressions for product catalog loading + account-switch.
// Drives REAL modules bundled from src: DashboardReadTracker,
// runDashboardSourceRead, ProductCatalogState, and useCatalogScopeGuard
// (with @/lib/supabase/client aliased to a controllable auth mock).
// The main harness mirrors src/app/page.tsx catalog wiring call-for-call
// (activate/invalidate/readDashboardSource/retry/clear-on-scope-change);
// the visits harness uses the real hook from the visits page.
// Synthetic fixture backend only — no network, no credentials.
import { readFileSync } from "node:fs";
import { chromium } from "/home/hatch/workspace/tradeos-product-search/e2e/node_modules/playwright-core/index.mjs";

const LAB_HTML = "/tmp/lab-catalog/dist/lab.html";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const viewport of [
  { width: 390, height: 844, label: "phone" },
  { width: 1440, height: 900, label: "desktop" },
]) {
  console.log(`\n===== viewport: ${viewport.label} =====`);
  const browser = await chromium.launch({ executablePath: "/opt/meta-chromium/chrome" });
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(15000);

  await page.goto("about:blank");
  const bundleJs = readFileSync("/tmp/lab-catalog/dist/lab-bundle.js", "utf8");
  await page.setContent(
    readFileSync(LAB_HTML, "utf8").replace(
      '<script src="lab-bundle.js"></script>',
      () => `<script>${bundleJs}</script>`,
    ),
  );
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 15000 });

  const main = (expr) => page.evaluate(`window.__labMain.${expr}`);
  const mainState = () => main("getState()");
  const visits = (expr) => page.evaluate(`window.__labVisits.${expr}`);

  // -- 1. Initial load: org-A catalog populates. --
  await main(`loadProfile("user-A","org-A")`);
  await page.waitForFunction(() => window.__labMain.getState().status === "successful-populated");
  let s = await mainState();
  check(`[${viewport.label}] initial load populates org-A catalog`, s.products.join(",") === "Apple,Banana", s.products.join(","));

  // -- 2. Failed refresh with previously loaded products: banner + stale list, draft preserved. --
  await main(`addDraft("Apple x2")`);
  await main(`setBackend("org-A",{fail:true})`);
  await main(`refresh()`);
  await page.waitForFunction(() => window.__labMain.getState().status === "failed");
  s = await mainState();
  const banner = await page.getByTestId("main-harness").getByRole("alert").textContent();
  check(`[${viewport.label}] failure shows banner, not silent`, /Couldn't refresh/.test(banner ?? ""), banner?.slice(0, 60));
  check(`[${viewport.label}] stale products remain listed`, s.products.join(",") === "Apple,Banana");
  check(`[${viewport.label}] draft preserved on same-scope failure`, s.draftLines.join(",") === "Apple x2");
  const retryVisible = await page.getByTestId("main-harness").getByRole("button", { name: "Retry" }).isVisible();
  check(`[${viewport.label}] retry offered on failure`, retryVisible);

  // -- 3. Retry succeeds: fresh catalog, banner gone, draft still preserved. --
  await main(`setBackend("org-A",{fail:false,products:["Apple","Banana","Cherry"]})`);
  await page.getByTestId("main-harness").getByRole("button", { name: "Retry" }).click();
  await page.waitForFunction(() => window.__labMain.getState().status === "successful-populated" && window.__labMain.getState().products.includes("Cherry"));
  s = await mainState();
  check(`[${viewport.label}] retry loads fresh catalog`, s.products.includes("Cherry"), s.products.join(","));
  check(`[${viewport.label}] banner cleared after retry`, (await page.getByTestId("main-harness").getByRole("alert").count()) === 0);
  check(`[${viewport.label}] draft preserved across retry`, s.draftLines.join(",") === "Apple x2");

  // -- 4. Account switch during an outstanding request: immediate clear, late response ignored. --
  await main(`setBackend("org-A",{delayMs:1200,products:["Apple","Banana","Cherry"]})`);
  await main(`setBackend("org-B",{delayMs:400,products:["Carrot"]})`);
  await main(`refresh()`); // outstanding slow org-A read (same scope)
  await sleep(100);
  await main(`loadProfile("user-A","org-B")`); // switch org mid-flight
  await sleep(100);
  s = await mainState();
  check(`[${viewport.label}] org switch clears previous catalog immediately`, s.products.length === 0, s.products.join(",") || "(empty)");
  await page.waitForFunction(() => window.__labMain.getState().status === "successful-populated" && window.__labMain.getState().org === "org-B");
  s = await mainState();
  check(`[${viewport.label}] new org catalog loads`, s.products.join(",") === "Carrot");
  check(`[${viewport.label}] draft cleared on org switch`, s.draftLines.length === 0);
  await sleep(1400); // org-A's late response would arrive now
  s = await mainState();
  check(`[${viewport.label}] late old-scope response ignored`, s.products.join(",") === "Carrot", s.products.join(","));

  // -- 5. Logout during loading: cleared, late response ignored. --
  await main(`loadProfile("user-A","org-A")`);
  await page.waitForFunction(() => window.__labMain.getState().status === "successful-populated");
  await main(`setBackend("org-A",{delayMs:1200})`);
  await main(`refresh()`);
  await sleep(100);
  await main(`logout()`);
  s = await mainState();
  check(`[${viewport.label}] logout clears catalog immediately`, s.products.length === 0 && s.status === "not-loaded", `${s.status}`);
  await sleep(1400);
  s = await mainState();
  check(`[${viewport.label}] late response after logout ignored`, s.products.length === 0 && s.status === "not-loaded");

  // -- 6. Genuinely empty catalog. --
  await main(`setBackend("org-B",{delayMs:0,fail:false,products:[]})`);
  await main(`loadProfile("user-A","org-B")`);
  await page.waitForFunction(() => window.__labMain.getState().status === "successful-empty");
  const emptyText = await page.getByTestId("main-harness").textContent();
  check(`[${viewport.label}] empty catalog shows empty state`, /No products added yet/.test(emptyText ?? ""));

  // -- 7. Visits wiring: real useCatalogScopeGuard + mocked auth. --
  // (reset backend: the main-harness scenarios above mutated org-A's delay/products)
  await visits(`setBackend("org-A",{delayMs:0,fail:false,products:["Apple","Banana"]})`);
  await visits(`setBackend("org-B",{delayMs:0,fail:false,products:["Carrot"]})`);
  await visits(`loadProducts("org-A")`);
  await page.waitForFunction(() => window.__labVisits.getState().products.length === 2);
  await visits(`addItem("Apple x1")`);
  await visits(`fireAuth("SIGNED_OUT", null)`);
  await sleep(150);
  let v = await page.evaluate(() => window.__labVisits.getState());
  check(`[${viewport.label}] visits: sign-out clears products+items while mounted`, v.products.length === 0 && v.items.length === 0, JSON.stringify(v));

  // -- 8. Visits: sign-in as another user, then token refresh must NOT clear. --
  await visits(`fireAuth("SIGNED_IN","user-B")`);
  await visits(`loadProducts("org-B")`);
  await page.waitForFunction(() => window.__labVisits.getState().products.length === 1);
  await visits(`addItem("Carrot x3")`);
  await visits(`fireAuth("TOKEN_REFRESHED","user-B")`);
  await sleep(150);
  v = await page.evaluate(() => window.__labVisits.getState());
  check(`[${viewport.label}] visits: token refresh preserves catalog+drafts`, v.products.join(",") === "Carrot" && v.items.join(",") === "Carrot x3", JSON.stringify(v));

  // -- 9. Visits: late response after scope invalidation ignored. --
  await visits(`setBackend("org-B",{delayMs:1000,products:["Carrot"]})`);
  const loadPromise = page.evaluate(() => window.__labVisits.loadProducts("org-B"));
  await sleep(100);
  await visits(`fireAuth("SIGNED_IN","user-C")`); // scope change mid-flight
  const loadResult = await loadPromise;
  v = await page.evaluate(() => window.__labVisits.getState());
  check(`[${viewport.label}] visits: late old-scope load ignored`, loadResult === "ignored" && v.products.length === 0, `${loadResult} ${JSON.stringify(v)}`);

  check(`[${viewport.label}] zero page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
if (failed.length > 0) process.exit(1);
