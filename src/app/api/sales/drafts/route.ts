import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { getDraftSaleService } from "@/lib/sales/services/draft-sale-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_manage");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const service = getDraftSaleService();
  const result = await service.listDrafts(permission.actor, {
    status: searchParams.get("status") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    createdBy: searchParams.get("createdBy") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, drafts: result.drafts ?? [], total: result.total ?? 0 });
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "sales_create");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: {
    customerId?: string;
    visitId?: string;
    routeId?: string;
    items?: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
      unitMode?: "main" | "subunit";
      bonus?: number;
    }>;
    notes?: string;
    expectedDate?: string;
    paymentType?: "cash" | "credit";
    creditDays?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerId, visitId, routeId, items, notes, expectedDate, paymentType, creditDays } = body;

  if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "customerId and items are required" }, { status: 400 });
  }

  const service = getDraftSaleService();
  const result = await service.createDraft(permission.actor, {
    customerId,
    visitId,
    routeId,
    items,
    notes,
    expectedDate,
    paymentType,
    creditDays,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, draft: result.draft });
}