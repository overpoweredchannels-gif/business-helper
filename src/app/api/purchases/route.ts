import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PurchaseService } from "@/lib/purchases/services/purchase-service";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

const getAccessToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

export async function GET(request: Request) {
  const auth = await requirePermission(request, "purchases_view");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const service = PurchaseService.withSupabase(createSupabaseService());
  const purchases = await service.listPurchases(auth.actor);

  return NextResponse.json({ purchases });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "purchases_create");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const service = PurchaseService.withSupabase(createSupabaseService());

  try {
    const result = await service.createPurchase(auth.actor, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
