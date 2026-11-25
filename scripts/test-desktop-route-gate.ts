import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const GATE = join(ROOT, "scripts", "check-desktop-routes.mjs");
const MANIFEST = join(ROOT, "DESKTOP_ROUTE_CLASSIFICATION.json");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

// The gate checks the two NEXT_PUBLIC vars are non-empty when present in the
// environment; pass dummy non-empty values so the test does not depend on a
// real .env.local (the gate never prints or uses their values beyond the
// non-empty check).
const ENV = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

function runGate(args: string[], timeout?: number): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("node", [GATE, ...args], { encoding: "utf8", env: ENV, timeout });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}

function withTempManifest(mutator: (data: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "desktop-route-gate-"));
  const path = join(dir, "manifest.json");
  const data = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    routes: Record<string, Record<string, unknown>>;
  };
  mutator(data as unknown as Record<string, unknown>);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

// 1. Real manifest: gate passes.
const green = runGate([]);
assert.equal(green.status, 0, "1. Gate passes on the real manifest");
assert.match(green.stdout, /GATE: PASS/, "2. Real-manifest run prints GATE: PASS");

// 2. UMAIR's explicit test — a CLOUD route relabelled LOCAL must fail,
//    naming the route (flip in a scratch manifest, never the real one).
const flipped = withTempManifest((data) => {
  const d = data as { routes: Record<string, Record<string, unknown>> };
  d.routes["/api/purchases"].classification = "LOCAL";
});
const flip = runGate(["--manifest", flipped]);
assert.equal(flip.status, 1, "3. Gate fails when /api/purchases is flipped CLOUD -> LOCAL");
assert.match(
  flip.stdout,
  /\/api\/purchases \(LOCAL\) calls createSupabaseService\(\)/,
  "4. Flip failure names /api/purchases and the service call",
);
assert.match(flip.stdout, /route\.ts:27/, "5. Flip failure names the route file line");
rmSync(join(flipped, ".."), { recursive: true, force: true });

// 3. Migrated-route hardening bites: a migrated route that never verifies a
//    Bearer token must fail.
const migrated = withTempManifest((data) => {
  const d = data as { routes: Record<string, Record<string, unknown>> };
  d.routes["/api/pos-release-environment"].migrated = true;
});
const mig = runGate(["--manifest", migrated]);
assert.equal(mig.status, 1, "6. Gate fails for a migrated route with no Bearer verification");
assert.match(
  mig.stdout,
  /\/api\/pos-release-environment \(migrated: true\) does not verify the Bearer token/,
  "7. Migrated-route failure names the route and the missing Bearer check",
);
rmSync(join(migrated, ".."), { recursive: true, force: true });

// 4. Stale manifest entry fails.
const stale = withTempManifest((data) => {
  const d = data as { routes: Record<string, Record<string, unknown>> };
  d.routes["/api/does-not-exist"] = { methods: "GET", classification: "LOCAL", called_from_desktop: "no" };
});
const staleRun = runGate(["--manifest", stale]);
assert.equal(staleRun.status, 1, "8. Gate fails on a stale manifest entry");
assert.match(staleRun.stdout, /stale manifest entry: \/api\/does-not-exist/, "9. Stale-entry failure names the entry");
rmSync(join(stale, ".."), { recursive: true, force: true });

// 5. Version/tag guard: a mismatched tag fails, the matching tag passes.
const badTag = runGate(["--tag", "v9.9.9"]);
assert.equal(badTag.status, 1, "10. Gate fails when the tag does not match package.json version");
assert.match(badTag.stdout, /does not equal package\.json version/, "11. Tag failure names the mismatch");
const goodTag = runGate(["--tag", `v${pkg.version}`]);
assert.equal(goodTag.status, 0, "12. Gate passes when the tag matches package.json version");

// 6. Pending-fetch ratchet (UMAIR item 4): the count of direct renderer
//    fetches of unmigrated CLOUD routes (9 on the real manifest after
//    Slice 6 moved currency + AI + location calls to the cloud-endpoint helper)
//    must never exceed the manifest baseline. Force it via a scratch
//    manifest's baseline — never by editing real routes.
//    (a) Baseline 0 < real count 9 -> FAIL, naming count and baseline.
const lowBaseline = withTempManifest((data) => {
  const d = data as { ratchet: { pending_direct_cloud_fetches: number } };
  d.ratchet.pending_direct_cloud_fetches = 0;
});
const lowRun = runGate(["--manifest", lowBaseline]);
assert.equal(lowRun.status, 1, "13. Gate fails when pending fetches exceed the ratchet baseline");
assert.match(
  lowRun.stdout,
  /pending direct CLOUD fetches: 9 exceeds the ratchet baseline 0/,
  "14. Ratchet failure names the count (9) and the baseline (0)",
);
rmSync(join(lowBaseline, ".."), { recursive: true, force: true });
//    (b) Baseline above the real count -> PASS, and the ratchet line shows it.
const highBaseline = withTempManifest((data) => {
  const d = data as { ratchet: { pending_direct_cloud_fetches: number } };
  d.ratchet.pending_direct_cloud_fetches = 999;
});
const highRun = runGate(["--manifest", highBaseline]);
assert.equal(highRun.status, 0, "15. Gate passes when pending fetches are at/below the ratchet baseline");
assert.match(highRun.stdout, /pending direct CLOUD fetches: 9 \(ratchet baseline 999/, "16. Ratchet line shows count 9 against baseline 999");
rmSync(join(highBaseline, ".."), { recursive: true, force: true });
//    (c) The real-manifest run prints the ratchet line at baseline 9.
assert.match(green.stdout, /pending direct CLOUD fetches: 9 \(ratchet baseline 9/, "17. Real-manifest run shows the ratchet line (9 vs baseline 9)");
//    (d) A manifest with no ratchet field at all -> FAIL (the baseline is mandatory).
const noRatchet = withTempManifest((data) => {
  const d = data as { ratchet?: unknown };
  delete d.ratchet;
});
const noRatchetRun = runGate(["--manifest", noRatchet]);
assert.equal(noRatchetRun.status, 1, "18. Gate fails when the manifest has no ratchet baseline");
assert.match(noRatchetRun.stdout, /no ratchet\.pending_direct_cloud_fetches baseline/, "19. Missing-baseline failure names the ratchet field");
rmSync(join(noRatchet, ".."), { recursive: true, force: true });

// Smoke mode must return the probes' verdict after terminating its child.
const fixtureDir = mkdtempSync(join(tmpdir(), "desktop-route-smoke-"));
try {
  const port = execFileSync(process.execPath, ["-e", `
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => {
      console.log(server.address().port);
      server.close();
    });
  `], { encoding: "utf8", timeout: 5_000 }).trim();
  const fixture = join(fixtureDir, "server.cjs");
  const smokeArgs = ["--smoke", "--standalone", fixture, "--port", port];
  for (const [provisionStatus, expectedExit, verdict] of [[500, 1, "FAIL"], [401, 0, "PASS"]] as const) {
    writeFileSync(fixture, `
      require("node:http").createServer((request, response) => {
        if (request.url === "/login") response.statusCode = 200;
        else if (request.url === "/api/auth/provision") response.statusCode = ${provisionStatus};
        else response.statusCode = 401;
        response.end();
      }).listen(Number(process.env.PORT), process.env.HOSTNAME);
    `);
    const smoke = runGate(smokeArgs, 20_000);
    assert.equal(smoke.status, expectedExit, `Smoke probe HTTP ${provisionStatus} must exit ${expectedExit}\n${smoke.stdout}`);
    assert.ok(smoke.stdout.includes(`SMOKE: ${verdict}`), `Smoke probe HTTP ${provisionStatus} must print ${verdict}`);
  }
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log("test-desktop-route-gate: all assertions passed");
