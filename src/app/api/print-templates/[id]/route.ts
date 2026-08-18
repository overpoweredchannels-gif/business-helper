import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { PrintTemplateRepository } from "@/lib/print/print-template-store";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "sales_manage");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const repository = new PrintTemplateRepository();
    await repository.delete(id, permission.actor.organizationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete template";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}