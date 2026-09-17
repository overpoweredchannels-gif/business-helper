import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { historicalInvoice, historicalConfig, groupHistoricalSales, validHistoryDate, parseHistoryDate, historicalReviewSummary } from "../src/lib/import-export/entities/historical-sales";
import { validateParsedRow } from "../src/lib/import-export/processor";
import type { ImportContext, ParsedRow } from "../src/lib/import-export/types";

const org="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002",actor="00000000-0000-4000-8000-000000000003",customer="00000000-0000-4000-8000-000000000004",supplier="00000000-0000-4000-8000-000000000005",product="00000000-0000-4000-8000-000000000006",foreign="00000000-0000-4000-8000-000000000007";
const row=(index=2):ParsedRow=>({rowIndex:index,raw:{Name:"Medicine"},values:{source_system:"Legacy",invoice_number:"S-1",customer:"Customer",sale_date:"2025-01-01",payment_type:"credit",line_product:"Medicine",line_quantity:2,line_price:10,line_unit_mode:"main",_party_id:customer,_product_id:product},errors:[],warnings:[],status:"new"});

async function main(){
  assert.equal(parseHistoryDate("45658"),"2025-01-01");
  assert.equal(validHistoryDate("2025-02-30"),false);assert.equal(validHistoryDate("2024-02-29"),true);
  const grouped=groupHistoricalSales([row(),row(3)]);assert.equal(grouped.length,1);
  assert.deepEqual(historicalReviewSummary("historical_sales",[row(),row(3)]),{documents:1,amount:40});
  const invoice=historicalInvoice(grouped[0]);assert.equal(invoice.lines.length,2);assert.equal(invoice.total_amount,40);assert.equal(invoice.paid_amount,null);
  assert.throws(()=>historicalInvoice([row(),{...row(3),values:{...row(3).values,total_amount:90}}]),/does not match/);
  assert.throws(()=>historicalInvoice([row(),{...row(3),values:{...row(3).values,customer:"Other"}}]),/differs/);
  assert.throws(()=>historicalInvoice([{...row(),values:{...row().values,line_discount:50}}]),/exceeds/);
  const config=historicalConfig("sale");
  assert((await validateParsedRow({...row().values,line_price:Infinity},config.fields,{} as ImportContext)).errors.length>0);
  assert((await validateParsedRow({...row().values,payment_type:"bad"},config.fields,{} as ImportContext)).errors.length>0);
  let rpcCalls=0;
  const context={orgId:org,actorProfileId:actor,cutoverDate:"2026-09-18",fileName:"source.xlsx",duplicateMode:"error",supabase:{rpc:async()=>{rpcCalls++;return{error:null};}}} as unknown as ImportContext;
  const result=await config.runRows!([row(),row(3)],context);assert.equal(result.created,2);assert.equal(rpcCalls,1);
  await assert.rejects(config.runRows!([{...row(),existingId:"existing"}],context),/read-only/);
  const tables:Record<string,Record<string,unknown>[]>= {
    historical_records:[],sales_transactions:[],purchase_transactions:[],customer_payments:[],supplier_payments:[],
    customers:[{id:customer,customer_name:"Customer",organization_id:org}],suppliers:[{id:supplier,supplier_name:"Supplier",organization_id:org}],products:[{id:product,name:"Medicine",organization_id:org}],
  };
  const previewContext={...context,previewOnly:true,refCaches:new Map(),supabase:{from:(table:string)=>{
    let values=tables[table]??[];
    const query={select:()=>query,eq:(field:string,value:unknown)=>{values=values.filter(row=>row[field]===value);return query;},order:()=>query,range:async(from:number,to:number)=>({data:values.slice(from,to+1),error:null})};return query;
  }}} as unknown as ImportContext;
  const previewRows=[row(),row(3)];await config.reviewRows!(previewRows,previewContext);
  assert(previewRows.every(row=>row.errors.length===0));assert.equal(previewRows[0].values._party_id,customer);assert.equal(previewRows[0].values._product_id,product);
  const wrongDate={...row(),values:{...row().values,sale_date:"2026-09-18"}};await config.reviewRows!([wrongDate],previewContext);assert(wrongDate.errors.some(e=>e.includes("earlier")));
  const purchaseConfig=historicalConfig("purchase");const purchaseRow:ParsedRow={...row(),values:{...row().values,invoice_number:"P-1",supplier:"Supplier",purchase_date:"2025-01-01"}};
  await purchaseConfig.reviewRows!([purchaseRow],previewContext);assert.equal(purchaseRow.errors.length,0);assert.equal(purchaseRow.values._party_id,supplier);
  tables.historical_records.push({id:"saved-sale",organization_id:org,kind:"sale",source_system:"Legacy",record_number:"S-1",party_id:customer,cutover_date:context.cutoverDate});
  const paymentConfig=historicalConfig("customer_payment");const paymentRow={...row(),values:{source_system:"Legacy",reference_number:"CP-1",customer:"Customer",payment_date:"2025-01-02",amount:10,related_invoice:"S-1"}};
  await paymentConfig.reviewRows!([paymentRow],previewContext);assert.equal(paymentRow.errors.length,0);assert.equal((paymentRow.values as Record<string,unknown>)._related_id,"saved-sale");
  const repeat=row();await config.reviewRows!([repeat],previewContext);assert.equal(repeat.existingId,"saved-sale");
  tables.historical_records[0].cutover_date="2026-01-01";await assert.rejects(config.reviewRows!([row()],previewContext),/start date already saved/);
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,organization_id uuid);
    create table customers(id uuid primary key,organization_id uuid,balance numeric); create table suppliers(id uuid primary key,organization_id uuid,balance numeric);
    create table products(id uuid primary key,organization_id uuid,current_stock numeric);
    create table sales_transactions(id uuid primary key,organization_id uuid,invoice_type text,invoice_number text);
    create table purchase_transactions(id uuid primary key,organization_id uuid,invoice_type text,invoice_number text);
    create table customer_payments(id uuid primary key,organization_id uuid,customer_id uuid,reference_number text);
    create table supplier_payments(id uuid primary key,organization_id uuid,supplier_id uuid,reference_number text);
    create table inventory_transactions(id int); create table cash_movements(id int);
    insert into organizations values('${org}'),('${other}'); insert into profiles values('${actor}','${org}');
    insert into customers values('${customer}','${org}',75),('${foreign}','${other}',90); insert into suppliers values('${supplier}','${org}',60);
    insert into products values('${product}','${org}',131140);
    grant select on all tables in schema public to service_role;`);
  const sql=readFileSync("src/lib/migrations/20260918_historical_records.sql","utf8");await db.exec(sql);await db.exec(sql);
  const save=(kind:string,records:unknown[],cutover="2026-09-18")=>db.query("select import_historical_records($1::uuid,$2::uuid,$3::date,$4,$5,$6::jsonb)",[org,actor,cutover,"external.xlsx",kind,JSON.stringify(records)]);
  await db.exec("set role service_role");await save("sale",[invoice]);
  const sale=(await db.query<{id:string}>("select id from historical_records where kind='sale'")).rows[0].id;
  const purchase={...invoice,record_number:"P-1",party_id:supplier,party_name:"Supplier"};await save("purchase",[purchase]);
  const purchaseId=(await db.query<{id:string}>("select id from historical_records where kind='purchase'")).rows[0].id;
  const payment={source_system:"Legacy",record_number:"C-1",party_id:customer,party_name:"Customer",record_date:"2025-01-02",total_amount:10,related_id:sale,lines:[]};
  await save("customer_payment",[payment]);await save("supplier_payment",[{...payment,record_number:"SP-1",party_id:supplier,related_id:purchaseId}]);
  assert.equal((await db.query("select * from historical_records")).rows.length,4);
  await assert.rejects(save("sale",[{...invoice,record_number:" s-1 ",source_system:"legacy"}]),/duplicate/);
  await assert.rejects(save("sale",[{...invoice,record_number:"NEW"},{...invoice,record_number:"WRONG",party_id:foreign}]),/Customer not found/);
  assert.equal((await db.query("select * from historical_records where record_number='NEW'")).rows.length,0,"Whole-file rollback on a later failure");
  await assert.rejects(save("customer_payment",[{...payment,record_number:"FRACTION",total_amount:0.001}]),/two decimal places/);
  await assert.rejects(save("customer_payment",[{...payment,record_number:"BADLINK",related_id:purchaseId}]),/does not match/);
  await assert.rejects(save("sale",[{...invoice,record_number:"BADCUT"}],"2026-09-19"),/same start date/);
  await assert.rejects(save("sale",[{...invoice,record_number:"TOONEW",record_date:"2026-09-18"}]),/before the start date/);
  await assert.rejects(save("sale",[{...invoice,record_number:"BADTOTAL",total_amount:400}]),/does not reconcile/);
  await assert.rejects(db.exec("delete from historical_records"),/permission denied/);
  assert.equal(Number((await db.query<{current_stock:number}>("select current_stock from products")).rows[0].current_stock),131140);
  assert.equal(Number((await db.query<{balance:number}>("select balance from customers where id='"+customer+"'")).rows[0].balance),75);
  assert.equal(Number((await db.query<{balance:number}>("select balance from suppliers")).rows[0].balance),60);
  for(const table of ["sales_transactions","purchase_transactions","customer_payments","supplier_payments","inventory_transactions","cash_movements"])assert.equal((await db.query(`select * from ${table}`)).rows.length,0,`${table} stays untouched`);
  await db.exec("reset role; set role authenticated");await assert.rejects(save("sale",[invoice]),/permission denied/);await assert.rejects(db.exec("select * from historical_records"),/permission denied/);
  await db.close();
  console.log("Historical import tests passed: grouping, retained repeated lines, totals, four archive types, linkage, tenant checks, duplicate protection, atomic rollback, permissions and unchanged stock/cash/balances.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
