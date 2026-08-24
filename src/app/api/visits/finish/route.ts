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
    visitId?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    createDraftSale?: boolean;
    draftSaleData?: {
      customerId: string;
      items: Array<{
        productId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
      paymentType?: "cash" | "credit";
      creditDays?: number;
    };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { visitId, latitude, longitude, accuracy, createDraftSale, draftSaleData } = body;

  if (!visitId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ ok: false, error: "visitId, latitude, longitude are required" }, { status: 400 });
  }
  if (latitude! < -90 || latitude! > 90 || longitude! < -180 || longitude! > 180 || (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0))) {
    return NextResponse.json({ ok: false, error: "Invalid location coordinates" }, { status: 400 });
  }

  if (createDraftSale && (!draftSaleData || !draftSaleData.customerId || !draftSaleData.items?.length)) {
    return NextResponse.json({ ok: false, error: "draftSaleData with customerId and items required when createDraftSale=true" }, { status: 400 });
  }

  const service = getCustomerVisitService();
  const result = await service.finishVisit(permission.actor, {
    visitId,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy,
    createDraftSale,
    draftSaleData,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, visit: result.visit });
}
