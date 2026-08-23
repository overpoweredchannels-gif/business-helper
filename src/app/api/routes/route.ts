import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { resolveActor } from "@/lib/identity/api-context";
import { SalesRouteRepository } from "@/lib/identity/repositories/sales-route-repository";
import { SalesRoute } from "@/lib/tradeos/types";
import { loadSalesmanAssignmentScope } from "@/lib/sales/salesman-workspace-service";

export async function GET(request: NextRequest) {
  const context = await resolveActor(request);
  if (!context.actor) {
    return NextResponse.json({ error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }

  try {
    const repository = new SalesRouteRepository();
    let routes = await repository.findByOrganization(context.actor.organizationId);
    const canViewAllRoutes = context.actor.isOwner
      || context.actor.permissions?.includes("sales_manage")
      || context.actor.permissions?.includes("administration");
    if (!canViewAllRoutes) {
      const scope = await loadSalesmanAssignmentScope({
        organizationId: context.actor.organizationId,
        profileId: context.actor.profileId,
      });
      const assignedRouteId = scope?.route?.id ? String(scope.route.id) : null;
      routes = assignedRouteId ? routes.filter((route) => String(route.id) === assignedRouteId) : [];
    }
    return NextResponse.json({ routes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load routes";
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
    return NextResponse.json({ error: "Route name is required." }, { status: 400 });
  }

  try {
    const repository = new SalesRouteRepository();
    const route = await repository.create({
      organization_id: permission.actor.organizationId,
      name: name.trim(),
      territory_id: (body.territory_id as string) ?? null,
      description: (body.description as string) ?? null,
      route_frequency: (body.route_frequency as SalesRoute["route_frequency"]) ?? "daily",
      is_active: body.is_active !== false,
      assigned_salesman_id: (body.assigned_salesman_id as string) ?? null,
    });
    return NextResponse.json({ route });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create route";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
