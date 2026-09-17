import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  const org = "00000000-0000-4000-8000-000000000001";
  const product = "00000000-0000-4000-8000-000000000002";
  const tx = "00000000-0000-4000-8000-000000000003";
  await db.exec(`
    create table products(id uuid primary key, organization_id uuid, current_stock numeric, units_per_pack numeric, updated_at timestamptz);
    create table sales_transactions(id uuid primary key, organization_id uuid);
    create table sales_items(id int primary key, organization_id uuid, product_id uuid, sales_transaction_id uuid, quantity numeric, bonus numeric, unit_mode text);
    create table inventory_transactions(organization_id uuid, product_id uuid, movement_type text, quantity_delta numeric, reason text, batch_number text, reference_type text, reference_id uuid, created_at timestamptz);
    create function resolve_overselling_policy(uuid, uuid) returns text language sql as $$ select 'block'::text $$;
    create function inventory_sync_sale_item() returns trigger language plpgsql as $$ begin return new; end $$;
    insert into products values ('${product}', '${org}', 23, 12, now());
    insert into sales_transactions values ('${tx}', '${org}');
    -- Historical paid quantity was already deducted; bonus was not.
    insert into sales_items values (1,'${org}','${product}','${tx}',1,2,'main');
  `);
  const migration = readFileSync("src/lib/migrations/20260917_sales_bonus_stock.sql", "utf8");
  await db.exec(migration);
  const stock = async () => Number((await db.query<{ current_stock: string }>("select current_stock from products")).rows[0].current_stock);
  assert.equal(await stock(), 23, "Migration must not silently rebuild historical stock");
  await db.exec("delete from sales_items where id=1");
  assert.equal(await stock(), 24, "Deleting legacy sale restores only stock actually deducted");
  const insert = (id: number, qty: number, bonus: number, unit: string) => `insert into sales_items(id,organization_id,product_id,sales_transaction_id,quantity,bonus,unit_mode) values (${id},'${org}','${product}','${tx}',${qty},${bonus},'${unit}')`;
  await db.exec(insert(2, 1, 1, "main"));
  assert.equal(await stock(), 22);
  await db.exec(insert(3, 6, 6, "subunit"));
  assert.equal(await stock(), 21);
  await db.exec("update sales_items set quantity=12, bonus=0 where id=3");
  assert.equal(await stock(), 21, "Paid/free quantity substitution has zero net stock effect");
  await db.exec("update sales_items set quantity=1, unit_mode='main' where id=3");
  assert.equal(await stock(), 21, "Switching equivalent units has zero net stock effect");
  await db.exec("delete from sales_items where id=3");
  assert.equal(await stock(), 22);
  await assert.rejects(db.exec(insert(4, 22, 1, "main")), /Insufficient stock/);
  assert.equal(await stock(), 22, "Rejected oversell rolls back stock and ledger");
  const multi = insert(5, 15, 0, "main") + `, (6,'${org}','${product}','${tx}',15,0,'main')`;
  await assert.rejects(db.exec(multi), /Insufficient stock/);
  assert.equal(await stock(), 22, "A failed multi-line statement must roll back every line");
  assert.equal((await db.query("select id from sales_items where id in (5,6)")).rows.length, 0);
  await db.exec(migration);
  assert.equal(await stock(), 22, "Rerunning migration must be safe");
  await db.close();
  console.log("POS SQL: main/sub-unit bonuses, legacy deletes, unit changes, overselling, multi-line rollback and rerun passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
