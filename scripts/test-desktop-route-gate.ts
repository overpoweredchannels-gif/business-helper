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

function runGate(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("node", [GATE, ...args], { encoding: "utf8", env: ENV });
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
assert.match(flip.stdout, /route\.ts:19/, "5. Flip failure names the route file line");
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

console.log("test-desktop-route-gate: all assertions passed");
