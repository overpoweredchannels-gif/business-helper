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

  if (!visitId || typeof latitude !== "number" || typeof longitude !== "number") {
    return NextResponse.json({ ok: false, error: "visitId, latitude, longitude are required" }, { status: 400 });
  }

  if (createDraftSale && (!draftSaleData || !draftSaleData.customerId || !draftSaleData.items?.length)) {
    return NextResponse.json({ ok: false, error: "draftSaleData with customerId and items required when createDraftSale=true" }, { status: 400 });
  }

  const service = getCustomerVisitService();
  const result = await service.finishVisit(permission.actor, {
    visitId,
    latitude,
    longitude,
    accuracy,
    createDraftSale,
    draftSaleData,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, visit: result.visit });
}