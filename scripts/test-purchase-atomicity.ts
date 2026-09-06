import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  try {
    // Isolated PostgreSQL fixtures. No connection to the business database.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key, organization_id uuid, is_active boolean);
      create table suppliers(id uuid primary key, organization_id uuid, outstanding_balance numeric default 0, last_purchase_date date, updated_at timestamptz);
      create table products(id uuid primary key, organization_id uuid, default_selling_price numeric, current_stock numeric default 0 check(current_stock >= 0));
      create table purchase_transactions(id uuid primary key default gen_random_uuid(), organization_id uuid, supplier_id uuid references suppliers, invoice_number text,
        supplier_invoice_number text, purchase_date date, payment_type text, credit_due_date date, notes text, total_amount numeric, discount_amount numeric,
        tax_amount numeric, status text, invoice_type text, created_by_profile_id uuid, unique(organization_id,invoice_number));
      create table purchase_items(id uuid primary key default gen_random_uuid(), purchase_transaction_id uuid references purchase_transactions,
        organization_id uuid, product_id uuid references products, quantity numeric, purchase_price numeric, selling_price numeric, batch_number text, expiry_date date, unit_mode text);
      create table purchase_orders(id uuid primary key, organization_id uuid, supplier_id uuid, status text, updated_at timestamptz);
      create table purchase_order_items(id uuid primary key, purchase_order_id uuid, product_id uuid, quantity_received numeric, quantity_ordered numeric, unit_price numeric, batch_number text, expiry_date date);
      create table supplier_payment_allocations(id uuid, purchase_transaction_id uuid references purchase_transactions);
      create table expenses(id uuid, purchase_transaction_id uuid references purchase_transactions);
      create table purchase_returns(id uuid, purchase_transaction_id uuid references purchase_transactions);
      create table audit_logs(organization_id uuid, actor_profile_id uuid, action text, entity_type text, entity_id uuid, entity_label text, description text, new_values jsonb, old_values jsonb);
      create table invoice_sequences(organization_id uuid primary key, value bigint);
      create function next_invoice_number(p_organization_id uuid,p_invoice_type text) returns bigint language sql as $$
        insert into invoice_sequences values(p_organization_id,1) on conflict(organization_id) do update set value=invoice_sequences.value+1 returning value; $$;
      create function stock_sync() returns trigger language plpgsql as $$ begin
        if TG_OP='DELETE' then update products set current_stock=current_stock-old.quantity where id=old.product_id; return old; end if;
        update products set current_stock=current_stock+new.quantity where id=new.product_id; return new;
      end $$;
      create trigger inventory_sync_purchase_item after insert or delete on purchase_items for each row execute function stock_sync();
    `);
    // Match the older production schema, then verify the upgrade supplies its missing fields.
    await db.exec(`alter table suppliers drop column outstanding_balance, drop column last_purchase_date, drop column updated_at;
      alter table purchase_transactions drop column payment_type, drop column credit_due_date, drop column discount_amount, drop column tax_amount;`);
    await db.exec(readFileSync("src/lib/migrations/production_phase10_atomic_purchases.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase10_atomic_purchases.sql", "utf8"));
    const org = "10000000-0000-0000-0000-000000000001", actor = "20000000-0000-0000-0000-000000000001";
    const supplier = "30000000-0000-0000-0000-000000000001", product = "40000000-0000-0000-0000-000000000001";
    await db.query("insert into profiles values($1,$2,true)", [actor, org]);
    await db.query("insert into suppliers(id,organization_id) values($1,$2)", [supplier, org]);
    await db.query("insert into products(id,organization_id) values($1,$2)", [product, org]);
    const input = { supplier_id: supplier, purchase_date: "2026-09-06", payment_type: "credit", credit_days: 30,
      lines: [{ product_id: product, quantity: 2, purchase_price: 150, selling_price: 175 }] };
    const create = async (extra = {}, actorId = actor) => (await db.query<{ result: { transaction: { id: string; invoice_number: string }; replayed?: boolean; purchase_order_status?: string } }>(
      "select create_purchase_atomic($1,$2,$3) as result", [org, actorId, JSON.stringify({ ...input, ...extra })])).rows[0].result;
    const snapshot = async () => (await db.query<{ invoices: number; items: number; audits: number; balance: number; stock: number }>(`select
      (select count(*) from purchase_transactions)::int as invoices,
      (select count(*) from purchase_items)::int as items,
      (select count(*) from audit_logs)::int as audits,
      (select outstanding_balance::float from suppliers limit 1) as balance,
      (select current_stock::float from products limit 1) as stock`)).rows[0];
    const first = await create({ request_key: "retry-1" });
    assert.equal(first.transaction.invoice_number, "P-50001");
    assert.deepEqual(await snapshot(), { invoices: 1, items: 1, audits: 1, balance: 300, stock: 2 });
    assert.equal((await create({ request_key: "retry-1" })).transaction.id, first.transaction.id);
    assert.equal((await snapshot()).invoices, 1, "Retry does not duplicate stock/invoice");
    await assert.rejects(create({}, "20000000-0000-0000-0000-000000000002"), /actor/);
    const before = await snapshot();
    await assert.rejects(create({ lines: [...input.lines, { product_id: "40000000-0000-0000-0000-000000000002", quantity: 1, purchase_price: 10 }] }), /Product not found/);
    assert.deepEqual(await snapshot(), before, "Invalid cross-tenant product rolls everything back");
    // Force a late audit failure, after invoice/items/stock/balance were written.
    await db.exec(`alter table audit_logs add constraint reject_audits check(action <> 'purchase_created') not valid;`);
    await assert.rejects(create(), /reject_audits/);
    assert.deepEqual(await snapshot(), before, "Audit failure rolls back invoice, items, stock and balance");
    await db.exec("alter table audit_logs drop constraint reject_audits");
    const second = await create();
    assert.equal(second.transaction.invoice_number, "P-50002", "Invoice sequence also rolls back");
    assert.equal((await snapshot()).balance, 600, "Successive purchases accumulate supplier balance");
    await db.query("insert into supplier_payment_allocations values(gen_random_uuid(),$1)", [second.transaction.id]);
    await assert.rejects(db.query("select delete_purchase_atomic($1,$2,$3)", [org, actor, second.transaction.id]), /linked records/);
    await db.query("select delete_purchase_atomic($1,$2,$3)", [org, actor, first.transaction.id]);
    assert.equal((await snapshot()).balance, 300);
    assert.equal((await snapshot()).stock, 2);
    const po = "50000000-0000-0000-0000-000000000001", item = "60000000-0000-0000-0000-000000000001";
    await db.query("insert into purchase_orders values($1,$2,$3,'ordered',now())", [po,org,supplier]);
    await db.query("insert into purchase_order_items(id,purchase_order_id,product_id,quantity_received,quantity_ordered) values($1,$2,$3,0,3)", [item,po,product]);
    const receipt = { purchase_order_id: po, lines: [{ ...input.lines[0], order_item_id: item }] };
    assert.equal((await create(receipt)).purchase_order_status, "partial");
    const afterPartial = await snapshot();
    await assert.rejects(create(receipt), /remaining quantity/);
    assert.deepEqual(await snapshot(), afterPartial, "Over-receipt rolls back all state");
    assert.equal((await create({ ...receipt, lines: [{ ...receipt.lines[0], quantity: 1 }] })).purchase_order_status, "received");
    await db.exec("set role authenticated");
    await assert.rejects(create(), /permission denied/, "Browser role cannot invoke privileged purchase mutation");
    console.log("PostgreSQL purchase transaction tests passed: rollback, stock, balance, sequence, retry, tenant, receipt limits, linked deletion and RPC grants.");
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
