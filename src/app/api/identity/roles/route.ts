import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import {
  getRoleDefinitions,
  createCustomRole,
  buildPermissionMatrix,
} from "@/lib/identity/roles";
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
];

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  const roles = getRoleDefinitions();
  const builtIn = roles.filter((r) => r.isBuiltIn);
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
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  if (!actor.isOwner) {
    return NextResponse.json({ ok: false, error: "Only the store owner can create roles." }, { status: 403 });
  }

  let body: { name?: string; description?: string; permissions?: ModulePermission[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const result = createCustomRole({
    name: body.name ?? "",
    description: body.description,
    permissions: Array.isArray(body.permissions) ? body.permissions : [],
  });
  if (result.error || !result.role) {
    return NextResponse.json({ ok: false, error: result.error ?? "Role creation failed." }, { status: 400 });
  }

  logAuditEvent({
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
