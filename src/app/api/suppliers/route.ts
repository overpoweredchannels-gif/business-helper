import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { SupplierService } from "@/lib/purchases/services/supplier-service";
import { createSupabaseUserClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const getAccessToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

/**
 * Slice S6 — a client-generated UUID (offline supplier create) is
 * accepted as the row id, so the offline row and the server row are
 * the same row and purchases that already reference it need no
 * rewrite. A server-generated id is a UUID too, so the format check
 * alone cannot tell them apart — the replay check in the service is
 * the dedup: the same id re-posted returns the existing row instead
 * of a duplicate. A non-UUID id is refused (a caller inventing ids
 * could otherwise collide with server-generated ones).
 */
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSupplierClientId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value);
}

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

  // Slice S6 — client-supplied id (offline supplier create): a
  // non-UUID id is refused; a valid one passes through to the
  // service, which replays the existing row on a re-post.
  const clientId = body?.id !== undefined && body?.id !== null ? String(body.id) : null;
  if (body?.id !== undefined && body?.id !== null && !isValidSupplierClientId(clientId)) {
    return NextResponse.json({ error: "Supplier id must be a valid UUID." }, { status: 400 });
  }

  try {
    const supplier = await service.createSupplier(auth.actor, {
      ...body,
      ...(clientId ? { id: clientId } : {}),
    });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
