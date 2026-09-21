"use client";
import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { formatPKR } from "@/lib/tradeos/formatters";
import { buildHistoricalSummary } from "@/lib/import-export/historical-ai-summary";

type Row={id:string;kind:string;record_number:string;party_name:string;record_date:string;total_amount:number;source_system:string;source_file:string;cutover_date:string;payload:{paid_amount?:number|null;related_invoice?:string;lines?:{product_name:string;quantity:number;unit_mode:string;unit_price:number;bonus:number;discount:number;source_row:number}[]}};
const labels:Record<string,string>={sale:"Sale",purchase:"Purchase",customer_payment:"Customer payment",supplier_payment:"Supplier payment"};
const control="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary";
const normalizeKeywordText = (value: unknown) => String(value ?? "").trim().toLowerCase();
const scoreHistoricalRow = (row: Row, keyword: string) => {
  const text = [
    row.kind,
    row.record_number,
    row.party_name,
    row.record_date,
    row.source_system,
    row.source_file,
    row.payload.related_invoice ?? "",
    row.payload.lines?.map(line => `${line.product_name} ${line.unit_mode} ${line.source_row}`).join(" ") ?? "",
  ].join(" ").toLowerCase();
  const search = keyword.trim().toLowerCase();
  if (!search) return 0;
  let score = 0;
  const tokens = search.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!token) continue;
    if (text.includes(token)) score += 25;
    if (row.party_name.toLowerCase().includes(token)) score += 30;
    if (row.record_number.toLowerCase().includes(token)) score += 35;
    if (row.source_file.toLowerCase().includes(token)) score += 30;
    if (row.payload.related_invoice?.toLowerCase().includes(token)) score += 25;
    if (row.payload.lines?.some(line => line.product_name.toLowerCase().includes(token))) score += 40;
  }
  return score;
};

export default function HistoricalRecords({organizationId,partyId,partyType}:{organizationId:string|null;partyId?:string;partyType?:"customer"|"supplier"}) {
  const [rows,setRows]=useState<Row[]>([]),[count,setCount]=useState(0),[page,setPage]=useState(0);
  const [partySearch,setPartySearch]=useState("");
  const [keywordSearch,setKeywordSearch]=useState("");
  const [from,setFrom]=useState(""),[to,setTo]=useState(""),[kind,setKind]=useState("");
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[hidden,setHidden]=useState(false),[revision,setRevision]=useState(0);
  const [archiveFiles,setArchiveFiles]=useState<Array<{id:string;file_name:string;file_size_bytes:number;row_count:number;uploaded_at:string;excerpt?:string}>>([]);
  const [archiveBusy,setArchiveBusy]=useState(false),[archiveDragging,setArchiveDragging]=useState(false),[archiveError,setArchiveError]=useState(""),[archiveNotice,setArchiveNotice]=useState("");
  const topMatches = rows.slice(0, 3);
  const activeSourceFiles = new Set(rows.map(row => row.source_file).filter(Boolean)).size;
  useEffect(()=>{const refresh=()=>{setPage(0);setRevision(value=>value+1);};window.addEventListener("tradeos:import-complete",refresh);return()=>window.removeEventListener("tradeos:import-complete",refresh);},[]);
  useEffect(()=>{
    let active=true;
    if(!organizationId) return;
    setBusy(true);setError("");setRows([]);setHidden(false);
    const params=new URLSearchParams({page:String(page),from,to,kind,party_name:partySearch,keyword:keywordSearch});
    if(partyId) params.set("party",partyId);
    if(partyType) params.set("party_type",partyType);
    authorizedFetch(`/api/import-export/history?${params}`).then(async response=>{
      if(response.status===403){if(active)setHidden(true);return;}
      const result=await response.json();if(!response.ok)throw Error(result.error||"Could not load history");
      if(active){
        const ranked = [...(result.records ?? [])].sort((left, right) => scoreHistoricalRow(right, keywordSearch) - scoreHistoricalRow(left, keywordSearch));
        setRows(ranked);
        setCount(result.count ?? ranked.length);
      }
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Could not load history");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[organizationId,partyId,partyType,from,to,kind,page,revision,partySearch,keywordSearch]);
  const loadArchiveFiles = async (search = keywordSearch) => {
    if (!organizationId) return;
    const response = await authorizedFetch(`/api/import-export/history/archive?keyword=${encodeURIComponent(search)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not load archive files");
    setArchiveFiles(result.files ?? []);
  };
  useEffect(() => { void loadArchiveFiles().catch(reason => setArchiveError(reason instanceof Error ? reason.message : "Could not load archive files")); }, [organizationId, keywordSearch]);
  const uploadArchiveFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setArchiveBusy(true); setArchiveError(""); setArchiveNotice("");
    try {
      const form = new FormData();
      Array.from(files).forEach(file => form.append("files", file));
      const response = await authorizedFetch("/api/import-export/history/archive", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Archive upload failed");
      const extraction = (result.files ?? []).map((file: { fileName?: string; recognition?: string }) => file.recognition ? `${file.fileName}: ${file.recognition}` : "").filter(Boolean).join(" ");
      setArchiveNotice(`${result.files.length} file${result.files.length === 1 ? "" : "s"} saved to the historical archive. Current stock and balances were not changed.${extraction ? ` ${extraction}` : ""}`);
      await loadArchiveFiles();
    } catch (reason) { setArchiveError(reason instanceof Error ? reason.message : "Archive upload failed"); }
    finally { setArchiveBusy(false); }
  };
  if(hidden) return null;
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h3 className="text-lg font-semibold">Historical Data Hub</h3><p className="mt-2 text-sm text-muted-foreground">Read-only records from before your start date. These amounts do not change current stock, cash, or payable/receivable balances. Search by keyword, product, customer, invoice number or source file to bring the right history to the top.</p></div>
    {!partyId && <div className="rounded-lg border border-primary/25 bg-primary/5 p-4"><h4 className="font-semibold">Upload historical business files</h4><p className="mt-1 text-sm text-muted-foreground">Upload invoices, customer payments, supplier payments, CSV, Excel, PDF, images, or other legacy files together. They are stored as archive-only documents and are searchable without mapping them into live TradeOS records.</p><div onDragOver={event=>{event.preventDefault();if(!archiveBusy)setArchiveDragging(true);}} onDragLeave={event=>{if(event.currentTarget===event.target)setArchiveDragging(false);}} onDrop={event=>{event.preventDefault();setArchiveDragging(false);if(!archiveBusy)void uploadArchiveFiles(event.dataTransfer.files);}} className={`mt-3 rounded-lg border-2 border-dashed p-4 transition-colors ${archiveDragging ? "border-primary bg-primary/10" : "border-border"}`}><p className="text-sm text-muted-foreground">Drag files here, or choose them from your device. Up to 20 files, 50 MB each.</p><label className={`${control} mt-3 inline-flex cursor-pointer items-center gap-2 ${archiveBusy ? "opacity-50" : ""}`}><span>{archiveBusy ? "Uploading…" : "Choose history files"}</span><input className="sr-only" type="file" multiple accept=".csv,.xlsx,.xls,.ods,.xml,.txt,.pdf,.png,.jpg,.jpeg,.webp" disabled={archiveBusy} onChange={event=>{void uploadArchiveFiles(event.target.files);event.currentTarget.value="";}} /></label></div>{archiveNotice&&<p role="status" className="mt-2 text-sm text-success">{archiveNotice}</p>}{archiveError&&<p role="alert" className="mt-2 text-sm text-destructive">{archiveError}</p>}<div className="mt-3 space-y-1 text-sm">{archiveFiles.map(file=><div key={file.id} className="border-t border-border/60 pt-2"><p className="flex flex-wrap justify-between gap-2"><span className="break-all">{file.file_name}</span><span className="text-muted-foreground">{file.row_count ? `${file.row_count.toLocaleString()} rows · ` : ""}{new Date(file.uploaded_at).toLocaleString()}</span></p>{file.excerpt&&<p className="mt-1 break-words text-xs text-muted-foreground">Match: {file.excerpt}</p>}</div>)}{!archiveFiles.length&&!archiveError&&<p className="text-muted-foreground">No archive files uploaded yet.</p>}</div></div>}
    {!busy && !error && <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Matching records</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Source files</p><p className="mt-2 text-2xl font-semibold">{activeSourceFiles}</p></div>
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Top matches</p><p className="mt-2 text-sm font-medium">{topMatches.length ? topMatches.map(row => row.record_number).slice(0, 3).join(" • ") || "No matches" : "No data"}</p></div>
    </div>}
    {!busy && !error && topMatches.length > 0 && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm"><p className="font-medium text-foreground">AI match summary</p><p className="mt-2 text-muted-foreground">{buildHistoricalSummary(topMatches[0], keywordSearch)}</p></div>}
    <div className="flex flex-wrap items-end gap-3">
      {!partyId&&<label className="grid gap-1 text-sm">Customer / supplier name<input className={control} value={partySearch} onChange={event=>{setPartySearch(event.target.value);setPage(0);}} placeholder="Filter historical parties" /></label>}
      <label className="grid gap-1 text-sm">Keyword search<input className={control} value={keywordSearch} onChange={event=>{setKeywordSearch(event.target.value);setPage(0);}} placeholder="Invoice, product, customer, source file" /></label>
      <label className="grid gap-1 text-sm">Type<select className={control} value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}><option value="">All history</option>{Object.entries(labels).filter(([key])=>!partyType||(partyType==="customer"?["sale","customer_payment"]:["purchase","supplier_payment"]).includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">From<input className={control} type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(0);}}/></label>
      <label className="grid gap-1 text-sm">To<input className={control} type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(0);}}/></label>
      <button type="button" className={control} disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh history</button>
    </div>
    {busy?<p role="status">Loading history…</p>:error?<p role="alert" className="text-sm text-destructive">{error}</p>:<>
      <p className="text-sm">{keywordSearch.trim() ? `${count} keyword matches, ranked by relevance.` : `${count} historical documents match these filters.`}</p>
      {!rows.length&&<p className="text-sm text-muted-foreground">No historical records in this period or for this keyword.</p>}
      <div className="space-y-2">{rows.map(row=><details key={row.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm"><strong>{labels[row.kind]} {row.record_number}</strong> · {row.party_name} · {row.record_date} · {formatPKR(row.total_amount)}</summary><div className="mt-3 space-y-2 text-sm"><p className="break-words">{buildHistoricalSummary(row, keywordSearch)}</p><p className="break-words">Source: {row.source_system} / {row.source_file}. Stock/balance start date: {row.cutover_date}.</p>{!row.kind.endsWith("payment")&&<p>Paid amount reported by source: {row.payload.paid_amount==null?"Unknown":formatPKR(row.payload.paid_amount)}.</p>}{row.payload.related_invoice&&<p>Linked historical invoice: {row.payload.related_invoice}</p>}{!!row.payload.lines?.length&&<div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Price</th><th>Bonus</th><th>Discount</th><th>Source row</th></tr></thead><tbody>{row.payload.lines.map((line,index)=><tr key={index} className="border-t"><td className="py-2">{line.product_name}</td><td>{line.quantity}</td><td>{line.unit_mode}</td><td>{formatPKR(line.unit_price)}</td><td>{line.bonus}</td><td>{formatPKR(line.discount)}</td><td>{line.source_row}</td></tr>)}</tbody></table></div>}</div></details>)}</div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={control} disabled={page===0} onClick={()=>setPage(value=>value-1)}>Previous</button><span className="text-sm">Page {page+1} of {Math.max(1,Math.ceil(count/50))}</span><button type="button" className={control} disabled={(page+1)*50>=count} onClick={()=>setPage(value=>value+1)}>Next</button></div>
    </>}
  </section>;
}
