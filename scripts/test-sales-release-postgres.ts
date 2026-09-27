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

type Session = { result: Promise<Record<string, unknown>>; done: Promise<string>; };
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
function assertAuthenticatedUserToken(name: string) {
  const token = env[name]!;
  const payload = token.split(".")[1];
  assert.ok(payload, `${name} must be a JWT access token`);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: string };
  assert.equal(claims.role, "authenticated", `${name} must be a user JWT, not a service-role or anon key`);
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function startPsql(sql: string): Session {
  const child = spawn("psql", ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", env.POS_RELEASE_TEST_DATABASE_URL!], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let firstResult: ((value: Record<string, unknown>) => void) | undefined;
  let resultError: ((error: Error) => void) | undefined;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => { firstResult = resolve; resultError = reject; });
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      try { firstResult?.(JSON.parse(line) as Record<string, unknown>); firstResult = undefined; }
      catch (error) { resultError?.(error instanceof Error ? error : new Error(String(error))); }
      break;
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const done = new Promise<string>((resolve, reject) => {
    child.once("error", error => { resultError?.(error); reject(error); });
    child.once("close", code => {
      if (code === 0) resolve(stdout);
      else {
        const error = new Error(`psql exited ${code}: ${stderr.trim()}`);
        resultError?.(error);
        reject(error);
      }
    });
  });
  child.stdin.end(sql);
  return { result, done };
}

async function sql(sqlText: string): Promise<string> {
  return startPsql(sqlText).done;
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
  await a.result;
  const b = startPsql(atomicSql(actor, bId, input));
  const finishedBeforeCommit = await Promise.race([b.done.then(() => true, () => true), delay(250).then(() => false)]);
  assert.equal(finishedBeforeCommit, false, "the second independent psql connection must wait while session A holds its transaction");
  const aOutput = await a.done;
  const aResult = JSON.parse(aOutput.trim().split(/\r?\n/).find(line => line.startsWith("{"))!) as { transaction: { id: string } };
  if (expectReject) {
    await assert.rejects(b.done, expectReject);
    return { requestIds: [aId, bId], saleIds: [String(aResult.transaction.id)] };
  }
  const bOutput = await b.done;
  const bResult = JSON.parse(bOutput.trim().split(/\r?\n/).find(line => line.startsWith("{"))!) as { replayed: boolean; transaction: { id: string } };
  if (expectReplay) {
    assert.equal(bResult.replayed, true);
    assert.equal(bResult.transaction.id, aResult.transaction.id);
  }
  return { requestIds: [aId, bId], saleIds: [String(aResult.transaction.id)] };
}

async function rpc(name: string, token: string, args: Record<string, unknown>) {
  const response = await fetch(`${env.POS_RELEASE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: {
      apikey: env.POS_RELEASE_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }, body: JSON.stringify(args),
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function appRequest(path: string, token: string, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(new URL(path, env.POS_RELEASE_APP_URL), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=minimal" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.text() };
}

async function supabaseRequest(path: string, token: string, method: "GET" | "DELETE") {
  const response = await fetch(new URL(path, env.POS_RELEASE_SUPABASE_URL), {
    method,
    headers: { apikey: env.POS_RELEASE_SUPABASE_ANON_KEY!, authorization: `Bearer ${token}`, prefer: "return=minimal" },
  });
  return { status: response.status, body: await response.text() };
}

async function assertRejectedCreate(token: string, requestId: string, input: Record<string, unknown>) {
  const response = await rpc("create_sales_invoice_atomic", token, { p_request_id: requestId, p_input: input });
  assert.ok(response.status >= 400, `expected create RPC rejection; got ${response.status} ${response.body}`);
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
  for (const name of ["POS_RELEASE_OWNER_ACCESS_TOKEN", "POS_RELEASE_EMPLOYEE_ACCESS_TOKEN", "POS_RELEASE_INACTIVE_ACCESS_TOKEN", "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN"]) {
    assertAuthenticatedUserToken(name);
  }
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
  const executed: string[] = [];
  const returnIds: string[] = [];
  try {
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

    await sql(`update public.products set current_stock=1 where id=${literal(stockProduct)}::uuid and organization_id=${literal(org)}::uuid;`);
    const stock = await racePair(owner, saleInput(cashCustomer, stockProduct, "cash", 10), false, /stock|oversell|available/i, id => executed.push(id));
    const stockRows = await sql(`select json_build_object('sales',(select count(*) from public.sales_transactions where request_id=any(array[${stock.requestIds.map(literal).join(",")}]::uuid[])),'items',(select count(*) from public.sales_items where sales_transaction_id=any(array[${stock.saleIds.map(literal).join(",")}]::uuid[])),'movements',(select count(*) from public.inventory_transactions where reference_id=any(array[${stock.saleIds.map(literal).join(",")}]::uuid[]) and movement_type='sale_out'),'stock',(select current_stock from public.products where id=${literal(stockProduct)}::uuid));`);
    const stockState = JSON.parse(stockRows.trim());
    assert.equal(stockState.sales, 1);
    assert.equal(stockState.items, 1);
    assert.equal(stockState.movements, 1);
    assert.equal(Number(stockState.stock), 0);
    console.log("PASS last-stock race: stock policy allowed one sale and rejected the second.");

    const credit = await racePair(owner, saleInput(creditCustomer, creditProduct, "credit", 10), false, /credit limit/i, id => executed.push(id));
    const creditRows = await sql(`select json_build_object('sales',(select count(*) from public.sales_transactions where request_id=any(array[${credit.requestIds.map(literal).join(",")}]::uuid[])),'outstanding',(select coalesce(sum(st.total_amount-coalesce(a.allocated,0)),0) from public.sales_transactions st left join lateral (select sum(amount) allocated from public.customer_payment_allocations where sales_transaction_id=st.id) a on true where st.organization_id=${literal(org)}::uuid and st.customer_id=${literal(creditCustomer)}::uuid and st.payment_type='credit' and st.status in ('confirmed','paid','partially_paid')));`);
    const creditState = JSON.parse(creditRows.trim());
    assert.equal(creditState.sales, 1);
    assert.equal(Number(creditState.outstanding), 10);
    console.log("PASS credit-limit race: one invoice at the exact limit; competing invoice rejected.");

    const fractionRequest = randomUUID();
    executed.push(fractionRequest);
    const fractionInput = saleInput(cashCustomer, authProduct, "cash", 15, 0.125, "subunit", 120);
    const fractionSession = startPsql(atomicSql(owner, fractionRequest, fractionInput));
    const fractionResult = await fractionSession.result as { transaction: { id: string } };
    await fractionSession.done;
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
    await assertRejectedCreate(env.POS_RELEASE_EMPLOYEE_ACCESS_TOKEN!, employeeRequest, saleInput(cashCustomer, authProduct, "cash", 10));
    const inactiveRequest = randomUUID();
    await assertRejectedCreate(env.POS_RELEASE_INACTIVE_ACCESS_TOKEN!, inactiveRequest, saleInput(cashCustomer, authProduct, "cash", 10));
    const crossRequest = randomUUID();
    await assertRejectedCreate(env.POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN!, crossRequest, saleInput(cashCustomer, authProduct, "cash", 10));
    executed.push(employeeRequest, inactiveRequest, crossRequest);
    const crossStatus = await rpc("get_sales_invoice_request_status", env.POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN!, { p_request_id: ownerRequest });
    assert.ok(crossStatus.status >= 400 || /unknown/i.test(crossStatus.body), "cross-organization status lookup must not disclose the sale");
    assert.notEqual(otherOrg, org);
    assert.notEqual(otherOwner, owner);
    assert.notEqual(employee, owner);
    assert.notEqual(inactive, owner);
    console.log("PASS real Supabase JWT authorization: active owner, restricted employee, inactive profile, and cross-organization owner.");
    console.log("NOT RUN: browser history/export display and native print-dialog cases need a real browser session; repository HTML and data checks are separate.");
  } finally {
    if (executed.length || returnIds.length) await cleanup([...new Set(executed)], returnIds, org);
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
