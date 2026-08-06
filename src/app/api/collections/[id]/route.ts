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

  const { data: existing } = await supabase
    .from("collections")
    .select("id, organization_id, status, employee_id, amount, customer_id, notes")
    .eq("id", id)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: false, error: "Collection not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ ok: false, error: `Collection is already ${existing.status}` }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (body.action === "approve") {
    // Reduce customer outstanding balance (payment received)
    const { data: customer } = await supabase
      .from("customers")
      .select("outstanding_balance")
      .eq("id", existing.customer_id)
      .maybeSingle();
    const currentBalance = Number((customer as any)?.outstanding_balance ?? 0);
    await supabase
      .from("customers")
      .update({ outstanding_balance: Math.max(0, currentBalance - Number(existing.amount)) })
      .eq("id", existing.customer_id);
  }

  const { data: updated, error } = await supabase
    .from("collections")
    .update({
      status: body.action === "approve" ? "approved" : "rejected",
      approved_by: permission.actor.profileId,
      approved_at: now,
      notes: body.notes ?? existing.notes ?? null,
      updated_at: now,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to update collection: ${error.message}` }, { status: 400 });
  }

  // Notify the employee who recorded it
  const { data: employee } = await supabase
    .from("employees")
    .select("profile_id")
    .eq("id", existing.employee_id)
    .maybeSingle();

  if (employee?.profile_id) {
    await supabase.from("notifications").insert({
      organization_id: permission.actor.organizationId,
      recipient_profile_id: employee.profile_id,
      category: "collection",
      title: body.action === "approve" ? "Collection approved" : "Collection rejected",
      body: `${existing.amount} collection ${body.action === "approve" ? "approved" : "rejected"}.`,
      entity_type: "collection",
      entity_id: id,
      channel: "in_app",
      is_read: false,
    });
  }

  logAuditEvent({
    organizationId: permission.actor.organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: body.action === "approve" ? "collection_approved" : "collection_rejected",
    entityType: "collection",
    entityId: id,
    description: `Collection ${existing.amount} ${body.action}`,
    success: true,
  });

  return NextResponse.json({ ok: true, collection: updated });
}