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
//   (d) CLAIM-FIRST (Claude audit, message 24): a user WITH an
//       organization_id claim whose profile row points at a DIFFERENT
//       org must read the CLAIM org's rows, not the profile org's —
//       the claim wins, per the coalesce order in current_org_id().
//   (e) TWO PROFILE ROWS (Claude audit, message 24): the profiles
//       schema forbids two rows for one auth_user_id (partial unique
//       index profiles_auth_user_id_unique_idx, WHERE auth_user_id IS
//       NOT NULL). The duplicate case cannot be constructed, so the
//       test asserts the constraint itself: a second insert must fail
//       with 23505 naming that index. If it ever succeeds, the test
//       FAILS LOUDLY — the schema has drifted and the duplicate hazard
//       the SQL pack pre-check guards against is live.
//   (f) USER_METADATA ATTACK (Claude message 40 — the one that
//       matters): current_org_id() reads app_metadata, then
//       user_metadata, then the top-level claim, then the profile
//       fallback — and user_metadata is writable by the user
//       themselves via auth.updateUser({ data }). A claim-less user
//       has no app_metadata claim, so the function falls through to
//       user_metadata: user A sets user_metadata.organization_id to
//       org B's id with A's OWN JWT, refreshes the session, then
//       reads org B's rows. Expect ZERO. If ANY row is visible the
//       test FAILS LOUDLY with a USER_METADATA HOLE CONFIRMED banner
//       — the fallback is a cross-org hole and Step 4 must remove
//       the user_metadata branch (a security patch) before any
//       installer goes to other people. The app writes the claim
//       ONLY to app_metadata (provision + staff onboarding), so no
//       legitimate flow depends on the user_metadata branch.
//   (g) 33-TABLE READ (message 40): every table whose RLS policy
//       calls current_org_id() — 33 tables, taken from the repo
//       policy names — is read as user A. Org B rows are seeded in
//       products, customers, sales_transactions, sales_items,
//       brands, categories, territories and suppliers; on every
//       other table there are no rows in either org, so the
//       assertion there is "zero rows total" (documented, not
//       hidden). One assertion per table.
//   (h) WRITE / WITH CHECK (message 40): user A tries to insert a
//       row carrying org B's id (products, customers, brands,
//       categories, territories) — each must fail with 42501 —
//       tries to move an org A product to org B (WITH CHECK, must
//       fail 42501) and to rename an org B product (invisible row,
//       zero rows affected). Admin re-reads afterwards prove
//       nothing was written or changed.
//   (i) NO-PROFILE / NULL / ANON (message 40): a bare auth user
//       with no profile row, and the anon role, read zero rows with
//       no error. A profile with NULL organization_id cannot be
//       constructed on this schema (profiles.organization_id is NOT
//       NULL) — like (e), the test asserts the constraint instead
//       (insert must fail 23502); if the insert ever succeeds, the
//       zero-rows read is tested for real.
//   (j) DEACTIVATED (message 40): a claim-less user whose profile
//       is_active = false signs in and reads. The helper has no
//       is_active check, so the user may keep reading until the
//       token expires — the test asserts the read does not error
//       and PRINTS the observed row count as a documented
//       observation (DEACTIVATED BEHAVIOUR). It does NOT gate
//       Sunday on it.
//   (k) E2E SALE + PURCHASE (message 40): an atomic sale as the
//       claim-less user via the user-JWT client
//       (create_sales_invoice_atomic, granted to authenticated),
//       read back by A and invisible to B; and the purchase leg:
//       the user calling create_purchase_atomic directly must get a
//       permission error (the RPC is service_role-only by design —
//       Slice 4), while an admin-created purchase in each org is
//       read back with no org B rows visible to A. The HTTP
//       cloud-route leg of the purchase cannot be exercised from
//       this script (no web server in the CI job); it is covered
//       by the packaged test matrix, not here.
//
//   89 assertions in total (1-12: a/b/c; 13-19: claim-first;
//   20-23: duplicate-profile constraint; 24-29: user_metadata
//   attack; 30-62: 33-table read loop; 63-71: write loop;
//   72-76: no-profile / NULL / anon; 77: deactivated;
//   78-89: E2E sale + purchase).
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
import { randomBytes, randomUUID } from "node:crypto";
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

// Bare auth users with no org/profile (the duplicate-profile case
// needs a second, valid auth.users id for the FK on profiles.id).
const extraAuthUsers: string[] = [];

async function makeBareAuthUser(tag: string): Promise<{ userId: string; email: string; password: string }> {
  const s = suffix();
  const email = `claimless-test-${tag}-${s}@example.invalid`;
  const password = `Cl_${randomBytes(6).toString("base64url")}X1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null, `createUser (${tag}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.user?.id, `createUser (${tag}) must return a user id`);
  extraAuthUsers.push(data.user.id);
  return { userId: data.user.id, email, password };
}

async function makeClaimFirstUser(): Promise<{
  userId: string;
  email: string;
  password: string;
  claimOrgId: string;
  profileOrgId: string;
}> {
  const s = suffix();
  const email = `claimless-test-claimfirst-${s}@example.invalid`;
  const password = `Cl_${randomBytes(6).toString("base64url")}X1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null, `createUser (claim-first) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.user?.id, "createUser (claim-first) must return a user id");
  const userId = data.user.id;
  // Two orgs: the claim points at org C, the profile row at org D.
  const mkOrg = async (tag: string): Promise<string> => {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: `CLAIMLESS-TEST-claimfirst-${tag}-${s}`,
        phone: null,
        address: null,
        city: null,
        invoice_footer_note: null,
        default_payment_terms: "Due on receipt",
      })
      .select("id")
      .single();
    assert.equal(orgError, null, `org insert (claim-first ${tag}) must not error (got ${orgError?.message ?? "?"})`);
    assert.ok(org?.id, `org insert (claim-first ${tag}) must return an org id`);
    return org.id as string;
  };
  const claimOrgId = await mkOrg("claim");
  const profileOrgId = await mkOrg("profile");
  // Set the claim AFTER createUser — the same proven pattern as the
  // bench script's claim user (updateUserById + verify with
  // getUserById). Do NOT call /api/auth/provision here: provision
  // would write the claim AND the profile for the same org.
  const { error: claimError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { organization_id: claimOrgId },
  });
  assert.equal(claimError, null, `claim set (claim-first) must not error (got ${claimError?.message ?? "?"})`);
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    organization_id: profileOrgId,
    auth_user_id: userId,
    full_name: "Claimless Test",
    email,
    display_name: "Claimless Test",
    role: "owner",
    role_name: "owner",
    is_active: true,
  });
  assert.equal(profileError, null, `profile insert (claim-first) must not error (got ${profileError?.message ?? "?"})`);
  await seedOrgRows(claimOrgId, claimOrgId.slice(0, 8));
  await seedOrgRows(profileOrgId, profileOrgId.slice(0, 8));
  // Two tracked entries share this userId: cleanup deletes both orgs
  // (the second pass no-ops on rows the first pass already removed).
  tracked.push({ userId, email, orgId: claimOrgId, orgName: `CLAIMLESS-TEST-claimfirst-claim-${s}` });
  tracked.push({ userId, email, orgId: profileOrgId, orgName: `CLAIMLESS-TEST-claimfirst-profile-${s}` });
  return { userId, email, password, claimOrgId, profileOrgId };
}

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

// ── Message 40 additions ──

// The 33 tables whose RLS policies call public.current_org_id(),
// taken from the repo policy names (production_phase4/5/5c/7 +
// production_upgrade_consolidated + add_customer_fields). 28 of
// them scope by a direct organization_id column; 5 scope through a
// parent row (EXISTS … parent …) and carry no organization_id
// column of their own that this script can rely on — sales_items
// is the exception, it gained organization_id via the backfill
// (fix_sales_items_org_backfill.sql) and is read with the column.
const RLS_TABLES: { table: string; hasOrgColumn: boolean }[] = [
  { table: "attendance_records", hasOrgColumn: true },
  { table: "brands", hasOrgColumn: true },
  { table: "categories", hasOrgColumn: true },
  { table: "collections", hasOrgColumn: true },
  { table: "customer_feedback", hasOrgColumn: true },
  { table: "customer_payment_allocations", hasOrgColumn: true },
  { table: "customer_payments", hasOrgColumn: true },
  { table: "customer_product_prices", hasOrgColumn: true },
  { table: "customer_visits", hasOrgColumn: true },
  { table: "customers", hasOrgColumn: true },
  { table: "employees", hasOrgColumn: true },
  { table: "import_export_templates", hasOrgColumn: true },
  { table: "import_exports", hasOrgColumn: true },
  { table: "inventory_transactions", hasOrgColumn: true },
  { table: "notifications", hasOrgColumn: true },
  { table: "print_templates", hasOrgColumn: true },
  { table: "products", hasOrgColumn: true },
  { table: "purchase_order_items", hasOrgColumn: false },
  { table: "purchase_orders", hasOrgColumn: true },
  { table: "purchase_return_items", hasOrgColumn: false },
  { table: "purchase_returns", hasOrgColumn: true },
  { table: "sales_items", hasOrgColumn: true },
  { table: "sales_order_items", hasOrgColumn: false },
  { table: "sales_orders", hasOrgColumn: true },
  { table: "sales_return_items", hasOrgColumn: false },
  { table: "sales_returns", hasOrgColumn: true },
  { table: "sales_route_stops", hasOrgColumn: false },
  { table: "sales_routes", hasOrgColumn: true },
  { table: "sales_targets", hasOrgColumn: true },
  { table: "sales_transactions", hasOrgColumn: true },
  { table: "supplier_payment_allocations", hasOrgColumn: true },
  { table: "supplier_payments", hasOrgColumn: true },
  { table: "territories", hasOrgColumn: true },
];

type TableRow = { id: string; organization_id?: string };

async function readTableAs(client: UserClient, table: string, hasOrgColumn: boolean): Promise<TableRow[]> {
  const { data, error } = hasOrgColumn
    ? await client.from(table).select("id, organization_id").limit(200)
    : await client.from(table).select("id").limit(200);
  assert.equal(error, null, `${table} read must not error (got ${error?.message ?? "?"})`);
  return (data ?? []) as TableRow[];
}

// One row per simple org-scoped table (brands / categories /
// territories / suppliers) — the columns are the required ones per
// the repo (name / supplier_name NOT NULL, organization_id NOT NULL).
async function seedOrgSimpleRows(orgId: string, stamp: string): Promise<void> {
  const { error: bErr } = await admin.from("brands").insert({ organization_id: orgId, name: `Claimless Test Brand ${stamp}` });
  assert.equal(bErr, null, `brand seed must not error (got ${bErr?.message ?? "?"})`);
  const { error: cErr } = await admin.from("categories").insert({ organization_id: orgId, name: `Claimless Test Category ${stamp}` });
  assert.equal(cErr, null, `category seed must not error (got ${cErr?.message ?? "?"})`);
  const { error: tErr } = await admin.from("territories").insert({ organization_id: orgId, name: `Claimless Test Territory ${stamp}` });
  assert.equal(tErr, null, `territory seed must not error (got ${tErr?.message ?? "?"})`);
  const { error: sErr } = await admin.from("suppliers").insert({ organization_id: orgId, supplier_name: `Claimless Test Supplier ${stamp}` });
  assert.equal(sErr, null, `supplier seed must not error (got ${sErr?.message ?? "?"})`);
}

// Extra sales_transactions rows via direct admin insert — the same
// column set the bench's 50,000-row seed uses, so it cannot fail on
// a NOT NULL the RPC itself satisfies. No items: the inventory
// triggers live on sales_items, not sales_transactions.
const SALE_DATE = new Date().toISOString().slice(0, 10);

async function seedOrgSalesDirect(orgId: string, customerId: string, actorProfileId: string, count: number, stamp: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const total = 100 + i;
    const { data, error } = await admin
      .from("sales_transactions")
      .insert({
        organization_id: orgId,
        customer_id: customerId,
        invoice_number: `CLAIMLESS-${stamp}-${String(i + 1).padStart(2, "0")}`,
        sale_date: SALE_DATE,
        payment_type: "cash",
        credit_due_date: null,
        credit_limit_snapshot: null,
        credit_days_snapshot: null,
        notes: null,
        total_amount: total,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        status: "paid",
        invoice_type: "sales",
        created_by_profile_id: actorProfileId,
        request_id: randomUUID(),
        request_fingerprint: `claimless-${stamp}-${i}`,
        cash_received: total,
        change_due: 0,
      })
      .select("id")
      .single();
    assert.equal(error, null, `direct sale seed must not error (got ${error?.message ?? "?"})`);
    assert.ok(data?.id, "direct sale seed must return an id");
    ids.push(String(data.id));
  }
  return ids;
}

// The atomic sale RPC as a user-JWT client — same p_input shape the
// bench uses (create_sales_invoice_atomic is granted to
// authenticated, unlike create_purchase_atomic which is
// service_role-only). Prices are the seeded 100 per line. Returns
// the raw outcome — call sites assert (numbered in the E2E section,
// unnumbered setup asserts where the call is only seeding).
async function callSaleRpcAs(
  client: UserClient,
  customerId: string,
  productIds: string[],
): Promise<{
  error: string | null;
  transactionId: string | null;
  invoiceNumber: string | null;
  itemCount: number;
}> {
  const lines = productIds.map((id) => ({
    product_id: id,
    quantity: 1,
    selling_price: 100,
    discount: 0,
    bonus: 0,
    unit_mode: "main" as const,
  }));
  const total = lines.length * 100;
  const { data, error } = await (client.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: { transaction?: Record<string, unknown>; items?: unknown[] } | null; error: { message?: string } | null }>)(
    "create_sales_invoice_atomic",
    {
      p_request_id: randomUUID(),
      p_input: {
        customer_id: customerId,
        sale_date: SALE_DATE,
        payment_type: "cash",
        invoice_discount: 0,
        invoice_discount_type: "flat",
        tax_rate: 0,
        cash_received: total,
        notes: null,
        credit_override_confirmed: false,
        lines,
      },
    },
  );
  const tx = data?.transaction;
  return {
    error: error?.message ?? null,
    transactionId: typeof tx?.id === "string" ? tx.id : null,
    invoiceNumber: typeof tx?.invoice_number === "string" ? tx.invoice_number : null,
    itemCount: Array.isArray(data?.items) ? data.items.length : 0,
  };
}

// Best-effort cleanup: remove every row this script created, then the auth
// users. Each step is independent — a failure is logged, never thrown — so
// one stuck row cannot hide the rest of the cleanup. Order is FK-safe:
// items before their parent transactions, transactions before the org
// rows they reference, profiles before the org, org before the auth user.
async function cleanup(): Promise<void> {
  for (const { userId, orgId, orgName } of tracked) {
    const sItems = await admin.from("sales_items").delete().eq("organization_id", orgId);
    console.log(`cleanup: sales_items for org ${orgId}: ${sItems.error ? `ERROR ${sItems.error.message}` : "deleted"}`);
    const pItems = await admin.from("purchase_items").delete().eq("organization_id", orgId);
    console.log(`cleanup: purchase_items for org ${orgId}: ${pItems.error ? `ERROR ${pItems.error.message}` : "deleted"}`);
    const sales = await admin.from("sales_transactions").delete().eq("organization_id", orgId);
    console.log(`cleanup: sales_transactions for org ${orgId}: ${sales.error ? `ERROR ${sales.error.message}` : "deleted"}`);
    const purch = await admin.from("purchase_transactions").delete().eq("organization_id", orgId);
    console.log(`cleanup: purchase_transactions for org ${orgId}: ${purch.error ? `ERROR ${purch.error.message}` : "deleted"}`);
    const prod = await admin.from("products").delete().eq("organization_id", orgId);
    console.log(`cleanup: products for org ${orgId}: ${prod.error ? `ERROR ${prod.error.message}` : "deleted"}`);
    const cust = await admin.from("customers").delete().eq("organization_id", orgId);
    console.log(`cleanup: customers for org ${orgId}: ${cust.error ? `ERROR ${cust.error.message}` : "deleted"}`);
    for (const t of ["brands", "categories", "territories", "suppliers"] as const) {
      const r = await admin.from(t).delete().eq("organization_id", orgId);
      console.log(`cleanup: ${t} for org ${orgId}: ${r.error ? `ERROR ${r.error.message}` : "deleted"}`);
    }
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
  for (const uid of extraAuthUsers) {
    // Bare auth users have no tracked org, but a NULL-org profile may
    // have been created for one (section 11) — remove it first.
    const prof = await admin.from("profiles").delete().or(`id.eq.${uid},auth_user_id.eq.${uid}`);
    console.log(`cleanup: extra profiles for user ${uid}: ${prof.error ? `ERROR ${prof.error.message}` : "deleted"}`);
    const del = await admin.auth.admin.deleteUser(uid);
    console.log(`cleanup: extra auth user ${uid}: ${del.error ? `ERROR ${del.error.message}` : "deleted"}`);
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

    // ── (5) CLAIM-FIRST: the claim org wins over the profile org ──
    // current_org_id() coalesces claim first, profile fallback last,
    // so a user whose claim says org C but whose profile says org D
    // must see C's rows and none of D's. If the reads came back with
    // D's rows, the claim would not be winning and the Step 4
    // fallback would be shadowing the claim.
    const userC = await makeClaimFirstUser();
    assert.equal(
      await getUserClaim(userC.userId),
      userC.claimOrgId,
      "13. claim-first user must carry the claim org in app_metadata",
    );
    assert.equal(
      await getProfileOrg(userC.userId),
      userC.profileOrgId,
      "14. claim-first user's profile row must carry the profile org",
    );
    const sessionC = userClientFor(userC.email, userC.password);
    await sessionC.signIn();
    const clientC = sessionC.client;
    const productsC = await readRows(clientC, "products", null);
    assert.equal(
      productsC.length,
      PRODUCT_COUNT,
      `15. claim-first user must read exactly ${PRODUCT_COUNT} products of the CLAIM org (got ${productsC.length}) — the claim did not win over the profile org`,
    );
    assert.ok(
      productsC.every((r) => r.organization_id === userC.claimOrgId),
      `16. every product the claim-first user reads must belong to the CLAIM org (got orgs: ${[...new Set(productsC.map((r) => r.organization_id))].join(", ")})`,
    );
    const productsDSeenByC = await readRows(clientC, "products", userC.profileOrgId);
    assert.equal(
      productsDSeenByC.length,
      0,
      `17. claim-first user must read ZERO products of the PROFILE org (got ${productsDSeenByC.length}) — the profile org leaked past the claim`,
    );
    const customersC = await readRows(clientC, "customers", null);
    assert.equal(
      customersC.length,
      CUSTOMER_COUNT,
      `18. claim-first user must read exactly ${CUSTOMER_COUNT} customers of the CLAIM org (got ${customersC.length})`,
    );
    assert.ok(
      customersC.every((r) => r.organization_id === userC.claimOrgId),
      `19. every customer the claim-first user reads must belong to the CLAIM org (got orgs: ${[...new Set(customersC.map((r) => r.organization_id))].join(", ")})`,
    );
    console.log("(d) claim-first OK — reads return the CLAIM org's rows, profile org invisible");

    // ── (6) TWO PROFILE ROWS: the schema forbids them ──
    // Repo evidence (20261011 snapshot): profiles carries the partial
    // unique index profiles_auth_user_id_unique_idx on (auth_user_id)
    // WHERE auth_user_id IS NOT NULL, plus PRIMARY KEY (id). Two rows
    // for one auth_user_id cannot exist, so current_org_id()'s
    // "limit 1 without order by" can never pick the wrong one of a
    // pair — the hazard the SQL pack pre-check guards against could
    // only come from rows created before the index existed. This case
    // asserts the constraint itself: the second insert must fail with
    // 23505 naming that index. If it ever succeeds, the test FAILS
    // LOUDLY — the schema has drifted and the duplicate hazard is live.
    const userE = await makeClaimlessUser("e");
    const userF = await makeBareAuthUser("f");
    const { error: dupError } = await admin.from("profiles").insert({
      id: userF.userId,
      organization_id: userE.orgId,
      auth_user_id: userE.userId,
      full_name: "Claimless Test Duplicate",
      email: userF.email,
      display_name: "Claimless Test Duplicate",
      role: "owner",
      role_name: "owner",
      is_active: true,
    });
    if (!dupError) {
      const { data: dupRows } = await admin
        .from("profiles")
        .select("id, organization_id")
        .or(`id.eq.${userE.userId},auth_user_id.eq.${userE.userId}`);
      console.log("=".repeat(70));
      console.log("SCHEMA DRIFT: a second profile row for the same auth_user_id");
      console.log("was ACCEPTED — profiles_auth_user_id_unique_idx is missing");
      console.log("on this project. The duplicate-profile hazard is LIVE:");
      console.log(`  rows for user E: ${JSON.stringify(dupRows)}`);
      console.log("  current_org_id() 'limit 1' can pick either org.");
      console.log("=".repeat(70));
    }
    assert.ok(
      dupError,
      "20. second profile row for the same auth_user_id must be rejected — the insert succeeded, so profiles_auth_user_id_unique_idx is missing on this project",
    );
    assert.equal(
      dupError.code,
      "23505",
      `21. duplicate profile insert must fail with unique-violation 23505 (got ${dupError.code}: ${dupError.message})`,
    );
    assert.ok(
      dupError.message.includes("profiles_auth_user_id_unique_idx"),
      `22. duplicate violation must name profiles_auth_user_id_unique_idx (got: ${dupError.message})`,
    );
    const { data: eProfiles, error: eProfilesError } = await admin
      .from("profiles")
      .select("id")
      .or(`id.eq.${userE.userId},auth_user_id.eq.${userE.userId}`);
    assert.equal(eProfilesError, null, `profile re-read must not error (got ${eProfilesError?.message ?? "?"})`);
    assert.equal(
      (eProfiles ?? []).length,
      1,
      `23. exactly one profile row must exist for user E after the rejected insert (got ${(eProfiles ?? []).length})`,
    );
    console.log("(e) duplicate-profile constraint OK — second row rejected with 23505 on profiles_auth_user_id_unique_idx");

    // ── (8) Seed org B rows — AFTER section (4), where user B had to
    //    read zero first — plus one simple row per org for brands /
    //    categories / territories / suppliers. The B sale goes
    //    through the atomic sale RPC as user B (clientB is still
    //    signed in from section 4), so sales_items rows exist for
    //    org B too.
    await seedOrgRows(userB.orgId, userB.orgId.slice(0, 8));
    await seedOrgSimpleRows(userA.orgId, userA.orgId.slice(0, 8));
    await seedOrgSimpleRows(userB.orgId, userB.orgId.slice(0, 8));
    const { data: bProductsSeed, error: bProductsSeedError } = await admin
      .from("products")
      .select("id")
      .eq("organization_id", userB.orgId);
    assert.equal(bProductsSeedError, null, `B product seed read must not error (got ${bProductsSeedError?.message ?? "?"})`);
    const { data: bCustomersSeed, error: bCustomersSeedError } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", userB.orgId);
    assert.equal(bCustomersSeedError, null, `B customer seed read must not error (got ${bCustomersSeedError?.message ?? "?"})`);
    assert.equal((bProductsSeed ?? []).length, PRODUCT_COUNT, `B seed must hold ${PRODUCT_COUNT} products`);
    assert.equal((bCustomersSeed ?? []).length, CUSTOMER_COUNT, `B seed must hold ${CUSTOMER_COUNT} customers`);
    const bSaleSeed = await callSaleRpcAs(
      clientB,
      String((bCustomersSeed ?? [])[0].id),
      (bProductsSeed ?? []).slice(0, 2).map((r) => String(r.id)),
    );
    assert.equal(bSaleSeed.error, null, `B seed sale RPC must not error (got ${bSaleSeed.error ?? "?"})`);
    assert.equal(bSaleSeed.itemCount, 2, `B seed sale must create 2 items (got ${bSaleSeed.itemCount})`);
    await seedOrgSalesDirect(userB.orgId, String((bCustomersSeed ?? [])[0].id), userB.userId, 2, userB.orgId.slice(0, 8));
    console.log("(seed) org B holds 5 products + 3 customers + 3 sales (1 RPC + 2 direct) + 2 sale items; simple rows seeded for both orgs");

    // ── (7) USER_METADATA ATTACK (Claude message 40) ──
    // The user poisons their OWN metadata with the user-JWT client,
    // exactly as a real attacker would — never via admin.
    const { error: poisonError } = await clientA.auth.updateUser({ data: { organization_id: userB.orgId } });
    assert.equal(poisonError, null, `poisoning user_metadata must not error (got ${poisonError?.message ?? "?"})`);
    const { error: refreshError } = await clientA.auth.refreshSession();
    assert.equal(refreshError, null, `session refresh after poisoning must not error (got ${refreshError?.message ?? "?"})`);
    // Prove the poisoning actually landed — otherwise a pass here
    // would be vacuous (an updateUser that silently dropped the key
    // would "pass" without testing anything).
    const { data: poisonedUser, error: poisonedReadError } = await admin.auth.admin.getUserById(userA.userId);
    assert.equal(poisonedReadError, null, `poisoned user re-read must not error (got ${poisonedReadError?.message ?? "?"})`);
    assert.equal(
      poisonedUser.user?.user_metadata?.organization_id,
      userB.orgId,
      "24. the poisoned user_metadata.organization_id must read back as org B's id — the attack did not land, so the rows below prove nothing",
    );
    // Informational only, never a fail: how many users on this
    // project carry a user_metadata.organization_id at all? A
    // non-zero count means real users depend on the branch and its
    // removal needs their claims migrated first.
    const { data: allUsers, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (!listError && allUsers?.users) {
      const carriers = allUsers.users.filter((u) => typeof u.user_metadata?.organization_id === "string");
      console.log(`(f) users carrying user_metadata.organization_id on this project: ${carriers.length} (informational — the app writes the claim to app_metadata only)`);
    }
    const productsAAfterAttack = await readRows(clientA, "products", null);
    assert.ok(
      productsAAfterAttack.length === PRODUCT_COUNT &&
        productsAAfterAttack.every((r) => r.organization_id === userA.orgId),
      `25. after the user_metadata attack user A must still read exactly ${PRODUCT_COUNT} products, all org A (got ${productsAAfterAttack.length} rows, orgs: ${[...new Set(productsAAfterAttack.map((r) => r.organization_id))].join(", ") || "none"})`,
    );
    const productsBSeenAfterAttack = await readRows(clientA, "products", userB.orgId);
    if (productsBSeenAfterAttack.length !== 0) {
      console.log("=".repeat(70));
      console.log("USER_METADATA HOLE CONFIRMED: user A (claim-less, org A)");
      console.log("set user_metadata.organization_id to org B's id, refreshed");
      console.log("the session, and can now read org B's products:");
      console.log(`  org B product rows visible to A: ${productsBSeenAfterAttack.length}`);
      console.log(`  ids: ${productsBSeenAfterAttack.map((r) => r.id).join(", ")}`);
      console.log("  current_org_id() fell through to the user-controlled");
      console.log("  user_metadata branch. Remove that branch (security");
      console.log("  patch) before any installer goes to other people.");
      console.log("=".repeat(70));
    }
    assert.equal(
      productsBSeenAfterAttack.length,
      0,
      `26. after the user_metadata attack user A must read ZERO products of org B (got ${productsBSeenAfterAttack.length}) — USER_METADATA HOLE CONFIRMED`,
    );
    const customersBSeenAfterAttack = await readRows(clientA, "customers", userB.orgId);
    assert.equal(
      customersBSeenAfterAttack.length,
      0,
      `27. after the user_metadata attack user A must read ZERO customers of org B (got ${customersBSeenAfterAttack.length}) — USER_METADATA HOLE CONFIRMED`,
    );
    const salesSeenAfterAttack = await readTableAs(clientA, "sales_transactions", true);
    assert.equal(
      salesSeenAfterAttack.filter((r) => r.organization_id === userB.orgId).length,
      0,
      `28. after the user_metadata attack user A must read ZERO sales of org B (got ${salesSeenAfterAttack.filter((r) => r.organization_id === userB.orgId).length}) — USER_METADATA HOLE CONFIRMED`,
    );
    // Clear the poison so later sections run with a clean token.
    const { error: cleanError } = await clientA.auth.updateUser({ data: { organization_id: null } });
    assert.equal(cleanError, null, `clearing the poisoned user_metadata must not error (got ${cleanError?.message ?? "?"})`);
    const { error: cleanRefreshError } = await clientA.auth.refreshSession();
    assert.equal(cleanRefreshError, null, `session refresh after clearing must not error (got ${cleanRefreshError?.message ?? "?"})`);
    const productsAAfterClean = await readRows(clientA, "products", null);
    assert.equal(
      productsAAfterClean.length,
      PRODUCT_COUNT,
      `29. after clearing the poisoned user_metadata user A must read exactly ${PRODUCT_COUNT} products of org A again (got ${productsAAfterClean.length})`,
    );
    console.log("(f) user_metadata attack OK — poisoned metadata changes nothing (no hole on this project)");

    // ── (9) 33-TABLE READ (message 40) ──
    // One assertion per table. Tables where org A has seeded rows
    // assert the exact count, all org A. Every other table has no
    // rows in either org, so the assertion there is zero rows total:
    // any row at all would be a leak (org B rows are seeded in
    // products / customers / sales_transactions / sales_items /
    // brands / categories / territories / suppliers) or a seed
    // error. The shared `organization_id = current_org_id()` policy
    // form is repo evidence for all 33; this loop is the runtime
    // proof on the seeded tables.
    const EXPECTED_A: Record<string, number> = {
      products: PRODUCT_COUNT,
      customers: CUSTOMER_COUNT,
      brands: 1,
      categories: 1,
      territories: 1,
      suppliers: 1,
    };
    let readN = 30;
    for (const { table, hasOrgColumn } of RLS_TABLES) {
      const rows = await readTableAs(clientA, table, hasOrgColumn);
      if (table in EXPECTED_A) {
        assert.ok(
          rows.length === EXPECTED_A[table] && rows.every((r) => r.organization_id === userA.orgId),
          `${readN}. ${table}: user A must read exactly ${EXPECTED_A[table]} rows, all org A (got ${rows.length} rows, orgs: ${[...new Set(rows.map((r) => r.organization_id))].join(", ") || "none"})`,
        );
      } else {
        assert.equal(
          rows.length,
          0,
          `${readN}. ${table}: user A must read ZERO rows (got ${rows.length}) — nothing is seeded for either org here, so any row would be a leak`,
        );
      }
      readN++;
    }
    assert.equal(readN, 63, `read loop must cover exactly 33 tables (ended at assertion ${readN - 1})`);
    console.log("(g) 33-table read OK — no org B row visible to user A on any of the 33 RLS tables");

    // ── (10) WRITE / WITH CHECK (message 40) ──
    const wrongSuffix = suffix();
    const prodWrong = await clientA.from("products").insert({
      organization_id: userB.orgId,
      name: `Claimless Test WRONG ORG Product ${wrongSuffix}`,
      sku: `WRONG-${wrongSuffix}`,
      unit_type: "Pack",
      default_selling_price: 100,
      current_stock: 1,
      is_active: true,
    });
    assert.equal(
      prodWrong.error?.code,
      "42501",
      `63. inserting a product with org B's id as user A must fail with 42501 (got ${prodWrong.error?.code ?? "no error — the row was inserted!"})`,
    );
    const custWrong = await clientA.from("customers").insert({
      organization_id: userB.orgId,
      customer_name: `Claimless Test WRONG ORG ${wrongSuffix}`,
      customer_type: "Retailer",
      credit_policy: "cash_only",
      visit_frequency: "weekly",
      priority: "medium",
      is_active: true,
    });
    assert.equal(
      custWrong.error?.code,
      "42501",
      `64. inserting a customer with org B's id as user A must fail with 42501 (got ${custWrong.error?.code ?? "no error — the row was inserted!"})`,
    );
    const brandWrong = await clientA.from("brands").insert({ organization_id: userB.orgId, name: `Claimless Test WRONG ORG Brand ${wrongSuffix}` });
    assert.equal(
      brandWrong.error?.code,
      "42501",
      `65. inserting a brand with org B's id as user A must fail with 42501 (got ${brandWrong.error?.code ?? "no error — the row was inserted!"})`,
    );
    const catWrong = await clientA.from("categories").insert({ organization_id: userB.orgId, name: `Claimless Test WRONG ORG Category ${wrongSuffix}` });
    assert.equal(
      catWrong.error?.code,
      "42501",
      `66. inserting a category with org B's id as user A must fail with 42501 (got ${catWrong.error?.code ?? "no error — the row was inserted!"})`,
    );
    const terrWrong = await clientA.from("territories").insert({ organization_id: userB.orgId, name: `Claimless Test WRONG ORG Territory ${wrongSuffix}` });
    assert.equal(
      terrWrong.error?.code,
      "42501",
      `67. inserting a territory with org B's id as user A must fail with 42501 (got ${terrWrong.error?.code ?? "no error — the row was inserted!"})`,
    );
    const { data: aProductBefore, error: aProductBeforeError } = await admin
      .from("products")
      .select("name")
      .eq("id", productsA[0].id)
      .single();
    assert.equal(aProductBeforeError, null, `org A product re-read must not error (got ${aProductBeforeError?.message ?? "?"})`);
    const aProductName = String((aProductBefore as { name?: unknown } | null)?.name ?? "");
    const moveWrong = await clientA.from("products").update({ organization_id: userB.orgId }).eq("id", productsA[0].id);
    assert.equal(
      moveWrong.error?.code,
      "42501",
      `68. moving an org A product to org B as user A must fail with 42501 (WITH CHECK) (got ${moveWrong.error?.code ?? "no error — the move went through!"})`,
    );
    const { data: bProductPick, error: bProductPickError } = await admin
      .from("products")
      .select("id, name")
      .eq("organization_id", userB.orgId)
      .limit(1)
      .single();
    assert.equal(bProductPickError, null, `org B product pick must not error (got ${bProductPickError?.message ?? "?"})`);
    const bProductId = String((bProductPick as { id?: unknown } | null)?.id ?? "");
    const bProductName = String((bProductPick as { name?: unknown } | null)?.name ?? "");
    const renameWrong = await clientA.from("products").update({ name: "HACKED BY A" }).eq("id", bProductId);
    assert.equal(
      (renameWrong.data ?? []).length,
      0,
      `69. updating an org B product as user A must affect ZERO rows (got ${(renameWrong.data ?? []).length}) — the row is invisible to A`,
    );
    const { data: bProductsAfterWrite, error: bAfterError } = await admin
      .from("products")
      .select("id")
      .eq("organization_id", userB.orgId);
    assert.equal(bAfterError, null, `org B product re-read must not error (got ${bAfterError?.message ?? "?"})`);
    const { data: bProductAfter, error: bProductAfterError } = await admin
      .from("products")
      .select("name")
      .eq("id", bProductId)
      .single();
    assert.equal(bProductAfterError, null, `org B product re-read must not error (got ${bProductAfterError?.message ?? "?"})`);
    assert.ok(
      (bProductsAfterWrite ?? []).length === PRODUCT_COUNT &&
        String((bProductAfter as { name?: unknown } | null)?.name ?? "") === bProductName,
      `70. org B must still have exactly ${PRODUCT_COUNT} products, and the renamed product must be unchanged, after the write attempts (got ${(bProductsAfterWrite ?? []).length} products, name ${String((bProductAfter as { name?: unknown } | null)?.name ?? "?")})`,
    );
    const { data: aProductAfter, error: aProductAfterError } = await admin
      .from("products")
      .select("name")
      .eq("id", productsA[0].id)
      .single();
    assert.equal(aProductAfterError, null, `org A product re-read must not error (got ${aProductAfterError?.message ?? "?"})`);
    assert.equal(
      String((aProductAfter as { name?: unknown } | null)?.name ?? ""),
      aProductName,
      `71. the org A product must be unchanged after the failed move (got ${String((aProductAfter as { name?: unknown } | null)?.name ?? "")}, was ${aProductName})`,
    );
    console.log("(h) write isolation OK — cross-org inserts fail 42501, the move fails WITH CHECK, the invisible rename touches zero rows");

    // ── (11) NO-PROFILE / NULL / ANON (message 40) ──
    const userG = await makeBareAuthUser("g");
    const sessionG = userClientFor(userG.email, userG.password);
    await sessionG.signIn();
    const productsG = await readRows(sessionG.client, "products", null);
    assert.equal(
      productsG.length,
      0,
      `72. a user with NO profile row must read ZERO products (got ${productsG.length})`,
    );
    const customersG = await readRows(sessionG.client, "customers", null);
    assert.equal(
      customersG.length,
      0,
      `73. a user with NO profile row must read ZERO customers (got ${customersG.length})`,
    );
    const userH = await makeBareAuthUser("h");
    const { error: nullOrgError } = await admin.from("profiles").insert({
      id: userH.userId,
      organization_id: null,
      auth_user_id: userH.userId,
      full_name: "Claimless Test Null Org",
      email: userH.email,
      display_name: "Claimless Test Null Org",
      role: "owner",
      role_name: "owner",
      is_active: true,
    });
    if (nullOrgError) {
      assert.equal(
        nullOrgError.code,
        "23502",
        `74. a profile with NULL organization_id must fail with not-null violation 23502 (got ${nullOrgError.code}: ${nullOrgError.message}) — the NULL-org case is unconstructible on this schema, so the constraint is asserted instead`,
      );
      console.log("(i) NULL organization_id profile is unconstructible — NOT NULL constraint asserted (23502)");
    } else {
      // The insert succeeded: the NULL-org case IS constructible on
      // this project, so test the read for real.
      const sessionH = userClientFor(userH.email, userH.password);
      await sessionH.signIn();
      const productsH = await readRows(sessionH.client, "products", null);
      assert.equal(
        productsH.length,
        0,
        `74. a user whose profile has NULL organization_id must read ZERO products (got ${productsH.length})`,
      );
      console.log("(i) NULL organization_id profile exists on this project — zero-rows read verified");
    }
    assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be set (export the disposable .env.local first)");
    assert.ok(ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (export the disposable .env.local first)");
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anonProducts = await readTableAs(anonClient, "products", true);
    assert.equal(
      anonProducts.length,
      0,
      `75. the anon role must read ZERO products (got ${anonProducts.length})`,
    );
    const anonCustomers = await readTableAs(anonClient, "customers", true);
    assert.equal(
      anonCustomers.length,
      0,
      `76. the anon role must read ZERO customers (got ${anonCustomers.length})`,
    );
    console.log("(i) no-profile / NULL / anon OK — zero rows, no errors");

    // ── (12) DEACTIVATED (message 40) ──
    // The helper has no is_active check, so the expected outcome is
    // that the user keeps reading until the token expires. The test
    // asserts the read does not error and prints the observed count
    // as a documented observation — it does NOT gate Sunday on it.
    const userD = await makeClaimlessUser("d");
    await seedOrgRows(userD.orgId, userD.orgId.slice(0, 8));
    const { error: deactivateError } = await admin.from("profiles").update({ is_active: false }).eq("id", userD.userId);
    assert.equal(deactivateError, null, `deactivating user D's profile must not error (got ${deactivateError?.message ?? "?"})`);
    const sessionD = userClientFor(userD.email, userD.password);
    await sessionD.signIn();
    const productsD = await readRows(sessionD.client, "products", null);
    assert.ok(
      productsD.length === 0 || productsD.length === PRODUCT_COUNT,
      `77. a deactivated claim-less user must read either ZERO products (is_active enforced) or exactly ${PRODUCT_COUNT} (not enforced) — got ${productsD.length}, which is neither`,
    );
    console.log("=".repeat(70));
    console.log(`DEACTIVATED BEHAVIOUR: user D (profile is_active = false, claim-less) reads ${productsD.length} products.`);
    if (productsD.length === PRODUCT_COUNT) {
      console.log("  The helper has no is_active check: a deactivated user keeps reading until the token expires.");
      console.log("  Known, NOT Sunday-blocking — documented here per Claude message 40.");
    } else {
      console.log("  Reads return nothing for a deactivated profile on this project.");
    }
    console.log("=".repeat(70));

    // ── (13) E2E SALE + PURCHASE (message 40) ──
    // Sale as the claim-less user, via the user-JWT client.
    const saleA = await callSaleRpcAs(clientA, customersA[0].id, [productsA[0].id, productsA[1].id]);
    assert.equal(saleA.error, null, `78. atomic sale as a claim-less user must not error (got ${saleA.error ?? "?"})`);
    assert.ok(saleA.transactionId, `79. atomic sale must return a transaction id (got ${saleA.transactionId ?? "none"})`);
    assert.ok(saleA.invoiceNumber, `80. atomic sale must return an invoice_number (got ${saleA.invoiceNumber ?? "none"})`);
    assert.equal(saleA.itemCount, 2, `81. atomic sale must create 2 items (got ${saleA.itemCount})`);
    const { data: saleBack, error: saleBackError } = await clientA
      .from("sales_transactions")
      .select("id")
      .eq("id", saleA.transactionId as string);
    assert.equal(saleBackError, null, `sale read-back must not error (got ${saleBackError?.message ?? "?"})`);
    assert.equal(
      (saleBack ?? []).length,
      1,
      `82. user A must read back the sale just created (got ${(saleBack ?? []).length})`,
    );
    const { data: itemsBack, error: itemsBackError } = await clientA
      .from("sales_items")
      .select("id")
      .eq("sales_transaction_id", saleA.transactionId as string);
    assert.equal(itemsBackError, null, `sale items read-back must not error (got ${itemsBackError?.message ?? "?"})`);
    assert.equal(
      (itemsBack ?? []).length,
      2,
      `83. user A must read back 2 items for the sale (got ${(itemsBack ?? []).length})`,
    );
    const { data: saleSeenByB, error: saleSeenByBError } = await clientB
      .from("sales_transactions")
      .select("id")
      .eq("id", saleA.transactionId as string);
    assert.equal(saleSeenByBError, null, `B sale read must not error (got ${saleSeenByBError?.message ?? "?"})`);
    assert.equal(
      (saleSeenByB ?? []).length,
      0,
      `84. user B must read ZERO rows of user A's sale (got ${(saleSeenByB ?? []).length})`,
    );
    // Purchase: the RPC is service_role-only (revoked from
    // authenticated), so the user-JWT call itself must fail — that
    // IS the assertion. The HTTP cloud-route leg cannot be
    // exercised from this script (no web server in the CI job);
    // it is covered by the packaged test matrix, not here.
    type PurchaseRpc = (fn: string, params: Record<string, unknown>) => Promise<{
      data: { transaction?: Record<string, unknown>; items?: unknown[] } | null;
      error: { message?: string; code?: string } | null;
    }>;
    const purchaseDirect = await (clientA.rpc as unknown as PurchaseRpc)("create_purchase_atomic", {
      p_organization_id: userA.orgId,
      p_actor_profile_id: userA.userId,
      p_input: {
        supplier_id: "00000000-0000-0000-0000-000000000000",
        request_key: randomUUID(),
        payment_type: "cash",
        purchase_date: SALE_DATE,
        lines: [{ product_id: productsA[0].id, quantity: 1, purchase_price: 50 }],
      },
    });
    assert.ok(
      purchaseDirect.error,
      "85. calling create_purchase_atomic as a claim-less user must FAIL (the RPC is service_role-only) — it succeeded, the revoke is broken",
    );
    assert.ok(
      (purchaseDirect.error?.message ?? "").toLowerCase().includes("permission denied"),
      `86. the failed purchase call must be a permission denial (got: ${purchaseDirect.error?.message ?? "?"})`,
    );
    // Admin creates one purchase per org via the RPC (service role);
    // the suppliers come from the section (8) simple-row seeds.
    const { data: supplierA, error: supplierAError } = await admin
      .from("suppliers")
      .select("id")
      .eq("organization_id", userA.orgId)
      .single();
    assert.equal(supplierAError, null, `org A supplier read must not error (got ${supplierAError?.message ?? "?"})`);
    const { data: supplierB, error: supplierBError } = await admin
      .from("suppliers")
      .select("id")
      .eq("organization_id", userB.orgId)
      .single();
    assert.equal(supplierBError, null, `org B supplier read must not error (got ${supplierBError?.message ?? "?"})`);
    const purchaseA = await (admin.rpc as unknown as PurchaseRpc)("create_purchase_atomic", {
      p_organization_id: userA.orgId,
      p_actor_profile_id: userA.userId,
      p_input: {
        supplier_id: String((supplierA as { id?: unknown } | null)?.id ?? ""),
        request_key: randomUUID(),
        payment_type: "cash",
        purchase_date: SALE_DATE,
        lines: [{ product_id: productsA[0].id, quantity: 1, purchase_price: 50 }],
      },
    });
    assert.ok(
      !purchaseA.error && (purchaseA.data?.transaction as { id?: unknown } | undefined)?.id,
      `87. admin purchase in org A must succeed with a transaction id (got error: ${purchaseA.error?.message ?? "none"})`,
    );
    const purchaseB = await (admin.rpc as unknown as PurchaseRpc)("create_purchase_atomic", {
      p_organization_id: userB.orgId,
      p_actor_profile_id: userB.userId,
      p_input: {
        supplier_id: String((supplierB as { id?: unknown } | null)?.id ?? ""),
        request_key: randomUUID(),
        payment_type: "cash",
        purchase_date: SALE_DATE,
        lines: [{ product_id: String((bProductsSeed ?? [])[0].id), quantity: 1, purchase_price: 50 }],
      },
    });
    assert.ok(
      !purchaseB.error && (purchaseB.data?.transaction as { id?: unknown } | undefined)?.id,
      `88. admin purchase in org B must succeed with a transaction id (got error: ${purchaseB.error?.message ?? "none"})`,
    );
    const purchasesSeenByA = await readTableAs(clientA, "purchase_transactions", true);
    assert.equal(
      purchasesSeenByA.filter((r) => r.organization_id === userB.orgId).length,
      0,
      `89. user A must read ZERO purchase_transactions rows of org B (got ${purchasesSeenByA.filter((r) => r.organization_id === userB.orgId).length}) — org A's purchase may or may not be visible depending on the table's RLS state, but B's must never leak`,
    );
    console.log("(k) E2E OK — atomic sale as a claim-less user confirms end to end; purchase RPC revoke holds; no org B purchase rows visible to A");
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
