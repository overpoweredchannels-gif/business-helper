// TradeOS ERP — Universal Import/Export Processor
//
// Shared logic for parsing, validating, and importing data for any entity
// registered in the registry. Works with CSV, Excel (.xlsx/.xls), and ODS.

import * as XLSX from "xlsx";
import type {
  EntityImportConfig,
  ColumnMapping,
  ImportContext,
  ParsedRow,
  ImportPreviewResult,
  ImportRunResult,
  ImportStats,
  AuditLogParams,
  SupabaseClient,
} from "./types";
import { getEntityConfig } from "./registry";

const MAX_PREVIEW_ROWS = 100;
const DEFAULT_MAX_FILE_ROWS = 5000;

/** Parse CSV text into matrix of strings. */
export function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const matrix: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];
  
  for (const line of lines) {
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
      } else if (ch === "," && !inQuotes) {
        row.push(current.trim());
        current = "";
        i++;
      } else {
        current += ch;
        i++;
      }
    }
    row.push(current.trim());
    current = "";
    if (row.some((c) => c !== "")) {
      matrix.push(row);
      row = [];
    }
  }
  return matrix;
}

/** Read file (CSV/Excel/ODS) and return header row + data rows. */
export async function readImportFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const lower = file.name.toLowerCase();
  let matrix: string[][];
  
  if (lower.endsWith(".csv")) {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    matrix = parseCsv(text);
  } else {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("The file has no sheets.");
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    matrix = raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
  }
  
  const nonEmptyRows = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmptyRows.length < 2) {
    throw new Error("The file needs a header row plus at least one data row.");
  }
  
  const headerRow = nonEmptyRows[0].map((cell) => cell.trim());
  const body = nonEmptyRows.slice(1).map((row) => row.map((cell) => cell.trim()));
  
  return { headers: headerRow, rows: body };
}

/** Guess column mapping from header names. */
export function guessColumnMapping(headers: string[], fieldDefs: EntityImportConfig["fields"]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const fieldByLabel = new Map(fieldDefs.map((f) => [f.label.toLowerCase(), f.key]));
  const fieldByKey = new Map(fieldDefs.map((f) => [f.key.toLowerCase(), f.key]));
  
  for (const header of headers) {
    const h = header.toLowerCase();
    let matched = fieldByLabel.get(h) ?? fieldByKey.get(h);
    if (!matched) {
      // Fuzzy match
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

/** Parse a single cell value based on field definition. */
export async function parseCellValue(
  raw: string,
  field: EntityImportConfig["fields"][0],
  row: Record<string, string>,
  ctx: ImportContext
): Promise<unknown> {
  const trimmed = raw.trim();
  
  if (!trimmed) {
    return field.defaultValue ?? null;
  }
  
  if (field.parse) {
    return field.parse(trimmed, row, ctx);
  }
  
  switch (field.type) {
    case "number":
    case "decimal":
    case "integer": {
      const cleaned = trimmed.replace(/,/g, "");
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean": {
      const norm = trimmed.toLowerCase();
      if (["yes", "true", "1", "y", "on"].includes(norm)) return true;
      if (["no", "false", "0", "n", "off", "none"].includes(norm)) return false;
      return null;
    }
    case "date": {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
    }
    case "integer": {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
    }
    default:
      return trimmed;
  }
}

/** Validate a parsed row against field definitions. */
export async function validateParsedRow(
  parsed: Record<string, unknown>,
  fields: EntityImportConfig["fields"],
  ctx: ImportContext
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  for (const field of fields) {
    const value = parsed[field.key];
    
    if (field.required && (value === null || value === undefined || value === "")) {
      errors.push(`${field.label} is required`);
      continue;
    }
    
    if (value === null || value === undefined) continue;
    
    // Type-specific validation
    switch (field.type) {
      case "integer":
        if (!Number.isInteger(Number(value))) warnings.push(`${field.label} should be an integer`);
        break;
      case "decimal":
      case "number":
        if (isNaN(Number(value))) warnings.push(`${field.label} should be a number`);
        break;
      case "date":
        if (isNaN(new Date(String(value)).getTime())) warnings.push(`${field.label} is not a valid date`);
        break;
    }
    
    if (field.validate) {
      const customError = field.validate(value, parsed, ctx);
      if (customError) errors.push(customError);
    }
  }
  
  return { errors, warnings };
}

/** Build the preview result from parsed rows. */
export function buildPreviewResult(
  fileColumns: string[],
  rows: ParsedRow[],
  mode: "skip" | "update" | "error"
): ImportPreviewResult {
  const stats: ImportStats = {
    totalRows: rows.length,
    newCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    warningCount: 0,
  };
  
  const errorRows: { rowIndex: number; message: string }[] = [];
  
  for (const row of rows) {
    if (row.errors.length > 0) {
      stats.errorCount++;
      errorRows.push({ rowIndex: row.rowIndex, message: row.errors.join("; ") });
    } else if (row.status === "new") stats.newCount++;
    else if (row.status === "update") stats.updateCount++;
    else if (row.status === "skip") stats.skipCount++;
    else if (row.status === "warning") stats.warningCount++;
  }
  
  return { fileColumns, rows, stats, errorRows };
}

/** Run the actual import. */
export async function runImport(
  config: EntityImportConfig,
  preview: ImportPreviewResult,
  ctx: ImportContext
): Promise<ImportRunResult> {
  const result: ImportRunResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  
  const seenUniqueKeys = new Map<string, number>();
  
  for (const row of preview.rows) {
    if (row.errors.length > 0) {
      result.failed++;
      result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: row.errors.join(" ") });
      continue;
    }
    
    // Check for duplicates within the file
    const uniqueKey = buildUniqueKey(row, config);
    if (uniqueKey && seenUniqueKeys.has(uniqueKey)) {
      result.failed++;
      result.failures.push({
        rowLabel: `Row ${row.rowIndex}`,
        message: `Duplicate key "${uniqueKey}" already imported from this file; row skipped.`,
      });
      continue;
    }
    if (uniqueKey) seenUniqueKeys.set(uniqueKey, row.rowIndex);
    
    try {
      if (row.existingId !== null && row.existingId !== undefined) {
        if (ctx.duplicateMode === "skip") {
          result.skipped++;
          continue;
        }
        if (ctx.duplicateMode === "error") {
          result.failed++;
          result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: "Record already exists" });
          continue;
        }
        // Update mode
        if (config.applyUpdate) {
          const payload = await config.buildUpsertPayload!(row, ctx);
          await config.applyUpdate(row.existingId as any, payload, ctx);
          result.updated++;
        }
      } else {
        // Create new
        if (config.buildUpsertPayload) {
          const payload = await config.buildUpsertPayload(row, ctx);
          const { data, error } = await ctx.supabase
            .from(config.tableName)
            .insert({ ...payload, organization_id: ctx.orgId })
            .select()
            .single();
          if (error) throw error;
          (row as any).createdId = data.id;
          result.created++;
        }
      }
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: msg });
    }
  }
  
  // Run post-import hook if defined
  if (config.postImportHook) {
    const created = preview.rows.filter(r => r.status === "new" && r.errors.length === 0).map(r => ({ id: (r as any).createdId, rawValues: r.values }));
    const updated = preview.rows.filter(r => r.status === "update" && r.errors.length === 0).map(r => ({ id: r.existingId, rawValues: r.values }));
    await config.postImportHook(created, updated, ctx);
  }
  
  return result;
}

function buildUniqueKey(row: ParsedRow, config: EntityImportConfig): string | null {
  for (const keyCombo of config.uniqueKeys) {
    const parts = keyCombo.map(k => String(row.values[k] ?? "").trim()).filter(Boolean);
    if (parts.length === keyCombo.length && parts.every(p => p)) {
      return parts.join("|");
    }
  }
  return null;
}

/** Export data to CSV string. */
export function exportToCsv(rows: Record<string, unknown>[], columns: { key: string; label: string; transform?: (v: unknown, row: Record<string, unknown>) => string }[]): string {
  const headers = columns.map(c => c.label).join(",");
  const lines = [headers];
  
  for (const row of rows) {
    const values = columns.map(c => {
      const raw = row[c.key];
      let val = c.transform ? c.transform(raw, row) : raw;
      if (val === null || val === undefined) val = "";
      const str = String(val);
      // Escape CSV
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(","));
  }
  
  return lines.join("\n");
}

/** Export data to Excel (xlsx) buffer. */
export async function exportToXlsx(rows: Record<string, unknown>[], columns: { key: string; label: string; transform?: (v: unknown, row: Record<string, unknown>) => string }[], sheetName = "Export"): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const headers = columns.map(c => c.label);
  const data = [headers];
  
  for (const row of rows) {
    data.push(columns.map(c => {
      const raw = row[c.key];
      let val = c.transform ? c.transform(raw, row) : raw;
      return val === null || val === undefined ? "" : String(val);
    }));
  }
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

/** Log audit entry. */
export async function logAudit(auditLog: (params: AuditLogParams) => Promise<void>, params: AuditLogParams): Promise<void> {
  if (auditLog) await auditLog(params);
}