import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { getEntityConfig, getEntityExportConfig } from "@/lib/import-export/registry";
import { exportToCsv, exportToXlsx, logAudit } from "@/lib/import-export/processor";

export const runtime = "nodejs";

/**
 * GET /api/import-export/export?entity_key=products&format=csv&date_from=...&date_to=...
 * 
 * Returns CSV or XLSX file for download.
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const orgId = permission.actor.organizationId;
  const { searchParams } = new URL(request.url);
  const entityKey = searchParams.get("entity_key");
  const format = (searchParams.get("format") as "csv" | "xlsx") ?? "csv";
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");

  if (!entityKey) {
    return NextResponse.json({ ok: false, error: "entity_key is required" }, { status: 400 });
  }

  const config = getEntityConfig(entityKey);
  if (!config) {
    return NextResponse.json({ ok: false, error: `Unknown entity: ${entityKey}` }, { status: 400 });
  }

  const exportConfig = config.export;
  if (!exportConfig || !exportConfig.fetchData) {
    return NextResponse.json({ ok: false, error: "Export not supported for this entity" }, { status: 400 });
  }

  try {
    const filters: Record<string, any> = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const rawData = await exportConfig.fetchData(permission.actor.organizationId, filters);
    const data = rawData as Record<string, unknown>[];
    const columns = exportConfig.columns;

    const content = format === "xlsx" 
      ? await exportToXlsx(data, columns, entityKey)
      : exportToCsv(data, columns);

    const filename = `${exportConfig.filenamePrefix}_${new Date().toISOString().split("T")[0]}.${format === "xlsx" ? "xlsx" : "csv"}`;
    const contentType = format === "xlsx" 
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv; charset=utf-8";

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}