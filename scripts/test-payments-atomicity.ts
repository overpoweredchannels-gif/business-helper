import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const owner = "20000000-0000-4000-8000-000000000001";
const owner2 = "20000000-0000-4000-8000-000000000002";
const employee = "20000000-0000-4000-8000-000000000003";
const staffPayments = "20000000-0000-4000-8000-000000000004";
const staffSections = "20000000-0000-4000-8000-000000000005";
const staffCustomRole = "20000000-0000-4000-8000-000000000006";
const otherOwner = "20000000-0000-4000-8000-000000000007";
const creditCustomer = "30000000-0000-4000-8000-000000000001";
const cashCustomer = "30000000-0000-4000-8000-000000000002";
const otherOrgCustomer = "30000000-0000-4000-8000-000000000003";
const supplier = "30000000-0000-4000-8000-000000000004";
const otherOrgSupplier = "30000000-0000-4000-8000-000000000005";
const inv1 = "60000000-0000-4000-8000-000000000001";
const inv2 = "60000000-0000-4000-8000-000000000002";
const inv3 = "60000000-0000-4000-8000-000000000003";
const cashInv = "60000000-0000-4000-8000-000000000004";
const cancelledInv = "60000000-0000-4000-8000-000000000005";
const pur1 = "60000000-0000-4000-8000-000000000011";
const pur2 = "60000000-0000-4000-8000-000000000012";

type PaymentResult = {
  payment_id: string;
  kind: string;
  party_id: string;
  amount: string;
  allocated_amount: string;
  unapplied_amount: string;
  replayed: boolean;
};

async function main() {
  const db = new PGlite();
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
      -- In real Supabase the authenticated role can call auth.jwt(); the
      -- fixture must grant it, or every RLS policy evaluation fails.
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant execute on function auth.jwt() to authenticated;
      -- Minimal current_org_id() stub, same claim resolution as
      -- production_upgrade_consolidated.sql (the migration's RLS policies
      -- reference it; the RPC itself resolves the org from profiles).
      create function public.current_org_id() returns uuid language sql stable as $$
        select coalesce(
          nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', ''),
          nullif(auth.jwt() -> 'user_metadata' ->> 'organization_id', ''),
          nullif(auth.jwt() ->> 'organization_id', '')
        )::uuid;
      $$;
      create table organizations(id uuid primary key);
      create table profiles(id uuid primary key, organization_id uuid not null, role text not null, is_active boolean default true);
      create table staff_permissions(profile_id uuid not null, organization_id uuid not null, granted_sections text[] default '{}', can_manage_payments boolean default false, can_create_sales boolean default false, primary key(profile_id, organization_id));
      create table role_definitions(id text not null, organization_id uuid not null, name text, description text, permissions jsonb not null default '[]'::jsonb, is_built_in boolean default false, created_at timestamptz default now(), primary key(organization_id, id));
      create table customers(id uuid primary key, organization_id uuid not null, customer_name text not null, is_active boolean default true, outstanding_balance numeric(14,2) not null default 0, updated_at timestamptz default now());
      create table suppliers(id uuid primary key, organization_id uuid not null, supplier_name text not null, is_active boolean default true, outstanding_balance numeric(14,2) not null default 0, updated_at timestamptz default now());
      create table sales_transactions(
        id uuid primary key, organization_id uuid not null, customer_id uuid not null,
        invoice_number text not null, sale_date date, payment_type text, credit_due_date date,
        total_amount numeric(14,2), discount_amount numeric(14,2) default 0, tax_rate numeric(5,2) default 0,
        tax_amount numeric(14,2) default 0, status text, invoice_type text,
        created_by_profile_id uuid, created_at timestamptz default now()
      );
      create table sales_items(
        id uuid primary key default gen_random_uuid(), sales_transaction_id uuid not null references sales_transactions(id),
        product_id uuid not null, quantity numeric(14,2) not null, selling_price numeric(14,2) not null,
        discount numeric(14,2) not null default 0, unit_mode text default 'main', organization_id uuid not null
      );
      create table sales_returns(id uuid primary key, organization_id uuid not null, sales_transaction_id uuid not null, status text);
      create table sales_return_items(id uuid primary key default gen_random_uuid(), sales_return_id uuid not null, quantity numeric(14,2) not null, unit_price numeric(14,2) not null, discount numeric(14,2) not null default 0);
      create table purchase_transactions(
        id uuid primary key, organization_id uuid not null, supplier_id uuid not null,
        invoice_number text, purchase_date date, payment_type text, total_amount numeric(14,2),
        status text, created_at timestamptz default now()
      );
      create table purchase_items(
        id uuid primary key default gen_random_uuid(), purchase_transaction_id uuid not null references purchase_transactions(id),
        organization_id uuid not null, product_id uuid not null, quantity numeric(14,2) not null, purchase_price numeric(14,2) not null
      );
      create table purchase_returns(id uuid primary key, organization_id uuid not null, purchase_transaction_id uuid not null, status text);
      create table purchase_return_items(id uuid primary key default gen_random_uuid(), purchase_return_id uuid not null, quantity numeric(14,2) not null, unit_price numeric(14,2) not null);
      create table customer_payments(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, customer_id uuid not null,
        amount numeric(14,2) not null, payment_date date, payment_method text, notes text
      );
      create table supplier_payments(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, supplier_id uuid not null,
        amount numeric(14,2) not null, payment_date date, payment_method text, notes text
      );
      create table customer_payment_allocations(
        id uuid primary key default gen_random_uuid(), customer_payment_id uuid not null references customer_payments(id),
        sales_transaction_id uuid not null references sales_transactions(id), amount numeric(14,2) not null, organization_id uuid not null
      );
      create table supplier_payment_allocations(
        id uuid primary key default gen_random_uuid(), supplier_payment_id uuid not null references supplier_payments(id),
        purchase_transaction_id uuid not null references purchase_transactions(id), amount numeric(14,2) not null, organization_id uuid not null
      );
      create table audit_logs(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, actor_profile_id uuid,
        action text, entity_type text, entity_id uuid, entity_label text, description text, new_values jsonb,
        created_at timestamptz default now()
      );
      -- In real Supabase the authenticated role holds table privileges and
      -- the RLS policies decide; the fixture must grant them, or every
      -- direct access fails before the policy is even evaluated.
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into organizations values('${org}'),('${otherOrg}');
      insert into profiles values
        ('${owner}','${org}','owner',true),
        ('${owner2}','${org}','owner',true),
        ('${employee}','${org}','employee',true),
        ('${staffPayments}','${org}','staff',true),
        ('${staffSections}','${org}','staff',true),
        ('${staffCustomRole}','${org}','custom-payments',true),
        ('${otherOwner}','${otherOrg}','owner',true);
      insert into staff_permissions values
        ('${staffPayments}','${org}','{}',true,false),
        ('${staffSections}','${org}',array['supplier-payments'],false,false);
      insert into role_definitions(id,organization_id,name,permissions,is_built_in) values
        ('custom-payments','${org}','Payments Clerk','["payments_manage"]'::jsonb,false);
      insert into customers values
        ('${creditCustomer}','${org}','Credit Customer',true,100,now()),
        ('${cashCustomer}','${org}','Cash Customer',true,0,now()),
        ('${otherOrgCustomer}','${otherOrg}','Other Org Customer',true,0,now());
      insert into suppliers values
        ('${supplier}','${org}','Main Supplier',true,80,now()),
        ('${otherOrgSupplier}','${otherOrg}','Other Org Supplier',true,0,now());
      insert into sales_transactions(id,organization_id,customer_id,invoice_number,sale_date,payment_type,total_amount,status,invoice_type,created_by_profile_id)
        values('${inv1}','${org}','${creditCustomer}','S-100001',current_date-10,'credit',100,'confirmed','sales','${owner}'),
              ('${inv2}','${org}','${creditCustomer}','S-100002',current_date-5,'credit',50,'confirmed','sales','${owner}'),
              ('${inv3}','${org}','${creditCustomer}','S-100003',current_date-3,'credit',0,'confirmed','sales','${owner}'),
              ('${cashInv}','${org}','${creditCustomer}','S-100004',current_date-2,'cash',30,'paid','sales','${owner}'),
              ('${cancelledInv}','${org}','${creditCustomer}','S-100005',current_date-1,'credit',40,'cancelled','sales','${owner}');
      insert into sales_items(sales_transaction_id,product_id,quantity,selling_price,organization_id)
        values('${inv3}','40000000-0000-4000-8000-000000000001',1,25,'${org}');
      insert into sales_returns(id,organization_id,sales_transaction_id,status)
        values('70000000-0000-4000-8000-000000000001','${org}','${inv1}','confirmed');
      insert into sales_return_items(sales_return_id,quantity,unit_price,discount)
        values('70000000-0000-4000-8000-000000000001',1,10,0);
      insert into purchase_transactions(id,organization_id,supplier_id,invoice_number,purchase_date,payment_type,total_amount,status)
        values('${pur1}','${org}','${supplier}','P-100001',current_date-10,'credit',40,'confirmed'),
              ('${pur2}','${org}','${supplier}','P-100002',current_date-5,'credit',30,'confirmed');
      insert into purchase_items(purchase_transaction_id,organization_id,product_id,quantity,purchase_price)
        values('${pur1}','${org}','40000000-0000-4000-8000-000000000001',2,20),
              ('${pur2}','${org}','40000000-0000-4000-8000-000000000001',1,30);
      insert into purchase_returns(id,organization_id,purchase_transaction_id,status)
        values('70000000-0000-4000-8000-000000000002','${org}','${pur1}','confirmed');
      insert into purchase_return_items(purchase_return_id,quantity,unit_price)
        values('70000000-0000-4000-8000-000000000002',1,5);
      -- Legacy unallocated pools: 15 customer / 10 supplier. FIFO: invoice 1
      -- remaining 75 (100 - 10 returned - 15 pool), invoice 2 remaining 50,
      -- invoice 3 remaining 25 (line-derived total); purchase 1 remaining
      -- 25 (40 - 5 returned - 10 pool), purchase 2 remaining 30.
      insert into customer_payments(organization_id,customer_id,amount,payment_date,payment_method,notes)
        values('${org}','${creditCustomer}',15,current_date,'cash','legacy unallocated payment');
      insert into supplier_payments(organization_id,supplier_id,amount,payment_date,payment_method,notes)
        values('${org}','${supplier}',10,current_date,'cash','legacy unallocated payment');
    `);

    // The real migrations, loaded twice each: the files must be re-runnable.
    await db.exec(readFileSync("src/lib/migrations/production_phase14_atomic_payments.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase14_atomic_payments.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase15_card_void_reconcile.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase15_card_void_reconcile.sql", "utf8"));

    const objects = await db.query<{ name: string; kind: string }>(`
      select 'request_key column' name, 'column' kind from information_schema.columns
        where table_name = 'customer_payments' and column_name = 'request_key'
      union all select 'supplier request_key column', 'column' from information_schema.columns
        where table_name = 'supplier_payments' and column_name = 'request_key'
      union all select 'customer unique index', 'index' from pg_indexes
        where indexname = 'customer_payments_org_request_key_uidx'
      union all select 'supplier unique index', 'index' from pg_indexes
        where indexname = 'supplier_payments_org_request_key_uidx'
      union all select 'customer amount check', 'check' from pg_constraint
        where conname = 'customer_payments_amount_positive'
      union all select 'supplier amount check', 'check' from pg_constraint
        where conname = 'supplier_payments_amount_positive'
      union all select 'supplier payments RLS policy', 'policy' from pg_policies
        where tablename = 'supplier_payments' and policyname = 'supplier_payments_insert_org'
      union all select 'supplier allocations RLS policy', 'policy' from pg_policies
        where tablename = 'supplier_payment_allocations' and policyname = 'supplier_payment_allocations_insert_org'
      union all select 'create_payment_atomic', 'function' from pg_proc
        where proname = 'create_payment_atomic'
      union all select 'get_payment_request_status', 'function' from pg_proc
        where proname = 'get_payment_request_status'
      union all select 'payments_tool_allowed', 'function' from pg_proc
        where proname = 'payments_tool_allowed'`);
    assert.equal(objects.rows.length, 11, `Migration creates all 11 objects, got ${objects.rows.map((r) => r.name).join(", ")}`);

    const objects15 = await db.query<{ name: string }>(`
      select 'customer method check' name from pg_constraint where conname = 'customer_payments_payment_method_check'
      union all select 'supplier method check' from pg_constraint where conname = 'supplier_payments_payment_method_check'
      union all select 'customer reference column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'reference'
      union all select 'supplier reference column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'reference'
      union all select 'customer voided_at column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'voided_at'
      union all select 'supplier voided_at column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'voided_at'
      union all select 'customer voided_by column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'voided_by_profile_id'
      union all select 'supplier voided_by column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'voided_by_profile_id'
      union all select 'customer void_reason column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'void_reason'
      union all select 'supplier void_reason column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'void_reason'
      union all select 'customer void_request_key column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'void_request_key'
      union all select 'supplier void_request_key column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'void_request_key'
      union all select 'customer void_request_fingerprint column' from information_schema.columns where table_name = 'customer_payments' and column_name = 'void_request_fingerprint'
      union all select 'supplier void_request_fingerprint column' from information_schema.columns where table_name = 'supplier_payments' and column_name = 'void_request_fingerprint'
      union all select 'customer void key index' from pg_indexes where indexname = 'customer_payments_org_void_key_uidx'
      union all select 'supplier void key index' from pg_indexes where indexname = 'supplier_payments_org_void_key_uidx'
      union all select 'payment_derived_outstanding' from pg_proc where proname = 'payment_derived_outstanding'
      union all select 'void_payment_atomic' from pg_proc where proname = 'void_payment_atomic'
      union all select 'reconcile_outstanding_balances' from pg_proc where proname = 'reconcile_outstanding_balances'
      union all select 'correct_outstanding_balance_atomic' from pg_proc where proname = 'correct_outstanding_balance_atomic'`);
    assert.equal(objects15.rows.length, 20, `Phase 15 creates all 20 objects, got ${objects15.rows.map((r) => r.name).join(", ")}`);

    const setActor = (actor: string | null, orgId: string | null = org) =>
      db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
        [actor ?? "", orgId ? JSON.stringify({ app_metadata: { organization_id: orgId } }) : "{}"]);
    const create = async (
      requestKey: string,
      kind: "customer" | "supplier",
      partyId: string,
      amount: number | null,
      allocations: Array<{ invoice_id: string; amount: number }> = [],
      actor = owner,
      method = "cash",
      reference: string | null = null,
    ) => {
      await setActor(actor);
      return (await db.query<{ result: PaymentResult }>(
        "select public.create_payment_atomic($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) as result",
        [requestKey, kind, partyId, amount, null, method, null, JSON.stringify(allocations), reference],
      )).rows[0].result;
    };
    const voidPayment = async (
      requestKey: string,
      kind: "customer" | "supplier",
      paymentId: string,
      actor = owner,
      reason: string | null = null,
    ) => {
      await setActor(actor);
      return (await db.query<{ result: { payment_id: string; kind: string; voided: boolean; replayed: boolean; restored_balance: string; restored_from: string } }>(
        "select public.void_payment_atomic($1,$2,$3,$4) as result",
        [requestKey, kind, paymentId, reason],
      )).rows[0].result;
    };
    const derived = async (kind: "customer" | "supplier", partyId: string, actor = owner) => {
      await setActor(actor);
      return Number((await db.query<{ v: string }>(
        "select public.payment_derived_outstanding($1,$2) as v", [kind, partyId],
      )).rows[0].v);
    };
    const reconcile = async (kind: "customer" | "supplier", actor = owner) => {
      await setActor(actor);
      return (await db.query<{ party_id: string; party_name: string; stored_balance: string; derived_balance: string; drift: string }>(
        "select * from public.reconcile_outstanding_balances($1)", [kind],
      )).rows.map((r) => ({ ...r, stored_balance: Number(r.stored_balance), derived_balance: Number(r.derived_balance), drift: Number(r.drift) }));
    };
    const correct = async (
      requestKey: string,
      kind: "customer" | "supplier",
      partyId: string,
      actor = owner,
      reason: string | null = null,
    ) => {
      await setActor(actor);
      return (await db.query<{ result: { party_id: string; kind: string; corrected: boolean; replayed: boolean; stored_before: string; stored_after: string; derived: string } }>(
        "select public.correct_outstanding_balance_atomic($1,$2,$3,$4) as result",
        [requestKey, kind, partyId, reason],
      )).rows[0].result;
    };
    const status = async (requestKey: string, kind: "customer" | "supplier", actor = owner) => {
      await setActor(actor);
      return (await db.query<{ result: { status: string; result?: PaymentResult } }>(
        "select public.get_payment_request_status($1,$2) as result", [requestKey, kind],
      )).rows[0].result;
    };
    const snapshot = async () => {
      const row = (await db.query<{
        customer_payments: number; supplier_payments: number;
        customer_allocations: number; supplier_allocations: number; audits: number;
        customer_balance: string; supplier_balance: string;
      }>(`select
        (select count(*)::int from customer_payments) customer_payments,
        (select count(*)::int from supplier_payments) supplier_payments,
        (select count(*)::int from customer_payment_allocations) customer_allocations,
        (select count(*)::int from supplier_payment_allocations) supplier_allocations,
        (select count(*)::int from audit_logs) audits,
        (select outstanding_balance from customers where id='${creditCustomer}') customer_balance,
        (select outstanding_balance from suppliers where id='${supplier}') supplier_balance`)).rows[0];
      return { ...row, customer_balance: Number(row.customer_balance), supplier_balance: Number(row.supplier_balance) };
    };
    const key = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

    // T5 (positive permission controls, on a party with no invoices so the
    // arithmetic stays clean): staff with can_manage_payments, staff with
    // the supplier-payments section, and staff with a custom role granting
    // payments_manage can all write through the RPC.
    const staffOk = await create(key(1), "customer", cashCustomer, 5, [], staffPayments);
    assert.equal(staffOk.replayed, false);
    const sectionOk = await create(key(2), "supplier", supplier, 5, [], staffSections);
    assert.equal(sectionOk.replayed, false);
    const customOk = await create(key(3), "customer", cashCustomer, 5, [], staffCustomRole);
    assert.equal(customOk.replayed, false);

    // T13 (permissions JSON shape matrix): the guarded predicate must grant
    // only when permissions is a JSON array containing 'payments_manage'.
    // A bare "?" without the jsonb_typeof guard would grant on an object
    // whose key exists even when its value is false.
    const matrixCases: Array<{ label: string; value: unknown; ok: boolean }> = [
      { label: "array with permission", value: ["payments_manage"], ok: true },
      { label: "array with permission among others", value: ["sales_view", "payments_manage"], ok: true },
      { label: "empty array", value: [], ok: false },
      { label: "array without permission", value: ["sales_view"], ok: false },
      { label: "object with false value", value: { payments_manage: false }, ok: false },
      { label: "object with true value", value: { payments_manage: true }, ok: false },
      { label: "empty object", value: {}, ok: false },
      { label: "bare string", value: "payments_manage", ok: false },
      { label: "number", value: 42, ok: false },
      { label: "boolean", value: true, ok: false },
      { label: "json null", value: null, ok: false },
      { label: "duplicated permission", value: ["payments_manage", "payments_manage"], ok: true },
      { label: "case-variant", value: ["Payments_Manage"], ok: false },
      { label: "non-string element plus permission", value: [42, "payments_manage"], ok: true },
    ];
    const matrixBefore = await snapshot();
    let matrixOk = 0;
    for (let i = 0; i < matrixCases.length; i++) {
      const c = matrixCases[i];
      const roleId = `matrix-${i}`;
      const actorId = `21000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await db.query(
        "insert into role_definitions(id,organization_id,name,permissions,is_built_in) values ($1,$2,$3,$4::jsonb,false)",
        [roleId, org, `Matrix ${i}`, JSON.stringify(c.value)],
      );
      await db.query("insert into profiles values ($1,$2,$3,true)", [actorId, org, roleId]);
      if (c.ok) {
        const res = await create(key(100 + i), "customer", cashCustomer, 5, [], actorId);
        assert.equal(res.replayed, false, `matrix case ${i} (${c.label}) should succeed`);
        matrixOk++;
      } else {
        await assert.rejects(
          create(key(100 + i), "customer", cashCustomer, 5, [], actorId),
          /Payments permission/,
          `matrix case ${i} (${c.label}) should be denied`,
        );
      }
    }
    const matrixAfter = await snapshot();
    assert.equal(matrixOk, 4, "exactly 4 matrix cases should succeed");
    assert.equal(matrixAfter.customer_payments, matrixBefore.customer_payments + 4, "matrix success payments recorded");
    assert.equal(matrixAfter.audits, matrixBefore.audits + 4, "matrix success audits recorded");
    assert.equal(matrixAfter.customer_balance, matrixBefore.customer_balance, "matrix payments do not move the floored balance");

    // T1 unauthorized: no actor, and an employee with no payment grant.
    await assert.rejects(create(key(10), "customer", cashCustomer, 5, [], null as unknown as string), /Authenticated actor|Payments permission/);
    await assert.rejects(create(key(11), "customer", cashCustomer, 5, [], employee), /Payments permission/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.create_payment_atomic($1,'customer',$2,5,null,'cash',null,'[]'::jsonb)",
      [key(12), cashCustomer]), /Payments permission|Authenticated actor/);
    await db.exec("reset role");

    // T2 cross-business party (both directions, both kinds).
    await assert.rejects(create(key(13), "customer", otherOrgCustomer, 5), /unavailable in this organization/);
    await assert.rejects(create(key(14), "supplier", otherOrgSupplier, 5), /unavailable in this organization/);
    await setActor(otherOwner, otherOrg);
    await assert.rejects(db.query("select public.create_payment_atomic($1,'customer',$2,5,null,'cash',null,'[]'::jsonb)",
      [key(15), creditCustomer]), /unavailable in this organization/);

    // T4 missing/invalid values: every rejection must write nothing.
    const beforeInvalid = await snapshot();
    const invalidCases: Array<{ label: string; run: () => Promise<unknown>; pattern: RegExp }> = [
      { label: "missing party", run: () => create(key(20), "customer", null as unknown as string, 5), pattern: /Authenticated actor|party/ },
      { label: "zero amount", run: () => create(key(21), "customer", cashCustomer, 0), pattern: /positive amount/ },
      { label: "negative amount", run: () => create(key(22), "customer", cashCustomer, -5), pattern: /positive amount/ },
      { label: "three-decimal amount", run: () => create(key(23), "customer", cashCustomer, 10.005), pattern: /two decimals/ },
      { label: "bad method", run: () => create(key(25), "customer", cashCustomer, 5, [], owner, "cheque"), pattern: /Invalid payment_method/ },
      { label: "negative allocation", run: () => create(key(26), "customer", creditCustomer, 10, [{ invoice_id: inv1, amount: -1 }]), pattern: /Invalid payment allocation/ },
      { label: "allocation over remaining", run: () => create(key(27), "customer", creditCustomer, 100, [{ invoice_id: inv1, amount: 76 }]), pattern: /remaining balance/ },
      { label: "allocations over amount", run: () => create(key(28), "customer", creditCustomer, 10, [{ invoice_id: inv1, amount: 11 }]), pattern: /exceed the payment amount/ },
      { label: "duplicate invoice", run: () => create(key(29), "customer", creditCustomer, 10, [{ invoice_id: inv1, amount: 1 }, { invoice_id: inv1, amount: 1 }]), pattern: /Duplicate allocation/ },
      { label: "cash invoice", run: () => create(key(30), "customer", creditCustomer, 10, [{ invoice_id: cashInv, amount: 1 }]), pattern: /unavailable for this payment/ },
      { label: "cancelled invoice", run: () => create(key(31), "customer", creditCustomer, 10, [{ invoice_id: cancelledInv, amount: 1 }]), pattern: /unavailable for this payment/ },
      { label: "other-org invoice", run: () => create(key(32), "customer", creditCustomer, 10, [{ invoice_id: inv1, amount: 1 }], otherOwner), pattern: /unavailable in this organization|Payments permission/ },
      { label: "supplier allocation over remaining", run: () => create(key(33), "supplier", supplier, 100, [{ invoice_id: pur1, amount: 26 }]), pattern: /remaining balance/ },
    ];
    for (const invalid of invalidCases) {
      await assert.rejects(invalid.run, invalid.pattern, invalid.label);
    }
    // T11: failures write nothing.
    assert.deepEqual(await snapshot(), beforeInvalid, "All invalid submissions write nothing");

    // Allocated customer payment: 50 with 40 on invoice 1 and 10 on
    // invoice 2. Stored balance falls by the full 50 (100 -> 50).
    const allocated = await create(key(40), "customer", creditCustomer, 50,
      [{ invoice_id: inv1, amount: 40 }, { invoice_id: inv2, amount: 10 }]);
    assert.equal(Number(allocated.allocated_amount), 50);
    assert.equal(Number(allocated.unapplied_amount), 0);
    assert.equal(allocated.replayed, false);
    let state = await snapshot();
    assert.equal(state.customer_balance, 50, "Stored outstanding falls by the full payment amount");
    assert.equal(state.customer_allocations, 2);
    assert.equal((await db.query<{ action: string }>("select action from audit_logs order by created_at desc limit 1")).rows[0].action, "allocated");

    // Under-allocated payment: 20 with 5 on invoice 2 leaves 15 unapplied;
    // the stored balance still falls by the full 20 (50 -> 30).
    const under = await create(key(41), "customer", creditCustomer, 20, [{ invoice_id: inv2, amount: 5 }]);
    assert.equal(Number(under.allocated_amount), 5);
    assert.equal(Number(under.unapplied_amount), 15);
    state = await snapshot();
    assert.equal(state.customer_balance, 30);

    // Supplier payment: 25 with 20 on purchase 1 (remaining 25).
    const supplierPaid = await create(key(42), "supplier", supplier, 25, [{ invoice_id: pur1, amount: 20 }]);
    assert.equal(Number(supplierPaid.allocated_amount), 20);
    assert.equal(Number(supplierPaid.unapplied_amount), 5);
    state = await snapshot();
    assert.equal(state.supplier_balance, 50, "Supplier stored outstanding falls by the full payment amount (80 - 5 staff check - 25)");
    assert.equal(state.supplier_allocations, 1);

    // T6 concurrent duplicate requests: one payment, one allocation set.
    state = await snapshot();
    const duplicateResults = await Promise.all([
      create(key(50), "customer", cashCustomer, 10),
      create(key(50), "customer", cashCustomer, 10),
    ]);
    assert.equal(duplicateResults[0].payment_id, duplicateResults[1].payment_id);
    assert.equal((await snapshot()).customer_payments, state.customer_payments + 1, "Concurrent identical submissions create one payment");

    // T7 retry after a lost response: same key replays; a different body
    // under the same key is rejected and the original is untouched.
    const lost = await create(key(51), "customer", cashCustomer, 12);
    const replay = await create(key(51), "customer", cashCustomer, 12);
    assert.equal(replay.replayed, true);
    assert.equal(replay.payment_id, lost.payment_id);
    await assert.rejects(create(key(51), "customer", cashCustomer, 13), /different payment/);
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from customer_payments where request_key=$1", [key(51)])).rows[0].n, 1);

    // T8 failure partway through: an injected failing CHECK on each write
    // target must roll the whole payment back (T11: nothing written).
    state = await snapshot();
    await db.exec("alter table customer_payment_allocations add constraint fail_payment_allocation check(amount < 0) not valid");
    await assert.rejects(create(key(60), "customer", creditCustomer, 10, [{ invoice_id: inv2, amount: 5 }]), /fail_payment_allocation/);
    await db.exec("alter table customer_payment_allocations drop constraint fail_payment_allocation");
    await db.exec("alter table audit_logs add constraint fail_payment_audit check(action <> 'created') not valid");
    await assert.rejects(create(key(61), "customer", cashCustomer, 10), /fail_payment_audit/);
    await db.exec("alter table audit_logs drop constraint fail_payment_audit");
    await db.exec("alter table customer_payments add constraint fail_payment_row check(amount < 0) not valid");
    await assert.rejects(create(key(62), "customer", cashCustomer, 10), /fail_payment_row/);
    await db.exec("alter table customer_payments drop constraint fail_payment_row");
    assert.deepEqual(await snapshot(), state, "Mid-write failures roll back payment, allocations, balance, and audit");

    // T9 two genuinely distinct payments with identical details.
    state = await snapshot();
    const first = await create(key(70), "customer", cashCustomer, 10);
    const second = await create(key(71), "customer", cashCustomer, 10);
    assert.notEqual(first.payment_id, second.payment_id);
    assert.equal((await snapshot()).customer_payments, state.customer_payments + 2, "Identical details under different keys are two payments");

    // T14 card payments + reference (phase 15): card is a valid method and
    // the reference is stored; cheque is recorded as method 'other'.
    state = await snapshot();
    const cardPaid = await create(key(80), "customer", creditCustomer, 20, [{ invoice_id: inv1, amount: 10 }], owner, "card", "1234");
    assert.equal(cardPaid.replayed, false);
    const cardRow = (await db.query<{ payment_method: string; reference: string }>("select payment_method, reference from customer_payments where id=$1", [cardPaid.payment_id])).rows[0];
    assert.equal(cardRow.payment_method, "card", "Card payment stores method 'card'");
    assert.equal(cardRow.reference, "1234", "Card payment stores the reference (last 4 digits)");
    assert.equal((await snapshot()).customer_balance, state.customer_balance - 20, "Card payment falls the stored balance by the full amount");
    const chequePaid = await create(key(81), "customer", cashCustomer, 7, [], owner, "other", "CHQ-99");
    const chequeRow = (await db.query<{ payment_method: string; reference: string }>("select payment_method, reference from customer_payments where id=$1", [chequePaid.payment_id])).rows[0];
    assert.equal(chequeRow.payment_method, "other", "Cheque is recorded as method 'other'");
    assert.equal(chequeRow.reference, "CHQ-99", "Cheque number is stored as the reference");

    // T15 void (phase 15): voiding restores the balance and frees the
    // allocation; the rows stay (marked voided, not deleted).
    const beforeVoid = await snapshot();
    const toVoid = await create(key(90), "customer", creditCustomer, 10, [{ invoice_id: inv2, amount: 5 }]);
    assert.equal(Number(toVoid.allocated_amount), 5);
    const afterCreate = await snapshot();
    const voided = await voidPayment(key(91), "customer", toVoid.payment_id, owner, "Wrong amount");
    assert.equal(voided.voided, true);
    assert.equal(voided.replayed, false);
    assert.equal(Number(voided.restored_balance), beforeVoid.customer_balance, "Void restores the balance recorded before the payment");
    assert.equal(voided.restored_from, "recorded");
    const afterVoid = await snapshot();
    assert.equal(afterVoid.customer_balance, beforeVoid.customer_balance, "Void returns the stored balance to the pre-payment value");
    assert.equal(afterVoid.customer_payments, afterCreate.customer_payments, "Void keeps the payment row (marked voided, not deleted)");
    assert.equal(afterVoid.customer_allocations, afterCreate.customer_allocations, "Void keeps the allocation rows (excluded by the void check, not deleted)");
    // The voided allocation no longer counts: the same amount can be
    // allocated again on the same invoice.
    const reallocated = await create(key(92), "customer", creditCustomer, 5, [{ invoice_id: inv2, amount: 5 }]);
    assert.equal(Number(reallocated.allocated_amount), 5, "Voided allocation frees the invoice remaining");
    const voidReplay = await voidPayment(key(91), "customer", toVoid.payment_id, owner, "Wrong amount");
    assert.equal(voidReplay.replayed, true, "Same void key replays");
    await assert.rejects(voidPayment(key(93), "customer", toVoid.payment_id, owner, "Wrong amount"), /already voided/);
    await assert.rejects(voidPayment(key(94), "customer", toVoid.payment_id, employee, "Wrong amount"), /Payments permission/);
    await setActor(otherOwner, otherOrg);
    const foreign = (await db.query<{ result: PaymentResult }>(
      "select public.create_payment_atomic($1,'customer',$2,5,null,'cash',null,'[]'::jsonb,null) as result",
      [key(95), otherOrgCustomer],
    )).rows[0].result;
    await setActor(owner);
    await assert.rejects(voidPayment(key(96), "customer", foreign.payment_id, owner, "Wrong org"), /unavailable in this organization/);

    // T16 reconcile + correct (phase 15): drift is reported, never
    // silently repaired; correction is explicit, audited, idempotent.
    await db.query("update customers set outstanding_balance = 200 where id=$1", [creditCustomer]);
    const driftRows = await reconcile("customer");
    const creditRow = driftRows.find((r) => r.party_id === creditCustomer);
    assert.ok(creditRow, "Drifted customer appears in the reconciliation");
    assert.equal(creditRow.stored_balance, 200);
    assert.equal(creditRow.derived_balance, await derived("customer", creditCustomer));
    assert.equal(creditRow.drift, 200 - creditRow.derived_balance);
    const corrected = await correct(key(120), "customer", creditCustomer, owner, "Balance check 2026-11-09");
    assert.equal(corrected.corrected, true);
    assert.equal(Number(corrected.stored_after), creditRow.derived_balance);
    assert.equal((await reconcile("customer")).find((r) => r.party_id === creditCustomer), undefined, "Corrected customer leaves the reconciliation");
    const correctReplay = await correct(key(120), "customer", creditCustomer, owner, "Balance check 2026-11-09");
    assert.equal(correctReplay.replayed, true, "Same correction key replays");
    const noop = await correct(key(121), "customer", creditCustomer, owner, "Balance check 2026-11-09");
    assert.equal(noop.corrected, false, "Correcting a clean balance is a no-op, not an error");
    await assert.rejects(correct(key(122), "customer", creditCustomer, employee), /Payments permission/);
    await db.query("update suppliers set outstanding_balance = 100 where id=$1", [supplier]);
    const supplierDrift = (await reconcile("supplier")).find((r) => r.party_id === supplier);
    assert.ok(supplierDrift, "Drifted supplier appears in the reconciliation");
    const supplierCorrected = await correct(key(123), "supplier", supplier, owner, "Balance check 2026-11-09");
    assert.equal(supplierCorrected.corrected, true);
    assert.equal((await reconcile("supplier")).find((r) => r.party_id === supplier), undefined);

    // Status function: unknown key, confirmed key, cross-org (no leak),
    // and another actor in the same org (rejected).
    assert.deepEqual(await status(key(99), "customer"), { status: "unknown" });
    const confirmed = await status(key(51), "customer");
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.result?.payment_id, lost.payment_id);
    const crossOrg = await status(key(51), "customer", otherOwner);
    assert.deepEqual(crossOrg, { status: "unknown" }, "A foreign org sees nothing for another org's key");
    await assert.rejects(status(key(51), "customer", owner2), /another actor/);

    // RLS proof (isolated DB, not a mock): as the authenticated role with
    // org-1 claims, direct table access is org-scoped — a foreign-org
    // insert is rejected and a foreign-org row is invisible.
    await setActor(owner, org);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("insert into supplier_payments(organization_id,supplier_id,amount,payment_method) values($1,$2,1,'cash')", [otherOrg, otherOrgSupplier]),
      /row-level security|violates/,
    );
    const visible = await db.query<{ n: number }>("select count(*)::int n from supplier_payments where organization_id=$1", [otherOrg]);
    assert.equal(visible.rows[0].n, 0, "Foreign-org rows are invisible to the authenticated role");
    await db.query("insert into supplier_payments(organization_id,supplier_id,amount,payment_method) values($1,$2,1,'cash')", [org, supplier]);
    await db.query("delete from supplier_payments where organization_id=$1 and amount=1 and payment_method='cash'", [org]);
    await db.exec("reset role");

    console.log("Atomic payment PostgreSQL tests passed: authorization, tenant scope, validation, remaining-balance rules, idempotency, replay, rollback, status, and supplier RLS.");
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
