// Browser/integration regressions for the global search suggestion panels.
// Bundles the REAL components from src (SearchSuggestField, ProductSearchSelect,
// Header) with the real shared ranking helper, driven against synthetic
// fixtures (5,000 products, 7 customers). No network, no credentials.
//
// Build: esbuild bundles scripts/lab-global-search-suggestions.entry.tsx;
// postcss+tailwind compiles the real design tokens for layout measurements.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "/home/hatch/workspace/tradeos-product-search/e2e/node_modules/playwright-core/index.mjs";

const ROOT = "/home/hatch/workspace/tradeos-global-search-suggestions";
const DIST = "/tmp/lab-suggest/dist";
mkdirSync(DIST, { recursive: true });

console.log("building lab bundle...");
await build({
  entryPoints: [`${ROOT}/scripts/lab-global-search-suggestions.entry.tsx`],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  alias: { "@": `${ROOT}/src` },
  outfile: `${DIST}/lab-bundle.js`,
  logLevel: "warning",
});

console.log("compiling lab css...");
const css = await postcss([tailwindcss()]).process(
  `@import "${ROOT}/src/app/globals.css";\n@source "${ROOT}/src";\n@source "${ROOT}/scripts/lab-global-search-suggestions.entry.tsx";`,
  { from: `${DIST}/lab.css` },
);
writeFileSync(`${DIST}/lab.css`, css.css);

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${readFileSync(`${DIST}/lab-bundle.js`, "utf8")}</script></body></html>`;
writeFileSync(`${DIST}/lab.html`, html);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const viewport of [
  { width: 390, height: 844, label: "phone", mobile: true },
  { width: 1440, height: 900, label: "desktop", mobile: false },
]) {
  console.log(`\n===== viewport: ${viewport.label} =====`);
  const browser = await chromium.launch({ executablePath: "/opt/meta-chromium/chrome" });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.mobile,
    isMobile: viewport.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(15000);

  await page.goto("about:blank");
  await page.setContent(readFileSync(`${DIST}/lab.html`, "utf8"));
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 30000 });

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

  // -- 2. Typing "F" shows the compact ranked panel. --
  await prodCombo.fill("F");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lab-products"] [role="option"]').length > 0);
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

  // -- 13. Parent rerender keeps suggestions stable. --
  // (Clicking the button blurs the field, so refocus to reopen the panel.)
  await prodCombo.fill("F");
  await sleep(150);
  const firstBeforeRerender = (await prodIds())[0];
  await page.getByTestId("lab-products-rerender").click();
  await sleep(150);
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
  const loadingCombo = page.getByRole("combobox", { name: "Lab products loading" });
  await loadingCombo.click();
  await sleep(150);
  const loadingText = await page.locator('[data-testid="lab-products-loading"]').getByRole("status").textContent();
  check(`[${viewport.label}] loading state shown`, /Loading/.test(loadingText ?? ""), loadingText);
  await page.keyboard.press("Escape");
  const errorCombo = page.getByRole("combobox", { name: "Lab products error" });
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

  // -- 27-30. Header global search. --
  const headerScope = page.locator('[data-testid="lab-header"]');
  if (!viewport.mobile) {
    const headerCombo = headerScope.getByRole("combobox").first();
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
      `[${viewport.label}] header: product suggestion navigates with prefill`,
      nav2?.section === "products" && nav2?.prefill === "Fresh Milk",
      JSON.stringify(nav2),
    );
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
    const mobileCombo = headerScope.getByRole("combobox").first();
    check(`[${viewport.label}] header mobile: search panel opens`, await mobileCombo.isVisible());
    await mobileCombo.fill("Fresh Milk");
    await sleep(200);
    const mFirst = headerScope.getByRole("option").first();
    await mFirst.tap();
    await sleep(300);
    const navM = await page.evaluate(() => window.__labNav);
    check(
      `[${viewport.label}] header mobile: tap selects product with prefill`,
      navM?.section === "products" && navM?.prefill === "Fresh Milk",
      JSON.stringify(navM),
    );
    // Reopen and check the popover stays in the viewport.
    await page.getByRole("button", { name: "Search sections and products" }).tap();
    await sleep(300);
    await headerScope.getByRole("combobox").first().fill("F");
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

  // -- Page errors. --
  check(`[${viewport.label}] no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(` - ${f.name}`);
  process.exit(1);
}
