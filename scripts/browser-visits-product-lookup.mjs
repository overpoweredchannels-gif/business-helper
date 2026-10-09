// Browser/integration regressions for the visits product lookup.
// Drives the REAL VisitProductLookup component bundled from src (with the real
// shared ranking helper). searchProducts delegates to a mock that implements
// the /api/products/list contract (search/offset/limit/nextOffset) against a
// synthetic 1,500-product catalog. No network, no credentials.
import { readFileSync } from "node:fs";
import { chromium } from "/home/hatch/workspace/tradeos-product-search/e2e/node_modules/playwright-core/index.mjs";

const LAB_HTML = "/tmp/lab-visits/dist/lab.html";
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
  const bundleJs = readFileSync("/tmp/lab-visits/dist/lab-bundle.js", "utf8");
  await page.setContent(
    readFileSync(LAB_HTML, "utf8").replace(
      '<script src="lab-bundle.js"></script>',
      () => `<script>${bundleJs}</script>`,
    ),
  );
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 15000 });

  const searchBox = page.getByRole("combobox");
  const typeSearch = async (text) => {
    await searchBox.fill(text);
    await sleep(700); // debounce 300ms + mock latency
  };
  const resultIds = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="visit-result-"]')).map((el) =>
        el.getAttribute("data-testid").replace("visit-result-", ""),
      ),
    );

  // -- 1. Product beyond position 1,000 is found (old code only saw the first 1,000 rows). --
  await page.evaluate(() => window.__lab.mockApi.reset());
  await typeSearch("DEEP-1200");
  check(`[${viewport.label}] product beyond position 1000 found`, await page.getByTestId("visit-result-p-deep").isVisible());

  // -- 2. Typing and clearing search. --
  await typeSearch("bulk item 5");
  const bulkCount = (await resultIds()).length;
  check(`[${viewport.label}] typing shows paginated results`, bulkCount === 25, `${bulkCount} rows`);
  await page.getByRole("button", { name: "Clear search" }).click();
  await sleep(200);
  check(`[${viewport.label}] clearing search clears results`, (await resultIds()).length === 0 && (await searchBox.inputValue()) === "");

  // -- 3. Selecting returns the correct product ID and price. --
  await typeSearch("WID-EXACT");
  const firstId = (await resultIds())[0];
  check(`[${viewport.label}] exact SKU ranks first`, firstId === "p-exact", firstId);
  await page.getByTestId("visit-result-p-exact").click();
  const draft = await page.getByTestId("draft-p-exact").textContent();
  check(`[${viewport.label}] correct product added with correct price`, /Special Widget/.test(draft ?? "") && /349\.99/.test(draft ?? ""), draft);

  // -- 3b. Keyboard selection: ArrowDown + Enter adds the highlighted product. --
  await typeSearch("DEEP-1200");
  await searchBox.press("ArrowDown");
  await searchBox.press("Enter");
  const draftDeep = await page.getByTestId("draft-p-deep").textContent();
  check(`[${viewport.label}] keyboard selection adds product`, /Deep Catalog Widget/.test(draftDeep ?? ""), draftDeep);

  // -- 4. Rapid searches with reversed response order: the stale slow response is ignored. --
  await page.evaluate(() => {
    window.__lab.mockApi.reset();
    window.__lab.mockApi.setDelayForQuery("wid", 900);
  });
  await searchBox.fill("wid");
  await sleep(500); // debounce fired; slow request in flight
  await searchBox.fill("wid-exact");
  await sleep(600); // fast request resolved
  let ids = await resultIds();
  check(`[${viewport.label}] fast latest search wins immediately`, ids.length === 1 && ids[0] === "p-exact", ids.join(","));
  await sleep(1200); // slow stale response would arrive now
  ids = await resultIds();
  check(`[${viewport.label}] reversed-order stale response ignored`, ids.length === 1 && ids[0] === "p-exact", ids.join(","));
  await page.evaluate(() => window.__lab.mockApi.reset());

  // -- 5. Failure shows error + Retry; draft items preserved; retry recovers. --
  await page.evaluate(() => window.__lab.mockApi.setFailQuery("noresults", true));
  await typeSearch("noresults");
  const alertVisible = await page.getByRole("alert").isVisible();
  check(`[${viewport.label}] failure shows error state`, alertVisible);
  const retryVisible = await page.getByRole("button", { name: "Retry" }).isVisible();
  check(`[${viewport.label}] failure offers Retry`, retryVisible);
  const draftsBefore = await page.evaluate(() => window.__lab.getItems().length);
  check(`[${viewport.label}] draft items preserved on search failure`, draftsBefore === 2, `${draftsBefore} drafts`);
  await page.evaluate(() => window.__lab.mockApi.setFailQuery("noresults", false));
  await page.getByRole("button", { name: "Retry" }).click();
  await sleep(700);
  check(`[${viewport.label}] retry recovers and shows no-results state`, /No products found/.test((await page.textContent("main")) ?? ""));
  const draftsAfter = await page.evaluate(() => window.__lab.getItems().length);
  check(`[${viewport.label}] draft items preserved across retry`, draftsAfter === 2);

  // -- 6. Pagination via the offset/nextOffset contract. --
  await typeSearch("bulk");
  const page1 = await resultIds();
  check(`[${viewport.label}] first page has 25 rows`, page1.length === 25, `${page1.length}`);
  await page.getByRole("button", { name: "Show more" }).click();
  await sleep(700);
  const page2 = await resultIds();
  check(`[${viewport.label}] show more appends second page`, page2.length === 50 && new Set(page2).size === 50, `${page2.length}`);

  // -- 7. Account/org scope change during an outstanding search: stale response ignored. --
  await page.evaluate(() => window.__lab.mockApi.setDelayMs(900));
  await searchBox.fill("bulk item 42");
  await sleep(500); // debounce fired; slow request in flight
  await page.evaluate(() => window.__lab.simulateScopeChange());
  await sleep(1200); // stale response would arrive now
  const staleIds = await resultIds();
  check(`[${viewport.label}] scope change drops in-flight search`, staleIds.length === 0, `${staleIds.length} rows`);
  await page.evaluate(() => window.__lab.mockApi.setDelayMs(0));
  await typeSearch("DEEP-1200");
  check(`[${viewport.label}] search works after scope change`, await page.getByTestId("visit-result-p-deep").isVisible());

  check(`[${viewport.label}] zero page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
if (failed.length > 0) process.exit(1);
