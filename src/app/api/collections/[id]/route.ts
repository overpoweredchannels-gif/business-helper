import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "draft_approval");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: { action?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ ok: false, error: "action must be approve or reject" }, { status: 400 });
  }

  const supabase = createSupabaseService();
  const now = new Date().toISOString();
  const { data, error } = await supabase.rpc("process_collection_decision", {
    p_organization_id: permission.actor.organizationId,
    p_collection_id: id,
    p_actor_profile_id: permission.actor.profileId,
    p_action: body.action,
    p_notes: body.notes ?? null,
    p_processed_at: now,
  });

  if (error) {
    const message = error.message || "Collection decision failed";
    const status =
      error.code === "P0002" && /collection not found/i.test(message)
        ? 404
        : error.code === "P0001" && /already/i.test(message)
          ? 409
          : error.code === "22023" || error.code === "42501"
            ? 400
            : 500;
    if (status === 500) {
      console.error("Atomic collection decision failed", {
        collectionId: id,
        organizationId: permission.actor.organizationId,
        code: error.code,
        message,
      });
    }
    return NextResponse.json(
      { ok: false, error: status === 500 ? "Failed to process collection." : message.replace(/^process_collection_decision:\s*/i, "") },
      { status }
    );
  }

  const result = (Array.isArray(data) ? data[0] : data) as {
    collection?: Record<string, unknown>;
    employee_profile_id?: string | null;
  } | null;
  const updated = result?.collection;
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Collection decision returned no result." }, { status: 500 });
  }

  // Notifications and audit logs are follow-up records; the financial state is
  // already committed atomically and must never be compensated in application code.
  if (result?.employee_profile_id) {
    await supabase.from("notifications").insert({
      organization_id: permission.actor.organizationId,
      recipient_profile_id: result.employee_profile_id,
      category: "collection",
      title: body.action === "approve" ? "Collection approved" : "Collection rejected",
      body: `${String(updated.amount ?? "")} collection ${body.action === "approve" ? "approved" : "rejected"}.`,
      entity_type: "collection",
      entity_id: id,
      channel: "in_app",
      is_read: false,
    });
  }

  await logAuditEvent({
    organizationId: permission.actor.organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: body.action === "approve" ? "collection_approved" : "collection_rejected",
    entityType: "collection",
    entityId: id,
    description: `Collection ${String(updated.amount ?? "")} ${body.action}`,
    success: true,
  });

  return NextResponse.json({ ok: true, collection: updated });
}
