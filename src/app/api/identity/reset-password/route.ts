import { NextRequest, NextResponse } from "next/server";
import { validateEmail, validatePassword } from "@/lib/identity/invitations";
import { createSupabaseService } from "@/lib/supabase/server";
import { DESKTOP_AUTH_RECOVERY_CALLBACK_URL } from "@/lib/offline/desktop-auth-callback";

export const runtime = "nodejs";

/**
 * The password-reset redirect for this request. The desktop app
 * passes the aankh:// deep link (its local server binds a random
 * loopback port per launch, so the request origin is not a usable
 * redirect target); anything else must be this request's own origin
 * at /auth/callback, otherwise the request origin is used. No caller
 * in the app passes redirectTo today — the client forgot-password form
 * calls Supabase directly — this seam exists for the desktop flow.
 */
function resolveResetRedirect(request: NextRequest, requested: unknown): string {
  const fallback = `${request.nextUrl.origin}/auth/callback?type=recovery`;
  if (requested === DESKTOP_AUTH_RECOVERY_CALLBACK_URL) return requested;
  if (typeof requested === "string") {
    try {
      const url = new URL(requested);
      if (url.origin === request.nextUrl.origin && url.pathname === "/auth/callback") {
        return requested;
      }
    } catch {
      // Not a URL — fall through to the request origin.
    }
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  let body: { email?: string; newPassword?: string; redirectTo?: string };
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
      redirectTo: resolveResetRedirect(request, body.redirectTo),
    });
    return NextResponse.json({
      ok: true,
      message: "If an account exists for this email, a password reset link has been sent.",
    });
  }

  return NextResponse.json({ ok: false, error: "Provide an email or a new password with a recovery session." }, { status: 400 });
}
