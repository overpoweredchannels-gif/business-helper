import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { getInvitationByCode, acceptInvitation, validatePassword } from "@/lib/identity/invitations";
import { buildLegacyPermissionRow } from "@/lib/identity/legacy";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { code?: string; password?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const code = (body.code ?? "").toString().trim().toUpperCase();
  const password = body.password ?? "";
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ ok: false, error: passwordError }, { status: 400 });
  }

  const invitationResult = getInvitationByCode(code);
  if (invitationResult.error || !invitationResult.invitation) {
    return NextResponse.json(
      { ok: false, error: invitationResult.error ?? "Invitation not found." },
      { status: 400 },
    );
  }
  const invitation = invitationResult.invitation;

  let supabase;
  try {
    supabase = createSupabaseService();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Supabase is not configured: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const displayName = (body.displayName ?? "").trim() || invitation.email.split("@")[0];

  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName, organization_name: "" },
  });

  if (createError) {
    return NextResponse.json(
      { ok: false, error: `Account creation failed: ${createError.message}` },
      { status: 400 },
    );
  }
  if (!createdUser.user) {
    return NextResponse.json({ ok: false, error: "Account creation failed." }, { status: 500 });
  }

  const profilePayload = {
    id: createdUser.user.id,
    organization_id: invitation.organizationId,
    auth_user_id: createdUser.user.id,
    email: invitation.email,
    display_name: displayName,
    role: invitation.role,
    is_active: true,
  };

  const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
  if (profileError) {
    return NextResponse.json(
      { ok: false, error: `Profile creation failed: ${profileError.message}` },
      { status: 500 },
    );
  }

  const permissionRow = buildLegacyPermissionRow(invitation.organizationId, createdUser.user.id, invitation.role);
  const { error: permissionError } = await supabase
    .from("staff_permissions")
    .upsert(permissionRow, { onConflict: "organization_id,profile_id" });

  if (permissionError) {
    return NextResponse.json(
      { ok: false, error: `Permission assignment failed: ${permissionError.message}` },
      { status: 500 },
    );
  }

  const accepted = acceptInvitation(code, createdUser.user.id);
  if (accepted.error || !accepted.invitation) {
    return NextResponse.json({ ok: false, error: accepted.error ?? "Invitation acceptance failed." }, { status: 500 });
  }

  logAuditEvent({
    organizationId: invitation.organizationId,
    actorProfileId: createdUser.user.id,
    actorEmail: invitation.email,
    action: "invitation_accepted",
    entityType: "invitation",
    entityId: code,
    description: `${invitation.email} accepted invitation as ${invitation.role}.`,
    success: true,
  });

  return NextResponse.json({
    ok: true,
    profile: {
      id: createdUser.user.id,
      email: invitation.email,
      role: invitation.role,
    },
    message: `Welcome to TradeOS, ${displayName}! You can now sign in with your email and password.`,
  });
}
