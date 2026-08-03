import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { SupplierService } from "@/lib/purchases/services/supplier-service";
import { createSupabaseUserClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const getAccessToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

const getService = (request: Request) =>
  SupplierService.withSupabase(createSupabaseUserClient(getAccessToken(request)));

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "suppliers_view");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = getService(request);

  try {
    const supplier = await service.getSupplier(auth.actor, id);
    return NextResponse.json({ supplier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "suppliers_manage");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const service = getService(request);

  try {
    const supplier = await service.updateSupplier(auth.actor, id, body);
    return NextResponse.json({ supplier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "suppliers_manage");
  if (!auth.allowed || !auth.actor) {
    return NextResponse.json({ error: auth.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = getService(request);

  try {
    await service.deleteSupplier(auth.actor, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
