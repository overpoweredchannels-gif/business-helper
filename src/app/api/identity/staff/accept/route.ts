import { NextRequest, NextResponse } from "next/server";
import { StaffOnboardingService } from "@/lib/identity/services/staff-onboarding-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { code?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const code = (body.code ?? "").toString().trim();
  const password = body.password ?? "";
  if (!code) {
    return NextResponse.json({ ok: false, error: "Invitation code is required." }, { status: 400 });
  }

  const service = new StaffOnboardingService();
  const result = await service.acceptInvite(code, password);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Invitation could not be accepted." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, loginId: result.loginId });
}