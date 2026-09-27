import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// This script deliberately reads only POS_RELEASE_* variables. It never loads
// .env.local and refuses to run without a database-side isolation marker.
const names = [
  "POS_RELEASE_TEST_TARGET", "POS_RELEASE_TEST_DATABASE_URL", "POS_RELEASE_SUPABASE_URL", "POS_RELEASE_APP_URL",
  "POS_RELEASE_SUPABASE_ANON_KEY", "POS_RELEASE_ORGANIZATION_ID", "POS_RELEASE_OWNER_PROFILE_ID",
  "POS_RELEASE_EMPLOYEE_PROFILE_ID", "POS_RELEASE_INACTIVE_PROFILE_ID", "POS_RELEASE_OTHER_ORG_ID",
  "POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID", "POS_RELEASE_CASH_CUSTOMER_ID", "POS_RELEASE_CREDIT_CUSTOMER_ID",
  "POS_RELEASE_STOCK_PRODUCT_ID", "POS_RELEASE_CREDIT_PRODUCT_ID", "POS_RELEASE_AUTH_PRODUCT_ID",
  "POS_RELEASE_OWNER_ACCESS_TOKEN", "POS_RELEASE_EMPLOYEE_ACCESS_TOKEN",
  "POS_RELEASE_INACTIVE_ACCESS_TOKEN", "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN",
];
const missing = names.filter(name => name !== "POS_RELEASE_TEST_TARGET" && !process.env[name]);
if (process.env.POS_RELEASE_TEST_TARGET !== "disposable-pos-atomic-sales") {
  missing.unshift("POS_RELEASE_TEST_TARGET=disposable-pos-atomic-sales (explicit opt-in)");
}

type SqlOutcome = {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};
type Session = {
  result: Promise<SqlOutcome>;
  done: Promise<SqlOutcome>;
  terminate: () => void;
  isClosed: () => boolean;
};
const env = process.env;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const uuid = (name: string) => {
  const value = env[name]!;
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, `${name} must be a UUID`);
  return value;
};
function verifyExplicitProjectTarget() {
  const database = new URL(env.POS_RELEASE_TEST_DATABASE_URL!);
  const supabase = new URL(env.POS_RELEASE_SUPABASE_URL!);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const localTarget = localHosts.has(database.hostname) && localHosts.has(supabase.hostname);
  if (!localTarget) {
    const databaseRef = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(database.hostname)?.[1]
      ?? /^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(database.username))?.[1];
    const apiRef = /^([a-z0-9-]+)\.supabase\.co$/i.exec(supabase.hostname)?.[1];
    assert.ok(databaseRef && apiRef && databaseRef === apiRef,
      "database and Supabase API must identify the same hosted project, or both be local loopback endpoints");
  }
  assert.ok(supabase.protocol === "https:" || localTarget, "non-local Supabase API must use HTTPS");
}
type UserToken = { token: string; userId: string; sessionId: string; expiresAt: number };
function assertAuthenticatedUserToken(name: string): UserToken {
  const token = env[name]!;
  const payload = token.split(".")[1];
  assert.ok(payload, `${name} must be a JWT access token`);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    role?: string; sub?: string; session_id?: string; exp?: number;
  };
  assert.equal(claims.role, "authenticated", `${name} must be a user JWT, not a service-role or anon key`);
  assert.match(String(claims.sub ?? ""), /^[0-9a-f-]{36}$/i, `${name} must contain a user UUID`);
  assert.match(String(claims.session_id ?? ""), /^[0-9a-f-]{36}$/i, `${name} must contain a session UUID`);
  assert.ok(Number.isInteger(claims.exp) && claims.exp! > Math.floor(Date.now() / 1000), `${name} must be unexpired`);
  return { token, userId: claims.sub!, sessionId: claims.session_id!, expiresAt: claims.exp! };
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function startPsql(sql: string, timeoutMs = 30_000): Session {
  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  let closed = false;
  let timedOut = false;
  let resultSettled = false;
  let doneSettled = false;
  let resultResolve!: (outcome: SqlOutcome) => void;
  let doneResolve!: (outcome: SqlOutcome) => void;
  const result = new Promise<SqlOutcome>(resolve => { resultResolve = resolve; });
  const done = new Promise<SqlOutcome>(resolve => { doneResolve = resolve; });
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let exitCode: number | null = null;
  let spawnError = "";
  const outcome = (ok: boolean, error?: string): SqlOutcome => ({ ok, error, stdout, stderr, exitCode, timedOut });
  const settleResult = (value: SqlOutcome) => {
    if (resultSettled) return;
    resultSettled = true;
    resultResolve(value);
  };
  const settleDone = (value: SqlOutcome) => {
    if (doneSettled) return;
    doneSettled = true;
    doneResolve(value);
  };
  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      const parsed = outcome(true);
      parsed.value = value;
      settleResult(parsed);
    } catch (error) {
      spawnError = `Invalid JSON output from psql: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const flushLines = (final = false) => {
    if (final) {
      if (lineBuffer) parseLine(lineBuffer);
      lineBuffer = "";
      return;
    }
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) parseLine(line);
  };
  const finish = (code: number | null, error?: string) => {
    if (closed) return;
    closed = true;
    exitCode = code;
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    flushLines(true);
    const finalError = error ?? spawnError ?? (timedOut ? `psql timed out after ${timeoutMs}ms` : code === 0 ? undefined : `psql exited ${code}: ${stderr.trim()}`);
    const successful = code === 0 && !timedOut && !finalError;
    if (!resultSettled) {
      settleResult(outcome(successful, finalError));
    }
    settleDone(outcome(successful, finalError));
  };
  try {
    child = spawn("psql", ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", env.POS_RELEASE_TEST_DATABASE_URL!], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
  } catch (error) {
    finish(null, `Unable to start psql: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (child) {
    if (!child.stdout || !child.stderr || !child.stdin) {
      finish(null, "psql child process did not provide the configured pipes");
    } else {
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      lineBuffer += chunk;
      flushLines();
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.on("error", () => { /* psql may close stdin after an expected SQL error */ });
    child.once("error", error => { spawnError = error.message; finish(null, `Unable to run psql: ${error.message}`); });
    child.once("close", code => finish(code));
    timer = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child?.kill("SIGKILL");
        killTimer = setTimeout(() => finish(null, `psql did not exit after its ${timeoutMs}ms timeout`), 1_000);
        killTimer.unref?.();
      }, 1_000);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();
    child.stdin.end(sql);
    }
  }
  return {
    result,
    done,
    terminate: () => {
      if (closed) return;
      child?.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child?.kill("SIGKILL");
        killTimer = setTimeout(() => finish(null, "psql was terminated after a harness failure"), 1_000);
        killTimer.unref?.();
      }, 1_000);
      killTimer.unref?.();
    },
    isClosed: () => closed,
  };
}

async function sql(sqlText: string): Promise<string> {
  const session = startPsql(sqlText);
  const [result, done] = await Promise.all([session.result, session.done]);
  assert.equal(result.ok, true, result.error ?? "psql produced no result");
  assert.equal(done.ok, true, done.error ?? "psql execution failed");
  return done.stdout;
}

async function waitSession(session: Session): Promise<[SqlOutcome, SqlOutcome]> {
  return Promise.all([session.result, session.done]);
}

async function settleSession(session: Session): Promise<[SqlOutcome, SqlOutcome]> {
  if (!session.isClosed()) session.terminate();
  return waitSession(session);
}

function atomicSql(actor: string, requestId: string, input: Record<string, unknown>, holdSeconds = 0): string {
  return `begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', ${literal(actor)}, true); end $$;
select public.create_sales_invoice_atomic(${literal(requestId)}::uuid, ${literal(JSON.stringify(input))}::jsonb);
${holdSeconds ? `select pg_sleep(${holdSeconds});` : ""}
commit;`;
}

function saleInput(customer: string, product: string, type: "cash" | "credit", amount: number, quantity = 1, unitMode: "main" | "subunit" = "main", price = amount) {
  return {
    customer_id: customer, sale_date: new Date().toISOString().slice(0, 10), payment_type: type,
    invoice_discount: 0, invoice_discount_type: "flat", tax_rate: 0,
    ...(type === "cash" ? { cash_received: Math.round(quantity * price * 100) / 100 } : {}), credit_override_confirmed: false,
    lines: [{ product_id: product, quantity, selling_price: price, discount: 0, bonus: 0, unit_mode: unitMode }],
  };
}

async function racePair(actor: string, input: Record<string, unknown>, expectReplay: boolean, expectReject: RegExp | null, track: (id: string) => void) {
  const aId = randomUUID();
  const bId = expectReplay ? aId : randomUUID();
  track(aId);
  track(bId);
  const a = startPsql(atomicSql(actor, aId, input, 3));
  let b: Session | undefined;
  try {
    const aResult = await a.result;
    assert.equal(aResult.ok, true, aResult.error ?? "first independent session failed");
    assert.ok(aResult.value, "first psql session returned complete JSON");
    b = startPsql(atomicSql(actor, bId, input));
    const finishedBeforeCommit = await Promise.race([b.done.then(() => true), delay(250).then(() => false)]);
    assert.equal(finishedBeforeCommit, false, "the second independent psql connection must wait while session A holds its transaction");
    const [, aDone] = await waitSession(a);
    assert.equal(aDone.ok, true, aDone.error ?? "first session did not commit");
    const [bResult, bDone] = await waitSession(b);
    if (expectReject) {
      assert.equal(bDone.ok, false, "the competing SQL operation must be rejected");
      assert.match(`${bResult.error ?? ""}\n${bDone.error ?? ""}\n${bDone.stderr}`, expectReject, "rejection must match the intended database policy");
      return { requestIds: [aId, bId], saleIds: [String((aResult.value as { transaction: { id: string } }).transaction.id)] };
    }
    assert.equal(bDone.ok, true, bDone.error ?? "second session failed");
    assert.equal(bResult.ok, true, bResult.error ?? "second session returned no JSON");
    assert.ok(bResult.value, "second psql session returned complete JSON");
    const aSale = (aResult.value as { transaction: { id: string } }).transaction.id;
    const bSale = (bResult.value as { replayed: boolean; transaction: { id: string } }).transaction.id;
    if (expectReplay) {
      assert.equal((bResult.value as { replayed: boolean }).replayed, true);
      assert.equal(bSale, aSale);
    }
    return { requestIds: [aId, bId], saleIds: [String(aSale)] };
  } finally {
    await Promise.all([settleSession(a), ...(b ? [settleSession(b)] : [])]);
  }
}

async function rpc(name: string, token: string, args: Record<string, unknown>) {
  const response = await fetchWithTimeout(`${env.POS_RELEASE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: {
      apikey: env.POS_RELEASE_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }, body: JSON.stringify(args),
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function appRequest(path: string, token: string, method: "GET" | "POST" | "DELETE", body?: unknown) {
  const response = await fetchWithTimeout(new URL(path, env.POS_RELEASE_APP_URL), {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", prefer: "return=minimal" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.text() };
}

async function supabaseRequest(path: string, token: string, method: "GET" | "DELETE") {
  const response = await fetchWithTimeout(new URL(path, env.POS_RELEASE_SUPABASE_URL), {
    method,
    headers: { apikey: env.POS_RELEASE_SUPABASE_ANON_KEY!, authorization: `Bearer ${token}`, prefer: "return=minimal" },
  });
  return { status: response.status, body: await response.text() };
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertSameSupabaseProject(actual: string, expected: string, label: string) {
  const actualUrl = new URL(actual);
  const expectedUrl = new URL(expected);
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (loopback.has(actualUrl.hostname) || loopback.has(expectedUrl.hostname)) {
    assert.equal(actualUrl.origin, expectedUrl.origin, `${label} must use the exact isolated Supabase API origin`);
    return;
  }
  const actualRef = /^([a-z0-9-]+)\.supabase\.co$/i.exec(actualUrl.hostname)?.[1];
  const expectedRef = /^([a-z0-9-]+)\.supabase\.co$/i.exec(expectedUrl.hostname)?.[1];
  assert.ok(actualRef && expectedRef && actualRef === expectedRef, `${label} must address the same Supabase project`);
}

async function validateTokenAgainstAuthApi(name: string, identity: UserToken): Promise<void> {
  const response = await fetchWithTimeout(`${env.POS_RELEASE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.POS_RELEASE_SUPABASE_ANON_KEY!, authorization: `Bearer ${identity.token}` },
  });
  const body = await response.text();
  assert.equal(response.status, 200, `${name} session must be accepted by the target Auth API: ${body}`);
  const user = JSON.parse(body) as { id?: string };
  assert.equal(user.id, identity.userId, `${name} Auth API identity must match its signed JWT subject`);
}

async function assertRejectedCreate(token: string, requestId: string, input: Record<string, unknown>, expectedMessage: RegExp) {
  const response = await rpc("create_sales_invoice_atomic", token, { p_request_id: requestId, p_input: input });
  assert.ok([400, 401, 403].includes(response.status), `expected an authorization rejection; got ${response.status} ${response.body}`);
  const error = JSON.parse(response.body) as { code?: string; message?: string; details?: string };
  assert.ok(error.code && error.code !== "PGRST000", `expected a specific database/API rejection code: ${response.body}`);
  assert.match(error.message ?? "", expectedMessage, `unexpected authorization rejection: ${response.body}`);
  return { status: response.status, code: error.code, message: error.message };
}

async function assertNoBusinessRecords(requestIds: string[]): Promise<void> {
  const ids = `array[${requestIds.map(id => `${literal(id)}::uuid`).join(",")}]::uuid[]`;
  const output = await sql(`select json_build_object(
    'sales',(select count(*) from public.sales_transactions where request_id=any(${ids})),
    'items',(select count(*) from public.sales_items si join public.sales_transactions st on st.id=si.sales_transaction_id where st.request_id=any(${ids})),
    'movements',(select count(*) from public.inventory_transactions it join public.sales_transactions st on st.id=it.reference_id where st.request_id=any(${ids})),
    'payments',(select count(*) from public.customer_payments cp join public.customer_payment_allocations a on a.customer_payment_id=cp.id join public.sales_transactions st on st.id=a.sales_transaction_id where st.request_id=any(${ids})),
    'allocations',(select count(*) from public.customer_payment_allocations a join public.sales_transactions st on st.id=a.sales_transaction_id where st.request_id=any(${ids})),
    'audits',(select count(*) from public.audit_logs where entity_id in (select id from public.sales_transactions where request_id=any(${ids})))
  );`);
  assert.deepEqual(JSON.parse(output.trim()), { sales: 0, items: 0, movements: 0, payments: 0, allocations: 0, audits: 0 }, "rejected request IDs leave business records unchanged");
}

async function validateFixtureIdentities(identities: Array<{ name: string; identity: UserToken; profileId: string; organizationId: string; kind: "owner" | "employee" | "inactive" }>) {
  for (const item of identities) await validateTokenAgainstAuthApi(item.name, item.identity);
  const profileIds = identities.map(item => item.profileId);
  const sessionIds = identities.map(item => item.identity.sessionId);
  const userIds = identities.map(item => item.identity.userId);
  const expectedOrg = new Map(identities.map(item => [item.profileId, item.organizationId]));
  const jsonRows = await sql(`select json_build_object(
    'profiles',(select json_agg(json_build_object('id',p.id,'auth_user_id',p.auth_user_id,'organization_id',p.organization_id,'role',p.role,'is_active',p.is_active) order by p.id) from public.profiles p where p.id=any(array[${profileIds.map(id => `${literal(id)}::uuid`).join(",")}]::uuid[])),
    'sessions',(select json_agg(json_build_object('id',s.id,'user_id',s.user_id,'valid',s.not_after is null or s.not_after>now()) order by s.id) from auth.sessions s where s.id=any(array[${sessionIds.map(id => `${literal(id)}::uuid`).join(",")}]::uuid[])),
    'users',(select count(*) from auth.users u where u.id=any(array[${userIds.map(id => `${literal(id)}::uuid`).join(",")}]::uuid[]))
  );`);
  const validation = JSON.parse(jsonRows.trim()) as {
    profiles: Array<{ id: string; auth_user_id: string; organization_id: string; role: string; is_active: boolean }>;
    sessions: Array<{ id: string; user_id: string; valid: boolean }>;
    users: number;
  };
  assert.equal(validation.users, identities.length, "every test JWT subject exists in the isolated auth.users table");
  assert.equal(validation.profiles?.length, identities.length, "each test profile exists exactly once");
  assert.equal(validation.sessions?.length, identities.length, "each test JWT session exists in auth.sessions");
  for (const item of identities) {
    const profile = validation.profiles.find(row => row.id === item.profileId);
    const session = validation.sessions.find(row => row.id === item.identity.sessionId);
    assert.ok(profile, `${item.name} profile exists`);
    assert.equal(profile.id, item.identity.userId, `${item.name} JWT subject is the profile ID used by auth.uid()`);
    if (profile.auth_user_id) assert.equal(profile.auth_user_id, item.identity.userId, `${item.name} profile auth_user_id matches its JWT subject when populated`);
    assert.equal(profile.organization_id, expectedOrg.get(item.profileId), `${item.name} profile belongs to its intended organization`);
    assert.ok(session, `${item.name} session exists in auth.sessions`);
    assert.equal(session.user_id, item.identity.userId, `${item.name} session belongs to its JWT subject`);
    assert.equal(session.valid, true, `${item.name} database session has not expired`);
    if (item.kind === "owner") {
      assert.ok(["owner", "admin"].includes(profile.role.toLowerCase()), `${item.name} fixture has owner/admin permissions`);
      assert.notEqual(profile.is_active, false, `${item.name} profile is active`);
    } else if (item.kind === "employee") {
      assert.notEqual(profile.is_active, false, `${item.name} employee profile is active`);
      assert.ok(!["owner", "admin"].includes(profile.role.toLowerCase()), `${item.name} fixture is restricted from owner/admin permissions`);
    } else {
      assert.equal(profile.is_active, false, `${item.name} fixture is inactive`);
    }
  }
}

async function cleanup(requestIds: string[], returnIds: string[], organizationId: string) {
  const ids = `array[${requestIds.map(id => `${literal(id)}::uuid`).join(",")}]`;
  const returns = `array[${returnIds.map(id => `${literal(id)}::uuid`).join(",")}]::uuid[]`;
  await sql(`do $$ declare v_org uuid := ${literal(organizationId)}::uuid; v_requests uuid[] := ${ids}; v_sales uuid[]; v_payments uuid[]; begin
    select array_agg(id) into v_sales from public.sales_transactions where organization_id=v_org and request_id=any(v_requests);
    select array_agg(cp.id) into v_payments from public.customer_payments cp join public.customer_payment_allocations a on a.customer_payment_id=cp.id where a.sales_transaction_id=any(coalesce(v_sales,'{}'::uuid[]));
    delete from public.sales_return_items where sales_return_id=any(${returns});
    delete from public.sales_returns where organization_id=v_org and id=any(${returns});
    delete from public.customer_payment_allocations where sales_transaction_id=any(coalesce(v_sales,'{}'::uuid[]));
    delete from public.customer_payments where id=any(coalesce(v_payments,'{}'::uuid[]));
    delete from public.sales_transactions where organization_id=v_org and request_id=any(v_requests);
    delete from public.inventory_transactions where reference_id=any(coalesce(v_sales,'{}'::uuid[])) and reference_type='sales_transaction';
    delete from public.inventory_transactions where reference_id=any(${returns}) and reference_type='sales_return';
    delete from public.audit_logs where organization_id=v_org and entity_id=any(coalesce(v_sales,'{}'::uuid[]));
  end $$;`);
}

async function main() {
  verifyExplicitProjectTarget();
  const org = uuid("POS_RELEASE_ORGANIZATION_ID");
  const owner = uuid("POS_RELEASE_OWNER_PROFILE_ID");
  const employee = uuid("POS_RELEASE_EMPLOYEE_PROFILE_ID");
  const inactive = uuid("POS_RELEASE_INACTIVE_PROFILE_ID");
  const otherOrg = uuid("POS_RELEASE_OTHER_ORG_ID");
  const otherOwner = uuid("POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID");
  const cashCustomer = uuid("POS_RELEASE_CASH_CUSTOMER_ID");
  const creditCustomer = uuid("POS_RELEASE_CREDIT_CUSTOMER_ID");
  const stockProduct = uuid("POS_RELEASE_STOCK_PRODUCT_ID");
  const creditProduct = uuid("POS_RELEASE_CREDIT_PRODUCT_ID");
  const authProduct = uuid("POS_RELEASE_AUTH_PRODUCT_ID");
  const ownerToken = assertAuthenticatedUserToken("POS_RELEASE_OWNER_ACCESS_TOKEN");
  const employeeToken = assertAuthenticatedUserToken("POS_RELEASE_EMPLOYEE_ACCESS_TOKEN");
  const inactiveToken = assertAuthenticatedUserToken("POS_RELEASE_INACTIVE_ACCESS_TOKEN");
  const otherOwnerToken = assertAuthenticatedUserToken("POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN");
  assert.equal(new Set([ownerToken.userId, employeeToken.userId, inactiveToken.userId, otherOwnerToken.userId]).size, 4, "permission fixtures must use independent auth users");
  assert.equal(new Set([ownerToken.sessionId, employeeToken.sessionId, inactiveToken.sessionId, otherOwnerToken.sessionId]).size, 4, "permission fixtures must use independent auth sessions");
  const executed: string[] = [];
  const returnIds: string[] = [];
  let stockBaseline: number | undefined;
  try {
    const appEnvironment = await appRequest("/api/pos-release-environment", "", "GET");
    assert.equal(appEnvironment.status, 200, `app server must expose its test-only target preflight: ${appEnvironment.status} ${appEnvironment.body}`);
    const appTarget = JSON.parse(appEnvironment.body) as { supabaseUrls?: string[] };
    assert.ok(Array.isArray(appTarget.supabaseUrls) && appTarget.supabaseUrls.length > 0, "app server must report its configured Supabase API origin");
    for (const appSupabaseUrl of appTarget.supabaseUrls) {
      assertSameSupabaseProject(appSupabaseUrl, env.POS_RELEASE_SUPABASE_URL!, "app server");
    }
    await validateFixtureIdentities([
      { name: "active owner/admin", identity: ownerToken, profileId: owner, organizationId: org, kind: "owner" },
      { name: "restricted employee", identity: employeeToken, profileId: employee, organizationId: org, kind: "employee" },
      { name: "inactive user", identity: inactiveToken, profileId: inactive, organizationId: org, kind: "inactive" },
      { name: "cross-organization owner/admin", identity: otherOwnerToken, profileId: otherOwner, organizationId: otherOrg, kind: "owner" },
    ]);
    const evidence = await sql(`select json_build_object(
      'database', current_database(),
      'marker', (select marker from public.pos_release_test_marker where marker='disposable-pos-atomic-sales'),
      'postgres', current_setting('server_version'),
      'columns', (select json_agg(json_build_array(table_name,column_name,numeric_scale) order by table_name,column_name) from information_schema.columns where table_schema='public' and (table_name,column_name) in (('sales_items','quantity'),('sales_items','bonus'),('sales_return_items','quantity'),('products','current_stock'),('inventory_transactions','quantity_delta'))),
      'sale_trigger', (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.sales_items'::regclass and tgname='inventory_sync_sale_item' and not tgisinternal),
      'return_trigger', (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.sales_return_items'::regclass and tgname='inventory_sync_sale_return_item' and not tgisinternal),
      'sale_trigger_function_hash', md5(pg_get_functiondef('public.inventory_sync_sale_item()'::regprocedure)),
      'return_trigger_function_hash', md5(pg_get_functiondef('public.inventory_sync_sale_return_item()'::regprocedure)),
      'atomic_rpc_hash', md5(pg_get_functiondef('public.create_sales_invoice_atomic(uuid,jsonb)'::regprocedure)),
      'status_rpc_hash', md5(pg_get_functiondef('public.get_sales_invoice_request_status(uuid)'::regprocedure)),
      'unique_request_index', exists(select 1 from pg_index i join pg_class t on t.oid=i.indrelid where t.oid='public.sales_transactions'::regclass and i.indisunique and pg_get_indexdef(i.indexrelid) ilike '%(organization_id, request_id)%'),
      'sales_rls', (select relrowsecurity from pg_class where oid='public.sales_transactions'::regclass),
      'items_rls', (select relrowsecurity from pg_class where oid='public.sales_items'::regclass),
      'returns_rls', (select relrowsecurity from pg_class where oid='public.sales_returns'::regclass),
      'return_items_rls', (select relrowsecurity from pg_class where oid='public.sales_return_items'::regclass),
      'sales_policies', (select json_agg(json_build_array(tablename,policyname,cmd,qual,with_check) order by tablename,policyname) from pg_policies where schemaname='public' and tablename in ('sales_transactions','sales_items','sales_returns','sales_return_items')),
      'sale_constraints', (select json_agg(json_build_array(conname,pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.sales_items'::regclass),
      'return_constraints', (select json_agg(json_build_array(conname,pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.sales_return_items'::regclass),
      'rpc_grant', has_function_privilege('authenticated','public.create_sales_invoice_atomic(uuid,jsonb)','execute'),
      'status_grant', has_function_privilege('authenticated','public.get_sales_invoice_request_status(uuid)','execute'),
      'anon_rpc_grant', has_function_privilege('anon','public.create_sales_invoice_atomic(uuid,jsonb)','execute')
    );`);
    const schema = JSON.parse(evidence.trim()) as Record<string, unknown>;
    assert.equal(schema.marker, "disposable-pos-atomic-sales");
    assert.deepEqual(schema.columns, [
      ["inventory_transactions", "quantity_delta", 6], ["products", "current_stock", 6],
      ["sales_items", "bonus", 3], ["sales_items", "quantity", 3], ["sales_return_items", "quantity", 3],
    ], "isolated database must already have the application precision migrations applied");
    assert.match(String(schema.sale_trigger ?? ""), /inventory_sync_sale_item/);
    assert.match(String(schema.return_trigger ?? ""), /inventory_sync_sale_return_item/);
    assert.ok(schema.sale_trigger_function_hash);
    assert.ok(schema.return_trigger_function_hash);
    assert.ok(schema.atomic_rpc_hash);
    assert.ok(schema.status_rpc_hash);
    assert.equal(schema.unique_request_index, true);
    assert.equal(schema.sales_rls, true);
    assert.equal(schema.items_rls, true);
    assert.equal(schema.returns_rls, true);
    assert.equal(schema.return_items_rls, true);
    assert.ok(Array.isArray(schema.sales_policies) && schema.sales_policies.length > 0);
    assert.ok(Array.isArray(schema.sale_constraints) && schema.sale_constraints.length > 0);
    assert.ok(Array.isArray(schema.return_constraints) && schema.return_constraints.length > 0);
    assert.equal(schema.rpc_grant, true);
    assert.equal(schema.status_grant, true);
    assert.equal(schema.anon_rpc_grant, false);
    console.log(`Schema preflight: PostgreSQL ${schema.postgres}, target ${schema.database}; clone column scales, RLS, constraints, request index, grants, triggers, and function fingerprints recorded.`);

    const duplicate = await racePair(owner, saleInput(cashCustomer, authProduct, "cash", 10), true, null, id => executed.push(id));
    const duplicateSaleId = duplicate.saleIds[0]!;
    const duplicateRows = await sql(`select json_build_object('transactions',(select count(*) from public.sales_transactions where request_id=${literal(duplicate.requestIds[0]!)}::uuid),'items',(select count(*) from public.sales_items where sales_transaction_id=${literal(duplicateSaleId)}::uuid),'movements',(select count(*) from public.inventory_transactions where reference_type='sales_transaction' and reference_id=${literal(duplicateSaleId)}::uuid),'payments',(select count(*) from public.customer_payments cp join public.customer_payment_allocations a on a.customer_payment_id=cp.id where a.sales_transaction_id=${literal(duplicateSaleId)}::uuid),'allocations',(select count(*) from public.customer_payment_allocations where sales_transaction_id=${literal(duplicateSaleId)}::uuid),'audits',(select count(*) from public.audit_logs where entity_id=${literal(duplicateSaleId)}::uuid));`);
    assert.deepEqual(JSON.parse(duplicateRows.trim()), { transactions: 1, items: 1, movements: 1, payments: 1, allocations: 1, audits: 1 });
    console.log("PASS duplicate request ID: separate psql processes, one replayed invoice.");

    const stockPreflight = await sql(`select json_build_object('policy',overselling_policy,'active',is_active,'stock',current_stock) from public.products where id=${literal(stockProduct)}::uuid and organization_id=${literal(org)}::uuid;`);
    const stockConfig = JSON.parse(stockPreflight.trim()) as { policy: string; active: boolean; stock: string };
    assert.equal(stockConfig.policy, "block", "last-stock race fixture must use the configured block-overselling policy");
    assert.equal(stockConfig.active, true, "last-stock race product must be active");
    stockBaseline = Number(stockConfig.stock);
    await sql(`update public.products set current_stock=1 where id=${literal(stockProduct)}::uuid and organization_id=${literal(org)}::uuid;`);
    const stock = await racePair(owner, saleInput(cashCustomer, stockProduct, "cash", 10), false, /stock|oversell|available/i, id => executed.push(id));
    await assertNoBusinessRecords([stock.requestIds[1]!]);
    const stockRows = await sql(`select json_build_object('sales',(select count(*) from public.sales_transactions where request_id=any(array[${stock.requestIds.map(literal).join(",")}]::uuid[])),'items',(select count(*) from public.sales_items where sales_transaction_id=any(array[${stock.saleIds.map(literal).join(",")}]::uuid[])),'movements',(select count(*) from public.inventory_transactions where reference_id=any(array[${stock.saleIds.map(literal).join(",")}]::uuid[]) and movement_type='sale_out'),'stock',(select current_stock from public.products where id=${literal(stockProduct)}::uuid));`);
    const stockState = JSON.parse(stockRows.trim());
    assert.equal(stockState.sales, 1);
    assert.equal(stockState.items, 1);
    assert.equal(stockState.movements, 1);
    assert.equal(Number(stockState.stock), 0);
    console.log("PASS last-stock race: stock policy allowed one sale and rejected the second.");

    const creditLimit = await sql(`select json_build_object('policy',c.credit_policy,'limit',c.credit_limit,'outstanding',coalesce((select sum(st.total_amount-coalesce(a.allocated,0)) from public.sales_transactions st left join lateral (select sum(amount) allocated from public.customer_payment_allocations where sales_transaction_id=st.id) a on true where st.organization_id=c.organization_id and st.customer_id=c.id and st.payment_type='credit' and st.status in ('confirmed','paid','partially_paid')),0),'remaining',c.credit_limit-coalesce((select sum(st.total_amount-coalesce(a.allocated,0)) from public.sales_transactions st left join lateral (select sum(amount) allocated from public.customer_payment_allocations where sales_transaction_id=st.id) a on true where st.organization_id=c.organization_id and st.customer_id=c.id and st.payment_type='credit' and st.status in ('confirmed','paid','partially_paid')),0)) from public.customers c where c.id=${literal(creditCustomer)}::uuid and c.organization_id=${literal(org)}::uuid;`);
    const beforeCreditRace = JSON.parse(creditLimit.trim()) as { policy: string; limit: string; outstanding: string; remaining: string };
    assert.equal(beforeCreditRace.policy, "limit_only", "credit race fixture must use the configured limit_only policy");
    assert.equal(Number(beforeCreditRace.remaining), 10, "credit fixture must have exactly 10.00 of remaining customer credit before competing sales");
    const credit = await racePair(owner, saleInput(creditCustomer, creditProduct, "credit", 10), false, /credit limit/i, id => executed.push(id));
    await assertNoBusinessRecords([credit.requestIds[1]!]);
    const creditRows = await sql(`select json_build_object('sales',(select count(*) from public.sales_transactions where request_id=any(array[${credit.requestIds.map(literal).join(",")}]::uuid[])),'outstanding',(select coalesce(sum(st.total_amount-coalesce(a.allocated,0)),0) from public.sales_transactions st left join lateral (select sum(amount) allocated from public.customer_payment_allocations where sales_transaction_id=st.id) a on true where st.organization_id=${literal(org)}::uuid and st.customer_id=${literal(creditCustomer)}::uuid and st.payment_type='credit' and st.status in ('confirmed','paid','partially_paid')));`);
    const creditState = JSON.parse(creditRows.trim());
    assert.equal(creditState.sales, 1);
    assert.equal(Number(creditState.outstanding), 10);
    console.log("PASS credit-limit race: one invoice at the exact limit; competing invoice rejected.");

    const fractionRequest = randomUUID();
    executed.push(fractionRequest);
    const fractionInput = saleInput(cashCustomer, authProduct, "cash", 15, 0.125, "subunit", 120);
    const fractionSession = startPsql(atomicSql(owner, fractionRequest, fractionInput));
    const [fractionOutcome, fractionDone] = await waitSession(fractionSession);
    assert.equal(fractionDone.ok, true, fractionDone.error ?? "fractional sale SQL failed");
    assert.equal(fractionOutcome.ok, true, fractionOutcome.error ?? "fractional sale returned no result");
    assert.ok(fractionOutcome.value, "fractional sale returned complete JSON");
    const fractionResult = fractionOutcome.value as unknown as { transaction: { id: string } };
    const fractionSaleId = String(fractionResult.transaction.id);
    const fractionBeforeReturn = await sql(`select json_build_object('quantity',(select quantity from public.sales_items where sales_transaction_id=${literal(fractionSaleId)}::uuid),'unit_mode',(select unit_mode from public.sales_items where sales_transaction_id=${literal(fractionSaleId)}::uuid),'movement',(select quantity_delta from public.inventory_transactions where reference_id=${literal(fractionSaleId)}::uuid and movement_type='sale_out'),'stock',(select current_stock from public.products where id=${literal(authProduct)}::uuid));`);
    const soldFraction = JSON.parse(fractionBeforeReturn.trim());
    assert.equal(Number(soldFraction.quantity), 0.125);
    assert.equal(soldFraction.unit_mode, "subunit");
    assert.equal(Number(soldFraction.movement), -0.010417, "1/12 sub-unit stock conversion keeps six-place rounding");

    const createReturn = await appRequest("/api/sales/returns", env.POS_RELEASE_OWNER_ACCESS_TOKEN!, "POST", {
      customerId: cashCustomer, salesTransactionId: fractionSaleId,
      lines: [{ productId: authProduct, quantity: "0.125", unitMode: "subunit" }],
    });
    assert.equal(createReturn.status, 200, `fractional return API failed: ${createReturn.body}`);
    const returned = JSON.parse(createReturn.body) as { returnId: string };
    returnIds.push(returned.returnId);
    const afterReturn = await sql(`select json_build_object('quantity',(select quantity from public.sales_return_items where sales_return_id=${literal(returned.returnId)}::uuid),'movement',(select quantity_delta from public.inventory_transactions where reference_id=${literal(returned.returnId)}::uuid and movement_type='return_in' order by created_at desc limit 1),'stock',(select current_stock from public.products where id=${literal(authProduct)}::uuid));`);
    const returnedState = JSON.parse(afterReturn.trim());
    assert.equal(Number(returnedState.quantity), 0.125);
    assert.equal(Number(returnedState.movement), 0.010417);
    assert.ok(Math.abs(Number(returnedState.stock) - (Number(soldFraction.stock) + 0.010417)) < 1e-9);
    console.log("PASS three-decimal fractional sale and return: item quantity survives; sale and return movements preserve six-place conversion.");

    const returnItemRows = await sql(`select id from public.sales_return_items where sales_return_id=${literal(returned.returnId)}::uuid;`);
    const returnItemId = returnItemRows.trim();
    const stockBeforeReturnCancel = Number(returnedState.stock);
    const deleteItem = await supabaseRequest(`/rest/v1/sales_return_items?id=eq.${returnItemId}`, env.POS_RELEASE_OWNER_ACCESS_TOKEN!, "DELETE");
    assert.ok(deleteItem.status === 204 || deleteItem.status === 200, `fractional return cancellation failed: ${deleteItem.status} ${deleteItem.body}`);
    const deleteReturn = await supabaseRequest(`/rest/v1/sales_returns?id=eq.${returned.returnId}`, env.POS_RELEASE_OWNER_ACCESS_TOKEN!, "DELETE");
    assert.ok(deleteReturn.status === 204 || deleteReturn.status === 200, `return header cleanup failed: ${deleteReturn.status} ${deleteReturn.body}`);
    const afterCancel = await sql(`select json_build_object('stock',(select current_stock from public.products where id=${literal(authProduct)}::uuid),'reversal',(select sum(quantity_delta) from public.inventory_transactions where reference_id=${literal(returned.returnId)}::uuid and movement_type='return_in'),'return_items',(select count(*) from public.sales_return_items where sales_return_id=${literal(returned.returnId)}::uuid),'returns',(select count(*) from public.sales_returns where id=${literal(returned.returnId)}::uuid));`);
    const canceledState = JSON.parse(afterCancel.trim());
    assert.ok(Math.abs(Number(canceledState.stock) - (stockBeforeReturnCancel - 0.010417)) < 1e-9, "deleting a return reverses its stock movement");
    assert.equal(Number(canceledState.reversal), 0, "return-in and cancellation movements net to zero");
    assert.equal(canceledState.return_items, 0);
    assert.equal(canceledState.returns, 0);
    console.log("PASS return cancellation: deletion reverses the restored sub-unit stock exactly.");

    const ownerRequest = randomUUID();
    executed.push(ownerRequest);
    const ownerResponse = await rpc("create_sales_invoice_atomic", env.POS_RELEASE_OWNER_ACCESS_TOKEN!, {
      p_request_id: ownerRequest, p_input: saleInput(cashCustomer, authProduct, "cash", 10),
    });
    assert.equal(ownerResponse.status, 200, `active owner create failed: ${ownerResponse.body}`);
    const ownerStatus = await rpc("get_sales_invoice_request_status", env.POS_RELEASE_OWNER_ACCESS_TOKEN!, { p_request_id: ownerRequest });
    assert.equal(ownerStatus.status, 200);
    assert.match(ownerStatus.body, /confirmed/);
    const employeeRequest = randomUUID();
    await assertRejectedCreate(employeeToken.token, employeeRequest, saleInput(cashCustomer, authProduct, "cash", 10), /owner|admin|permission|authoriz|role/i);
    const inactiveRequest = randomUUID();
    await assertRejectedCreate(inactiveToken.token, inactiveRequest, saleInput(cashCustomer, authProduct, "cash", 10), /active|inactive|profile/i);
    const crossRequest = randomUUID();
    await assertRejectedCreate(otherOwnerToken.token, crossRequest, saleInput(cashCustomer, authProduct, "cash", 10), /organization|customer/i);
    executed.push(employeeRequest, inactiveRequest, crossRequest);
    await assertNoBusinessRecords([employeeRequest, inactiveRequest, crossRequest]);
    const crossStatus = await rpc("get_sales_invoice_request_status", otherOwnerToken.token, { p_request_id: ownerRequest });
    assert.equal(crossStatus.status, 200, `cross-organization status lookup should return a non-disclosing result: ${crossStatus.body}`);
    assert.equal((JSON.parse(crossStatus.body) as { status?: string }).status, "unknown", "cross-organization status lookup does not disclose another organization's sale");
    assert.notEqual(otherOrg, org);
    assert.notEqual(otherOwner, owner);
    assert.notEqual(employee, owner);
    assert.notEqual(inactive, owner);
    console.log("PASS real Supabase JWT authorization: active owner, restricted employee, inactive profile, and cross-organization owner.");
    console.log("NOT RUN: browser history/export display and native print-dialog cases need a real browser session; repository HTML and data checks are separate.");
  } finally {
    try {
      if (executed.length || returnIds.length) await cleanup([...new Set(executed)], returnIds, org);
    } finally {
      if (stockBaseline !== undefined) {
        await sql(`update public.products set current_stock=${stockBaseline} where id=${literal(stockProduct)}::uuid and organization_id=${literal(org)}::uuid;`);
      }
    }
  }
}

if (missing.length) {
  console.error(`NOT RUN: configure the isolated POS release target first. Missing: ${missing.join(", ")}`);
  process.exitCode = 2;
} else {
  main().catch(error => {
    console.error("FAILED: isolated POS release harness", error);
    process.exitCode = 1;
  });
}
