import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { getCustomerVisitService } from "@/lib/identity/services/customer-visit-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: {
    employeeId?: string;
    customerId?: string;
    routeId?: string;
    stopId?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { employeeId, customerId, routeId, stopId, latitude, longitude, accuracy } = body;

  if (!employeeId || !customerId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ ok: false, error: "employeeId, customerId, latitude, longitude are required" }, { status: 400 });
  }
  if (latitude! < -90 || latitude! > 90 || longitude! < -180 || longitude! > 180 || (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0))) {
    return NextResponse.json({ ok: false, error: "Invalid location coordinates" }, { status: 400 });
  }

  const service = getCustomerVisitService();
  const result = await service.startVisit(permission.actor, {
    employeeId,
    customerId,
    routeId,
    stopId,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, visit: result.visit });
}
