import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/identity/authorization";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? "Forbidden" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const unreadOnly = searchParams.get("unread_only") === "true";

  const supabase = createSupabaseUserClient(getAccessToken(request));
  let query = supabase
    .from("notifications")
    .select("id, recipient_profile_id, category, title, body, entity_type, entity_id, channel, is_read, read_at, created_at, payload")
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, notifications: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? "Forbidden" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const markAll = body?.action === "mark_all_read";

  const supabase = createSupabaseUserClient(getAccessToken(request));
  let query = supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("organization_id", permission.actor.organizationId);

  if (!markAll && body?.id) {
    query = query.eq("id", body.id);
  } else if (!markAll) {
    return NextResponse.json({ ok: false, error: "Notification id required." }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? "Forbidden" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const clearAll = body?.action === "clear_all";

  const supabase = createSupabaseUserClient(getAccessToken(request));
  let query = supabase
    .from("notifications")
    .delete()
    .eq("organization_id", permission.actor.organizationId);

  if (!clearAll && body?.id) {
    query = query.eq("id", body.id);
  } else if (!clearAll) {
    return NextResponse.json({ ok: false, error: "Notification id required." }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
