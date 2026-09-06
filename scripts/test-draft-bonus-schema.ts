import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  await db.exec("create table sales_order_items(id integer primary key); create table sales_items(id integer primary key); insert into sales_order_items values(1);");
  const migration = readFileSync("src/lib/migrations/production_phase12_draft_bonus.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query("select bonus::float8 as bonus from sales_order_items where id=1")).rows, [{ bonus: 0 }]);
  await db.exec("insert into sales_order_items(id,bonus) values(2,3.5); insert into sales_items(id,bonus) select id,bonus from sales_order_items where id=2;");
  assert.deepEqual((await db.query("select bonus::float8 as bonus from sales_items where id=2")).rows, [{ bonus: 3.5 }]);
  await assert.rejects(db.exec("insert into sales_order_items(id,bonus) values(3,-1)"));
  await db.close();
  console.log("Draft bonus migration: existing rows default to zero, values survive approval copy, negative values rejected, rerun succeeds.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
