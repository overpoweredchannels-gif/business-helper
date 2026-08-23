import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id: employeeId } = await params;
  const body = await request.json().catch(() => ({}));
  const territoryId = typeof body.territory_id === "string" && body.territory_id ? body.territory_id : null;
  const routeId = typeof body.route_id === "string" && body.route_id ? body.route_id : null;
  const scope = ["route_only", "route_all", "selected"].includes(body.assignment_scope)
    ? body.assignment_scope as "route_only" | "route_all" | "selected"
    : "route_only";
  const requestedCustomerIds: string[] = Array.isArray(body.customer_ids)
    ? [...new Set<string>(body.customer_ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0))]
    : [];
  const supabase = createSupabaseService();
  const organizationId = permission.actor.organizationId;

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, full_name, assigned_route_id")
    .eq("id", employeeId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (employeeError) return NextResponse.json({ ok: false, error: employeeError.message }, { status: 500 });
  if (!employee) return NextResponse.json({ ok: false, error: "Employee not found." }, { status: 404 });

  if (territoryId) {
    const { data: territory } = await supabase
      .from("territories")
      .select("id")
      .eq("id", territoryId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!territory) return NextResponse.json({ ok: false, error: "Territory not found." }, { status: 400 });
  }

  let route: { id: string; territory_id: string | null; name: string; assigned_salesman_id: string | null } | null = null;
  if (routeId) {
    const { data, error } = await supabase
      .from("sales_routes")
      .select("id, territory_id, name, assigned_salesman_id")
      .eq("id", routeId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "Route not found." }, { status: 400 });
    if (!data.territory_id) return NextResponse.json({ ok: false, error: "Assign a territory to the route first." }, { status: 400 });
    if (territoryId && data.territory_id !== territoryId) {
      return NextResponse.json({ ok: false, error: "The selected route is not in the selected territory." }, { status: 400 });
    }
    route = data;
  }

  let eligibleCustomerIds: string[] = [];
  if (route) {
    const { data, error } = await supabase
      .from("sales_route_stops")
      .select("customer_id")
      .eq("organization_id", organizationId)
      .eq("route_id", route.id)
      .not("customer_id", "is", null);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    eligibleCustomerIds = [...new Set((data ?? []).map((row) => String(row.customer_id)))];
  } else if (territoryId) {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("assigned_territory_id", territoryId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    eligibleCustomerIds = (data ?? []).map((row) => String(row.id));
  }

  const eligibleSet = new Set(eligibleCustomerIds);
  if (requestedCustomerIds.some((id) => !eligibleSet.has(id))) {
    return NextResponse.json({ ok: false, error: "Selected customers must belong to the chosen territory and route." }, { status: 400 });
  }
  const customerIds = scope === "route_all" ? eligibleCustomerIds : scope === "selected" ? requestedCustomerIds : [];

  if (employee.assigned_route_id && employee.assigned_route_id !== routeId) {
    await supabase
      .from("sales_routes")
      .update({ assigned_salesman_id: null, updated_at: new Date().toISOString() })
      .eq("id", employee.assigned_route_id)
      .eq("organization_id", organizationId)
      .eq("assigned_salesman_id", employeeId);
  }
  if (routeId) {
    if (route?.assigned_salesman_id && route.assigned_salesman_id !== employeeId) {
      const previousEmployeeId = route.assigned_salesman_id;
      const { error: previousEmployeeError } = await supabase
        .from("employees")
        .update({ assigned_route_id: null, updated_at: new Date().toISOString() })
        .eq("id", previousEmployeeId)
        .eq("organization_id", organizationId)
        .eq("assigned_route_id", routeId);
      if (previousEmployeeError) return NextResponse.json({ ok: false, error: previousEmployeeError.message }, { status: 500 });

      // A route can belong to only one employee. Remove its customer subset
      // from the previous employee before assigning the route to someone new.
      if (eligibleCustomerIds.length) {
        const { error: previousCustomersError } = await supabase
          .from("customers")
          .update({ assigned_salesman_id: null, updated_at: new Date().toISOString() })
          .eq("organization_id", organizationId)
          .eq("assigned_salesman_id", previousEmployeeId)
          .in("id", eligibleCustomerIds);
        if (previousCustomersError) return NextResponse.json({ ok: false, error: previousCustomersError.message }, { status: 500 });
      }
    }
    const { error } = await supabase
      .from("sales_routes")
      .update({ assigned_salesman_id: employeeId, updated_at: new Date().toISOString() })
      .eq("id", routeId)
      .eq("organization_id", organizationId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const effectiveTerritoryId = route?.territory_id ?? territoryId;
  const { error: assignmentError } = await supabase
    .from("employees")
    .update({ assigned_territory_id: effectiveTerritoryId, assigned_route_id: routeId, updated_at: new Date().toISOString() })
    .eq("id", employeeId)
    .eq("organization_id", organizationId);
  if (assignmentError) return NextResponse.json({ ok: false, error: assignmentError.message }, { status: 500 });

  const { error: clearCustomersError } = await supabase
    .from("customers")
    .update({ assigned_salesman_id: null, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("assigned_salesman_id", employeeId);
  if (clearCustomersError) return NextResponse.json({ ok: false, error: clearCustomersError.message }, { status: 500 });

  if (customerIds.length) {
    const { error } = await supabase
      .from("customers")
      .update({ assigned_salesman_id: employeeId, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("id", customerIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAuditEvent({
    organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: "employee_assignment_updated",
    entityType: "employee",
    entityId: employeeId,
    description: `Assigned ${employee.full_name} to ${route?.name ?? "a territory"} with ${customerIds.length} customer(s).`,
    success: true,
  });
  return NextResponse.json({ ok: true, employee_id: employeeId, territory_id: effectiveTerritoryId, route_id: routeId, customer_ids: customerIds });
}
