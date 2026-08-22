import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { RoleRepository } from "@/lib/identity/repositories/role-repository";
import { logAuditEvent } from "@/lib/identity/audit";
import { ModulePermission } from "@/lib/identity/types";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const actor = permission.actor;

  let body: { name?: string; description?: string; permissions?: ModulePermission[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const result = await new RoleRepository().update(actor.organizationId, id, {
    name: body.name,
    description: body.description,
    permissions: body.permissions,
  });
  if (result.error || !result.role) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role not found." }, { status: 400 });
  }

  await logAuditEvent({
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
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const actor = permission.actor;

  const result = await new RoleRepository().delete(actor.organizationId, id);
  if (!result.success) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role not found." }, { status: 404 });
  }

  await logAuditEvent({
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
