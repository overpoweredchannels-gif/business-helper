import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { getAuditEntries, getAuditEntriesByAction } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

  const entries = action
    ? getAuditEntriesByAction(actor.organizationId, action)
    : getAuditEntries(actor.organizationId, limit);

  return NextResponse.json({
    ok: true,
    entries: entries.map((e) => ({
      id: e.id,
      actorEmail: e.actorEmail,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      description: e.description,
      createdAt: e.createdAt,
      success: e.success,
    })),
  });
}
