// test-claimless-user.ts — claim-less user proof (SQL pack Step 4 gate).
//
// What it proves, against the DISPOSABLE Supabase project only:
//   A fresh auth user whose app_metadata carries NO organization_id claim,
//   but who HAS a profile row (id = auth.uid(), organization_id = their
//   org), must still see exactly their own org's rows through RLS —
//   because public.current_org_id() falls back to
//   public.current_user_organization_id() when the claim is absent
//   (SQL pack Step 4). And a second org's rows must stay invisible.
//
//   (a) user A (claim-less, org A) reads products + customers: ONLY org
//       A's rows come back — the fallback works;
//   (b) a direct query for org B's rows as user A returns ZERO rows —
//       cross-org isolation holds for a claim-less user;
//   (c) user B (claim-less, org B, nothing seeded there) reads products +
//       customers: ZERO rows — B sees nothing of A's data either.
//
//   If A's reads return NOTHING, the test FAILS LOUDLY: the fallback is
//   missing, i.e. Step 4 has not run on this project yet. If B's rows
//   appear in A's reads, it FAILS LOUDLY as an isolation break. It never
//   hides or swallows either result.
//
// Run it on GitHub Actions (job `claimless-user` in
// .github/workflows/slice1b-admin-tests.yml), which checks this branch
// out and supplies the disposable service key from the secret. Locally
// it cannot run: the admin client needs the real service key in BOTH
// headers and the dev box's vault-surrogate transport cannot deliver
// that (known verdict — two surrogates in one request fail with 403
// credential_ambiguity). The guard below fails fast on the dummy key.
//
// Direct run (manual only — needs a REAL service key in the environment):
//   set -a; . ~/workspace/tradeos-localization/.env.local; set +a
//   npx tsx scripts/test-claimless-user.ts
//
// DISPOSABLE DB ONLY. Never run this against production: it creates real
// auth users, organizations and profiles (all with unmistakable
// CLAIMLESS-TEST markers) plus a few products/customers, and deletes
// them again afterwards. The script needs NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY_APIKEY and
// SUPABASE_SERVICE_ROLE_KEY_BEARER in the environment.
//
// NOT wired into `npm test` (and no `test:claimless-user` npm script):
// it is slow and non-hermetic (needs the disposable service key and
// network access). CI only.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
// rejects it with 401 Invalid API key. A real key arrives either as a
// JWT (from the env file, manual use) or as an `hsurr:` surrogate
// supplied by the Secure Vault connectors (custom.supabase-service-role
// for the apikey header, custom.supabase-service-role-bearer for the
// Bearer header), which the egress swaps for the real key on requests
// to the disposable project. Anything else still fails here — supply
// the real disposable service key before running; do not run this
// against production.
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

const PRODUCT_COUNT = 5;
const CUSTOMER_COUNT = 3;

type TrackedOrg = { userId: string; email: string; orgId: string; orgName: string };
const tracked: TrackedOrg[] = [];

async function makeClaimlessUser(tag: string): Promise<TrackedOrg & { password: string }> {
  const s = suffix();
  const email = `claimless-test-${tag}-${s}@example.invalid`;
  const orgName = `CLAIMLESS-TEST-${tag}-${s}`;
  // One UUID (36 chars) — two UUIDs joined are 73 chars and bcrypt
  // rejects passwords over 72 chars.
  const password = `Cl_${randomBytes(6).toString("base64url")}X1!`;
  // NOTE: no app_metadata is passed on purpose — the user must have NO
  // organization_id claim. Do NOT call /api/auth/provision here: provision
  // writes the claim, which would make this test meaningless.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null, `createUser (${tag}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.user?.id, `createUser (${tag}) must return a user id`);
  const userId = data.user.id;
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: orgName,
      phone: null,
      address: null,
      city: null,
      invoice_footer_note: null,
      default_payment_terms: "Due on receipt",
    })
    .select("id")
    .single();
  assert.equal(orgError, null, `org insert (${tag}) must not error (got ${orgError?.message ?? "?"})`);
  assert.ok(org?.id, `org insert (${tag}) must return an org id`);
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    organization_id: org.id,
    auth_user_id: userId,
    full_name: "Claimless Test",
    email,
    display_name: "Claimless Test",
    role: "owner",
    role_name: "owner",
    is_active: true,
  });
  assert.equal(profileError, null, `profile insert (${tag}) must not error (got ${profileError?.message ?? "?"})`);
  const entry: TrackedOrg = { userId, email, orgId: org.id as string, orgName };
  tracked.push(entry);
  return { ...entry, password };
}

async function getUserClaim(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  assert.equal(error, null, `getUserById must not error (got ${error?.message ?? "?"})`);
  const claim = data.user?.app_metadata?.organization_id;
  return typeof claim === "string" ? claim : null;
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

async function seedOrgRows(orgId: string, stamp: string): Promise<void> {
  const products = Array.from({ length: PRODUCT_COUNT }, (_, i) => ({
    organization_id: orgId,
    name: `Claimless Test Product ${i + 1}`,
    sku: `CLAIMLESS-${stamp}-${String(i + 1).padStart(2, "0")}`,
    barcode: null,
    unit_type: "Pack",
    units_per_pack: null,
    default_selling_price: 100,
    current_stock: 100,
    is_active: true,
  }));
  const { error: pErr } = await admin.from("products").insert(products);
  assert.equal(pErr, null, `product seed must not error (got ${pErr?.message ?? "?"})`);
  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
    organization_id: orgId,
    customer_name: `Claimless Test Customer ${i + 1}`,
    customer_type: "Retailer",
    credit_policy: "cash_only",
    visit_frequency: "weekly",
    priority: "medium",
    is_active: true,
  }));
  const { error: cErr } = await admin.from("customers").insert(customers);
  assert.equal(cErr, null, `customer seed must not error (got ${cErr?.message ?? "?"})`);
}

function userClientFor(email: string, password: string) {
  // Re-assert here: module-level narrowing does not carry into this
  // function body for the compiler.
  assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be set (export the disposable .env.local first)");
  assert.ok(ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (export the disposable .env.local first)");
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { client, signIn: async () => {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    assert.equal(error, null, `signInWithPassword (${email}) must not error (got ${error?.message ?? "?"})`);
    assert.ok(data.session?.access_token, `sign-in (${email}) must return an access token`);
  } };
}

type Row = { id: string; organization_id: string };
type UserClient = ReturnType<typeof userClientFor>["client"];

async function readRows(
  client: UserClient,
  table: "products" | "customers",
  orgId: string | null,
): Promise<Row[]> {
  let q = client.from(table).select("id, organization_id");
  if (orgId !== null) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  assert.equal(error, null, `${table} read must not error (got ${error?.message ?? "?"})`);
  return (data ?? []) as Row[];
}

// Best-effort cleanup: remove every row this script created, then the auth
// users. Each step is independent — a failure is logged, never thrown — so
// one stuck row cannot hide the rest of the cleanup.
async function cleanup(): Promise<void> {
  for (const { userId, orgId, orgName } of tracked) {
    const prod = await admin.from("products").delete().eq("organization_id", orgId);
    console.log(`cleanup: products for org ${orgId}: ${prod.error ? `ERROR ${prod.error.message}` : "deleted"}`);
    const cust = await admin.from("customers").delete().eq("organization_id", orgId);
    console.log(`cleanup: customers for org ${orgId}: ${cust.error ? `ERROR ${cust.error.message}` : "deleted"}`);
    const audit = await admin.from("audit_logs").delete().eq("organization_id", orgId);
    console.log(`cleanup: audit_logs for org ${orgId}: ${audit.error ? `ERROR ${audit.error.message}` : "deleted"}`);
    const perms = await admin.from("staff_permissions").delete().eq("organization_id", orgId);
    console.log(`cleanup: staff_permissions for org ${orgId}: ${perms.error ? `ERROR ${perms.error.message}` : "deleted"}`);
    const prof = await admin
      .from("profiles")
      .delete()
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`);
    console.log(`cleanup: profiles for user ${userId}: ${prof.error ? `ERROR ${prof.error.message}` : "deleted"}`);
    const orgs = await admin.from("organizations").delete().eq("id", orgId);
    console.log(`cleanup: organizations ${orgName}: ${orgs.error ? `ERROR ${orgs.error.message}` : "deleted"}`);
    const del = await admin.auth.admin.deleteUser(userId);
    console.log(`cleanup: auth user ${userId}: ${del.error ? `ERROR ${del.error.message}` : "deleted"}`);
  }
}

async function main(): Promise<void> {
  try {
    // ── Setup: two orgs, each with one claim-less user ──
    const userA = await makeClaimlessUser("a");
    const userB = await makeClaimlessUser("b");
    await seedOrgRows(userA.orgId, userA.orgId.slice(0, 8));

    // ── (1) Both users really have NO claim ──
    assert.equal(await getUserClaim(userA.userId), null, "1. user A must have NO organization_id claim in app_metadata");
    assert.equal(await getUserClaim(userB.userId), null, "2. user B must have NO organization_id claim in app_metadata");
    assert.equal(await getProfileOrg(userA.userId), userA.orgId, "3. user A's profile row must carry org A's id");
    assert.equal(await getProfileOrg(userB.userId), userB.orgId, "4. user B's profile row must carry org B's id");
    console.log("(setup) two claim-less users ready, org A seeded with 5 products + 3 customers");

    // ── (2) User A reads: only org A's rows ──
    const sessionA = userClientFor(userA.email, userA.password);
    await sessionA.signIn();
    const clientA = sessionA.client;
    const productsA = await readRows(clientA, "products", null);
    if (productsA.length === 0) {
      console.log("=".repeat(70));
      console.log("STEP 4 NOT RUN: user A (claim-less, profile present) reads ZERO");
      console.log("products. current_org_id() returned NULL, so the RLS policies");
      console.log("filtered every row out — the Step 4 fallback to");
      console.log("current_user_organization_id() is missing on this project.");
      console.log("Run SQL pack Step 4 on the disposable project first, then");
      console.log("re-run this test.");
      console.log("=".repeat(70));
    }
    assert.equal(
      productsA.length,
      PRODUCT_COUNT,
      `5. user A must read exactly ${PRODUCT_COUNT} products (got ${productsA.length}) — 0 means the Step 4 fallback is missing`,
    );
    assert.ok(
      productsA.every((r) => r.organization_id === userA.orgId),
      `6. every product user A reads must belong to org A (got orgs: ${[...new Set(productsA.map((r) => r.organization_id))].join(", ")})`,
    );
    const customersA = await readRows(clientA, "customers", null);
    assert.equal(
      customersA.length,
      CUSTOMER_COUNT,
      `7. user A must read exactly ${CUSTOMER_COUNT} customers (got ${customersA.length}) — 0 means the Step 4 fallback is missing`,
    );
    assert.ok(
      customersA.every((r) => r.organization_id === userA.orgId),
      `8. every customer user A reads must belong to org A (got orgs: ${[...new Set(customersA.map((r) => r.organization_id))].join(", ")})`,
    );
    console.log(`(a) user A reads OK — ${productsA.length} products + ${customersA.length} customers, all org A (fallback works)`);

    // ── (3) Cross-org isolation: org B's rows must not leak to A ──
    const productsBSeenByA = await readRows(clientA, "products", userB.orgId);
    if (productsBSeenByA.length !== 0) {
      console.log("=".repeat(70));
      console.log("ISOLATION BROKEN: user A (org A) can read org B's products:");
      console.log(`  org B product rows visible to A: ${productsBSeenByA.length}`);
      console.log(`  ids: ${productsBSeenByA.map((r) => r.id).join(", ")}`);
      console.log("  The current_org_id() fallback returned the WRONG org, or");
      console.log("  the products RLS policy does not scope by organization.");
      console.log("=".repeat(70));
    }
    assert.equal(
      productsBSeenByA.length,
      0,
      `9. user A must read ZERO products of org B (got ${productsBSeenByA.length}) — cross-org leak`,
    );
    const customersBSeenByA = await readRows(clientA, "customers", userB.orgId);
    assert.equal(
      customersBSeenByA.length,
      0,
      `10. user A must read ZERO customers of org B (got ${customersBSeenByA.length}) — cross-org leak`,
    );
    console.log("(b) cross-org isolation OK — org B rows invisible to user A");

    // ── (4) User B reads: nothing of A's data ──
    const sessionB = userClientFor(userB.email, userB.password);
    await sessionB.signIn();
    const clientB = sessionB.client;
    const productsB = await readRows(clientB, "products", null);
    assert.equal(
      productsB.length,
      0,
      `11. user B must read ZERO products (got ${productsB.length}) — org A's rows leaked to B`,
    );
    const customersB = await readRows(clientB, "customers", null);
    assert.equal(
      customersB.length,
      0,
      `12. user B must read ZERO customers (got ${customersB.length}) — org A's rows leaked to B`,
    );
    console.log("(c) user B reads OK — zero rows (nothing of org A visible)");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => {
    console.log("test-claimless-user: all assertions passed");
  })
  .catch((err) => {
    console.error(`test-claimless-user: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
