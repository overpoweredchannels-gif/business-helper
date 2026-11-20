import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PurchaseService } from "@/lib/purchases/services/purchase-service";
import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";

export const runtime = "nodejs";
// HYBRID Slice 6: the desktop calls this CLOUD route on the Vercel
// endpoint (cloudFetch), so preflight + CORS for the loopback desktop
// origin — same pattern as provision / staff/me / purchases.
export async function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "POST");
}

export async function POST(request: NextRequest) {
  return applyCors(await runPost(request), corsHeadersFor(request));
}

async function runPost(request: NextRequest) {
  const auth = await requirePermission(request, "purchases_create");
  if (!auth.allowed || !auth.actor) return NextResponse.json({ ok: false, error: auth.reason || "Forbidden" }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Purchase object required");
    const result = await new PurchaseService().createPurchase(auth.actor, {
      supplier_id: body.supplier_id, purchase_date: body.invoice_date?.slice(0,10),
      payment_type: body.payment_type, credit_days: body.credit_days, notes: body.notes,
      supplier_invoice_number: body.invoice_number, request_key: body.request_key,
      lines: [{ product_id: body.product_id, quantity: body.quantity, purchase_price: body.purchase_price }],
    });
    return NextResponse.json({ ok: true, purchaseId: result.transaction.id,
      invoiceNumber: result.transaction.invoice_number, quantity: body.quantity, total: result.transaction.total_amount });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Purchase failed" }, { status: 400 });
  }
}
