"use client";
import { useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import type { PrintDocumentType, PrintTemplate } from "@/lib/print/print-template-types";
export function ReferenceTemplateReview({ docType, onAccept, previewRenderer }: { docType: PrintDocumentType; onAccept: (template: PrintTemplate) => void; previewRenderer: (template: PrintTemplate) => React.ReactNode }) {
  const [pending, setPending] = useState<{ template: PrintTemplate; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [show, setShow] = useState(false);
  return <section className="border-b p-3">
    <button type="button" className="underline" onClick={() => setShow(!show)}>Create from a reference PDF, image or spreadsheet</button>
    {show && <div className="space-y-3">
      <p className="text-sm">Upload a reference up to 3 MB. Spreadsheets are analyzed directly; PDFs and images use the configured recognition provider. Review the detected columns, settings and preview, then confirm and save.</p>
      <input type="file" aria-label="Reference print template" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.xml,.ods" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setError(""); setPending(null);
        if (!file.size || file.size > 3 * 1024 * 1024) { setError("Choose a non-empty reference file up to 3 MB."); return; }
        setBusy(true);
        try { const form = new FormData(); form.set("doc_type", docType); form.set("file", file); const res = await authorizedFetch("/api/print-templates/reference", { method: "POST", body: form }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error || "Recognition failed"); setPending(data); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not analyze reference"); } finally { setBusy(false); }
      }} />
      {busy && <p role="status">Recognizing layout…</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
      {pending && <div className="max-h-[65vh] overflow-auto rounded border p-3">
        <p><strong>Recognized settings — confirm before using</strong></p>
        <p>Font: {pending.template.fontFamily}. Heading: {pending.template.header.headingText}. Body: {pending.template.columns.rowSizePx}px.</p>
        <ul>{pending.template.columns.labels.map(column => <li key={column.key}>{column.label} → {column.key} ({Math.round(column.widthPct)}% width)</li>)}</ul>
        {pending.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-700">{warning}</p>)}
        <div className="my-3 overflow-auto">{previewRenderer(pending.template)}</div>
        <button type="button" className="rounded bg-primary px-3 py-2 text-white" onClick={() => { onAccept(pending.template); setPending(null); setShow(false); }}>Confirm these settings and edit</button>
        <button type="button" className="ml-3" onClick={() => setPending(null)}>Discard</button>
      </div>}
    </div>}
  </section>;
}
