import { reviewImportDuplicates } from "@/lib/import-export/review";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { getEntityConfig } from "@/lib/import-export/registry";
import { readImportFile, parseCellValue, validateParsedRow, buildPreviewResult, runImport } from "@/lib/import-export/processor";
import {
  DEFAULT_MAX_IMPORT_ROWS,
  PRESERVE_IN_NOTES,
  appendPreservedImportData,
  normalizeImportHeader,
  reconcileColumnMapping,
} from "@/lib/import-export/mapping";
import type { ColumnMapping, EntityImportConfig, ImportContext, ImportStats, ParsedRow } from "@/lib/import-export/types";

export const runtime = "nodejs";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/import-export/import
 * 
 * Body: { entity_key, file (FormData), mapping?, duplicate_mode?, create_missing_refs? }
 * 
 * Two modes:
 * 1. preview: returns ImportPreviewResult (no DB writes)
 * 2. run: executes import, returns ImportRunResult
 */
export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const orgId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const profileId = permission.actor.profileId;

  try {
    const formData = await request.formData();
    const entityKey = String(formData.get("entity_key") ?? "");
    const mode = String(formData.get("mode") ?? "preview");
    const duplicateModeValue = String(formData.get("duplicate_mode") ?? "error");
    const duplicateMode = duplicateModeValue as "skip" | "update" | "error";
    const createMissingRefs = formData.get("create_missing_refs") === "true";
    const mappingStr = formData.get("mapping") as string;
    const file = formData.get("file");
    const requestedFileName = String(formData.get("file_name") ?? "");

    if (!entityKey || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "entity_key and file are required" }, { status: 400 });
    }
    if (mode !== "preview" && mode !== "run") {
      return NextResponse.json({ ok: false, error: "mode must be preview or run" }, { status: 400 });
    }
    if (!(["skip", "update", "error"] as const).includes(duplicateMode)) {
      return NextResponse.json({ ok: false, error: "duplicate_mode must be skip, update, or error" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ ok: false, error: "Import files must be 10 MB or smaller" }, { status: 413 });
    }

    const config = getEntityConfig(entityKey);
    if (!config) {
      return NextResponse.json({ ok: false, error: `Unknown entity: ${entityKey}` }, { status: 400 });
    }

    // Read and parse file
    const { headers, rows } = await readImportFile(file);
    if (headers.some((header) => !normalizeImportHeader(header))) {
      return NextResponse.json({ ok: false, error: "Every source column needs a non-empty header" }, { status: 400 });
    }
    const normalizedHeaders = headers.map(normalizeImportHeader);
    if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
      return NextResponse.json({ ok: false, error: "The file contains duplicate column headers" }, { status: 400 });
    }
    const maxRows = config.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
    if (rows.length > maxRows) {
      return NextResponse.json({
        ok: false,
        error: `The file has ${rows.length} data rows; the ${config.entityName} import limit is ${maxRows}. This is a row limit, not a column limit.`,
      }, { status: 400 });
    }

    let savedMapping: ColumnMapping | null = null;
    if (mappingStr) {
      try {
        const parsed = JSON.parse(mappingStr);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) savedMapping = parsed;
      } catch {
        return NextResponse.json({ ok: false, error: "The column mapping is invalid. Return to mapping and try again." }, { status: 400 });
      }
    }
    const mapping = reconcileColumnMapping(headers, savedMapping, config.fields);
    const validFieldKeys = new Set(config.fields.map((field) => field.key));
    const mappedCount = headers.filter((header) => validFieldKeys.has(mapping[header])).length;

    if (mappedCount === 0) {
      const recognized = config.fields.map(f => f.label).join(", ");
      return NextResponse.json({
        ok: false,
        error: `No columns mapped. File headers: ${headers.join(", ") || "(empty)"}. Recognized columns: ${recognized}`,
      }, { status: 400 });
    }

    // Parse all rows
    const parsedRows: ParsedRow[] = [];
    const existingCache = new Map<string, unknown>();
    const refCaches = new Map<string, Map<string, string>>();
    const stats: ImportStats = { totalRows: rows.length, newCount: 0, updateCount: 0, skipCount: 0, errorCount: 0, warningCount: 0 };
    const fileName = requestedFileName || file.name;
    const importContext: ImportContext = {
      orgId,
      previewOnly: true,
      supabase,
      actorProfileId: profileId,
      createMissingRefs,
      duplicateMode,
      fileName,
      fileHeaders: headers,
      mapping,
      existingCache,
      refCaches,
      stats,
    };
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const raw: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        raw[headers[j]] = row[j] ?? "";
      }
      
      const values: Record<string, unknown> = {};
      for (const header of headers) {
        const fieldKey = mapping[header];
        if (!fieldKey || fieldKey === "skip" || fieldKey === PRESERVE_IN_NOTES) continue;
        const field = config.fields.find(f => f.key === fieldKey);
        if (!field) continue;
        const value = await parseCellValue(raw[header], field, raw, importContext);
        values[fieldKey] = value;
      }
      for (const field of config.fields) {
        if (field.required && field.defaultValue !== undefined && !Object.hasOwn(values, field.key)) values[field.key] = field.defaultValue;
      }
      appendPreservedImportData(values, raw, mapping, config.fields);
      
      const { errors, warnings } = await validateParsedRow(values, config.fields, importContext);
      
      parsedRows.push({
        rowIndex: i + 2, // 1-based, +1 for header
        raw,
        values,
        errors,
        warnings,
        existingId: null,
        status: errors.length > 0 ? "error" : "new",
      });
    }

    // Resolve existing records for duplicate detection
    for (const row of parsedRows) {
      if (row.errors.length > 0) {
        row.status = "error";
        stats.errorCount++;
        continue;
      }
      if (row.warnings.length > 0) stats.warningCount++;
      
      // Check for existing record
      let existingId = null;
      if (config.findExisting) {
        let existing;
        try { existing = await config.findExisting(row, importContext); } catch (error) {
          row.errors.push(error instanceof Error ? error.message : "Could not resolve record"); row.status = "error"; stats.errorCount++; continue;
        }
        if (existing) {
          existingId = typeof existing === "object" && existing !== null && "id" in existing
            ? (existing as { id?: string | number | null }).id ?? null
            : null;
          row.existingId = existingId;
          existingCache.set(buildRowKey(row, config), existingId);
        }
      }
      
      if (existingId) {
        row.status = "update";
      } else {
        row.status = "new";
      }
    }

    reviewImportDuplicates(parsedRows, config, duplicateMode);
    // Build preview result
    const preview = buildPreviewResult(headers, parsedRows, duplicateMode);

    if (mode === "preview") {
      return NextResponse.json({ ok: true, preview });
    }

    if (preview.stats.errorCount > 0 || preview.stats.newCount + preview.stats.updateCount === 0) {
      return NextResponse.json({ ok: false, error: "Nothing was saved. Resolve the review issues or duplicate handling and preview again.", preview }, { status: 409 });
    }
    importContext.previewOnly = false;
    // Run actual import
    // Create audit record
    const { data: auditRecord, error: auditError } = await supabase
      .from("import_exports")
      .insert({
        organization_id: orgId,
        operation_type: "import",
        entity_key: entityKey,
        file_name: fileName,
        file_size_bytes: file.size,
        status: "running",
        duplicate_mode: duplicateMode,
        total_rows: parsedRows.length,
        created_by_profile_id: profileId,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (auditError || !auditRecord?.id) throw new Error("Could not record this import in your business history. No records were imported. Try again or ask the owner to check import history setup.");

    importContext.auditLog = async (params) => {
        await supabase.from("audit_logs").insert({
          organization_id: orgId,
          action: params.action,
          entity_type: params.entity_type,
          entity_id: params.entity_id,
          entity_label: params.entity_label,
          description: params.description,
          old_values: params.old_values,
          new_values: params.new_values,
          actor_profile_id: profileId,
        });
      };

    const result = await runImport(config, preview, importContext);

    // Update audit record
    await supabase
      .from("import_exports")
      .update({
        status: result.failed > 0 && result.created + result.updated === 0 ? "failed" : "completed",
        created_count: result.created,
        updated_count: result.updated,
        skipped_count: result.skipped,
        failed_count: result.failed,
        error_details: result.failures.length > 0 ? { failures: result.failures } : null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", auditRecord?.id);

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function buildRowKey(row: ParsedRow, config: EntityImportConfig): string {
  for (const keyCombo of config.uniqueKeys) {
    const parts = keyCombo.map((k: string) => String(row.values[k] ?? "").trim()).filter(Boolean);
    if (parts.length === keyCombo.length && parts.every((p: string) => p)) {
      return parts.join("|");
    }
  }
  return "";
}
