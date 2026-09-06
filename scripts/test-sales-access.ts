import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { hasSalesTool, configureSalesTools, salesTools } from "../src/lib/sales/access";
import { filterPerformance, performanceAmount, type PerformanceSale } from "../src/lib/sales/performance";

async function main() {
  const basic = { role: "salesman", granted_sections: ["sales"] };
  assert.deepEqual(salesTools.filter(tool => hasSalesTool(basic, tool.id)).map(tool => tool.id), ["invoice", "history"]);
  const configured = { ...basic, granted_sections: ["sales", "sales:configured", "sales:history"] };
  assert.equal(hasSalesTool(configured, "invoice"), false);
  assert.equal(hasSalesTool(configured, "history"), true);
  assert.equal(hasSalesTool({ role: "salesman", granted_sections: ["customers"], can_create_sales: true }, "invoice"), false);
  assert.equal(hasSalesTool({ role: "salesman", can_create_sales: true }, "invoice"), true);
  assert.equal(hasSalesTool({ role: "salesman" }, "orders"), false);
  assert(salesTools.every(tool => hasSalesTool({ role: "owner" }, tool.id)));
  assert.deepEqual(configureSalesTools(configureSalesTools(["sales"])), configureSalesTools(["sales"]));
  const sale = { id: "1", invoice_number: "S1", sale_date: "2026-09-06", created_at: "2026-09-06", customer_id: "c1", total_amount: 150, status: "confirmed", customers: null,
    sales_items: [{ quantity: 2, selling_price: 30, discount: 5, products: { name: "A", brand_id: "b1", brands: { name: "Brand 1" } } }, { quantity: 1, selling_price: 100, discount: 0, products: { name: "B", brand_id: "b2", brands: { name: "Brand 2" } } }] } satisfies PerformanceSale;
  assert.equal(performanceAmount(sale, "b1"), 55);
  assert.equal(performanceAmount(sale, ""), 150);
  assert.equal(filterPerformance([sale, { ...sale, status: "pending_approval" }], { from: "2026-09-06", to: "2026-09-06", customer: "c1", brand: "b1" }).length, 1);
  assert.equal(filterPerformance([sale], { from: "2026-09-07", to: "", customer: "", brand: "" }).length, 0);

  const db = new PGlite();
  const org = "10000000-0000-0000-0000-000000000001", otherOrg = "10000000-0000-0000-0000-000000000002";
  const owner = "20000000-0000-0000-0000-000000000001", employee = "20000000-0000-0000-0000-000000000002", other = "20000000-0000-0000-0000-000000000003";
  await db.exec(`create role authenticated; create role service_role bypassrls; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table profiles(id uuid primary key, organization_id uuid, role text, is_active boolean);
    create table staff_permissions(profile_id uuid, organization_id uuid, can_create_sales boolean, granted_sections text[]);
    create table sales_transactions(id uuid primary key, organization_id uuid, created_by_profile_id uuid);
    create table sales_orders(id uuid primary key, organization_id uuid, created_by_profile_id uuid);
    create table sales_returns(id uuid primary key, organization_id uuid, created_by_profile_id uuid, sales_transaction_id uuid);
    create table sales_items(id int, sales_transaction_id uuid);
    create table sales_order_items(id int, sales_order_id uuid);
    create table sales_return_items(id int, sales_return_id uuid);
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into profiles values ('${owner}','${org}','owner',true),('${employee}','${org}','salesman',true),('${other}','${otherOrg}','owner',true);
    insert into staff_permissions values ('${employee}','${org}',true,array['sales']);
    insert into sales_transactions values ('${owner}','${org}','${owner}'),('${employee}','${org}','${employee}'),('${other}','${otherOrg}','${other}');
    insert into sales_items values(1,'${owner}'),(2,'${employee}'),(3,'${other}');
    insert into sales_orders select * from sales_transactions;
    insert into sales_order_items values(1,'${owner}'),(2,'${employee}');
  `);
  for (const table of ["staff_permissions", "sales_transactions", "sales_orders", "sales_returns", "sales_items", "sales_order_items", "sales_return_items"]) {
    await db.exec(`alter table ${table} enable row level security; create policy legacy_allow on ${table} for all to authenticated using(true) with check(true);`);
  }
  const migration = readFileSync("src/lib/migrations/production_phase11_sales_access.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  async function asUser(id: string, sql: string) {
    await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`);
    try { return await db.query(sql); } finally { await db.exec("rollback;"); }
  }
  assert.equal((await asUser(employee, "select * from sales_transactions")).rows.length, 1);
  assert.equal((await asUser(owner, "select * from sales_transactions")).rows.length, 2, "Owner sees own organization only");
  assert.deepEqual((await asUser(employee, "select id from sales_items")).rows, [{ id: 2 }]);
  assert.equal((await asUser(employee, "select * from sales_orders")).rows.length, 1);
  await assert.rejects(asUser(employee, `insert into sales_transactions values(gen_random_uuid(),'${org}','${employee}')`));
  await assert.rejects(asUser(employee, `insert into sales_items values(99,'${employee}')`));
  assert.equal((await asUser(employee, "update staff_permissions set granted_sections=array['sales','sales:orders'] returning *")).rows.length, 0);
  await db.exec(`update staff_permissions set granted_sections=array['sales','sales:configured','sales:history'];`);
  assert.deepEqual((await asUser(employee, `select sales_tool_allowed('${org}','invoice') as allowed`)).rows, [{ allowed: false }]);
  await assert.rejects(asUser(employee, `insert into sales_returns values(gen_random_uuid(),'${org}','${employee}','${employee}')`));
  await db.exec(`update staff_permissions set granted_sections=array['sales','sales:configured','sales:returns'];`);
  await asUser(employee, `insert into sales_returns values(gen_random_uuid(),'${org}','${employee}','${employee}')`);
  await assert.rejects(asUser(employee, `insert into sales_returns values(gen_random_uuid(),'${org}','${employee}','${owner}')`));
  await db.exec(`update profiles set is_active=false where id='${employee}';`);
  assert.equal((await asUser(employee, "select * from sales_transactions")).rows.length, 0);
  await db.close();
  console.log("Sales access: permission matrix, own sales, tenant isolation, approval-only writes, self-escalation denial, returns, inactive staff and repeat migration passed. Performance filters and totals passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
