import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { SalesRouteRepository } from "@/lib/identity/repositories/sales-route-repository";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> } | { params: { id: string } };

async function getRouteId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const routeId = await getRouteId(context);
  const repository = new SalesRouteRepository();

  try {
    const route = await repository.findById(routeId);
    if (!route || route.organization_id !== permission.actor.organizationId) {
      return NextResponse.json({ error: "Route not found." }, { status: 404 });
    }
    const stops = await repository.listStops(routeId);
    return NextResponse.json({ route, stops });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load route";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const routeId = await getRouteId(context);
  const body = await request.json().catch(() => ({}));
  const repository = new SalesRouteRepository();

  try {
    const existing = await repository.findById(routeId);
    if (!existing || existing.organization_id !== permission.actor.organizationId) {
      return NextResponse.json({ error: "Route not found." }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (body.assigned_salesman_id !== undefined) {
      updates.assigned_salesman_id = toNullableString(body.assigned_salesman_id);
    }
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "Route name cannot be empty." }, { status: 400 });
      }
      updates.name = name;
    }
    if (body.territory_id !== undefined) updates.territory_id = toNullableString(body.territory_id);
    if (body.description !== undefined) updates.description = toNullableString(body.description);
    if (body.route_frequency !== undefined) updates.route_frequency = body.route_frequency;
    if (body.is_active !== undefined) updates.is_active = body.is_active === true;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ route: existing });
    }

    const route = await repository.update(routeId, updates);
    await logAuditEvent({
      organizationId: permission.actor.organizationId,
      actorProfileId: permission.actor.profileId,
      actorEmail: permission.actor.email,
      action: "route_updated",
      entityType: "sales_route",
      entityId: routeId,
      description: `Updated route "${route.name}".`,
      success: true,
    });
    return NextResponse.json({ route });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update route";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const routeId = await getRouteId(context);
  const body = await request.json().catch(() => ({}));
  const repository = new SalesRouteRepository();

  try {
    const existing = await repository.findById(routeId);
    if (!existing || existing.organization_id !== permission.actor.organizationId) {
      return NextResponse.json({ error: "Route not found." }, { status: 404 });
    }

    if (body.action === "add_stop") {
      const label = toNullableString(body.label);
      if (!label && !body.customer_id) {
        return NextResponse.json({ error: "Stop needs a label or a customer." }, { status: 400 });
      }
      const stops = await repository.listStops(routeId);
      const stop = await repository.addStop({
        organization_id: permission.actor.organizationId,
        route_id: routeId,
        customer_id: toNullableString(body.customer_id),
        stop_order: stops.length + 1,
        label: label ?? toNullableString(body.customer_id),
        latitude: toNumber(body.latitude),
        longitude: toNumber(body.longitude),
        address: toNullableString(body.address),
      });
      return NextResponse.json({ stop });
    }

    if (body.action === "reorder") {
      const orderedIds = Array.isArray(body.ordered_stop_ids)
        ? (body.ordered_stop_ids as string[]).filter((id) => typeof id === "string")
        : [];
      if (orderedIds.length === 0) {
        return NextResponse.json({ error: "No stop order provided." }, { status: 400 });
      }
      const result = await repository.reorderStops(routeId, orderedIds);
      if (!result.success) {
        return NextResponse.json({ error: result.error ?? "Reorder failed." }, { status: 400 });
      }
      const stops = await repository.listStops(routeId);
      return NextResponse.json({ stops });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update stops";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const routeId = await getRouteId(context);
  const body = await request.json().catch(() => ({}));
  const repository = new SalesRouteRepository();

  try {
    const stopId = (body.stop_id as string) ?? "";
    if (!stopId) {
      return NextResponse.json({ error: "Stop ID is required." }, { status: 400 });
    }
    await repository.removeStop(routeId, stopId);
    const stops = await repository.listStops(routeId);
    return NextResponse.json({ success: true, stops });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete stop";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
