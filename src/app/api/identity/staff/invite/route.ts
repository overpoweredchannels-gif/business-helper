import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { StaffOnboardingService } from "@/lib/identity/services/staff-onboarding-service";
import { buildInviteLink } from "@/lib/identity/staff-invitation";

export const runtime = "nodejs";

async function runPOST(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const employeeId = (body.employeeId as string) ?? "";
  if (!employeeId) {
    return NextResponse.json({ error: "Employee ID is required." }, { status: 400 });
  }

  const service = new StaffOnboardingService();
  const result = await service.generateInvite(permission.actor, employeeId);
  if (!result.ok || !result.code) {
    return NextResponse.json({ error: result.error ?? "Invite generation failed." }, { status: 400 });
  }

  const origin =
    (request.headers.get("x-forwarded-proto") ?? "https") +
    "://" +
    (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000");
  const inviteLink = buildInviteLink(origin, result.code);

  return NextResponse.json({
    employee: result.employee,
    loginId: result.loginId,
    code: result.code,
    inviteLink,
    expiresAt: result.expiresAt,
  });
}

export function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "POST");
}

export async function POST(request: NextRequest) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runPOST(request), headers);
  } catch (error) {
    console.error("Cloud identity/staff/invite POST failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}
