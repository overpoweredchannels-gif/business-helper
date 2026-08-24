import { NextRequest, NextResponse } from "next/server";
import { validateEmail, validatePassword } from "@/lib/identity/invitations";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { email?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.newPassword) {
    const passwordError = validatePassword(body.newPassword);
    if (passwordError) return NextResponse.json({ ok: false, error: passwordError }, { status: 400 });
    const accessToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return NextResponse.json({ ok: false, error: "A valid recovery session is required." }, { status: 401 });
    const supabase = createSupabaseService();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return NextResponse.json({ ok: false, error: "The recovery session is invalid or expired." }, { status: 401 });
    const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, { password: body.newPassword });
    if (updateError) return NextResponse.json({ ok: false, error: "Password reset failed." }, { status: 500 });
    return NextResponse.json({ ok: true, message: "Password updated. You can now sign in with your new password." });
  }

  if (body.email) {
    const emailError = validateEmail(body.email);
    if (emailError) return NextResponse.json({ ok: false, error: emailError }, { status: 400 });
    const supabase = createSupabaseService();
    await supabase.auth.resetPasswordForEmail(body.email.trim().toLowerCase(), {
      redirectTo: `${request.nextUrl.origin}/auth/callback?type=recovery`,
    });
    return NextResponse.json({
      ok: true,
      message: "If an account exists for this email, a password reset link has been sent.",
    });
  }

  return NextResponse.json({ ok: false, error: "Provide an email or a new password with a recovery session." }, { status: 400 });
}
