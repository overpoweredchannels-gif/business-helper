import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { getDraftSaleService } from "@/lib/sales/services/draft-sale-service";

export const runtime = "nodejs";

type DraftContext = { params: Promise<{ id: string }> } | { params: { id: string } };

async function getDraftId(context: DraftContext): Promise<string> {
  const params = await context.params;
  return params.id;
}

export async function POST(request: NextRequest, context: DraftContext) {
  const permission = await requirePermission(request, "draft_approval");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const draftId = await getDraftId(context);
  let body: { action?: string; reason?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, reason } = body;
  const service = getDraftSaleService();

  if (action === "approve") {
    const result = await service.approveDraft(permission.actor, draftId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      invoice: result.invoice,
      invoiceNumber: result.invoiceNumber,
      message: `Draft approved → invoice ${result.invoiceNumber}`,
    });
  }

  if (action === "reject") {
    if (!reason || !reason.trim()) {
      return NextResponse.json({ ok: false, error: "Rejection reason is required" }, { status: 400 });
    }
    const result = await service.rejectDraft(permission.actor, draftId, reason);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, draft: result.draft, message: "Draft rejected" });
  }

  return NextResponse.json({ ok: false, error: "Unknown action. Use 'approve' or 'reject'." }, { status: 400 });
}
