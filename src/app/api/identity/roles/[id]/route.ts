import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { RoleRepository } from "@/lib/identity/repositories/role-repository";
import {
  buildRoleDeleteBlockedMessage,
  filterAllowedPermissions,
  validateCustomRoleEditName,
} from "@/lib/identity/custom-role-edit";
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

  // The create route validates the name and filters permissions; the
  // update route used to do neither — a rename to an empty, over-long or
  // built-in name, or a permission string the app does not know, could
  // be stored on the role. The duplicate-name check lives in the
  // repository (it needs the org's other roles from the database).
  if (body.name !== undefined) {
    const nameError = validateCustomRoleEditName(body.name);
    if (nameError) {
      return NextResponse.json({ ok: false, error: nameError }, { status: 400 });
    }
  }
  if (body.permissions !== undefined && !Array.isArray(body.permissions)) {
    return NextResponse.json({ ok: false, error: "Permissions must be a list." }, { status: 400 });
  }

  const result = await new RoleRepository().update(actor.organizationId, id, {
    name: body.name,
    description: body.description,
    permissions:
      body.permissions === undefined ? undefined : filterAllowedPermissions(body.permissions),
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

  const repository = new RoleRepository();

  // Built-in roles are never deletable: find() only matches custom roles
  // in this organization, so a built-in id (or an unknown id) ends here
  // with the same "not found" the repository has always returned.
  const role = await repository.find(actor.organizationId, id);
  if (!role) {
    return NextResponse.json({ ok: false, error: "Custom role not found." }, { status: 404 });
  }

  // profiles.role is free-text with no foreign key to role_definitions,
  // so a delete can never fail at the database level. Block it here
  // instead: staff holding the role would be left with a role id that
  // resolves to zero permissions. The message names the count so the
  // owner knows exactly how many people to reassign first.
  const holderCount = await repository.countHolders(actor.organizationId, id);
  if (holderCount > 0) {
    return NextResponse.json(
      { ok: false, error: buildRoleDeleteBlockedMessage(role.name, holderCount) },
      { status: 400 },
    );
  }

  const result = await repository.delete(actor.organizationId, id);
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
