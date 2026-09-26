import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAtomicSale, type AtomicSaleInput, type AtomicSaleResult } from "../src/lib/sales/atomic-sale-client";

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const owner = "20000000-0000-4000-8000-000000000001";
const employee = "20000000-0000-4000-8000-000000000002";
const otherOwner = "20000000-0000-4000-8000-000000000003";
const cashCustomer = "30000000-0000-4000-8000-000000000001";
const creditCustomer = "30000000-0000-4000-8000-000000000002";
const overdueCustomer = "30000000-0000-4000-8000-000000000003";
const product = "40000000-0000-4000-8000-000000000001";
const limitedProduct = "40000000-0000-4000-8000-000000000002";
const otherProduct = "40000000-0000-4000-8000-000000000003";
const cashProduct = "40000000-0000-4000-8000-000000000004";

async function testAtomicSaleClientRetry() {
  const values = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  try {
    const input: AtomicSaleInput = {
      customer_id: cashCustomer, sale_date: "2026-09-26", payment_type: "cash",
      invoice_discount: 0, invoice_discount_type: "flat", tax_rate: 0, cash_received: 10,
      credit_override_confirmed: false,
      lines: [{ product_id: cashProduct, quantity: 1, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }],
    };
    const result: AtomicSaleResult = {
      transaction: { id: "sale-confirmed", invoice_number: "S-100001" },
      customer_name: "Cash Customer", items: [], replayed: false,
    };
    const requestIds: string[] = [];
    let createCount = 0;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "create_sales_invoice_atomic") {
          requestIds.push(String(args.p_request_id));
          createCount += 1;
          if (createCount === 1) throw new Error("simulated response timeout");
          return { data: result, error: null };
        }
        return { data: { status: "unknown" }, error: null };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(createAtomicSale(client, "org:actor", input), /status could not be confirmed/);
    assert.ok(values.size > 0, "Uncertain attempt stays in local storage");
    await createAtomicSale(client, "org:actor", input);
    assert.equal(requestIds[0], requestIds[1], "Retry keeps the same request identifier");
    assert.equal(values.size, 0, "Confirmed sale clears the pending request");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

type SaleResult = {
  transaction: { id: string; invoice_number: string; payment_type: string; total_amount: string; cash_received: string; change_due: string; credit_due_date: string | null };
  customer_name: string;
  items: Array<{ product_name: string; purchase_price_snapshot: string; inventory_bonus_main: string }>;
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
      create table organizations(id uuid primary key);
      create table profiles(id uuid primary key, organization_id uuid not null, role text not null, is_active boolean default true);
      create table customers(
        id uuid primary key, organization_id uuid not null, customer_name text not null,
        is_active boolean default true, credit_policy text default 'cash_only', credit_limit numeric default 0,
        credit_days integer default 0, allow_over_limit boolean default false, allow_overdue_sales boolean default false
      );
      create table products(
        id uuid primary key, organization_id uuid not null, name text not null, unit_type text default 'Case',
        subunit_type text default 'Piece', units_per_pack integer, current_stock numeric(14,2) not null default 0 check(current_stock >= 0),
        last_purchase_price numeric, is_active boolean default true, overselling_policy text default 'block', updated_at timestamptz default now()
      );
      create table invoice_sequences(organization_id uuid, invoice_type text, current_number bigint not null, primary key(organization_id, invoice_type));
      create function next_invoice_number(p_organization_id uuid, p_invoice_type text) returns bigint language plpgsql as $$
        declare v_next bigint;
        begin
          insert into invoice_sequences values(p_organization_id, p_invoice_type, 1)
          on conflict(organization_id,invoice_type) do update set current_number=invoice_sequences.current_number+1
          returning current_number into v_next;
          return v_next;
        end
      $$;
      create function sales_tool_allowed(p_org uuid, p_tool text) returns boolean language sql stable as $$
        select exists(select 1 from profiles where id=auth.uid() and organization_id=p_org and is_active is distinct from false and role in ('owner','admin'))
      $$;
      create table sales_transactions(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, customer_id uuid not null,
        invoice_number text not null, sale_date date, payment_type text, credit_due_date date,
        credit_limit_snapshot numeric, credit_days_snapshot integer, notes text, total_amount numeric(14,2),
        discount_amount numeric(14,2) default 0, tax_rate numeric(5,2) default 0, tax_amount numeric(14,2) default 0,
        status text, invoice_type text, created_by_profile_id uuid, created_at timestamptz default now()
      );
      create table sales_items(
        id uuid primary key default gen_random_uuid(), sales_transaction_id uuid not null references sales_transactions(id),
        product_id uuid not null references products(id), quantity numeric(14,2) not null, selling_price numeric(14,2) not null,
        purchase_price_snapshot numeric(14,2), discount numeric(14,2) not null default 0,
        bonus numeric(14,2) not null default 0, unit_mode text default 'main', organization_id uuid not null
      );
      create table inventory_transactions(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, product_id uuid not null,
        movement_type text, quantity_delta numeric(14,2), reason text, batch_number text, expiry_date date,
        reference_type text, reference_id uuid, created_by uuid, created_at timestamptz default now()
      );
      create function resolve_overselling_policy(p_org uuid,p_product uuid) returns text language sql stable as $$
        select coalesce(overselling_policy,'allow') from products where id=p_product and organization_id=p_org
      $$;
      create function inventory_sync_sale_item() returns trigger language plpgsql as $$ begin return coalesce(new,old); end $$;
      create table purchase_transactions(id uuid primary key, organization_id uuid not null, created_at timestamptz default now());
      create table purchase_items(
        id uuid primary key default gen_random_uuid(), purchase_transaction_id uuid not null references purchase_transactions(id),
        organization_id uuid not null, product_id uuid not null references products(id), purchase_price numeric(14,2), unit_mode text default 'main'
      );
      create table customer_payments(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, customer_id uuid not null references customers(id),
        amount numeric(14,2) not null check(amount > 0), payment_date date, payment_method text, notes text
      );
      create table customer_payment_allocations(
        id uuid primary key default gen_random_uuid(), customer_payment_id uuid not null references customer_payments(id),
        sales_transaction_id uuid not null references sales_transactions(id), amount numeric(14,2) not null check(amount > 0), organization_id uuid not null
      );
      create table audit_logs(
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, actor_profile_id uuid not null,
        action text, entity_type text, entity_id uuid, entity_label text, description text, new_values jsonb,
        created_at timestamptz default now()
      );
      insert into organizations values('${org}'),('${otherOrg}');
      insert into profiles values('${owner}','${org}','owner',true),('${employee}','${org}','employee',true),('${otherOwner}','${otherOrg}','owner',true);
      insert into customers values
        ('${cashCustomer}','${org}','Cash Customer',true,'cash_only',0,0,false,false),
        ('${creditCustomer}','${org}','Credit Customer',true,'limit_and_days',50,5,false,false),
        ('${overdueCustomer}','${org}','Overdue Customer',true,'days_only',0,10,false,false),
        ('30000000-0000-4000-8000-000000000004','${otherOrg}','Other Org Customer',true,'cash_only',0,0,false,false);
      insert into products values
        ('${product}','${org}','Main Product','Case','Piece',12,20,99,true,'block',now()),
        ('${limitedProduct}','${org}','Limited Product','Unit','Piece',1,3,10,true,'block',now()),
        ('${otherProduct}','${otherOrg}','Other Org Product','Unit','Piece',1,10,10,true,'block',now()),
        ('${cashProduct}','${org}','Cash Product','Unit','Piece',1,100,10,true,'block',now());
      insert into purchase_transactions(id,organization_id) values('50000000-0000-4000-8000-000000000001','${org}');
      insert into purchase_items(purchase_transaction_id,organization_id,product_id,purchase_price,unit_mode)
        values('50000000-0000-4000-8000-000000000001','${org}','${product}',2,'subunit');
      insert into sales_transactions(id,organization_id,customer_id,invoice_number,sale_date,payment_type,total_amount,status,invoice_type,created_by_profile_id,credit_due_date)
        values('60000000-0000-4000-8000-000000000001','${org}','${creditCustomer}','LEGACY-CREDIT',current_date-10,'credit',20,'confirmed','sales','${owner}',current_date+10),
              ('60000000-0000-4000-8000-000000000002','${org}','${overdueCustomer}','LEGACY-OVERDUE',current_date-20,'credit',10,'confirmed','sales','${owner}',current_date-1);
      insert into customer_payments(organization_id,customer_id,amount,payment_date,payment_method,notes)
        values('${org}','${creditCustomer}',15,current_date,'cash','legacy unallocated credit payment');
    `);

    await db.exec(readFileSync("src/lib/migrations/20260917_sales_bonus_stock.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase13_atomic_sales.sql", "utf8"));
    await db.exec(readFileSync("src/lib/migrations/production_phase13_atomic_sales.sql", "utf8"));

    const setActor = (actor = owner) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    const create = async (requestId: string, input: Record<string, unknown>, actor = owner) => {
      await setActor(actor);
      return (await db.query<{ result: SaleResult }>(
        "select public.create_sales_invoice_atomic($1,$2::jsonb) as result",
        [requestId, JSON.stringify(input)],
      )).rows[0].result;
    };
    const status = async (requestId: string, actor = owner) => {
      await setActor(actor);
      return (await db.query<{ result: { status: string; result?: SaleResult } }>(
        "select public.get_sales_invoice_request_status($1) as result", [requestId],
      )).rows[0].result;
    };
    const snapshot = async () => {
      const row = (await db.query<{
        invoices: number; items: number; movements: number; payments: number; allocations: number; audits: number;
        main_stock: string; limited_stock: string;
      }>(`select (select count(*)::int from sales_transactions) invoices,
        (select count(*)::int from sales_items) items,
        (select count(*)::int from inventory_transactions) movements,
        (select count(*)::int from customer_payments) payments,
        (select count(*)::int from customer_payment_allocations) allocations,
        (select count(*)::int from audit_logs) audits,
        (select current_stock from products where id='${product}') main_stock,
        (select current_stock from products where id='${limitedProduct}') limited_stock`)).rows[0];
      return { ...row, main_stock: Number(row.main_stock), limited_stock: Number(row.limited_stock) };
    };
    const base = (extra: Record<string, unknown> = {}) => ({
      customer_id: cashCustomer,
      sale_date: "2026-09-26",
      payment_type: "cash",
      invoice_discount: 0,
      invoice_discount_type: "flat",
      tax_rate: 0,
      cash_received: 10,
      credit_override_confirmed: false,
        lines: [{ product_id: cashProduct, quantity: 1, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }],
      ...extra,
    });

    const cash = await create("70000000-0000-4000-8000-000000000001", base({
      cash_received: 210,
      invoice_discount: 5,
      tax_rate: 10,
      lines: [{ product_id: product, quantity: 2, selling_price: 100, discount: 10, bonus: 1, unit_mode: "main" }],
    }));
    assert.equal(cash.transaction.invoice_number, "S-100001");
    assert.equal(Number(cash.transaction.total_amount), 203.5);
    assert.equal(Number(cash.transaction.cash_received), 210);
    assert.equal(Number(cash.transaction.change_due), 6.5);
    assert.equal(Number(cash.items[0].purchase_price_snapshot), 24, "Subunit purchase cost snapshot is normalized to main units");
    assert.equal(Number(cash.items[0].inventory_bonus_main), 1);
    let state = await snapshot();
    assert.deepEqual(state, { invoices: 3, items: 1, movements: 1, payments: 2, allocations: 1, audits: 1, main_stock: 17, limited_stock: 3 });
    assert.deepEqual((await db.query<{ amount: string }>("select amount from customer_payments where customer_id=$1 and notes like 'Payment received against invoice%'", [cashCustomer])).rows.map(row => Number(row.amount)), [203.5]);
    assert.equal(Number((await db.query<{ amount: string }>("select amount from customer_payment_allocations a join sales_transactions s on s.id=a.sales_transaction_id where s.id=$1", [cash.transaction.id])).rows[0]?.amount ?? 0), 203.5);

    const replay = await create("70000000-0000-4000-8000-000000000001", base({
      cash_received: 210, invoice_discount: 5, tax_rate: 10,
      lines: [{ product_id: product, quantity: 2, selling_price: 100, discount: 10, bonus: 1, unit_mode: "main" }],
    }));
    assert.equal(replay.replayed, true);
    assert.equal(replay.transaction.id, cash.transaction.id);
    assert.deepEqual(await snapshot(), state, "Identical retry does not duplicate any record or stock movement");
    await assert.rejects(create("70000000-0000-4000-8000-000000000001", base({ cash_received: 11 })), /different sale contents/);

    const exact = await create("70000000-0000-4000-8000-000000000002", base({ cash_received: 10 }));
    assert.equal(Number(exact.transaction.change_due), 0, "Exact tender produces zero change");
    const excess = await create("70000000-0000-4000-8000-000000000003", base({ cash_received: 15 }));
    assert.equal(Number(excess.transaction.change_due), 5, "Excess tender records change due");
    const subunit = await create("70000000-0000-4000-8000-000000000004", base({
      customer_id: cashCustomer, cash_received: 20,
      lines: [{ product_id: product, quantity: 12, selling_price: 1, discount: 0, bonus: 6, unit_mode: "subunit" }],
    }));
    assert.equal(Number(subunit.items[0].inventory_bonus_main), 0.5);
    assert.equal(Number((await db.query<{ current_stock: string }>("select current_stock from products where id=$1", [product])).rows[0].current_stock), 15.5);

    state = await snapshot();
    for (const [key, input] of [
      ["70000000-0000-4000-8000-000000000011", base({ cash_received: 0 })],
      ["70000000-0000-4000-8000-000000000012", base({ cash_received: 9.99 })],
    ] as const) {
      await assert.rejects(create(key, input), /less than the sale total/);
    }
    const exactNoTenderField = await create("70000000-0000-4000-8000-000000000010", base({ cash_received: null }));
    assert.equal(Number(exactNoTenderField.transaction.cash_received), 10, "Advanced cash invoice without a tender field is treated as exact payment");
    state = await snapshot();
    await assert.rejects(create("70000000-0000-4000-8000-000000000013", base({ lines: [{ product_id: limitedProduct, quantity: 0, selling_price: 10 }] })), /Invalid quantity/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000014", base({ invoice_discount: 11 })), /Invalid invoice discount/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000015", base({ tax_rate: 1000 })), /Invalid invoice discount or tax rate/);
    assert.deepEqual(await snapshot(), state, "Blank/zero/short cash and invalid sale inputs write nothing");

    const creditInput = base({
      customer_id: creditCustomer, payment_type: "credit", cash_received: 0, tax_rate: 0,
      lines: [{ product_id: product, quantity: 4, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }],
    });
    const credit = await create("70000000-0000-4000-8000-000000000020", creditInput);
    assert.equal(credit.transaction.credit_due_date, "2026-10-01");
    assert.equal(Number(credit.transaction.total_amount), 40);
    await assert.rejects(create("70000000-0000-4000-8000-000000000021", { ...creditInput, lines: [{ ...creditInput.lines[0], quantity: 10 }] }), /credit limit exceeded/);
    await db.query("update customers set allow_over_limit=true where id=$1", [creditCustomer]);
    const creditOverride = await create("70000000-0000-4000-8000-000000000021", { ...creditInput, credit_override_confirmed: true, lines: [{ ...creditInput.lines[0], quantity: 10 }] });
    assert.equal(Number(creditOverride.transaction.total_amount), 100);
    const creditBalance = (await db.query<{ balance: string }>(`select sum(total_amount) - 15 as balance from sales_transactions where customer_id=$1 and payment_type='credit'`, [creditCustomer])).rows[0].balance;
    assert.equal(Number(creditBalance), 145, "Credit balance includes prior invoice net of unallocated payment plus new invoices");
    assert.equal((await db.query("select id from customer_payments where customer_id=$1 and notes like 'Payment received against invoice%'", [creditCustomer])).rows.length, 0, "Credit sale creates no cash payment");

    const overdueInput = base({
      customer_id: overdueCustomer, payment_type: "credit", cash_received: 0,
      lines: [{ product_id: product, quantity: 1, selling_price: 5, discount: 0, bonus: 0, unit_mode: "main" }],
    });
    await assert.rejects(create("70000000-0000-4000-8000-000000000030", overdueInput), /overdue credit invoices/);
    await db.query("update customers set allow_overdue_sales=true where id=$1", [overdueCustomer]);
    await assert.rejects(create("70000000-0000-4000-8000-000000000030", overdueInput), /override confirmation/);
    const overdueOverride = await create("70000000-0000-4000-8000-000000000030", { ...overdueInput, credit_override_confirmed: true });
    assert.equal(overdueOverride.transaction.payment_type, "credit");

    state = await snapshot();
    await db.exec("alter table sales_items add constraint fail_atomic_item check(product_id <> '" + product + "') not valid");
    await assert.rejects(create("70000000-0000-4000-8000-000000000040", base({ lines: [{ product_id: product, quantity: 1, selling_price: 10 }] })), /fail_atomic_item/);
    await db.exec("alter table sales_items drop constraint fail_atomic_item");
    assert.deepEqual(await snapshot(), state, "Late item failure rolls back invoice and trigger stock movement");

    await db.exec("alter table customer_payments add constraint fail_atomic_payment check(amount < 0) not valid");
    await assert.rejects(create("70000000-0000-4000-8000-000000000041", base()), /fail_atomic_payment/);
    await db.exec("alter table customer_payments drop constraint fail_atomic_payment");
    assert.deepEqual(await snapshot(), state, "Payment failure rolls back invoice, items, and stock ledger");

    await db.exec("alter table customer_payment_allocations add constraint fail_atomic_allocation check(amount < 0) not valid");
    await assert.rejects(create("70000000-0000-4000-8000-000000000042", base()), /fail_atomic_allocation/);
    await db.exec("alter table customer_payment_allocations drop constraint fail_atomic_allocation");
    assert.deepEqual(await snapshot(), state, "Allocation failure rolls back payment and all earlier writes");

    await db.exec("alter table audit_logs add constraint fail_atomic_audit check(action <> 'created') not valid");
    await assert.rejects(create("70000000-0000-4000-8000-000000000043", base()), /fail_atomic_audit/);
    await db.exec("alter table audit_logs drop constraint fail_atomic_audit");
    assert.deepEqual(await snapshot(), state, "Audit failure rolls back the entire sale");

    const unknownId = "70000000-0000-4000-8000-000000000050";
    assert.deepEqual(await status(unknownId), { status: "unknown" });
    const committedWithoutResponse = await create(unknownId, base());
    void committedWithoutResponse;
    const afterLostResponseRetry = await create(unknownId, base());
    assert.equal(afterLostResponseRetry.replayed, true, "Retry after a simulated lost response returns the committed result");
    assert.equal((await status(unknownId)).status, "confirmed");

    state = await snapshot();
    const duplicateId = "70000000-0000-4000-8000-000000000051";
    const duplicateResults = await Promise.all([create(duplicateId, base()), create(duplicateId, base())]);
    assert.equal(duplicateResults[0].transaction.id, duplicateResults[1].transaction.id);
    assert.equal((await snapshot()).invoices, state.invoices + 1, "Concurrent identical submissions create one sale");

    const stockInput = base({ cash_received: 20 });
    const stockResults = await Promise.allSettled([
      create("70000000-0000-4000-8000-000000000060", { ...stockInput, lines: [{ product_id: limitedProduct, quantity: 2, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }] }),
      create("70000000-0000-4000-8000-000000000061", { ...stockInput, lines: [{ product_id: limitedProduct, quantity: 2, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }] }),
    ]);
    assert.equal(stockResults.filter(result => result.status === "fulfilled").length, 1, "Competing sales cannot oversell block-policy stock");
    assert.equal(Number((await db.query<{ current_stock: string }>("select current_stock from products where id=$1", [limitedProduct])).rows[0].current_stock), 1);

    await assert.rejects(create("70000000-0000-4000-8000-000000000070", base(), employee), /Owner sales permission/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000071", base({ customer_id: "30000000-0000-4000-8000-000000000004" })), /Customer is unavailable/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000072", base({ lines: [{ product_id: otherProduct, quantity: 1, selling_price: 10 }] })), /Product is unavailable/);
    const otherOrgSale = await create("70000000-0000-4000-8000-000000000001", base({
      customer_id: "30000000-0000-4000-8000-000000000004",
      lines: [{ product_id: otherProduct, quantity: 1, selling_price: 10 }],
    }), otherOwner);
    assert.equal(otherOrgSale.transaction.invoice_number, "S-100001", "Request identifiers are unique within each organization");

    await db.exec("set role authenticated");
    await setActor(employee);
    await assert.rejects(db.query("select public.create_sales_invoice_atomic($1,$2::jsonb)", ["70000000-0000-4000-8000-000000000080", JSON.stringify(base())]), /Owner sales permission/);
    await db.exec("reset role");
    await testAtomicSaleClientRetry();
    console.log("Atomic sales PostgreSQL tests passed: cash/credit, tender/change, stock conversions, discounts/tax, rollback, idempotency, authorization, tenant scope, and stock limits.");
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
