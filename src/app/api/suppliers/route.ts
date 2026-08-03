import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { SupplierService } from "@/lib/purchases/services/supplier-service";
import { createSupabaseUserClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const getAccessToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

export async function GET(request: Request) {
  const auth = await requirePermission(request, "suppliers_view");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const service = SupplierService.withSupabase(createSupabaseUserClient(getAccessToken(request)));
  const suppliers = await service.listSuppliers(auth.actor);

  return NextResponse.json({ suppliers });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "suppliers_manage");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const service = SupplierService.withSupabase(createSupabaseUserClient(getAccessToken(request)));

  try {
    const supplier = await service.createSupplier(auth.actor, body);
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
