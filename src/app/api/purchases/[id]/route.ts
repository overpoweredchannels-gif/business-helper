import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PurchaseService } from "@/lib/purchases/services/purchase-service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "purchases_view");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = new PurchaseService();

  try {
    const result = await service.getPurchase(auth.actor, id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "purchases_create");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = new PurchaseService();

  try {
    await service.deletePurchase(auth.actor, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
