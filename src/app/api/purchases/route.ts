import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PurchaseService } from "@/lib/purchases/services/purchase-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "purchases_view");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const service = new PurchaseService();
  const purchases = await service.listPurchases(auth.actor);

  return NextResponse.json({ purchases });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "purchases_create");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const service = new PurchaseService();

  try {
    const result = await service.createPurchase(auth.actor, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
