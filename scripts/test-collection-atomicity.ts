import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const workspace = path.resolve(__dirname, "..");
const route = readFileSync(
  path.join(workspace, "src/app/api/collections/[id]/route.ts"),
  "utf8"
);
const migration = readFileSync(
  path.join(workspace, "src/lib/migrations/production_phase9_atomic_collections.sql"),
  "utf8"
);

assert.match(route, /rpc\("process_collection_decision"/);
assert.doesNotMatch(route, /from\("customer_payments"\)/);
assert.doesNotMatch(route, /from\("customer_payment_allocations"\)/);
assert.match(migration, /from public\.collections[\s\S]*for update/i);
assert.match(migration, /from public\.customers[\s\S]*for update/i);
assert.match(migration, /insert into public\.customer_payments/i);
assert.match(migration, /insert into public\.customer_payment_allocations/i);
assert.match(migration, /update public\.customers/i);
assert.match(migration, /grant execute[\s\S]*to service_role/i);
assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);

console.log("atomic collection decision contract OK");
