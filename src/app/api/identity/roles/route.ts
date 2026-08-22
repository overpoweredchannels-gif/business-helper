import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { getRoleDefinitions, buildPermissionMatrix, validateRoleName } from "@/lib/identity/roles";
import { RoleRepository } from "@/lib/identity/repositories/role-repository";
import { logAuditEvent } from "@/lib/identity/audit";
import { ModulePermission } from "@/lib/identity/types";

export const runtime = "nodejs";

const ALL_MODULE_PERMISSIONS: ModulePermission[] = [
  "sales_view",
  "sales_create",
  "sales_manage",
  "purchases_view",
  "purchases_create",
  "inventory_view",
  "inventory_manage",
  "customers_view",
  "customers_manage",
  "suppliers_view",
  "suppliers_manage",
  "reports_view",
  "profit_view",
  "payments_manage",
  "expenses_manage",
  "tasks_manage",
  "location_view",
  "ai_assistant",
  "administration",
  "settings_manage",
  "field_sales",
  "draft_approval",
  "import_export",
];

export async function GET(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const builtIn = getRoleDefinitions().filter((r) => r.isBuiltIn);
  const custom = await new RoleRepository().listForOrganization(permission.actor.organizationId);
  const roles = [...builtIn, ...custom];
  const matrix = buildPermissionMatrix(builtIn.map((r) => r.id));
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
    allPermissions: ALL_MODULE_PERMISSIONS,
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
  const allowed = new Set<ModulePermission>(ALL_MODULE_PERMISSIONS);
  const permissions = (Array.isArray(body.permissions) ? body.permissions : []).filter((item) => allowed.has(item));
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
