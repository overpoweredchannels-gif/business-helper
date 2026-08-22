import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { getEntityConfig } from "@/lib/import-export/registry";
import { readImportFile, guessColumnMapping, parseCellValue, validateParsedRow, buildPreviewResult, runImport, logAudit } from "@/lib/import-export/processor";
import type { ColumnMapping, ImportContext, ParsedRow, ImportPreviewResult, ImportRunResult, ImportStats } from "@/lib/import-export/types";

export const runtime = "nodejs";

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
    const entityKey = formData.get("entity_key") as string;
    const mode = (formData.get("mode") as string) ?? "preview";
    const duplicateMode = (formData.get("duplicate_mode") as "skip" | "update" | "error") ?? "skip";
    const createMissingRefs = formData.get("create_missing_refs") === "true";
    const mappingStr = formData.get("mapping") as string;
    const file = formData.get("file") as File | null;
    const fileName = formData.get("file_name") as string;

    if (!entityKey || !file) {
      return NextResponse.json({ ok: false, error: "entity_key and file are required" }, { status: 400 });
    }

    const config = getEntityConfig(entityKey);
    if (!config) {
      return NextResponse.json({ ok: false, error: `Unknown entity: ${entityKey}` }, { status: 400 });
    }

    // Read and parse file
    const { headers, rows } = await readImportFile(file);
    if (rows.length > (config.maxRows ?? 5000)) {
      return NextResponse.json({ ok: false, error: `File exceeds max rows (${config.maxRows})` }, { status: 400 });
    }

    let mapping: Record<string, string> = mappingStr ? JSON.parse(mappingStr) : guessColumnMapping(headers, config.fields);
    let mappedCount = headers.filter(h => mapping[h] && mapping[h] !== "skip").length;

    // The client parses the file with its own parser (BOM strip, quoting). If
    // its header strings differ from ours (e.g. a UTF-8 BOM from Excel), the
    // sent mapping will miss every column. Re-guess against our headers.
    if (mappedCount === 0 && mappingStr) {
      const reguessed = guessColumnMapping(headers, config.fields);
      mappedCount = headers.filter(h => reguessed[h] && reguessed[h] !== "skip").length;
      if (mappedCount > 0) {
        mapping = reguessed;
      }
    }

    if (mappedCount === 0) {
      const recognized = config.fields.map(f => f.label).join(", ");
      return NextResponse.json({
        ok: false,
        error: `No columns mapped. File headers: ${headers.join(", ") || "(empty)"}. Recognized columns: ${recognized}`,
      }, { status: 400 });
    }

    // Parse all rows
    const fileColumns = headers;
    const parsedRows: any[] = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const raw: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        raw[headers[j]] = row[j] ?? "";
      }
      
      const values: Record<string, unknown> = {};
      for (const header of headers) {
        const fieldKey = mapping[header];
        if (!fieldKey || fieldKey === "skip") continue;
        const field = config.fields.find(f => f.key === fieldKey);
        if (!field) continue;
        const value = await parseCellValue(raw[header], field, raw, {} as any);
        values[fieldKey] = value;
      }
      
      const { errors, warnings } = await validateParsedRow(values, config.fields, {} as any);
      
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
    const existingCache = new Map<string, any>();
    const refCaches = new Map<string, Map<string, string>>();
    const stats: ImportStats = { totalRows: parsedRows.length, newCount: 0, updateCount: 0, skipCount: 0, errorCount: 0, warningCount: 0 };
    
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
        const existing = await config.findExisting(row, {
          orgId,
          supabase,
          actorProfileId: permission.actor.profileId,
          createMissingRefs,
          duplicateMode,
          fileName: fileName ?? "",
          fileHeaders: headers,
          mapping,
          existingCache,
          refCaches,
          stats,
        });
        if (existing) {
          existingId = (existing as any).id;
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

    // Build preview result
    const preview = buildPreviewResult(headers, parsedRows, duplicateMode);

    if (mode === "preview") {
      return NextResponse.json({ ok: true, preview });
    }

    // Run actual import
    // Create audit record
    const { data: auditRecord } = await supabase
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

    const importCtx = {
      orgId,
      supabase,
      actorProfileId: profileId,
      createMissingRefs,
      duplicateMode,
      fileName: fileName ?? "",
      fileHeaders: headers,
      mapping,
      existingCache,
      refCaches: new Map(),
      stats,
      auditLog: async (params: { action: string; entity_type: string; entity_id?: string | number | null; entity_label?: string | null; description?: string | null; old_values?: Record<string, unknown> | null; new_values?: Record<string, unknown> | null }) => {
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
      },
    };

    const result = await runImport(config, preview, importCtx);

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

function buildRowKey(row: any, config: any): string {
  for (const keyCombo of config.uniqueKeys) {
    const parts = keyCombo.map((k: string) => String(row.values[k] ?? "").trim()).filter(Boolean);
    if (parts.length === keyCombo.length && parts.every((p: string) => p)) {
      return parts.join("|");
    }
  }
  return "";
}
