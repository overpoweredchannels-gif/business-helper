import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PurchaseService } from "@/lib/purchases/services/purchase-service";
import { createSupabaseService } from "@/lib/supabase/server";
import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";

export const runtime = "nodejs";

// Desktop cross-origin preflight (HYBRID Slice 4): the desktop renderer
// calls this CLOUD route on Vercel from a random loopback origin. Same
// loopback-only CORS as provision / staff login — never a wildcard.
// The Bearer is verified by requirePermission -> resolveActor
// (getUser + profile lookup); org/user come from the token, never the body.
export async function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "GET, POST");
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, "purchases_view");
  if (!auth.allowed || !auth.actor) {
    return applyCors(
      NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 }),
      corsHeadersFor(request),
    );
  }

  const service = PurchaseService.withSupabase(createSupabaseService());
  const purchases = await service.listPurchases(auth.actor);

  return applyCors(NextResponse.json({ purchases }), corsHeadersFor(request));
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, "purchases_create");
  if (!auth.allowed || !auth.actor) {
    return applyCors(
      NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 }),
      corsHeadersFor(request),
    );
  }

  const body = await request.json().catch(() => ({}));
  const service = PurchaseService.withSupabase(createSupabaseService());

  try {
    const result = await service.createPurchase(auth.actor, body);
    return applyCors(NextResponse.json(result, { status: 201 }), corsHeadersFor(request));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return applyCors(NextResponse.json({ error: message }, { status: 400 }), corsHeadersFor(request));
  }
}
