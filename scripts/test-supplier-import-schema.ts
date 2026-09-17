import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  await db.exec("create table public.suppliers (id uuid primary key, supplier_name text not null)");
  const migration = readFileSync("src/lib/migrations/20260918_supplier_import_area.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const column = await db.query<{ data_type: string }>(`
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'suppliers' and column_name = 'area'
  `);
  assert.equal(column.rows[0]?.data_type, "text");
  await db.close();
  console.log("Supplier import schema migration passed: area is added as text and can be rerun safely.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
