import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PrintTemplateRepository } from "@/lib/print/print-template-store";
import { DEFAULT_PRINT_TEMPLATES, cloneDefaultTemplate } from "@/lib/print/default-templates";
import type { PrintDocumentType, PrintTemplate } from "@/lib/print/print-template-types";

export const runtime = "nodejs";

const DOC_TYPES: PrintDocumentType[] = ["sales_invoice", "load_form"];

function parseDocType(value: string | null): PrintDocumentType | null {
  return value && DOC_TYPES.includes(value as PrintDocumentType)
    ? (value as PrintDocumentType)
    : null;
}

/**
 * GET /api/print-templates?doc_type=sales_invoice
 * Returns the built-in default template plus the org's saved custom templates.
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const docType = parseDocType(searchParams.get("doc_type"));
  const repository = new PrintTemplateRepository();

  try {
    const saved = docType
      ? await repository.findByOrganization(permission.actor.organizationId, docType)
      : await repository.findByOrganization(permission.actor.organizationId);

    const defaults = DOC_TYPES.filter((t) => !docType || t === docType).map((t) => ({
      id: DEFAULT_PRINT_TEMPLATES[t].id,
      doc_type: t,
      name: DEFAULT_PRINT_TEMPLATES[t].name,
      description: DEFAULT_PRINT_TEMPLATES[t].description ?? null,
      config: cloneDefaultTemplate(t),
      is_default: true,
      is_builtin: true,
    }));

    const custom = saved.map((row) => ({
      id: row.id,
      doc_type: row.doc_type,
      name: row.name,
      description: row.description ?? null,
      config: row.config as PrintTemplate,
      is_default: false,
      is_builtin: false,
      updated_at: row.updated_at,
    }));

    return NextResponse.json({ ok: true, templates: [...defaults, ...custom] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load templates";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/print-templates
 * Body: { doc_type, name, description?, config }
 * Persists/overwrites a custom template by (org, doc_type, name).
 */
export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "sales_manage");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const docType = parseDocType((body.doc_type as string) ?? null);
  if (!docType) {
    return NextResponse.json({ ok: false, error: "doc_type must be sales_invoice or load_form." }, { status: 400 });
  }
  const name = (body.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Template name is required." }, { status: 400 });
  }
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json({ ok: false, error: "Template config is required." }, { status: 400 });
  }
  const config = { ...(body.config as PrintTemplate), docType, name, id: body.config.id };

  try {
    const repository = new PrintTemplateRepository();
    const row = await repository.save({
      organization_id: permission.actor.organizationId,
      doc_type: docType,
      name,
      description: (body.description as string | null) ?? null,
      config,
    });
    return NextResponse.json({ ok: true, template: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save template";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}