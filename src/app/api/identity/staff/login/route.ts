import { NextRequest, NextResponse } from "next/server";
import { StaffOnboardingService } from "@/lib/identity/services/staff-onboarding-service";
import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";

export const runtime = "nodejs";

// Desktop cross-origin preflight (HYBRID Slice 2): the desktop renderer
// calls this CLOUD route on Vercel from a random loopback origin. Same
// loopback-only CORS as provision — never a wildcard.
export async function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "POST");
}

export async function POST(request: NextRequest) {
  return applyCors(await runLogin(request), corsHeadersFor(request));
}

async function runLogin(request: NextRequest) {
  let body: { loginId?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const service = new StaffOnboardingService();
  const result = await service.staffLogin(body.loginId ?? "", body.password ?? "");
  if (!result.ok) {
    // A locked identifier is a rate-limit refusal (429), not a bad
    // credential (401), so the client can surface the wait time.
    if (result.locked) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "Sign in failed.",
          locked: true,
          retryAfterSeconds: result.retryAfterSeconds ?? 0,
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ ok: false, error: result.error ?? "Sign in failed." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
}
