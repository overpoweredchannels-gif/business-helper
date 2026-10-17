#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This runner is intentionally CommonJS for direct Node execution. */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const TARGET_REF = "rtfowunsyrdygyvubnvs";
const TARGET_MARKER = "disposable-pos-atomic-sales";
const PSQL = process.env.POS_RELEASE_PSQL_PATH || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const REQUIRED = [
  "POS_RELEASE_TEST_TARGET",
  "POS_RELEASE_TEST_DATABASE_URL",
  "POS_RELEASE_SUPABASE_URL",
  "POS_RELEASE_SUPABASE_ANON_KEY",
  "POS_RELEASE_ORGANIZATION_ID",
  "POS_RELEASE_OWNER_PROFILE_ID",
  "POS_RELEASE_OWNER_ACCESS_TOKEN",
  "POS_RELEASE_OTHER_ORG_ID",
  "POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID",
  "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN",
  "POS_RELEASE_AUTH_PRODUCT_ID",
  "PGPASSFILE",
];

function fail(message) {
  throw new Error(message);
}

function requireValue(name) {
  const value = process.env[name];
  if (!value) fail(`Missing required test setting ${name}`);
  return value;
}

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail(`${label} is not a UUID`);
  }
  return value;
}

function safeSqlText(value) {
  if (!/^[A-Z0-9-]{1,80}$/.test(value)) fail("Synthetic marker is not SQL-safe");
  return `'${value}'`;
}

function databaseConfig() {
  const url = new URL(requireValue("POS_RELEASE_TEST_DATABASE_URL"));
  const api = new URL(requireValue("POS_RELEASE_SUPABASE_URL"));
  const projectRef = api.hostname.split(".")[0];
  const dbUser = decodeURIComponent(url.username);
  if (process.env.POS_RELEASE_TEST_TARGET !== TARGET_MARKER) fail("Test target marker does not match");
  if (projectRef !== TARGET_REF || !dbUser.endsWith(`.${TARGET_REF}`)) {
    fail("API or database connection does not identify the disposable target");
  }
  if (!url.hostname.endsWith("pooler.supabase.com") || !url.pathname.endsWith("/postgres")) {
    fail("Database connection is not the configured disposable Supabase pooler");
  }
  if (!requireValue("PGPASSFILE") || !require("node:fs").existsSync(process.env.PGPASSFILE)) {
    fail("Private PostgreSQL password file is unavailable");
  }
  if (!require("node:fs").existsSync(PSQL)) fail("Configured psql client is unavailable");
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: dbUser,
    database: url.pathname.slice(1),
    apiUrl: api.origin,
  };
}

function psql(sql, { write = false } = {}) {
  const config = databaseConfig();
  const args = [
    "-X", "-w", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t", "-F", "\t",
    "-h", config.host, "-p", config.port, "-U", config.user, "-d", config.database,
    "-c", write ? sql : `begin; set transaction read only; ${sql}; commit;`,
  ];
  const result = spawnSync(PSQL, args, {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: {
      ...process.env,
      PGPASSFILE: process.env.PGPASSFILE,
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "8",
      PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=5000",
      PGAPPNAME: "tradeos-purchase-return-tenant-regression",
    },
  });
  if (result.error) fail(`psql could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || "").replace(/\s+/g, " ").slice(0, 500);
    fail(`Disposable database query failed${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout || "").trim();
}

function psqlExpectRejection(sql, sqlState, messagePattern) {
  const config = databaseConfig();
  const result = spawnSync(PSQL, [
    "-X", "-w", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-q", "-A", "-t",
    "-h", config.host, "-p", config.port, "-U", config.user, "-d", config.database,
    "-c", sql,
  ], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: {
      ...process.env,
      PGPASSFILE: process.env.PGPASSFILE,
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "8",
      PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=5000",
      PGAPPNAME: "tradeos-purchase-return-tenant-regression",
    },
  });
  if (result.error) fail(`psql rejection check could not run: ${result.error.message}`);
  const error = result.stderr || "";
  if (result.status === 0 || !error.includes(sqlState) || !messagePattern.test(error)) {
    fail(`Expected direct database rejection with SQLSTATE ${sqlState}`);
  }
}

function startParentDelete(returnId) {
  const config = databaseConfig();
  const id = assertUuid(returnId, "Concurrent return ID");
  const child = spawn(PSQL, [
    "-X", "-w", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t",
    "-h", config.host, "-p", config.port, "-U", config.user, "-d", config.database,
    "-c", `begin; set local statement_timeout='12s'; delete from public.purchase_returns where id='${id}'::uuid; select '__PARENT_DELETE_LOCKED__'; select pg_catalog.pg_sleep(1.5); commit;`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      PGPASSFILE: process.env.PGPASSFILE,
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "8",
      PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=5000",
      PGAPPNAME: "tradeos-purchase-return-delete-race",
    },
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  let resolveReady;
  let rejectReady;
  let resolveDone;
  let rejectDone;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  done.catch(() => {});
  const timer = setTimeout(() => {
    child.kill();
    const error = new Error("Concurrent parent-delete session timed out");
    if (!settled) rejectReady(error);
    rejectDone(error);
  }, 18000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    if (stdout.includes("__PARENT_DELETE_LOCKED__")) resolveReady();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.on("error", (error) => {
    clearTimeout(timer);
    settled = true;
    rejectReady(new Error(`Concurrent psql could not start: ${error.message}`));
    rejectDone(error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    settled = true;
    if (code !== 0) {
      const message = (stderr || "").replace(/\s+/g, " ").slice(0, 400);
      const error = new Error(`Concurrent parent-delete session failed${message ? `: ${message}` : ""}`);
      rejectReady(error);
      rejectDone(error);
      return;
    }
    resolveReady();
    resolveDone(stdout.trim());
  });
  return { ready, done };
}

function jwtSubject(token) {
  const parts = token.split(".");
  if (parts.length !== 3) fail("Synthetic user session is not a JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).sub;
}

function profile(role) {
  const isOther = role === "other";
  const token = requireValue(isOther ? "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN" : "POS_RELEASE_OWNER_ACCESS_TOKEN");
  const profileId = assertUuid(requireValue(isOther ? "POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID" : "POS_RELEASE_OWNER_PROFILE_ID"), `${role} profile ID`);
  if (jwtSubject(token) !== profileId) fail(`${role} JWT subject does not match its synthetic profile`);
  return { token, profileId };
}

async function authPreflight(role, user) {
  const response = await fetch(`${databaseConfig().apiUrl}/auth/v1/user`, {
    headers: {
      apikey: requireValue("POS_RELEASE_SUPABASE_ANON_KEY"),
      authorization: `Bearer ${user.token}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.id !== user.profileId) fail(`${role} ordinary Auth session is invalid (HTTP ${response.status})`);
}

async function rest(role, method, table, query = "", body = undefined) {
  const user = role === "other" ? profile("other") : profile("owner");
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`${databaseConfig().apiUrl}/rest/v1/${table}${suffix}`, {
    method,
    headers: {
      apikey: requireValue("POS_RELEASE_SUPABASE_ANON_KEY"),
      authorization: `Bearer ${user.token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    signal: AbortSignal.timeout(15000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return {
    status: response.status,
    ok: response.ok,
    rows: Array.isArray(json) ? json : json ? [json] : [],
    errorCode: json && typeof json.code === "string" ? json.code : null,
    errorMessage: json && typeof json.message === "string" ? json.message : "",
  };
}

function report(label, passed, evidence = "") {
  if (!passed) fail(`${label} failed`);
  process.stdout.write(`PASS ${label}${evidence ? ` (${evidence})` : ""}\n`);
}

function expectTriggerRejection(response, messagePattern, label) {
  if (response.ok || response.errorCode !== "23514" || !messagePattern.test(response.errorMessage)) {
    fail(`${label}: expected the tenant/stock trigger check (HTTP ${response.status}, SQLSTATE ${response.errorCode || "none"})`);
  }
  report(label, true, `HTTP ${response.status}, SQLSTATE ${response.errorCode}`);
}

function numericMicros(value) {
  const text = String(value);
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^-/, "").split(".");
  const micros = BigInt(whole || "0") * 1000000n + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -micros : micros;
}

function formatMicros(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 1000000n}.${String(absolute % 1000000n).padStart(6, "0")}`;
}

function stock(productId) {
  const id = assertUuid(productId, "Product ID");
  const value = psql(`select current_stock::numeric(18,6)::text from public.products where id='${id}'::uuid`);
  if (!value) fail("Synthetic test product is unavailable");
  return value;
}

function returnState(returnId, productIds) {
  const id = assertUuid(returnId, "Return ID");
  const ids = productIds.map((value) => `'${assertUuid(value, "Product ID")}'::uuid`).join(",");
  const query = `select coalesce((select count(*) from public.purchase_return_items where purchase_return_id='${id}'::uuid),0)::text || E'\\t' || coalesce((select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id='${id}'::uuid),0)::text || E'\\t' || coalesce((select sum(quantity_delta)::numeric(18,6)::text from public.inventory_transactions where reference_type='purchase_return' and reference_id='${id}'::uuid), '0.000000') || E'\\t' || coalesce((select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id='${id}'::uuid and product_id in (${ids})),0)::text`;
  const [items, ledger, sum, ledgerProductCount] = psql(query).split("\t");
  return { items: Number(items), ledger: Number(ledger), ledgerSum: numericMicros(sum), ledgerProductCount: Number(ledgerProductCount) };
}

function itemRecord(itemId) {
  const id = assertUuid(itemId, "Item ID");
  const query = `select id::text || E'\\t' || purchase_return_id::text || E'\\t' || product_id::text || E'\\t' || organization_id::text || E'\\t' || quantity::text || E'\\t' || unit_mode from public.purchase_return_items where id='${id}'::uuid`;
  const result = psql(query);
  if (!result) return null;
  const [rowId, parent, product, organization, quantity, unitMode] = result.split("\t");
  return { id: rowId, parent, product, organization, quantity, unitMode };
}

async function createReturn(role, organizationId, returnNumber, profileId) {
  const result = await rest(role, "POST", "purchase_returns", "select=id,return_number,organization_id", {
    organization_id: organizationId,
    return_number: returnNumber,
    created_by_profile_id: profileId,
  });
  if (!result.ok || result.rows.length !== 1 || !result.rows[0].id) {
    fail(`Synthetic return setup failed for ${role} (HTTP ${result.status}, code ${result.errorCode || "none"})`);
  }
  return assertUuid(result.rows[0].id, "Created return ID");
}

function parentRecord(returnId) {
  const id = assertUuid(returnId, "Return ID");
  const result = psql(`select id::text || E'\\t' || organization_id::text from public.purchase_returns where id='${id}'::uuid`);
  if (!result) return null;
  const [recordId, organizationId] = result.split("\t");
  return { id: recordId, organizationId };
}

async function insertItem(role, values) {
  return rest(role, "POST", "purchase_return_items", "select=id,purchase_return_id,product_id,organization_id,quantity,unit_mode", values);
}

function markersSql(values) {
  return values.map(safeSqlText).join(",");
}

function cleanup(runId, orgA, orgB, foreignSku, returnNumbers, returnIds, foreignProductId) {
  const numbers = markersSql(returnNumbers);
  const ids = returnIds.map((id) => `'${assertUuid(id, "Cleanup return ID")}'::uuid`).join(",") || "null::uuid";
  const productId = foreignProductId ? `'${assertUuid(foreignProductId, "Cleanup product ID")}'::uuid` : "null::uuid";
  const sku = safeSqlText(foreignSku);
  const sql = `begin; set local statement_timeout='10s'; delete from public.purchase_returns where organization_id in ('${orgA}'::uuid,'${orgB}'::uuid) and return_number in (${numbers}); delete from public.purchase_returns where id in (${ids}); delete from public.inventory_transactions where reference_type='purchase_return' and reference_id in (${ids}); delete from public.products where organization_id='${orgB}'::uuid and (id=${productId} or sku=${sku}); commit;`;
  psql(sql, { write: true });
  const remaining = psql(`select (select count(*) from public.purchase_returns where return_number in (${numbers}))::text || E'\\t' || (select count(*) from public.purchase_return_items where purchase_return_id in (${ids}))::text || E'\\t' || (select count(*) from public.inventory_transactions where reference_type='purchase_return' and reference_id in (${ids}))::text || E'\\t' || (select count(*) from public.products where organization_id='${orgB}'::uuid and sku=${sku})::text`);
  return remaining === "0\t0\t0\t0";
}

async function main() {
  for (const name of REQUIRED) requireValue(name);
  databaseConfig();
  const orgA = assertUuid(requireValue("POS_RELEASE_ORGANIZATION_ID"), "Owner organization ID");
  const orgB = assertUuid(requireValue("POS_RELEASE_OTHER_ORG_ID"), "Other organization ID");
  const productA = assertUuid(requireValue("POS_RELEASE_AUTH_PRODUCT_ID"), "Owner product ID");
  if (orgA === orgB) fail("Synthetic organizations must be distinct");
  const owner = profile("owner");
  const other = profile("other");
  const runId = randomBytes(5).toString("hex").toUpperCase();
  const marker = `PRSEC-${runId}`;
  const foreignSku = `PRSEC-${runId}-FOREIGN`;
  const returns = [];
  const returnNumbers = ["A", "B", "OVER", "CASCADE", "RACE-INSERT", "RACE-UPDATE"].map((suffix) => `${marker}-${suffix}`);
  let foreignProductId = null;
  let stockAStart = null;
  let stockBStart = null;
  let primaryReturnId = null;
  let itemId = null;
  let failure = null;
  let cleanupPassed = false;

  try {
    await authPreflight("owner", owner);
    await authPreflight("other organization owner", other);
    report("ordinary synthetic owner sessions validate against the test Auth API", true);

    const targetProof = psql("select current_database()||'|'||current_setting('server_version_num')||'|'||current_setting('transaction_read_only')||'|'||(select marker from public.pos_release_test_marker)");
    const [databaseName, serverVersionNum, readOnly, marker] = targetProof.split("|");
    if (databaseName !== "postgres" || Math.floor(Number(serverVersionNum) / 10000) !== 17 || readOnly !== "on" || marker !== TARGET_MARKER) {
      fail("Direct database session did not prove the isolated PostgreSQL 17 target");
    }
    report("direct PostgreSQL session proves the disposable marker and read-only preflight", true);

    const typeEvidence = psql("select (select atttypid='uuid'::regtype from pg_attribute where attrelid='public.products'::regclass and attname='id')::text || E'\\t' || (select atttypid='uuid'::regtype from pg_attribute where attrelid='public.purchase_return_items'::regclass and attname='product_id')::text || E'\\t' || (select atttypid='uuid'::regtype from pg_attribute where attrelid='public.purchase_return_items'::regclass and attname='purchase_return_id')::text");
    report("deployed test schema uses UUID product and return identifiers", typeEvidence === "true\ttrue\ttrue");

    const stockWriterCount = psql("select count(*)::text from pg_trigger t where t.tgrelid='public.purchase_return_items'::regclass and t.tgname='inventory_sync_purchase_return_item' and t.tgfoid='public.inventory_sync_purchase_return_item()'::regprocedure and not t.tgisinternal and t.tgenabled<>'D' and (t.tgtype & 29)=29");
    report("the existing single AFTER stock writer remains enabled", stockWriterCount === "1");

    const securedFunctions = psql(`select bool_and(p.prosecdef and coalesce(p.proconfig @> array['search_path=""'],false) and not exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))::text from pg_proc p where p.oid in ('public.guard_purchase_return_item_tenant()'::regprocedure,'public.inventory_sync_purchase_return_item()'::regprocedure,'public.guard_purchase_return_organization()'::regprocedure)`);
    report("trigger functions are pinned SECURITY DEFINER functions without client EXECUTE grants", securedFunctions === "true");

    const parentGuardCount = psql("select count(*)::text from pg_trigger t where t.tgrelid='public.purchase_returns'::regclass and t.tgname='purchase_return_organization_guard' and t.tgfoid='public.guard_purchase_return_organization()'::regprocedure and not t.tgisinternal and t.tgenabled<>'D' and (t.tgtype & 16)=16");
    report("parent organization reassignment guard is enabled for UPDATE", parentGuardCount === "1");

    const productOrg = psql(`select organization_id::text from public.products where id='${productA}'::uuid`);
    if (productOrg !== orgA) fail("Owner synthetic product does not belong to the owner organization");
    const unitsPerPack = psql(`select units_per_pack::text from public.products where id='${productA}'::uuid`);
    if (unitsPerPack !== "12") fail("Owner synthetic fractional-conversion product must use 12 subunits per pack");
    stockAStart = stock(productA);

    const productCreate = await rest("other", "POST", "products", "select=id,organization_id,current_stock", {
      organization_id: orgB,
      name: `${marker} foreign tenant product`,
      sku: foreignSku,
      units_per_pack: 12,
      current_stock: "10.000000",
      is_active: true,
    });
    if (!productCreate.ok || productCreate.rows.length !== 1) {
      fail(`Other-organization synthetic product setup failed (HTTP ${productCreate.status}, code ${productCreate.errorCode || "none"})`);
    }
    foreignProductId = assertUuid(productCreate.rows[0].id, "Foreign synthetic product ID");
    if (productCreate.rows[0].organization_id !== orgB) fail("Foreign synthetic product was created in the wrong organization");
    stockBStart = stock(foreignProductId);
    report("foreign stock fixture belongs to the second synthetic organization", true);

    primaryReturnId = await createReturn("owner", orgA, returnNumbers[0], owner.profileId);
    returns.push(primaryReturnId);
    const otherReturnId = await createReturn("other", orgB, returnNumbers[1], other.profileId);
    returns.push(otherReturnId);

    const rejectedInserts = [
      {
        label: "cross-organization product insert rejected",
        body: { purchase_return_id: primaryReturnId, organization_id: orgA, product_id: foreignProductId, quantity: "0.25", unit_mode: "main" },
        returnId: primaryReturnId,
      },
      {
        label: "cross-organization item organization insert rejected",
        body: { purchase_return_id: primaryReturnId, organization_id: orgB, product_id: productA, quantity: "0.25", unit_mode: "main" },
        returnId: primaryReturnId,
      },
      {
        label: "cross-organization parent insert rejected",
        body: { purchase_return_id: otherReturnId, organization_id: orgA, product_id: productA, quantity: "0.25", unit_mode: "main" },
        returnId: otherReturnId,
      },
    ];

    for (const test of rejectedInserts) {
      const response = await insertItem("owner", test.body);
      const state = returnState(test.returnId, [productA, foreignProductId]);
      expectTriggerRejection(response, /Purchase return line is not permitted for this organization/i, test.label);
      if (state.items !== 0 || state.ledger !== 0 || stock(productA) !== stockAStart || stock(foreignProductId) !== stockBStart) {
        fail(`${test.label}: rejected write changed item, stock, or ledger state`);
      }
    }

    const validInsert = await insertItem("owner", {
      purchase_return_id: primaryReturnId,
      organization_id: orgA,
      product_id: productA,
      quantity: "1.50",
      unit_mode: "subunit",
    });
    if (!validInsert.ok || validInsert.rows.length !== 1) fail(`Same-organization fractional return insert failed (HTTP ${validInsert.status}, code ${validInsert.errorCode || "none"})`);
    itemId = assertUuid(validInsert.rows[0].id, "Created return-item ID");
    if (stock(productA) !== formatMicros(numericMicros(stockAStart) - 125000n)) fail("Fractional subunit return did not reduce stock by 0.125");
    let state = returnState(primaryReturnId, [productA, foreignProductId]);
    if (state.items !== 1 || state.ledger !== 1 || state.ledgerSum !== -125000n || state.ledgerProductCount !== 1) fail("Fractional return did not create exactly one scoped stock ledger effect");
    report("same-organization subunit return preserves fractional stock and one ledger effect", true, `HTTP ${validInsert.status}`);

    const parentBeforeReassignment = parentRecord(primaryReturnId);
    const itemBeforeReassignment = itemRecord(itemId);
    const stockBeforeReassignment = stock(productA);
    const ledgerBeforeReassignment = returnState(primaryReturnId, [productA, foreignProductId]);
    const ordinaryParentReassignment = await rest("owner", "PATCH", "purchase_returns", `id=eq.${primaryReturnId}&select=id,organization_id`, { organization_id: orgB });
    if (ordinaryParentReassignment.ok || ordinaryParentReassignment.errorCode !== "23514" || !/organization cannot be reassigned/i.test(ordinaryParentReassignment.errorMessage)) {
      fail(`Ordinary owner parent reassignment was not rejected by the database guard (HTTP ${ordinaryParentReassignment.status}, SQLSTATE ${ordinaryParentReassignment.errorCode || "none"})`);
    }
    const privilegedParentSql = `update public.purchase_returns set organization_id='${orgB}'::uuid where id='${primaryReturnId}'::uuid`;
    psqlExpectRejection(privilegedParentSql, "23514", /Purchase return organization cannot be reassigned/i);
    const parentAfterReassignment = parentRecord(primaryReturnId);
    const itemAfterReassignment = itemRecord(itemId);
    const ledgerAfterReassignment = returnState(primaryReturnId, [productA, foreignProductId]);
    if (JSON.stringify(parentAfterReassignment) !== JSON.stringify(parentBeforeReassignment)
        || JSON.stringify(itemAfterReassignment) !== JSON.stringify(itemBeforeReassignment)
        || stock(productA) !== stockBeforeReassignment
        || ledgerAfterReassignment.items !== ledgerBeforeReassignment.items
        || ledgerAfterReassignment.ledger !== ledgerBeforeReassignment.ledger
        || ledgerAfterReassignment.ledgerSum !== ledgerBeforeReassignment.ledgerSum) {
      fail("Rejected parent organization reassignment changed the parent, line, stock, or ledger");
    }
    report("ordinary and privileged parent organization reassignment are rejected without effects", true, "HTTP/PostgreSQL SQLSTATE 23514");

    const rejectedUpdates = [
      { label: "cross-organization product reassignment rejected", body: { product_id: foreignProductId } },
      { label: "cross-organization parent reassignment rejected", body: { purchase_return_id: otherReturnId } },
      { label: "cross-organization item organization reassignment rejected", body: { organization_id: orgB } },
    ];
    for (const test of rejectedUpdates) {
      const beforeRecord = itemRecord(itemId);
      const beforeA = stock(productA);
      const beforeB = stock(foreignProductId);
      const beforeState = returnState(primaryReturnId, [productA, foreignProductId]);
      const response = await rest("owner", "PATCH", "purchase_return_items", `id=eq.${itemId}&select=id,purchase_return_id,product_id,organization_id,quantity,unit_mode`, test.body);
      const afterRecord = itemRecord(itemId);
      const afterState = returnState(primaryReturnId, [productA, foreignProductId]);
      expectTriggerRejection(response, /Purchase return line ownership cannot be reassigned/i, test.label);
      if (JSON.stringify(afterRecord) !== JSON.stringify(beforeRecord)
          || stock(productA) !== beforeA || stock(foreignProductId) !== beforeB
          || afterState.items !== beforeState.items || afterState.ledger !== beforeState.ledger
          || afterState.ledgerSum !== beforeState.ledgerSum) fail(`${test.label}: rejected write changed the item, stock, or ledger`);
    }

    const validUpdate = await rest("owner", "PATCH", "purchase_return_items", `id=eq.${itemId}&select=id`, { quantity: "2.00" });
    if (!validUpdate.ok || validUpdate.rows.length !== 1) fail(`Same-organization quantity update failed (HTTP ${validUpdate.status}, code ${validUpdate.errorCode || "none"})`);
    const expectedAfterUpdate = numericMicros(stockAStart) - 166667n;
    if (numericMicros(stock(productA)) !== expectedAfterUpdate) fail("Valid quantity update did not apply the converted fractional stock delta");
    state = returnState(primaryReturnId, [productA, foreignProductId]);
    if (state.ledger !== 2 || state.ledgerSum !== -166667n || state.ledgerProductCount !== 2) fail("Valid quantity update did not record one net ledger adjustment");
    report("same-organization quantity update applies one net subunit adjustment", true, `HTTP ${validUpdate.status}`);

    const deleteItem = await rest("owner", "DELETE", "purchase_return_items", `id=eq.${itemId}&select=id`);
    if (!deleteItem.ok || deleteItem.rows.length !== 1) fail(`Same-organization item deletion failed (HTTP ${deleteItem.status})`);
    if (stock(productA) !== stockAStart) fail("Deleting the fractional return item did not restore original stock");
    state = returnState(primaryReturnId, [productA, foreignProductId]);
    if (state.items !== 0 || state.ledger !== 3 || state.ledgerSum !== 0n) fail("Item deletion did not reverse its stock and ledger effects exactly");
    report("same-organization item deletion reverses fractional stock and ledger effects", true, `HTTP ${deleteItem.status}`);

    const overReturnId = await createReturn("owner", orgA, returnNumbers[2], owner.profileId);
    returns.push(overReturnId);
    const beforeOverStock = stock(productA);
    const overInsert = await insertItem("owner", { purchase_return_id: overReturnId, organization_id: orgA, product_id: productA, quantity: "999999999", unit_mode: "main" });
    state = returnState(overReturnId, [productA, foreignProductId]);
    expectTriggerRejection(overInsert, /Purchase return cannot reduce stock below zero/i, "insufficient-stock return is rejected");
    if (stock(productA) !== beforeOverStock || state.items !== 0 || state.ledger !== 0 || stock(foreignProductId) !== stockBStart) {
      fail("Insufficient-stock return did not roll back item, stock, and ledger atomically");
    }
    report("insufficient-stock return rejection rolls back item, stock, and ledger", true);

    const cascadeReturnId = await createReturn("owner", orgA, returnNumbers[3], owner.profileId);
    returns.push(cascadeReturnId);
    const cascadeInsert = await insertItem("owner", { purchase_return_id: cascadeReturnId, organization_id: orgA, product_id: productA, quantity: "0.25", unit_mode: "main" });
    if (!cascadeInsert.ok || cascadeInsert.rows.length !== 1) fail(`Cascade fixture line insert failed (HTTP ${cascadeInsert.status})`);
    if (numericMicros(stock(productA)) !== numericMicros(stockAStart) - 250000n) fail("Cascade fixture did not reduce stock by 0.25");
    const cascadeDelete = await rest("owner", "DELETE", "purchase_returns", `id=eq.${cascadeReturnId}&select=id`);
    if (!cascadeDelete.ok || cascadeDelete.rows.length !== 1) fail(`Parent return deletion failed (HTTP ${cascadeDelete.status})`);
    if (stock(productA) !== stockAStart) fail("Parent cascade did not restore original stock");
    state = returnState(cascadeReturnId, [productA, foreignProductId]);
    if (state.items !== 0 || state.ledger !== 2 || state.ledgerSum !== 0n) fail("Parent cascade did not reverse the ledger exactly once per stock effect");
    report("parent deletion cascade reverses stock and ledger atomically", true);

    const raceInsertId = await createReturn("owner", orgA, returnNumbers[4], owner.profileId);
    returns.push(raceInsertId);
    const insertRaceDelete = startParentDelete(raceInsertId);
    await insertRaceDelete.ready;
    const blockedInsertPromise = insertItem("owner", {
      purchase_return_id: raceInsertId,
      organization_id: orgA,
      product_id: productA,
      quantity: "0.25",
      unit_mode: "main",
    });
    await insertRaceDelete.done;
    const blockedInsert = await blockedInsertPromise;
    if (blockedInsert.ok || blockedInsert.errorCode !== "23503") fail(`Concurrent insert was not rejected after parent deletion (HTTP ${blockedInsert.status}, SQLSTATE ${blockedInsert.errorCode || "none"})`);
    state = returnState(raceInsertId, [productA, foreignProductId]);
    if (parentRecord(raceInsertId) !== null || state.items !== 0 || state.ledger !== 0 || stock(productA) !== stockAStart) {
      fail("Parent-delete/item-insert race left a parent, item, stock, or ledger effect");
    }
    report("concurrent parent deletion serializes before an ordinary-user item insert", true, "independent PostgreSQL and PostgREST sessions");

    const raceUpdateId = await createReturn("owner", orgA, returnNumbers[5], owner.profileId);
    returns.push(raceUpdateId);
    const raceUpdateItem = await insertItem("owner", {
      purchase_return_id: raceUpdateId,
      organization_id: orgA,
      product_id: productA,
      quantity: "0.25",
      unit_mode: "main",
    });
    if (!raceUpdateItem.ok || raceUpdateItem.rows.length !== 1) fail(`Concurrent update fixture insert failed (HTTP ${raceUpdateItem.status})`);
    const raceUpdateItemId = assertUuid(raceUpdateItem.rows[0].id, "Concurrent update item ID");
    if (numericMicros(stock(productA)) !== numericMicros(stockAStart) - 250000n) fail("Concurrent update fixture did not reduce stock by 0.25");
    const updateRaceDelete = startParentDelete(raceUpdateId);
    await updateRaceDelete.ready;
    const blockedUpdatePromise = rest("owner", "PATCH", "purchase_return_items", `id=eq.${raceUpdateItemId}&select=id`, { quantity: "0.50" });
    await updateRaceDelete.done;
    const blockedUpdate = await blockedUpdatePromise;
    if (!blockedUpdate.ok || blockedUpdate.rows.length !== 0) fail(`Concurrent item update was not serialized after parent cascade (HTTP ${blockedUpdate.status}, rows ${blockedUpdate.rows.length})`);
    state = returnState(raceUpdateId, [productA, foreignProductId]);
    if (parentRecord(raceUpdateId) !== null || state.items !== 0 || state.ledger !== 2 || state.ledgerSum !== 0n || stock(productA) !== stockAStart) {
      fail("Parent-delete/item-update race did not leave a fully reversed stock and ledger state");
    }
    report("concurrent parent deletion serializes before an ordinary-user item update", true, "independent PostgreSQL and PostgREST sessions");
    report("foreign product stock remains unchanged throughout the run", stock(foreignProductId) === stockBStart);
  } catch (error) {
    failure = error;
  } finally {
    try {
      cleanup(runId, orgA, orgB, foreignSku, returnNumbers, returns, foreignProductId);
      if (stockAStart && stock(productA) !== stockAStart) fail("Scoped cleanup did not restore the owner product stock");
      cleanupPassed = true;
      process.stdout.write("PASS exact marker-scoped cleanup leaves no returns, items, ledger rows, or foreign product\n");
    } catch (error) {
      process.stderr.write(`FAIL cleanup: ${error.message}\n`);
      failure ||= error;
    }
  }

  if (!cleanupPassed) failure ||= new Error("Exact scoped cleanup was not verified");
  if (failure) throw failure;
  process.stdout.write(`PASS purchase-return tenant isolation (${TARGET_REF}; ${runId})\n`);
}

main().catch((error) => {
  process.stderr.write(`FAIL purchase-return tenant isolation: ${error.message}\n`);
  process.exitCode = 1;
});
