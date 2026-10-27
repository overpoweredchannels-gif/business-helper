"use client";
import { useCallback, useEffect, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { formatBooksMoney } from "@/lib/tradeos/formatters";
import { buildHistoricalSummary } from "@/lib/import-export/historical-ai-summary";

type Row={id:string;kind:string;record_number:string;party_name:string;record_date:string;total_amount:number;source_system:string;source_file:string;cutover_date:string;payload:{paid_amount?:number|null;related_invoice?:string;lines?:{product_name:string;quantity:number;unit_mode:string;unit_price:number;bonus:number;discount:number;source_row:number}[]}};

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
  const { t, language } = useRegional();
  const labels:Record<string,string>={sale:t('hist.kindSale'),purchase:t('hist.kindPurchase'),customer_payment:t('hist.kindCustomerPayment'),supplier_payment:t('hist.kindSupplierPayment')};
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
      const result=await response.json();if(!response.ok)throw Error(result.error||t('hist.loadFailed'));
      if(active){
        const ranked = [...(result.records ?? [])].sort((left, right) => scoreHistoricalRow(right, keywordSearch) - scoreHistoricalRow(left, keywordSearch));
        setRows(ranked);
        setCount(result.count ?? ranked.length);
      }
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:t('hist.loadFailed'));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[organizationId,partyId,partyType,from,to,kind,page,revision,partySearch,keywordSearch,t]);
  const loadArchiveFiles = useCallback(async (search = keywordSearch) => {
    if (!organizationId) return;
    const response = await authorizedFetch(`/api/import-export/history/archive?keyword=${encodeURIComponent(search)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || t('hist.archiveLoadFailed'));
    setArchiveFiles(result.files ?? []);
  }, [organizationId, keywordSearch, t]);
  useEffect(() => { void loadArchiveFiles().catch(reason => setArchiveError(reason instanceof Error ? reason.message : t('hist.archiveLoadFailed'))); }, [loadArchiveFiles, t]);
  const uploadArchiveFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setArchiveBusy(true); setArchiveError(""); setArchiveNotice("");
    try {
      const form = new FormData();
      Array.from(files).forEach(file => form.append("files", file));
      const response = await authorizedFetch("/api/import-export/history/archive", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || t('hist.archiveUploadFailed'));
      const extraction = (result.files ?? []).map((file: { fileName?: string; recognition?: string }) => file.recognition ? `${file.fileName}: ${file.recognition}` : "").filter(Boolean).join(" ");
      setArchiveNotice(`${result.files.length === 1 ? t('hist.archiveSavedOne') : t('hist.archiveSavedMany').replace('{count}', String(result.files.length))}${extraction ? ` ${extraction}` : ""}`);
      await loadArchiveFiles();
    } catch (reason) { setArchiveError(reason instanceof Error ? reason.message : t('hist.archiveUploadFailed')); }
    finally { setArchiveBusy(false); }
  };
  if(hidden) return null;
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h3 className="text-lg font-semibold">{t('hist.title')}</h3><p className="mt-2 text-sm text-muted-foreground">{t('hist.intro')}</p></div>
    {!partyId && <div className="rounded-lg border border-primary/25 bg-primary/5 p-4"><h4 className="font-semibold">{t('hist.uploadTitle')}</h4><p className="mt-1 text-sm text-muted-foreground">{t('hist.uploadHint')}</p><div onDragOver={event=>{event.preventDefault();if(!archiveBusy)setArchiveDragging(true);}} onDragLeave={event=>{if(event.currentTarget===event.target)setArchiveDragging(false);}} onDrop={event=>{event.preventDefault();setArchiveDragging(false);if(!archiveBusy)void uploadArchiveFiles(event.dataTransfer.files);}} className={`mt-3 rounded-lg border-2 border-dashed p-4 transition-colors ${archiveDragging ? "border-primary bg-primary/10" : "border-border"}`}><p className="text-sm text-muted-foreground">{t('hist.dragHint')}</p><label className={`${control} mt-3 inline-flex cursor-pointer items-center gap-2 ${archiveBusy ? "opacity-50" : ""}`}><span>{archiveBusy ? t('hist.uploading') : t('hist.chooseFiles')}</span><input className="sr-only" type="file" multiple accept=".csv,.xlsx,.xls,.ods,.xml,.txt,.pdf,.png,.jpg,.jpeg,.webp" disabled={archiveBusy} onChange={event=>{void uploadArchiveFiles(event.target.files);event.currentTarget.value="";}} /></label></div>{archiveNotice&&<p role="status" className="mt-2 text-sm text-success">{archiveNotice}</p>}{archiveError&&<p role="alert" className="mt-2 text-sm text-destructive">{archiveError}</p>}<div className="mt-3 space-y-1 text-sm">{archiveFiles.map(file=><div key={file.id} className="border-t border-border/60 pt-2"><p className="flex flex-wrap justify-between gap-2"><span className="break-all">{file.file_name}</span><span className="text-muted-foreground">{file.row_count ? `${t('hist.rowsLabel').replace('{count}', file.row_count.toLocaleString())} · ` : ""}{new Date(file.uploaded_at).toLocaleString()}</span></p>{file.excerpt&&<p className="mt-1 break-words text-xs text-muted-foreground">{t('hist.matchLabel').replace('{excerpt}', file.excerpt)}</p>}</div>)}{!archiveFiles.length&&!archiveError&&<p className="text-muted-foreground">{t('hist.noArchiveFiles')}</p>}</div></div>}
    {!busy && !error && <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{t('hist.matchingRecords')}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{t('hist.sourceFiles')}</p><p className="mt-2 text-2xl font-semibold">{activeSourceFiles}</p></div>
      <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{t('hist.topMatches')}</p><p className="mt-2 text-sm font-medium">{topMatches.length ? topMatches.map(row => row.record_number).slice(0, 3).join(" • ") || t('hist.noMatches') : t('hist.noData')}</p></div>
    </div>}
    {!busy && !error && topMatches.length > 0 && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm"><p className="font-medium text-foreground">{t('hist.aiSummary')}</p><p className="mt-2 text-muted-foreground">{buildHistoricalSummary(topMatches[0], keywordSearch, language)}</p></div>}
    <div className="flex flex-wrap items-end gap-3">
      {!partyId&&<label className="grid gap-1 text-sm">{t('hist.partyLabel')}<input className={control} value={partySearch} onChange={event=>{setPartySearch(event.target.value);setPage(0);}} placeholder={t('hist.partyPlaceholder')} /></label>}
      <label className="grid gap-1 text-sm">{t('hist.keywordLabel')}<input className={control} value={keywordSearch} onChange={event=>{setKeywordSearch(event.target.value);setPage(0);}} placeholder={t('hist.keywordPlaceholder')} /></label>
      <label className="grid gap-1 text-sm">{t('hist.typeLabel')}<select className={control} value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}><option value="">{t('hist.allHistory')}</option>{Object.entries(labels).filter(([key])=>!partyType||(partyType==="customer"?["sale","customer_payment"]:["purchase","supplier_payment"]).includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{t('hist.fromLabel')}<input className={control} type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(0);}}/></label>
      <label className="grid gap-1 text-sm">{t('hist.toLabel')}<input className={control} type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(0);}}/></label>
      <button type="button" className={control} disabled={busy} onClick={()=>setRevision(value=>value+1)}>{t('hist.refresh')}</button>
    </div>
    {busy?<p role="status">{t('hist.loading')}</p>:error?<p role="alert" className="text-sm text-destructive">{error}</p>:<>
      <p className="text-sm">{keywordSearch.trim() ? t('hist.keywordMatches').replace('{count}', String(count)) : t('hist.documentsMatch').replace('{count}', String(count))}</p>
      {!rows.length&&<p className="text-sm text-muted-foreground">{t('hist.noRecords')}</p>}
      <div className="space-y-2">{rows.map(row=><details key={row.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm"><strong>{labels[row.kind]} {row.record_number}</strong> · {row.party_name} · {row.record_date} · {formatBooksMoney(row.total_amount)}</summary><div className="mt-3 space-y-2 text-sm"><p className="break-words">{buildHistoricalSummary(row, keywordSearch, language)}</p><p className="break-words">{t('hist.sourceLine').replace('{system}', row.source_system).replace('{file}', row.source_file).replace('{date}', row.cutover_date)}</p>{!row.kind.endsWith("payment")&&<p>{t('hist.paidLine').replace('{amount}', row.payload.paid_amount==null?t('sell.unknown'):formatBooksMoney(row.payload.paid_amount))}</p>}{row.payload.related_invoice&&<p>{t('hist.linkedInvoice').replace('{invoice}', row.payload.related_invoice)}</p>}{!!row.payload.lines?.length&&<div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead><tr><th>{t('sell.product')}</th><th>{t('profit.qty')}</th><th>{t('pos.unit')}</th><th>{t('pos.price')}</th><th>{t('hist.bonusHeader')}</th><th>{t('common.discount')}</th><th>{t('hist.sourceRowHeader')}</th></tr></thead><tbody>{row.payload.lines.map((line,index)=><tr key={index} className="border-t"><td className="py-2">{line.product_name}</td><td>{line.quantity}</td><td>{line.unit_mode}</td><td>{formatBooksMoney(line.unit_price)}</td><td>{line.bonus}</td><td>{formatBooksMoney(line.discount)}</td><td>{line.source_row}</td></tr>)}</tbody></table></div>}</div></details>)}</div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={control} disabled={page===0} onClick={()=>setPage(value=>value-1)}>{t('hist.previous')}</button><span className="text-sm">{t('hist.pageLabel').replace('{page}', String(page+1)).replace('{total}', String(Math.max(1,Math.ceil(count/50))))}</span><button type="button" className={control} disabled={(page+1)*50>=count} onClick={()=>setPage(value=>value+1)}>{t('common.next')}</button></div>
    </>}
  </section>;
}
