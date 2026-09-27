import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAtomicSale, readPendingAtomicSale, reconcilePendingAtomicSale, type AtomicSaleInput, type AtomicSaleResult } from "../src/lib/sales/atomic-sale-client";
import { buildRetailDrawerSummary } from "../src/lib/sales/retail-summary";
import { calculateSaleAmounts, roundMoney } from "../src/lib/sales/sale-amounts";
import { buildAtomicSaleReceipt, getReceiptLineRows } from "../src/lib/print/retail-receipt";
import { buildSalesInvoices } from "../src/lib/sales/sales-invoice-service";
import { salesInvoicesImportConfig } from "../src/lib/import-export/entities/sales-invoices";

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
const fractionalProduct = "40000000-0000-4000-8000-000000000005";

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
  transaction: { id: string; invoice_number: string; payment_type: string; total_amount: string; discount_amount: string; tax_amount: string; cash_received: string; change_due: string; credit_due_date: string | null };
  customer_name: string;
  items: Array<{ product_name: string; quantity: string; purchase_price_snapshot: string; inventory_bonus_main: string }>;
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
      create table sales_return_items(id uuid primary key default gen_random_uuid(), quantity numeric(14,2) not null);
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
        ('${cashProduct}','${org}','Cash Product','Unit','Piece',1,100,10,true,'block',now()),
        ('${fractionalProduct}','${org}','Fractional Product','Case','Piece',12,1,1000,true,'block',now());
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
    await db.exec(readFileSync("src/lib/migrations/20260926_sales_quantity_precision.sql", "utf8"));

    const precision = await db.query<{ table_name: string; column_name: string; numeric_scale: number }>(`select table_name, column_name, numeric_scale::int
      from information_schema.columns where table_schema='public' and (table_name,column_name) in
        (('sales_items','quantity'),('sales_items','bonus'),('sales_return_items','quantity'),('products','current_stock'),('inventory_transactions','quantity_delta'))
      order by table_name,column_name`);
    assert.deepEqual(precision.rows.map(row => [row.table_name, row.column_name, Number(row.numeric_scale)]), [
      ["inventory_transactions", "quantity_delta", 6], ["products", "current_stock", 6],
      ["sales_items", "bonus", 3], ["sales_items", "quantity", 3], ["sales_return_items", "quantity", 3],
    ], "The migration widens sale and return quantities and stock conversions to their documented scales");

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

    const fractionalMain = await create("70000000-0000-4000-8000-000000000044", base({
      cash_received: 135, invoice_discount: 5, invoice_discount_type: "percent", tax_rate: 10,
      lines: [{ product_id: fractionalProduct, quantity: 0.125, selling_price: 1000, discount: 0.01, bonus: 0, unit_mode: "main" }],
    }));
    assert.equal(Number(fractionalMain.items[0].quantity), 0.125, "The persisted line keeps the cashier's 0.125 quantity");
    assert.equal(Number(fractionalMain.transaction.total_amount), 130.61, "0.125 × 1000 uses the same line, invoice discount, tax, and total rounding");
    assert.equal(Number(fractionalMain.transaction.change_due), 4.39);
    assert.equal(Number((await db.query<{ quantity_delta: string }>("select quantity_delta from inventory_transactions where reference_id=$1", [fractionalMain.transaction.id])).rows[0].quantity_delta), -0.125);
    assert.equal(Number((await db.query<{ current_stock: string }>("select current_stock from products where id=$1", [fractionalProduct])).rows[0].current_stock), 0.875);

    const sqlHalfCentLine = await create("70000000-0000-4000-8000-000000000048", base({
      cash_received: 10.08,
      lines: [{ product_id: cashProduct, quantity: 0.125, selling_price: 80.60, discount: 0, bonus: 0, unit_mode: "main" }],
    }));
    const jsHalfCentLine = calculateSaleAmounts([{ quantity: 0.125, sellingPrice: 80.60 }]);
    assert.equal(Number(sqlHalfCentLine.transaction.total_amount), 10.08, "PostgreSQL NUMERIC rounds 0.125 × 80.60 (10.075) half away from zero");
    assert.equal(jsHalfCentLine.total, Number(sqlHalfCentLine.transaction.total_amount), "JavaScript sale totals match the actual atomic SQL result");
    assert.equal(Number(sqlHalfCentLine.transaction.change_due), 0);
    const sqlReceipt = buildAtomicSaleReceipt(sqlHalfCentLine, {
      scope: "test-org:test-owner", business: "Test Shop", fallbackDate: "today", fallbackPayment: "cash",
    });
    assert.equal(getReceiptLineRows(sqlReceipt)[0]?.amount, Number(sqlHalfCentLine.transaction.total_amount), "Receipt line amount matches the SQL sale amount");
    assert.equal(sqlReceipt.total, Number(sqlHalfCentLine.transaction.total_amount), "Receipt total retains the SQL amount");

    const historyTransaction = (await db.query<{ row: Record<string, unknown> }>(
      `select json_build_object('id',st.id,'invoice_number',st.invoice_number,'sale_date',st.sale_date,'payment_type',st.payment_type,'credit_due_date',st.credit_due_date,'total_amount',st.total_amount::text,'discount_amount',st.discount_amount::text,'tax_rate',st.tax_rate::text,'tax_amount',st.tax_amount::text,'created_by_profile_id',st.created_by_profile_id,'customer_id',st.customer_id,'customers',json_build_object('customer_name',c.customer_name)) row from sales_transactions st join customers c on c.id=st.customer_id where st.id=$1`,
      [sqlHalfCentLine.transaction.id],
    )).rows[0].row;
    const historyItem = (await db.query<{ row: Record<string, unknown> }>(
      `select json_build_object('sales_transaction_id',si.sales_transaction_id,'quantity',si.quantity::text,'selling_price',si.selling_price::text,'discount',si.discount::text,'unit_mode',si.unit_mode,'product_id',si.product_id,'products',json_build_object('name',p.name,'unit_type',p.unit_type,'subunit_type',p.subunit_type)) row from sales_items si join products p on p.id=si.product_id where si.sales_transaction_id=$1`,
      [sqlHalfCentLine.transaction.id],
    )).rows[0].row;
    const historyQuery = (rows: Record<string, unknown>[]) => {
      const query: Record<string, unknown> & { then?: (resolve: (result: unknown) => unknown) => unknown } = {};
      for (const method of ["select", "eq", "in", "gte", "lte", "order"]) {
        query[method] = () => query;
      }
      query.then = (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve);
      return query;
    };
    const historyClient = {
      from: (table: string) => historyQuery(table === "sales_transactions" ? [historyTransaction] : table === "sales_items" ? [historyItem] : []),
    } as unknown as SupabaseClient;
    const history = await buildSalesInvoices(historyClient, { organizationId: org });
    assert.equal(history.ok, true);
    assert.equal(history.docs?.[0]?.lines[0]?.quantity, 0.125, "sales history retains the stored three-decimal quantity");
    assert.equal(history.docs?.[0]?.lines[0]?.quantity_text, "0.125 Unit", "history displays all entered fractional quantity digits");
    assert.equal(history.docs?.[0]?.lines[0]?.line_total, Number(sqlHalfCentLine.transaction.total_amount), "history line calculation matches the PostgreSQL sale result");

    const exportItems = await db.query<{ row: Record<string, unknown> }>(
      `select json_build_object('quantity',si.quantity::text,'unit_mode',si.unit_mode,'products',json_build_object('name',p.name,'unit_type',p.unit_type,'subunit_type',p.subunit_type)) row from sales_items si join products p on p.id=si.product_id where si.sales_transaction_id=$1`,
      [sqlHalfCentLine.transaction.id],
    );
    const itemColumn = salesInvoicesImportConfig.export?.columns.find(column => column.key === "sales_items");
    const exportRow = { sales_items: [exportItems.rows[0].row] };
    assert.equal(itemColumn?.transform?.(exportRow.sales_items, exportRow), "Cash Product 0.125 Unit", "sales invoice export preserves the stored three-decimal quantity and unit");

    const roundingInputs = ["0.0049", "0.005", "0.0149", "0.015", "10.0749", "10.075", "-0.005", "-10.075", "999999999999.99"];
    const sqlRounding = await db.query<{ input: string; rounded: string }>(
      "select value::text input, round(value, 2)::text rounded from unnest($1::numeric[]) as value",
      [roundingInputs],
    );
    for (const row of sqlRounding.rows) {
      assert.equal(roundMoney(Number(row.input)), Number(row.rounded), `JavaScript rounding matches actual PostgreSQL NUMERIC round(${row.input}, 2)`);
    }

    const invalidCalculations: Array<{ input: Record<string, unknown>; check: () => unknown; message: RegExp; id: string }> = [
      { id: "70000000-0000-4000-8000-000000000096", input: base({ lines: [{ product_id: cashProduct, quantity: 0, selling_price: 1, discount: 0, bonus: 0, unit_mode: "main" }] }), check: () => calculateSaleAmounts([{ quantity: 0, sellingPrice: 1 }]), message: /quantity/i },
      { id: "70000000-0000-4000-8000-000000000097", input: base({ lines: [{ product_id: cashProduct, quantity: 1, selling_price: 1.001, discount: 0, bonus: 0, unit_mode: "main" }] }), check: () => calculateSaleAmounts([{ quantity: 1, sellingPrice: 1.001 }]), message: /precision|invalid sale line/i },
      { id: "70000000-0000-4000-8000-000000000098", input: base({ lines: [{ product_id: cashProduct, quantity: 0.001, selling_price: 5, discount: 0.01, bonus: 0, unit_mode: "main" }] }), check: () => calculateSaleAmounts([{ quantity: 0.001, sellingPrice: 5, discount: 0.01 }]), message: /discount/i },
    ];
    for (const invalid of invalidCalculations) {
      assert.throws(invalid.check, invalid.message, "JavaScript rejects an input outside the SQL calculation contract");
      await assert.rejects(create(invalid.id, invalid.input), invalid.message, "the actual PostgreSQL function rejects the same unsupported input");
    }

    const parityCases = [
      { id: "70000000-0000-4000-8000-000000000090", quantity: 0.125, sellingPrice: 80.60, discount: 0.03, invoiceDiscount: 10, invoiceDiscountType: "percent" as const, taxRate: 10, cashReceived: 10 },
      { id: "70000000-0000-4000-8000-000000000091", quantity: 0.1, sellingPrice: 0.50, discount: 0, invoiceDiscount: 0, invoiceDiscountType: "flat" as const, taxRate: 10, cashReceived: 0.06 },
      { id: "70000000-0000-4000-8000-000000000092", quantity: 0.001, sellingPrice: 4.90, discount: 0, invoiceDiscount: 0, invoiceDiscountType: "flat" as const, taxRate: 0, cashReceived: 0 },
      { id: "70000000-0000-4000-8000-000000000093", quantity: 0.001, sellingPrice: 5.00, discount: 0, invoiceDiscount: 0, invoiceDiscountType: "flat" as const, taxRate: 0, cashReceived: 0.01 },
      { id: "70000000-0000-4000-8000-000000000094", quantity: 0.001, sellingPrice: 5.10, discount: 0, invoiceDiscount: 0, invoiceDiscountType: "flat" as const, taxRate: 0, cashReceived: 0.01 },
      { id: "70000000-0000-4000-8000-000000000095", quantity: 0.001, sellingPrice: 15.00, discount: 0.01, invoiceDiscount: 0, invoiceDiscountType: "flat" as const, taxRate: 0, cashReceived: 0.01 },
    ];
    for (const scenario of parityCases) {
      const line = { product_id: cashProduct, quantity: scenario.quantity, selling_price: scenario.sellingPrice, discount: scenario.discount, bonus: 0, unit_mode: "main" };
      const sqlLineAmounts = await db.query<{ line_subtotal: string; line_discount: string; subtotal: string }>(
        "select round($1::numeric * $2::numeric, 2)::text line_subtotal, $3::numeric::text line_discount, round($1::numeric * $2::numeric - $3::numeric, 2)::text subtotal",
        [scenario.quantity, scenario.sellingPrice, scenario.discount],
      );
      const jsAmounts = calculateSaleAmounts([{ quantity: scenario.quantity, sellingPrice: scenario.sellingPrice, discount: scenario.discount }], {
        invoiceDiscount: scenario.invoiceDiscount, invoiceDiscountType: scenario.invoiceDiscountType, taxRate: scenario.taxRate,
      });
      const sqlSale = await create(scenario.id, base({
        cash_received: scenario.cashReceived,
        invoice_discount: scenario.invoiceDiscount,
        invoice_discount_type: scenario.invoiceDiscountType,
        tax_rate: scenario.taxRate,
        lines: [line],
      }));
      const transaction = sqlSale.transaction;
      assert.equal(jsAmounts.lineSubtotal, Number(sqlLineAmounts.rows[0].line_subtotal), "Line amounts match PostgreSQL NUMERIC results");
      assert.equal(jsAmounts.lineDiscount, Number(sqlLineAmounts.rows[0].line_discount), "Line discounts match PostgreSQL NUMERIC results");
      assert.equal(jsAmounts.subtotal, Number(sqlLineAmounts.rows[0].subtotal), "Discounted subtotals match PostgreSQL NUMERIC results");
      assert.equal(jsAmounts.invoiceDiscount, Number(transaction.discount_amount), "Invoice discount matches the atomic SQL result");
      assert.equal(jsAmounts.tax, Number(transaction.tax_amount), "Tax matches the atomic SQL result");
      assert.equal(jsAmounts.total, Number(transaction.total_amount), "Total matches the atomic SQL result");
      const drawer = buildRetailDrawerSummary({ total: jsAmounts.total, received: scenario.cashReceived });
      assert.equal(drawer.received, Number(transaction.cash_received), "Tender cents match the atomic SQL result");
      assert.equal(drawer.expected, Number(transaction.total_amount), "Tender summary uses the SQL sale total");
      assert.equal(drawer.change, Number(transaction.change_due), "Tender change matches the atomic SQL result");
      const receipt = buildAtomicSaleReceipt(sqlSale, {
        scope: `test-org:${scenario.id}`, business: "Test Shop", fallbackDate: "today", fallbackPayment: "cash",
      });
      assert.equal(getReceiptLineRows(receipt)[0]?.amount, Number(sqlLineAmounts.rows[0].subtotal), "Receipt line amount matches PostgreSQL's NUMERIC line expression");
      assert.equal(receipt.total, Number(transaction.total_amount), "Receipt total matches the persisted SQL sale total");
    }

    const fractionalSubunit = await create("70000000-0000-4000-8000-000000000045", base({
      cash_received: 135, invoice_discount: 5, invoice_discount_type: "percent", tax_rate: 10,
      lines: [{ product_id: fractionalProduct, quantity: 0.125, selling_price: 1000, discount: 0.01, bonus: 0.125, unit_mode: "subunit" }],
    }));
    assert.equal(Number(fractionalSubunit.items[0].quantity), 0.125, "Sub-unit sales keep the entered fractional quantity");
    assert.equal(Number(fractionalSubunit.transaction.total_amount), 130.61);
    assert.equal(Number((await db.query<{ quantity_delta: string }>("select quantity_delta from inventory_transactions where reference_id=$1", [fractionalSubunit.transaction.id])).rows[0].quantity_delta), -0.020833);
    assert.equal(Number((await db.query<{ current_stock: string }>("select current_stock from products where id=$1", [fractionalProduct])).rows[0].current_stock), 0.854167, "Sub-unit quantity and bonus convert to main units at six decimal places");

    const lineRound = await create("70000000-0000-4000-8000-000000000046", base({
      cash_received: 0.01,
      lines: [{ product_id: fractionalProduct, quantity: 0.333, selling_price: 0.05, discount: 0.01, bonus: 0, unit_mode: "main" }],
    }));
    assert.equal(Number(lineRound.transaction.total_amount), 0.01, "A fractional line rounds to cents before invoice totals");

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
    await assert.rejects(create("70000000-0000-4000-8000-000000000013", base({ lines: [{ product_id: limitedProduct, quantity: 0, selling_price: 10 }] })), /Invalid sale line/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000016", base({ lines: [{ product_id: cashProduct, quantity: 0.1251, selling_price: 1000 }] })), /quantity and bonus support three decimals/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000017", base({ lines: [{ product_id: cashProduct, quantity: 1, selling_price: 10.001 }] })), /quantity and bonus support three decimals/);
    await assert.rejects(create("70000000-0000-4000-8000-000000000018", base({ cash_received: 10.001 })), /Invalid cash received/);
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

    const recoveryInput = base({
      cash_received: 10,
      lines: [{ product_id: cashProduct, quantity: 1, selling_price: 10, discount: 0, bonus: 0, unit_mode: "main" }],
    }) as AtomicSaleInput;
    await db.query("update products set current_stock=1 where id=$1", [cashProduct]);
    const storage = new Map<string, string>();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const installWindow = () => Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    } } });
    let createCalls = 0;
    let statusCalls = 0;
    let recoveryRequestId = "";
    const recoveryClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "create_sales_invoice_atomic") {
          createCalls += 1;
          recoveryRequestId = String(args.p_request_id);
          assert.equal(args.p_request_id, recoveryRequestId, "The persisted request identifier is preserved on initial submission");
          await create(String(args.p_request_id), args.p_input as Record<string, unknown>);
          throw new Error("simulated lost creation response after database commit");
        }
        statusCalls += 1;
        if (statusCalls === 1) throw new Error("simulated lost immediate status response");
        assert.equal(args.p_request_id, recoveryRequestId, "Recovery checks the original request identifier");
        return { data: await status(String(args.p_request_id)), error: null };
      },
    } as unknown as SupabaseClient;
    try {
      installWindow();
      await assert.rejects(createAtomicSale(recoveryClient, `${org}:${owner}`, recoveryInput), /status could not be confirmed/);
      const pendingAfterReload = readPendingAtomicSale(`${org}:${owner}`);
      assert.equal(pendingAfterReload?.requestId, recoveryRequestId);
      assert.equal(Number((await db.query<{ current_stock: string }>("select current_stock from products where id=$1", [cashProduct])).rows[0].current_stock), 0, "The first request consumed the last stock unit");
      await db.query("update products set is_active=false where id=$1", [cashProduct]);
      await db.query("update customers set is_active=false where id=$1", [cashCustomer]);
      const afterCommit = await db.query<{ invoices: number; items: number; movements: number; stock: string }>(`select
        (select count(*)::int from sales_transactions where request_id=$1) invoices,
        (select count(*)::int from sales_items si join sales_transactions st on st.id=si.sales_transaction_id where st.request_id=$1) items,
        (select count(*)::int from inventory_transactions where reference_id=(select id from sales_transactions where request_id=$1)) movements,
        (select current_stock from products where id=$2) stock`, [recoveryRequestId, cashProduct]);
      const committedInvoice = (await db.query<{ invoice_number: string }>("select invoice_number from sales_transactions where request_id=$1", [recoveryRequestId])).rows[0].invoice_number;
      installWindow(); // New browser context, same durable local storage.
      const recovered = await reconcilePendingAtomicSale(recoveryClient, `${org}:${owner}`);
      assert.equal(recovered?.result.transaction.invoice_number, committedInvoice);
      assert.equal(recovered?.previousPendingConfirmed, true);
      assert.equal(createCalls, 1, "A confirmed request is recovered without another sale RPC");
      assert.equal(statusCalls, 2, "The initial status response is lost and the reloaded page reconciles it");
      assert.equal(readPendingAtomicSale(`${org}:${owner}`), null);
      const afterRecovery = await db.query<{ invoices: number; items: number; movements: number; stock: string }>(`select
        (select count(*)::int from sales_transactions where request_id=$1) invoices,
        (select count(*)::int from sales_items si join sales_transactions st on st.id=si.sales_transaction_id where st.request_id=$1) items,
        (select count(*)::int from inventory_transactions where reference_id=(select id from sales_transactions where request_id=$1)) movements,
        (select current_stock from products where id=$2) stock`, [recoveryRequestId, cashProduct]);
      assert.deepEqual(afterRecovery.rows[0], afterCommit.rows[0], "Recovery after product/customer changes adds no invoice, item, movement, or stock change");
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }

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
