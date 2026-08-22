import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

  const supabase = createSupabaseService();
  let query = supabase
    .from("audit_logs")
    .select("id, actor_email, action, entity_type, entity_id, description, created_at")
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(Number.isFinite(limit) ? limit : 100);
  if (action) query = query.eq("action", action);
  const { data: entries, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    entries: (entries ?? []).map((e) => ({
      id: e.id,
      actorEmail: e.actor_email,
      action: e.action,
      entityType: e.entity_type,
      entityId: e.entity_id,
      description: e.description,
      createdAt: e.created_at,
      success: true,
    })),
  });
}
