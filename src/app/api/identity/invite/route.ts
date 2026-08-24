import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { validateEmail } from "@/lib/identity/invitations";
import { InvitationService } from "@/lib/identity/repositories/invitation-repository";
import { normalizeRole, roleExists } from "@/lib/identity/permissions";
import { RoleRepository } from "@/lib/identity/repositories/role-repository";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  if (!actor.isOwner) {
    return NextResponse.json({ ok: false, error: "Only the store owner can invite employees." }, { status: 403 });
  }

  let body: { email?: string; role?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const emailError = validateEmail(email);
  if (emailError) {
    return NextResponse.json({ ok: false, error: emailError }, { status: 400 });
  }
  const role = normalizeRole(body.role ?? "viewer");
  const customRole = role && !roleExists(role)
    ? await new RoleRepository().find(actor.organizationId, role)
    : null;
  if (!role || (!roleExists(role) && !customRole)) {
    return NextResponse.json({ ok: false, error: "Unknown role. Please pick a role from the role library." }, { status: 400 });
  }

  const invitationService = new InvitationService();
  const result = await invitationService.createInvitation({
    organizationId: actor.organizationId,
    email,
    role,
    createdBy: actor.profileId,
    employeeId: (body as { employeeId?: string }).employeeId,
    fullName: (body as { fullName?: string }).fullName,
    phone: (body as { phone?: string }).phone,
    designation: (body as { designation?: string }).designation,
  });
  if (result.error || !result.invitation) {
    return NextResponse.json({ ok: false, error: result.error ?? "Invitation failed." }, { status: 400 });
  }

  await logAuditEvent({
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorEmail: actor.email,
    action: "invitation_sent",
    entityType: "invitation",
    entityId: result.invitation.code,
    description: `Invited ${email} as ${role}.`,
    success: true,
  });

  return NextResponse.json({
    ok: true,
    invitation: {
      code: result.invitation.code,
      email: result.invitation.email,
      role: result.invitation.role,
      expiresAt: result.invitation.expiresAt,
    },
  });
}

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }
  if (!actor.isOwner) {
    return NextResponse.json({ ok: false, error: "Only the store owner can view invitations." }, { status: 403 });
  }
  const invitationService = new InvitationService();
  const invitations = await invitationService.listForOrganization(actor.organizationId);
  return NextResponse.json({
    ok: true,
    invitations: invitations.map((i) => ({
      code: i.code,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      acceptedAt: i.acceptedAt,
    })),
  });
}
