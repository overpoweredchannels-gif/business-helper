"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { parseCsv } from "@/lib/import-wizard/csv";
import {
  getEntityConfig,
  type EntityImportConfig,
  type ColumnMapping,
  type ImportPreviewResult,
  type ImportRunResult,
  type ParsedRow,
} from "@/lib/import-export/registry";
import type { ImportFieldDef } from "@/lib/import-export/types";

const MAX_PREVIEW_ROWS = 100;
const MAX_FILE_ROWS = 5000;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  update: "Update",
  skipped: "Skipped",
  error: "Error",
  warning: "Import (fix)",
};

const inputCls =
  "w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

interface ImportWizardV2Props {
  entityKey: string;
  supabase: SupabaseClient;
  organizationId: string | null;
  actorProfileId: string | null;
  createAuditLog: (params: any) => Promise<void>;
  onImported: () => void;
  /** Optional: extra context passed to config functions. */
  extraContext?: Record<string, any>;
}

type Step = "file" | "mapping" | "preview" | "done";

export default function ImportWizardV2({
  entityKey,
  supabase,
  organizationId,
  actorProfileId,
  createAuditLog,
  onImported,
  extraContext,
}: ImportWizardV2Props) {
  const config = useMemo(() => getEntityConfig(entityKey), [entityKey]);
  
  if (!config) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-destructive">Unknown entity: {entityKey}</p>
      </div>
    );
  }
  
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<"skip" | "update" | "error">("skip");
  const [createMissingRefs, setCreateMissingRefs] = useState(true);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewRows = useMemo(
    () => (preview ? preview.rows.slice(0, MAX_PREVIEW_ROWS) : []),
    [preview]
  );

  const previewFields = useMemo(() => {
    if (!preview) return [] as string[];
    const order = config.fields
      .filter(f => f.preview !== false)
      .map(f => f.key);
    const used = new Set(preview.rows[0] ? Object.keys(preview.rows[0].values) : []);
    return order.filter(key => used.has(key));
  }, [preview, config]);

  const fieldLabel = (key: string) => {
    const field = config.fields.find(f => f.key === key);
    return field?.label ?? key;
  };

  const resetFile = useCallback(() => {
    setStep("file");
    setFileName("");
    setFileError(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setPreview(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFileChange = useCallback(async (file: File | undefined) => {
    setFileError(null);
    setPreview(null);
    setImportResult(null);
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!/\.(csv|xlsx|xls|ods)$/.test(lower)) {
      setFileError("Unsupported file type. Use .csv, .xlsx, .xls, or .ods files.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      let matrix: string[][];
      if (lower.endsWith(".csv")) {
        const text = new TextDecoder("utf-8").decode(buffer);
        matrix = parseCsv(text);
      } else {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          setFileError("The file has no sheets.");
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
        setFileError("The file needs a header row plus at least one data row.");
        return;
      }

      const headerRow = nonEmptyRows[0].map((cell) => cell.trim());
      const body = nonEmptyRows.slice(1);
      if (body.length > MAX_FILE_ROWS) {
        setFileError(`The file has ${body.length} data rows; the limit is ${MAX_FILE_ROWS}.`);
        return;
      }

      setFileName(file.name);
      setHeaders(headerRow);
      setDataRows(body);
      setStep("mapping");
      
      const defaultTemplate = templates.find((t) => t.id === defaultTemplateId);
      if (defaultTemplate) {
        setMapping({ ...defaultTemplate.mapping });
        setTemplateMessage(`Default template "${defaultTemplate.name}" applied.`);
      } else if (defaultTemplateId === "default") {
        const guessed = guessColumnMapping(headerRow, config.fields);
        setMapping(guessed);
        setTemplateMessage("Default (guessed) template applied.");
      } else {
        setMapping({});
        setTemplateMessage(null);
      }
    } catch (err) {
      setFileError(err instanceof Error ? `Failed to read file: ${err.message}` : "Failed to read file.");
    }
  }, [config]);

  const setFieldForColumn = useCallback((column: string, field: string) => {
    setMapping((prev) => ({ ...prev, [column]: field }));
  }, []);

  const handleRunPreview = useCallback(async () => {
    // This would call the API to generate preview
    // For now, we'll do client-side preview using the processor logic
    // In production, this calls the API
    const res = await authorizedFetch("/api/import-export/import", {
      method: "POST",
      body: JSON.stringify({
        entity_key: entityKey,
        mode: "preview",
        mapping: JSON.stringify(mapping),
        duplicate_mode: mode,
        create_missing_refs: createMissingRefs,
        file_name: fileName,
        // We'll send the file separately in production
      }),
      headers: { "Content-Type": "application/json" },
    });
    
    const data = await res.json();
    if (!data.ok) {
      setFileError(data.error || "Preview failed");
      return;
    }
    
    setPreview(data.preview);
    setStep("preview");
  }, [entityKey, mapping, mode, createMissingRefs, fileName]);

  // Simplified guessColumnMapping for client-side
  function guessColumnMapping(headers: string[], fields: ImportFieldDef[]): ColumnMapping {
    const mapping: ColumnMapping = {};
    const fieldByLabel = new Map(fields.map(f => [f.label.toLowerCase(), f.key]));
    const fieldByKey = new Map(fields.map(f => [f.key.toLowerCase(), f.key]));
    
    for (const header of headers) {
      const h = header.toLowerCase();
      let matched = fieldByLabel.get(h) ?? fieldByKey.get(h);
      if (!matched) {
        for (const [label, key] of fieldByLabel) {
          if (h.includes(label) || label.includes(h)) {
            matched = key;
            break;
          }
        }
      }
      mapping[header] = matched ?? "skip";
    }
    return mapping;
  }

  // ... rest of the component (truncated for brevity - similar to ImportWizard but generic)
  
  const mappedFieldCount = headers.filter((header) => mapping[header] && mapping[header] !== "skip").length;
  const hasNameMapping = headers.some((h) => mapping[h] === "name" || mapping[h] === "customer_name" || mapping[h] === "supplier_name" || mapping[h] === "full_name" || mapping[h] === "email");

  return (
    <div className="space-y-6">
      <div className="rounded border border-border bg-card p-4">
        <h3 className="mb-1 text-lg font-medium text-foreground">Import {config.entityName}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Upload a CSV, Excel (.xlsx / .xls), or OpenDocument (.ods) file. Map columns, preview, then import.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.ods"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-primary/90 sm:w-auto"
          />
          {fileName && <span className="text-sm text-muted-foreground">Selected: {fileName}</span>}
        </div>
        {fileError && <p className="mt-3 text-sm text-destructive">{fileError}</p>}
      </div>

      {step === "mapping" && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">Map Columns</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {headers.length} columns, {dataRows.length} data rows. Tell TradeOS what each column means.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>Load template</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t) {
                      if (t.id === "default") {
                        const guessed = guessColumnMapping(headers, config.fields);
                        setMapping(guessed);
                      } else {
                        setMapping({ ...t.mapping });
                      }
                    }
                  }
                }}
                className="rounded border border-border px-3 py-2"
              >
                <option value="">Select a template...</option>
                <option value="default">Default (guessed)</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.is_builtin ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>Save current mapping as</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                  className="rounded border border-border px-3 py-2"
                />
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="rounded border border-primary px-3 py-2 text-sm text-primary hover:bg-primary/5 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </label>
            {templates.length > 0 && (
              <div className="w-full">
                <span className="text-xs text-muted-foreground">Saved templates</span>
                <ul className="mt-1 space-y-1">
                  {templates.map((template) => (
                    <li key={template.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-sm">
                      <span className="flex-1 font-medium text-foreground/90">{template.name}</span>
                      <button type="button" onClick={() => {
                        if (template.id === "default") {
                          const guessed = guessColumnMapping(headers, config.fields);
                          setMapping(guessed);
                        } else {
                          setMapping({ ...template.mapping });
                        }
                      }} className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30">Load</button>
                      <button type="button" onClick={() => setEditingTemplateId(template.id)} className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30">Rename</button>
                      <button type="button" onClick={() => handleDeleteTemplate(template)} className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/5">Delete</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {templateMessage && <p className="text-xs text-muted-foreground">{templateMessage}</p>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">File Column</th>
                  <th className="py-2 font-medium">Import As</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-foreground">{header}</td>
                    <td className="py-2">
                      <select
                        value={mapping[header] ?? "skip"}
                        onChange={(e) => setFieldForColumn(header, e.target.value)}
                        className="rounded border border-border px-2 py-1.5"
                      >
                        {config.fields.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                        <option value="skip">— Skip —</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">Duplicate handling</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} className="h-4 w-4" />
                Skip rows that already exist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} className="h-4 w-4" />
                Update existing (by unique keys)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "error"} onChange={() => setMode("error")} className="h-4 w-4" />
                Error on duplicates
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={createMissingRefs} onChange={(e) => setCreateMissingRefs(e.target.checked)} className="h-4 w-4 accent-primary" />
                Auto-create missing reference records (brands, categories, etc.)
              </label>
            </div>
            <button
              type="button"
              onClick={handleRunPreview}
              disabled={mappedFieldCount === 0 || !hasNameMapping}
              className="rounded bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:bg-primary/30"
            >
              Preview Import
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="rounded border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <h3 className="text-lg font-medium text-foreground">Preview</h3>
              <span className="rounded bg-success/10 px-2 py-1 text-xs text-success">New: {preview.stats.newCount}</span>
              <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">Update: {preview.stats.updateCount}</span>
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">Skipped: {preview.stats.skipCount}</span>
              <span className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">Warnings: {preview.stats.warningCount}</span>
              <span className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">Errors: {preview.stats.errorCount}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.stats.errorCount > 0
                ? "Rows with an error are omitted. Everything else will be imported."
                : `Ready to import ${preview.stats.newCount + preview.stats.updateCount} rows.`}
            </p>
          </div>

          {preview.stats.errorCount > 0 && (
            <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
              <h4 className="mb-2 text-sm font-medium text-destructive">Rows that cannot be imported ({preview.stats.errorCount})</h4>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-destructive/90">
                {preview.errorRows.slice(0, 200).map((row, index) => (
                  <li key={index}>Row {row.rowIndex}: {row.message}</li>
                ))}
                {preview.errorRows.length > 200 && <li className="text-muted-foreground">...and {preview.errorRows.length - 200} more.</li>}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {previewFields.map((field) => (
                    <th key={field} className="px-3 py-2 font-medium">{fieldLabel(field)}</th>
                  ))}
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const status = row.errors.length > 0 ? "error" : row.existingId ? (mode === "update" ? "update" : "skipped") : row.warnings.length > 0 ? "warning" : "new";
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
                        }`}>{STATUS_LABEL[status]}</span>
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
                {preview.rows.length > MAX_PREVIEW_ROWS && (
                  <tr>
                    <td colSpan={previewFields.length + 3} className="px-3 py-2 text-sm text-muted-foreground">...and {preview.rows.length - MAX_PREVIEW_ROWS} more rows</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleRunImport} disabled={importing || preview.stats.newCount + preview.stats.updateCount === 0} className="rounded bg-success px-4 py-2 text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-success/30">
              {importing ? "Importing..." : `Import ${preview.stats.newCount + preview.stats.updateCount} rows`}
            </button>
            <button type="button" onClick={() => setStep("mapping")} disabled={importing} className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30">Back to Mapping</button>
            <button type="button" onClick={resetFile} disabled={importing} className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30">Cancel</button>
          </div>
        </div>
      )}

      {step === "done" && importResult && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">Import Complete</h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded bg-success/10 px-2 py-1 text-success">Created: {importResult.created}</span>
            <span className="rounded bg-primary/10 px-2 py-1 text-primary">Updated: {importResult.updated}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">Skipped: {importResult.skipped}</span>
            <span className="rounded bg-destructive/10 px-2 py-1 text-destructive">Failed: {importResult.failed}</span>
          </div>
          {importResult.failures.length > 0 && (
            <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-sm text-destructive">
              {importResult.failures.map((failure: any, index: number) => (
                <li key={index}>{failure.rowLabel}: {failure.message}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={resetFile} className="mt-4 rounded bg-primary px-4 py-2 text-white hover:bg-primary/90">Import Another File</button>
        </div>
      )}
    </div>
  );
}

function formatCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>;
  if (typeof value === "object") return <span className="text-muted-foreground">[Object]</span>;
  return String(value);
}

async function handleSaveTemplate() {}
async function handleDeleteTemplate(template: any) {}
async function handleRunImport() {}