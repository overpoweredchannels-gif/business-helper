"use client";
import { useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { businessReportHtml } from "@/lib/print/business-report";
import { useRegional } from "@/components/regional/RegionalProvider";

export function BusinessRecordsExport() {
  const { t } = useRegional();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <>
    <div className="mt-2 flex flex-wrap items-center gap-2"><label>{t('records.from')} <input aria-label={t('records.startDate')} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{t('records.to')} <input aria-label={t('records.endDate')} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    {[1, 2, 3, 7].map(days => <button type="button" key={days} onClick={() => { const start = new Date(`${today}T12:00:00+05:00`); start.setUTCDate(start.getUTCDate() - days + 1); setFrom(start.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })); setTo(today); }}>{days === 1 ? t('records.today') : t('records.lastDays').replace('{days}', String(days))}</button>)}
    <button type="button" className="rounded bg-primary px-3 py-2 text-white" disabled={busy || !from || !to || from > to} onClick={async () => {
      const popup = window.open("", "_blank"); if (!popup) { setError(t('records.allowPopups')); return; }
      popup.opener = null; popup.document.body.textContent = t('records.preparingReport');
      setBusy(true); setError("");
      try { const res = await authorizedFetch(`/api/reports/business-records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); popup.document.open(); popup.document.write(businessReportHtml(from, to, data.sections, { printButton: t('report.printButton'), choosePdf: t('report.choosePdf'), businessRecords: t('report.businessRecords'), heading: t('report.heading'), rangeSeparator: t('buy.dateSeparator'), rangeSummary: t('report.rangeSummary'), disclaimer: t('report.disclaimer'), noRecords: t('report.noRecords') })); popup.document.close(); }
      catch (err) { popup.close(); setError(err instanceof Error ? err.message : t('records.reportFailed')); } finally { setBusy(false); }
    }}>{busy ? t('records.preparing') : t('records.exportPdf')}</button></div>{error && <p role="alert" className="text-destructive">{error}</p>}
  </>;
}
