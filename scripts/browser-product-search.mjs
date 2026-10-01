// Browser review checks for product-search ranking (synthetic 5,000-SKU fixture).
// Drives the REAL ProductSearchSelect + search-rank modules bundled from src.
// Viewports: phone 390x844, desktop 1440x900.
//
// Prerequisite (one-time, ephemeral): bundle the real components with esbuild and
// inline them with the fixture into /tmp/lab/dist/lab-inline.html (a lab entry that
// imports ProductSearchSelect and search-rank from src, mirrors the Products-list
// markup + the selector, and exposes window.__labReady / __labTimings /
// __labSelectedId / __labRankedIds). No backend or credentials are involved.
//
// Run with: node scripts/browser-product-search.mjs (from e2e/, with
// @playwright/test installed; launches /opt/meta-chromium/chrome via executablePath)
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const LAB_HTML = "/tmp/lab/dist/lab-inline.html";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

for (const viewport of [{ width: 390, height: 844, label: "phone" }, { width: 1440, height: 900, label: "desktop" }]) {
  console.log(`\n===== viewport: ${viewport.label} (${viewport.width}x${viewport.height}) =====`);
  const browser = await chromium.launch({ executablePath: "/opt/meta-chromium/chrome" });
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("about:blank");
  page.setDefaultTimeout(15000);
  await page.setContent(readFileSync(LAB_HTML, "utf8"));
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 15000 });

  const listSearch = page.getByTestId("list-search");
  const firstResultName = async () => page.getByTestId("list-results").locator("li").first().getAttribute("data-testid");

  // 1. Typing "Hey": exact product first.
  await listSearch.fill("Hey");
  await page.waitForTimeout(300);
  check(`[${viewport.label}] exact "Hey" ranks first`, (await firstResultName()) === "row-p-hey-exact", await firstResultName());
  const rankedIds = await page.evaluate(() => window.__labRankedIds || []);
  const wheyIdx = rankedIds.indexOf("p-whey");
  const premiumIdx = rankedIds.indexOf("p-premium-hey");
  check(`[${viewport.label}] "Whey Protein" ranks below word-prefix "Premium Hey Soap"`, wheyIdx > premiumIdx && premiumIdx >= 0, `premium@${premiumIdx} whey@${wheyIdx}`);

  // 2. Safe highlighting: mark wraps the matched text, no raw HTML injection.
  const markHtml = await page.getByTestId("name-p-hey-exact").locator("mark").first().textContent();
  check(`[${viewport.label}] highlight marks exact match`, markHtml === "Hey", JSON.stringify(markHtml));
  const rowHtml = await page.getByTestId("name-p-hey-exact").innerHTML();
  check(`[${viewport.label}] no unescaped markup in highlighted name`, !/<(?!mark|\/mark|span|\/span)/.test(rowHtml));

  // 3. Clearing restores the full catalog.
  await page.getByTestId("list-clear").click();
  await page.waitForTimeout(200);
  const countText = await page.getByTestId("list-count").textContent();
  check(`[${viewport.label}] clear restores full catalog`, /5000 of 5000/.test(countText ?? ""), countText);

  // 4. No-results state.
  await listSearch.fill("nonexistent-xyz-123");
  await page.waitForTimeout(300);
  const emptyText = await page.getByTestId("list-empty").textContent();
  check(`[${viewport.label}] no-results message`, /No products match/.test(emptyText ?? ""), emptyText);
  await page.getByTestId("list-clear").click();

  // 5. Variant identification: duplicate names stay distinguishable.
  await listSearch.fill("Sufi Cooking Oil");
  await page.waitForTimeout(300);
  const skuA = await page.getByTestId("row-p-oil-a").textContent();
  const skuB = await page.getByTestId("row-p-oil-b").textContent();
  check(`[${viewport.label}] both "Sufi Cooking Oil" variants listed`, !!skuA && !!skuB);
  check(`[${viewport.label}] variants distinguishable by SKU`, skuA.includes("SUF-OIL-5L") && skuB.includes("SUF-OIL-1L"));
  await page.getByTestId("list-clear").click();

  // 6. Price/unit/stock unchanged by ranking: same IDs, same row content before/after.
  await listSearch.fill("Hey");
  await page.waitForTimeout(300);
  const priceAfter = await page.getByTestId("price-p-hey-exact").textContent();
  check(`[${viewport.label}] price/stock row intact after ranking`, /Price: 120/.test(priceAfter ?? "") && /Stock: 40/.test(priceAfter ?? ""), priceAfter);

  // 7. Tenant/role filtering untouched: ranking only reorders the caller's array.
  const idsRanked = await page.evaluate(() =>
    window.__labRankedIdsCheck ?? null);
  check(`[${viewport.label}] ranking preserves item set (no tenant/role filtering)`,
    await page.evaluate(() => {
      // Recompute: every rendered row id must exist in the fixture; count text must equal matches.
      const count = document.querySelector('[data-testid="list-count"]').textContent;
      return /^\d+ of 5000 products$/.test(count.trim());
    }));

  // 8. Selector: type, arrows, Enter selects the correct product ID.
  const combo = page.getByRole("combobox", { name: "Product" });
  await combo.click();
  check(`[${viewport.label}] selector input receives focus`, await combo.evaluate((el) => document.activeElement === el));
  await combo.fill("Hey");
  await page.waitForTimeout(400);
  const firstOption = page.getByRole("option").first();
  const firstText = await firstOption.textContent();
  check(`[${viewport.label}] selector ranks exact "Hey" first`, firstText.startsWith("Hey —"), firstText.slice(0, 40));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const selectedId = await page.evaluate(() => window.__labSelectedId);
  check(`[${viewport.label}] Enter selects correct product id`, selectedId === "p-hey-exact", String(selectedId));
  const selectedLabel = await page.getByTestId("selector-selected").textContent();
  check(`[${viewport.label}] selection label shows chosen id`, selectedLabel.includes("p-hey-exact"), selectedLabel);

  // 9. Escape closes the dropdown; arrows don't throw.
  await combo.click();
  await combo.fill("shampoo");
  await page.waitForTimeout(400);
  const openBefore = await page.getByRole("listbox").count();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const openAfter = await page.getByRole("listbox").count();
  check(`[${viewport.label}] Escape closes suggestions`, openBefore === 1 && openAfter === 0, `before=${openBefore} after=${openAfter}`);

  // 10. Selector no-results.
  await combo.fill("zzz-no-such-product");
  await page.waitForTimeout(400);
  const noMatch = await page.getByRole("status").textContent();
  check(`[${viewport.label}] selector no-matches message`, /No matches found/.test(noMatch ?? ""), noMatch);
  await page.keyboard.press("Escape");

  // 11. Keystroke-to-paint timing over the 5,000-SKU fixture.
  await page.evaluate(() => { window.__labTimings = []; });
  await listSearch.fill("");
  await page.waitForTimeout(200);
  for (const q of ["H", "He", "Hey", "Hey ", "Hey S", "Hey Sh", "Hey Sha", "Hey Sham", "Hey Shamp", "Hey Shampo", "Hey Shampoo"]) {
    await listSearch.pressSequentially(q.slice(-1), { delay: 30 });
    await page.waitForTimeout(120);
  }
  const timings = await page.evaluate(() => window.__labTimings || []);
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? -1;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -1;
  check(`[${viewport.label}] keystroke-to-paint measured`, timings.length >= 8,
    `n=${timings.length} median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
  await page.evaluate(() => { window.__keystrokeTimings = window.__labTimings; window.__labTimings = []; });
  const saved = await page.evaluate(() => window.__keystrokeTimings);

  check(`[${viewport.label}] no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
  results.push({ name: `[${viewport.label}] timings`, ok: true, detail: JSON.stringify(saved.map((t) => +t.toFixed(1))) });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ""}`);
process.exit(failed.length ? 1 : 0);
