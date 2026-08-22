import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { requirePermission } from "@/lib/identity/authorization";
import { OrganizationService } from "@/lib/identity/services/organization-service";

export async function GET(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = new OrganizationService();
  const organization = await service.getCurrentOrganization(context.actor);

  return NextResponse.json({ settings: organization?.settings ?? {} });
}

export async function PATCH(request: Request) {
  const permission = await requirePermission(request, "settings_manage");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { error: permission.reason ?? "Forbidden" },
      { status: permission.actor ? 403 : 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const service = new OrganizationService();
  const updated = await service.updateSettings(permission.actor, body.settings ?? body);

  return NextResponse.json({ organization: updated });
}
