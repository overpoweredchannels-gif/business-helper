"use client";
import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { formatPKR } from "@/lib/tradeos/formatters";

type Row={id:string;kind:string;record_number:string;party_name:string;record_date:string;total_amount:number;source_system:string;source_file:string;cutover_date:string;payload:{paid_amount?:number|null;related_invoice?:string;lines?:{product_name:string;quantity:number;unit_mode:string;unit_price:number;bonus:number;discount:number;source_row:number}[]}};
const labels:Record<string,string>={sale:"Sale",purchase:"Purchase",customer_payment:"Customer payment",supplier_payment:"Supplier payment"};
const control="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary";

export default function HistoricalRecords({organizationId,partyId,partyType}:{organizationId:string|null;partyId?:string;partyType?:"customer"|"supplier"}) {
  const [rows,setRows]=useState<Row[]>([]),[count,setCount]=useState(0),[page,setPage]=useState(0);
  const [partySearch,setPartySearch]=useState("");
  const [from,setFrom]=useState(""),[to,setTo]=useState(""),[kind,setKind]=useState("");
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[hidden,setHidden]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{const refresh=()=>{setPage(0);setRevision(value=>value+1);};window.addEventListener("tradeos:import-complete",refresh);return()=>window.removeEventListener("tradeos:import-complete",refresh);},[]);
  useEffect(()=>{
    let active=true;
    if(!organizationId) return;
    setBusy(true);setError("");setRows([]);setHidden(false);
    const params=new URLSearchParams({page:String(page),from,to,kind,party_name:partySearch});
    if(partyId) params.set("party",partyId);
    if(partyType) params.set("party_type",partyType);
    authorizedFetch(`/api/import-export/history?${params}`).then(async response=>{
      if(response.status===403){if(active)setHidden(true);return;}
      const result=await response.json();if(!response.ok)throw Error(result.error||"Could not load history");
      if(active){setRows(result.records);setCount(result.count);}
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Could not load history");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[organizationId,partyId,partyType,from,to,kind,page,revision,partySearch]);
  if(hidden) return null;
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h3 className="text-lg font-semibold">Imported historical records</h3><p className="mt-2 text-sm text-muted-foreground">Read-only records from before your start date. These amounts do not change current stock, cash, or payable/receivable balances. Source paid amounts are shown separately from payment records; do not add them together.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      {!partyId&&<label className="grid gap-1 text-sm">Customer / supplier name<input className={control} value={partySearch} onChange={event=>{setPartySearch(event.target.value);setPage(0);}} placeholder="Filter historical parties" /></label>}
      <label className="grid gap-1 text-sm">Type<select className={control} value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}><option value="">All history</option>{Object.entries(labels).filter(([key])=>!partyType||(partyType==="customer"?["sale","customer_payment"]:["purchase","supplier_payment"]).includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">From<input className={control} type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(0);}}/></label>
      <label className="grid gap-1 text-sm">To<input className={control} type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(0);}}/></label>
      <button type="button" className={control} disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh history</button>
    </div>
    {busy?<p role="status">Loading history…</p>:error?<p role="alert" className="text-sm text-destructive">{error}</p>:<>
      <p className="text-sm">{count} historical documents match these filters.</p>
      {!rows.length&&<p className="text-sm text-muted-foreground">No historical records in this period.</p>}
      <div className="space-y-2">{rows.map(row=><details key={row.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm"><strong>{labels[row.kind]} {row.record_number}</strong> · {row.party_name} · {row.record_date} · {formatPKR(row.total_amount)}</summary><div className="mt-3 space-y-2 text-sm"><p className="break-words">Source: {row.source_system} / {row.source_file}. Stock/balance start date: {row.cutover_date}.</p>{!row.kind.endsWith("payment")&&<p>Paid amount reported by source: {row.payload.paid_amount==null?"Unknown":formatPKR(row.payload.paid_amount)}.</p>}{row.payload.related_invoice&&<p>Linked historical invoice: {row.payload.related_invoice}</p>}{!!row.payload.lines?.length&&<div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Price</th><th>Bonus</th><th>Discount</th><th>Source row</th></tr></thead><tbody>{row.payload.lines.map((line,index)=><tr key={index} className="border-t"><td className="py-2">{line.product_name}</td><td>{line.quantity}</td><td>{line.unit_mode}</td><td>{formatPKR(line.unit_price)}</td><td>{line.bonus}</td><td>{formatPKR(line.discount)}</td><td>{line.source_row}</td></tr>)}</tbody></table></div>}</div></details>)}</div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={control} disabled={page===0} onClick={()=>setPage(value=>value-1)}>Previous</button><span className="text-sm">Page {page+1} of {Math.max(1,Math.ceil(count/50))}</span><button type="button" className={control} disabled={(page+1)*50>=count} onClick={()=>setPage(value=>value+1)}>Next</button></div>
    </>}
  </section>;
}
