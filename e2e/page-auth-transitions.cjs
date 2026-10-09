// Authenticated regression for the Home page hook order across account changes.
// Requires a locally isolated app and pre-existing synthetic owner accounts.
// No business transactions are created.
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

const projectRef = "rtfowunsyrdygyvubnvs";
const projectHost = `${projectRef}.supabase.co`;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function waitFor(predicate, message, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - start >= timeoutMs) return reject(new Error(`Timed out waiting for ${message}`));
      setTimeout(poll, 100);
    };
    poll();
  });
}

function asObject(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === "object" ? value : null;
}

async function main() {
  const baseURL = required("E2E_BASE_URL");
  assert.equal(required("E2E_TEST_PROJECT_REF"), projectRef, "E2E project must be the disposable project");
  const base = new URL(baseURL);
  assert.ok(
    base.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(base.hostname),
    "This regression only accepts a loopback app URL so its local target preflight can run",
  );

  // This endpoint is intentionally unavailable in production. It verifies the
  // app-side client and server URL configuration before any account sign-in.
  const preflight = await fetch(new URL("/api/pos-release-environment", base), {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(preflight.status, 200, "isolated app target preflight must succeed before browser login");
  const environment = await preflight.json();
  assert.ok(Array.isArray(environment.supabaseUrls) && environment.supabaseUrls.length > 0);
  const configuredHosts = [...new Set(environment.supabaseUrls.map((value) => new URL(value).host))];
  assert.deepEqual(configuredHosts, [projectHost], "app client and server URLs must target only the disposable project");

  const accounts = [
    {
      email: required("E2E_EMPTY_OWNER_EMAIL"),
      password: required("E2E_EMPTY_OWNER_PASSWORD"),
      organizationId: required("E2E_EMPTY_OWNER_ORG_ID"),
    },
    {
      email: required("E2E_SECOND_OWNER_EMAIL"),
      password: required("E2E_SECOND_OWNER_PASSWORD"),
      organizationId: required("E2E_SECOND_OWNER_ORG_ID"),
    },
  ];
  assert.notEqual(accounts[0].organizationId, accounts[1].organizationId, "account-switch fixture organizations must differ");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const unexpectedSupabaseHosts = new Set();
  const seenSupabaseHosts = new Set();
  const profileReads = [];
  const catalogReads = [];
  const provisionResponses = [];
  const preflightFailures = [];
  let verifiedAuthCount = 0;
  let profileRequestCount = 0;
  let phase = "logged-out render";
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/api/auth/provision") return;
    try {
      const result = await response.json();
      provisionResponses.push({
        ok: response.ok(),
        alreadyProvisioned: result?.alreadyProvisioned === true,
        organizationId: result?.organization_id ?? null,
      });
    } catch {
      provisionResponses.push({ ok: false, alreadyProvisioned: false, organizationId: null });
    }
  });

  await context.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    if (requestURL.hostname.includes("supabase")) {
      if (requestURL.hostname !== projectHost) {
        unexpectedSupabaseHosts.add(requestURL.hostname);
        await route.abort();
        return;
      }
      seenSupabaseHosts.add(requestURL.hostname);

      // Before returning the auth response to the app, verify this ordinary
      // user's existing profile with their own JWT. If the fixture is missing
      // or belongs to another organization, block login before the app's
      // provisioning endpoint can create an organization or profile.
      if (
        requestURL.pathname === "/auth/v1/token" &&
        requestURL.searchParams.get("grant_type") === "password" &&
        route.request().method() === "POST"
      ) {
        const response = await route.fetch();
        const body = await response.text();
        let session;
        try {
          session = JSON.parse(body);
        } catch {
          session = null;
        }
        if (response.ok()) {
          try {
            const expected = accounts[verifiedAuthCount];
            const userId = session?.user?.id;
            const token = session?.access_token;
            const anonKey = route.request().headers().apikey;
            assert.ok(expected && userId && token && anonKey, "ordinary-user login response must be complete");
            assert.equal(String(session.user.email).toLowerCase(), expected.email.toLowerCase());
            const profileResponse = await fetch(
              `https://${projectHost}/rest/v1/profiles?select=id,organization_id,role&id=eq.${encodeURIComponent(userId)}`,
              { headers: { apikey: anonKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
            );
            assert.equal(profileResponse.status, 200, "ordinary user must be able to read their own profile before app provisioning");
            const profiles = await profileResponse.json();
            assert.ok(Array.isArray(profiles) && profiles.length === 1, "synthetic owner profile must already exist");
            assert.equal(profiles[0].organization_id, expected.organizationId, "synthetic owner must belong to its expected organization");
            assert.equal(profiles[0].role, "owner", "synthetic account must have the owner role");
            verifiedAuthCount += 1;
          } catch {
            preflightFailures.push("ordinary synthetic account/profile preflight failed; app provisioning was blocked");
            await route.abort();
            return;
          }
        }
        await route.fulfill({ response, body });
        return;
      }

      const restMatch = requestURL.pathname.match(/^\/rest\/v1\/(profiles|products|customers)(?:$|\/)/);
      if (restMatch && route.request().method() === "GET") {
        const table = restMatch[1];
        if (table === "profiles") {
          profileRequestCount += 1;
          if (profileRequestCount === 1) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const response = await route.fetch();
        const body = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        const row = asObject(parsed);
        if (table === "profiles") {
          profileReads.push({ status: response.status(), organizationId: row?.organization_id ?? null, role: row?.role ?? null });
        } else {
          catalogReads.push({
            table,
            status: response.status(),
            rowCount: Array.isArray(parsed) ? parsed.length : null,
          });
        }
        await route.fulfill({ response, body });
        return;
      }
    }
    await route.continue();
  });

  const hookOrderErrors = () => pageErrors.filter((message) =>
    /react error #310|rendered (?:more|fewer) hooks|change in the order of hooks/i.test(message),
  );
  const assertNoHookOrderError = () => {
    assert.deepEqual(hookOrderErrors(), [], `hook-order error during ${phase}`);
  };

  async function signIn(account) {
    await page.goto(new URL("/login", base).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Email", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in to TradeOS" }).click();
  }

  try {
    phase = "logged-out to authenticated, profile loading";
    await page.goto(new URL("/login", base).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(accounts[0].email);
    await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
    await page.getByRole("button", { name: "Sign in to TradeOS" }).click();
    await waitFor(
      () => preflightFailures.length > 0 || profileRequestCount > 0 || hookOrderErrors().length > 0,
      "owner account preflight or profile transition",
    );
    assert.deepEqual(preflightFailures, [], "unknown or mismatched accounts must be rejected before app provisioning");
    assertNoHookOrderError();
    await waitFor(() => profileRequestCount > 0, "the delayed profile request");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assertNoHookOrderError();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assertNoHookOrderError();
    assert.deepEqual([...unexpectedSupabaseHosts], [], "browser requests must not reach another Supabase project");
    assert.deepEqual([...seenSupabaseHosts], [projectHost], "browser requests must use the disposable project");
    await expect(page.locator('[aria-label="Search sections and products"]:visible').first()).toBeVisible();
    await waitFor(() => profileReads.some((read) => read.organizationId === accounts[0].organizationId), "owner profile load");
    const firstProfileRead = profileReads.find((read) => read.organizationId === accounts[0].organizationId);
    assert.equal(firstProfileRead.status, 200);
    assert.equal(firstProfileRead.role, "owner");
    await waitFor(() => provisionResponses.length >= 1, "existing owner provisioning response");
    assert.equal(provisionResponses[0].ok, true);
    assert.equal(provisionResponses[0].alreadyProvisioned, true, "the first owner account must already be provisioned");
    assert.equal(provisionResponses[0].organizationId, accounts[0].organizationId);

    phase = "first-run guide visible to dismissed";
    const guideDismiss = page.getByRole("button", { name: "Do not show automatically again" });
    await expect(guideDismiss).toBeVisible();
    await guideDismiss.click();
    await expect(guideDismiss).toHaveCount(0);
    assertNoHookOrderError();

    phase = "empty organization data loaded and global search usable";
    await waitFor(
      () => catalogReads.some((read) => read.table === "products") && catalogReads.some((read) => read.table === "customers"),
      "empty organization product and customer reads",
    );
    for (const table of ["products", "customers"]) {
      const read = catalogReads.find((entry) => entry.table === table);
      assert.equal(read.status, 200, `${table} read must succeed`);
      assert.equal(read.rowCount, 0, `${table} must be empty for the designated synthetic organization`);
    }
    const search = page.locator('[aria-label="Search sections and products"]:visible').first();
    await search.fill("sales");
    await expect(page.getByText("Sales", { exact: true }).first()).toBeVisible();
    assertNoHookOrderError();

    phase = "logout and account change";
    await page.locator("header button:has(svg.lucide-user)").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

    phase = "second organization authentication and search state reset";
    await signIn(accounts[1]);
    await waitFor(() => preflightFailures.length > 0 || profileReads.length >= 2, "second owner account preflight and profile request");
    assert.deepEqual(preflightFailures, [], "second account must match its existing synthetic profile before app provisioning");
    await waitFor(
      () => profileReads.some((read) => read.organizationId === accounts[1].organizationId),
      "second organization profile load",
    );
    const secondProfileRead = profileReads.find((read) => read.organizationId === accounts[1].organizationId);
    assert.equal(secondProfileRead.status, 200);
    assert.equal(secondProfileRead.role, "owner");
    const secondSearch = page.locator('[aria-label="Search sections and products"]:visible').first();
    await expect(secondSearch).toBeVisible();
    await expect(secondSearch).toHaveValue("");
    await waitFor(() => provisionResponses.length >= 2, "second owner provisioning response");
    assert.equal(provisionResponses[1].ok, true);
    assert.equal(provisionResponses[1].alreadyProvisioned, true, "the second owner account must already be provisioned");
    assert.equal(provisionResponses[1].organizationId, accounts[1].organizationId);
    assert.equal(verifiedAuthCount, 2, "both ordinary accounts must pass read-only profile preflight");
    assertNoHookOrderError();
    assert.deepEqual([...unexpectedSupabaseHosts], []);
    console.log("page-auth-transitions PASS — target preflight, auth/profile transitions, empty catalogs, search, guide dismissal, logout, and organization switch");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.message : "unknown error";
  const safeDetails = [
    process.env.E2E_EMPTY_OWNER_EMAIL,
    process.env.E2E_EMPTY_OWNER_PASSWORD,
    process.env.E2E_SECOND_OWNER_EMAIL,
    process.env.E2E_SECOND_OWNER_PASSWORD,
  ].filter(Boolean).reduce((text, secret) => text.split(secret).join("[redacted]"), details)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[redacted-token]");
  console.error(`page-auth-transitions FAIL during test: ${safeDetails}`);
  process.exitCode = 1;
});
