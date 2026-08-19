import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/import-export/templates?entity_key=products
 * Returns saved templates for the entity + default (guessed) option.
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const entityKey = searchParams.get("entity_key");
  if (!entityKey) {
    return NextResponse.json({ ok: false, error: "entity_key is required" }, { status: 400 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    const { data, error } = await supabase
      .from("import_export_templates")
      .select("id, entity_key, name, description, mapping, is_default, created_at, updated_at")
      .eq("organization_id", organizationId)
      .eq("entity_key", entityKey)
      .order("name", { ascending: true });

    if (error) throw error;

    const templates = (data ?? []).map(row => ({
      id: row.id,
      entity_key: row.entity_key,
      name: row.name,
      description: row.description,
      mapping: row.mapping,
      is_default: row.is_default,
      is_builtin: false,
      updated_at: row.updated_at,
    }));

    // Add built-in default option
    const builtin = {
      id: "default",
      entity_key: entityKey,
      name: "Default (guessed)",
      description: "Auto-guess mapping from column headers",
      mapping: {},
      is_default: false,
      is_builtin: true,
      updated_at: null,
    };

    return NextResponse.json({ ok: true, templates: [builtin, ...templates] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load templates";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/import-export/templates
 * Body: { entity_key, name, description?, mapping }
 * Upserts a template by (org, entity_key, name).
 */
export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const entityKey = body.entity_key;
  const name = body.name?.trim();
  const description = body.description?.trim() ?? null;
  const mapping = body.mapping;

  if (!entityKey || !name || !mapping) {
    return NextResponse.json({ ok: false, error: "entity_key, name, and mapping are required" }, { status: 400 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    const { data, error } = await supabase
      .from("import_export_templates")
      .upsert({
        organization_id: organizationId,
        entity_key: entityKey,
        name,
        description,
        mapping,
        is_default: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,entity_key,name" })
      .select("id, entity_key, name, description, mapping, is_default, created_at, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, template: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save template";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/import-export/templates?id=...
 * Deletes a custom template (not built-in).
 */
export async function DELETE(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id || id === "default") {
    return NextResponse.json({ ok: false, error: "Cannot delete built-in template" }, { status: 400 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    const { error } = await supabase
      .from("import_export_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete template";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}