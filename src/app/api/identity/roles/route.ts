import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { ALL_PERMISSIONS, getRoleDefinitions, validateRoleName } from "@/lib/identity/roles";
import { filterAllowedPermissions } from "@/lib/identity/custom-role-edit";
import { RoleRepository } from "@/lib/identity/repositories/role-repository";
import { logAuditEvent } from "@/lib/identity/audit";
import { ModulePermission } from "@/lib/identity/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const builtIn = getRoleDefinitions().filter((r) => r.isBuiltIn);
  const custom = await new RoleRepository().listForOrganization(permission.actor.organizationId);
  const roles = [...builtIn, ...custom];
  const matrix = Object.fromEntries(roles.map((role) => [role.id, role.permissions]));
  return NextResponse.json({
    ok: true,
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isBuiltIn: r.isBuiltIn,
      createdAt: r.createdAt,
    })),
    permissionMatrix: matrix,
    allPermissions: ALL_PERMISSIONS,
  });
}

export async function POST(request: NextRequest) {
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

  const nameError = validateRoleName(body.name ?? "");
  if (nameError) {
    return NextResponse.json({ ok: false, error: nameError }, { status: 400 });
  }
  const permissions = filterAllowedPermissions(body.permissions);
  const result = await new RoleRepository().create(actor.organizationId, {
    name: body.name ?? "",
    description: body.description,
    permissions,
  });
  if (result.error || !result.role) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role creation failed." }, { status: 400 });
  }

  await logAuditEvent({
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorEmail: actor.email,
    action: "custom_role_created",
    entityType: "role",
    entityId: result.role.id,
    description: `Custom role "${result.role.name}" created with ${result.role.permissions.length} permissions.`,
    success: true,
  });

  return NextResponse.json({ ok: true, role: result.role });
}
