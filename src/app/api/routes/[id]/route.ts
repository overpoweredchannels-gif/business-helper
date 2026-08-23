import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { SalesRouteRepository } from "@/lib/identity/repositories/sales-route-repository";
import { logAuditEvent } from "@/lib/identity/audit";
import { createSupabaseService } from "@/lib/supabase/server";

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

    if (body.action === "sync_customers") {
      const organizationId = permission.actor.organizationId;
      if (!existing.territory_id) {
        return NextResponse.json({ error: "Select a territory before adding route customers." }, { status: 400 });
      }
      const customerIds: string[] = Array.isArray(body.customer_ids)
        ? [...new Set<string>(body.customer_ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0))]
        : [];
      const supabase = createSupabaseService();
      const { data: eligibleCustomers, error: customersError } = customerIds.length
        ? await supabase
            .from("customers")
            .select("id, customer_name, shop_name, address, latitude, longitude")
            .eq("organization_id", organizationId)
            .eq("assigned_territory_id", existing.territory_id)
            .in("id", customerIds)
        : { data: [], error: null };
      if (customersError) return NextResponse.json({ error: customersError.message }, { status: 500 });
      if ((eligibleCustomers ?? []).length !== customerIds.length) {
        return NextResponse.json({ error: "Every route customer must belong to the route territory." }, { status: 400 });
      }

      const currentStops = await repository.listStops(routeId);
      const selectedSet = new Set(customerIds);
      const removableStopIds = currentStops
        .filter((stop) => stop.customer_id && !selectedSet.has(stop.customer_id))
        .map((stop) => stop.id);
      if (removableStopIds.length) {
        const { error } = await supabase
          .from("sales_route_stops")
          .delete()
          .eq("organization_id", organizationId)
          .eq("route_id", routeId)
          .in("id", removableStopIds);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const customStopCount = currentStops.filter((stop) => !stop.customer_id).length;
      if (customerIds.length) {
        const customerById = new Map((eligibleCustomers ?? []).map((customer) => [String(customer.id), customer]));
        const rows = customerIds.map((customerId, index) => {
          const customer = customerById.get(customerId)!;
          return {
            organization_id: organizationId,
            route_id: routeId,
            customer_id: customerId,
            stop_order: customStopCount + index + 1,
            label: customer.shop_name ?? customer.customer_name,
            address: customer.address,
            latitude: customer.latitude,
            longitude: customer.longitude,
          };
        });
        const { error } = await supabase
          .from("sales_route_stops")
          .upsert(rows, { onConflict: "route_id,customer_id", ignoreDuplicates: true });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const stops = await repository.listStops(routeId);
      await logAuditEvent({
        organizationId: permission.actor.organizationId,
        actorProfileId: permission.actor.profileId,
        actorEmail: permission.actor.email,
        action: "route_customers_synced",
        entityType: "sales_route",
        entityId: routeId,
        description: `Saved ${customerIds.length} customer(s) on route ${existing.name}.`,
        success: true,
      });
      return NextResponse.json({ success: true, stops });
    }

    if (body.action === "add_stop") {
      const label = toNullableString(body.label);
      const customerId = toNullableString(body.customer_id);
      if (!label && !customerId) {
        return NextResponse.json({ error: "Stop needs a label or a customer." }, { status: 400 });
      }
      const stops = await repository.listStops(routeId);
      let customerLabel: string | null = null;
      if (customerId) {
        if (!existing.territory_id) {
          return NextResponse.json({ error: "Assign a territory to the route before tagging a customer stop." }, { status: 400 });
        }
        const supabase = createSupabaseService();
        const { data: customer, error } = await supabase
          .from("customers")
          .select("id, customer_name, shop_name, assigned_territory_id")
          .eq("id", customerId)
          .eq("organization_id", permission.actor.organizationId)
          .maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!customer || customer.assigned_territory_id !== existing.territory_id) {
          return NextResponse.json({ error: "The tagged customer must belong to the route territory." }, { status: 400 });
        }
        customerLabel = customer.shop_name ?? customer.customer_name;
      }
      const stopInput = {
        customer_id: customerId,
        label: label ?? customerLabel,
        latitude: toNumber(body.latitude),
        longitude: toNumber(body.longitude),
        address: toNullableString(body.address),
      };
      const currentCustomerStop = customerId ? stops.find((stop) => stop.customer_id === customerId) : null;
      const stop = currentCustomerStop
        ? await repository.updateStop(currentCustomerStop.id, stopInput)
        : await repository.addStop({
            organization_id: permission.actor.organizationId,
            route_id: routeId,
            stop_order: stops.length + 1,
            ...stopInput,
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
