#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone authenticated test runner. */
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");

const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
const { createServerClient } = requireFromProject("@supabase/ssr");
const { chromium } = require(path.resolve("e2e/node_modules/playwright"));
const TARGET_REF = "rtfowunsyrdygyvubnvs";
const TARGET_MARKER = "disposable-pos-atomic-sales";
const PSQL = process.env.POS_RELEASE_PSQL_PATH || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const env = process.env;
const api = env.POS_RELEASE_SUPABASE_URL;
const app = env.POS_RELEASE_APP_URL || "http://127.0.0.1:3002";
const ownerToken = env.POS_RELEASE_OWNER_ACCESS_TOKEN;
const ownerRefresh = env.POS_RELEASE_OWNER_REFRESH_TOKEN;
const organizationId = env.POS_RELEASE_ORGANIZATION_ID;
const productId = env.POS_RELEASE_AUTH_PRODUCT_ID;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uuid(value, label) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")), `${label} is not a UUID`);
  return value;
}

function db(sql, write = false) {
  const url = new URL(env.POS_RELEASE_TEST_DATABASE_URL || "");
  const databaseUser = decodeURIComponent(url.username);
  const apiProject = new URL(api || "").hostname.split(".")[0];
  assert(env.POS_RELEASE_TEST_TARGET === TARGET_MARKER, "test target marker mismatch");
  assert(apiProject === TARGET_REF && databaseUser.endsWith(`.${TARGET_REF}`), "API/database target mismatch");
  assert(url.hostname.endsWith("pooler.supabase.com") && url.pathname === "/postgres", "unexpected database endpoint");
  assert(env.PGPASSFILE && require("node:fs").existsSync(env.PGPASSFILE), "private PostgreSQL password file is unavailable");
  const result = spawnSync(PSQL, [
    "-X", "-w", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t", "-F", "\t",
    "-h", url.hostname, "-p", url.port || "5432", "-U", databaseUser, "-d", url.pathname.slice(1),
    "-c", write ? sql : `begin; set transaction read only; ${sql}; commit;`,
  ], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: { ...env, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "8", PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=5000" },
  });
  if (result.error || result.status !== 0) throw new Error("test database query failed");
  return String(result.stdout || "").trim();
}

async function apiRequest(url, method, token, body) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: env.POS_RELEASE_SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { response, payload };
}

async function browserCookies() {
  const updates = new Map();
  const supabase = createServerClient(api, env.POS_RELEASE_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => cookies.forEach((cookie) => updates.set(cookie.name, cookie)),
    },
  });
  const { error } = await supabase.auth.setSession({ access_token: ownerToken, refresh_token: ownerRefresh });
  assert(!error, "synthetic owner session could not be installed for the browser");
  await supabase.auth.getUser();
  assert(updates.size > 0, "Supabase session cookies were not generated");
  return [...updates.values()].map(({ name, value, options = {} }) => ({
    name,
    value,
    domain: "127.0.0.1",
    path: options.path || "/",
    sameSite: "Lax",
  }));
}

async function main() {
  assert(api && ownerToken && ownerRefresh && organizationId && productId, "protected synthetic test settings are incomplete");
  uuid(organizationId, "organization ID");
  uuid(productId, "product ID");
  const tokenClaims = JSON.parse(Buffer.from(ownerToken.split(".")[1], "base64url").toString("utf8"));
  assert(tokenClaims.role === "authenticated" && tokenClaims.app_metadata?.organization_id === organizationId, "ordinary owner JWT organization claims are invalid");
  const targetProof = db("select current_database()||'|'||current_setting('server_version_num')||'|'||current_setting('transaction_read_only')||'|'||(select marker from public.pos_release_test_marker)");
  const [databaseName, versionNum, readOnly, marker] = targetProof.split("|");
  assert(databaseName === "postgres" && Math.floor(Number(versionNum) / 10000) === 17 && readOnly === "on" && marker === TARGET_MARKER, "direct database target identity did not pass");

  const auth = await fetch(`${new URL(api).origin}/auth/v1/user`, {
    headers: { apikey: env.POS_RELEASE_SUPABASE_ANON_KEY, authorization: `Bearer ${ownerToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const authUser = await auth.json().catch(() => ({}));
  assert(auth.ok && authUser.id === tokenClaims.sub, "ordinary synthetic owner session is invalid");

  const appProof = await fetch(`${app}/api/pos-release-environment`, { signal: AbortSignal.timeout(15000) });
  const appState = appProof.ok ? await appProof.json().catch(() => ({})) : {};
  assert(appProof.status === 200 && appState.supabaseUrls?.length && appState.supabaseUrls.every((url) => new URL(url).hostname === `${TARGET_REF}.supabase.co`), "app instance does not identify the disposable target");

  const startStock = db(`select current_stock::numeric(18,6)::text from public.products where id='${productId}'::uuid and organization_id='${organizationId}'::uuid`);
  const packSize = db(`select units_per_pack::text from public.products where id='${productId}'::uuid and organization_id='${organizationId}'::uuid`);
  assert(startStock && packSize === "12", "synthetic fractional product fixture is unavailable");
  const runMarker = `PRUI-${Date.now().toString(36).toUpperCase()}`;
  const supplierName = `${runMarker} synthetic supplier`;
  let supplierId = null;
  let returnId = null;
  let browser;
  let workflowError = null;
  let cleanupStatus = "NOT RUN";

  try {
    const supplier = await apiRequest(`${new URL(api).origin}/rest/v1/suppliers?select=id,supplier_name`, "POST", ownerToken, {
      organization_id: organizationId,
      supplier_name: supplierName,
      is_active: true,
    });
    assert(supplier.response.ok && Array.isArray(supplier.payload) && supplier.payload.length === 1, `ordinary-user synthetic supplier setup failed (HTTP ${supplier.response.status})`);
    supplierId = uuid(supplier.payload[0].id, "supplier ID");

    const create = await fetch(`${app}/api/purchases/returns`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        supplierId,
        returnDate: new Date().toISOString().slice(0, 10),
        reason: runMarker,
        lines: [{ productId, quantity: "1.50", unitPrice: "20.00", unitMode: "subunit" }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const created = await create.json().catch(() => ({}));
    assert(create.ok && created.ok === true, `authenticated purchase-return API failed (HTTP ${create.status})`);
    returnId = uuid(created.returnId, "purchase-return ID");
    const returnNumber = String(created.returnNumber || "");
    assert(returnNumber.length > 0, "purchase-return API did not return its invoice number");

    const afterCreate = db(`select current_stock::numeric(18,6)::text from public.products where id='${productId}'::uuid and organization_id='${organizationId}'::uuid`);
    const createEvidence = db(`select (select count(*) from public.purchase_returns where id='${returnId}'::uuid and organization_id='${organizationId}'::uuid)::text||'|'||(select count(*) from public.purchase_return_items where purchase_return_id='${returnId}'::uuid)::text||'|'||(select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id='${returnId}'::uuid)::text||'|'||(select coalesce(sum(quantity_delta),0)::numeric(18,6)::text from public.inventory_transactions where reference_type='purchase_return' and reference_id='${returnId}'::uuid)`);
    assert(Number(afterCreate) === Number(startStock) - 0.125, "API return did not apply the expected fractional stock effect");
    assert(createEvidence === "1|1|1|-0.125000", "API return did not create exactly one header, line, and stock ledger effect");
    process.stdout.write("PASS authenticated purchase-return API creates a same-organization fractional return (ordinary owner JWT)\n");

    browser = await chromium.launch({
      headless: true,
      executablePath: env.POS_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(await browserCookies());
    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${app}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.getByRole("heading", { name: "Business Overview" }).waitFor({ state: "visible", timeout: 45000 });
    const purchaseNavigation = page.getByRole("button", { name: /^Purchases$/ }).first();
    await purchaseNavigation.waitFor({ state: "visible", timeout: 20000 });
    await purchaseNavigation.click();
    await page.getByRole("heading", { name: "Purchase Invoice" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Returns", exact: true }).click();
    await page.getByRole("heading", { name: "Create Purchase Return" }).waitFor({ state: "visible", timeout: 15000 });
    const row = page.getByRole("listitem").filter({ hasText: returnNumber });
    await row.getByRole("button", { name: "Delete", exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await row.waitFor({ state: "detached", timeout: 30000 });
    assert(pageErrors.length === 0, "purchase-return UI raised a browser runtime error");

    const restoredStock = db(`select current_stock::numeric(18,6)::text from public.products where id='${productId}'::uuid and organization_id='${organizationId}'::uuid`);
    const deleteEvidence = db(`select (select count(*) from public.purchase_returns where id='${returnId}'::uuid)::text||'|'||(select count(*) from public.purchase_return_items where purchase_return_id='${returnId}'::uuid)::text||'|'||(select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id='${returnId}'::uuid)::text||'|'||(select coalesce(sum(quantity_delta),0)::numeric(18,6)::text from public.inventory_transactions where reference_type='purchase_return' and reference_id='${returnId}'::uuid)`);
    assert(restoredStock === startStock, "UI deletion did not restore original stock");
    assert(deleteEvidence === "0|0|2|0.000000", "UI deletion did not leave one balanced stock reversal");
    process.stdout.write("PASS authenticated purchase-return UI lists and deletes the return with exactly one stock reversal\n");
    process.stdout.write("PASS browser check used Chrome at 1440px; native printing was not exercised\n");
  } catch (error) {
    workflowError = error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      const escapedName = supplierName.replaceAll("'", "''");
      const escapedMarker = runMarker.replaceAll("'", "''");
      const discoveredIds = db(`select id::text from public.purchase_returns where organization_id='${organizationId}'::uuid and reason='${escapedMarker}'`).split(/\r?\n/).filter(Boolean);
      const cleanupIds = [...new Set([...discoveredIds, ...(returnId ? [returnId] : [])])].map((id) => uuid(id, "cleanup return ID"));
      const cleanupIdList = cleanupIds.length ? cleanupIds.map((id) => `'${id}'::uuid`).join(",") : "null::uuid";
      db(`begin; set local statement_timeout='10s'; delete from public.purchase_returns where organization_id='${organizationId}'::uuid and (reason='${escapedMarker}' or id in (${cleanupIdList})); delete from public.inventory_transactions where reference_type='purchase_return' and reference_id in (${cleanupIdList}); delete from public.suppliers where organization_id='${organizationId}'::uuid and supplier_name='${escapedName}'; commit`, true);
      const finalStock = db(`select current_stock::numeric(18,6)::text from public.products where id='${productId}'::uuid and organization_id='${organizationId}'::uuid`);
      const remaining = db(`select (select count(*) from public.purchase_returns where organization_id='${organizationId}'::uuid and reason='${escapedMarker}')::text||'|'||(select count(*) from public.purchase_returns where id in (${cleanupIdList}))::text||'|'||(select count(*) from public.purchase_return_items where purchase_return_id in (${cleanupIdList}))::text||'|'||(select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id in (${cleanupIdList}))::text||'|'||(select count(*) from public.suppliers where organization_id='${organizationId}'::uuid and supplier_name='${escapedName}')::text`);
      assert(finalStock === startStock && remaining === "0|0|0|0|0", "scoped cleanup or stock restoration did not verify");
      cleanupStatus = "PASS";
      process.stdout.write("PASS exact synthetic return/supplier cleanup and stock restoration\n");
    } catch {
      cleanupStatus = "FAIL";
      workflowError ||= new Error("purchase-return test cleanup could not be verified");
      process.stderr.write("FAIL purchase-return cleanup verification\n");
    }
  }

  if (workflowError) {
    process.stderr.write(`FAIL authenticated purchase-return workflow (${cleanupStatus} cleanup): ${workflowError.message}\n`);
    process.exitCode = 1;
    return;
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL authenticated purchase-return workflow: ${error.message}\n`);
  process.exitCode = 1;
});
