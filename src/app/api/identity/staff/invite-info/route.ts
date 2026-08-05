import { NextRequest, NextResponse } from "next/server";
import { StaffOnboardingService } from "@/lib/identity/services/staff-onboarding-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ ok: false, error: "Invitation code is required." }, { status: 400 });
  }

  const service = new StaffOnboardingService();
  const info = await service.getInviteInfo(code);
  if (!info.ok) {
    return NextResponse.json({ ok: false, error: info.error ?? "Invitation not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, info });
}
