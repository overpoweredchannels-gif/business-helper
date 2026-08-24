import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { TerritoryRepository } from "@/lib/identity/repositories/territory-repository";
import { loadSalesmanAssignmentScope } from "@/lib/sales/salesman-workspace-service";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  try {
    const repository = new TerritoryRepository();
    let territories = await repository.findByOrganization(permission.actor.organizationId);
    const canViewTeam = permission.actor.isOwner || permission.actor.role === "manager" || permission.actor.role === "supervisor" || Boolean(permission.actor.permissions?.includes("administration"));
    if (!canViewTeam) {
      const scope = await loadSalesmanAssignmentScope({ organizationId: permission.actor.organizationId, profileId: permission.actor.profileId });
      const territoryId = String(scope?.territory?.id ?? "");
      territories = territoryId ? territories.filter((territory) => String(territory.id) === territoryId) : [];
    }
    return NextResponse.json({ territories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load territories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = (body.name as string) ?? "";
  if (!name.trim()) {
    return NextResponse.json({ error: "Territory name is required." }, { status: 400 });
  }

  try {
    const repository = new TerritoryRepository();
    const territory = await repository.create({
      organization_id: permission.actor.organizationId,
      name: name.trim(),
      description: (body.description as string) ?? null,
      is_active: body.is_active !== false,
      center_lat: typeof body.center_lat === "number" && Number.isFinite(body.center_lat) ? body.center_lat : null,
      center_lng: typeof body.center_lng === "number" && Number.isFinite(body.center_lng) ? body.center_lng : null,
      radius_km: typeof body.radius_km === "number" && Number.isFinite(body.radius_km) ? body.radius_km : null,
    });
    return NextResponse.json({ territory });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create territory";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
