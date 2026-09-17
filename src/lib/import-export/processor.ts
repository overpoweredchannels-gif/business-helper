// TradeOS ERP — Universal Import/Export Processor
//
// Shared logic for parsing, validating, and importing data for any entity
// registered in the registry. Works with CSV, Excel (.xlsx/.xls), and ODS.

import * as XLSX from "xlsx";
import type {
  EntityImportConfig,
  ImportContext,
  ParsedRow,
  ImportPreviewResult,
  ImportRunResult,
  ImportStats,
  AuditLogParams,
} from "./types";
import { parseCsv } from "@/lib/import-wizard/csv";
import { guessColumnMapping } from "./mapping";

export { parseCsv, guessColumnMapping };

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
    case "decimal": {
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
      const parsed = Number(trimmed.replace(/,/g, ""));
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
    if (row.warnings.length > 0) stats.warningCount++;
    if (row.errors.length > 0) {
      stats.errorCount++;
      errorRows.push({ rowIndex: row.rowIndex, message: row.errors.join("; ") });
    } else if (row.status === "new") stats.newCount++;
    else if (row.status === "update") {
      if (mode === "skip") stats.skipCount++;
      else if (mode === "error") {
        stats.errorCount++;
        errorRows.push({ rowIndex: row.rowIndex, message: "Record already exists" });
      } else stats.updateCount++;
    }
    else if (row.status === "skip") stats.skipCount++;
    else if (row.status === "warning") stats.newCount++;
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
  const successfullyCreated: Array<{ id: unknown; rawValues: Record<string, unknown> }> = [];
  const successfullyUpdated: Array<{ id: unknown; rawValues: Record<string, unknown> }> = [];

  if (config.insertBatchSize && config.uniqueKeys.length === 0) {
    await runBatchedInserts(config, preview.rows, ctx, result, successfullyCreated);
    await runPostImportHook(config, successfullyCreated, successfullyUpdated, ctx, result);
    return result;
  }
  
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
        if (!config.applyUpdate) throw new Error("This record does not support updates through import. Review the existing record in its ledger.");
        if (config.applyUpdate) {
          const payload = await config.buildUpsertPayload!(row, ctx);
          await config.applyUpdate({ id: row.existingId, rawValues: row.values }, payload, ctx);
          result.updated++;
          successfullyUpdated.push({ id: row.existingId, rawValues: row.values });
        }
      } else {
        // Create new
        if (config.buildUpsertPayload) {
          const payload = await config.buildUpsertPayload(row, ctx);
          if (config.createRecord) {
            const created = await config.createRecord(row, payload, ctx);
            const createdId = typeof created === "object" && created !== null && "id" in created
              ? (created as { id?: unknown }).id
              : null;
            (row as ParsedRow & { createdId?: unknown }).createdId = createdId;
            result.created++;
            successfullyCreated.push({ id: createdId, rawValues: row.values });
            continue;
          }
          const { data, error } = await ctx.supabase
            .from(config.tableName)
            .insert({ ...payload, organization_id: ctx.orgId })
            .select()
            .single();
          if (error) throw error;
          (row as any).createdId = data.id;
          result.created++;
          successfullyCreated.push({ id: data.id, rawValues: row.values });
        }
      }
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: msg });
    }
  }

  await runPostImportHook(config, successfullyCreated, successfullyUpdated, ctx, result);

  return result;
}

async function runBatchedInserts(
  config: EntityImportConfig,
  rows: ParsedRow[],
  ctx: ImportContext,
  result: ImportRunResult,
  successfullyCreated: Array<{ id: unknown; rawValues: Record<string, unknown> }>,
): Promise<void> {
  const prepared: Array<{ row: ParsedRow; payload: Record<string, unknown> }> = [];

  for (const row of rows) {
    if (row.errors.length > 0) {
      result.failed++;
      result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: row.errors.join(" ") });
      continue;
    }
    try {
      const payload = await config.buildUpsertPayload!(row, ctx);
      prepared.push({ row, payload: { ...payload, organization_id: ctx.orgId } });
    } catch (err) {
      result.failed++;
      result.failures.push({
        rowLabel: `Row ${row.rowIndex}`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const batchSize = Math.max(1, Math.min(config.insertBatchSize ?? 250, 1000));
  for (let offset = 0; offset < prepared.length; offset += batchSize) {
    const batch = prepared.slice(offset, offset + batchSize);
    const { data, error } = await ctx.supabase
      .from(config.tableName)
      .insert(batch.map((entry) => entry.payload))
      .select("id");

    if (!error) {
      result.created += batch.length;
      batch.forEach((entry, index) => {
        successfullyCreated.push({ id: data?.[index]?.id, rawValues: entry.row.values });
      });
      continue;
    }

    // A bad row must not prevent the rest of its batch from importing.
    for (const entry of batch) {
      const single = await ctx.supabase.from(config.tableName).insert(entry.payload).select("id").single();
      if (single.error) {
        result.failed++;
        result.failures.push({ rowLabel: `Row ${entry.row.rowIndex}`, message: single.error.message });
      } else {
        result.created++;
        successfullyCreated.push({ id: single.data?.id, rawValues: entry.row.values });
      }
    }
  }
}

async function runPostImportHook(
  config: EntityImportConfig,
  created: unknown[],
  updated: unknown[],
  ctx: ImportContext,
  result: ImportRunResult,
): Promise<void> {
  if (!config.postImportHook) return;
  try {
    await config.postImportHook(created, updated, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.failures.push({ rowLabel: "Post-import hook", message: msg });
  }
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
