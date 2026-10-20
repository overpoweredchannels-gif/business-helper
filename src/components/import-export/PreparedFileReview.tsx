"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { ColumnMapping, ImportFieldDef } from "@/lib/import-export/types";
import { prepareImportFile } from "@/lib/import-export/prepare-file";
import { useRegional } from "@/components/regional/RegionalProvider";

const LOCALES = { en: "en-PK", es: "es-ES", it: "it-IT", ur: "ur-PK" } as const;

export function PreparedFileReview({ headers, rows, mapping, fields, entity }: { headers: string[]; rows: string[][]; mapping: ColumnMapping; fields: ImportFieldDef[]; entity: string }) {
  const { t, language } = useRegional();
  const [page, setPage] = useState(0); const [message, setMessage] = useState("");
  const result = useMemo(() => { try { return { data: prepareImportFile(headers, rows, mapping, fields), error: "" }; } catch (error) { return { data: null, error: error instanceof Error ? error.message : t('wiz.preparedCheckMapping') }; } }, [headers, rows, mapping, fields, t]);
  const data = result.data; const lastPage = Math.max(0, Math.ceil(rows.length / 25) - 1); const currentPage = Math.min(page, lastPage);
  const action = "min-h-11 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary";
  const download = () => {
    if (!data) return;
    try {
      const workbook = XLSX.utils.book_new();
      // Explicit string cells preserve leading zeroes and do not create formulas.
      const sheet = XLSX.utils.aoa_to_sheet([data.keys, ...data.rows]);
      sheet["!cols"] = data.keys.map(key => ({ wch: Math.min(36, Math.max(18, key.length + 3)) }));
      XLSX.utils.book_append_sheet(workbook, sheet, "TradeOS Import");
      const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = `tradeos-${entity}-${data.incompleteRows ? "needs-review" : "prepared"}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(t('wiz.downloadOk'));
    } catch { setMessage(t('wiz.downloadFailed')); }
  };
  return <section className="my-4 rounded-xl border border-primary/30 bg-card p-4" aria-label={t('wiz.preparedAria')}>
    <h4 className="text-lg font-semibold">{t('wiz.preparedTitle')}</h4>
    <p className="my-2 text-sm text-muted-foreground">{t('wiz.preparedBody')}</p>
    {result.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
    {data && <><p className="my-2 text-sm">{t('wiz.preparedCounts').replace('{records}', data.rows.length.toLocaleString(LOCALES[language])).replace('{columns}', String(data.keys.length)).replace('{incomplete}', String(data.incompleteRows))}</p>{data.missing.length > 0 && <p className="mb-3 text-sm text-destructive">{t('wiz.preparedMissing').replace('{columns}', data.missing.join(", "))}</p>}
    <div className="max-h-80 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="p-2">{t('wiz.preparedRecordCol')}</th>{data.keys.map(key => <th key={key} className="whitespace-nowrap p-2">{fields.find(field => field.key === key)?.label ?? key}</th>)}</tr></thead><tbody>{data.rows.slice(currentPage * 25, currentPage * 25 + 25).map((row, index) => <tr key={index} className="border-t"><td className="p-2">{currentPage * 25 + index + 1}</td>{row.map((cell, column) => <td key={column} className="max-w-80 whitespace-pre-wrap break-words p-2">{cell || "—"}</td>)}</tr>)}</tbody></table></div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className={action} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('wiz.previousRecords')}</button><span className="text-sm">{t('wiz.pageSimple').replace('{page}', String(currentPage + 1)).replace('{total}', String(lastPage + 1))}</span><button type="button" className={action} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{t('wiz.nextRecords')}</button><button type="button" className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary" onClick={download}>{data.incompleteRows ? t('wiz.downloadDraft') : t('wiz.downloadPrepared')}</button></div></>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
