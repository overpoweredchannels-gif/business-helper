import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { buildSalesmanWorkspace } from "@/lib/sales/salesman-workspace-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId || !context.actor.profileId) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }

  try {
    const workspace = await buildSalesmanWorkspace({
      organizationId: context.actor.organizationId,
      profileId: context.actor.profileId,
    });
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "No employee profile found for this account." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load salesman workspace." },
      { status: 500 },
    );
  }
}
