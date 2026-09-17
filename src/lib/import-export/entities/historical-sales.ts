import * as XLSX from "xlsx";
import type { EntityImportConfig, ParsedRow } from "../types";
import { resolveImportReference } from "../references";
import { allPages } from "@/lib/supabase/all-pages";

const number = (raw: string) => Number(raw.replace(/,/g, "").trim());
const nonnegative = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0 ? null : "Must be a finite, non-negative number.";
export function validHistoryDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseHistoryDate(raw: string) {
  const value = raw.trim();
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) > 0 && Number(value) < 2958466) {
    const parsed = XLSX.SSF.parse_date_code(Number(value));
    if (parsed) return `${String(parsed.y).padStart(4,"0")}-${String(parsed.m).padStart(2,"0")}-${String(parsed.d).padStart(2,"0")}`;
  }
  return value;
}
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const key = (row: ParsedRow) => JSON.stringify([String(row.values.source_system).trim().toLowerCase(), String(row.values.invoice_number ?? row.values.reference_number).trim().toLowerCase()]);
export function groupHistoricalSales(rows: ParsedRow[]) {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) { const id = key(row); groups.set(id, [...(groups.get(id) ?? []), row]); }
  return [...groups.values()];
}

export function historicalInvoice(group: ParsedRow[]) {
  const v = group[0].values;
  const shared = ["customer", "sale_date", "payment_type", "total_amount", "discount_amount", "tax_amount", "paid_amount"];
  for (const field of shared) {
    const populated = group.map(row => row.values[field]).filter(value => value !== null && value !== undefined && value !== "");
    if (new Set(populated.map(value => String(value).trim())).size > 1) throw new Error(`Invoice ${v.invoice_number}: ${field} differs between lines. Repeat the invoice-level value, not the line total.`);
  }
  const header = (field: string) => group.find(row => row.values[field] != null && row.values[field] !== "")?.values[field];
  const discount = Number(header("discount_amount") ?? 0);
  const tax = Number(header("tax_amount") ?? 0);
  let subtotal = 0;
  const lines = group.map(row => {
    const line = row.values;
    const gross = Number(line.line_quantity) * Number(line.line_price);
    if (Number(line.line_discount ?? 0) > gross) throw new Error(`Row ${row.rowIndex}: line discount exceeds the line value.`);
    subtotal += gross - Number(line.line_discount ?? 0);
    return { product_id: line._product_id, product_name: line.line_product, quantity: line.line_quantity, unit_mode: line.line_unit_mode ?? "main", unit_price: line.line_price, discount: line.line_discount ?? 0, bonus: line.line_bonus ?? 0, source_row: row.rowIndex, original: row.raw };
  });
  if (discount > subtotal) throw new Error(`Invoice ${v.invoice_number}: invoice discount exceeds subtotal.`);
  const total = money(subtotal - discount + tax);
  if (!Number.isFinite(total) || total < 0) throw new Error(`Invoice ${v.invoice_number}: invalid total.`);
  if (header("total_amount") != null && Math.abs(Number(header("total_amount")) - total) > 0.01) throw new Error(`Invoice ${v.invoice_number}: supplied total does not match its lines, discount and tax (calculated ${total}).`);
  const paid = header("paid_amount") == null ? null : Number(header("paid_amount"));
  if (paid !== null && paid > total) throw new Error(`Invoice ${v.invoice_number}: paid amount exceeds its total.`);
  return { source_system: v.source_system, record_number: v.invoice_number, party_id: v._party_id, party_name: v.customer, record_date: v.sale_date, payment_type: v.payment_type, total_amount: total, paid_amount: paid, discount_amount: discount, tax_amount: tax, lines, notes: group.map(row => row.values.notes).filter(Boolean).join("\n") };
}

export type HistoryKind = "sale" | "purchase" | "customer_payment" | "supplier_payment";
type ArchiveMatch = {id: string; kind: HistoryKind; source_system: string; record_number: string; party_id: string; cutover_date: string};
const identity = (source: unknown, number: unknown) => JSON.stringify([String(source).trim().toLowerCase(), String(number).trim().toLowerCase()]);
const dateField = (key: string) => ({key,label:key.replaceAll("_", " "),type:"date" as const,required:true,preview:true,parse:parseHistoryDate,validate:(value: unknown)=>validHistoryDate(String(value))?null:"Use a real date in YYYY-MM-DD format."});
const numericField = (key: string, label: string, required = false) => ({key,label,type:"decimal" as const,required,preview:true,parse:number,validate:nonnegative});

export function historicalConfig(kind: HistoryKind): EntityImportConfig {
  const payment = kind.endsWith("payment");
  const supplier = kind === "purchase" || kind === "supplier_payment";
  const party = supplier ? "supplier" : "customer";
  const date = payment ? "payment_date" : supplier ? "purchase_date" : "sale_date";
  const numberKey = payment ? "reference_number" : "invoice_number";
  const title = {sale:"Historical Sales",purchase:"Historical Purchases",customer_payment:"Historical Customer Payments",supplier_payment:"Historical Supplier Payments"}[kind];
  const liveTable = {sale:"sales_transactions",purchase:"purchase_transactions",customer_payment:"customer_payments",supplier_payment:"supplier_payments"}[kind];
  const normalize = (rows: ParsedRow[]) => rows.map(row => ({...row, values:{...row.values, customer:row.values[party], sale_date:row.values[date]}}));

  return {
    entityKey: `historical_${kind === "sale" ? "sales" : kind === "purchase" ? "purchases" : `${kind}s`}`,
    entityName:title,tableName:"historical_records",existingColumns:"id,record_number",uniqueKeys:payment?[["source_system","reference_number"]]:[],defaultDuplicateMode:"error",maxRows:5000,
    fields:[
      {key:"source_system",label:"Source System",type:"text",required:true,defaultValue:"External records",preview:true,help:"Use the same source name for every file from that system and any repeat imports."},
      {key:numberKey,label:payment?"Payment Reference":"Invoice Number",type:"text",required:true,preview:true,help:payment?"Stable unique reference from the source system; required to detect repeated imports.":"Repeat the same invoice number on every line of that invoice."},
      {key:party,label:supplier?"Supplier":"Customer",type:"text",required:true,preview:true},
      dateField(date),
      ...(payment ? [numericField("amount","Payment Amount",true),{key:"related_invoice",label:"Related Invoice Number",type:"text" as const,preview:true,help:"Optional archived invoice from the same source system and party. Import invoices first."},{key:"payment_method",label:"Payment Method",type:"text" as const,preview:true}] : [
        {key:"payment_type",label:"Payment Type",type:"select" as const,required:true,preview:true,parse:(raw: string)=>raw.toLowerCase(),options:["cash","credit"],validate:(value: unknown)=>["cash","credit"].includes(String(value))?null:"Payment type must be cash or credit."},
        numericField("total_amount","Invoice Total"),numericField("discount_amount","Invoice Discount"),numericField("tax_amount","Invoice Tax"),numericField("paid_amount","Paid Amount (source)"),
        {key:"line_product",label:"Product",type:"text" as const,required:true,preview:true},
        {...numericField("line_quantity","Quantity",true),validate:(value: unknown)=>Number.isFinite(Number(value))&&Number(value)>0?null:"Quantity must be positive."},
        {key:"line_unit_mode",label:"Unit Mode",type:"select" as const,required:true,defaultValue:"main",options:["main","subunit"],preview:true,validate:(value: unknown)=>["main","subunit"].includes(String(value))?null:"Unit mode must be main or subunit."},
        numericField("line_price","Unit Price",true),numericField("line_discount","Line Discount"),numericField("line_bonus","Bonus Quantity"),
      ]),
      {key:"notes",label:"Notes",type:"text"},
    ],
    async reviewRows(rows, ctx) {
      if (!ctx.cutoverDate || !validHistoryDate(ctx.cutoverDate)) throw new Error("Choose a valid stock/balance start date before reviewing historical records.");
      const existing = await allPages<ArchiveMatch>((from,to)=>ctx.supabase.from("historical_records").select("id,kind,source_system,record_number,party_id,cutover_date").eq("organization_id",ctx.orgId).order("id").range(from,to));
      if (existing.error) throw new Error(`Historical storage is unavailable. Ask the owner to run 20260918_historical_records.sql. ${existing.error.message}`);
      if(existing.data?.some(record=>record.cutover_date!==ctx.cutoverDate)) throw new Error(`Use the start date already saved for this business: ${existing.data[0].cutover_date}.`);
      const archive = new Map((existing.data ?? []).filter(record=>record.kind === kind).map(record=>[identity(record.source_system,record.record_number),record]));
      const relatedKind = supplier?"purchase":"sale";
      const related = new Map((existing.data ?? []).filter(record=>record.kind===relatedKind).map(record=>[identity(record.source_system,record.record_number),record]));
      const live = await allPages<Record<string,string>>((from,to)=>{
        let query=ctx.supabase.from(liveTable).select(`id,${numberKey},${party}_id`).eq("organization_id",ctx.orgId);
        if (!payment) query=query.eq("invoice_type",kind === "sale"?"sales":"purchase");
        return query.order("id").range(from,to);
      });
      if (live.error) throw new Error(live.error.message);
      for (const row of rows) {
        if (row.errors.length) continue;
        try {
          if (String(row.values[date]) >= ctx.cutoverDate) throw new Error("History must be earlier than the stock/balance start date. Use normal transactions from that date onwards.");
          const partyId = await resolveImportReference(ctx,`${party}s`,String(row.values[party]),`${party}_name`);
          row.values._party_id=partyId;
          if (live.data?.some(record=>String(record[numberKey]??"").trim().toLowerCase()===String(row.values[numberKey]).trim().toLowerCase() && (!payment || record[`${party}_id`]===partyId))) throw new Error("This reference already exists in live transactions. Reconcile it before importing history.");
          if (!payment) row.values._product_id=await resolveImportReference(ctx,"products",String(row.values.line_product));
          else if (!(Number(row.values.amount)>0) || Math.abs(Number(row.values.amount)-money(Number(row.values.amount)))>0.00000001) throw new Error("Payment amount must be positive with at most two decimal places.");
          if (payment && row.values.related_invoice) {
            const match=related.get(identity(row.values.source_system,row.values.related_invoice));
            if (!match || match.party_id!==partyId) throw new Error("Related historical invoice was not found for this party and source. Import it first or correct the reference.");
            row.values._related_id=match.id;
          }
          row.existingId=archive.get(identity(row.values.source_system,row.values[numberKey]))?.id ?? null;
          row.status=row.existingId?"update":"new";
          row.warnings.push(`Linked ${party} ${partyId}${payment?"":`; product ${row.values._product_id}`}. History only: current stock, cash and balances unchanged.`);
          if (payment && !row.values.related_invoice) row.warnings.push("No invoice reference supplied. This payment will remain linked to the party only.");
        } catch(error) {row.errors.push(error instanceof Error?error.message:"Could not match historical record");}
      }
      if (!payment) for (const group of groupHistoricalSales(normalize(rows))) {
        try {if (!group.some(row=>row.errors.length)) historicalInvoice(group);}
        catch(error) {group.forEach(row=>row.errors.push(error instanceof Error?error.message:"Invoice totals do not reconcile"));}
        if (group.length>1) group.forEach(row=>row.warnings.push(`${group.length} source lines will remain together in this invoice. Repeated product lines are retained; verify they are intentional.`));
      }
    },
    async runRows(rows,ctx) {
      if(rows.some(row=>row.errors.length)) throw new Error("Resolve every review issue before saving.");
      if(ctx.duplicateMode!=="skip" && rows.some(row=>row.existingId)) throw new Error("Historical records are read-only. Review existing matches before saving.");
      const pending=rows.filter(row=>!row.existingId);
      const records=payment?pending.map(row=>({source_system:row.values.source_system,record_number:row.values.reference_number,party_id:row.values._party_id,party_name:row.values[party],record_date:row.values[date],total_amount:row.values.amount,related_id:row.values._related_id??null,related_invoice:row.values.related_invoice??null,payment_method:row.values.payment_method??null,notes:row.values.notes??null,lines:[],source_rows:[{row:row.rowIndex,original:row.raw}]})):groupHistoricalSales(normalize(pending)).map(historicalInvoice);
      if(!records.length) throw new Error("No new historical records to save.");
      const {error}=await ctx.supabase.rpc("import_historical_records",{p_org:ctx.orgId,p_actor:ctx.actorProfileId,p_cutover:ctx.cutoverDate,p_file:ctx.fileName,p_kind:kind,p_records:records});
      if(error) return {created:0,updated:0,skipped:rows.length-pending.length,failed:pending.length,failures:[{rowLabel:"Entire file",message:`Historical import was not confirmed. Check history before retrying; existing references cannot be imported twice. ${error.message}`}]};
      return {created:pending.length,updated:0,skipped:rows.length-pending.length,failed:0,failures:[]};
    },
  };
}

export const historicalSalesImportConfig=historicalConfig("sale");
export const historicalPurchasesImportConfig=historicalConfig("purchase");
export const historicalCustomerPaymentsImportConfig=historicalConfig("customer_payment");
export const historicalSupplierPaymentsImportConfig = historicalConfig("supplier_payment");

/** Totals for eligible new documents, not the sum of repeated header cells. */
export function historicalReviewSummary(entity: string, rows: ParsedRow[]) {
  const pending=rows.filter(row=>!row.existingId && !row.errors.length);
  if(entity.endsWith("payments")) return {documents:pending.length,amount:money(pending.reduce((sum,row)=>sum+Number(row.values.amount),0))};
  const normalized=pending.map(row=>({...row,values:{...row.values,customer:row.values.customer??row.values.supplier,sale_date:row.values.sale_date??row.values.purchase_date}}));
  try {const docs=groupHistoricalSales(normalized).map(historicalInvoice);return {documents:docs.length,amount:money(docs.reduce((sum,doc)=>sum+doc.total_amount,0))};}
  catch {return null;}
}
