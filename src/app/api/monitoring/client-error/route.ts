import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { reportProductionError } from "@/lib/monitoring/error-reporter";

export const runtime = "nodejs";

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_REPORTS_PER_MINUTE = 10;

function rateLimit(profileId: string): boolean {
  const now = Date.now();
  const current = rateLimits.get(profileId);
  if (!current || current.resetAt <= now) {
    rateLimits.set(profileId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= MAX_REPORTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin) {
    return NextResponse.json({ ok: false, error: "Forbidden origin" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) {
    return NextResponse.json({ ok: false, error: "Error report is too large" }, { status: 413 });
  }

  const context = await resolveActor(request);
  if (context.error || !context.actor?.profileId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!rateLimit(context.actor.profileId)) {
    return NextResponse.json({ ok: false, error: "Too many error reports" }, { status: 429 });
  }

  let body: { message?: unknown; stack?: unknown; path?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
  }

  await reportProductionError({
    source: "client",
    message: `${typeof body.kind === "string" ? body.kind : "error"}: ${message}`,
    stack: typeof body.stack === "string" ? body.stack : null,
    path: typeof body.path === "string" ? body.path : null,
    organizationId: context.actor.organizationId,
    profileId: context.actor.profileId,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
