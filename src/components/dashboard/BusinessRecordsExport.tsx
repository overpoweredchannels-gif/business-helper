"use client";
import { useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { businessReportHtml, type ReportSection } from "@/lib/print/business-report";
import { useRegional } from "@/components/regional/RegionalProvider";
import { downloadBusinessRecordsFile, runBusinessRecordsExport } from "@/lib/dashboard/business-records-export";

export function BusinessRecordsExport() {
  const { t } = useRegional();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  return <>
    <div className="records-export-controls mt-2 flex flex-wrap items-center gap-2"><label>{t('records.from')} <input aria-label={t('records.startDate')} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{t('records.to')} <input aria-label={t('records.endDate')} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    {[1, 2, 3, 7].map(days => <button type="button" key={days} onClick={() => { const start = new Date(`${today}T12:00:00+05:00`); start.setUTCDate(start.getUTCDate() - days + 1); setFrom(start.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })); setTo(today); }}>{days === 1 ? t('records.today') : t('records.lastDays').replace('{days}', String(days))}</button>)}
    <button type="button" className="records-export-submit rounded bg-primary px-3 py-2 text-white" disabled={busy || !from || !to || from > to} onClick={async () => {
      setBusy(true); setError(""); setNotice("");
      const result = await runBusinessRecordsExport(from, to, {
        openPopup: () => window.open("", "_blank"),
        fetchReport: async (f, tt) => {
          const res = await authorizedFetch(`/api/reports/business-records?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}`);
          const data = await res.json();
          return { ok: res.ok && data.ok === true, sections: data.sections, error: typeof data.error === "string" ? data.error : undefined };
        },
        buildHtml: (f, tt, sections) => businessReportHtml(f, tt, sections as ReportSection[], { printButton: t('report.printButton'), choosePdf: t('report.choosePdf'), businessRecords: t('report.businessRecords'), heading: t('report.heading'), rangeSeparator: t('buy.dateSeparator'), rangeSummary: t('report.rangeSummary'), disclaimer: t('report.disclaimer'), noRecords: t('report.noRecords') }),
        downloadHtml: (filename, html) => downloadBusinessRecordsFile(filename, html, "text/html"),
      }, { preparingReport: t('records.preparingReport'), reportFailed: t('records.reportFailed') });
      if (result.delivered === "error") setError(result.message);
      else if (result.delivered === "download") setNotice(t('records.reportDownloaded'));
      setBusy(false);
    }}>{busy ? t('records.preparing') : t('records.exportPdf')}</button></div>{error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p className="mt-2 text-sm text-muted-foreground">{notice}</p>}
  </>;
}
