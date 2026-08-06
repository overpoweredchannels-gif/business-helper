import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { getRouteOptimizer } from "@/lib/maps/route-optimizer";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> } | { params: { id: string } };

async function getRouteId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const routeId = await getRouteId(context);
  const body = await request.json().catch(() => ({}));
  const applyToDb = body.apply === true;

  try {
    const optimizer = getRouteOptimizer();
    const result = await optimizer.optimizeRoute(routeId);

    if (applyToDb) {
      await optimizer.applyOptimization(routeId, result);
    }

    return NextResponse.json({
      ok: true,
      optimized: result,
      applied: applyToDb,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to optimize route";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}