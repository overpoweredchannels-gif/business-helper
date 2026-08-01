import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset, completePasswordReset } from "@/lib/identity/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { email?: string; token?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.token && body.newPassword) {
    const result = completePasswordReset(body.token, body.newPassword);
    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error ?? "Reset failed." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: "Password updated. You can now sign in with your new password." });
  }

  if (body.email) {
    const result = requestPasswordReset(body.email);
    if (result.error || !result.resetToken) {
      return NextResponse.json({ ok: false, error: result.error ?? "Reset request failed." }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      resetToken: result.resetToken,
      message: "Password reset link generated for this email.",
    });
  }

  return NextResponse.json({ ok: false, error: "Provide email, or token + newPassword." }, { status: 400 });
}
