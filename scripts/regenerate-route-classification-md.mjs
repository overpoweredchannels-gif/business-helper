#!/usr/bin/env node
// Regenerate DESKTOP_ROUTE_CLASSIFICATION.md from DESKTOP_ROUTE_CLASSIFICATION.json.
//
// The JSON is the single source of truth; the .md table, summary counts and
// the §5/§6 route lists are derived from it. Hand-written prose (§3 B1–B4
// mapping, §4 queue proof, §8 CI-gate design, §9 limitations, and the §5/§7
// intro text) is preserved byte-for-byte.
//
// Derived (rewritten on every run):
//   - header "Classified at" line (from tip / tip_short / tip_subject / date)
//   - §1 summary bullets (counts, called-from-desktop, access-pattern stats)
//   - §2 classification table (all columns, in JSON order)
//   - §5 group lines (USER-JWT routes grouped by area prefix)
//   - §6 CLOUD list (all CLOUD routes, in JSON order)
//   - §7: rows for routes confirmed CLOUD are dropped; a confirmation note
//     is added once (idempotent).
//
// Usage: node scripts/regenerate-route-classification-md.mjs
//        [--manifest PATH] [--md PATH]
// Idempotent: running twice produces the identical file.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const VALID_CLASSES = new Set(["CLOUD", "LOCAL", "USER-JWT"]);

// USER-JWT grouping for §5 — every USER-JWT route must match exactly one.
const GROUPS = [
  { label: "Identity/org", prefixes: ["/api/identity/"] },
  { label: "Customers/sales", prefixes: ["/api/customers/", "/api/sales/"] },
  {
    label: "Products/invoices/reports/import-export",
    prefixes: [
      "/api/products/",
      "/api/invoices/",
      "/api/reports/",
      "/api/import-export/",
      "/api/org/",
      "/api/eur/",
      "/api/print-templates/",
      "/api/performance",
    ],
  },
  {
    label: "Field staff",
    prefixes: [
      "/api/visits/",
      "/api/territories/",
      "/api/routes/",
      "/api/attendance",
      "/api/leave",
      "/api/targets",
      "/api/collections/",
      "/api/feedback",
      "/api/data-quality",
      "/api/audit",
      "/api/location/",
      "/api/supervisor/",
      "/api/staff/",
    ],
  },
];

// Routes confirmed CLOUD on 2026-11-19 (UMAIR, repo evidence) that were
// previously listed as low-confidence in §7. Their §7 rows are dropped and
// the confirmation note below is added once.
const CONFIRMED_CLOUD = [
  "/api/location/current",
  "/api/location/device-session",
  "/api/location/upload",
  "/api/staff/delete-inactive",
];
const CONFIRMED_NOTE =
  "Confirmed CLOUD 2026-11-19 (moved to section 6): `/api/location/current`, " +
  "`/api/location/device-session`, `/api/location/upload` — the duty RPCs are revoked " +
  "from `authenticated` and granted only to `service_role` " +
  "(`production_phase8_duty_tracking.sql:485-492`); `/api/staff/delete-inactive` — no " +
  "DELETE policy on `profiles` in the 20261011 snapshot. Final live confirmation is a " +
  "production `pg_policy` / `has_function_privilege` check (non-blocking for v0.1.0, rule 9).";

function fail(message) {
  console.error(`regenerate-route-classification-md: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { manifest: join(ROOT, "DESKTOP_ROUTE_CLASSIFICATION.json"), md: join(ROOT, "DESKTOP_ROUTE_CLASSIFICATION.md") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest") args.manifest = resolve(argv[++i]);
    else if (argv[i] === "--md") args.md = resolve(argv[++i]);
    else fail(`unknown argument: ${argv[i]}`);
  }
  return args;
}

const esc = (s) => String(s).replace(/\|/g, "\\|");
const tick = (routes) => routes.map((r) => `\`${r}\``).join(", ");
// Group-line rendering: a route may carry an optional group_note (appended
// after its backticked name, e.g. " (GET; POST already LOCAL)").
const tickGrouped = (routes, manifest) =>
  routes.map((r) => `\`${r}\`${manifest.routes[r].group_note ?? ""}`).join(", ");

function main() {
  const { manifest, md } = parseArgs(process.argv.slice(2));
  const data = JSON.parse(readFileSync(manifest, "utf8"));
  if (!data.routes || typeof data.routes !== "object") fail("manifest has no routes object");
  const routes = Object.entries(data.routes);
  if (!routes.length) fail("manifest has no routes");

  // Validate entries and compute counts.
  const counts = { CLOUD: 0, LOCAL: 0, "USER-JWT": 0 };
  let calledYes = 0;
  for (const [route, e] of routes) {
    for (const field of ["methods", "purpose", "access_today", "desktop_today", "called_from_desktop", "classification", "notes"]) {
      if (typeof e[field] !== "string" || !e[field].trim()) fail(`${route}: missing/empty ${field}`);
    }
    if (!VALID_CLASSES.has(e.classification)) fail(`${route}: invalid classification ${e.classification}`);
    counts[e.classification] += 1;
    if (e.called_from_desktop.startsWith("yes")) calledYes += 1;
  }
  const calledNo = routes.length - calledYes;
  if (data.counts) {
    for (const c of Object.keys(counts)) {
      if (data.counts[c] !== counts[c]) fail(`manifest counts mismatch: ${c} is ${data.counts[c]} but routes give ${counts[c]}`);
    }
  }
  if (!data.tip || !data.tip_short || !data.tip_subject || !data.date) {
    fail("manifest is missing tip / tip_short / tip_subject / date");
  }
  const stats = data.stats ?? {};
  for (const field of ["direct_service", "service_backed", "false_positives", "direct_key_routes"]) {
    if (stats[field] === undefined) fail(`manifest stats is missing ${field}`);
  }

  const text = readFileSync(md, "utf8");
  const lines = text.split("\n");
  // Split into header + sections keyed by heading number.
  const headingIdx = [];
  lines.forEach((line, i) => {
    const m = line.match(/^## (\d+)\.\s+(.*)$/);
    if (m) headingIdx.push({ n: Number(m[1]), title: m[2], line: i });
  });
  if (headingIdx.length !== 9 || headingIdx.some((h, i) => h.n !== i + 1)) {
    fail(`expected sections 1..9 in order, found: ${headingIdx.map((h) => h.n).join(",")}`);
  }
  const sectionBody = (k) => {
    const start = headingIdx[k - 1].line + 1;
    const end = k < 9 ? headingIdx[k].line : lines.length;
    return lines.slice(start, end);
  };
  const headerLines = lines.slice(0, headingIdx[0].line);

  // Header: update the "Classified at" line from the manifest tip fields.
  const classifiedLine = `Classified at origin/main tip \`${data.tip}\` (\`${data.tip_short}\` — "${data.tip_subject}"), ${data.date}.`;
  const headerOut = headerLines.map((l) => (l.startsWith("Classified at origin/main tip") ? classifiedLine : l));

  // §1 summary bullets.
  const section1 = [
    "",
    `- Total routes: **${routes.length}** — CLOUD **${counts.CLOUD}**, LOCAL **${counts.LOCAL}**, USER-JWT (deferred) **${counts["USER-JWT"]}**.`,
    `- Called from desktop (static grep over \`src/app/page.tsx\`, \`src/components\`, \`src/lib\`, \`src/app\`): **${calledYes}** routes; **${calledNo}** routes have no static desktop caller (listed in the table; see section 7 for the dynamic-URL caveat).`,
    `- Direct \`createSupabaseService()\` in the route file: ${stats.direct_service} routes. Service-backed via a one-level lib import: ${stats.service_backed} routes (of which ${stats.false_positives} are false positives — the module only exports/uses \`createSupabaseUserClient\`; corrected in the table). Direct \`SUPABASE_SERVICE_ROLE_KEY\` use bypassing the helper: ${stats.direct_key_routes.length} routes (${tick(stats.direct_key_routes)}) — a plain \`createSupabaseService\` grep misses these.`,
    "- The desktop build ships only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.github/workflows/desktop.yml:45-48`); no Gemini key, no Google Maps key, no service key. Any route needing one of those is CLOUD by construction.",
    "",
  ];

  // §2 classification table.
  const section2 = [
    "",
    "| Route | Methods | Purpose | Access today | Desktop today | Called from desktop | Classification | Notes |",
    "|---|---|---|---|---|---|---|---|",
    ...routes.map(
      ([route, e]) =>
        `| ${route} | ${esc(e.methods)} | ${esc(e.purpose)} | ${esc(e.access_today)} | ${esc(e.desktop_today)} | ${esc(e.called_from_desktop)} | ${e.classification} | ${esc(e.notes)} |`,
    ),
    "",
  ];

  // §5 group lines (USER-JWT only, in JSON order within each group).
  const userJwt = routes.filter(([, e]) => e.classification === "USER-JWT").map(([r]) => r);
  const grouped = new Map(GROUPS.map((g) => [g.label, []]));
  for (const route of userJwt) {
    // A prefix matches the route itself or any route beneath it, so
    // "/api/customers/" also covers the bare "/api/customers" route.
    const matches = GROUPS.filter((g) =>
      g.prefixes.some((p) => route === p.replace(/\/$/, "") || route.startsWith(p)),
    );
    if (matches.length !== 1) fail(`§5 grouping: ${route} matches ${matches.length} groups (expected exactly 1)`);
    grouped.get(matches[0].label).push(route);
  }
  const section5Body = sectionBody(5);
  let replacedGroups = 0;
  const section5 = section5Body.map((line) => {
    const m = line.match(/^-\s+(Identity\/org|Customers\/sales|Products\/invoices\/reports\/import-export|Field staff):/);
    if (!m) return line;
    replacedGroups += 1;
    return `- ${m[1]}: ${tickGrouped(grouped.get(m[1]), data)}`;
  });
  if (replacedGroups !== 4) fail(`§5: expected 4 group lines, found ${replacedGroups}`);

  // §6 CLOUD list (all CLOUD routes, in JSON order).
  const cloud = routes.filter(([, e]) => e.classification === "CLOUD").map(([r]) => r);
  const section6Heading = `## 6. CLOUD set (${cloud.length} routes — desktop calls the Vercel endpoint)`;
  const section6 = ["", `${tick(cloud)}.`, ""];

  // §7: drop rows for confirmed-CLOUD routes; add the confirmation note once.
  // (§7 rows wrap routes in backticks, unlike the §2 table.)
  const section7Body = sectionBody(7);
  const section7 = section7Body.filter((line) => {
    if (!line.startsWith("|")) return true;
    return !CONFIRMED_CLOUD.some((r) => line.includes(`\`${r}\``));
  });
  if (!section7.join("\n").includes("Confirmed CLOUD 2026-11-19")) {
    // Insert the note after the table (after the last table row).
    let lastRow = -1;
    section7.forEach((line, i) => {
      if (line.startsWith("|")) lastRow = i;
    });
    section7.splice(lastRow + 1, 0, "", CONFIRMED_NOTE);
  }

  // §5 heading count.
  const section5Heading = `## 5. Deferred USER-JWT set (${userJwt.length} routes — Route A, only after the RLS audit, route by route)`;

  // Reassemble: header + sections 1..9, preserving §3, §4, §8, §9 verbatim.
  const out = [];
  out.push(...headerOut);
  const emit = (heading, body) => {
    out.push(heading);
    out.push(...body);
  };
  emit("## 1. Summary", section1);
  emit("## 2. Classification table", section2);
  emit(`## 3. ${headingIdx[2].title}`, sectionBody(3));
  emit(`## 4. ${headingIdx[3].title}`, sectionBody(4));
  emit(section5Heading, section5);
  emit(section6Heading, section6);
  emit(`## 7. ${headingIdx[6].title}`, section7);
  emit(`## 8. ${headingIdx[7].title}`, sectionBody(8));
  emit(`## 9. ${headingIdx[8].title}`, sectionBody(9));
  writeFileSync(md, out.join("\n"));
  console.log(
    `regenerated ${md.split("/").slice(-1)[0]}: ${routes.length} routes — CLOUD ${counts.CLOUD}, LOCAL ${counts.LOCAL}, USER-JWT ${counts["USER-JWT"]} (tip ${data.tip_short})`,
  );
}

main();
