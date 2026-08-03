import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
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
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const service = new OrganizationService();
  const updated = await service.updateSettings(context.actor, body.settings ?? body);

  return NextResponse.json({ organization: updated });
}
