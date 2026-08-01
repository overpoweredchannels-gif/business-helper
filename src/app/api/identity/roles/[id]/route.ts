import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { updateCustomRole, deleteCustomRole } from "@/lib/identity/roles";
import { logAuditEvent } from "@/lib/identity/audit";
import { ModulePermission } from "@/lib/identity/types";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  if (!actor.isOwner) {
    return NextResponse.json({ ok: false, error: "Only the store owner can edit roles." }, { status: 403 });
  }

  let body: { name?: string; description?: string; permissions?: ModulePermission[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const result = updateCustomRole(id, {
    name: body.name,
    description: body.description,
    permissions: body.permissions,
  });
  if (result.error || !result.role) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role not found." }, { status: 400 });
  }

  logAuditEvent({
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorEmail: actor.email,
    action: "custom_role_updated",
    entityType: "role",
    entityId: result.role.id,
    description: `Custom role "${result.role.name}" updated.`,
    success: true,
  });

  return NextResponse.json({ ok: true, role: result.role });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  if (!actor.isOwner) {
    return NextResponse.json({ ok: false, error: "Only the store owner can delete roles." }, { status: 403 });
  }

  const result = deleteCustomRole(id);
  if (!result.success) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role not found." }, { status: 404 });
  }

  logAuditEvent({
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorEmail: actor.email,
    action: "custom_role_deleted",
    entityType: "role",
    entityId: id,
    description: `Custom role "${id}" deleted.`,
    success: true,
  });

  return NextResponse.json({ ok: true });
}
