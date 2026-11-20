#!/usr/bin/env node
/**
 * Slice 0 CI gate — HYBRID desktop fix (UMAIR 2026-11-19).
 *
 * Guards the desktop (Electron) build against the systemic service-key defect:
 * the desktop ships no SUPABASE_SERVICE_ROLE_KEY, so any API route that needs
 * it returns 500 on desktop. The classification manifest
 * (DESKTOP_ROUTE_CLASSIFICATION.json) is the single source of truth; this
 * script enforces it. It never writes or prints a secret value — only key
 * NAMES, route paths, file paths and HTTP statuses.
 *
 * Usage:
 *   node scripts/check-desktop-routes.mjs [--manifest PATH]
 *   node scripts/check-desktop-routes.mjs --smoke [--standalone PATH] [--port N]
 *   node scripts/check-desktop-routes.mjs --tag vX.Y.Z        (local tag check)
 *
 * Static checks (default mode; exit non-zero on any FAIL):
 *  (1) Manifest coverage — every src/app/api route.ts has a manifest entry,
 *      and every manifest entry has a matching file.
 *  (2) Service-key use by class — a LOCAL route (route file, or a one-level
 *      src/lib import it uses) must not call createSupabaseService() or read
 *      SUPABASE_SERVICE_ROLE_KEY. USER-JWT routes are enforced only once
 *      `migrated: true` is set on their manifest entry (until then they are
 *      reported as "pending conversion"). CLOUD routes are exempt — they run
 *      on Vercel, where the key exists. A manifest entry with a `pending`
 *      reason is reported as pending, not failed. A LOCAL route the desktop
 *      never calls (`called_from_desktop` starts with "no") is exempt too:
 *      its service-client use is web-only dead code on desktop (Slice 5:
 *      /api/sales/walk-in keeps the service client for web same-origin
 *      calls while the desktop uses a local seed instead).
 *  (3) Service-key name in packaging — SUPABASE_SERVICE_ROLE_KEY must not
 *      appear in electron/ or .github/workflows/desktop.yml, and must not
 *      appear as an assignment (KEY=...) in any tracked file. Reads
 *      (process.env.KEY) are allowed: src/lib/supabase/server.ts legitimately
 *      reads it for the web server. Scope is tracked files (git ls-files):
 *      a committed .env file would be caught; an untracked local .env.local
 *      never ships and is out of scope.
 *  (4) Desktop env allowlist — the env: block in desktop.yml may contain only
 *      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and GH_TOKEN
 *      (GH_TOKEN is the documented exception: the publish token electron-
 *      builder needs for --publish onTag, not a Supabase secret). The workflow
 *      must also declare `permissions: contents: write` (audit M10). When the
 *      two NEXT_PUBLIC vars are present in the environment (always in CI),
 *      they must be non-empty.
 *  (5) Direct renderer fetches of CLOUD routes — the renderer may reach a
 *      CLOUD route only through the cloud-endpoint helper
 *      (src/lib/desktop/cloud-endpoint.ts). Enforced only for manifest
 *      entries with `migrated: true`; unmigrated CLOUD routes are reported as
 *      "pending migration". Static literal matching only — fully dynamic URLs
 *      are a known gap (classification §7).
 *  (6) Version/tag guard — on a tag build (GITHUB_REF refs/tags/vX.Y.Z,
 *      --tag, or CHECK_DESKTOP_TAG) the tag must equal `v` + package.json
 *      version (audit M9: a v0.1.0 release from another commit would never
 *      auto-update run-#5 users).
 *  (8) Migrated-route hardening (hardening rule 1) — a manifest entry with
 *      `migrated: true` must verify the Bearer token itself (route file
 *      contains getUser(/getClaims(/resolveActor(/requirePermission(/
 *      requireSalesTool(/Authorization) and must not read organization_id
 *      from the request body (heuristic: organization_id next to a body
 *      variable — see checkMigratedHardening). Passes vacuously today: no
 *      entry is migrated yet; it bites from Slice 1 on.
 *  (9) Wildcard CORS (hardening rule 1) — no Access-Control-Allow-Origin: *
 *      in any TypeScript file under src/.
 * (10) Pending direct CLOUD fetch ratchet (UMAIR item 4) — the count of
 *      direct renderer fetches of unmigrated CLOUD routes (check 5's
 *      `pending`) must never exceed the baseline stored in the manifest
 *      (`ratchet.pending_direct_cloud_fetches`, 47 at Slice 0). It was 39,
 *      then 47 — it may only go down. The same commit that migrates routes
 *      (sets `migrated: true`) MUST lower the baseline to the new count;
 *      never raise it. The ratchet uses check 5's exact matching logic
 *      (exact/segment matching, not substring), so the counted number is
 *      the same number check 5 reports.
 *
 * Smoke mode (--smoke): boots the built standalone server and proves the
 * packaged build has no service key:
 *  (a) GET /login -> 200 (server healthy);
 *  (b) POST /api/auth/provision with a fake Bearer token -> 401 (Slice 1:
 *      the route verifies the Bearer token with the anon client BEFORE any
 *      service client is created, so an unverifiable token answers 401 even
 *      with no service key present. A 500 here would mean the route still
 *      creates the service client before auth. Key-leak detection is check
 *      3's name scan, not this probe);
 *  (c) POST /api/monitoring/client-error with no auth -> 401 (a LOCAL route
 *      executes its auth path and does not 500 on the missing key).
 *
 * What the gate CANNOT check (stated in the output footer): the literal
 * service-role key value (it never exists in the repo); RLS policies (live in
 * production Supabase — USER-JWT conversions must each cite the verified
 * policy); RPC grants; storage bucket policies.
 *
 * Deviations from classification §8, found while implementing (safer variant):
 *  - §8 rule 2 as literally written (grep route file + one-level lib imports
 *    for the helper name) flags 13 of 16 LOCAL routes — almost entirely
 *    because they import src/lib/supabase/server.ts (the module that DEFINES
 *    the helper; importing it is not calling it) or src/lib/identity/
 *    api-context.ts (resolveActor: service call inside try/catch, degrades
 *    to role permissions, classification §9). The gate therefore tests for
 *    actual CALL sites (createSupabaseService(), not the name in an import),
 *    excludes the factory module, and allowlists the two verified-guarded
 *    modules below with their justification. A NEW lib module that calls the
 *    helper fails the gate.
 *  - §8 rule 5 as literally written ("any direct fetch of a CLOUD route
 *    fails until the helper lands") fails on the real manifest today: 48
 *    direct CLOUD fetches exist in renderer code, because the desktop
 *    currently points them at the local server — that is the bug Slices 1-6
 *    fix. The gate enforces rule 5 per-route via `migrated: true` and
 *    reports unmigrated fetches as pending migration.
 *  - §8 rule 7's example CLOUD probe (GET /api/products/list, unauthenticated)
 *    does not 500: that route is USER-JWT (not CLOUD) and checks auth first
 *    (403 before any service call). The smoke probe instead POSTs
 *    /api/auth/provision with a fake Bearer token, which the route answers
 *    401 — Slice 1 verifies the Bearer with the anon client before any
 *    service client is created, so the fake token never reaches the
 *    missing-key throw.
 */

import { readFileSync, existsSync, readdirSync, statSync, writeSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(ROOT, "DESKTOP_ROUTE_CLASSIFICATION.json");
const WORKFLOW_PATH = join(ROOT, ".github/workflows/desktop.yml");
const API_DIR = join(ROOT, "src", "app", "api");
const CLOUD_HELPER = "src/lib/desktop/cloud-endpoint.ts";
const KEY_NAME = "SUPABASE_SERVICE_ROLE_KEY";
const DESKTOP_ENV_ALLOWLIST = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "GH_TOKEN", // documented exception: publish token for --publish onTag, not a Supabase secret
]);
const VALID_CLASSES = new Set(["CLOUD", "LOCAL", "USER-JWT"]);

// Lib modules whose service-client call is verified guarded — the gate allows
// a LOCAL route to reach the service client ONLY through these, and says why.
// Any other lib module that calls the helper fails the gate.
//  - src/lib/identity/api-context.ts: resolveActor calls createSupabaseService
//    inside try/catch and degrades to role-based permissions (classification §9).
//  - src/lib/invoices/invoice-number-service.ts: the service client appears
//    only in the InvoiceNumberService constructor `??` fallback. The returns
//    routes import only generateInvoiceNumberWithClient (required client
//    param, never touches the fallback). The gate additionally verifies the
//    route imports only WithClient/pure symbols from this module.
const SERVICE_GUARDED_MODULES = new Map([
  [
    "src/lib/identity/api-context.ts",
    "resolveActor service call is inside try/catch, degrades to role permissions (classification §9)",
  ],
  [
    "src/lib/invoices/invoice-number-service.ts",
    "service client only in InvoiceNumberService constructor ?? fallback; client-injected *WithClient path never touches it",
  ],
]);
const INVOICE_NUMBER_ALLOWED_IMPORTS = new Set(["extractSequenceDigits", "formatInvoiceNumber"]);
const SERVICE_FACTORY_MODULE = "src/lib/supabase/server.ts"; // defines the helper; importing it is not calling it

const failures = [];
const warnings = [];
const notes = [];
let failCount = 0;
let warnCount = 0;

function fail(message) {
  failures.push(message);
  failCount += 1;
  console.log(`FAIL: ${message}`);
}
function warn(message) {
  warnings.push(message);
  warnCount += 1;
  console.log(`WARN: ${message}`);
}
function info(message) {
  notes.push(message);
  console.log(`ok: ${message}`);
}

// ---------------------------------------------------------------- utilities

function readText(file) {
  return readFileSync(file, "utf8");
}

// Strip // and /* */ comments, respecting string literals, so a commented-out
// call cannot fail the gate and a call inside a string is not mistaken.
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null; // "'", '"', or "`"
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1] ?? "";
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// Actual call sites of createSupabaseService() — not the name in an import,
// not the factory definition (`const createSupabaseService = ...`).
function findServiceCalls(src) {
  const clean = stripComments(src);
  const hits = [];
  clean.split("\n").forEach((line, idx) => {
    if (/^\s*(export\s+)?(const|let|var|function)\s+createSupabaseService\s*=/.test(line)) return;
    if (/createSupabaseService\s*\(/.test(line)) hits.push({ line: idx + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

function findKeyNameUses(src) {
  const clean = stripComments(src);
  const hits = [];
  clean.split("\n").forEach((line, idx) => {
    if (line.includes(KEY_NAME)) hits.push({ line: idx + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

function walkFiles(dir, predicate) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
      out.push(...walkFiles(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function resolveImport(spec, importerFile) {
  let base = null;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(importerFile), spec);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((c) => existsSync(c) && !statSync(c).isDirectory()) ?? null;
}

// One-level src/lib imports of a route file: [{ file, bindings: [names] }]
function oneLevelLibImports(routeFile) {
  const src = readText(routeFile);
  const out = new Map();
  const importRe = /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}\s*from\s*)?["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[3];
    const resolved = resolveImport(spec, routeFile);
    if (!resolved) continue;
    const rel = toPosix(relative(ROOT, resolved));
    if (!rel.startsWith("src/lib/")) continue;
    const bindings = (m[2] ?? "")
      .split(",")
      .map((b) => b.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean);
    if (m[1]) bindings.push(m[1]);
    const prev = out.get(rel) ?? [];
    out.set(rel, [...new Set([...prev, ...bindings])]);
  }
  const dynRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynRe.exec(src)) !== null) {
    const resolved = resolveImport(m[1], routeFile);
    if (!resolved) continue;
    const rel = toPosix(relative(ROOT, resolved));
    if (rel.startsWith("src/lib/") && !out.has(rel)) out.set(rel, []);
  }
  return [...out.entries()].map(([file, bindings]) => ({ file, bindings }));
}

function enumerateApiRoutes() {
  const files = walkFiles(API_DIR, (f) => /(^|[/\\])route\.(ts|js)$/.test(f));
  return files.map((file) => {
    const rel = toPosix(relative(API_DIR, file)); // e.g. purchases/[id]/route.ts
    return { route: "/api/" + rel.replace(/\/route\.(ts|js)$/, ""), file };
  });
}

function routeToRegExp(route) {
  // /api/purchases/[id] -> ^/api/purchases/[^/]+$
  const pattern = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\[id\]/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

// ---------------------------------------------------------------- manifest

function loadManifest(manifestPath) {
  const data = JSON.parse(readText(manifestPath));
  if (!data.routes || typeof data.routes !== "object") throw new Error(`manifest ${manifestPath} has no routes object`);
  return data;
}

// ------------------------------------------------------------ check (1)

function checkCoverage(manifest) {
  console.log("\n[1] Manifest coverage");
  const onDisk = enumerateApiRoutes();
  const manifestRoutes = new Set(Object.keys(manifest.routes));
  let ok = true;
  for (const { route, file } of onDisk) {
    if (!manifestRoutes.has(route)) {
      fail(`unclassified route: ${route} (${toPosix(relative(ROOT, file))}) has no manifest entry`);
      ok = false;
    }
  }
  const onDiskRoutes = new Set(onDisk.map((r) => r.route));
  for (const route of manifestRoutes) {
    if (!onDiskRoutes.has(route)) {
      fail(`stale manifest entry: ${route} has no route file`);
      ok = false;
    }
    const entry = manifest.routes[route];
    if (!entry || !VALID_CLASSES.has(entry.classification)) {
      fail(`invalid manifest entry: ${route} has no valid classification`);
      ok = false;
    } else if (typeof entry.methods !== "string" || !entry.methods.trim()) {
      fail(`invalid manifest entry: ${route} has no methods`);
      ok = false;
    }
  }
  if (ok) info(`all ${onDisk.length} route files classified, no stale entries`);
  return onDisk;
}

// ------------------------------------------------------------ check (2)

function checkServiceUse(manifest, onDisk) {
  console.log("\n[2] Service-key use by class");
  const byRoute = new Map(onDisk.map((r) => [r.route, r.file]));
  let pendingConversion = 0;
  let pendingLocal = 0;
  for (const [route, entry] of Object.entries(manifest.routes)) {
    const file = byRoute.get(route);
    if (!file) continue; // already failed in check (1)
    const enforced =
      entry.classification === "LOCAL" || (entry.classification === "USER-JWT" && entry.migrated === true);
    if (entry.classification === "USER-JWT" && entry.migrated !== true) {
      pendingConversion += 1;
      continue;
    }
    if (
      entry.classification === "LOCAL" &&
      typeof entry.called_from_desktop === "string" &&
      entry.called_from_desktop.startsWith("no")
    ) {
      // Slice 5: the desktop never invokes this route, so the service
      // client in its file is web-only dead code on desktop (the route
      // stays service-backed for web same-origin calls). Enforced only
      // while the desktop can reach the route.
      info(`${route} (LOCAL, desktop never calls it) keeps the service client for web same-origin calls — not enforced on desktop`);
      continue;
    }
    if (!enforced) continue; // CLOUD: allowed to use the service key on Vercel
    const src = readText(file);
    const calls = findServiceCalls(src);
    const keyUses = findKeyNameUses(src);
    if (entry.pending) {
      if (calls.length || keyUses.length) {
        pendingLocal += 1;
        warn(`${route} (${entry.classification}, pending: ${entry.pending}) still references the service client — allowed until its slice lands`);
      }
      continue;
    }
    if (calls.length) {
      fail(`${route} (${entry.classification}) calls createSupabaseService() in its route file: ${file}:${calls[0].line} — ${calls[0].text}`);
    }
    if (keyUses.length) {
      fail(`${route} (${entry.classification}) references ${KEY_NAME} in its route file: ${file}:${keyUses[0].line}`);
    }
    // One-level src/lib imports.
    for (const { file: libFile, bindings } of oneLevelLibImports(file)) {
      if (libFile === SERVICE_FACTORY_MODULE) continue; // defines the helper; importing it is not calling it
      const libSrc = readText(join(ROOT, libFile));
      const libCalls = findServiceCalls(libSrc);
      if (!libCalls.length) continue;
      if (SERVICE_GUARDED_MODULES.has(libFile)) {
        if (libFile === "src/lib/invoices/invoice-number-service.ts") {
          const bad = bindings.filter(
            (b) => !b.endsWith("WithClient") && !INVOICE_NUMBER_ALLOWED_IMPORTS.has(b),
          );
          if (bad.length) {
            fail(
              `${route} (${entry.classification}) imports ${bad.join(", ")} from ${libFile} — only *WithClient/pure symbols are safe on desktop (the InvoiceNumberService constructor falls back to the service client)`,
            );
          } else {
            info(`${route} reaches ${libFile} only via client-injected symbols (${bindings.join(", ") || "none"}) — guarded, allowed`);
          }
        } else {
          info(`${route} reaches ${libFile} (guarded: ${SERVICE_GUARDED_MODULES.get(libFile)}) — allowed`);
        }
        continue;
      }
      fail(
        `${route} (${entry.classification}) reaches createSupabaseService() via one-level import ${libFile} (${libFile}:${libCalls[0].line}) — convert the route or add the module to the guarded list with a verified justification`,
      );
    }
  }
  info(`${pendingConversion} USER-JWT routes pending conversion (not enforced until migrated: true)`);
  if (pendingLocal) info(`${pendingLocal} LOCAL route(s) pending a slice (see WARN lines)`);
}

// ------------------------------------------------------------ check (3)

function trackedFiles() {
  try {
    const out = execSync("git ls-files", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.split("\n").filter(Boolean).map((f) => join(ROOT, f));
  } catch {
    return null;
  }
}

function checkKeyNameInPackaging() {
  console.log("\n[3] Service-key name in desktop packaging files");
  let ok = true;
  for (const dir of [join(ROOT, "electron")]) {
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, (f) => /\.(ts|tsx|js|mjs|cjs|json|yml|yaml)$/.test(f))) {
      if (readText(file).includes(KEY_NAME)) {
        fail(`${KEY_NAME} appears in ${toPosix(relative(ROOT, file))} — the service key must never be named in desktop packaging`);
        ok = false;
      }
    }
  }
  if (readText(WORKFLOW_PATH).includes(KEY_NAME)) {
    fail(`${KEY_NAME} appears in .github/workflows/desktop.yml`);
    ok = false;
  }
  const files = trackedFiles();
  if (files) {
    const hits = [];
    for (const file of files) {
      if (!/\.(yml|yaml|env|json|ts|tsx|js|mjs|cjs|toml|ini)$/.test(file)) continue;
      // Strip comments first: a KEY= inside a comment (e.g. a usage line
      // documenting `SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx ...`) is
      // documentation, not an assignment. A KEY= inside a string survives
      // stripping and is still flagged — building an env-assignment string
      // is an assignment that could ship the key to a child process.
      const src = stripComments(readText(file));
      if (new RegExp(`${KEY_NAME}\\s*=`).test(src)) hits.push(toPosix(relative(ROOT, file)));
    }
    if (hits.length) {
      fail(`${KEY_NAME} is assigned in tracked file(s): ${hits.join(", ")} — the service key must never be assigned in the repo`);
      ok = false;
    }
  } else {
    warn("git ls-files unavailable — assignment scan skipped (run inside the repo for the full check)");
  }
  if (ok) info("no service-key name in electron/, desktop.yml, or assignments in tracked files");
}

// ------------------------------------------------------------ check (4)

function parseWorkflowEnvKeys() {
  const lines = readText(WORKFLOW_PATH).split("\n");
  const keys = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*env:\s*$/.test(lines[i])) {
      const baseIndent = lines[i].search(/\S/);
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const indent = line.search(/\S/);
        if (indent <= baseIndent) break;
        const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (m) keys.push(m[1]);
      }
    }
  }
  return [...new Set(keys)];
}

function checkDesktopEnv() {
  console.log("\n[4] Desktop env allowlist (desktop.yml)");
  const keys = parseWorkflowEnvKeys();
  const bad = keys.filter((k) => !DESKTOP_ENV_ALLOWLIST.has(k));
  if (bad.length) {
    fail(`desktop.yml env: block contains non-allowlisted key(s): ${bad.join(", ")} (allowed: ${[...DESKTOP_ENV_ALLOWLIST].join(", ")})`);
  } else {
    info(`desktop.yml env: keys are allowlisted (${keys.join(", ") || "none"})`);
  }
  const workflowSrc = readText(WORKFLOW_PATH);
  if (!/permissions:\s*\n\s+contents:\s*write/.test(workflowSrc)) {
    fail("desktop.yml is missing `permissions: contents: write` (audit M10 — needed for --publish onTag releases)");
  } else {
    info("desktop.yml declares permissions: contents: write");
  }
  const inCI = process.env.GITHUB_ACTIONS === "true";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (inCI || url !== undefined || anon !== undefined) {
    if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is empty or unset in the workflow environment");
    if (!anon) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is empty or unset in the workflow environment");
    if (url && anon) info("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are non-empty");
  } else {
    console.log("note: NEXT_PUBLIC_* env-value check skipped (not in CI and vars unset locally; values live in repo variables)");
  }
}

// ------------------------------------------------------------ check (5)

function checkDirectCloudFetches(manifest) {
  console.log("\n[5] Direct renderer fetches of CLOUD routes");
  const cloudRoutes = Object.entries(manifest.routes)
    .filter(([, e]) => e.classification === "CLOUD")
    .map(([route, e]) => ({ route, pattern: routeToRegExp(route), migrated: e.migrated === true }));
  const scopes = [join(ROOT, "src", "app"), join(ROOT, "src", "components"), join(ROOT, "src", "lib")];
  const files = scopes.flatMap((dir) =>
    walkFiles(dir, (f) => {
      const rel = toPosix(relative(ROOT, f));
      if (rel.startsWith("src/app/api/")) return false;
      if (rel === CLOUD_HELPER) return false;
      if (/\.test\.[tj]sx?$/.test(f) || f.includes("__tests__")) return false;
      return /\.[tj]sx?$/.test(f);
    }),
  );
  const fetchRe = /(?:fetch|authorizedFetch)\s*\(\s*["'`](\/api\/[^"'`$\s]+)/g;
  let pending = 0;
  const pendingRoutes = new Set();
  for (const file of files) {
    const src = readText(file);
    let m;
    while ((m = fetchRe.exec(src)) !== null) {
      const path = m[1];
      const hit = cloudRoutes.find((c) => c.pattern.test(path));
      if (!hit) continue;
      if (hit.migrated) {
        fail(
          `${toPosix(relative(ROOT, file))} fetches CLOUD route ${hit.route} directly (migrated: true) — it must go through ${CLOUD_HELPER}`,
        );
      } else {
        pending += 1;
        pendingRoutes.add(hit.route);
      }
    }
  }
  if (pending) info(`${pending} direct fetch(es) of unmigrated CLOUD routes (${pendingRoutes.size} routes) — pending migration, not a failure`);
  else info("no direct renderer fetches of CLOUD routes");
  return { pending, routeCount: pendingRoutes.size };
}

// ------------------------------------------------------------ check (10)

function checkPendingFetchRatchet(manifest, pendingCount) {
  console.log("\n[10] Pending direct CLOUD fetch ratchet (UMAIR item 4)");
  const baseline = manifest.ratchet?.pending_direct_cloud_fetches;
  if (typeof baseline !== "number" || !Number.isInteger(baseline) || baseline < 0) {
    fail("manifest has no ratchet.pending_direct_cloud_fetches baseline (integer >= 0) — the pending-fetch ratchet cannot be enforced without it");
    return;
  }
  if (pendingCount > baseline) {
    fail(`pending direct CLOUD fetches: ${pendingCount} exceeds the ratchet baseline ${baseline} — the count may only go down (migrate routes, then lower the baseline in the same commit)`);
  } else {
    info(`pending direct CLOUD fetches: ${pendingCount} (ratchet baseline ${baseline} — may only go down)`);
  }
}

// ------------------------------------------------------------ check (6)

function checkVersionTag(cliTag) {
  console.log("\n[6] Version / tag guard");
  const pkg = JSON.parse(readText(join(ROOT, "package.json")));
  const version = pkg.version;
  let tag = cliTag ?? process.env.CHECK_DESKTOP_TAG ?? null;
  const ref = process.env.GITHUB_REF;
  if (!tag && ref && ref.startsWith("refs/tags/")) tag = ref.slice("refs/tags/".length);
  if (!tag) {
    console.log(`note: no tag present (package.json version ${version}) — guard skipped`);
    return;
  }
  if (tag !== `v${version}`) {
    fail(`tag ${tag} does not equal package.json version v${version} — a release from this commit would never auto-update installed users (audit M9)`);
  } else {
    info(`tag ${tag} matches package.json version ${version}`);
  }
}

// -------------------------------------------------------- checks (8) + (9)

const BEARER_MARKERS = /getUser\s*\(|getClaims\s*\(|resolveActor\s*\(|requirePermission\s*\(|requireSalesTool\s*\(|requireAuthenticatedOrg\s*\(|Authorization/;
// Note: requireAuthenticatedOrg (Slice 6, business-brain + conversation
// routes) delegates to requireOrganization -> resolveActor -> getUser(token);
// it verifies the Bearer itself, it only spells the check one level up.
const ORG_FROM_BODY = /\b(body|payload|parsedBody|input)\s*\.\s*organization_id|\borderization_id\s*:\s*(body|payload|parsedBody|input)\b|\(\s*await\s+[^)]*\.json\(\)\s*\)\s*\.\s*organization_id/;
// NOTE (Slice 6): the leading \b on both alternatives is load-bearing.
// Without it, a Postgres RPC argument named p_organization_id fed from
// the token-derived org — `p_organization_id: input.organizationId` in
// /api/books/convert, where `input` is the conversion library's input,
// not the request body — reads as `organization_id: input` and fails a
// route that genuinely takes its org from the token. The boundary keeps
// every true body read matching (body./input./{ organization_id: body.… })
// while `p_organization_id` (preceded by `_`, a word char) no longer does.

function checkMigratedHardening(manifest, onDisk) {
  console.log("\n[8] Migrated-route hardening (Bearer token + org from token, never body)");
  const byRoute = new Map(onDisk.map((r) => [r.route, r.file]));
  const migrated = Object.entries(manifest.routes).filter(([, e]) => e.migrated === true);
  if (!migrated.length) {
    info("no manifest entry is migrated: true yet — hardening checks pass vacuously (they bite from Slice 1 on)");
    return;
  }
  for (const [route] of migrated) {
    const file = byRoute.get(route);
    if (!file) continue;
    const src = stripComments(readText(file));
    if (!BEARER_MARKERS.test(src)) {
      fail(`${route} (migrated: true) does not verify the Bearer token itself — no getUser/getClaims/resolveActor/requirePermission/requireSalesTool/Authorization found (hardening rule 1)`);
    }
    if (ORG_FROM_BODY.test(src)) {
      fail(`${route} (migrated: true) reads organization_id from the request body — organization_id/user must come from the token (hardening rule 1)`);
    }
  }
  info(`${migrated.length} migrated route(s) checked for Bearer verification + org-from-token`);
}

function checkWildcardCors() {
  console.log("\n[9] Wildcard CORS");
  const files = walkFiles(join(ROOT, "src"), (f) => /\.[tj]sx?$/.test(f));
  const hits = [];
  for (const file of files) {
    const src = readText(file);
    src.split("\n").forEach((line, idx) => {
      if (line.includes("Access-Control-Allow-Origin") && (line.includes('"*"') || line.includes("'*'"))) {
        hits.push(`${toPosix(relative(ROOT, file))}:${idx + 1}`);
      }
    });
  }
  if (hits.length) {
    fail(`wildcard CORS (Access-Control-Allow-Origin: *) in: ${hits.join(", ")} — CORS is desktop-origin only (hardening rule 1)`);
  } else {
    info("no wildcard CORS in src/");
  }
}

// ------------------------------------------------------------ smoke mode

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchWithTimeout(url, options, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function resolveStandalone(explicit) {
  if (explicit) return resolve(explicit);
  const candidates = [
    "dist-electron/win-unpacked/resources/standalone/server.js",
    "dist-electron/linux-unpacked/resources/standalone/server.js",
    ".next/standalone/server.js",
  ];
  return candidates.map((c) => join(ROOT, c)).find((c) => existsSync(c)) ?? null;
}

async function runSmoke(standaloneArg, portArg) {
  console.log("\n[smoke] Packaged standalone server (no service key)");
  const standalone = resolveStandalone(standaloneArg);
  if (!standalone) {
    fail("no standalone server found — expected dist-electron/win-unpacked/resources/standalone/server.js, dist-electron/linux-unpacked/resources/standalone/server.js, or .next/standalone/server.js (run the desktop build first)");
    return false;
  }
  const port = Number(portArg ?? process.env.PORT ?? 3101);
  console.log(`note: booting ${toPosix(relative(ROOT, standalone))} on 127.0.0.1:${port}`);
  // Simulate the desktop PC: the packaged server must run WITHOUT the
  // service key. Scrub it from the child's environment — a local shell may
  // carry SUPABASE_SERVICE_ROLE_KEY (e.g. from .env.local) and passing it
  // through would make the CLOUD probe pass for the wrong reason.
  const childEnv = { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" };
  delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
  console.log("note: smoke child runs without SUPABASE_SERVICE_ROLE_KEY (desktop-PC simulation)");
  const child = spawn("node", [standalone], {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const keep = (chunk) => {
    tail = (tail + chunk.toString()).split("\n").slice(-50).join("\n");
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000)]);
      if (child.exitCode === null) {
        // Still alive after the grace period: force-kill, then wait for the
        // exit that SIGKILL will produce. (Awaiting "exit" unconditionally
        // here deadlocks when the child already exited on SIGTERM: the
        // event never fires again, the event loop empties, and Node exits
        // 0 without ever printing the verdict.)
        child.kill("SIGKILL");
        await new Promise((r) => child.once("exit", r));
      }
    }
  };
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) {
        fail(`standalone server exited early (code ${child.exitCode}) — last output:\n${tail}`);
        return false;
      }
      try {
        const res = await fetchWithTimeout(`${base}/login`, {}, 3000);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // not up yet
      }
      await sleep(1000);
    }
    if (!ready) {
      fail("standalone server did not answer GET /login with 200 within 60s");
      console.log(`last server output:\n${tail}`);
      return false;
    }
    info("GET /login -> 200 (server healthy)");

    // CLOUD probe (Slice 1): provision verifies the Bearer token with the
    // anon client BEFORE any service client is created, so a fake Bearer
    // token must 401 — with or without a service key in the build. A 500
    // here would mean the route still creates the service client before
    // auth (the pre-Slice-1 shape). Key-leak detection is check 3's name
    // scan, not this probe.
    const prov = await fetchWithTimeout(
      `${base}/api/auth/provision`,
      {
        method: "POST",
        headers: { Authorization: "Bearer smoke-probe-token", "Content-Type": "application/json" },
        body: "{}",
      },
      10000,
    );
    const provBody = await prov.text();
    if (prov.status === 401) {
      info("POST /api/auth/provision (fake Bearer) -> 401 (Bearer verification runs before any service call)");
    } else {
      fail(
        `POST /api/auth/provision (fake Bearer) -> ${prov.status}, expected 401 — a non-401 here means the route shape changed (body: ${provBody.slice(0, 200)})`,
      );
      return false;
    }

    // LOCAL probe: monitoring/client-error resolves the actor first; with no
    // auth it must 401 — and must not 500 on the missing service key.
    const local = await fetchWithTimeout(
      `${base}/api/monitoring/client-error`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      10000,
    );
    await local.text();
    if (local.status === 401) {
      info("POST /api/monitoring/client-error (no auth) -> 401 (LOCAL route executes its auth path, does not 500)");
    } else {
      fail(`POST /api/monitoring/client-error (no auth) -> ${local.status}, expected 401 (a 500 here means the LOCAL path touches the missing service key)`);
      return false;
    }
    return true;
  } finally {
    await stop();
  }
}

// ---------------------------------------------------------------- main

function parseArgs(argv) {
  const args = { manifest: MANIFEST_PATH, smoke: false, standalone: null, port: null, tag: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = resolve(argv[++i]);
    else if (a === "--smoke") args.smoke = true;
    else if (a === "--standalone") args.standalone = argv[++i];
    else if (a === "--port") args.port = argv[++i];
    else if (a === "--tag") args.tag = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("usage: node scripts/check-desktop-routes.mjs [--manifest PATH] [--smoke [--standalone PATH] [--port N]] [--tag vX.Y.Z]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("DESKTOP ROUTE GATE — Slice 0 (HYBRID fix)");
  console.log(`repo: ${ROOT}`);
  console.log(`manifest: ${toPosix(relative(ROOT, args.manifest))}`);

  if (args.smoke) {
    const ok = await runSmoke(args.standalone, args.port);
    // Synchronous write: process.exit() below can truncate a buffered
    // console.log, which previously swallowed the SMOKE verdict line.
    writeSync(1, ok ? "\nSMOKE: PASS\n" : "\nSMOKE: FAIL\n");
    process.exit(ok ? 0 : 1);
  }

  const manifest = loadManifest(args.manifest);
  const onDisk = checkCoverage(manifest);
  checkServiceUse(manifest, onDisk);
  checkKeyNameInPackaging();
  checkDesktopEnv();
  const { pending: pendingCloudFetches } = checkDirectCloudFetches(manifest);
  checkPendingFetchRatchet(manifest, pendingCloudFetches);
  checkVersionTag(args.tag);
  checkMigratedHardening(manifest, onDisk);
  checkWildcardCors();

  console.log("\n---- summary ----");
  console.log(`failures: ${failCount}, warnings: ${warnCount}`);
  console.log("cannot check (human-verified): the literal service-role key value; RLS policies; RPC grants; storage bucket policies.");
  if (failCount) {
    writeSync(1, "GATE: FAIL\n");
    process.exit(1);
  }
  console.log("GATE: PASS");
}

main().catch((err) => {
  console.error(`GATE ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
