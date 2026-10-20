"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import type { MappingSuggestion } from "@/lib/import-export/ai-guidance";
import { historicalReviewSummary } from "@/lib/import-export/entities/historical-sales";
import { PreparedFileReview } from "./PreparedFileReview";
import { parseCsv } from "@/lib/import-wizard/csv";
import {
  getEntityConfig,
  type EntityImportConfig,
  type ColumnMapping,
  type ImportPreviewResult,
  type ImportRunResult,
} from "@/lib/import-export/registry";
import {
  DEFAULT_MAX_IMPORT_ROWS,
  PRESERVE_IN_NOTES,
  getUnmappedTargetField,
  normalizeImportHeader,
  reconcileColumnMapping,
} from "@/lib/import-export/mapping";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";

const MAX_PREVIEW_ROWS = 100;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const STATUS_LABEL_KEY: Record<string, MessageKey> = {
  new: "wiz.statusNew",
  update: "wiz.statusUpdate",
  skipped: "wiz.statusSkipped",
  error: "wiz.statusError",
  warning: "wiz.statusWarning",
};

interface ImportWizardV2Props {
  entityKey: string;
  supabase: SupabaseClient;
  organizationId: string | null;
  actorProfileId: string | null;
  createAuditLog: (params: any) => Promise<void>;
  onImported: () => void;
  onImportingChange?: (busy: boolean) => void;
  /** Optional: extra context passed to config functions. */
  extraContext?: Record<string, any>;
}

type Step = "file" | "mapping" | "preview" | "done";

export default function ImportWizardV2(props: ImportWizardV2Props) {
  const { t } = useRegional();
  const config = getEntityConfig(props.entityKey);
  if (!config) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-destructive">{t('wiz.unknownEntity')}: {props.entityKey}</p>
      </div>
    );
  }

  return <ImportWizardContent key={`${props.organizationId}:${props.entityKey}`} {...props} config={config} />;
}

function ImportWizardContent({
  entityKey,
  organizationId,
  onImported,
  onImportingChange,
  config,
}: ImportWizardV2Props & { config: EntityImportConfig }) {
  const { t } = useRegional();
  const [step, setStep] = useState<Step>("file");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState("");
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const aiRequest = useRef(0);
  useEffect(() => () => { aiRequest.current++; }, []);
  const requestGuidance = async () => {
    const version = ++aiRequest.current; setAiBusy(true); setAiNotice(""); setSuggestions([]);
    try {
      const response = await authorizedFetch("/api/import-export/guidance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_key: entityKey, headers }) });
      const result = await response.json();
      if (version !== aiRequest.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || t('wiz.aiUnavailable'));
      setSuggestions(result.suggestions); setAiNotice(result.suggestions.length ? t('wiz.aiSuggestionsReview') : t('wiz.aiNoMatches'));
    } catch (error) { if (version === aiRequest.current) setAiNotice(error instanceof Error ? error.message : t('wiz.aiUnavailableContinue')); }
    finally { if (version === aiRequest.current) setAiBusy(false); }
  };
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const historical = entityKey.startsWith("historical_");
  const [cutoverDate, setCutoverDate] = useState("");
  const [historyConfirmed, setHistoryConfirmed] = useState(false);
  const [mode, setMode] = useState<"skip" | "update" | "error">("error");
  const [createMissingRefs, setCreateMissingRefs] = useState(true);
  const [previewPage, setPreviewPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportRunResult | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [useManualMapping, setUseManualMapping] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewLock = useRef(false);
  const runLock = useRef(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string>("default");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await authorizedFetch(`/api/import-export/templates?entity_key=${encodeURIComponent(entityKey)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t('wiz.loadTemplatesFailed'));
      if (data.ok) {
        setTemplates(data.templates ?? []);
        const def = (data.templates ?? []).find((t: any) => t.is_default);
        setDefaultTemplateIdState(def ? def.id : "default");
      }
    } catch (error) {
      setTemplatesError(error instanceof Error ? error.message : t('wiz.loadTemplatesFailed'));
    } finally { setTemplatesLoading(false); }
  }, [entityKey, organizationId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const mappedFieldCount = headers.filter((header) => {
    const target = mapping[header];
    return target && target !== "skip" && target !== PRESERVE_IN_NOTES;
  }).length;
  const unmappedTargetField = getUnmappedTargetField(config.fields);

  const previewRows = useMemo(
    () => (preview ? preview.rows.slice(previewPage * MAX_PREVIEW_ROWS, (previewPage + 1) * MAX_PREVIEW_ROWS) : []),
    [preview, previewPage]
  );

  const historySummary = historical && preview && preview.stats.errorCount === 0 ? historicalReviewSummary(entityKey, preview.rows) : null;

  const previewFields = useMemo(() => {
    if (!preview) return [] as string[];
    const order = config.fields
      .filter(f => f.preview !== false)
      .map(f => f.key);
    const used = new Set(preview.rows[0] ? Object.keys(preview.rows[0].values) : []);
    const visible = order.filter(key => used.has(key));
    if (unmappedTargetField && used.has(unmappedTargetField) && !visible.includes(unmappedTargetField)) {
      visible.push(unmappedTargetField);
    }
    return visible;
  }, [preview, config, unmappedTargetField]);

  const fieldLabel = (key: string) => {
    const field = config.fields.find(f => f.key === key);
    return field?.label ?? key;
  };

  const resetFile = useCallback(() => {
    fileRef.current = null;
    aiRequest.current++; setAiBusy(false); setSuggestions([]); setAiNotice("");
    setStep("file");
    setFileName("");
    setFileError(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setPreview(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [setDataRows, setFileError, setFileName, setHeaders, setImportResult, setMapping, setPreview]);

  const handleFileChange = useCallback(async (file: File | undefined) => {
    aiRequest.current++; setAiBusy(false); setSuggestions([]); setAiNotice("");
    setFileError(null);
    setPreview(null);
    setImportResult(null);
    if (!file) return;

    fileRef.current = file;
    const lower = file.name.toLowerCase();
    if (!/\.(csv|xlsx|xls|ods|xml)$/.test(lower)) {
      setFileError(t('wiz.unsupportedFileType'));
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(t('wiz.fileTooLarge'));
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      if (fileRef.current !== file) return;
      let matrix: string[][];
      if (lower.endsWith(".csv")) {
        const text = new TextDecoder("utf-8").decode(buffer);
        matrix = parseCsv(text);
      } else {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          setFileError(t('wiz.noSheets'));
          return;
        }
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          raw: true,
        });
        matrix = raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
      }

      const nonEmptyRows = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
      if (nonEmptyRows.length < 2) {
        setFileError(t('wiz.needHeaderPlusRow'));
        return;
      }

      const headerRow = nonEmptyRows[0].map((cell) => cell.trim());
      const body = nonEmptyRows.slice(1);
      if (headerRow.some((header) => !normalizeImportHeader(header))) {
        setFileError(t('wiz.emptyHeader'));
        return;
      }
      const normalizedHeaders = headerRow.map(normalizeImportHeader);
      if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
        setFileError(t('wiz.duplicateHeaders'));
        return;
      }
      const maxRows = config.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
      if (body.length > maxRows) {
        setFileError(t('wiz.rowLimit').replace('{rows}', String(body.length)).replace('{entity}', config.entityName).replace('{max}', String(maxRows)));
        return;
      }

      setFileName(file.name);
      setHeaders(headerRow);
      setDataRows(body);
      setStep("mapping");
      
      const defaultTemplate = templates.find((t) => t.id === defaultTemplateId);
      if (defaultTemplate) {
        setMapping(reconcileColumnMapping(headerRow, defaultTemplate.mapping, config.fields));
        setTemplateMessage(t('wiz.defaultTemplateApplied').replace('{name}', defaultTemplate.name));
      } else {
        setMapping(reconcileColumnMapping(headerRow, null, config.fields));
        setTemplateMessage(t('wiz.guessedTemplateApplied'));
      }
    } catch (err) {
      if (fileRef.current === file) setFileError(err instanceof Error ? t('wiz.failedReadFileMsg').replace('{message}', err.message) : t('wiz.failedReadFile'));
    }
  }, [config, templates, defaultTemplateId, setDataRows, setFileError, setFileName, setHeaders, setImportResult, setMapping, setPreview, setTemplateMessage]);

  const setFieldForColumn = useCallback((column: string, field: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (field !== "skip" && field !== PRESERVE_IN_NOTES) {
        for (const source of Object.keys(next)) if (source !== column && next[source] === field) next[source] = "skip";
      }
      next[column] = field;
      return next;
    });
  }, [setMapping]);

  const handleRunPreview = useCallback(async () => {
    if (previewLock.current) return;
    if (historical && (!cutoverDate || !historyConfirmed)) { setFileError(t('wiz.chooseCutover')); return; }
    if (!fileRef.current) {
      setFileError(t('wiz.selectFileFirst'));
      return;
    }
    previewLock.current = true;
    setPreviewBusy(true);
    onImportingChange?.(true);
    setFileError(null);
    try {
      const formData = new FormData();
      formData.set("entity_key", entityKey);
      formData.set("cutover_date", cutoverDate);
      formData.set("mode", "preview");
      formData.set("duplicate_mode", mode);
      formData.set("create_missing_refs", String(createMissingRefs));
      formData.set("mapping", JSON.stringify(mapping));
      formData.set("file_name", fileName);
      formData.set("file", fileRef.current);

      const res = await authorizedFetch("/api/import-export/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!data.ok) {
        setFileError(data.error || t('wiz.previewFailed'));
        return;
      }

      setPreviewPage(0);
      setPreview(data.preview);
      setStep("preview");
    } catch (err) {
      setFileError(err instanceof Error ? t('wiz.previewFailedMsg').replace('{message}', err.message) : t('wiz.previewFailed'));
    } finally {
      previewLock.current = false;
      setPreviewBusy(false);
      onImportingChange?.(false);
    }
  }, [entityKey, mapping, mode, createMissingRefs, fileName, cutoverDate, onImportingChange, setFileError, setPreview, setPreviewBusy, setPreviewPage, historical, historyConfirmed]);

  const handleRunImport = useCallback(async () => {
    if (!fileRef.current || !preview || preview.stats.errorCount > 0 || runLock.current) return;
    runLock.current = true;
    setImporting(true);
    onImportingChange?.(true);
    setFileError(null);
    try {
      const formData = new FormData();
      formData.set("entity_key", entityKey);
      formData.set("cutover_date", cutoverDate);
      formData.set("mode", "run");
      formData.set("duplicate_mode", mode);
      formData.set("create_missing_refs", String(createMissingRefs));
      formData.set("mapping", JSON.stringify(mapping));
      formData.set("file_name", fileName);
      formData.set("file", fileRef.current);

      const res = await authorizedFetch("/api/import-export/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!data.ok) {
        setFileError(data.error || t('wiz.importFailed'));
        if (data.preview) { setPreview(data.preview); setPreviewPage(0); setStep("preview"); }
        return;
      }

      setImportResult(data.result);
      setStep("done");
      onImported();
      window.dispatchEvent(new CustomEvent("tradeos:import-complete"));
    } catch (err) {
      setFileError(err instanceof Error ? t('wiz.importFailedMsg').replace('{message}', err.message) : t('wiz.importFailed'));
    } finally {
      setImporting(false);
      runLock.current = false;
      onImportingChange?.(false);
    }
  }, [entityKey, mapping, mode, createMissingRefs, fileName, cutoverDate, preview, onImported, onImportingChange, setFileError, setImportResult, setImporting, setPreview, setPreviewPage]);

  const handleSaveTemplate = useCallback(async () => {
    const name = templateName.trim();
    if (!name || mappedFieldCount === 0) return;
    try {
      const res = await authorizedFetch("/api/import-export/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_key: entityKey,
          name,
          mapping,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setTemplateMessage(data.error || t('wiz.saveTemplateFailed'));
        return;
      }
      setTemplateName("");
      setTemplateMessage(t('wiz.templateSaved').replace('{name}', name));
      loadTemplates();
    } catch (err) {
      setTemplateMessage(err instanceof Error ? t('wiz.saveTemplateFailedMsg').replace('{message}', err.message) : t('wiz.saveTemplateFailed'));
    }
  }, [entityKey, templateName, mapping, mappedFieldCount, loadTemplates, setTemplateMessage, setTemplateName]);

  const handleRenameTemplate = useCallback(async (template: any) => {
    const name = editingTemplateName.trim();
    if (!name || !editingTemplateId) return;
    try {
      if (name !== template.name) {
        const response = await authorizedFetch("/api/import-export/templates", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: template.id, name }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || t('wiz.renameFailed'));
      }
      setEditingTemplateId(null);
      setEditingTemplateName("");
      loadTemplates();
    } catch (err) {
      setTemplateMessage(err instanceof Error ? t('wiz.renameTemplateFailedMsg').replace('{message}', err.message) : t('wiz.renameTemplateFailed'));
    }
  }, [entityKey, editingTemplateId, editingTemplateName, loadTemplates]);

  const handleDeleteTemplate = useCallback(async (template: any) => {
    if (template.is_builtin) return;
    try {
      const res = await authorizedFetch(`/api/import-export/templates?id=${template.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.ok) {
        setTemplateMessage(data.error || t('wiz.deleteTemplateFailed'));
        return;
      }
      setTemplateMessage(t('wiz.templateDeleted').replace('{name}', template.name));
      loadTemplates();
    } catch (err) {
      setTemplateMessage(err instanceof Error ? t('wiz.deleteTemplateFailedMsg').replace('{message}', err.message) : t('wiz.deleteTemplateFailed'));
    }
  }, [loadTemplates, setTemplateMessage]);

  return (
    <div className="import-workflow space-y-6">
      <fieldset disabled={previewBusy || importing} className="min-w-0 rounded border border-border bg-card p-4">
        <h3 className="mb-1 text-lg font-medium text-foreground">{t('importexport.import')} {config.entityName}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {t('wiz.uploadIntro')}
        </p>

        {["sales_invoices", "purchases", "customer_payments", "supplier_payments"].includes(entityKey) && <p className="rounded-lg border border-amber-300 bg-amber-50/10 p-3 text-sm"><strong>{t('wiz.liveRecordsTitle')}</strong> {t('wiz.liveRecordsBody')}</p>}
        <div onDragOver={event => { event.preventDefault(); if (!previewBusy && !importing) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (previewBusy || importing || templatesLoading || (templatesError && !useManualMapping)) return; if (event.dataTransfer.files.length !== 1) { setFileError(t('wiz.dropOneFile')); return; } void handleFileChange(event.dataTransfer.files[0]); }} className={`flex flex-col gap-3 rounded-xl border-2 border-dashed p-5 ${dragging ? "border-primary bg-primary/10" : "border-border"}`}>
          <p className="font-medium">{t('wiz.dragOrChoose')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.ods,.xml"
            disabled={templatesLoading || (Boolean(templatesError) && !useManualMapping)}
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-primary/90 sm:w-auto"
          />
          {fileName && <span className="text-sm text-muted-foreground">{t('wiz.selectedFile').replace('{name}', fileName)}</span>}
        </div>
        {templatesLoading && <p role="status">{t('wiz.loadingTemplates')}</p>}
        {templatesError && <div role="alert" className="rounded-lg border border-warning/40 p-3 text-sm"><p>{t('wiz.templatesLoadError')}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border px-3 py-2" onClick={loadTemplates}>{t('wiz.retryTemplates')}</button><button type="button" className="min-h-11 rounded-lg border px-3 py-2" onClick={() => setUseManualMapping(true)}>{t('wiz.continueManual')}</button></div></div>}
        {!templatesLoading && !templatesError && <p className="text-sm">{t('wiz.savedTemplatesCount').replace('{count}', String(templates.filter(t => !t.is_builtin).length)).replace('{entity}', config.entityName).replace('{name}', templates.find(t => t.id === defaultTemplateId)?.name ?? t('wiz.suggestedMapping'))}</p>}
        {fileError && <p role="alert" className="mt-3 text-sm text-destructive">{fileError}</p>}
      </fieldset>

      {step === "mapping" && (
        <fieldset disabled={previewBusy} aria-busy={previewBusy} className="min-w-0 rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">{t('wiz.mapColumns')}</h3>
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h4 className="font-semibold">{t('wiz.aiGuideTitle')}</h4><p className="my-2 text-sm">{t('wiz.aiGuideBody')}</p>
            <button type="button" disabled={aiBusy} onClick={() => void requestGuidance()} className="min-h-11 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary disabled:opacity-50">{aiBusy ? t('wiz.analyzing') : t('wiz.suggestMappings')}</button>
            {aiNotice && <p role="status" className="mt-3 text-sm">{aiNotice}</p>}
            {suggestions.length > 0 && <><ul className="my-3 space-y-1 text-sm">{suggestions.map(item => <li key={item.header}>{item.header} → {config.fields.find(field => field.key === item.field)?.label ?? item.field}</li>)}</ul><button type="button" className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => { setMapping(current => { const next = { ...current }; for (const item of suggestions) { if (next[item.header] && next[item.header] !== "skip") continue; if (Object.values(next).includes(item.field)) continue; next[item.header] = item.field; } return next; }); setSuggestions([]); setAiNotice(t('wiz.suggestionsApplied')); }}>{t('wiz.applyUnmapped')}</button></>}
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('wiz.columnsSummary').replace('{columns}', String(headers.length)).replace('{rows}', String(dataRows.length))}
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>{t('wiz.loadTemplate')}</span>
              <select
                value={defaultTemplateId}
                onChange={(e) => {
                  if (e.target.value) {
                    setDefaultTemplateIdState(e.target.value);
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t) {
                      if (t.id === "default") {
                        setMapping(reconcileColumnMapping(headers, null, config.fields));
                      } else {
                        setMapping(reconcileColumnMapping(headers, t.mapping, config.fields));
                      }
                    }
                  }
                }}
                className="rounded border border-border px-3 py-2"
              >
                <option value="">{t('wiz.selectTemplate')}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.is_builtin ? t('wiz.defaultSuffix') : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>{t('wiz.saveMappingAs')}</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t('wiz.templateNamePlaceholder')}
                  className="rounded border border-border px-3 py-2"
                />
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="rounded border border-primary px-3 py-2 text-sm text-primary hover:bg-primary/5 disabled:opacity-40"
                >
                  {t('common.save')}
                </button>
              </div>
            </label>
            {templates.length > 0 && (
              <div className="w-full">
                <span className="text-xs text-muted-foreground">{t('wiz.savedTemplates')}</span>
                <ul className="mt-1 space-y-1">
                  {templates.map((template) => (
                    <li key={template.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-sm">
                      {editingTemplateId === template.id ? (
                        <>
                          <input
                            type="text"
                            value={editingTemplateName}
                            onChange={(e) => setEditingTemplateName(e.target.value)}
                            placeholder={t('wiz.newTemplateNamePlaceholder')}
                            className="flex-1 rounded border border-border px-2 py-1 text-sm"
                          />
                          <button type="button" onClick={() => handleRenameTemplate(template)} disabled={!editingTemplateName.trim()} className="rounded border border-primary px-2 py-1 text-xs text-primary hover:bg-primary/5 disabled:opacity-40">{t('common.save')}</button>
                          <button type="button" onClick={() => { setEditingTemplateId(null); setEditingTemplateName(""); }} className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30">{t('common.cancel')}</button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 font-medium text-foreground/90">{template.name}{template.is_default ? t('wiz.preferredSuffix') : ""}</span>
                          <button type="button" onClick={() => {
                            if (template.id === "default") {
                              setMapping(reconcileColumnMapping(headers, null, config.fields));
                            } else {
                              setMapping(reconcileColumnMapping(headers, template.mapping, config.fields));
                            }
                          }} className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30">{t('wiz.load')}</button>
                          {!template.is_builtin && (
                            <>
                              <button type="button" onClick={async () => {
                                try {
                                  const res = await authorizedFetch("/api/import-export/templates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: template.id, set_default: true }) });
                                  const result = await res.json(); if (!res.ok || !result.ok) throw new Error(result.error || t('wiz.setPreferredFailed'));
                                  await loadTemplates(); setTemplateMessage(t('wiz.preferredSaved'));
                                } catch (error) { setTemplateMessage(error instanceof Error ? error.message : t('wiz.savePreferenceFailed')); }
                              }} className="rounded border px-2 py-1 text-xs">{t('wiz.useFuture')}</button>
                              <button type="button" onClick={() => { setEditingTemplateId(template.id); setEditingTemplateName(template.name); }} className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30">{t('wiz.rename')}</button>
                              <button type="button" onClick={() => handleDeleteTemplate(template)} className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/5">{t('common.delete')}</button>
                            </>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {templateMessage && <p className="text-xs text-muted-foreground">{templateMessage}</p>}
          </div>

          <div className="mb-3 rounded border border-amber-300 p-3 text-sm">
            <strong>{t('wiz.unsetTitle')}</strong>
            <p>{config.fields.filter(field => !Object.values(mapping).includes(field.key)).map(field => field.label + (field.defaultValue !== undefined ? t('wiz.newRecordsDefault').replace('{value}', String(field.defaultValue)) : "")).join(", ") || t('wiz.allFieldsMapped')}</p>
            <p>{t('wiz.unsetBody')}</p>
            {entityKey === "employees" && <p>{t('wiz.employeesNote')}</p>}
            {entityKey === "customers" && <p>{t('wiz.customersNote')}</p>}
            {["customer_payments", "supplier_payments"].includes(entityKey) && <p>{t('wiz.paymentsNote')}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t('wiz.fileColumn')}</th>
                  <th className="py-2 font-medium">{t('wiz.importAs')}</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-foreground">{header}</td>
                    <td className="py-2">
                      <select
                        aria-label={t('wiz.mappingFor').replace('{column}', header)}
                        value={mapping[header] ?? "skip"}
                        onChange={(e) => setFieldForColumn(header, e.target.value)}
                        className="rounded border border-border px-2 py-1.5"
                      >
                        {config.fields.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                        {unmappedTargetField && (
                          <option value={PRESERVE_IN_NOTES}>{t('wiz.keepIn').replace('{field}', fieldLabel(unmappedTargetField))}</option>
                        )}
                        <option value="skip">{t('wiz.skipOption')}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {historical && <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <h4 className="font-semibold">{t('wiz.historyTitle')}</h4><p className="text-sm">{t('wiz.historyBody')}</p>
            <label className="grid gap-1 text-sm">{t('wiz.cutoverLabel')}<input type="date" className="min-h-11 rounded-lg border border-border bg-background px-3 py-2" value={cutoverDate} onChange={event=>{setCutoverDate(event.target.value);setHistoryConfirmed(false);}} /></label>
            <p className="text-sm">{t('wiz.historyDateNote')}</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={historyConfirmed} onChange={event=>setHistoryConfirmed(event.target.checked)}/>{t('wiz.historyConfirm')}</label>
          </div>}
          <PreparedFileReview headers={headers} rows={dataRows} mapping={mapping} fields={config.fields} entity={entityKey} />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">{t('wiz.duplicateHandling')}</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} className="h-4 w-4" />
                {t('wiz.dupSkip')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" disabled={historical} checked={mode === "update"} onChange={() => setMode("update")} className="h-4 w-4" />
                {t('wiz.dupUpdate')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "error"} onChange={() => setMode("error")} className="h-4 w-4" />
                {t('wiz.dupReview')}
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={historical} checked={!historical && createMissingRefs} onChange={(e) => setCreateMissingRefs(e.target.checked)} className="h-4 w-4 accent-primary" />
                {t('wiz.autoCreateRefs')}
              </label>
            </div>
            <button
              type="button"
              onClick={handleRunPreview}
              disabled={previewBusy || mappedFieldCount === 0}
              className="rounded bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:bg-primary/30"
            >
              {previewBusy ? t('wiz.checkingFile') : t('wiz.previewImport')}
            </button>
          </div>
        </fieldset>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="rounded border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <h3 className="text-lg font-medium text-foreground">{t('wiz.previewTitle')}</h3>
              <span className="rounded bg-success/10 px-2 py-1 text-xs text-success">{t('wiz.statNew').replace('{count}', String(preview.stats.newCount))}</span>
              <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">{t('wiz.statUpdate').replace('{count}', String(preview.stats.updateCount))}</span>
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{t('wiz.statSkipped').replace('{count}', String(preview.stats.skipCount))}</span>
              <span className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">{t('wiz.statWarnings').replace('{count}', String(preview.stats.warningCount))}</span>
              <span className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{t('wiz.statErrors').replace('{count}', String(preview.stats.errorCount))}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.stats.errorCount > 0
                ? t('wiz.resolveIssues')
                : t('wiz.readyToImport').replace('{count}', String(preview.stats.newCount + preview.stats.updateCount))}
            </p>
          </div>

          {preview.stats.errorCount > 0 && (
            <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
              <h4 className="mb-2 text-sm font-medium text-destructive">{t('wiz.rowsCannotImport').replace('{count}', String(preview.stats.errorCount))}</h4>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-destructive/90">
                {preview.errorRows.slice(0, 200).map((row, index) => (
                  <li key={index}>{t('wiz.rowPrefix').replace('{row}', String(row.rowIndex))}: {row.message}</li>
                ))}
                {preview.errorRows.length > 200 && <li className="text-muted-foreground">{t('wiz.andMore').replace('{count}', String(preview.errorRows.length - 200))}</li>}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('wiz.colRow')}</th>
                  <th className="px-3 py-2 font-medium">{t('wiz.colStatus')}</th>
                  {previewFields.map((field) => (
                    <th key={field} className="px-3 py-2 font-medium">{fieldLabel(field)}</th>
                  ))}
                  <th className="px-3 py-2 font-medium">{t('wiz.colNotes')}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const status = row.errors.length > 0 ? "error" : row.existingId ? (mode === "update" ? "update" : mode === "error" ? "error" : "skipped") : row.warnings.length > 0 ? "warning" : "new";
                  return (
                    <tr key={row.rowIndex} className="border-b border-border/50 align-top">
                      <td className="px-3 py-2 text-muted-foreground">{row.rowIndex}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          status === "error" ? "bg-destructive/10 text-destructive" :
                          status === "skipped" ? "bg-muted text-muted-foreground" :
                          status === "update" ? "bg-primary/10 text-primary" :
                          status === "warning" ? "bg-warning/10 text-warning" :
                          "bg-success/10 text-success"
                        }`}>{t(STATUS_LABEL_KEY[status])}</span>
                      </td>
                      {previewFields.map((field) => (
                        <td key={field} className="px-3 py-2">{formatCellValue(row.values[field])}</td>
                      ))}
                      <td className="px-3 py-2 text-xs">
                        {row.errors.length > 0 ? <span className="text-destructive">{row.errors.join(" ")}</span> : row.warnings.length > 0 ? <span className="text-warning">{row.warnings.join(" ")}</span> : <span className="text-muted-foreground">-</span>}
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 text-sm"><button type="button" className="rounded-lg border border-border px-3 py-2 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" disabled={previewPage === 0 || importing} onClick={() => setPreviewPage(page => page - 1)}>{t('wiz.previousRows')}</button><span>{t('wiz.pageOf').replace('{page}', String(previewPage + 1)).replace('{total}', String(Math.max(1, Math.ceil(preview.rows.length / MAX_PREVIEW_ROWS)))).replace('{count}', String(preview.rows.length))}</span><button type="button" className="rounded-lg border border-border px-3 py-2 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" disabled={(previewPage + 1) * MAX_PREVIEW_ROWS >= preview.rows.length || importing} onClick={() => setPreviewPage(page => page + 1)}>{t('wiz.nextRows')}</button></div>
          {preview.stats.skipCount > 0 && <div role="status" className="rounded-lg border border-warning p-4 text-sm"><strong>{t('wiz.whySkippedTitle')}</strong><p>{t('wiz.whySkippedBody')}</p></div>}
          <p className="text-sm">{historical && t('wiz.historyPrefix').replace('{date}', cutoverDate)}{t('wiz.importDirectNote')}</p>
          {historySummary && <p className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm"><strong>{t('wiz.historySummaryMain').replace('{documents}', String(historySummary.documents)).replace('{total}', historySummary.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</strong>. {t('wiz.historySummaryNote')}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleRunImport} disabled={importing || preview.stats.errorCount > 0 || preview.stats.newCount + preview.stats.updateCount === 0} className="rounded bg-success px-4 py-2 text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-success/30">
              {importing ? t('wiz.importing') : t('wiz.importRows').replace('{count}', String(preview.stats.newCount + preview.stats.updateCount))}
            </button>
            <button type="button" onClick={() => setStep("mapping")} disabled={importing} className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30">{t('wiz.backToMapping')}</button>
            <button type="button" onClick={resetFile} disabled={importing} className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {step === "done" && importResult && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">{t('wiz.importComplete')}</h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded bg-success/10 px-2 py-1 text-success">{historical ? t('wiz.savedSourceRowsLabel') : t('wiz.createdLabel')}: {importResult.created}</span>
            <span className="rounded bg-primary/10 px-2 py-1 text-primary">{t('wiz.updatedLabel')}: {importResult.updated}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">{t('wiz.skippedLabel')}: {importResult.skipped}</span>
            <span className="rounded bg-destructive/10 px-2 py-1 text-destructive">{t('wiz.failedLabel')}: {importResult.failed}</span>
          </div>
          {importResult.failures.length > 0 && (
            <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-sm text-destructive">
              {importResult.failures.map((failure: any, index: number) => (
                <li key={index}>{failure.rowLabel}: {failure.message}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={resetFile} className="mt-4 rounded bg-primary px-4 py-2 text-white hover:bg-primary/90">{t('wiz.importAnother')}</button>
        </div>
      )}
    </div>
  );
}

function ObjectCellValue() {
  const { t } = useRegional();
  return <span className="text-muted-foreground">{t('wiz.objectValue')}</span>;
}

function formatCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>;
  if (typeof value === "object") return <ObjectCellValue />;
  return String(value);
}
