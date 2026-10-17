/* eslint-disable @typescript-eslint/no-require-imports -- this standalone Playwright runner is CommonJS. */
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { createRequire } = require("node:module");
const req = createRequire(path.join(process.cwd(), "package.json")),
  { createServerClient } = req("@supabase/ssr"),
  { chromium } = req(path.resolve("e2e/node_modules/playwright"));
const e = process.env,
  project = "rtfowunsyrdygyvubnvs",
  app = e.POS_RELEASE_APP_URL || "http://127.0.0.1:3001",
  api = e.POS_RELEASE_SUPABASE_URL,
  org = e.POS_RELEASE_ORGANIZATION_ID,
  product = e.POS_RELEASE_AUTH_PRODUCT_ID;
const dir = path.join(
    e.LOCALAPPDATA,
    "TradeOS",
    "pos-release-test",
    "browser-evidence",
  ),
  out = {
    target: project,
    revision: spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim(),
    checks: {},
    screenshots: [],
    ids: {},
  };
let browser,
  ctx,
  page,
  reqId,
  saleId,
  invoice,
  returnId,
  returnNo,
  stockBefore,
  fail,
  cleanup = { status: "NOT RUN" },
  createCalls = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  ok = (c, m) => {
    if (!c) throw Error(m);
  },
  isUuid = (x) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(x || ""),
    ),
  lit = (x) => `'${String(x).replaceAll("'", "''")}'`;
function sql(s) {
  const d = new URL(e.POS_RELEASE_TEST_DATABASE_URL),
    a = /^([a-z0-9-]+)\.supabase\.co$/i.exec(new URL(api).hostname)?.[1],
    r =
      /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(d.hostname)?.[1] ||
      (!/\.pooler\.supabase\.com$/i.test(d.hostname)
        ? /\.([a-z0-9-]+)$/i.exec(d.hostname)?.[1]
        : null) ||
      /\.([a-z0-9-]+)$/i.exec(decodeURIComponent(d.username))?.[1];
  ok(
    !d.password && a === project && r === project,
    "database target guard failed",
  );
  const x = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      e.POS_RELEASE_TEST_DATABASE_URL,
      "-c",
      s,
    ],
    { encoding: "utf8", timeout: 120000, windowsHide: true, env: e },
  );
  if (x.error || x.status !== 0) throw Error("test database query failed");
  return String(x.stdout || "").trim();
}
const query = (s) => JSON.parse(sql(s));
function saleState() {
  const id =
    saleId && isUuid(saleId)
      ? lit(saleId) + "::uuid"
      : "'00000000-0000-0000-0000-000000000000'::uuid";
  return query(
    `select json_build_object('sales',(select count(*) from public.sales_transactions where organization_id=${lit(org)}::uuid and request_id=${lit(reqId)}::uuid),'saleId',(select id from public.sales_transactions where organization_id=${lit(org)}::uuid and request_id=${lit(reqId)}::uuid limit 1),'items',(select count(*) from public.sales_items where sales_transaction_id=${id}),'qty',(select quantity from public.sales_items where sales_transaction_id=${id} limit 1),'discount',(select discount_amount from public.sales_transactions where id=${id}),'total',(select total_amount from public.sales_transactions where id=${id}),'cash',(select cash_received from public.sales_transactions where id=${id}),'change',(select change_due from public.sales_transactions where id=${id}),'stock',(select current_stock from public.products where id=${lit(product)}::uuid));`,
  );
}
async function main() {
  try {
    ok(
      e.POS_RELEASE_TEST_TARGET === "disposable-pos-atomic-sales" &&
        new URL(api).hostname === project + ".supabase.co",
      "test target guard failed",
    );
    fs.mkdirSync(dir, { recursive: true });
    const pre = await fetch(app + "/api/pos-release-environment"),
      pd = pre.ok ? await pre.json() : {};
    ok(
      pre.status === 200 &&
        pd.supabaseUrls?.length &&
        pd.supabaseUrls.every(
          (u) => new URL(u).hostname === project + ".supabase.co",
        ),
      "app target mismatch",
    );
    stockBefore = Number(
      sql(
        `select current_stock from public.products where id=${lit(product)}::uuid and organization_id=${lit(org)}::uuid`,
      ),
    );
    ok(Number.isFinite(stockBefore), "fractional fixture missing");
    const session = {
      access_token: e.POS_RELEASE_OWNER_ACCESS_TOKEN,
      refresh_token: e.POS_RELEASE_OWNER_REFRESH_TOKEN,
    };
    ok(
      session.access_token && session.refresh_token,
      "synthetic owner session missing",
    );
    const jwt = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
      ),
      ur = await fetch(api + "/auth/v1/user", {
        headers: {
          apikey: e.POS_RELEASE_SUPABASE_ANON_KEY,
          Authorization: "Bearer " + session.access_token,
        },
      }),
      user = ur.ok ? await ur.json() : null;
    ok(
      ur.status === 200 &&
        jwt.role === "authenticated" &&
        jwt.app_metadata?.organization_id === org &&
        jwt.sub === user?.id,
      "synthetic owner identity invalid",
    );
    const prov = await fetch(app + "/api/auth/provision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + session.access_token,
        },
        body: "{}",
      }),
      provData = prov.ok ? await prov.json() : {};
    out.checks.ownerProvision = prov.status === 200 ? "PASS" : "FAIL";
    out.checks.provisionHttp = prov.status;
    out.checks.alreadyInitialized = provData.alreadyProvisioned === true;
    ok(prov.status === 200, "owner provision endpoint failed");
    const updates = new Map(),
      supa = createServerClient(api, e.POS_RELEASE_SUPABASE_ANON_KEY, {
        cookies: {
          getAll: () => [],
          setAll: (cs) => cs.forEach((c) => updates.set(c.name, c)),
        },
      });
    ok(
      !(
        await supa.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
      ).error,
      "session cookie install failed",
    );
    await supa.auth.getUser();
    ok(updates.size > 0, "Supabase browser session cookies missing");
    browser = await chromium.launch({
      headless: true,
      executablePath:
        e.POS_CHROME_PATH ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    ctx = await browser.newContext({
      viewport: { width: 360, height: 800 },
      acceptDownloads: true,
    });
    await ctx.addCookies(
      [...updates.values()].map(({ name, value, options = {} }) => ({
        name,
        value,
        domain: "127.0.0.1",
        path: options.path || "/",
        sameSite: "Lax",
      })),
    );
    await ctx.addInitScript(() => {
      if (window === window.top) {
        window.__pc = 0;
        window.__pd = [];
        new MutationObserver((rs) =>
          rs
            .flatMap((r) => [...r.addedNodes])
            .forEach((n) => {
              if (
                n instanceof HTMLIFrameElement &&
                n.title.startsWith("Print receipt")
              )
                window.__pd.push(n.srcdoc);
            }),
        ).observe(document, { childList: true, subtree: true });
      }
      window.print = function () {
        try {
          window.top.__pc = (window.top.__pc || 0) + 1;
        } catch {}
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    page = await ctx.newPage();
    const provisionStatuses = [];
    let pageErrors = 0;
    page.on("response", (r) => {
      if (r.url().includes("/api/auth/provision"))
        provisionStatuses.push(r.status());
    });
    page.on("pageerror", () => pageErrors++);
    await page.goto(app + "/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page
      .getByRole("button", { name: /Retail POS\s*\/\s*Create a sale/i })
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {});
    const close = page.getByRole("button", { name: "Close help" });
    if (
      (await close.count()) &&
      (await close
        .first()
        .isVisible()
        .catch(() => false))
    )
      await close.first().click({ timeout: 5000 });
    const headings = await page
      .locator("h1,h2")
      .allInnerTexts()
      .catch(() => []);
    const dashboardVisible =
      headings.includes("Business Overview") && !/login/i.test(page.url());
    out.debug = {
      url: page.url(),
      businessOverviewVisible: headings.includes("Business Overview"),
      cookieNames: (await ctx.cookies(app)).map((c) => c.name),
    };
    ok(dashboardVisible, "owner dashboard not visible");
    out.checks.ownerDashboard = "PASS";
    out.checks.browserProvisionStatuses = provisionStatuses;
    out.checks.ownerSession = "PASS";
    out.checks.targetIdentity = "PASS";
    await page
      .getByRole("button", { name: /Retail POS\s*\/\s*Create a sale/i })
      .first()
      .click({ timeout: 10000 });
    await page
      .getByLabel("Product", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    await page
      .getByLabel("Product", { exact: true })
      .fill("POS Release Fractional");
    await page
      .getByText("POS Release Fractional Pack Product", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
    const productMatches = await page
      .getByText("POS Release Fractional Pack Product", { exact: true })
      .count();
    out.debug.productSuggestionCount = productMatches;
    out.debug.productInput = await page
      .getByLabel("Product", { exact: true })
      .inputValue();
    if (!productMatches)
      out.debug.productInPageText = (
        await page.locator("body").innerText()
      ).includes("POS Release Fractional Pack Product");
    ok(
      productMatches > 0,
      "synthetic fractional product suggestion unavailable",
    );
    await page
      .getByText("POS Release Fractional Pack Product", { exact: true })
      .first()
      .click();
    await page
      .locator(
        "select[aria-label='Unit for POS Release Fractional Pack Product']:visible",
      )
      .first()
      .selectOption({ label: "pack" });
    await page
      .locator(
        "input[aria-label='Quantity for POS Release Fractional Pack Product']:visible",
      )
      .first()
      .fill("0.125");
    const customer = page
      .locator("input[aria-label='Customer']:visible")
      .first();
    await customer.fill("POS Release Cash Customer");
    await page
      .getByText("POS Release Cash Customer", { exact: true })
      .waitFor({ state: "visible", timeout: 10000 });
    await page
      .getByText("POS Release Cash Customer", { exact: true })
      .first()
      .click();
    const cash = page
      .locator("input[aria-label='Cash received']:visible")
      .first();
    await cash.fill("5.00");
    const discountType = page.getByRole("combobox", {
        name: "Sale discount type",
      }),
      percentDiscount = page.getByRole("textbox", {
        name: "Sale discount percentage",
      });
    await discountType.selectOption("percent");
    await percentDiscount.fill("100.01");
    await page
      .getByText("Invoice discount percentage cannot exceed 100.", {
        exact: true,
      })
      .waitFor({ state: "visible", timeout: 10000 });
    const invalidTotal = page.locator("[data-pos-payment-bar] .text-3xl"),
      invalidSave = page.getByRole("button", {
        name: "Pay & Save",
        exact: true,
      });
    out.checks.invalidPercentageBlocked =
      /Unavailable/.test(await invalidTotal.innerText()) &&
      (await invalidSave.isDisabled())
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.invalidPercentageBlocked === "PASS",
      "invalid percentage did not disable the sale",
    );
    await percentDiscount.fill("10");
    const discountSummary = page.getByText(/Discount before tax:/);
    await discountSummary.waitFor({ state: "visible", timeout: 10000 });
    out.checks.percentageDiscount =
      /1\.01/.test(await discountSummary.innerText()) &&
      /9\.07/.test(await invalidTotal.innerText())
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.percentageDiscount === "PASS",
      "percentage discount amount/total mismatch",
    );
    await discountType.selectOption("flat");
    await page
      .getByRole("textbox", { name: "Sale discount amount" })
      .fill("1.00");
    out.checks.amountDiscount = /9\.08/.test(await invalidTotal.innerText())
      ? "PASS"
      : "FAIL";
    ok(out.checks.amountDiscount === "PASS", "amount discount total mismatch");
    await discountType.selectOption("percent");
    await page
      .getByRole("textbox", { name: "Sale discount percentage" })
      .fill("10");
    const metrics = await page.evaluate(() => ({
      w: innerWidth,
      d: document.documentElement.scrollWidth,
    }));
    out.checks.phoneLayout = metrics.d <= metrics.w ? "PASS" : "FAIL";
    out.checks.phoneOverflowPx = Math.max(0, metrics.d - metrics.w);
    await page.screenshot({
      path: path.join(dir, "authenticated-pos-phone-before-save.png"),
      fullPage: true,
    });
    out.screenshots.push("authenticated-pos-phone-before-save.png");
    page.on("request", (r) => {
      if (r.url().includes("/rpc/create_sales_invoice_atomic")) {
        createCalls++;
        try {
          reqId ||= r.postDataJSON()?.p_request_id;
        } catch {}
      }
    });
    const short = page.getByText(/Cash short by/i);
    await short.waitFor({ state: "visible", timeout: 10000 });
    const saveButton = page.getByRole("button", {
        name: "Pay & Save",
        exact: true,
      }),
      disabled = await saveButton.isDisabled();
    out.checks.cashShortfall =
      createCalls === 0 && disabled && /4\.07/.test(await short.innerText())
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.cashShortfall === "PASS",
      "shortfall was not blocked before write",
    );
    await cash.fill("20.00");
    const changeSummary = page.getByText(/Change due:/i);
    await changeSummary.waitFor({ state: "visible", timeout: 10000 });
    out.checks.cashChangePreview = /10\.93/.test(await changeSummary.innerText())
      ? "PASS"
      : "FAIL";
    ok(out.checks.cashChangePreview === "PASS", "cash change preview mismatch");
    let droppedCreate = false,
      droppedStatus = false,
      atomic = null;
    await page.route("**/rpc/create_sales_invoice_atomic*", async (route) => {
      if (droppedCreate) return route.continue();
      droppedCreate = true;
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch {}
      out.debug.rpcBodyKeys = Object.keys(body);
      reqId = body.p_request_id || body.request_id || null;
      const response = await route.fetch({ timeout: 60000 }),
        payload = await response.json().catch(() => null);
      atomic = Array.isArray(payload) ? payload[0] : payload;
      if (response.status() === 200 && atomic?.transaction?.id) {
        saleId = atomic.transaction.id;
        invoice = atomic.transaction.invoice_number;
        reqId ||= atomic.transaction.request_id || atomic.request_id || null;
      }
      await route.abort("failed");
    });
    await page.route(
      "**/rpc/get_sales_invoice_request_status*",
      async (route) => {
        if (!droppedStatus) {
          droppedStatus = true;
          return route.abort("failed");
        }
        return route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Pay & Save", exact: true })
      .click({ timeout: 10000 });
    await page
      .getByText(/Sale status could not be confirmed/i)
      .waitFor({ state: "visible", timeout: 20000 });
    const pendingId = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) =>
        x.startsWith("tradeos:pending-sale:v1:"),
      );
      try {
        return k
          ? JSON.parse(localStorage.getItem(k) || "{}").requestId || null
          : null;
      } catch {
        return null;
      }
    });
    reqId ||= pendingId;
    const pending = Boolean(pendingId);
    out.debug.lostResponse = {
      droppedCreate,
      droppedStatus,
      pendingIdPresent: Boolean(pendingId),
      requestIdValid: isUuid(reqId),
      requestIdMatchesPending: pendingId === reqId,
      requestId: String(reqId ?? "").slice(0, 80),
      pendingRequestId: String(pendingId ?? "").slice(0, 80),
    };
    ok(
      droppedCreate && droppedStatus && pending && isUuid(reqId),
      "lost-response state not preserved",
    );
    const persisted = saleState();
    saleId ||= persisted.saleId;
    invoice ||= atomic?.transaction?.invoice_number;
    out.checks.committedBeforeResponseLoss =
      Number(persisted.sales) === 1 ? "PASS" : "FAIL";
    out.checks.fractionalQuantity =
      Number(persisted.qty) === 0.125 ? "PASS" : "FAIL";
    out.checks.saleTotal =
      Number(persisted.discount) === 1.01 && Number(persisted.total) === 9.07
        ? "PASS"
        : "FAIL";
    out.checks.cashAndChange =
      Number(persisted.cash) === 20 && Number(persisted.change) === 10.93
        ? "PASS"
        : "FAIL";
    out.checks.lostResponseSaved = "PASS";
    ok(
      out.checks.committedBeforeResponseLoss === "PASS" &&
        out.checks.fractionalQuantity === "PASS" &&
        out.checks.saleTotal === "PASS" &&
        out.checks.cashAndChange === "PASS",
      "persisted sale values mismatch",
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .getByRole("button", { name: /Open Retail POS/i })
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
    const close2 = page.getByRole("button", { name: "Close help" });
    if (
      (await close2.count()) &&
      (await close2
        .first()
        .isVisible()
        .catch(() => false))
    )
      await close2.first().click({ timeout: 5000 });
    const open = page.getByRole("button", { name: /Open Retail POS/i }),
      quickSale = page.getByRole("button", {
        name: /Retail POS\s*\/\s*Create a sale/i,
      }),
      payAfterReload = page.getByRole("button", {
        name: "Pay & Save",
        exact: true,
      });
    if (await open.count()) await open.first().click();
    else if (await quickSale.count()) await quickSale.first().click();
    else if (!(await payAfterReload.count()))
      throw Error("Retail POS entry point unavailable after reload");
    await page
      .getByRole("button", { name: "Pay & Save", exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "Pay & Save", exact: true }).click();
    await page
      .getByText(/Earlier sale .* was confirmed/i)
      .waitFor({ state: "visible", timeout: 20000 });
    await page
      .getByRole("button", { name: /Receipt for /i })
      .first()
      .waitFor({ state: "visible", timeout: 15000 });
    const afterRetry = saleState();
    out.checks.reloadRecovery =
      Number(afterRetry.sales) === 1 && createCalls === 1 ? "PASS" : "FAIL";
    ok(
      out.checks.reloadRecovery === "PASS",
      "reload retry did not recover one sale",
    );
    out.ids.requestId = reqId;
    out.ids.salesTransactionId = saleId;
    out.ids.invoiceNumber = invoice;
    await page
      .getByRole("button", { name: /Receipt for /i })
      .first()
      .click();
    const receipt = page.getByRole("dialog", {
      name: new RegExp("Receipt " + invoice),
    });
    await receipt.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(1000);
    let receiptText = await receipt.innerText();
    const receiptOK =
      receiptText.includes(invoice) &&
      receiptText.includes("POS Release Fractional Pack Product") &&
      /0\.125/.test(receiptText) &&
      /1\.01/.test(receiptText) &&
      /9\.07/.test(receiptText) &&
      /20\.00/.test(receiptText) &&
      /10\.93/.test(receiptText);
    out.checks.receiptPreview = receiptOK ? "PASS" : "FAIL";
    ok(receiptOK, "receipt totals/quantity mismatch");
    await page.screenshot({
      path: path.join(dir, "authenticated-receipt-phone.png"),
      fullPage: true,
    });
    out.screenshots.push("authenticated-receipt-phone.png");
    await page
      .getByRole("button", { name: "Print receipt", exact: true })
      .click();
    await page.waitForFunction(() => window.__pc === 1, { timeout: 10000 });
    const printDoc = await page.evaluate(() => window.__pd?.[0] || "");
    ok(
      printDoc.includes(invoice) &&
        printDoc.includes("POS Release Fractional Pack Product") &&
        /9\.07/.test(printDoc) &&
        /20\.00/.test(printDoc) &&
        /10\.93/.test(printDoc),
      "receipt print HTML mismatch",
    );
    out.checks.mockedPrintDocument = "PASS";
    const pdf = await ctx.newPage();
    await pdf.setContent(printDoc, { waitUntil: "load" });
    const paper = await pdf
      .locator("body")
      .getAttribute("data-receipt-paper-width");
    ok(paper === "80mm", "unexpected print width");
    const pdfPath = path.join(dir, "authenticated-receipt.pdf");
    await pdf.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
    });
    out.pdf = {
      status: "PASS",
      paperWidth: paper,
      sizeBytes: fs.statSync(pdfPath).size,
      file: "authenticated-receipt.pdf",
    };
    await pdf.screenshot({
      path: path.join(dir, "receipt-print-document.png"),
      fullPage: true,
    });
    out.screenshots.push("receipt-print-document.png");
    await pdf.close();
    await page
      .getByRole("button", { name: "Print receipt", exact: true })
      .click();
    await page.waitForFunction(() => window.__pc === 2, { timeout: 10000 });
    const print2 = await page.evaluate(() => window.__pd?.[1] || "");
    out.checks.receiptReprint =
      print2.includes(invoice) && /9\.07/.test(print2) ? "PASS" : "FAIL";
    ok(out.checks.receiptReprint === "PASS", "reprint document mismatch");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: /Receipt for /i })
      .first()
      .click();
    receiptText = await page
      .getByRole("dialog", { name: new RegExp("Receipt " + invoice) })
      .innerText();
    out.checks.receiptReopen =
      receiptText.includes(invoice) &&
      receiptText.includes("POS Release Fractional Pack Product")
        ? "PASS"
        : "FAIL";
    await page.getByRole("button", { name: "Close", exact: true }).click();
    ok(out.checks.receiptReopen === "PASS", "receipt reopen stale/missing");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopMetrics = await page.evaluate(() => ({
      w: innerWidth,
      d: document.documentElement.scrollWidth,
    }));
    out.checks.desktopLayout =
      desktopMetrics.d <= desktopMetrics.w ? "PASS" : "FAIL";
    out.checks.desktopOverflowPx = Math.max(
      0,
      desktopMetrics.d - desktopMetrics.w,
    );
    ok(
      out.checks.desktopLayout === "PASS",
      "desktop page has horizontal overflow",
    );
    await page
      .getByRole("button", { name: /Receipt for /i })
      .first()
      .click();
    const desktopReceipt = page.getByRole("dialog", {
      name: new RegExp("Receipt " + invoice),
    });
    await desktopReceipt.waitFor({ state: "visible", timeout: 10000 });
    const desktopReceiptText = await desktopReceipt.innerText();
    out.checks.desktopReceiptPreview =
      desktopReceiptText.includes(invoice) &&
      desktopReceiptText.includes("POS Release Fractional Pack Product") &&
      /0\.125/.test(desktopReceiptText) &&
      /1\.01/.test(desktopReceiptText) &&
      /9\.07/.test(desktopReceiptText) &&
      /20\.00/.test(desktopReceiptText) &&
      /10\.93/.test(desktopReceiptText)
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.desktopReceiptPreview === "PASS",
      "desktop receipt content mismatch",
    );
    await page.screenshot({
      path: path.join(dir, "authenticated-receipt-desktop.png"),
      fullPage: true,
    });
    out.screenshots.push("authenticated-receipt-desktop.png");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Sales Returns", exact: true })
      .first()
      .click({ timeout: 10000 });
    await page
      .getByRole("heading", { name: "Sales Return", exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    let source = -1;
    for (let i = 0; i < 30 && source < 0; i++) {
      source = await page
        .locator("select")
        .evaluateAll(
          (ss, id) =>
            ss.findIndex((s) => [...s.options].some((o) => o.value === id)),
          saleId,
        );
      if (source < 0) await wait(500);
    }
    ok(source >= 0, "sale missing from return source selector");
    await page.locator("select").nth(source).selectOption(saleId);
    const qty = page.locator('input[type="number"]').first();
    ok(
      Number(await qty.inputValue()) === 0.125,
      "return quantity did not preserve 0.125",
    );
    const returnWait = page.waitForResponse(
      (r) =>
        r.url().includes("/api/sales/returns") &&
        r.request().method() === "POST",
      { timeout: 30000 },
    );
    await page
      .getByRole("button", { name: "Save Sales Return", exact: true })
      .click();
    const returnResponse = await returnWait,
      rd = returnResponse.ok() ? await returnResponse.json() : {};
    returnId = rd.returnId;
    returnNo = rd.returnNumber;
    const stockReturn = Number(
      sql(
        `select current_stock from public.products where id=${lit(product)}::uuid and organization_id=${lit(org)}::uuid`,
      ),
    );
    out.checks.returnCreation =
      returnResponse.status() === 200 &&
      isUuid(returnId) &&
      Math.abs(stockReturn - stockBefore) < 0.000001
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.returnCreation === "PASS",
      "return create/stock effect failed",
    );
    out.ids.salesReturnId = returnId;
    out.ids.salesReturnNumber = returnNo;
    const row = page
      .locator("li")
      .filter({ hasText: "Return: " + returnNo })
      .first();
    await row
      .getByRole("button", { name: "Delete", exact: true })
      .waitFor({ state: "visible", timeout: 10000 });
    page.once("dialog", (d) => d.accept());
    const deleteWait = page.waitForResponse(
      (r) =>
        r.url().includes("/rest/v1/sales_returns") &&
        r.request().method() === "DELETE",
      { timeout: 30000 },
    );
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    const dr = await deleteWait;
    await page.waitForTimeout(1000);
    const stockDelete = Number(
        sql(
          `select current_stock from public.products where id=${lit(product)}::uuid and organization_id=${lit(org)}::uuid`,
        ),
      ),
      net = Number(
        sql(
          `select coalesce(sum(quantity_delta),0) from public.inventory_transactions where reference_id=${lit(returnId)}::uuid and reference_type='sales_return'`,
        ),
      );
    out.checks.returnCancellation =
      dr.status() === 204 &&
      Math.abs(stockDelete - (stockBefore - 0.125)) < 0.000001 &&
      Math.abs(net) < 0.000001
        ? "PASS"
        : "FAIL";
    ok(
      out.checks.returnCancellation === "PASS",
      "return delete failed to reverse stock",
    );
    await page
      .getByRole("button", { name: "Sales Invoice Ledger", exact: true })
      .first()
      .click();
    const search = page.getByPlaceholder(
      "Search by customer name or invoice number...",
    );
    await search.waitFor({ state: "visible", timeout: 15000 });
    await search.fill(invoice);
    await page
      .getByText("Invoice: " + invoice, { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    const history = await page.locator("body").innerText();
    out.checks.salesHistory =
      history.includes(invoice) && /9\.07/.test(history) ? "PASS" : "FAIL";
    ok(
      out.checks.salesHistory === "PASS",
      "sales history missing invoice/total",
    );
    await page.screenshot({
      path: path.join(dir, "authenticated-sales-history-desktop.png"),
      fullPage: true,
    });
    out.screenshots.push("authenticated-sales-history-desktop.png");
    const expNav = page.getByRole("button", {
      name: "Export Business Records",
      exact: true,
    });
    if (await expNav.count()) {
      await expNav.first().click();
      const exp = page
        .getByRole("button", { name: /Export \/ Save PDF/i })
        .first();
      await exp.waitFor({ state: "visible", timeout: 15000 });
      const responseWait = page
          .waitForResponse(
            (r) => r.url().includes("/api/reports/business-records"),
            { timeout: 30000 },
          )
          .catch(() => null),
        popupWait = page.waitForEvent("popup", { timeout: 10000 });
      await exp.click();
      const popup = await popupWait,
        apiResponse = await responseWait;
      await popup.waitForTimeout(1500);
      const text = await popup
        .locator("body")
        .innerText()
        .catch(() => "");
      out.checks.businessExport =
        apiResponse?.status() === 200 && text.length > 0 ? "PASS" : "FAIL";
      out.checks.exportContainsInvoice = text.includes(invoice);
      await popup
        .screenshot({
          path: path.join(dir, "authenticated-business-export-desktop.png"),
          fullPage: true,
        })
        .catch(() => {});
      out.screenshots.push("authenticated-business-export-desktop.png");
      await popup.close();
      ok(out.checks.businessExport === "PASS", "business export failed");
    } else out.checks.businessExport = "NOT RUN";
    out.checks.browserPageErrors = pageErrors;
  } catch (e) {
    fail = String(e?.message || e)
      .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]*\b/g, "[REDACTED_JWT]")
      .slice(0, 500);
  } finally {
    if (ctx)
      try {
        await ctx.close();
      } catch {}
    if (browser)
      try {
        await browser.close();
      } catch {}
    if (
      ((reqId && isUuid(reqId)) || (saleId && isUuid(saleId))) &&
      Number.isFinite(stockBefore)
    )
      try {
        if (!reqId && saleId) {
          const recovered = query(
            `select request_id from public.sales_transactions where organization_id=${lit(org)}::uuid and id=${lit(saleId)}::uuid limit 1`,
          );
          reqId = recovered?.request_id || null;
        }
        if (!reqId || !isUuid(reqId))
          throw Error("captured sale id did not resolve to request id");
        const returns =
          returnId && isUuid(returnId)
            ? `array[${lit(returnId)}::uuid]::uuid[]`
            : "'{}'::uuid[]";
        const missing = "'00000000-0000-0000-0000-000000000000'::uuid";
        const before = query(
          `select json_build_object('sales',(select count(*) from public.sales_transactions where organization_id=${lit(org)}::uuid and request_id=${lit(reqId)}::uuid),'returns',(select count(*) from public.sales_returns where id=any(${returns})),'returnItems',(select count(*) from public.sales_return_items where sales_return_id=any(${returns})))`,
        );
        if (!saleId) {
          const found = query(
            `select id from public.sales_transactions where organization_id=${lit(org)}::uuid and request_id=${lit(reqId)}::uuid limit 1`,
          );
          saleId = found.id || null;
        }
        const sid = saleId && isUuid(saleId) ? lit(saleId) + "::uuid" : missing;
        sql(
          `begin;do $$ declare o uuid:=${lit(org)}::uuid;r uuid:=${lit(reqId)}::uuid;s uuid[];p uuid[];t uuid[]:=${returns};begin select array_agg(id) into s from public.sales_transactions where organization_id=o and request_id=r;select array_agg(distinct cp.id) into p from public.customer_payments cp join public.customer_payment_allocations a on a.customer_payment_id=cp.id where a.sales_transaction_id=any(coalesce(s,'{}'::uuid[]));delete from public.sales_return_items where sales_return_id=any(t);delete from public.sales_returns where organization_id=o and id=any(t);delete from public.customer_payment_allocations where sales_transaction_id=any(coalesce(s,'{}'::uuid[]));delete from public.customer_payments where id=any(coalesce(p,'{}'::uuid[]));delete from public.sales_transactions where organization_id=o and request_id=r;delete from public.inventory_transactions where (reference_type='sales_transaction' and reference_id=any(coalesce(s,'{}'::uuid[]))) or (reference_type='sales_return' and reference_id=any(t));delete from public.audit_logs where organization_id=o and (entity_id=any(coalesce(s,'{}'::uuid[])) or entity_id=any(t) or new_values->>'request_id'=r::text);end $$;update public.products set current_stock=${Number(stockBefore)} where id=${lit(product)}::uuid and organization_id=${lit(org)}::uuid;commit;`,
        );
        const after = query(
          `select json_build_object('sales',(select count(*) from public.sales_transactions where organization_id=${lit(org)}::uuid and request_id=${lit(reqId)}::uuid),'items',(select count(*) from public.sales_items where sales_transaction_id=${sid}),'allocations',(select count(*) from public.customer_payment_allocations where sales_transaction_id=${sid}),'saleMoves',(select count(*) from public.inventory_transactions where reference_id=${sid}),'returns',(select count(*) from public.sales_returns where id=any(${returns})),'returnItems',(select count(*) from public.sales_return_items where sales_return_id=any(${returns})),'returnMoves',(select count(*) from public.inventory_transactions where reference_id=any(${returns})),'audits',(select count(*) from public.audit_logs where organization_id=${lit(org)}::uuid and (entity_id=${sid} or entity_id=any(${returns}) or new_values->>'request_id'=${lit(reqId)})),'stock',(select current_stock from public.products where id=${lit(product)}::uuid and organization_id=${lit(org)}::uuid))`,
        );
        const rows = [
          "sales",
          "items",
          "allocations",
          "saleMoves",
          "returns",
          "returnItems",
          "returnMoves",
          "audits",
        ].every((k) => Number(after[k]) === 0);
        cleanup = {
          status:
            rows && Math.abs(Number(after.stock) - stockBefore) < 0.000001
              ? "PASS"
              : "FAIL",
          before,
          after,
          expectedStock: stockBefore,
        };
        out.ids.requestId = reqId;
        if (saleId) out.ids.salesTransactionId = saleId;
        if (invoice) out.ids.invoiceNumber = invoice;
        if (returnId) out.ids.salesReturnId = returnId;
      } catch (e) {
        cleanup = {
          status: "FAIL",
          error: String(e?.message || e).slice(0, 300),
        };
      }
    out.cleanup = cleanup;
    out.debug.capturedIds = {
      requestId: String(reqId ?? "").slice(0, 80),
      salesTransactionId: String(saleId ?? "").slice(0, 80),
      invoiceNumber: String(invoice ?? "").slice(0, 40),
    };
    if (fail) out.failure = fail;
    if (cleanup.status === "FAIL")
      out.failure = [out.failure, "Scoped cleanup verification failed."]
        .filter(Boolean)
        .join(" ");
    process.stdout.write(JSON.stringify(out) + "\n");
    if (fail || cleanup.status === "FAIL") process.exitCode = 1;
  }
}
main().catch((e) => {
  process.stderr.write("FATAL " + String(e?.message || e).slice(0, 400) + "\n");
  process.exitCode = 1;
});
