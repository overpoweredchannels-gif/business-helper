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

  // Slice S6 — last-write-wins guard (offline edit sync, UMAIR's
  // decision 5): the caller sends the edit time; when the server
  // copy is newer, the edit is refused as superseded instead of
  // silently overwriting it, and the sync engine parks it as a
  // supplier-conflict issue. An owner Retry passes force: true — the
  // explicit decision that this copy wins. A call without updated_at
  // (the web edit form) updates exactly as before.
  const clientUpdatedAt = typeof body?.updated_at === "string" ? body.updated_at : null;
  const forceUpdate = body?.force === true;
  if (clientUpdatedAt && !forceUpdate) {
    const clientTime = Date.parse(clientUpdatedAt);
    if (Number.isFinite(clientTime)) {
      try {
        const current = await service.getSupplier(auth.actor, id);
        const serverTime =
          current && typeof current.updated_at === "string" ? Date.parse(current.updated_at) : NaN;
        if (current && Number.isFinite(serverTime) && clientTime < serverTime) {
          return NextResponse.json({ supplier: current, superseded: true });
        }
      } catch {
        /* No current row (or no access): the update below reports it. */
      }
    }
  }

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
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";
  const service = getService(request);

  try {
    if (permanent) {
      await service.permanentlyDeleteSupplier(auth.actor, id);
    } else {
      await service.deleteSupplier(auth.actor, id);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
