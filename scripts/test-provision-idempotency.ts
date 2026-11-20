// test-provision-idempotency.ts — provision idempotency proof (UMAIR item 2).
//
// What it proves, against the DISPOSABLE Supabase project only:
//   (a) first provision creates exactly ONE profile + ONE org for a fresh user;
//   (b) a second provision with the SAME token (Retry / double-tap) returns
//       alreadyProvisioned:true with the SAME organization_id — no second org;
//   (c) a provision with a FRESH token for the same user (Retry after the 10s
//       timeout, token refreshed) also returns the SAME organization_id;
//   (d) CONCURRENT: two provision POSTs in parallel for one fresh user must
//       leave exactly ONE profile and ONE org. If two org rows exist (the
//       losing call orphaned one), the test FAILS LOUDLY and reports it as a
//       found race — it never hides or swallows that result.
//
// Run it via the vault-backed wrapper (the disposable .env.local holds only
// a dummy service key, so the direct command below fails the guard):
//   python3 ~/workspace/custom-connectors/custom.supabase-service-role/bin/run-idempotency-test.py
// Direct run (manual only — needs a REAL service key in the environment):
//   set -a; . ~/workspace/tradeos-localization/.env.local; set +a
//   npx tsx scripts/test-provision-idempotency.ts
//
// DISPOSABLE DB ONLY. Never run this against production: it creates real
// auth users, organizations and profiles (all with unmistakable
// IDEMPOTENCY-TEST markers) and deletes them again afterwards. The script
// needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY_APIKEY and SUPABASE_SERVICE_ROLE_KEY_BEARER
// in the environment — the disposable .env.local above. It boots
// .next/standalone/server.js (building it with
// AANKH_DESKTOP_BUILD=1 first if it does not exist yet).
//
// TWO SURROGATES: the egress swaps a surrogate only into the header its
// placement names, so the admin client needs the service key in BOTH
// headers from TWO surrogates — `SUPABASE_SERVICE_ROLE_KEY_APIKEY`
// (apikey placement, custom.supabase-service-role) for the `apikey`
// header and `SUPABASE_SERVICE_ROLE_KEY_BEARER` (bearer placement,
// custom.supabase-service-role-bearer) for `Authorization: Bearer`.
// A single surrogate in both headers fails with 403 bad_jwt (verified
// 2026-11-20). The vault-backed wrapper supplies both.
//
// NOT wired into `npm test` (and no `test:provision-idempotency` npm script):
// it is slow (full standalone build when missing + server boot + live
// network calls) and non-hermetic (needs the disposable service key and
// network access). CI and Vercel intentionally have no service key, so the
// script would fail there. Manual runs only, against the disposable project.

import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE = join(ROOT, ".next/standalone/server.js");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY_APIKEY = process.env.SUPABASE_SERVICE_ROLE_KEY_APIKEY;
const SERVICE_KEY_BEARER = process.env.SUPABASE_SERVICE_ROLE_KEY_BEARER;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be set (export the disposable .env.local first)");
assert.ok(ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (export the disposable .env.local first)");
assert.ok(
  SERVICE_KEY_APIKEY,
  "SUPABASE_SERVICE_ROLE_KEY_APIKEY must be set (run via the vault-backed wrapper)",
);
assert.ok(
  SERVICE_KEY_BEARER,
  "SUPABASE_SERVICE_ROLE_KEY_BEARER must be set (run via the vault-backed wrapper)",
);

// Fail fast when a service key is a placeholder, not a JWT. As of
// 2026-11-20 the disposable .env.local carries the sentinel
// "qa-fail-closed-dummy-key" instead of a real service key — Supabase
// rejects it with 401 Invalid API key, so both the admin API calls below
// and the route's service-role calls cannot work. A real key arrives either
// as a JWT (from the env file, manual use) or as an `hsurr:` surrogate
// supplied by the Secure Vault connectors
// (custom.supabase-service-role for the apikey header,
// custom.supabase-service-role-bearer for the Bearer header), which the
// egress swaps for the real key on requests to the disposable project.
// Anything else still fails here — supply the real disposable service key
// before running; do not run this against production.
const looksLikeServiceKey = (value: string): boolean =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
  value.startsWith("hsurr:");
assert.ok(
  looksLikeServiceKey(SERVICE_KEY_APIKEY),
  "SUPABASE_SERVICE_ROLE_KEY_APIKEY must be a JWT or an hsurr: vault surrogate (the disposable .env.local currently holds the qa-fail-closed-dummy-key sentinel) — supply the real disposable service key before running this test",
);
assert.ok(
  looksLikeServiceKey(SERVICE_KEY_BEARER),
  "SUPABASE_SERVICE_ROLE_KEY_BEARER must be a JWT or an hsurr: vault surrogate (the disposable .env.local currently holds the qa-fail-closed-dummy-key sentinel) — supply the real disposable service key before running this test",
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const suffix = () => randomBytes(4).toString("hex");

// The admin client must send the service key in BOTH headers, from TWO
// surrogates: the egress swaps each surrogate only into the header its
// placement names, so one surrogate cannot fill both. The custom fetch
// below sets `apikey` from the apikey-placement surrogate and
// `Authorization: Bearer` from the bearer-placement surrogate, while the
// createClient key argument (apikey surrogate) covers any call that only
// sets the apikey header itself.
const adminFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_KEY_APIKEY);
  headers.set("Authorization", `Bearer ${SERVICE_KEY_BEARER}`);
  return fetch(input, { ...init, headers });
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY_APIKEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: adminFetch },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ProvisionResult = {
  status: number;
  body: Record<string, unknown>;
};

async function provision(token: string): Promise<ProvisionResult> {
  const res = await fetch(`${BASE}/api/auth/provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { _unparsed: await res.text().catch(() => "") };
  }
  return { status: res.status, body };
}

async function countProfiles(userId: string): Promise<number> {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .or(`id.eq.${userId},auth_user_id.eq.${userId}`);
  assert.equal(error, null, `profile count query must not error (got ${error?.message ?? "?"})`);
  return count ?? 0;
}

async function getProfileOrg(userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, organization_id")
    .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
    .maybeSingle();
  assert.equal(error, null, `profile read must not error (got ${error?.message ?? "?"})`);
  return (data?.organization_id as string | null) ?? null;
}

async function countOrgsByName(name: string): Promise<{ count: number; ids: string[] }> {
  const { data, count, error } = await admin
    .from("organizations")
    .select("id", { count: "exact" })
    .eq("name", name);
  assert.equal(error, null, `org count query must not error (got ${error?.message ?? "?"})`);
  return { count: count ?? 0, ids: (data ?? []).map((row) => row.id as string) };
}

async function getUserClaim(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  assert.equal(error, null, `getUserById must not error (got ${error?.message ?? "?"})`);
  const claim = data.user?.app_metadata?.organization_id;
  return typeof claim === "string" ? claim : null;
}

type TrackedUser = { userId: string; email: string; orgName: string };
const tracked: TrackedUser[] = [];

async function makeTestUser(tag: string): Promise<TrackedUser & { password: string }> {
  const s = suffix();
  const email = `idempotency-test-${tag}-${s}@example.invalid`;
  const orgName = `IDEMPOTENCY-TEST-${tag}-${s}`;
  const password = `Idem_${randomBytes(6).toString("base64url")}X1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Idempotency Test", organization_name: orgName },
  });
  assert.equal(error, null, `createUser (${tag}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.user?.id, `createUser (${tag}) must return a user id`);
  const user: TrackedUser = { userId: data.user.id, email, orgName };
  tracked.push(user);
  return { ...user, password } as TrackedUser & { password: string };
}

async function signIn(email: string, password: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `signInWithPassword (${email}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.session?.access_token, `sign-in (${email}) must return an access token`);
  return data.session.access_token;
}

// Best-effort cleanup: remove every row this script created, then the auth
// users. Each step is independent — a failure is logged, never thrown — so
// one stuck row cannot hide the rest of the cleanup.
async function cleanup(): Promise<void> {
  for (const { userId, orgName } of tracked) {
    const { ids: orgIds } = await countOrgsByName(orgName).catch(() => ({ count: 0, ids: [] as string[] }));
    for (const orgId of orgIds) {
      const audit = await admin.from("audit_logs").delete().eq("organization_id", orgId);
      console.log(`cleanup: audit_logs for org ${orgId}: ${audit.error ? `ERROR ${audit.error.message}` : "deleted"}`);
      const perms = await admin.from("staff_permissions").delete().eq("organization_id", orgId);
      console.log(`cleanup: staff_permissions for org ${orgId}: ${perms.error ? `ERROR ${perms.error.message}` : "deleted"}`);
    }
    const prof = await admin
      .from("profiles")
      .delete()
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`);
    console.log(`cleanup: profiles for user ${userId}: ${prof.error ? `ERROR ${prof.error.message}` : "deleted"}`);
    const orgs = await admin.from("organizations").delete().eq("name", orgName);
    console.log(`cleanup: organizations named ${orgName}: ${orgs.error ? `ERROR ${orgs.error.message}` : "deleted"}`);
    const del = await admin.auth.admin.deleteUser(userId);
    console.log(`cleanup: auth user ${userId}: ${del.error ? `ERROR ${del.error.message}` : "deleted"}`);
  }
}

async function bootServer(): Promise<() => Promise<void>> {
  if (!existsSync(STANDALONE)) {
    console.log("note: no standalone build yet — building with AANKH_DESKTOP_BUILD=1 ...");
    execSync("npm run build", {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, AANKH_DESKTOP_BUILD: "1" },
    });
  }
  assert.ok(existsSync(STANDALONE), "standalone server must exist after build");
  const child = spawn("node", [STANDALONE], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).split("\n").slice(-20).join("\n");
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise((r) => child.once("exit", r));
      }
    }
  };
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`standalone server exited early (code ${child.exitCode}) — last output:\n${tail}`);
    }
    try {
      const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) {
        console.log(`note: standalone server up on ${BASE}`);
        return stop;
      }
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  await stop();
  throw new Error("standalone server did not answer GET /login with 200 within 60s");
}

async function main(): Promise<void> {
  const stopServer = await bootServer();
  try {
    // ── (a) First provision: exactly one profile + one org ──
    const userA = await makeTestUser("a");
    const tokenA = await signIn(userA.email, userA.password);
    const first = await provision(tokenA);
    assert.equal(first.status, 200, `1. first provision must return 200 (got ${first.status}: ${JSON.stringify(first.body)})`);
    assert.equal(first.body.ok, true, `2. first provision must return ok:true (${JSON.stringify(first.body)})`);
    assert.equal(first.body.alreadyProvisioned, false, `3. first provision must return alreadyProvisioned:false (${JSON.stringify(first.body)})`);
    const orgA = first.body.organization_id;
    assert.equal(typeof orgA, "string", `4. first provision must return an organization_id (${JSON.stringify(first.body)})`);
    assert.ok((orgA as string).length > 0, "5. organization_id must be non-empty");
    assert.equal(await countProfiles(userA.userId), 1, "6. exactly ONE profile row must exist for user A after first provision");
    const orgsA1 = await countOrgsByName(userA.orgName);
    assert.equal(orgsA1.count, 1, `7. exactly ONE org must exist for user A after first provision (got ${orgsA1.count}: ${orgsA1.ids.join(", ")})`);
    assert.equal(await getProfileOrg(userA.userId), orgA, "8. profile.organization_id must equal the returned organization_id");
    assert.equal(await getUserClaim(userA.userId), orgA, "9. the org claim in app_metadata must equal the returned organization_id");
    console.log(`(a) first provision OK — org ${orgA}`);

    // ── (b) Same token again (Retry / double-tap) ──
    const second = await provision(tokenA);
    assert.equal(second.status, 200, `10. retry with the same token must return 200 (got ${second.status}: ${JSON.stringify(second.body)})`);
    assert.equal(second.body.ok, true, `11. retry must return ok:true (${JSON.stringify(second.body)})`);
    assert.equal(second.body.alreadyProvisioned, true, `12. retry must return alreadyProvisioned:true (${JSON.stringify(second.body)})`);
    assert.equal(second.body.organization_id, orgA, `13. retry must return the SAME organization_id (${JSON.stringify(second.body)} vs ${orgA})`);
    assert.equal(await countProfiles(userA.userId), 1, "14. still exactly ONE profile row for user A after retry");
    const orgsA2 = await countOrgsByName(userA.orgName);
    assert.equal(orgsA2.count, 1, `15. still exactly ONE org for user A after retry (got ${orgsA2.count}: ${orgsA2.ids.join(", ")})`);
    console.log(`(b) same-token retry OK — same org ${orgA}`);

    // ── (c) Fresh token for the same user (Retry after the 10s timeout) ──
    const tokenA2 = await signIn(userA.email, userA.password);
    const third = await provision(tokenA2);
    assert.equal(third.status, 200, `16. provision with a fresh token must return 200 (got ${third.status}: ${JSON.stringify(third.body)})`);
    assert.equal(third.body.ok, true, `17. fresh-token provision must return ok:true (${JSON.stringify(third.body)})`);
    assert.equal(third.body.alreadyProvisioned, true, `18. fresh-token provision must return alreadyProvisioned:true (${JSON.stringify(third.body)})`);
    assert.equal(third.body.organization_id, orgA, `19. fresh-token provision must return the SAME organization_id (${JSON.stringify(third.body)} vs ${orgA})`);
    assert.equal(await countProfiles(userA.userId), 1, "20. still exactly ONE profile row for user A after fresh-token provision");
    const orgsA3 = await countOrgsByName(userA.orgName);
    assert.equal(orgsA3.count, 1, `21. still exactly ONE org for user A after fresh-token provision (got ${orgsA3.count}: ${orgsA3.ids.join(", ")})`);
    console.log(`(c) fresh-token retry OK — same org ${orgA}`);

    // ── (d) CONCURRENT: two provision POSTs in parallel, one fresh user ──
    const userB = await makeTestUser("b");
    const tokenB = await signIn(userB.email, userB.password);
    const [r1, r2] = await Promise.all([provision(tokenB), provision(tokenB)]);
    console.log(`(d) parallel responses: [1] status=${r1.status} body=${JSON.stringify(r1.body)}`);
    console.log(`(d) parallel responses: [2] status=${r2.status} body=${JSON.stringify(r2.body)}`);
    const winnerOk = r1.body.ok === true || r2.body.ok === true;
    assert.equal(winnerOk, true, `22. at least one parallel provision must succeed (got ${JSON.stringify(r1.body)} and ${JSON.stringify(r2.body)})`);
    const profileCountB = await countProfiles(userB.userId);
    assert.equal(profileCountB, 1, `23. exactly ONE profile row must exist for user B after parallel provision (got ${profileCountB})`);
    const profileOrgB = await getProfileOrg(userB.userId);
    assert.ok(profileOrgB, "24. user B must have a profile with an organization_id after parallel provision");
    const returnedOrgs = [r1.body.organization_id, r2.body.organization_id].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    assert.ok(
      returnedOrgs.includes(profileOrgB as string),
      `25. profile.organization_id (${profileOrgB}) must be one of the returned org ids (${returnedOrgs.join(", ")})`,
    );
    const orgsB = await countOrgsByName(userB.orgName);
    console.log(`(d) concurrent verdict: profile rows=${profileCountB}, profile org=${profileOrgB}, org rows named ${userB.orgName}=${orgsB.count} [${orgsB.ids.join(", ")}]`);
    if (orgsB.count !== 1) {
      console.log("=".repeat(70));
      console.log("RACE FOUND: concurrent provision created MORE THAN ONE organization");
      console.log(`  user: ${userB.userId} (${userB.email})`);
      console.log(`  response org ids: ${returnedOrgs.join(", ") || "(none returned)"}`);
      console.log(`  profile.organization_id (winner): ${profileOrgB}`);
      console.log(`  org rows with name ${userB.orgName}: ${orgsB.count} [${orgsB.ids.join(", ")}]`);
      console.log(`  orphaned org(s) (created by the losing call, linked to no profile): ${orgsB.ids.filter((id) => id !== profileOrgB).join(", ") || "(none)"}`);
      console.log("  The losing call inserted its org, then its profile insert failed on");
      console.log("  the profiles PK / auth_user_id unique index — the org row stays.");
      console.log("=".repeat(70));
    }
    assert.equal(
      orgsB.count,
      1,
      `26. CONCURRENT CASE: exactly ONE org must exist for user B (got ${orgsB.count}: ${orgsB.ids.join(", ")}). RACE: the losing parallel call orphaned org(s) ${orgsB.ids.filter((id) => id !== profileOrgB).join(", ")}`,
    );
    console.log(`(d) concurrent provision OK — one profile, one org ${profileOrgB} (no race observed this run)`);
  } finally {
    await cleanup();
    await stopServer();
  }
}

main()
  .then(() => {
    console.log("test-provision-idempotency: all assertions passed");
  })
  .catch((err) => {
    console.error(`test-provision-idempotency: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
