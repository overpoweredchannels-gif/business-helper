import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Slice 6 (HYBRID) — currency switch + Business Query/AI through the
// Vercel cloud endpoints, offline shows "Internet chahiye", never a 500.
// Rules:
//  1. The 15 Slice 6 routes are CLOUD + migrated in the manifest, and the
//     ratchet baseline is 9 (31 -> 9).
//  2. No renderer code fetches a migrated CLOUD route directly — the gate's
//     exact-match scan AND the template-literal forms it misses (backtick
//     + ${...}) must both be clean. Anything left is a pending count that
//     must equal the ratchet baseline.
//  3. Every migrated route file answers OPTIONS, wraps its handler with
//     applyCors, and verifies the Bearer token itself (never from the
//     request body).
//  4. Every migrated route has at least one cloudFetch/cloudFetchAi call
//     site in renderer code (business-brain goes through the
//     BUSINESS_BRAIN_ENDPOINT constant in server-chat.ts).
//  5. Timeouts: generic cloud calls 10s, AI answer routes 60s —
//     callCloudEndpoint really aborts a never-resolving fetch and throws
//     "timed out", and isNetworkError recognises that as a network error.
//  6. The offline message key exists in all four locales.
//  7. AI call sites use the 60s helper; every other migrated call site
//     uses the 10s helper.
//  8. No service key in the cloud helper (the desktop never ships one).

// The cloud-endpoint import chain creates the Supabase browser client at
// import time (src/lib/supabase/client.ts), which throws without a URL +
// anon key. This test never signs in — callCloudEndpoint takes its init
// as given and the fetch is stubbed — so dummy values are enough when
// the real ones are absent (CI and the local .env.local flow provide
// real ones; the assertions do not depend on them).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "dummy-anon-key-for-tests";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SLICE6_ROUTES = [
  "/api/fx/rates",
  "/api/books/convert",
  "/api/ai-business-query",
  "/api/business-brain",
  "/api/ai/customers/create",
  "/api/ai/customers/update",
  "/api/ai/customers/delete",
  "/api/ai/purchases/create",
  "/api/ai/sales/create",
  "/api/ai/suppliers/create",
  "/api/ai/suppliers/update",
  "/api/ai/suppliers/delete",
  "/api/location/upload",
  "/api/location/device-session",
  "/api/location/current",
];

const ROUTE_FILES: Record<string, string> = {
  "/api/fx/rates": "src/app/api/fx/rates/route.ts",
  "/api/books/convert": "src/app/api/books/convert/route.ts",
  "/api/ai-business-query": "src/app/api/ai-business-query/route.ts",
  "/api/business-brain": "src/app/api/business-brain/route.ts",
  "/api/ai/customers/create": "src/app/api/ai/customers/create/route.ts",
  "/api/ai/customers/update": "src/app/api/ai/customers/update/route.ts",
  "/api/ai/customers/delete": "src/app/api/ai/customers/delete/route.ts",
  "/api/ai/purchases/create": "src/app/api/ai/purchases/create/route.ts",
  "/api/ai/sales/create": "src/app/api/ai/sales/create/route.ts",
  "/api/ai/suppliers/create": "src/app/api/ai/suppliers/create/route.ts",
  "/api/ai/suppliers/update": "src/app/api/ai/suppliers/update/route.ts",
  "/api/ai/suppliers/delete": "src/app/api/ai/suppliers/delete/route.ts",
  "/api/location/upload": "src/app/api/location/upload/route.ts",
  "/api/location/device-session": "src/app/api/location/device-session/route.ts",
  "/api/location/current": "src/app/api/location/current/route.ts",
};

const CLOUD_HELPER = "src/lib/desktop/cloud-endpoint.ts";
const RENDERER_SCOPES = ["src/app", "src/components", "src/lib"];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function rendererFiles(): string[] {
  return RENDERER_SCOPES.flatMap((scope) =>
    walkFiles(join(ROOT, scope)).filter((f) => {
      const rel = f.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (rel.startsWith("src/app/api/")) return false;
      if (rel === CLOUD_HELPER) return false;
      if (/\.test\.[tj]sx?$/.test(f) || f.includes("__tests__")) return false;
      return /\.[tj]sx?$/.test(f);
    }),
  );
}

// Same route matcher as the CI gate (scripts/check-desktop-routes.mjs):
// /api/purchases/[id] -> ^/api/purchases/[^/]+$ (anchored, exact).
function routeToRegExp(route: string): RegExp {
  const pattern = route
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\[id\]/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

async function main(): Promise<void> {
  // Rule 1 — manifest.
  const manifest = JSON.parse(read("DESKTOP_ROUTE_CLASSIFICATION.json")) as {
    routes: Record<string, { classification?: string; migrated?: boolean }>;
    ratchet?: { pending_direct_cloud_fetches?: number };
  };
  for (const route of SLICE6_ROUTES) {
    const entry = manifest.routes[route];
    assert.ok(entry, `1. manifest is missing ${route}`);
    assert.equal(entry.classification, "CLOUD", `1. ${route} must stay CLOUD`);
    assert.equal(entry.migrated, true, `1. ${route} must be migrated: true`);
  }
  assert.equal(
    manifest.ratchet?.pending_direct_cloud_fetches,
    9,
    "1. ratchet baseline must be 9 after Slice 6 (31 -> 9)",
  );
  console.log("1. manifest: 15 Slice 6 routes CLOUD + migrated, ratchet 9");

  // Rule 2 — no direct fetch of a migrated route (gate scan + backtick
  // template-literal forms the gate misses), pending count == baseline.
  const cloudRoutes = Object.entries(manifest.routes)
    .filter(([, e]) => e.classification === "CLOUD")
    .map(([route, e]) => ({ route, pattern: routeToRegExp(route), migrated: e.migrated === true }));
  const fetchRe = /(?:fetch|authorizedFetch)\s*\(\s*["'`](\/api\/[^"'`$\s]+)/g;
  const files = rendererFiles();
  let pending = 0;
  const pendingRoutes = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = fetchRe.exec(src)) !== null) {
      const hit = cloudRoutes.find((c) => c.pattern.test(m![1]));
      if (!hit) continue;
      assert.ok(
        !hit.migrated,
        `2. ${file} fetches migrated CLOUD route ${hit.route} directly — it must go through ${CLOUD_HELPER}`,
      );
      pending += 1;
      pendingRoutes.add(hit.route);
    }
    // Template-literal form the gate regex cannot see (it stops at `$`):
    // fetch(`/api/<route>...${...}`) must not exist for a migrated route.
    for (const route of SLICE6_ROUTES) {
      const backtickRe = new RegExp(
        `(?:fetch|authorizedFetch)\\s*\\(\\s*\`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\\`]*\\$\\{`,
      );
      assert.ok(
        !backtickRe.test(src),
        `2. ${file} fetches migrated CLOUD route ${route} directly via a template literal — it must go through ${CLOUD_HELPER}`,
      );
    }
  }
  assert.equal(
    pending,
    9,
    `2. pending direct fetches of unmigrated CLOUD routes must be 9 (got ${pending}: ${[...pendingRoutes].join(", ")})`,
  );
  console.log(`2. no direct fetch of a migrated route; pending unmigrated: ${pending} (${[...pendingRoutes].join(", ")})`);

  // Rule 3 — each migrated route file: OPTIONS + applyCors + Bearer check.
  const BEARER_MARKERS = /requirePermission|resolveActor|requireAuthenticatedOrg|getUser\(token\)/;
  for (const route of SLICE6_ROUTES) {
    const src = read(ROUTE_FILES[route]);
    assert.ok(
      /export async function OPTIONS/.test(src),
      `3. ${route} is missing an OPTIONS preflight export`,
    );
    assert.ok(/applyCors\(/.test(src), `3. ${route} does not wrap its handler with applyCors`);
    assert.ok(
      BEARER_MARKERS.test(src),
      `3. ${route} does not verify the Bearer token itself (no requirePermission / resolveActor / requireAuthenticatedOrg / getUser(token))`,
    );
  }
  console.log("3. all 15 migrated routes: OPTIONS + applyCors + Bearer verification");

  // Rule 4 — cloudFetch/cloudFetchAi call sites exist for every route.
  const cloudCallRe = /(?:cloudFetch|cloudFetchAi)\s*\(\s*["'`](\/api\/[^"'`$\s]+)/g;
  const called = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = cloudCallRe.exec(src)) !== null) called.add(m[1]);
  }
  // Template-literal call sites (fx/rates GETs, location/current).
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const route of SLICE6_ROUTES) {
      if (new RegExp(`cloudFetch\\s*\\(\\s*\`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(src)) {
        called.add(route);
      }
    }
  }
  for (const route of SLICE6_ROUTES) {
    if (route === "/api/business-brain") {
      // Indirection: server-chat.ts keeps the path in a constant and
      // passes it to the injected fetch (default cloudFetchAi).
      const chat = read("src/lib/ai/server-chat.ts");
      assert.ok(
        chat.includes('BUSINESS_BRAIN_ENDPOINT = "/api/business-brain"'),
        "4. server-chat.ts must keep BUSINESS_BRAIN_ENDPOINT = \"/api/business-brain\"",
      );
      assert.ok(
        chat.includes("= cloudFetchAi,"),
        "4. server-chat.ts default transport must be cloudFetchAi",
      );
      continue;
    }
    assert.ok(called.has(route), `4. no cloudFetch/cloudFetchAi call site for ${route}`);
  }
  console.log("4. cloudFetch/cloudFetchAi call sites exist for all 15 routes (business-brain via server-chat.ts)");

  // Rule 5 — timeouts behave: a never-resolving fetch aborts and throws
  // "timed out", and isNetworkError recognises it as a network error.
  const cloudEndpoint = await import("../src/lib/desktop/cloud-endpoint");
  assert.equal(
    cloudEndpoint.CLOUD_REQUEST_TIMEOUT_MS,
    10_000,
    "5. CLOUD_REQUEST_TIMEOUT_MS must be 10_000",
  );
  assert.equal(
    cloudEndpoint.AI_CLOUD_TIMEOUT_MS,
    60_000,
    "5. AI_CLOUD_TIMEOUT_MS must be 60_000",
  );
  const helperSrc = read(CLOUD_HELPER);
  assert.ok(
    /export async function cloudFetchAi[\s\S]*?return cloudFetch\(input, init, AI_CLOUD_TIMEOUT_MS\)/.test(helperSrc),
    "5. cloudFetchAi must delegate to cloudFetch with AI_CLOUD_TIMEOUT_MS",
  );
  const originalFetch = globalThis.fetch;
  try {
    // Never-resolving fetch that honours the abort signal.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as typeof fetch;
    await assert.rejects(
      () => cloudEndpoint.callCloudEndpoint("/api/fx/rates", { method: "GET" }, 50),
      /timed out after 50ms/,
      "5. a never-resolving cloud call must throw 'timed out'",
    );
    // Positive control: a fetch that answers is returned untouched.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const res = await cloudEndpoint.callCloudEndpoint("/api/fx/rates", {}, 1000);
    assert.equal(res.status, 200, "5. a answering cloud call must return its Response");
  } finally {
    globalThis.fetch = originalFetch;
  }
  const { isNetworkError } = await import("../src/lib/offline/identity-cache");
  assert.equal(
    isNetworkError(new Error("Cloud request timed out after 10000ms")),
    true,
    "5. isNetworkError must recognise a timeout error",
  );
  assert.equal(
    isNetworkError(new TypeError("Failed to fetch")),
    true,
    "5. isNetworkError must recognise a failed fetch",
  );
  assert.equal(
    isNetworkError(new Error("some unrelated failure")),
    false,
    "5. isNetworkError must not flag an unrelated error",
  );
  console.log("5. timeouts: 10s generic / 60s AI; never-resolving fetch throws 'timed out'; isNetworkError recognises it");

  // Rule 6 — the offline message exists in all four locales.
  const { messages } = await import("../src/lib/regional/messages");
  for (const locale of ["en", "es", "it", "ur"] as const) {
    const text = messages[locale]["offline.internetRequired"];
    assert.equal(typeof text, "string", `6. ${locale} is missing offline.internetRequired`);
    assert.ok(text.length > 0, `6. ${locale} offline.internetRequired is empty`);
  }
  console.log("6. offline.internetRequired exists in en/es/it/ur");

  // Rule 7 — AI call sites use the 60s helper; everything else the 10s one.
  const page = read("src/app/page.tsx");
  assert.equal(
    (page.match(/cloudFetchAi\("\/api\/ai-business-query"/g) ?? []).length,
    4,
    "7. page.tsx must call /api/ai-business-query via cloudFetchAi at all 4 sites",
  );
  assert.equal(
    (page.match(/cloudFetch\("\/api\/ai-business-query"/g) ?? []).length,
    0,
    "7. page.tsx must not call /api/ai-business-query via the 10s cloudFetch",
  );
  for (const file of [
    "src/components/regional/CurrencySwitcher.tsx",
    "src/components/regional/FxRatesPanel.tsx",
    "src/components/regional/RegionalProvider.tsx",
    "src/lib/ai/customer-executor.ts",
    "src/lib/ai/purchase-executor.ts",
    "src/lib/ai/sales-executor.ts",
    "src/lib/ai/supplier-executor.ts",
    "src/components/dashboard/EmployeeLiveTracking.tsx",
    "src/components/location/LocationDashboard.tsx",
  ]) {
    const src = read(file);
    assert.ok(!src.includes("cloudFetchAi"), `7. ${file} must not use the 60s AI helper`);
    assert.ok(src.includes("cloudFetch("), `7. ${file} must use cloudFetch`);
  }
  // page.tsx location sites use the 10s helper too.
  assert.ok(page.includes('cloudFetch("/api/location/upload"'), "7. page.tsx location upload must use cloudFetch");
  assert.ok(page.includes('cloudFetch("/api/location/device-session"'), "7. page.tsx device-session must use cloudFetch");
  console.log("7. AI sites use cloudFetchAi (60s); currency/executor/location sites use cloudFetch (10s)");

  // Rule 8 — no service key in the cloud helper. (The header comment
  // names the key in prose — that is not a use; the check is for code
  // that reads it or constructs the service client.)
  assert.ok(
    !helperSrc.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"),
    "8. the cloud helper must never read the service-role key from env",
  );
  assert.ok(
    !helperSrc.includes("createSupabaseService"),
    "8. the cloud helper must never use the service client",
  );
  console.log("8. no service key / service client in the cloud helper");

  console.log("Slice 6 currency + AI cloud: passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
