import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { dashboardPeriodSalesTotals } from "../src/lib/dashboard/sales-metrics";
import { buildDashboardActivityCsvRows } from "../src/lib/dashboard/business-records-export";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { resolveDashboardAccess } from "../src/lib/identity/dashboard-permissions";
import type { DashboardSalesData } from "../src/lib/dashboard/sales-read";

const org = "10000000-0000-0000-0000-000000000001";
const otherOrg = "10000000-0000-0000-0000-000000000002";
const userId = (id: number) => "20000000-0000-0000-0000-" + String(id).padStart(12, "0");
const orderId = (id: number) => "30000000-0000-0000-0000-" + String(id).padStart(12, "0");
const own = userId(2), staff = userId(3), legacy = userId(4), owner = userId(1), admin = userId(5);
const foreign = userId(6), exportOnly = userId(7), inactive = userId(8), viewOnly = userId(9);
const ownReturn = orderId(12), staffReturn = orderId(13), foreignReturn = orderId(16);
const day = "2026-11-28";

export async function testManagerDashboardRls() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid stable language sql as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create table profiles (id uuid primary key, organization_id uuid, role text, is_active boolean);
      create table staff_permissions (
        profile_id uuid, organization_id uuid, can_create_sales boolean, granted_sections text[],
        primary key (organization_id, profile_id)
      );
      create table sales_transactions (
        id uuid primary key, organization_id uuid, created_by_profile_id uuid, customer_id uuid,
        sale_date text, created_at text, invoice_number text, payment_type text, total_amount integer
      );
      create table sales_orders (id uuid primary key, organization_id uuid, created_by_profile_id uuid);
      create table purchase_transactions (
        id uuid primary key, organization_id uuid, supplier_id uuid, created_at text, invoice_number text,
        payment_type text, total_amount integer
      );
      create table sales_returns (
        id uuid primary key, organization_id uuid, created_by_profile_id uuid,
        sales_transaction_id uuid references sales_transactions, status text
      );
      create table sales_items (
        id integer primary key, sales_transaction_id uuid references sales_transactions, product_id integer,
        quantity integer, selling_price integer, purchase_price_snapshot integer, discount integer, unit_mode text
      );
      create table sales_order_items (id integer primary key, sales_order_id uuid references sales_orders);
      create table sales_return_items (
        id integer primary key, sales_return_id uuid references sales_returns,
        quantity integer, unit_price integer, discount integer
      );
      grant select, insert, update, delete on all tables in schema public to authenticated;
      create function public.fixture_org() returns uuid language sql stable as
        $$ select organization_id from public.profiles where id = auth.uid() $$;
      insert into profiles values
        ('${owner}', '${org}', 'owner', true), ('${own}', '${org}', 'manager', true),
        ('${staff}', '${org}', 'salesman', true), ('${legacy}', '${org}', 'manager', true),
        ('${admin}', '${org}', 'admin', true), ('${foreign}', '${otherOrg}', 'owner', true),
        ('${exportOnly}', '${org}', 'manager', true), ('${inactive}', '${org}', 'manager', false),
        ('${viewOnly}', '${org}', 'custom-role', true);
      insert into staff_permissions values
        ('${own}', '${org}', true, array['sales','sales:configured','sales:history','sales:returns','sales:orders','profit-loss']),
        ('${staff}', '${org}', true, array['sales','sales:configured','sales:history','sales:returns','sales:orders']),
        ('${legacy}', '${org}', true, '{}'), ('${exportOnly}', '${org}', false, '{}'),
        ('${inactive}', '${org}', true, array['sales']), ('${viewOnly}', '${org}', false, '{}'),
        ('${staff}', '${otherOrg}', false, '{}');
      insert into sales_transactions values
        ('${owner}', '${org}', '${owner}', '${owner}', '${day}', '${day}T10:00:00Z', 'OWNER-65', 'cash', 65),
        ('${own}', '${org}', '${own}', '${owner}', '${day}', '${day}T11:00:00Z', 'MANAGER-120', 'credit', 120),
        ('${staff}', '${org}', '${staff}', '${owner}', '${day}', '${day}T12:00:00Z', 'STAFF-180', 'credit', 180),
        ('${legacy}', '${org}', '${legacy}', '${owner}', '${day}', '${day}T13:00:00Z', 'LEGACY-35', 'cash', 35),
        ('${foreign}', '${otherOrg}', '${foreign}', '${foreign}', '${day}', '${day}T14:00:00Z', 'FOREIGN-900', 'cash', 900);
      insert into sales_items values
        (1,'${owner}',1,1,65,25,0,'main'), (2,'${own}',1,1,120,50,0,'main'),
        (3,'${staff}',1,1,180,90,0,'main'), (4,'${legacy}',1,1,35,10,0,'main'),
        (6,'${foreign}',1,1,900,1,0,'main');
      insert into sales_orders select id, organization_id, created_by_profile_id from sales_transactions;
      insert into purchase_transactions values
        ('${orderId(21)}','${org}','${owner}','${day}T14:00:00Z','PURCHASE-250','cash',250),
        ('${orderId(22)}','${org}','${owner}','${day}T15:00:00Z','PURCHASE-80','credit',80),
        ('${orderId(23)}','${otherOrg}','${foreign}','${day}T16:00:00Z','FOREIGN-PURCHASE','credit',800);
      insert into sales_order_items values (1,'${owner}'), (2,'${own}'), (3,'${staff}'), (4,'${legacy}'), (6,'${foreign}');
      insert into sales_returns values
        ('${ownReturn}', '${org}', '${own}', '${own}', 'confirmed'),
        ('${staffReturn}', '${org}', '${staff}', '${staff}', 'confirmed'),
        ('${foreignReturn}', '${otherOrg}', '${foreign}', '${foreign}', 'confirmed');
      insert into sales_return_items values (12,'${ownReturn}',1,20,0), (13,'${staffReturn}',1,30,0), (16,'${foreignReturn}',1,100,0);
    `);
    for (const table of ["sales_transactions", "sales_orders", "sales_returns", "purchase_transactions"]) {
      await db.exec(`alter table ${table} enable row level security;
        create policy fixture_tenant on ${table} for all to authenticated
        using (organization_id = public.fixture_org()) with check (organization_id = public.fixture_org());`);
    }
    await db.exec(`alter table staff_permissions enable row level security;
      create policy fixture_staff_owner_admin on staff_permissions for all to authenticated using (
        organization_id = public.fixture_org() and exists (
          select 1 from profiles where id = auth.uid() and role in ('owner','admin') and is_active is distinct from false
        )
      );`);
    for (const [child, parent, fk] of [
      ["sales_items", "sales_transactions", "sales_transaction_id"],
      ["sales_order_items", "sales_orders", "sales_order_id"],
      ["sales_return_items", "sales_returns", "sales_return_id"],
    ]) {
      await db.exec(`alter table ${child} enable row level security;
        create policy fixture_parent_tenant on ${child} for all to authenticated
        using (exists(select 1 from ${parent} p where p.id = ${child}.${fk} and p.organization_id = public.fixture_org()));`);
    }
    await db.exec(readFileSync("src/lib/migrations/production_phase11_sales_access.sql", "utf8"));

    async function as<T>(id: string, run: () => Promise<T>) {
      await db.exec("begin; set local role authenticated;");
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
        return await run();
      } finally {
        await db.exec("rollback");
      }
    }
    const read = (id: string) => as(id, async () => ({
      salesTransactions: (await db.query<DashboardSalesData["salesTransactions"][number]>("select * from sales_transactions order by id")).rows,
      salesItems: (await db.query<DashboardSalesData["salesItems"][number]>("select * from sales_items order by id")).rows,
      salesOrders: (await db.query("select * from sales_orders order by id")).rows,
      salesOrderItems: (await db.query("select * from sales_order_items order by id")).rows,
      salesReturns: (await db.query<DashboardSalesData["salesReturns"][number]>("select * from sales_returns order by id")).rows,
      salesReturnItems: (await db.query<DashboardSalesData["salesReturnItems"][number]>("select * from sales_return_items order by id")).rows,
    }));
    const before = [owner, admin, own, staff, legacy, foreign];
    const oldReads = new Map<string, Awaited<ReturnType<typeof read>>>();
    for (const person of before) oldReads.set(person, await read(person));

    const draft = readFileSync("docs/sql-drafts/redesign_manager_dashboard_rls.sql", "utf8");
    await db.exec(draft);
    await db.exec(draft);
    for (const person of before) assert.deepEqual(await read(person), oldReads.get(person), "defaults preserve Phase-11 reads");

    await db.exec(`
      update staff_permissions set dashboard_view = true where profile_id in ('${own}', '${inactive}', '${viewOnly}')
        or (profile_id = '${staff}' and organization_id = '${otherOrg}');
      update staff_permissions set dashboard_export = true where profile_id in ('${own}', '${exportOnly}');
    `);
    const managed = await read(own);
    assert.deepEqual(managed, oldReads.get(owner), "grant includes all same-org parent and child rows");
    for (const person of [owner, admin, staff, legacy, foreign]) assert.deepEqual(await read(person), oldReads.get(person));
    assert.deepEqual(await read(viewOnly), managed, "an explicit grant works independently of role");
    for (const person of [exportOnly, inactive]) assert.equal((await read(person)).salesTransactions.length, 0);

    const period = { start: day, end: day };
    const managerAmounts = dashboardPeriodSalesTotals(managed.salesTransactions, managed.salesItems, new Map(), period, true);
    assert.deepEqual(managerAmounts, { sales: 400, profit: 225, unknownCostLines: 0, unknownCostRevenue: 0 });
    const staffRows = (await read(staff));
    assert.equal(dashboardPeriodSalesTotals(staffRows.salesTransactions, staffRows.salesItems, new Map(), period, false).sales, 180);
    const legacyRows = await read(legacy);
    assert.equal(dashboardPeriodSalesTotals(legacyRows.salesTransactions, legacyRows.salesItems, new Map(), period, false).sales, 35);
    assert.deepEqual(managed.salesTransactions.map(row => row.invoice_number), ["OWNER-65", "MANAGER-120", "STAFF-180", "LEGACY-35"]);
    const ledger = buildCustomerLedger({
      ...managed,
      customers: [{ id: owner, customer_name: "Fixture customer" }],
      products: [],
      customerPayments: [
        { id: "pay-1", customer_id: owner, amount: 15 },
        { id: "pay-2", customer_id: owner, amount: 25 },
        { id: "voided", customer_id: owner, amount: 50, voided_at: day },
      ],
      customerPaymentAllocations: [
        { customer_payment_id: "pay-1", sales_transaction_id: own, amount: 15 },
        { customer_payment_id: "pay-2", sales_transaction_id: staff, amount: 25 },
        { customer_payment_id: "voided", sales_transaction_id: staff, amount: 50 },
      ],
    });
    assert.equal(ledger.totals.totalOutstanding, 210);
    const purchases = await as(own, () => db.query<DashboardSalesData["purchaseTransactions"][number]>(
      "select * from purchase_transactions order by id"
    ));
    const csvRows = buildDashboardActivityCsvRows({
      sales: managed.salesTransactions,
      purchases: purchases.rows,
      org,
      range: period,
      timeZone: "UTC",
      currency: "EUR",
      customerNames: new Map([[owner, "Fixture customer"]]),
      supplierNames: new Map([[owner, "Fixture supplier"]]),
    });
    assert.deepEqual(csvRows.map(row => [row[1], row[2], row[4]]), [
      ["purchase", "PURCHASE-80", 80], ["purchase", "PURCHASE-250", 250],
      ["sale", "LEGACY-35", 35], ["sale", "STAFF-180", 180],
      ["sale", "MANAGER-120", 120], ["sale", "OWNER-65", 65],
    ]);

    const grants = { profile_id: own, organization_id: org, dashboard_view: true, dashboard_export: true, granted_sections: ["profit-loss"] };
    assert.deepEqual(resolveDashboardAccess({ id: own, role: "manager" }, org, grants), { ownerOrAdmin: false, view: true, profit: true, export: true });
    assert.equal(resolveDashboardAccess({ id: staff, role: "salesman" }, org, grants).view, false);
    assert.equal(resolveDashboardAccess({ id: own, role: "manager", is_active: false }, org, grants).view, false);
    assert.equal(resolveDashboardAccess({ id: own, role: "manager" }, org, { ...grants, dashboard_view: false }).export, false);
    assert.equal(resolveDashboardAccess({ id: own, role: "manager" }, org, { ...grants, granted_sections: [] }).profit, false);
    assert.equal(resolveDashboardAccess({ id: own, role: "manager" }, org, { ...grants, dashboard_export: false }).export, false);
    assert.equal(resolveDashboardAccess({ id: admin, role: "admin" }, org, null).export, true);
    for (const person of [own, viewOnly]) {
      await as(person, async () => {
        for (const statement of [
          `update sales_transactions set total_amount=500 where id='${staff}' returning id`,
          `update sales_orders set created_by_profile_id='${person}' where id='${staff}' returning id`,
          `update sales_returns set status='cancelled' where id='${staffReturn}' returning id`,
          "update sales_return_items set quantity=50 where id=13 returning id",
          "delete from sales_return_items where id=13 returning id",
          `delete from sales_returns where id='${staffReturn}' returning id`,
          `update staff_permissions set dashboard_export=true where profile_id='${person}' returning profile_id`,
        ]) assert.equal((await db.query(statement)).rows.length, 0);
      });
      await assert.rejects(as(person, () => db.query("insert into sales_return_items values (19,$1,1,1,0)", [staffReturn])), /row-level security/);
      await assert.rejects(as(person, () => db.query("insert into sales_returns values ($1,$2,$3,$4,'confirmed')", [orderId(99), org, person, staff])), /row-level security/);
    }
    for (const person of [owner, admin, own]) {
      await as(person, async () => {
        assert.equal((await db.query("update sales_return_items set quantity=2 where id=12 returning id")).rows.length, 1);
      });
    }
    await db.query("update staff_permissions set dashboard_view=false where profile_id=$1 and organization_id=$2", [own, org]);
    assert.deepEqual(await read(own), oldReads.get(own), "view revocation falls back to the original own scope");
    console.log("Manager dashboard RLS: 4 org sales €400, profit €225, receivables €210; CSV 4 sales €400 + 2 purchases €330; ungranted staff €180, ungranted manager €35; owner/admin and write scopes preserved.");
  } finally {
    await db.close();
  }
}
