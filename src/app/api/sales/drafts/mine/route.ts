import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { getDraftSaleService } from "@/lib/sales/services/draft-sale-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await resolveActor(request);
  if (!context.actor) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }

  const service = getDraftSaleService();
  const result = await service.getMyDrafts(context.actor);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, drafts: result.drafts ?? [], total: result.total ?? 0 });
}
