// Slice 1b Playwright browser flows — Aankh email-link auth (HYBRID Slice 1b).
//
// REPO COPY of ~/workspace/slice1b-playwright/run-slice1b-flows.mjs, for the
// slice1b-admin-tests CI workflow. Flows, assertions, guards and the
// no-secret-logging rule are IDENTICAL — only the paths changed (this copy
// lives in scripts/, so the repo root is one level up, and results land
// next to the screenshots in slice1b-playwright/ for artifact upload).
//
// What this proves, in a real browser against the LOCAL dev server
// (http://localhost:3000, disposable Supabase project only):
//   (a) Google sign-in: the Google button starts the OAuth redirect.
//   (b) Email signup: confirmation link opened in a DIFFERENT browser
//       context lands on onboarding (fresh user); desktop-origin variant
//       shows the exact "Email verify ho gayi..." screen.
//   (c) Email sign-in with a confirmed user reaches the dashboard.
//   (d) Password recovery: link in the other context -> /reset form ->
//       new password -> dashboard; old password fails, new works.
//   (e) /reset with NO session shows the expired screen.
//   (f) Legacy ?code= link shows the clear "can't be used in this
//       browser" screen, never a silent bounce to /login.
//   (g) No regression: Google button present + OAuth starts; staff
//       Profile-ID login page loads and an invalid Profile-ID shows a
//       clean error (no crash).
//
// Links are built from auth.admin.generateLink (hashed_token) exactly as
// the emailed link carries them: /auth/callback?token_hash=...&type=...
// (plus &origin=aankh://auth/callback for the desktop variant). No real
// email is needed. Two browser contexts model "signup in one browser,
// link opened in another".
//
// GATING: the admin flows (b, b2, c, d) need the service key in BOTH
// headers from TWO vault surrogates — SUPABASE_SERVICE_ROLE_KEY_APIKEY
// (apikey placement) and SUPABASE_SERVICE_ROLE_KEY_BEARER (bearer
// placement). The script probes FIRST (GET /auth/v1/admin/users, expect
// 200) and fails fast with exit code 2 when the key is not stored — it
// never runs the flows against a bad/absent key.
//   --no-admin-only  runs only the flows that need no admin key
//   (a, e, f, g); the probe is attempted and reported but non-fatal.
//
// Run (CI): the slice1b-admin-tests workflow starts the dev server on the
// disposable env, installs Playwright + Chromium, then runs:
//   node scripts/playwright-slice1b-flows.mjs [--no-admin-only]
// Manual run: set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// (disposable .env.local) plus SUPABASE_SERVICE_ROLE_KEY_APIKEY and
// SUPABASE_SERVICE_ROLE_KEY_BEARER to the real disposable service key,
// start `npm run dev` on :3000 first, then run the command above.
//
// DISPOSABLE PROJECT ONLY: refuses to run unless the Supabase URL is the
// disposable project (rtfowunsyrdygyvubnvs). Never run against production:
// it creates real auth users (all slice1b-test- markers) and deletes them
// again afterwards.
//
// NEVER logs any key, token, surrogate, hash or password — only HTTP
// statuses, URLs with token material stripped, headings and pass/fail.

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SHOT_DIR = join(REPO, "slice1b-playwright");

const BASE_URL = process.env.SLICE1B_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY_APIKEY = process.env.SUPABASE_SERVICE_ROLE_KEY_APIKEY ?? "";
const SERVICE_KEY_BEARER = process.env.SUPABASE_SERVICE_ROLE_KEY_BEARER ?? "";
const NO_ADMIN_ONLY = process.argv.includes("--no-admin-only");

const DESKTOP_MSG = "Email verify ho gayi, ab Aankh app mein sign in karein.";
const RESET_EXPIRED =
  "This password reset link is missing or has expired. Please request a new one.";
const PKCE_MSG = "This link can't be used in this browser";

const results = [];
function record(id, name, status, evidence) {
  results.push({ id, name, status, evidence });
  console.log(`${status} ${id}. ${name} — ${evidence}`);
}

function stripTokenParams(rawUrl) {
  try {
    const u = new URL(rawUrl);
    for (const k of ["token_hash", "code", "access_token", "refresh_token"]) u.searchParams.delete(k);
    return `${u.origin}${u.pathname}${u.search ? u.search : ""}`;
  } catch {
    return "(unparseable url)";
  }
}

const looksLikeServiceKey = (v) =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) || v.startsWith("hsurr:");

async function probeAdmin() {
  if (!SERVICE_KEY_APIKEY || !SERVICE_KEY_BEARER) {
    return { ok: false, status: null, reason: "surrogate env vars not set" };
  }
  if (!looksLikeServiceKey(SERVICE_KEY_APIKEY) || !looksLikeServiceKey(SERVICE_KEY_BEARER)) {
    return { ok: false, status: null, reason: "surrogate value is not a JWT or hsurr: (dummy sentinel?)" };
  }
  let status = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: SERVICE_KEY_APIKEY, Authorization: `Bearer ${SERVICE_KEY_BEARER}` },
    });
    status = res.status;
  } catch (err) {
    return { ok: false, status, reason: `probe request failed: ${err.message}` };
  }
  return status === 200
    ? { ok: true, status, reason: "" }
    : { ok: false, status, reason: `expected HTTP 200, got HTTP ${status}` };
}

// The admin client must send the service key in BOTH headers, from TWO
// surrogates (same pattern as scripts/test-email-auth-regression.ts).
const adminFetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_KEY_APIKEY);
  headers.set("Authorization", `Bearer ${SERVICE_KEY_BEARER}`);
  return fetch(input, { ...init, headers });
};
const admin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY_APIKEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: adminFetch },
  });

const suffix = () => randomBytes(4).toString("hex");
const testPassword = () => `Slice1b_${randomBytes(6).toString("base64url")}X1!`;
const trackedUserIds = [];
async function deleteUserByEmail(email) {
  try {
    const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
    const hit = (data?.users ?? []).find((u) => u.email === email);
    if (hit) {
      await admin().auth.admin.deleteUser(hit.id);
      console.log(`  cleanup: deleted test user ${email}`);
    }
  } catch {
    console.log(`  cleanup: could not delete test user ${email} (manual cleanup may be needed)`);
  }
}

async function shot(page, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = join(SHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

async function hasSession(page) {
  // Presence only — never read or log token values.
  return await page.evaluate(() => {
    try {
      return Object.keys(localStorage).some((k) => k.endsWith("-auth-token"));
    } catch {
      return false;
    }
  });
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log("BLOCKED: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (export the disposable .env.local first).");
    process.exit(2);
  }
  if (!SUPABASE_URL.includes("rtfowunsyrdygyvubnvs")) {
    console.log("BLOCKED: refusing to run — NEXT_PUBLIC_SUPABASE_URL is not the disposable project.");
    process.exit(2);
  }
  const loginRes = await fetch(`${BASE_URL}/login`).catch(() => null);
  console.log(`dev server check: GET ${BASE_URL}/login -> HTTP ${loginRes ? loginRes.status : "unreachable"}`);
  if (!loginRes || loginRes.status !== 200) {
    console.log("BLOCKED: dev server is not up on :3000 (start it first).");
    process.exit(2);
  }

  // ── Probe gate ──
  const probe = await probeAdmin();
  console.log(
    `admin probe: GET /auth/v1/admin/users -> HTTP ${probe.status ?? "n/a"}${probe.ok ? " (OK)" : ` (BLOCKED: ${probe.reason})`}`,
  );
  if (!probe.ok && !NO_ADMIN_ONLY) {
    console.log(
      "BLOCKED: bearer key not stored yet (Track A). No flows ran. " +
        "Re-run once SUPABASE_SERVICE_ROLE_KEY_APIKEY and SUPABASE_SERVICE_ROLE_KEY_BEARER are supplied by the vault wrapper.",
    );
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const runId = Date.now().toString(36);
  let webUser = null; // { email, password } — confirmed via the web flow (b)
  let recoveryUser = null;

  // Browser -> Supabase preflight (full mode only): every browser-side
  // auth call (signUp / signIn / verifyOtp) fetches Supabase from the
  // browser. In this sandbox that path can be blocked (egress proxy
  // tunnel failure) even though node-side calls work. Fail fast with a
  // clear message instead of producing misleading flow FAILs.
  if (!NO_ADMIN_ONLY) {
    const probeCtx = await browser.newContext();
    const probePage = await probeCtx.newPage();
    const net = await probePage.evaluate(async (url) => {
      try {
        const res = await fetch(`${url}/auth/v1/health`);
        return `HTTP ${res.status}`;
      } catch {
        return "UNREACHABLE";
      }
    }, SUPABASE_URL).catch(() => "UNREACHABLE");
    await probeCtx.close();
    console.log(`browser -> Supabase preflight: ${net}`);
    if (net === "UNREACHABLE") {
      console.log(
        "BLOCKED: this sandbox's browser cannot reach Supabase (fetch from the page fails). " +
          "Admin flows need a browser network path to Supabase — run on a machine with direct internet, " +
          "or arrange a proxied browser launch. No admin flows ran.",
      );
      await browser.close();
      process.exit(2);
    }
  }

  try {
    // ── (a) Google sign-in: button present, OAuth redirect starts ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      const googleBtn = page.getByRole("button", { name: /Continue with Google/i });
      const present = await googleBtn.isVisible().catch(() => false);
      record("a0", "Google button present on /login", present ? "PASS" : "FAIL", present ? "button visible" : "button NOT found");
      if (present) {
        await shot(page, "a-google-button.png");
        // The OAuth redirect is a full-page navigation to Supabase's
        // authorize URL (then Google). Observe the authorize REQUEST
        // itself (issued or failed) — in a sandbox whose browser cannot
        // reach Supabase, the request still proves the app started OAuth;
        // reaching Google's page needs a working browser network path.
        let authorizeSeen = "";
        const onReq = (r) => {
          if (/\/auth\/v1\/authorize\?provider=google/.test(r.url())) authorizeSeen = "authorize request issued";
        };
        const onReqFail = (r) => {
          if (/\/auth\/v1\/authorize\?provider=google/.test(r.url())) {
            authorizeSeen = `authorize request issued but page load failed (${r.failure()?.errorText ?? "?"})`;
          }
        };
        page.on("request", onReq);
        page.on("requestfailed", onReqFail);
        await googleBtn.click();
        let dest = "";
        try {
          await page.waitForURL((u) => !u.hostname.includes("localhost"), { timeout: 20000 });
          dest = stripTokenParams(page.url());
        } catch {
          dest = stripTokenParams(page.url());
        }
        await page.waitForTimeout(2000);
        const host = (() => { try { return new URL(page.url()).host; } catch { return "?"; } })();
        const reachedGoogle = /accounts\.google\.com|supabase\.co/.test(host) && host !== "chrome-error://chromewebdata";
        await shot(page, "a-google-redirect.png");
        record(
          "a",
          "Google sign-in starts the OAuth redirect",
          authorizeSeen ? "PASS" : "FAIL",
          authorizeSeen
            ? reachedGoogle
              ? `left localhost, now at host ${host} — full Google sign-in NOT attempted (no test Google account; automation defenses may block it)`
              : `${authorizeSeen}; Google's page was NOT reached from this sandbox (browser network path blocked) — redirect start verified, landing not verified`
            : `no authorize request observed (still at ${dest})`,
        );
      } else {
        record("a", "Google sign-in starts the OAuth redirect", "FAIL", "no Google button to click");
      }
      await ctx.close();
    }

    // ── (e) /reset with NO session -> expired screen ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/reset`, { waitUntil: "domcontentloaded" });
      // The page polls for a session for up to ~4s before declaring the
      // link expired — wait for the expired text, not a fixed delay.
      let expiredShown = false;
      try {
        await page.getByText(RESET_EXPIRED, { exact: false }).waitFor({ timeout: 15000 });
        expiredShown = true;
      } catch {
        expiredShown = false;
      }
      const bodyText = (await page.textContent("body")) ?? "";
      const formShown = (await page.locator('input[type="password"]').count()) > 0;
      await shot(page, "e-reset-no-session.png");
      record(
        "e",
        "/reset with no session shows the expired screen",
        expiredShown && !formShown ? "PASS" : "FAIL",
        expiredShown
          ? formShown ? "expired text shown BUT password form also present" : "expired text shown, no password form"
          : `expired text NOT found (page text starts: ${bodyText.slice(0, 120).replace(/\s+/g, " ")})`,
      );
      await ctx.close();
    }

    // ── (f) Legacy ?code= link -> clear cross-browser error, never /login ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/auth/callback?code=bogus-code-123&type=email`, { waitUntil: "domcontentloaded" });
      // Wait for whichever error screen settles (the callback takes ~2s
      // on the PKCE path, and the no-token path is near-instant).
      await page.waitForTimeout(6000);
      const h1 = (await page.locator("h1").first().textContent().catch(() => "")) ?? "";
      const path = (() => { try { return new URL(page.url()).pathname; } catch { return "?"; } })();
      await shot(page, "f-legacy-code.png");
      const noBounce = path === "/auth/callback";
      record(
        "f1",
        "legacy ?code= link shows a clear error screen, never a silent bounce to /login",
        h1.length > 0 && noBounce ? "PASS" : "FAIL",
        h1 ? `error screen "${h1}" on ${path}` : `no error heading found; final URL ${stripTokenParams(page.url())}`,
      );
      record(
        "f2",
        "legacy ?code= link shows the exact cross-browser error title",
        h1 === PKCE_MSG ? "PASS" : "FAIL",
        h1 === PKCE_MSG
          ? "exact title shown"
          : `title shown is "${h1 || "(none)"}" — in dev this is consistent with React StrictMode ` +
            `double-invoking the callback effect (first run strips ?code= from the URL, second run finds no ` +
            `code and reports the link expired); the production build does not double-invoke effects, so the ` +
            `exact PKCE title needs a production-build confirmation`,
      );
      await ctx.close();
    }

    // ── (g) Staff Profile-ID login: page loads, invalid ID -> clean error ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      const staffTab = page.getByRole("button", { name: "Profile ID", exact: true });
      const tabVisible = await staffTab.isVisible().catch(() => false);
      if (!tabVisible) {
        record("g", "staff Profile-ID login shows a clean error for an invalid ID", "FAIL", "Profile ID tab NOT found on /login");
      } else {
        await staffTab.click();
        await page.getByPlaceholder("e.g. ALI01").fill("NOPE01");
        const pw = page.locator('input[type="password"]').first();
        await pw.fill("WrongPass123!");
        await shot(page, "g-staff-before-submit.png");
        await page.getByRole("button", { name: /Sign in to Aankh/i }).click();
        // The staff login API is slow on first compile (~4s observed);
        // wait for the submit button to return to idle before judging.
        let idle = false;
        try {
          await page.getByRole("button", { name: "Sign in to Aankh", exact: true }).waitFor({ timeout: 30000 });
          idle = true;
        } catch {
          idle = false;
        }
        const bodyText = (await page.textContent("body")) ?? "";
        const stillLogin = (() => { try { return new URL(page.url()).pathname === "/login"; } catch { return false; } })();
        const responsive = await page.getByRole("button", { name: /Sign in to Aankh/i }).isVisible().catch(() => false);
        // Any visible error copy counts as a clean error; absence of one
        // with no navigation is still a non-crash, but is recorded as FAIL
        // because the user gets no feedback.
        const errorShown = /not found|invalid|incorrect|wrong|failed|does not exist|no .*profile/i.test(bodyText);
        await shot(page, "g-staff-invalid-id.png");
        record(
          "g",
          "staff Profile-ID login shows a clean error for an invalid ID",
          idle && stillLogin && responsive && errorShown ? "PASS" : "FAIL",
          !idle ? "submit stayed in loading state for 30s (request never settled)"
            : stillLogin
              ? responsive
                ? errorShown ? "stayed on /login, error shown, page still responsive" : "stayed on /login but NO error text visible"
                : "page unresponsive after submit"
              : `left /login unexpectedly (now at ${stripTokenParams(page.url())})`,
        );
      }
      await ctx.close();
    }

    if (NO_ADMIN_ONLY) {
      console.log("NO-ADMIN-ONLY mode: admin flows (b, b2, c, d) skipped by flag.");
    } else {
      const adminClient = admin();

      // ── (b) Email signup in ctx A, confirmation link in ctx B -> onboarding ──
      {
        const email = `slice1b-test-web-${runId}@example.invalid`;
        const password = testPassword();
        const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const pageA = await ctxA.newPage();
        await pageA.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        await pageA.getByRole("button", { name: "Sign up", exact: true }).click();
        await pageA.getByPlaceholder("John Doe").fill("Slice Test");
        await pageA.getByPlaceholder("m@example.com").fill(email);
        await pageA.getByPlaceholder("Create a password").fill(password);
        await pageA.getByPlaceholder("Confirm your password").fill(password);
        await pageA.getByRole("button", { name: "Create account" }).click();
        let verifyShown = false;
        try {
          await pageA.getByRole("heading", { name: /Verify your email/i }).waitFor({ timeout: 15000 });
          verifyShown = true;
        } catch {
          verifyShown = false;
        }
        await shot(pageA, "b-signup-verify-view.png");
        record("b0", "UI signup submits and shows the verify-email view", verifyShown ? "PASS" : "FAIL",
          verifyShown ? "verify view shown in signup context" : `verify view NOT shown (now at ${stripTokenParams(pageA.url())})`);

        // Build the confirmation link the email would carry. generateLink
        // for an already-registered (unconfirmed) user may error; then
        // delete + regenerate so the callback flow itself is still tested.
        let link = await adminClient.auth.admin.generateLink({ type: "signup", email, password });
        let regenPath = "generateLink on the UI-created user";
        if (link.error) {
          console.log(`  note: generateLink(signup) on UI-created user failed (${link.error.message}); deleting + regenerating`);
          await deleteUserByEmail(email);
          link = await adminClient.auth.admin.generateLink({ type: "signup", email, password });
          regenPath = "delete + regenerate (generateLink errored on the existing unconfirmed user)";
        }
        if (link.error || !link.data?.properties?.hashed_token) {
          record("b", "email signup confirmation link in the other context lands on onboarding", "FAIL",
            `generateLink failed: ${link.error?.message ?? "no hashed_token returned"}`);
        } else {
          trackedUserIds.push(link.data.user.id);
          const cb = new URL(`${BASE_URL}/auth/callback`);
          cb.searchParams.set("token_hash", link.data.properties.hashed_token);
          cb.searchParams.set("type", "email");
          const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const pageB = await ctxB.newPage();
          await pageB.goto(cb.toString(), { waitUntil: "domcontentloaded" });
          try {
            await pageB.waitForURL((u) => u.pathname !== "/auth/callback", { timeout: 20000 });
          } catch { /* record what we actually see below */ }
          await pageB.waitForTimeout(1500);
          const finalPath = (() => { try { return new URL(pageB.url()).pathname; } catch { return "?"; } })();
          const bodyB = (await pageB.textContent("body")) ?? "";
          const onboardingShown = finalPath === "/onboarding" && /Welcome!/.test(bodyB);
          const sessionPresent = await hasSession(pageB);
          await shot(pageB, "b-callback-landing.png");
          if (onboardingShown) {
            record("b", "email signup confirmation link in the other context lands on onboarding", "PASS",
              `landed on /onboarding with Welcome! heading (${regenPath}); session present in link context`);
            webUser = { email, password };
          } else {
            // Diagnose the fall-through: is the session valid anyway?
            let homePath = "?";
            try {
              await pageB.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
              await pageB.waitForTimeout(2000);
              homePath = (() => { try { return new URL(pageB.url()).pathname; } catch { return "?"; } })();
            } catch { /* keep homePath */ }
            await shot(pageB, "b-callback-fallthrough-home.png");
            record("b", "email signup confirmation link in the other context lands on onboarding", "FAIL",
              `landed on ${finalPath} (not /onboarding); session present in link context: ${sessionPresent}; ` +
              `navigating to / from there lands on ${homePath}. ` +
              `Suspect: local /api/auth/provision fails (disposable .env.local holds the dummy service key), ` +
              `so the callback's catch routes to /login — check dev-server.log for the provision error. ` +
              `(${regenPath})`);
            // The user IS confirmed at this point (verifyOtp succeeded), so
            // it can still serve the sign-in flow even if routing failed.
            if (sessionPresent) webUser = { email, password };
          }
          await ctxB.close();
        }
        await ctxA.close();
      }

      // ── (b2) Desktop-origin signup -> exact desktop message ──
      {
        const email = `slice1b-test-desktop-${runId}@example.invalid`;
        const password = testPassword();
        const link = await adminClient.auth.admin.generateLink({ type: "signup", email, password });
        if (link.error || !link.data?.properties?.hashed_token) {
          record("b2", "desktop-origin signup shows the exact desktop verified message", "FAIL",
            `generateLink failed: ${link.error?.message ?? "no hashed_token returned"}`);
        } else {
          trackedUserIds.push(link.data.user.id);
          const cb = new URL(`${BASE_URL}/auth/callback`);
          cb.searchParams.set("token_hash", link.data.properties.hashed_token);
          cb.searchParams.set("type", "email");
          cb.searchParams.set("origin", "aankh://auth/callback");
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const page = await ctx.newPage();
          await page.goto(cb.toString(), { waitUntil: "domcontentloaded" });
          let shown = false;
          try {
            await page.getByText(DESKTOP_MSG, { exact: true }).waitFor({ timeout: 15000 });
            shown = true;
          } catch {
            shown = false;
          }
          await page.waitForTimeout(1000);
          await shot(page, "b2-desktop-origin.png");
          record("b2", "desktop-origin signup shows the exact desktop verified message", shown ? "PASS" : "FAIL",
            shown ? "exact desktop message shown" : `message NOT shown (now at ${stripTokenParams(page.url())})`);
          await ctx.close();
        }
      }

      // ── (c) Email sign-in -> dashboard ──
      if (!webUser) {
        record("c", "email sign-in reaches the dashboard", "BLOCKED", "no confirmed web user available (flow b did not produce one)");
      } else {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        await page.getByPlaceholder("m@example.com").fill(webUser.email);
        await page.locator('input[type="password"]').first().fill(webUser.password);
        await page.getByRole("button", { name: /Sign in to Aankh/i }).click();
        try {
          await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20000 });
        } catch { /* record below */ }
        await page.waitForTimeout(1500);
        const finalPath = (() => { try { return new URL(page.url()).pathname; } catch { return "?"; } })();
        await shot(page, "c-signin-landing.png");
        record("c", "email sign-in reaches the dashboard", finalPath === "/" || finalPath === "/onboarding" ? "PASS" : "FAIL",
          finalPath === "/" ? "landed on / (dashboard)"
            : finalPath === "/onboarding" ? "landed on /onboarding (fresh user, no org yet — acceptable)"
            : `still on ${finalPath}`);
        recoveryUser = webUser;
        await ctx.close();
      }

      // ── (d) Recovery: link in other context -> /reset -> new password ──
      if (!recoveryUser) {
        record("d", "password recovery sets a new password and signs in", "BLOCKED", "no confirmed user available (flow c did not produce one)");
      } else {
        const newPassword = testPassword();
        // Request the reset through the UI (forgot view) in ctx A.
        const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const pageA = await ctxA.newPage();
        await pageA.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        await pageA.getByRole("button", { name: /Forgot password\?/i }).click();
        await pageA.getByPlaceholder("m@example.com").fill(recoveryUser.email);
        await pageA.locator('button[type="submit"]').first().click();
        await pageA.waitForTimeout(3000);
        const forgotText = (await pageA.textContent("body")) ?? "";
        const forgotOk = !/error|failed/i.test(forgotText.slice(0, 400)) || /sent|check/i.test(forgotText);
        await shot(pageA, "d-forgot-request.png");
        record("d0", "forgot-password request submits without an error", forgotOk ? "PASS" : "FAIL",
          forgotOk ? "forgot view submitted" : "forgot view showed an error");
        await ctxA.close();

        const link = await adminClient.auth.admin.generateLink({ type: "recovery", email: recoveryUser.email });
        if (link.error || !link.data?.properties?.hashed_token) {
          record("d", "password recovery sets a new password and signs in", "FAIL",
            `generateLink(recovery) failed: ${link.error?.message ?? "no hashed_token returned"}`);
        } else {
          const cb = new URL(`${BASE_URL}/auth/callback`);
          cb.searchParams.set("token_hash", link.data.properties.hashed_token);
          cb.searchParams.set("type", "recovery");
          const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const pageB = await ctxB.newPage();
          await pageB.goto(cb.toString(), { waitUntil: "domcontentloaded" });
          let formShown = false;
          try {
            await pageB.waitForURL((u) => u.pathname === "/reset", { timeout: 20000 });
            await pageB.getByPlaceholder("Create a password").waitFor({ timeout: 10000 });
            formShown = true;
          } catch {
            formShown = false;
          }
          await shot(pageB, "d-reset-form.png");
          if (!formShown) {
            record("d", "password recovery sets a new password and signs in", "FAIL",
              `recovery link did not reach the /reset form (now at ${stripTokenParams(pageB.url())})`);
          } else {
            await pageB.getByPlaceholder("Create a password").fill(newPassword);
            await pageB.getByPlaceholder("Repeat your new password").fill(newPassword);
            await pageB.getByRole("button", { name: "Reset password" }).click();
            let successShown = false;
            try {
              await pageB.getByRole("button", { name: /dashboard/i }).waitFor({ timeout: 15000 });
              successShown = true;
            } catch {
              successShown = false;
            }
            await shot(pageB, "d-reset-success.png");
            if (!successShown) {
              record("d", "password recovery sets a new password and signs in", "FAIL", "new password submit did not reach the success screen");
            } else {
              await pageB.getByRole("button", { name: /dashboard/i }).click();
              await pageB.waitForTimeout(2000);
              const dashPath = (() => { try { return new URL(pageB.url()).pathname; } catch { return "?"; } })();
              const dashOk = dashPath === "/" || dashPath === "/onboarding";
              // Old password must fail, new password must work (fresh ctx).
              const ctxC = await browser.newContext({ viewport: { width: 1280, height: 800 } });
              const pageC = await ctxC.newPage();
              await pageC.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
              await pageC.getByPlaceholder("m@example.com").fill(recoveryUser.email);
              await pageC.locator('input[type="password"]').first().fill(recoveryUser.password);
              await pageC.getByRole("button", { name: /Sign in to Aankh/i }).click();
              await pageC.waitForTimeout(3000);
              const oldStillLogin = (() => { try { return new URL(pageC.url()).pathname === "/login"; } catch { return false; } })();
              await pageC.getByPlaceholder("m@example.com").fill(recoveryUser.email);
              await pageC.locator('input[type="password"]').first().fill(newPassword);
              await pageC.getByRole("button", { name: /Sign in to Aankh/i }).click();
              try {
                await pageC.waitForURL((u) => u.pathname !== "/login", { timeout: 20000 });
              } catch { /* record below */ }
              await pageC.waitForTimeout(1500);
              const newPath = (() => { try { return new URL(pageC.url()).pathname; } catch { return "?"; } })();
              const newOk = newPath === "/" || newPath === "/onboarding";
              await shot(pageC, "d-new-password-signin.png");
              await ctxC.close();
              record("d", "password recovery sets a new password and signs in", dashOk && oldStillLogin && newOk ? "PASS" : "FAIL",
                `reset success -> ${dashPath}; old password rejected: ${oldStillLogin}; new password lands on ${newPath}`);
              if (newOk) recoveryUser = { email: recoveryUser.email, password: newPassword };
            }
          }
          await ctxB.close();
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    // Cleanup: delete every test user created via generateLink.
    for (const id of trackedUserIds) {
      try {
        await admin().auth.admin.deleteUser(id);
        console.log(`  cleanup: deleted test user id ${id.slice(0, 8)}…`);
      } catch {
        console.log(`  cleanup: could not delete test user id ${id.slice(0, 8)}… (manual cleanup may be needed)`);
      }
    }
  }

  const summary = {
    at: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: NO_ADMIN_ONLY ? "no-admin-only" : "full",
    probe: probe.ok ? `HTTP ${probe.status}` : `BLOCKED (HTTP ${probe.status ?? "n/a"}: ${probe.reason})`,
    results,
  };
  const outFile = join(SHOT_DIR, `results-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nresults: ${outFile}`);
  console.log(`screenshots: ${SHOT_DIR}`);
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  console.log(`totals: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.BLOCKED} BLOCKED`);
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
