// Browser/integration regressions for the global search suggestion panels.
// Bundles the REAL components from src (SearchSuggestField, ProductSearchSelect,
// Header) with the real shared ranking helper, driven against synthetic
// fixtures (5,022 products, 9 customers). No network, no credentials.
//
// Build: esbuild bundles scripts/lab-global-search-suggestions.entry.tsx;
// postcss+tailwind compiles the real design tokens for layout measurements.
//
// Portability: repository-relative paths; override with:
//   SUGGEST_LAB_BROWSER  - browser executable (default: $CHROME-ish discovery)
//   SUGGEST_LAB_OUT      - output dir (default: os.tmpdir()/lab-suggest/dist)
//   SUGGEST_LAB_PLAYWRIGHT - path to a playwright-core index.mjs
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SUGGEST_LAB_ROOT || path.resolve(SCRIPT_DIR, "..");
const DIST = process.env.SUGGEST_LAB_OUT || path.join(os.tmpdir(), "lab-suggest", "dist");
mkdirSync(DIST, { recursive: true });

// --- playwright-core resolution: explicit env, bare import, legacy fallback ---
async function loadPlaywright() {
  const candidates = [];
  if (process.env.SUGGEST_LAB_PLAYWRIGHT) candidates.push(process.env.SUGGEST_LAB_PLAYWRIGHT);
  candidates.push("playwright-core");
  candidates.push("/home/hatch/workspace/tradeos-product-search/e2e/node_modules/playwright-core/index.mjs");
  let lastError;
  for (const c of candidates) {
    try {
      return await import(c);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Could not load playwright-core. Set SUGGEST_LAB_PLAYWRIGHT. Last error: ${lastError}`);
}
const { chromium } = await loadPlaywright();

// --- browser executable discovery: env, platform defaults, then playwright's bundled chromium ---
function findBrowser() {
  if (process.env.SUGGEST_LAB_BROWSER) return process.env.SUGGEST_LAB_BROWSER;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : null,
    ].filter(Boolean);
    for (const c of candidates) if (existsSync(c)) return c;
    return undefined; // playwright's bundled chromium
  }
  for (const c of ["/opt/meta-chromium/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

console.log("building lab bundle...");
await build({
  entryPoints: [path.join(ROOT, "scripts", "lab-global-search-suggestions.entry.tsx")],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  alias: { "@": path.join(ROOT, "src") },
  outfile: path.join(DIST, "lab-bundle.js"),
  logLevel: "warning",
});

console.log("compiling lab css...");
const css = await postcss([tailwindcss()]).process(
  `@import "${path.join(ROOT, "src", "app", "globals.css")}";\n@source "${path.join(ROOT, "src")}";\n@source "${path.join(ROOT, "scripts", "lab-global-search-suggestions.entry.tsx")}";`,
  { from: path.join(DIST, "lab.css") },
);
writeFileSync(path.join(DIST, "lab.css"), css.css);

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${readFileSync(path.join(DIST, "lab-bundle.js"), "utf8")}</script></body></html>`;
writeFileSync(path.join(DIST, "lab.html"), html);
const labHtml = readFileSync(path.join(DIST, "lab.html"), "utf8");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perf = {};
const executablePath = findBrowser();
console.log(`browser: ${executablePath ?? "(playwright bundled chromium)"}`);

for (const viewport of [
  { width: 390, height: 844, label: "phone", mobile: true },
  { width: 1440, height: 900, label: "desktop", mobile: false },
]) {
  console.log(`\n===== viewport: ${viewport.label} =====`);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.mobile,
    isMobile: viewport.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(15000);

  const mountStart = Date.now();
  await page.goto("about:blank");
  await page.setContent(labHtml);
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 30000 });
  perf[`${viewport.label}.mountMs`] = Date.now() - mountStart;

  const prodScope = page.locator('[data-testid="lab-products"]');
  const prodCombo = prodScope.getByRole("combobox", { name: "Lab products search" });
  const custScope = page.locator('[data-testid="lab-customers"]');
  const custCombo = custScope.getByRole("combobox", { name: "Lab customers search" });
  const prodOptions = () => prodScope.getByRole("option");
  const prodIds = () =>
    prodOptions().evaluateAll((els) => els.map((el) => el.getAttribute("data-suggestion-id")));
  const prodListboxCount = () => prodScope.getByRole("listbox").count();

  // -- 1. Mount: no popover before typing. --
  check(`[${viewport.label}] no popover before typing`, (await prodListboxCount()) === 0);

  // -- 2. Typing "F" shows the compact ranked panel (timed). --
  const typeStart = Date.now();
  await prodCombo.fill("F");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lab-products"] [role="option"]').length > 0);
  perf[`${viewport.label}.typeMs`] = Date.now() - typeStart;
  const idsF = await prodIds();
  check(`[${viewport.label}] "F" panel is compact (8 suggestions)`, idsF.length === 8, `${idsF.length}`);
  check(`[${viewport.label}] "F" name-prefix first`, idsF[0] === "p-fortune", idsF.slice(0, 4).join(","));

  // -- 2b. Tier order on the small customer fixture: name prefix < word prefix.
  await custCombo.fill("Far");
  await sleep(150);
  const idsFar = await custScope
    .getByRole("option")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-suggestion-id")));
  check(
    `[${viewport.label}] customer "Far": name prefix before word prefix`,
    idsFar.indexOf("c-farhan") !== -1 && idsFar.indexOf("c-word") !== -1 && idsFar.indexOf("c-farhan") < idsFar.indexOf("c-word"),
    idsFar.join(","),
  );
  await page.keyboard.press("Escape");
  await prodCombo.fill("FZ");
  await sleep(150);
  check(`[${viewport.label}] "FZ" code-prefix ranks first`, (await prodIds())[0] === "p-sku-only");

  // -- 3-7. Required query shapes. --
  await prodCombo.fill("Fresh Milk");
  await sleep(150);
  check(`[${viewport.label}] exact name ranks first`, (await prodIds())[0] === "p-fresh");
  await prodCombo.fill("Fo");
  await sleep(150);
  check(`[${viewport.label}] "Fo" prefix ranks first`, (await prodIds())[0] === "p-fortune");
  await prodCombo.fill("FZ-999");
  await sleep(150);
  check(`[${viewport.label}] SKU-only query ranks exact SKU first`, (await prodIds())[0] === "p-sku-only");
  await prodCombo.fill("8961000999999");
  await sleep(150);
  check(`[${viewport.label}] barcode-only query ranks exact barcode first`, (await prodIds())[0] === "p-barcode-only");
  await prodCombo.fill("FreshCo");
  await sleep(150);
  check(`[${viewport.label}] brand-only query finds the product`, (await prodIds()).includes("p-brand-only"));

  // -- 8. No matches. --
  await prodCombo.fill("zzz-no-such-thing");
  await sleep(150);
  const noMatch = await prodScope.getByRole("status").textContent();
  check(`[${viewport.label}] no-matches state`, /No matches found/.test(noMatch ?? ""), noMatch);

  // -- 9. Mouse selection commits the exact name; the record tops the list. --
  await prodCombo.fill("Fresh Milk");
  await sleep(150);
  await prodOptions().first().click();
  await sleep(150);
  const afterClickValue = await prodCombo.inputValue();
  const topAfterClick = await prodScope.getByTestId("lab-products-top").textContent();
  check(
    `[${viewport.label}] mouse selection sets exact name, record first`,
    afterClickValue === "Fresh Milk" && (topAfterClick ?? "").startsWith("top: p-fresh"),
    `${afterClickValue} / ${topAfterClick}`,
  );

  // -- 9b. Duplicate names: selecting one pins its record ID first. --
  await prodCombo.fill("Twin Widget");
  await sleep(150);
  const twinIds = await prodIds();
  check(
    `[${viewport.label}] duplicate names both suggested`,
    twinIds.length === 2 && twinIds[0] === "p-twin-a" && twinIds[1] === "p-twin-b",
    twinIds.join(","),
  );
  await prodOptions().nth(1).click();
  await sleep(150);
  const twinTop = await prodScope.getByTestId("lab-products-top").textContent();
  const twinSelected = await prodScope.getByTestId("lab-products-selected").textContent();
  check(
    `[${viewport.label}] duplicate selection pins the chosen record ID first`,
    (twinTop ?? "").startsWith("top: p-twin-b") && /selected: p-twin-b/.test(twinSelected ?? ""),
    `${twinTop} / ${twinSelected}`,
  );
  // Editing the query clears the pinned selection; natural order returns.
  await prodCombo.fill("Twin Widge");
  await sleep(150);
  const twinTop2 = await prodScope.getByTestId("lab-products-top").textContent();
  const twinSelected2 = await prodScope.getByTestId("lab-products-selected").textContent();
  check(
    `[${viewport.label}] editing the query clears the pinned selection`,
    /selected: none/.test(twinSelected2 ?? "") && (twinTop2 ?? "").startsWith("top: p-twin-a"),
    `${twinTop2} / ${twinSelected2}`,
  );

  // -- 9c. Result limits are explicit: count + "View all". --
  await prodCombo.fill("F");
  await sleep(150);
  const viewAllBtn = prodScope.getByRole("button", { name: /View all/ });
  const footerText = await viewAllBtn.textContent();
  check(`[${viewport.label}] capped results show count + View all`, /Showing 8 of \d+ matches/.test(footerText ?? ""), footerText);
  await viewAllBtn.click();
  await sleep(150);
  const viewAllFired = await page.evaluate(() => window.__labViewAll);
  check(`[${viewport.label}] View all fires`, viewAllFired === "products", String(viewAllFired));

  // -- 9d. Account switch clears old-scope suggestions and selection immediately. --
  await prodCombo.fill("Twin Widget");
  await sleep(150);
  await prodOptions().nth(1).click();
  await sleep(150);
  await page.getByTestId("lab-scope-toggle").click();
  await sleep(200);
  const scopeLabel = await page.getByTestId("lab-scope-toggle").textContent();
  const topAfterSwitch = await prodScope.getByTestId("lab-products-top").textContent();
  const selAfterSwitch = await prodScope.getByTestId("lab-products-selected").textContent();
  check(
    `[${viewport.label}] account switch clears old-scope suggestions + selection`,
    /org-b/.test(scopeLabel ?? "") &&
      (topAfterSwitch ?? "").includes("top: none") &&
      /selected: none/.test(selAfterSwitch ?? "") &&
      (await prodListboxCount()) === 0,
    `${scopeLabel} / ${topAfterSwitch} / ${selAfterSwitch}`,
  );
  await prodCombo.fill("OrgB");
  await sleep(150);
  check(`[${viewport.label}] new scope suggests new-scope records`, (await prodIds())[0] === "p-orgb-1", (await prodIds()).join(","));
  await page.getByTestId("lab-scope-toggle").click(); // back to org-a
  await sleep(200);

  // -- 10. Keyboard selection (ArrowDown + Enter). --
  await prodCombo.fill("F");
  await sleep(150);
  const idsFk = await prodIds();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await sleep(150);
  const topAfterKeyboard = await prodScope.getByTestId("lab-products-top").textContent();
  check(
    `[${viewport.label}] keyboard selection chooses the highlighted record`,
    idsFk.length > 1 && (topAfterKeyboard ?? "").startsWith(`top: ${idsFk[1]}`),
    `${topAfterKeyboard} (expected ${idsFk[1]})`,
  );

  // -- 11. Escape closes. --
  await prodCombo.fill("F");
  await sleep(150);
  const openBefore = await prodListboxCount();
  await page.keyboard.press("Escape");
  await sleep(150);
  check(`[${viewport.label}] Escape closes the panel`, openBefore === 1 && (await prodListboxCount()) === 0);

  // -- 12. Clearing. --
  await prodCombo.fill("F");
  await sleep(150);
  await page.getByTestId("lab-products-clear").click();
  await sleep(150);
  check(
    `[${viewport.label}] clear empties the field and closes the panel`,
    (await prodCombo.inputValue()) === "" && (await prodListboxCount()) === 0,
  );

  // -- 13. Parent rerender keeps suggestions stable (timed). --
  // (Clicking the button blurs the field, so refocus to reopen the panel.)
  await prodCombo.fill("F");
  await sleep(150);
  const firstBeforeRerender = (await prodIds())[0];
  const rerenderStart = Date.now();
  await page.getByTestId("lab-products-rerender").click();
  await sleep(150);
  perf[`${viewport.label}.rerenderMs`] = Date.now() - rerenderStart;
  await prodCombo.click();
  await sleep(150);
  check(
    `[${viewport.label}] rerender keeps suggestions stable`,
    (await prodIds())[0] === firstBeforeRerender && (await prodListboxCount()) === 1,
    (await prodIds())[0],
  );
  await page.keyboard.press("Escape");

  // -- 14. Highlighting never renders user input as HTML. --
  await prodCombo.fill("<img");
  await sleep(150);
  const imgCount = await page.locator("img").count();
  const firstXssText = await prodOptions().first().textContent();
  const markCount = await prodOptions().first().locator("mark").count();
  check(
    `[${viewport.label}] hostile input is escaped, highlighted safely`,
    imgCount === 0 && /Evil/.test(firstXssText ?? "") && markCount > 0,
    `img=${imgCount} mark=${markCount}`,
  );
  await page.keyboard.press("Escape");

  // -- 15. 44px touch targets. --
  await prodCombo.fill("F");
  await sleep(150);
  const optionBox = await prodOptions().first().boundingBox();
  check(`[${viewport.label}] option touch target >= 44px`, (optionBox?.height ?? 0) >= 44, `${optionBox?.height}px`);

  // -- 16. Popover stays within the viewport. --
  const popBox = await prodScope.getByRole("listbox").evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  });
  check(
    `[${viewport.label}] popover inside viewport`,
    popBox.l >= 0 && popBox.r <= viewport.width && popBox.t >= 0 && popBox.b <= viewport.height,
    JSON.stringify(popBox),
  );
  await page.keyboard.press("Escape");

  // -- 17/18. Loading and failure states. --
  const loadingCombo = page.locator('[data-testid="lab-products-loading"]').getByRole("combobox");
  await loadingCombo.click();
  await sleep(150);
  const loadingText = await page.locator('[data-testid="lab-products-loading"]').getByRole("status").textContent();
  check(`[${viewport.label}] loading state shown`, /Loading/.test(loadingText ?? ""), loadingText);
  await page.keyboard.press("Escape");
  const errorCombo = page.locator('[data-testid="lab-products-error"]').getByRole("combobox");
  await errorCombo.click();
  await sleep(150);
  const errorScope = page.locator('[data-testid="lab-products-error"]');
  const staleText = await errorScope.getByRole("status").first().textContent();
  const staleOptions = await errorScope.getByRole("option").count();
  check(
    `[${viewport.label}] failure shows stale note, suggestions still work`,
    /Couldn't refresh/.test(staleText ?? "") && staleOptions > 0,
    `${staleText} / ${staleOptions} options`,
  );
  await page.keyboard.press("Escape");

  // -- 18b. Initial failure with nothing loaded: error state, not "no matches". --
  await prodCombo.fill("F"); // the error-empty field shares the query state
  await sleep(150);
  const errorEmptyCombo = page.locator('[data-testid="lab-products-error-empty"]').getByRole("combobox");
  await errorEmptyCombo.click();
  await sleep(150);
  const errorEmptyText = await page.locator('[data-testid="lab-products-error-empty"]').getByRole("status").textContent();
  check(`[${viewport.label}] initial failure shows the error state`, /Couldn't load results/.test(errorEmptyText ?? ""), errorEmptyText);
  await page.keyboard.press("Escape");

  // -- 19-22. Customers section field. --
  await custCombo.fill("Fah");
  await sleep(150);
  const custIds = await custScope.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("data-suggestion-id")));
  const custFirstText = await custScope.getByRole("option").first().textContent();
  check(`[${viewport.label}] customer "Fah" ranks Fahad first with shop detail`, custIds[0] === "c-fahad" && /Fresh Mart/.test(custFirstText ?? ""), custIds[0]);
  await custScope.getByRole("option").first().click();
  await sleep(150);
  const custQuery = await custScope.getByTestId("lab-customers-query").textContent();
  check(`[${viewport.label}] customer selection commits exact name`, /query: Fahad/.test(custQuery ?? ""), custQuery);
  await custCombo.fill("03001234567");
  await sleep(150);
  const phoneIds = await custScope.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("data-suggestion-id")));
  check(`[${viewport.label}] exact phone ranks first`, phoneIds[0] === "c-phone", phoneIds[0]);
  await custCombo.fill("Far");
  await sleep(150);
  await page.keyboard.press("Enter");
  await sleep(150);
  const custQuery2 = await custScope.getByTestId("lab-customers-query").textContent();
  check(`[${viewport.label}] customer keyboard selection`, /query: Farhan/.test(custQuery2 ?? ""), custQuery2);

  // -- 22b. Duplicate customer names pin the chosen record ID. --
  await custCombo.fill("Twin Customer");
  await sleep(150);
  const twinCustIds = await custScope.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("data-suggestion-id")));
  await custScope.getByRole("option").nth(1).click();
  await sleep(150);
  const custTop = await custScope.getByTestId("lab-customers-top").textContent();
  check(
    `[${viewport.label}] duplicate customer selection pins chosen ID first`,
    twinCustIds.length === 2 && (custTop ?? "").startsWith("top: c-twin-b"),
    `${twinCustIds.join(",")} / ${custTop}`,
  );

  // -- 23-26. POS selector: cap, correct id + price, highlight, Escape. --
  const posScope = page.locator('[data-testid="lab-pos"]');
  const posCombo = posScope.getByRole("combobox", { name: "Lab POS product" });
  await posCombo.fill("F");
  await sleep(150);
  const posCount = await posScope.getByRole("option").count();
  check(`[${viewport.label}] POS panel capped at 12`, posCount === 12, `${posCount}`);
  await posCombo.fill("FZ-999");
  await sleep(150);
  const posFirstId = await posScope.getByRole("option").first().getAttribute("data-suggestion-id");
  await page.keyboard.press("Enter");
  await sleep(150);
  const posSelected = await posScope.getByTestId("lab-pos-selected").textContent();
  check(
    `[${viewport.label}] POS selection keeps correct id and price`,
    posFirstId === "p-sku-only" && /p-sku-only/.test(posSelected ?? "") && /Rs 60\.00/.test(posSelected ?? ""),
    `${posFirstId} / ${posSelected}`,
  );
  await posCombo.click();
  await posCombo.fill("Fresh");
  await sleep(150);
  const posMarkHtml = await posScope.getByRole("option").first().innerHTML();
  check(`[${viewport.label}] POS options highlight matches safely`, /<mark/.test(posMarkHtml), posMarkHtml.slice(0, 80));
  await page.keyboard.press("Escape");
  await sleep(150);
  check(`[${viewport.label}] POS Escape closes`, (await posScope.getByRole("listbox").count()) === 0);

  // -- 26b. POS progressive browsing past the cap. --
  await posCombo.fill("F");
  await sleep(150);
  const showMoreBtn = posScope.getByRole("button", { name: /Show more/ });
  const showMoreText = await showMoreBtn.textContent();
  check(`[${viewport.label}] POS shows match count before the cap`, /Showing 12 of \d+ matches/.test(showMoreText ?? ""), showMoreText);
  await showMoreBtn.click();
  await sleep(150);
  const posCount2 = await posScope.getByRole("option").count();
  check(`[${viewport.label}] POS Show more reveals more matches`, posCount2 === 24, `${posCount2}`);
  await page.keyboard.press("Escape");

  // -- 27-30. Header global search. --
  const headerScope = page.locator('[data-testid="lab-header"]');
  const headerCombos = () => headerScope.getByRole("combobox");
  if (!viewport.mobile) {
    const headerCombo = headerCombos().first();
    await headerCombo.fill("Products");
    await sleep(200);
    const headerFirst = await headerScope.getByRole("option").first().textContent();
    await page.keyboard.press("Enter");
    await sleep(200);
    const nav = await page.evaluate(() => window.__labNav);
    check(
      `[${viewport.label}] header: section suggestion navigates`,
      /Products/.test(headerFirst ?? "") && nav?.section === "products",
      `${headerFirst} / ${JSON.stringify(nav)}`,
    );
    await headerCombo.fill("Fresh Milk");
    await sleep(200);
    await headerScope.getByRole("option").first().click();
    await sleep(200);
    const nav2 = await page.evaluate(() => window.__labNav);
    check(
      `[${viewport.label}] header: product suggestion navigates with prefill + record id`,
      nav2?.section === "products" && nav2?.prefill === "Fresh Milk" && nav2?.recordId === "p-fresh",
      JSON.stringify(nav2),
    );
    // "See all results in Products" footer.
    await headerCombo.fill("F");
    await sleep(200);
    const seeAllBtn = headerScope.getByRole("button", { name: /See all results in Products/ });
    check(`[${viewport.label}] header: See-all-in-Products footer shown`, (await seeAllBtn.count()) === 1);
    await seeAllBtn.click();
    await sleep(150);
    const viewAllH = await page.evaluate(() => window.__labViewAll);
    check(`[${viewport.label}] header: See all fires with the query`, viewAllH === "header:F", String(viewAllH));
    // Restricted permissions: no product suggestions, no SKU/price leak, no See-all.
    await page.getByTestId("lab-header-restrict-toggle").click();
    await sleep(150);
    await headerCombo.fill("Fresh Milk");
    await sleep(200);
    const restrictedListboxes = await headerScope.getByRole("listbox").count();
    const restrictedStatus = restrictedListboxes === 0 ? await headerScope.getByRole("status").textContent() : "";
    check(
      `[${viewport.label}] restricted: product suggestions hidden, no SKU/price leak`,
      restrictedListboxes === 0 && /No matches found/.test(restrictedStatus ?? ""),
      `${restrictedListboxes} listboxes / ${restrictedStatus}`,
    );
    const seeAllHidden = await headerScope.getByRole("button", { name: /See all results in Products/ }).count();
    check(`[${viewport.label}] restricted: no See-all-in-Products action`, seeAllHidden === 0, `${seeAllHidden}`);
    await page.getByTestId("lab-header-restrict-toggle").click();
    await sleep(150);
    // Header read states: loading, then stale after refresh failure.
    await page.getByTestId("lab-header-status").click(); // -> loading
    await sleep(150);
    await headerCombo.fill("zzz-nope");
    await sleep(200);
    const hLoading = await headerScope.getByRole("status").textContent();
    check(`[${viewport.label}] header: loading state`, /Loading/.test(hLoading ?? ""), hLoading);
    await page.getByTestId("lab-header-status").click(); // -> error
    await sleep(150);
    await headerCombo.fill("Fresh Milk");
    await sleep(200);
    const hStale = await headerScope.getByRole("status").first().textContent();
    const hStaleOpts = await headerScope.getByRole("option").count();
    check(
      `[${viewport.label}] header: stale products after refresh failure`,
      /Couldn't refresh products/.test(hStale ?? "") && hStaleOpts > 0,
      `${hStale} / ${hStaleOpts} options`,
    );
    await page.getByTestId("lab-header-status").click(); // -> ready
    await sleep(150);
    await headerCombo.fill("zzz-nope");
    await sleep(200);
    const headerNoMatch = await headerScope.getByRole("status").textContent();
    check(`[${viewport.label}] header: no-matches state`, /No matches found/.test(headerNoMatch ?? ""), headerNoMatch);
    await page.keyboard.press("Escape");
    const expanded = await headerCombo.getAttribute("aria-expanded");
    check(`[${viewport.label}] header: combobox semantics`, expanded === "false", `aria-expanded=${expanded}`);
  } else {
    // Mobile: open the search panel, then use the mobile combobox.
    // (getByRole skips the display:none desktop box, so it is .first().)
    await page.getByRole("button", { name: "Search sections and products" }).tap();
    await sleep(300);
    const mobileCombo = headerCombos().first();
    check(`[${viewport.label}] header mobile: search panel opens`, await mobileCombo.isVisible());
    await mobileCombo.fill("Fresh Milk");
    await sleep(200);
    const mFirst = headerScope.getByRole("option").first();
    await mFirst.tap();
    await sleep(300);
    const navM = await page.evaluate(() => window.__labNav);
    check(
      `[${viewport.label}] header mobile: tap selects product with prefill + record id`,
      navM?.section === "products" && navM?.prefill === "Fresh Milk" && navM?.recordId === "p-fresh",
      JSON.stringify(navM),
    );
    // Reopen and check the popover stays in the viewport.
    await page.getByRole("button", { name: "Search sections and products" }).tap();
    await sleep(300);
    await headerCombos().first().fill("F");
    await sleep(200);
    const mPopBox = await headerScope.getByRole("listbox").evaluate((el) => {
      const r = el.parentElement.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    check(
      `[${viewport.label}] header mobile: popover inside viewport`,
      mPopBox.l >= 0 && mPopBox.r <= viewport.width && mPopBox.t >= 0 && mPopBox.b <= viewport.height,
      JSON.stringify(mPopBox),
    );
  }

  // -- 31. Cramped viewport: field near the bottom of a tall page. --
  const crampedScope = page.locator('[data-testid="lab-cramped"]');
  const crampedCombo = crampedScope.getByRole("combobox", { name: "Lab cramped search" });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await crampedCombo.fill("F");
  await sleep(200);
  const crampedPopBox = await crampedScope.getByRole("listbox").evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect();
    return { t: r.top, b: r.bottom };
  });
  check(
    `[${viewport.label}] cramped: popover fits the visual viewport`,
    crampedPopBox.t >= 0 && crampedPopBox.b <= viewport.height,
    JSON.stringify(crampedPopBox),
  );
  await page.keyboard.press("Escape");

  if (viewport.mobile) {
    // -- 32. Phone-keyboard simulation: shrunken viewport, field at the bottom.
    // At 220px tall the space above the flipped popover is ~130px: the old
    // 132px minimum would push it off the top of the viewport. The field is
    // scrolled into view manually and focused with preventScroll so the
    // measurement reflects a real keyboard-open state (the field in view).
    await page.setViewportSize({ width: 390, height: 220 });
    await sleep(200);
    await crampedCombo.fill("", { force: true });
    await crampedCombo.fill("F", { force: true });
    await sleep(200);
    await page.keyboard.press("Escape");
    await sleep(150);
    await crampedCombo.evaluate((el) => {
      el.blur();
      const r = el.getBoundingClientRect();
      window.scrollTo(0, r.top + window.scrollY + r.height - window.innerHeight + 8);
    });
    await sleep(300);
    await crampedCombo.evaluate((el) => el.focus({ preventScroll: true }));
    await sleep(400);
    const kbPopBox = await crampedScope.getByRole("listbox").evaluate((el) => {
      const r = el.parentElement.getBoundingClientRect();
      return { t: r.top, b: r.bottom };
    });
    check(
      `[${viewport.label}] keyboard-cramped: popover never exceeds the available space`,
      kbPopBox.t >= 0 && kbPopBox.b <= 220,
      JSON.stringify(kbPopBox),
    );
    // Keyboarding through the capped list must not move the page scroll
    // (regression: the active-option scroll used to scroll the window itself),
    // and the active option stays visible inside the popover.
    const scrollBeforeKeys = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await sleep(150);
    const scrollAfterKeys = await page.evaluate(() => window.scrollY);
    check(
      `[${viewport.label}] keyboard-cramped: keyboarding through options does not move the page`,
      Math.abs(scrollAfterKeys - scrollBeforeKeys) < 2,
      `scrollY ${scrollBeforeKeys} -> ${scrollAfterKeys}`,
    );
    const kbActiveVisible = await crampedScope
      .getByRole("listbox")
      .evaluate((listbox) => {
        const pop = listbox.parentElement.getBoundingClientRect();
        const active = listbox.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
        return !!active && active.top >= pop.top - 1 && active.bottom <= pop.bottom + 1;
      });
    check(
      `[${viewport.label}] keyboard-cramped: active option stays visible while scrolling`,
      kbActiveVisible === true,
      String(kbActiveVisible),
    );
    await page.keyboard.press("Escape");
  }

  // -- Page errors. --
  check(`[${viewport.label}] no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
}

console.log("\n----- performance (5,022-product fixture) -----");
for (const [k, v] of Object.entries(perf)) console.log(`${k}: ${v}ms`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(` - ${f.name}`);
  process.exit(1);
}
