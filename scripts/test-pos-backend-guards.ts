// Fixture/PGlite regression coverage only. This intentionally does not claim
// to recreate or verify the private deployed TradeOS schema.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const owner = "20000000-0000-4000-8000-000000000001";
const otherOwner = "20000000-0000-4000-8000-000000000002";
const fractionalProduct = "30000000-0000-4000-8000-000000000001";
const blockedProduct = "30000000-0000-4000-8000-000000000002";
const historyProduct = "30000000-0000-4000-8000-000000000003";
const parent = "40000000-0000-4000-8000-000000000001";

type FixtureRow = Record<string, string | number | null>;
type FixtureDb = Pick<PGlite, "exec" | "close"> & {
  query: (sql: string, params?: Parameters<PGlite["query"]>[1]) => Promise<{ rows: FixtureRow[] }>;
};

async function main() {
  const db = new PGlite() as unknown as FixtureDb;
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;

      create table public.organizations (
        id uuid primary key,
        overselling_policy text not null default 'block'
      );
      create table public.profiles (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        is_active boolean not null default true
      );
      create table public.invoice_sequences (
        organization_id uuid not null references public.organizations(id),
        invoice_type text not null,
        current_number integer not null,
        updated_at timestamptz not null,
        primary key (organization_id, invoice_type)
      );
      create table public.sales_returns (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        status text not null default 'confirmed' check (status in ('confirmed','cancelled'))
      );
      create table public.products (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        units_per_pack integer,
        overselling_policy text,
        current_stock numeric(18,6) not null default 0,
        updated_at timestamptz not null default now()
      );
      create table public.sales_return_items (
        id uuid primary key,
        sales_return_id uuid not null references public.sales_returns(id) on delete cascade,
        organization_id uuid references public.organizations(id),
        product_id uuid not null references public.products(id),
        quantity numeric(16,3) not null check (quantity > 0),
        unit_mode text not null default 'main' check (unit_mode in ('main','subunit')),
        batch_number text,
        expiry_date date,
        created_at timestamptz not null default now()
      );
      create table public.inventory_transactions (
        id bigserial primary key,
        organization_id uuid not null,
        product_id uuid not null,
        movement_type text not null,
        quantity_delta numeric(18,6) not null,
        reason text,
        batch_number text,
        expiry_date date,
        reference_type text,
        reference_id uuid,
        created_at timestamptz not null default now()
      );
      create function public.resolve_overselling_policy(p_org uuid, p_product uuid)
      returns text language sql stable security definer set search_path = pg_catalog, public as $$
        select coalesce(p.overselling_policy, o.overselling_policy, 'allow')
        from public.products p join public.organizations o on o.id = p.organization_id
        where p.id = p_product and p.organization_id = p_org
      $$;
      create table public.fixture_invoices (
        id bigserial primary key,
        organization_id uuid not null,
        invoice_type text not null,
        sequence_number integer not null
      );
      insert into public.organizations(id, overselling_policy) values
        ('${org}', 'block'), ('${otherOrg}', 'block');
      insert into public.profiles(id, organization_id) values
        ('${owner}', '${org}'), ('${otherOwner}', '${otherOrg}');
      insert into public.products(id, organization_id, units_per_pack, overselling_policy, current_stock) values
        ('${fractionalProduct}', '${org}', 12, 'block', 1),
        ('${blockedProduct}', '${org}', 1, 'block', 0),
        ('${historyProduct}', '${org}', 12, 'block', 4);
    `);

    await db.exec(readFileSync("src/lib/migrations/20260928_pos_sequence_return_stock_guards.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/20260929_pos_return_history_guards.sql", "utf8"));
    await db.exec(`
      create function public.fixture_create_invoice(p_org uuid, p_type text)
      returns integer language plpgsql security definer
      set search_path = pg_catalog, public, pg_temp as $$
      declare v_sequence integer;
      begin
        v_sequence := public.next_invoice_number(p_org, p_type);
        insert into public.fixture_invoices(organization_id, invoice_type, sequence_number)
        values (p_org, p_type, v_sequence);
        return v_sequence;
      end
      $$;
      grant execute on function public.fixture_create_invoice(uuid,text) to authenticated;
    `);

    const asRole = async (role: string, actor: string | null, jwtRole = role, query?: string, params: unknown[] = []) => {
      await db.exec("begin");
      try {
        await db.exec(`set local role ${role}`);
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor ?? ""]);
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: jwtRole })]);
        const result = query ? await db.query(query, params) : undefined;
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback").catch(() => undefined);
        throw error;
      }
    };

    await assert.rejects(
      asRole("anon", null, "anon", "select public.next_invoice_number($1, 'sales')", [org]),
      /permission denied/i,
    );
    assert.equal((await db.query("select count(*)::int as n from public.invoice_sequences where organization_id=$1", [org])).rows[0].n, 0,
      "anonymous denial leaves the sequence unchanged");

    await assert.rejects(
      asRole("authenticated", owner, "authenticated", "select public.next_invoice_number($1, 'sales')", [otherOrg]),
      /Active organization membership is required/,
    );
    assert.equal((await db.query("select count(*)::int as n from public.invoice_sequences where organization_id=$1", [otherOrg])).rows[0].n, 0,
      "cross-organization denial leaves the other sequence unchanged");

    const createdInvoice = await asRole(
      "authenticated", owner, "authenticated",
      "select public.fixture_create_invoice($1, 'sales') as sequence_number", [org],
    );
    assert.equal(createdInvoice?.rows[0].sequence_number, 1, "same-organization SECURITY DEFINER invoice caller succeeds");
    assert.equal((await db.query("select count(*)::int as n from public.fixture_invoices where organization_id=$1 and sequence_number=1", [org])).rows[0].n, 1,
      "authorized invoice was created once");

    const serviceSequence = await asRole(
      "service_role", null, "service_role",
      "select public.next_invoice_number($1, 'purchase') as sequence_number", [otherOrg],
    );
    assert.equal(serviceSequence?.rows[0].sequence_number, 1, "trusted service role can allocate backend sequence");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('${parent}', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity, unit_mode)
      values ('50000000-0000-4000-8000-000000000001', '${parent}', '${org}', '${fractionalProduct}', 0.125, 'subunit');
    `);
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "1.010417",
      "fractional subunit return rounds once to the six-place stock contract");
    assert.equal((await db.query("select quantity_delta::text as delta from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].delta, "0.010417",
      "fractional subunit ledger matches stock effect");

    const beforeEditLedger = Number((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n);
    await db.query("update public.sales_return_items set quantity=0.250 where id=$1", ["50000000-0000-4000-8000-000000000001"]);
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "1.020833",
      "item edit applies only the normalized new-minus-old quantity");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n, beforeEditLedger + 1,
      "item edit writes one net ledger movement");

    const beforeDeleteLedger = Number((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n);
    await db.query("delete from public.sales_return_items where id=$1", ["50000000-0000-4000-8000-000000000001"]);
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "1.000000",
      "return reversal restores the original stock");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n, beforeDeleteLedger + 1,
      "return reversal writes exactly one stock movement");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('40000000-0000-4000-8000-000000000002', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity, unit_mode)
      values ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '${org}', '${blockedProduct}', 1, 'main');
      update public.products set current_stock=0 where id='${blockedProduct}';
    `);
    const beforeRejectedLedger = (await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [blockedProduct])).rows[0].n;
    await assert.rejects(
      db.query("delete from public.sales_return_items where id=$1", ["50000000-0000-4000-8000-000000000002"]),
      /Return reversal would violate the stock policy/,
    );
    assert.equal((await db.query("select count(*)::int as n from public.sales_return_items where id=$1", ["50000000-0000-4000-8000-000000000002"])).rows[0].n, 1,
      "rejected reversal keeps the return item");
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [blockedProduct])).rows[0].stock, "0.000000",
      "rejected reversal keeps stock unchanged");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [blockedProduct])).rows[0].n, beforeRejectedLedger,
      "rejected reversal leaves ledger unchanged");

    await assert.rejects(
      db.query("update public.sales_returns set status='cancelled' where id=$1", ["40000000-0000-4000-8000-000000000002"]),
      /Return reversal would violate the stock policy/,
    );
    assert.equal((await db.query("select status from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000002"])).rows[0].status, "confirmed",
      "rejected parent cancellation keeps its status");
    assert.equal((await db.query("select count(*)::int as n from public.sales_return_items where sales_return_id=$1", ["40000000-0000-4000-8000-000000000002"])).rows[0].n, 1,
      "rejected parent cancellation keeps its lines");
    const beforeRejectedParentDeleteLedger = (await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [blockedProduct])).rows[0].n;
    await assert.rejects(
      db.query("delete from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000002"]),
      /Return reversal would violate the stock policy/,
    );
    assert.equal((await db.query("select count(*)::int as n from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000002"])).rows[0].n, 1,
      "rejected parent deletion leaves the return intact");
    assert.equal((await db.query("select count(*)::int as n from public.sales_return_items where sales_return_id=$1", ["40000000-0000-4000-8000-000000000002"])).rows[0].n, 1,
      "rejected parent deletion leaves all return lines intact");
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [blockedProduct])).rows[0].stock, "0.000000",
      "rejected parent deletion leaves stock unchanged");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [blockedProduct])).rows[0].n, beforeRejectedParentDeleteLedger,
      "rejected parent deletion leaves the ledger unchanged");

    await db.query("update public.products set current_stock=2 where id=$1", [fractionalProduct]);
    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('40000000-0000-4000-8000-000000000003', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity)
      values ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '${org}', '${fractionalProduct}', 0.125);
    `);
    const cancelLedgerBefore = Number((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n);
    await db.query("update public.sales_returns set status='cancelled' where id=$1", ["40000000-0000-4000-8000-000000000003"]);
    assert.equal((await db.query("select status from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000003"])).rows[0].status, "cancelled",
      "parent cancellation succeeds when stock can be reversed");
    assert.equal((await db.query("select count(*)::int as n from public.sales_return_items where sales_return_id=$1", ["40000000-0000-4000-8000-000000000003"])).rows[0].n, 1,
      "parent cancellation retains return lines for history");
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "2.000000",
      "parent cancellation reverses stock once");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n, cancelLedgerBefore + 1,
      "parent cancellation writes exactly one reversal movement");

    const cancelledDeleteLedgerBefore = (await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n;
    await db.query("delete from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000003"]);
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "2.000000",
      "deleting an already-cancelled parent does not reverse stock twice");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n, cancelledDeleteLedgerBefore,
      "deleting an already-cancelled parent adds no second ledger movement");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('40000000-0000-4000-8000-000000000004', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity)
      values ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', '${org}', '${fractionalProduct}', 0.125);
    `);
    const deleteLedgerBefore = Number((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n);
    await db.query("delete from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000004"]);
    assert.equal((await db.query("select current_stock::text as stock from public.products where id=$1", [fractionalProduct])).rows[0].stock, "2.000000",
      "parent deletion reverses stock within the delete transaction");
    assert.equal((await db.query("select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct])).rows[0].n, deleteLedgerBefore + 1,
      "parent deletion writes exactly one reversal movement");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values
        ('40000000-0000-4000-8000-000000000005', '${org}'),
        ('40000000-0000-4000-8000-000000000006', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity)
      values ('50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', '${org}', '${fractionalProduct}', 0.125);
      update public.sales_returns set status='cancelled' where id='40000000-0000-4000-8000-000000000005';
    `);
    const reassignmentStockBefore = (await db.query(
      "select current_stock::text as stock from public.products where id=$1", [fractionalProduct],
    )).rows[0].stock;
    const reassignmentItemBefore = (await db.query(
      "select sales_return_id, organization_id, product_id, quantity::text as quantity, unit_mode, batch_number, expiry_date from public.sales_return_items where id=$1",
      ["50000000-0000-4000-8000-000000000005"],
    )).rows[0];
    const reassignmentLedgerBefore = (await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct],
    )).rows[0].n;
    await assert.rejects(
      db.query("update public.sales_return_items set sales_return_id=$1 where id=$2", [
        "40000000-0000-4000-8000-000000000006", "50000000-0000-4000-8000-000000000005",
      ]),
      /Sales return items cannot be reassigned/,
    );
    assert.deepEqual((await db.query(
      "select sales_return_id, organization_id, product_id, quantity::text as quantity, unit_mode, batch_number, expiry_date from public.sales_return_items where id=$1",
      ["50000000-0000-4000-8000-000000000005"],
    )).rows[0], reassignmentItemBefore, "rejected reassignment preserves the complete item row");
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [fractionalProduct],
    )).rows[0].stock, reassignmentStockBefore, "rejected reassignment preserves stock");
    assert.equal((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [fractionalProduct],
    )).rows[0].n, reassignmentLedgerBefore, "rejected reassignment preserves the ledger");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('40000000-0000-4000-8000-000000000007', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity, unit_mode)
      values ('50000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000007', '${org}', '${historyProduct}', 12, 'subunit');
    `);
    const historyLedgerBefore = Number((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n);
    const historyStockBeforeConversionAttempt = (await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock;
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, "5.000000", "12 subunits at 12 per pack add exactly one main unit");
    await assert.rejects(
      db.query("update public.products set units_per_pack=24 where id=$1", [historyProduct]),
      /Cannot change units_per_pack while an active subunit sales return exists/,
    );
    assert.equal((await db.query(
      "select units_per_pack from public.products where id=$1", [historyProduct],
    )).rows[0].units_per_pack, 12, "rejected conversion change preserves the product conversion");
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, historyStockBeforeConversionAttempt, "rejected conversion change preserves stock");
    assert.equal(Number((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n), historyLedgerBefore, "rejected conversion change preserves the ledger");
    await db.query("update public.sales_returns set status='cancelled' where id=$1", [
      "40000000-0000-4000-8000-000000000007",
    ]);
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, "4.000000", "cancellation reverses with the original conversion exactly");
    assert.equal((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n, historyLedgerBefore + 1, "cancellation records one exact conversion reversal");
    assert.equal((await db.query(
      "select quantity_delta::text as delta from public.inventory_transactions where product_id=$1 order by id desc limit 1",
      [historyProduct],
    )).rows[0].delta, "-1.000000", "cancellation ledger reverses the original one-main-unit effect");
    await db.query("update public.products set units_per_pack=24 where id=$1", [historyProduct]);
    const cancelledLedgerAfterPackChange = (await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n;
    await db.query("delete from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000007"]);
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, "4.000000", "deleting a cancelled return after a conversion change does not reverse twice");
    assert.equal((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n, cancelledLedgerAfterPackChange, "cancelled return deletion does not add a ledger effect");

    await db.exec(`
      insert into public.sales_returns(id, organization_id) values ('40000000-0000-4000-8000-000000000008', '${org}');
      insert into public.sales_return_items(id, sales_return_id, organization_id, product_id, quantity, unit_mode)
      values ('50000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000008', '${org}', '${historyProduct}', 12, 'subunit');
    `);
    const deleteHistoryLedgerBefore = Number((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n);
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, "4.500000", "12 subunits at 24 per pack add one half main unit");
    await assert.rejects(
      db.query("update public.products set units_per_pack=12 where id=$1", [historyProduct]),
      /Cannot change units_per_pack while an active subunit sales return exists/,
    );
    await db.query("delete from public.sales_returns where id=$1", ["40000000-0000-4000-8000-000000000008"]);
    assert.equal((await db.query(
      "select current_stock::text as stock from public.products where id=$1", [historyProduct],
    )).rows[0].stock, "4.000000", "deleting an active subunit return reverses with its unchanged conversion");
    assert.equal((await db.query(
      "select count(*)::int as n from public.inventory_transactions where product_id=$1", [historyProduct],
    )).rows[0].n, deleteHistoryLedgerBefore + 1, "active subunit return deletion records one reversal");
    assert.equal((await db.query(
      "select quantity_delta::text as delta from public.inventory_transactions where product_id=$1 order by id desc limit 1",
      [historyProduct],
    )).rows[0].delta, "-0.500000", "deletion ledger reverses the original half-main-unit effect");
    await db.query("update public.products set units_per_pack=12 where id=$1", [historyProduct]);
    console.log("PASS: fixture/PGlite authorization, fractional return, rollback, cancel, and delete scenarios");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
