import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { getCustomerVisitService } from "@/lib/identity/services/customer-visit-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: { visitId?: string; notes?: string; images?: Array<{ url: string; caption?: string }> };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { visitId, notes, images } = body;

  if (!visitId || !notes) {
    return NextResponse.json({ ok: false, error: "visitId and notes are required" }, { status: 400 });
  }

  const service = getCustomerVisitService();
  const result = await service.addVisitNotes(permission.actor, { visitId, notes, images });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, visit: result.visit });
}