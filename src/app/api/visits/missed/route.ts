import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { getCustomerVisitService } from "@/lib/identity/services/customer-visit-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: { visitId?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { visitId } = body;
  if (!visitId) {
    return NextResponse.json({ ok: false, error: "visitId is required" }, { status: 400 });
  }

  const service = getCustomerVisitService();
  const result = await service.markVisitMissed(permission.actor, visitId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, visit: result.visit });
}