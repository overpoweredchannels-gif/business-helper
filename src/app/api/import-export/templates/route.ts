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
      .order("updated_at", { ascending: false }).order("id");

    if (error) throw error;

    const preferred = (data ?? []).find(row => row.is_default) ?? data?.[0];
    const templates = (data ?? []).map(row => ({
      id: row.id,
      entity_key: row.entity_key,
      name: row.name,
      description: row.description,
      mapping: row.mapping,
      is_default: row.id === preferred?.id,
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const mapping = body.mapping;

  if (typeof entityKey !== "string" || !entityKey || !name || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
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
        is_default: true,
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

// Rename in place: a failed rename must never delete the saved mapping.
export async function PATCH(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (typeof body.id !== "string" || (!name && body.set_default !== true)) return NextResponse.json({ ok: false, error: "Template ID and name or default selection required" }, { status: 400 });
  const { data, error } = await createSupabaseService().from("import_export_templates")
    .update({ ...(name ? { name } : {}), ...(body.set_default === true ? { is_default: true, updated_at: new Date().toISOString() } : {}) })
    .eq("id", body.id).eq("organization_id", permission.actor.organizationId).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ ok: false, error: error?.code === "23505" ? "A template already has this name. Choose another name." : error?.message ?? "Template not found" }, { status: error ? 400 : 404 });
  return NextResponse.json({ ok: true });
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
